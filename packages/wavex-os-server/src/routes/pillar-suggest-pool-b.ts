/** POST /wavex-os/onboarding/pillar/:n/suggest-pool-b
 *
 *  BYOC (Bring Your Own Claude) variant of pillar-suggest. Spawns the
 *  customer's locally-installed `claude` CLI with our context-aware
 *  prompt — every inference bills against THEIR Claude subscription,
 *  not the operator's.
 *
 *  Why this stopped routing to the operator's Mac Mini (the old
 *  Supabase-Realtime Pool B path): streaming our Claude Max to the
 *  customer's machine via the claude-code-proxy created a wide-open
 *  prompt-injection / inference-reuse window — any prompt the customer
 *  fed into Claude Code would have run on our subscription. The BYOC
 *  pivot closes that. The route name + URL stay the same for
 *  compatibility with the onboarding-ui client; only the implementation
 *  changed.
 *
 *  Prompt template is still ours (see buildPrompt below + the Pool A
 *  mirror in pillars.ts). If the template changes, mirror both.
 *
 *  Fallback: if `claude` isn't on PATH or auth fails, this returns 502
 *  and the UI falls back to the Pool A endpoint (which uses
 *  tier-router → operator's hub). */

import { z } from "zod";
import type { FastifyInstance, FastifyRequest } from "fastify";
import { spawn } from "node:child_process";
import { platform } from "node:os";
import { loadPillarResponses } from "@wavex-os/plugin-onboarding";
import { assertBoard, assertCompanyAccess, AuthError } from "@wavex-os/auth-shim";

const IS_WIN = platform() === "win32";
const CLAUDE_TIMEOUT_MS = 30_000;

function runClaude(prompt: string): Promise<{ ok: true; content: string } | { ok: false; error: string; detail?: string }> {
  return new Promise((resolve) => {
    const claudeBin = IS_WIN ? "claude.cmd" : "claude";
    // Flags chosen for the wizard's "one-shot suggestion" use case:
    //   -p <prompt>             non-interactive, prompt-only mode
    //   --output-format text    return the assistant text directly
    //                           (avoids streaming-JSON envelope)
    //   --disallowedTools "*"   suppress ALL tool use — the suggestion
    //                           prompt is self-contained, no file/bash
    //                           access needed. Bounds the customer's
    //                           inference cost + sidesteps the
    //                           CLAUDE.md-injection risk for this path.
    //   --exclude-dynamic-system-prompt-sections
    //                           don't leak cwd/git/env into the system
    //                           prompt (we don't want claude's response
    //                           to be influenced by the customer's repo
    //                           state)
    // Skipped: --max-budget-usd (OAuth/subscription users have no
    // per-call charge to budget; flag only meaningful for API-key users).
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
        // Common non-zero exits: claude not installed, auth missing
        // (run `claude auth login`), rate limit, model unavailable.
        // We surface stderr so the UI can fall back to Pool A.
        resolve({
          ok: false,
          error: code === null ? "claude_killed" : "claude_nonzero_exit",
          detail: stderr.slice(0, 400) || stdout.slice(0, 400),
        });
      }
    });
  });
}

const bodySchema = z.object({ companyId: z.string().min(1) });

function authReq(req: FastifyRequest) {
  return { method: req.method, headers: req.headers as Record<string, string> };
}

/** Mirrors fieldSpecs in pillars.ts. Keep in sync if either changes. */
const FIELD_SPECS: Record<number, { fields: string; valid: Record<string, string[]> }> = {
  3: {
    // `stage` is no longer ASKED — it derives from the number Strategy
          // collects. Requesting it spent tokens on a field the card cannot
          // apply, in a vocabulary sharing ZERO values with the shipped chips.
          fields: "product_state",
    valid: {
      product_state: ["live_paying_customers", "built_not_selling", "prototype_mvp", "idea_only"],
    },
  },
  4: {
    fields: "lead_sources (array, 1-3), sales_motion",
    valid: {
      lead_sources: ["inbound_ads_meta_google", "outbound_cold", "referral_word_of_mouth",
                     "content_seo", "product_led_viral", "partnerships", "events", "none_yet"],
      sales_motion: ["self_serve_plg", "assisted_demo", "high_touch_enterprise",
                     "services_to_saas", "marketplace", "transactional", "no_motion_yet"],
    },
  },
  5: {
    fields: "comm_channel, urgency_routing (optional)",
    valid: {
      comm_channel: ["telegram", "slack", "sms", "email_only", "other"],
      urgency_routing: ["telegram_or_slack_only", "phone_or_sms_only", "email_only", "no_routing"],
    },
  },
};

