/** The transformation — current capabilities, the goal's requirements, and
 *  the shortest route between them that this organization can execute.
 *
 *  This is the layer that makes the product different from an onboarding form.
 *  Everything before it observes; this decides what has to become true.
 *
 *  ── Three rules it obeys, each from a failure already paid for ──────────
 *
 *  1. THE TARGET IS STATED, NEVER INFERRED. The goal *is* the target state,
 *     compressed. Required capabilities are derived FROM it. If the system
 *     inferred the target it would be deciding what the company should become,
 *     which is goal synthesis at the largest possible scale.
 *
 *  2. STRATEGY IS DECIDED, NOT PICKED. Capability is a requirement — you do
 *     not get to choose whether you need customers. Strategy is a choice among
 *     things that would all work, so the compiler PROPOSES and the operator
 *     DECIDES. Without this layer the compiler silently picks the approach.
 *
 *  3. FEASIBLE, NOT SHORTEST. The shortest route to revenue might be one
 *     enterprise deal; that is two steps and enormous variance. What matters
 *     is the shortest route the organization can actually execute, given what
 *     it can do today and the horizon the operator stated. Missing
 *     capabilities do not merely create work — they RULE OUT routes.
 *
 *  ── And the failure mode it must announce ───────────────────────────────
 *  The binding constraint is usually in the UNOBSERVED region. A system that
 *  optimizes what it can see will optimize whatever it happens to have a
 *  connector for, which is how an organization becomes locally optimal and
 *  globally stuck. So "the constraint is unknown, and here is what would
 *  reveal it" is a first-class answer here, not an error. */

import type { CapabilityGraph, CapabilityId, CapabilityVerdict } from "./capability-model.js";

/* ── What a goal requires ─────────────────────────────────────────────── */

/** Which capabilities a KPI cannot MOVE without.
 *
 *  The distinction is load-bearing and the first draft of this table got it
 *  wrong: a goal is a DELTA (12k → 25k), so the requirements are what it takes
 *  to move the number, not what it takes to have one. An operating company
 *  with revenue satisfies "has revenue" trivially and would show an empty gap,
 *  which is both useless and false — it plainly has work to do.
 *
 *  So growth requirements include repeatability and measurement: you cannot
 *  grow on one-off pushes, and you cannot manage a number nothing can read.
 *
 *  Keyed on the canonical KPI ids the goal is validated against, so the
 *  operator's stated metric and this table cannot drift apart. Deliberately
 *  small: a requirement here means "the number provably cannot move without
 *  this", not "this would help". */
const REQUIRES: Record<string, CapabilityId[]> = {
  monthly_recurring_revenue: ["has_something_to_sell", "has_a_priced_offer", "can_reach_new_buyers", "reach_is_repeatable", "can_convert", "can_take_money", "can_measure_the_goal_kpi"],
  activation_rate: ["has_something_to_sell", "can_onboard_customers", "can_measure_the_goal_kpi", "can_attribute_channel"],
  win_rate: ["can_reach_new_buyers", "can_convert", "can_see_the_pipeline", "can_measure_the_goal_kpi"],
  nrr: ["has_something_to_sell", "can_take_money", "can_support_customers", "knows_why_customers_leave"],
  grr: ["can_support_customers", "knows_why_customers_leave"],
  cac: ["can_reach_new_buyers", "can_attribute_channel", "can_convert"],
  cac_payback_months: ["can_take_money", "can_attribute_channel", "revenue_repeats"],
  ltv_cac_ratio: ["can_attribute_channel", "revenue_repeats", "can_take_money"],
  sales_cycle_days: ["can_see_the_pipeline", "can_convert"],
  burn_multiple: ["can_take_money", "can_measure_the_goal_kpi"],
  narrative_strength: ["has_something_to_sell"],
};

/** Capabilities that must exist before another can. The transformation is
 *  ordered by these, which is what makes it a route rather than a list. */
const DEPENDS_ON: Partial<Record<CapabilityId, CapabilityId[]>> = {
  has_a_priced_offer: ["has_something_to_sell"],
  can_convert: ["has_something_to_sell", "can_reach_new_buyers"],
  can_take_money: ["has_a_priced_offer"],
  converts_without_founder: ["can_convert"],
  reach_is_repeatable: ["can_reach_new_buyers"],
  can_attribute_channel: ["can_reach_new_buyers"],
  revenue_repeats: ["can_take_money"],
  can_onboard_customers: ["has_something_to_sell"],
  can_support_customers: ["can_convert"],
  knows_why_customers_leave: ["can_support_customers"],
  can_see_the_pipeline: ["can_reach_new_buyers"],
};

/* ── Strategies: the decision layer ───────────────────────────────────── */

