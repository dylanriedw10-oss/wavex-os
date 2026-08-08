/** POST /wavex-os/onboarding/mc-narrate
 *
 *  Wraps the programmatic Monte Carlo simulator (vendored at
 *  vendor/wavex-os/flywheel-kernel/) with an LLM reasoning layer. The
 *  simulator gives us deterministic numerical projections (Sharpe-ranked
 *  strategies + KPI trajectories); this route runs the customer's local
 *  `claude` CLI over those numbers + their pillar context, and returns
 *  a 3-paragraph narrative that explains WHY the winning strategy won,
 *  what assumptions matter, and the next concrete bet to make.
 *
 *  Why this matters:
 *    The customer-vision spec for WaveX OS says "the Monte Carlo
 *    simulation is not programmatic" — the deterministic sim alone
 *    feels like a calculator. Pairing it with LLM reasoning makes the
 *    output feel context-aware to THIS customer's situation, while
 *    keeping the sim numbers honest + auditable.
 *
 *  Architecture:
 *    Inputs:
 *      - companyId  (used to load pillar context + the MC report)
 *    Reads:
 *      - ~/.wavex-os/instances/default/companies/{id}/onboarding/
 *          pillar_responses.json
 *          monte_carlo_report.json
 *    Spawns:
 *      - `claude -p <prompt> --output-format text --disallowedTools "*"
 *                --exclude-dynamic-system-prompt-sections`
 *      - Uses the customer's BYOC Anthropic account.
 *    Returns:
 *      { ok: true, narrative: string, model_attribution: "byoc-claude" }
 *      or
 *      { ok: false, error, fallback_narrative?: string }
 *
 *  Fallback (no claude installed / not authed): returns a static
 *  reasoned-text bullet list derived from the sim numbers — keeps the
 *  UI from being empty when BYOC isn't wired. The customer sees a
 *  "Generated without your Claude account" hint in that case.
 */