function buildPrompt(
  n: number,
  responses: Awaited<ReturnType<typeof loadPillarResponses>>,
): string {
  const p1 = (responses.pillar_1 ?? {}) as {
    org_name?: string; company_context?: string;
    industry_hint?: string; business_model_hint?: string;
    inferred_signals?: Record<string, unknown>; has_product?: boolean;
  };
  const ctx: string[] = [];
  if (p1.org_name) ctx.push(`Company: ${p1.org_name}`);
  if (p1.industry_hint) ctx.push(`Industry: ${p1.industry_hint}`);
  if (p1.business_model_hint && p1.business_model_hint !== "unknown") ctx.push(`Business model: ${p1.business_model_hint}`);
  if (p1.company_context) ctx.push(`Context: ${p1.company_context.slice(0, 400)}`);
  if (p1.inferred_signals) {
    const keys = Object.entries(p1.inferred_signals).slice(0, 6)
      .map(([k, v]) => `${k}=${typeof v === "string" ? v : JSON.stringify(v)}`);
    if (keys.length) ctx.push(`Signals: ${keys.join(", ")}`);
  }
  if (responses.pillar_3) {
    const p3 = responses.pillar_3 as { product_state?: string; stage?: string };
    ctx.push(`Pillar 3 picked: product_state=${p3.product_state}, stage=${p3.stage}`);
  }
  if (responses.pillar_4) {
    const p4 = responses.pillar_4 as { lead_sources?: string[]; sales_motion?: string };
    ctx.push(`Pillar 4 picked: lead_sources=${(p4.lead_sources ?? []).join(",")}, sales_motion=${p4.sales_motion}`);
  }
  const spec = FIELD_SPECS[n];
  return `You are predicting the most likely answers a customer will pick on Pillar ${n} of an onboarding wizard, based on what they've already told us.

WHAT WE KNOW ABOUT THIS CUSTOMER:
${ctx.join("\n") || "(very little — only an org_name)"}

FIELDS TO PREDICT (Pillar ${n}): ${spec.fields}

VALID VALUES PER FIELD:
${Object.entries(spec.valid).map(([k, vs]) => `  ${k}: ${vs.join(" | ")}`).join("\n")}

Output ONLY a single-line JSON object with this shape:
{"recommended":{"<field>":"<value>", ...}, "reasoning":"<one-sentence why>"}

For array fields (e.g. lead_sources), put up to 3 ranked values in an array. For optional fields, omit them when uncertain. No backticks, no prose outside the JSON. Keep the reasoning under 140 chars.`;
}

export function registerPillarSuggestPoolBRoute(app: FastifyInstance): void {
  app.post<{ Body: { companyId: string }; Params: { n: string } }>(
    "/wavex-os/onboarding/pillar/:n/suggest-pool-b",
    async (req, reply) => {
      const ar = authReq(req);
      try { assertBoard(ar); } catch (e) {
        if (e instanceof AuthError) return reply.status(e.statusCode).send({ error: e.message });
        throw e;
      }
      const parsed = bodySchema.safeParse(req.body);
      if (!parsed.success) return reply.status(400).send({ error: "validation failed" });
      const { companyId } = parsed.data;
      assertCompanyAccess(ar, companyId);
      const n = parseInt(req.params.n, 10);
      if (![3, 4, 5].includes(n)) {
        return reply.status(400).send({ error: "suggest-pool-b only supports pillars 3, 4, 5" });
      }

      const responses = await loadPillarResponses(companyId).catch(() => null);
      if (!responses?.pillar_1) {
        return reply.status(409).send({ ok: false, error: "no pillar_1 context yet — submit pillar/1 first" });
      }

      const prompt = buildPrompt(n, responses);

      const r = await runClaude(prompt);
      if (!r.ok) {
        // 502 lets the UI fall back to the Pool A endpoint
        // (tier-router → operator's hub). Common case: customer hasn't
        // run `claude auth login` yet, or budget cap was hit.
        return reply.status(502).send({
          ok: false,
          error: r.error,
          message: r.detail,
          mode: "pool_b" as const,
        });
      }

      interface SuggestEnvelope { recommended: Record<string, unknown>; reasoning?: string }
      let parsedOut: SuggestEnvelope | null = null;
      try {
        const cleaned = r.content.replace(/^```(?:json)?\s*|\s*```$/gm, "").trim();
        parsedOut = JSON.parse(cleaned) as SuggestEnvelope;
      } catch { /* fall through */ }
      return {
        ok: true,
        pillar: n,
        recommended: parsedOut?.recommended ?? {},
        reasoning: parsedOut?.reasoning ?? null,
        raw: parsedOut ? undefined : r.content.slice(0, 400),
        mode: "pool_b" as const,
      };
    },
  );
}
