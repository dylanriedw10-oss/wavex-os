/** Goal synthesis — the stage-band goal wavex layers onto the manifest.
 *
 *  Extracted from routes/phases.ts finalize so plan assembly can show the
 *  SAME goal in the roadmap step that finalize will later stamp into
 *  company.manifest.json. One table, one function, two consumers — the
 *  operator never reviews a goal that activation then computes differently.
 *
 *  THE TABLE BELOW IS A FALLBACK, NOT THE GOAL. It stood in as the goal for
 *  as long as nobody was asked for one, and the cost was total: a revenue
 *  BRACKET decided the number that became the approved plan, the org's
 *  current-state line, the seeded work goal, and the fleet's founding
 *  directive. Two companies eight times apart in size picked the same
 *  bracket and got identical targets. See lib/strategy.ts for where a real
 *  goal now comes from; this table only runs when there isn't one, and says
 *  so via `stated: false`.
 *
 *  Numbers halve-then-triple the typical stage band so the "growth over
 *  90d" framing reads as ambitious-but-real at the band median — which is
 *  the best a guess can do, and still only a guess. */

import type { Placement } from "./placement.js";
import type { StatedGoal } from "./strategy.js";

export interface SynthesizedGoal {
  kpiId: string;
  current: number;
  target: number;
  days: number;
  /** THE HONESTY BIT. True when the operator stated this goal; false when a
   *  band stood in for one they never gave.
   *
   *  It exists because a synthesized goal is indistinguishable from a chosen
   *  one at every point it travels — the Review card, the org's
   *  current-state line, the seeded work goal, the fleet's founding
   *  directive — and the loop measures its own work against it. A guess
   *  wearing a decision's clothes is the failure this flag prevents.
   *  Consumers MUST NOT render a `stated: false` number where a measurement
   *  belongs. */
  stated: boolean;
}

interface Pillar3Signals {
  product_state?: string;
  stage?: string;
}

const GOALS_BY_STAGE: Record<string, { current: number; target: number }> = {
  less_than_10k_mrr:   { current: 5_000,     target: 15_000 },
  "0_10k_mrr":         { current: 5_000,     target: 15_000 },
  "10k_100k_mrr":      { current: 45_000,    target: 100_000 },
  "100k_1m_mrr":       { current: 400_000,   target: 1_000_000 },
  "1m_10m_mrr":        { current: 2_500_000, target: 5_000_000 },
  more_than_1m_mrr:    { current: 2_500_000, target: 5_000_000 },
  "10m_plus_mrr":      { current: 12_000_000, target: 24_000_000 },
};

/** The goal band, keyed on PLACEMENT rather than on a local re-derivation.
 *
 *  This function used to compute its own pre-product test from
 *  `product_state` alone, IGNORING `has_product` — a third partition of the
 *  same question, and the direct cause of QA finding F12: a company that
 *  answered `has_product: false` but had not yet reached pillar 3 got the
 *  `{5_000 → 15_000}` fallback band, so the roadmap showed "Build the MVP"
 *  next to a fabricated MRR baseline. The rung now arrives from
 *  `lib/placement.ts`, which is the only thing that decides it.
 *
 *  `pre_product` and `informal` share a band: neither has revenue to grow
 *  from, and `informal` reaching the same first $5k is the honest target.
 *  This also moves `built_not_selling` off the revenue band, which aligns it
 *  with the vendored activation rules, where it has always counted as
 *  pre-revenue. That REDUCES the partition count rather than adding one. */
/** The operator's goal if they gave one; a band if they did not.
 *
 *  The stated goal ALWAYS wins. The band below is a fallback, not a default
 *  — the distinction being that a fallback marks itself (`stated: false`)
 *  and a default pretends. Every call site passes whatever
 *  `lib/strategy.ts` holds; passing nothing is what a company that skipped
 *  the question looks like, and it gets a band that says so. */
export function synthesizeGoal(
  pillar3: Pillar3Signals | undefined,
  placement: Placement,
  /** The whole Strategy, not just its goal.
   *
   *  `stated` is a SIBLING of `goal` on the persisted record, so a caller
   *  that passes `strategy.goal` alone strands the flag and this function
   *  manufactures `stated: true` out of mere presence. That is the identical
   *  shape to the bug that marked every operator answer "assumed" — one
   *  layer up, and lying in the louder direction: it stamps a signed
   *  manifest and a founding directive with an operator endorsement the
   *  operator never gave. Taking the record whole is what makes the sibling
   *  unstrandable. */
  //  `goal` is REQUIRED in this shape on purpose: it makes a bare `StatedGoal`
  //  fail to typecheck here, so the old `strategy?.goal ?? null` call sites
  //  became compile errors instead of silently falling through to the band.
  strategy?: { goal: StatedGoal; stated?: boolean } | null,
): SynthesizedGoal {
  if (strategy?.goal?.kpiId) {
    // `!== false`, not `=== true`: the route defaults `stated` to true when
    // omitted, so only an explicit decline demotes a goal that reached here.
    return { ...strategy.goal, stated: strategy.stated !== false };
  }
  const stage = pillar3?.stage ?? "unknown";
  const band = placement === "operating"
    ? GOALS_BY_STAGE[stage] ?? { current: 5_000, target: 15_000 }
    : { current: 0, target: 5_000 };
  return {
    kpiId: "monthly_recurring_revenue",
    current: band.current,
    target: band.target,
    days: 90,
    stated: false,
  };
}
