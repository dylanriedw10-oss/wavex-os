/** Running research — the T2 call, and nothing else.
 *
 *  DELIBERATE SCOPE: this module does no file IO and knows nothing about
 *  `plan_assembly.json`. It takes a context, calls the model, parses, and
 *  returns an outcome. That is what lets the work runtime call the identical
 *  function as its own first phase without inheriting onboarding's run file.
 *  Orchestration — writing the step, settling the deterministic plan,
 *  tracking what is in flight — belongs to the caller.
 *
 *  (The plan sketched a `settleDeterministically` living here; it belongs
 *  with the run-file store instead, or `research/` would have to import the
 *  route it is supposed to be independent of.)
 *
 *  FAILURE IS NEVER FATAL. Every path returns an outcome; none throws. The
 *  deterministic plan is the spine, and research either enriches it or does
 *  not. */

import { route as tierRoute } from "@wavex-os/plugin-tier-router";
import { withTokenAccounting } from "../lib/token-accounting.js";
import { BudgetExhaustedError } from "../lib/token-budget.js";
import { allowedSignals, buildResearchPrompt, type ResearchContext } from "./prompt.js";
import { parseResearchResponse } from "./parse.js";
import { EMPTY_RESEARCH, type ResearchPayload } from "./types.js";

/** 150s: refinement gets 120s over a smaller prompt, and research is
 *  explicitly the harder task with the fullest context. Past ~150s the
 *  operator has left, and the deterministic plan is the better answer. */
const TIMEOUT_MS = 150_000;

export type ResearchOutcome =
  | { kind: "ready"; payload: ResearchPayload; warnings: string[] }
  /** Ran and produced nothing usable — or was never allowed to run. Either
   *  way the caller proceeds; `note` is the one operator-facing line. */
  | { kind: "failed"; note: string; warnings: string[] }
  | { kind: "skipped"; note: string; warnings: string[] };

/** Operator-authored prose the restatement guard measures against. These are
 *  the fields the operator (or an enrichment of their own words) wrote — a
 *  finding that merely echoes them has discovered nothing. */
function operatorProse(ctx: ResearchContext): string[] {
  const p1 = (ctx.pillars.pillar_1 ?? {}) as Record<string, unknown>;
  const fromPillars = ["company_context", "differentiator_hypothesis", "primary_friction_hypothesis", "ideal_customer_profile"]
    .map((k) => (typeof p1[k] === "string" ? (p1[k] as string) : ""));
  // The operator's OWN sentence and their OWN stated bottleneck belong here
  // above all: those are literally their words, and a finding that hands
  // them back is the purest form of the restatement this guard exists to
  // catch. Enrichment prose is a model's paraphrase; these are not.
  return [...fromPillars, ctx.rawInput ?? "", ctx.strategy?.bottleneck ?? ""]
    .filter((s) => s.length > 0);
}

export async function runResearch(companyId: string, ctx: ResearchContext): Promise<ResearchOutcome> {
  const startedAt = Date.now();
  let raw: string;
  try {
    raw = await withTokenAccounting(companyId, "research", async () => {
      const resp = await tierRoute({
        agent_id: "onboarding.plan.research",
        prompt: buildResearchPrompt(ctx),
        task_metadata: {
          // The one metadata difference from refinement: discovery is
          // creative work, and `deep` + `high` keeps it on T2 rather than
          // being deferred under tight headroom.
          creativity_required: true,
          customer_facing: false,
          reasoning_depth: "deep",
          priority: "high",
        },
        companyId,
        outputFormat: "json",
        timeout_ms: TIMEOUT_MS,
      });
      // The router can answer with an empty output and a `deferred` block
      // when T2 is halted. That is a skip, not a failure.
      const deferred = (resp as { deferred?: { reason?: string } }).deferred;
      if (deferred) throw new DeferredError(deferred.reason ?? "T2 deferred");
      return resp.output;
    });
  } catch (e) {
    const warn = (m: string) => [`research ${m}`];
    if (e instanceof BudgetExhaustedError) {
      // NOT a 429. Research is an automatic sub-step of a flow that must
      // complete — blocking Phase 3 on a token cap would be a product bug.
      return { kind: "skipped", note: "token budget exhausted", warnings: warn("skipped: token budget exhausted — raise the cap to research future plans") };
    }
    if (e instanceof DeferredError) {
      return { kind: "skipped", note: e.message, warnings: warn(`skipped: ${e.message}`) };
    }
    const msg = e instanceof Error ? e.message : String(e);
    return { kind: "failed", note: "research didn't complete", warnings: warn(`failed: ${msg} — the deterministic plan stands`) };
  }

  const parsed = parseResearchResponse(raw, {
    allowedSignals: allowedSignals(ctx),
    operatorProse: operatorProse(ctx),
  });

  // Zero findings is `ready`, not `failed`: the call succeeded and the honest
  // answer was "nothing newly possible worth naming". The panel then renders
  // nothing, which is correct.
  return {
    kind: "ready",
    payload: { ...EMPTY_RESEARCH, findings: parsed.findings, durationMs: Date.now() - startedAt },
    warnings: parsed.warnings,
  };
}

class DeferredError extends Error {}