import { z } from "zod";
import type { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import { spawn } from "node:child_process";
import { platform } from "node:os";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { loadPillarResponses } from "@wavex-os/plugin-onboarding";
import { assertBoard, assertCompanyAccess, AuthError } from "@wavex-os/auth-shim";
import { getOnboardingDir } from "../state-bridge.js";

const IS_WIN = platform() === "win32";
const CLAUDE_TIMEOUT_MS = 45_000;

const bodySchema = z.object({ companyId: z.string().min(1) });

function authReq(req: FastifyRequest) {
  return { method: req.method, headers: req.headers as Record<string, string> };
}

function gateBoard(req: FastifyRequest, reply: FastifyReply): boolean {
  const ar = authReq(req);
  try { assertBoard(ar); return true; }
  catch (e) {
    if (e instanceof AuthError) { reply.status(e.statusCode).send({ error: e.message }); return false; }
    throw e;
  }
}

interface McStrategyResult {
  // The vendored simulator writes `strategy_id`, not `strategy`.
  strategy_id?: string;
  strategy?: string;
  sharpe: number;
  mean_mrr_growth: number;
  mean_activation_growth?: number;
  mean_burn_multiple?: number;
  p_ruin?: number;
  p_auto_catalytic?: number;
}

interface McReport {
  generated_at?: string;
  mode?: string;
  // Vendored simulator writes `strategies`, not `results`. Accept either
  // for forward-compat.
  strategies?: McStrategyResult[];
  results?: McStrategyResult[];
  horizon_cycles?: number;
  n_runs_per_strategy?: number;
  seed?: number;
}

function buildNarrationPrompt(opts: {
  pillarCtx: string;
  mcReport: McReport;
}): string {
  const rows = (opts.mcReport.strategies ?? opts.mcReport.results ?? []);
  // Sort by Sharpe (primary) then mean_activation_growth (secondary fallback
  // — pre_scale mode often has Sharpe=0 across the board, which is itself
  // diagnostic). Take top 3 for the prompt.
  const sorted = [...rows].sort((a, b) => {
    if (b.sharpe !== a.sharpe) return b.sharpe - a.sharpe;
    return (b.mean_activation_growth ?? 0) - (a.mean_activation_growth ?? 0);
  });
  const top3 = sorted.slice(0, 3);

  const lines = top3.map((r, i) => {
    const name = r.strategy_id ?? r.strategy ?? "(unnamed)";
    const sharpe = r.sharpe.toFixed(2);
    const mrr = `${r.mean_mrr_growth.toFixed(1)}%`;
    const act =
      typeof r.mean_activation_growth === "number"
        ? ` · activation +${(r.mean_activation_growth * 100).toFixed(1)}%`
        : "";
    return `  ${i + 1}. ${name} — Sharpe ${sharpe}, mean MRR growth ${mrr}${act}`;
  });

  return `You are reading the output of a 5-strategy Monte Carlo simulation that just ran for a new company in our agent-fleet platform. The numerical projections are deterministic; your job is to add the strategic reasoning that explains them to the founder.

CONTEXT (what this company told us about itself):
${opts.pillarCtx}

SIMULATION OUTPUT (top 3 ranked by Sharpe):
${lines.join("\n")}

Mode used for this run: ${opts.mcReport.mode ?? "growth"}

Write exactly THREE short paragraphs, separated by blank lines, in plain founder-readable English (no jargon, no markdown headings, no bullets):

1. WHY the winning strategy won — what about this company's profile makes that allocation the right bet right now?
2. WHAT could change the answer — name the single biggest assumption baked into the sim and how the founder could test/falsify it in the next 30 days.
3. THE NEXT CONCRETE MOVE — the one thing the founder should do this week to start executing the winning strategy, framed as a single action they can take Monday morning.

Total length: 150-250 words. No preamble. No "Here's my analysis:". Start directly with paragraph 1. No prose outside the three paragraphs.`;
}

function fallbackNarration(report: McReport): string {
  const rows = report.strategies ?? report.results ?? [];
  const sorted = [...rows].sort((a, b) => {
    if (b.sharpe !== a.sharpe) return b.sharpe - a.sharpe;
    return (b.mean_activation_growth ?? 0) - (a.mean_activation_growth ?? 0);
  });
  const winner = sorted[0];
  if (!winner) {
    return "The simulation didn't produce a ranked strategy yet — try re-running finalize, or check that pillars 1-5 are complete.";
  }
  const second = sorted[1];
  const name = winner.strategy_id ?? winner.strategy ?? "(unnamed)";
  const secondName = second?.strategy_id ?? second?.strategy ?? "—";
  return [
    `The simulator ranked "${name}" highest. In pre-scale mode the Sharpe ratios all collapse to zero (MRR hasn't started compounding yet), so the ranking is driven by mean activation growth: this strategy projects an activation lift of ${((winner.mean_activation_growth ?? 0) * 100).toFixed(1)}%. The runner-up was "${secondName}".`,
    `The sim's biggest assumption is that your current stage holds steady through the 30-cycle horizon. In pre-scale, the dominant lever is activation, not MRR — so if your activation experiments stall or your first design partner closes faster than expected, rerun the simulation. The mode itself may shift to "growth" and the winning strategy with it.`,
    `Translate the winning bundle into one move for this week: pick the largest capability weighting in the winning bundle and double down on it. If RETENTION_FIRST won, spend the week on the most-leaky activation step. If ACQUISITION_HEAVY won, ship one new top-of-funnel test. Either way, ignore the bundles you didn't pick — focused beats balanced at this stage.`,
  ].join("\n\n");
}

function runClaude(prompt: string): Promise<{ ok: true; content: string } | { ok: false; error: string; detail?: string }> {
  return new Promise((resolve) => {
    const claudeBin = IS_WIN ? "claude.cmd" : "claude";
    const child = spawn(
      claudeBin,
      [
        "-p", prompt,
        "--output-format", "text",
        "--disallowedTools", "*",
        "--exclude-dynamic-system-prompt-sections",
      ],
      { shell: IS_WIN },
    );
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (d) => { stdout += d.toString(); });
    child.stderr.on("data", (d) => { stderr += d.toString(); });
    const timer = setTimeout(() => {
      try { child.kill("SIGTERM"); } catch { /* ignore */ }
      setTimeout(() => { try { child.kill("SIGKILL"); } catch { /* ignore */ } }, 2_000);
    }, CLAUDE_TIMEOUT_MS);
    child.on("error", (err) => {
      clearTimeout(timer);
      resolve({ ok: false, error: "claude_spawn_failed", detail: String(err) });
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      if (code === 0) {
        resolve({ ok: true, content: stdout.trim() });
      } else {
        resolve({
          ok: false,
          error: code === null ? "claude_killed" : "claude_nonzero_exit",
          detail: stderr.slice(0, 400) || stdout.slice(0, 400),
        });
      }
    });
  });
}