export interface Strategy {
  id: string;
  label: string;
  /** What the organization must already be able to do to run this. A strategy
   *  whose prerequisites are absent is not offered — that is rule 3. */
  needs: CapabilityId[];
  /** Roughly how long before it produces anything, in days. Compared against
   *  the operator's stated horizon; a strategy slower than the goal is
   *  infeasible FOR THAT GOAL even if it is excellent. */
  leadTimeDays: number;
  /** Single point of failure, stated plainly. Not scored. */
  fragility: string;
  /** Why it is on the list. */
  because: string;
}

const STRATEGIES: Partial<Record<CapabilityId, Strategy[]>> = {
  can_reach_new_buyers: [
    { id: "founder_outreach", label: "Founder outreach", needs: [], leadTimeDays: 7,
      fragility: "Stops entirely if the founder stops.", because: "Needs nothing you don't already have." },
    { id: "content_seo", label: "Content and search", needs: ["has_something_to_sell"], leadTimeDays: 90,
      fragility: "Durable once it works; slow to start.", because: "Compounds without a person in the loop." },
    { id: "paid_acquisition", label: "Paid acquisition", needs: ["has_a_priced_offer", "can_attribute_channel"], leadTimeDays: 14,
      fragility: "Stops the day the budget stops.", because: "Fastest to a first signal, and measurable." },
    { id: "partnerships", label: "Partnerships", needs: ["has_something_to_sell"], leadTimeDays: 60,
      fragility: "Depends on one relationship you don't control.", because: "Borrows someone else's audience." },
  ],
  can_convert: [
    { id: "founder_sells", label: "Founder sells", needs: [], leadTimeDays: 7,
      fragility: "Single point of failure, and it doesn't scale.", because: "The fastest way to learn what closes." },
    { id: "self_serve", label: "Self-serve checkout", needs: ["has_a_priced_offer", "can_take_money"], leadTimeDays: 45,
      fragility: "Durable — no person in the loop.", because: "Converts without anyone present." },
  ],
  has_something_to_sell: [
    { id: "mvp_build", label: "Build the MVP", needs: [], leadTimeDays: 60,
      fragility: "Everything else waits on this.", because: "Nothing can be sold until something exists." },
    { id: "manual_delivery", label: "Deliver it by hand first", needs: [], leadTimeDays: 14,
      fragility: "Doesn't scale past a handful of customers.", because: "Proves someone wants it before you build it." },
  ],
  has_a_priced_offer: [
    { id: "single_price", label: "One price, published", needs: ["has_something_to_sell"], leadTimeDays: 3,
      fragility: "Durable.", because: "Removes a negotiation from every deal." },
  ],
  can_take_money: [
    { id: "payment_link", label: "A payment link", needs: ["has_a_priced_offer"], leadTimeDays: 2,
      fragility: "Durable.", because: "The cheapest possible path to a first transaction." },
  ],
  can_measure_the_goal_kpi: [
    { id: "wire_source", label: "Connect the system that holds the number", needs: [], leadTimeDays: 1,
      fragility: "Durable once wired.", because: "Until this exists, the goal is a number nobody can check." },
  ],
  can_attribute_channel: [
    { id: "wire_analytics", label: "Connect analytics", needs: [], leadTimeDays: 1,
      fragility: "Durable once wired.", because: "Without it, spend cannot be pointed at a result." },
  ],
  can_onboard_customers: [
    { id: "guided_onboarding", label: "Walk each customer through it", needs: ["has_something_to_sell"], leadTimeDays: 7,
      fragility: "Costs a person per customer.", because: "Fastest way to find where people get stuck." },
  ],
};

/* ── The transformation ───────────────────────────────────────────────── */

export interface GapItem {
  capability: CapabilityId;
  presence: "absent" | "unknown";
  /** Nothing can start until these exist. */
  blockedBy: CapabilityId[];
  /** Feasible approaches, given what the organization can do TODAY and the
   *  stated horizon. Empty means no route exists from here. */
  strategies: Strategy[];
  /** Present only when the gap is `unknown` — the thing that would settle it
   *  without spending the operator's attention. */
  revealedBy?: string;
}

export interface Transformation {
  /** The goal, echoed, with its provenance. A transformation compiled against
   *  a fabricated target is a plan toward a number nobody chose. */
  goal: { kpiId: string; days: number; provenance: CapabilityGraph["goalProvenance"] } | null;
  required: CapabilityId[];
  have: CapabilityId[];
  gap: GapItem[];
  /** The one missing capability that blocks the most others. Null when the
   *  gap is empty OR when the binding constraint is unobserved — see
   *  `constraintUnknown`. */
  bindingConstraint: CapabilityId | null;
  /** True when the biggest gaps are `unknown` rather than `absent`. The system
   *  is then reasoning in the dark and must say so instead of optimizing the
   *  most visible thing. */
  constraintUnknown: boolean;
  /** In dependency order. What has to become true, and in what sequence. */
  sequence: CapabilityId[];
  /** Stated plainly rather than scored. */
  notes: string[];
}

