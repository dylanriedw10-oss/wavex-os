/** The revenue bracket, DERIVED — never asked.
 *
 *  Pillar 3 used to ask for it from a chip menu, one card before Strategy
 *  asked for the actual number. That meant two answers to the same question
 *  with nothing reconciling them, and the audit found the wider version of
 *  the same problem: three independent stage vocabularies (these chips, the
 *  T2 suggestion list, and `selection/affinities.ts`'s `Stage` type), each
 *  consumer carrying its own silent fallback. Deriving from the typed number
 *  removes one of the three outright and makes the remaining pair a
 *  comparison of values rather than of menus.
 *
 *  KNOWN AND NOT FIXED HERE: `selection/affinities.ts` scores templates
 *  against ARR-shaped ids (`100k_500k_arr`, `1m_5m_arr`) while every producer
 *  of `pillar_3.stage` — this file included — emits MRR-shaped ones. Only
 *  `10k_100k_mrr` overlaps, by accident, so the scorer's stage axis (weight
 *  0.20) is very nearly dead. Reconciling it means editing the affinity
 *  table, which is a separate change with its own blast radius. This file
 *  therefore emits the vocabulary the chips always emitted, so nothing
 *  downstream shifts silently. */

/** The bracket ids `lib/options.ts` offered, in the order the boundaries
 *  climb. Kept identical on purpose — `GOALS_BY_STAGE` and the T2 suggestion
 *  pool are both keyed on them. */
const MRR_BRACKETS: { maxExclusive: number; id: string }[] = [
  { maxExclusive: 10_000, id: "less_than_10k_mrr" },
  { maxExclusive: 100_000, id: "10k_100k_mrr" },
  { maxExclusive: 1_000_000, id: "100k_1m_mrr" },
  { maxExclusive: Infinity, id: "more_than_1m_mrr" },
];

/** Where a pre-revenue company sits, from the product state alone. These
 *  come from `STAGE_PRE` and need no number — the number is zero. */
const PRE_BY_PRODUCT_STATE: Record<string, string> = {
  idea_only: "pre_product",
  prototype_mvp: "pre_launch",
  built_not_selling: "soft_launched",
};

export interface DerivedStage {
  stage: string;
  stage_other?: string;
}

/** Derive `pillar_3.stage` from what the operator actually said.
 *
 *  The three cases, in order of how much is known:
 *    1. Pre-revenue product state → the launch-state id. No number needed.
 *    2. A stated MRR goal → the bracket its CURRENT value falls in. The
 *       current value, not the target: the bracket describes where the
 *       company is, and using the target would place it where it wants to be.
 *    3. Anything else — a non-revenue KPI, or a declined strategy → `other`,
 *       with the reason recorded verbatim.
 *
 *  Case 3 deliberately does NOT guess. An invented bracket is exactly the
 *  failure this whole change exists to remove, and `stage_other` carrying
 *  "not stated" is readable by a human looking at the manifest later. */
export function deriveStage(
  productState: string,
  goal: { kpiId: string; current: number } | null,
): DerivedStage {
  const pre = PRE_BY_PRODUCT_STATE[productState];
  if (pre) return { stage: pre };

  if (goal && goal.kpiId === "monthly_recurring_revenue" && Number.isFinite(goal.current)) {
    const bracket = MRR_BRACKETS.find((b) => goal.current < b.maxExclusive);
    return { stage: bracket?.id ?? "more_than_1m_mrr" };
  }

  return {
    stage: "other",
    stage_other: goal ? `measured by ${goal.kpiId}, not revenue` : "revenue not stated",
  };
}
