/** The manifest's goal, read once and rendered consistently.
 *
 *  Five places used to reach into `manifest.goal` with their own inline type
 *  and their own template string, and the drift that produced was not
 *  cosmetic:
 *
 *  1. FOUR of them omitted `stated`, so a stage band nobody chose was handed
 *     to the CEO as a founding directive, written into every agent's
 *     CONTEXT.md permanently, printed as the CEO's "one job", and seeded as
 *     the work store's goal — all indistinguishable from a number the
 *     operator actually picked. `lib/goal-synthesis.ts` names the founding
 *     directive explicitly in the list of consumers that must never do this.
 *  2. THREE of them read `goal.metric`, a field the manifest goal does not
 *     have — it is `kpiId`. Because the field was optional and every site
 *     wrote `?? "goal"`, the compiler was satisfied and the KPI name was
 *     silently swallowed: an operator who chose activation rate got a goal
 *     titled "goal: 22 → 45 in 180d".
 *
 *  Both classes of bug come from the same cause — the shape being
 *  re-declared per consumer — so the fix is one reader, not five patches.
 *
 *  `research/prompt.ts` already threads `stated` correctly; this module
 *  generalises that pattern to the rest of the handoff. */

/** The goal as `lib/goal-synthesis.ts` writes it and `routes/phases.ts`
 *  stamps it into `company.manifest.json`. `stated` is optional ONLY because
 *  manifests signed before it existed don't carry it — see `isStated`. */
export interface ManifestGoal {
  kpiId: string;
  current: number;
  target: number;
  days: number;
  stated?: boolean;
}

/** Read the goal off a manifest without asserting a shape per call site.
 *  Returns null when there is no usable goal — a goal missing its KPI or its
 *  target is not a goal, and callers already have a "no goal" branch that is
 *  more honest than a half-rendered one. */
export function readGoal(manifest: unknown): ManifestGoal | null {
  const g = (manifest as { goal?: Partial<ManifestGoal> } | null | undefined)?.goal;
  if (!g || typeof g.kpiId !== "string" || !g.kpiId) return null;
  if (typeof g.target !== "number") return null;
  return {
    kpiId: g.kpiId,
    current: typeof g.current === "number" ? g.current : 0,
    target: g.target,
    days: typeof g.days === "number" ? g.days : 90,
    stated: g.stated,
  };
}

/** Where this goal came from. THREE values, not two.
 *
 *  The first version of this returned a boolean and read a MISSING flag as
 *  `true`, on the reasoning that goals predating the flag came from a flow
 *  where the bracket question was the operator's own answer. That reasoning
 *  did not survive the data.
 *
 *  The one real company on disk has `{2,500,000 → 5,000,000, 90d}` and no
 *  `stated` key — numbers byte-identical to `GOALS_BY_STAGE`'s
 *  `more_than_1m_mrr` row. The operator picked a BRACKET; the system invented
 *  the NUMBERS. Reading that as "stated" hands the fleet a fabricated $5M
 *  mandate as a founding directive, which is precisely the failure the flag
 *  was added to prevent.
 *
 *  So absent is its own answer: `unknown`. Not stated, not known-fabricated
 *  — no record of who chose it. That is the same three-valued discipline the
 *  capability model uses, applied to the field that inspired it. */
export type GoalProvenance = "stated" | "fallback" | "unknown";

export function goalProvenance(goal: ManifestGoal): GoalProvenance {
  if (goal.stated === true) return "stated";
  if (goal.stated === false) return "fallback";
  return "unknown";
}

/** True ONLY when the operator provably chose this.
 *
 *  Every consumer treats a non-`true` as "say so" — which is right: an
 *  unrecorded provenance and a known fallback both mean the number must not
 *  be rendered where a measurement belongs. Use `goalProvenance` when the
 *  difference between the two matters to the wording. */
export function isStated(goal: ManifestGoal): boolean {
  return goal.stated === true;
}

/** The KPI as a person reads it. Underscore-to-space is the convention the
 *  Review card already uses; keeping it here means the number the operator
 *  approved and the number the fleet is handed are spelled the same way. */
export function kpiLabel(kpiId: string): string {
  return kpiId.replace(/_/g, " ");
}

/** "monthly recurring revenue: 12,000 → 25,000 in 90d" — the shared spine
 *  every surface builds from. Never carries the estimate marker itself:
 *  where that marker goes depends on who is reading, so the caller places
 *  it. */
export function goalTitle(goal: ManifestGoal): string {
  return `${kpiLabel(goal.kpiId)}: ${goal.current.toLocaleString()} → ${goal.target.toLocaleString()} in ${goal.days}d`;
}

/** What to say about an unstated goal, per audience.
 *
 *  These are not decorations. An agent that reads "move X to Y" and one that
 *  reads "move X to Y, which nobody chose — confirm it first" do different
 *  work, and the second is the correct work. Every variant therefore states
 *  the same two facts: the number is a stage-band estimate, and confirming
 *  it is the first move. */
export const UNSTATED = {
  /** For the founding planning run — must be actionable, not a label. */
  directive:
    "This target was NOT stated by the operator — a stage band stood in for a goal they never gave. "
    + "Treat it as a placeholder, not a mandate: confirming or replacing it with the operator is step 0 "
    + "of this run, before any workstream is derived from it.",
  /** For CONTEXT.md — permanent prompt material for every agent. */
  context:
    "_Estimated, not stated._ The operator did not give a goal, so a stage band stood in. "
    + "Do not treat this number as a measurement or as a commitment; it is the working assumption "
    + "until the operator replaces it.",
  /** For a work-store record, where the title is already the goal. */
  seed:
    "Estimated from the company's stage — the operator did not state a goal. "
    + "Replace it once they do.",
  /** For a compact display surface with no room for a sentence. */
  short: "estimated — not stated by the operator",
  /** For the weaker case: no record either way. Distinct from `short`,
   *  because "we know a band produced this" and "nobody wrote down who chose
   *  this" are different things to tell someone. */
  unrecorded: "no record of who chose this",
} as const;