export function compileTransformation(
  graph: CapabilityGraph,
  goal: { kpiId: string; days: number } | null,
): Transformation {
  const byId = new Map(graph.capabilities.map((c) => [c.id, c]));
  const notes: string[] = [];

  if (!goal?.kpiId) {
    return {
      goal: null, required: [], have: [], gap: [], bindingConstraint: null,
      constraintUnknown: false, sequence: [],
      notes: ["No goal has been stated, so there is no target to compile toward."],
    };
  }

  const required = REQUIRES[goal.kpiId] ?? [];
  if (required.length === 0) {
    notes.push(`No requirement set is defined for ${goal.kpiId.replace(/_/g, " ")}; the gap below is empty for that reason, not because the organization is complete.`);
  }
  if (graph.goalProvenance !== "stated") {
    notes.push(graph.goalProvenance === "fallback"
      ? "This target was not stated by the operator — a stage band stood in. Confirm it before executing against it."
      : "This goal carries no record of who chose it, so it must be treated as unconfirmed.");
  }

  const have = required.filter((id) => byId.get(id)?.presence === "present");
  const missing = required.filter((id) => byId.get(id)?.presence !== "present");

  const gap: GapItem[] = missing.map((id) => {
    const v = byId.get(id) as CapabilityVerdict | undefined;
    const presence = v?.presence === "absent" ? "absent" as const : "unknown" as const;
    const blockedBy = (DEPENDS_ON[id] ?? []).filter((d) => byId.get(d)?.presence !== "present");
    // Rule 3: only offer what the organization can actually run today, and
    // only what fits inside the horizon it was given.
    const strategies = (STRATEGIES[id] ?? [])
      .filter((st) => st.needs.every((n) => byId.get(n)?.presence === "present"))
      .filter((st) => st.leadTimeDays <= goal.days)
      .sort((a, b) => a.leadTimeDays - b.leadTimeDays);
    const item: GapItem = { capability: id, presence, blockedBy, strategies };
    if (presence === "unknown" && v?.noSignal !== true) {
      item.revealedBy = v?.because ?? "Connecting the system that holds it.";
    }
    return item;
  });

  // The binding constraint blocks the most other gaps. Computed over ABSENT
  // gaps only — an unknown cannot be known to block anything, and treating it
  // as the constraint is exactly how a system optimizes what it can see.
  const absent = gap.filter((g) => g.presence === "absent");
  const blockCount = (id: CapabilityId) => gap.filter((g) => g.blockedBy.includes(id)).length;
  const bindingConstraint = absent.length > 0
    ? absent.map((g) => g.capability).sort((a, b) => blockCount(b) - blockCount(a))[0]!
    : null;

  const unknowns = gap.filter((g) => g.presence === "unknown");
  const constraintUnknown = unknowns.length > absent.length;
  if (constraintUnknown) {
    notes.push(`${unknowns.length} of ${gap.length} missing capabilities are unobserved rather than known-absent. The real constraint may be one of them, so treat any ranking below as provisional until they are observed.`);
  }

  // Dependency order: something is ready when everything it depends on is
  // either present or already earlier in the sequence.
  const sequence: CapabilityId[] = [];
  const pending = new Set(missing);
  let guard = 0;
  while (pending.size > 0 && guard++ < 50) {
    const ready = [...pending].filter((id) =>
      (DEPENDS_ON[id] ?? []).every((d) => byId.get(d)?.presence === "present" || sequence.includes(d)));
    if (ready.length === 0) { sequence.push(...pending); break; }  // a cycle; emit rather than hang
    ready.sort((a, b) => blockCount(b) - blockCount(a));
    for (const id of ready) { sequence.push(id); pending.delete(id); }
  }

  const stranded = gap.filter((g) => g.presence === "absent" && g.strategies.length === 0);
  if (stranded.length > 0) {
    notes.push(`No approach fits inside ${goal.days} days for: ${stranded.map((s) => s.capability.replace(/_/g, " ")).join(", ")}. Either the horizon is too short for this goal, or the route runs through something the organization cannot do yet.`);
  }

  return {
    goal: { kpiId: goal.kpiId, days: goal.days, provenance: graph.goalProvenance },
    required, have, gap, bindingConstraint, constraintUnknown, sequence, notes,
  };
}
