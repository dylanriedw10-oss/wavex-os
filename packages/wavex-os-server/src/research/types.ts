/** Research — the execution engine's FIRST phase, prototyped in onboarding.
 *
 *  This module lives outside `routes/` deliberately. The execution model is
 *  `Research → Discovery → Refinement → Action → Feedback → Reactivation`;
 *  onboarding's Phase 3 is simply the first place that first phase runs. The
 *  work runtime must be able to call the same module later, so nothing here
 *  may depend on a Fastify request or on the onboarding run file.
 *
 *  ── What research IS ────────────────────────────────────────────────────
 *  "What's newly possible for this specific business, given everything
 *  gathered in Phases 1 and 2 — not interpolating from a known gap yet,
 *  discovering approaches the operator's own answers didn't already name."
 *
 *  It runs with the FULLEST context available rather than being delegated to
 *  a narrow specialist, because research is structurally harder than planning
 *  and only has real impact where the whole picture already lives. It never
 *  sees the plan — that is what keeps it research rather than critique.
 */

/** A discovered approach.
 *
 *  `headline` alone is the spec's `research: string[]`; everything else is
 *  what lets Planning CONSUME a finding instead of merely printing it. A bare
 *  string[] would make the spec's second half ("interpolate into the gap
 *  between the goal and whatever research found possible") mechanism-free. */
export interface ResearchFinding {
  /** Stable, kebab-case, model-supplied, server-normalised and deduped. */
  id: string;
  /** ≤120 chars. The one line the operator reads. */
  headline: string;
  /** ≤400 chars. What is newly possible. */
  claim: string;
  /** ≤400 chars. Why it is possible NOW, for THIS company. */
  rationale: string;
  /** Which context keys justify it — a CLOSED vocabulary: every entry must
   *  be a key we actually put in the prompt, or the finding is dropped.
   *
   *  This is deliberately not a `source: string` URL. The call runs through
   *  `claude -p`; we cannot verify a citation, so a URL field is a
   *  hallucinated-source generator. Naming the inputs that justify a claim is
   *  the honest, checkable substitute. */
  signals: string[];
  confidence: "high" | "medium" | "low";
  /** The consumable half. `null` = advisory-only. */
  delta: ResearchDelta | null;
}

/** The ONLY thing research may change.
 *
 *  Plan assembly owns exactly one artifact — the build chain. Everything else
 *  in the plan (departments, KPIs, the goal, operating and bundle rows) is a
 *  projection of a manifest produced by the frozen vendored pipeline. Letting
 *  research rewrite a projection would make the plan the operator reviews
 *  diverge from the manifest that actually activates, which is precisely the
 *  "parallel world" plan-assembly's own header disavows. It would also grow
 *  the flywheel, which the spec forbids research from doing. */
export type ResearchDelta =
  /** Insert a new build step after an existing anchor. */
  | { kind: "mvp_step_insert"; after: string | null; title: string; deliverable: string; assigneeSlot: string }
  /** Re-aim an existing step's deliverable. The TITLE is never rewritten —
   *  the spine the operator approves stays legible across the diff. */
  | { kind: "mvp_step_refocus"; target: string; deliverable: string };

export interface ResearchPayload {
  findings: ResearchFinding[];
  /** Applied delta ids, in application order — the audit trail. */
  applied: string[];
  /** Wall-clock of the call. Feeds the ETA table and the operator line. */
  durationMs: number;
}

export const EMPTY_RESEARCH: ResearchPayload = { findings: [], applied: [], durationMs: 0 };