function summarizePillars(responses: Awaited<ReturnType<typeof loadPillarResponses>>): string {
  const lines: string[] = [];
  // Cast through unknown — the vendored response shapes don't have index
  // signatures, but we only read a small fixed set of fields each.
  const p1 = (responses.pillar_1 ?? {}) as unknown as Record<string, unknown>;
  if (p1.org_name) lines.push(`Company: ${String(p1.org_name)}`);
  if (p1.industry_hint) lines.push(`Industry: ${String(p1.industry_hint)}`);
  if (p1.business_model_hint && p1.business_model_hint !== "unknown") lines.push(`Business model: ${String(p1.business_model_hint)}`);
  if (typeof p1.company_context === "string") {
    lines.push(`Founder context: ${p1.company_context.slice(0, 300)}`);
  }
  const p3 = responses.pillar_3 as unknown as Record<string, unknown> | undefined;
  if (p3) {
    lines.push(`Stage: ${String(p3.stage ?? "?")}, product state: ${String(p3.product_state ?? "?")}`);
  }
  const p4 = responses.pillar_4 as unknown as Record<string, unknown> | undefined;
  if (p4) {
    const sources = Array.isArray(p4.lead_sources) ? (p4.lead_sources as unknown[]).join(",") : "?";
    lines.push(`Lead sources: ${sources}; sales motion: ${String(p4.sales_motion ?? "?")}`);
  }
  const p5 = responses.pillar_5 as unknown as Record<string, unknown> | undefined;
  if (p5) {
    lines.push(`Comm channel: ${String(p5.comm_channel ?? "?")}`);
  }
  return lines.join("\n");
}

export function registerMcNarrateRoute(app: FastifyInstance): void {
  app.post<{ Body: { companyId: string } }>(
    "/wavex-os/onboarding/mc-narrate",
    async (req, reply) => {
      if (!gateBoard(req, reply)) return;
      const parsed = bodySchema.safeParse(req.body);
      if (!parsed.success) return reply.status(400).send({ error: "validation failed" });
      const { companyId } = parsed.data;
      assertCompanyAccess(authReq(req), companyId);

      // Load pillar context (best-effort — narration still works without it).
      let pillarCtx = "(no pillar context available)";
      try {
        const responses = await loadPillarResponses(companyId);
        pillarCtx = summarizePillars(responses) || pillarCtx;
      } catch { /* ignore */ }

      // Read the MC report written by finalize.
      let report: McReport | null = null;
      try {
        const path = join(getOnboardingDir(companyId), "monte_carlo_report.json");
        const raw = await readFile(path, "utf8");
        report = JSON.parse(raw) as McReport;
      } catch {
        return reply.status(409).send({
          ok: false,
          error: "monte_carlo_report.json not found — run finalize first",
        });
      }

      const strategiesArr = report.strategies ?? report.results;
      if (!strategiesArr || strategiesArr.length === 0) {
        return reply.status(409).send({
          ok: false,
          error: "MC report has no strategies — re-run finalize",
        });
      }

      const prompt = buildNarrationPrompt({ pillarCtx, mcReport: report });
      const r = await runClaude(prompt);

      if (r.ok) {
        return reply.send({
          ok: true,
          narrative: r.content,
          model_attribution: "byoc-claude" as const,
        });
      }

      // Claude not installed / not authed / errored. Return the
      // deterministic fallback narration so the UI doesn't dead-end.
      return reply.send({
        ok: true,
        narrative: fallbackNarration(report),
        model_attribution: "fallback-deterministic" as const,
        warning: r.detail ?? r.error,
      });
    },
  );
}
