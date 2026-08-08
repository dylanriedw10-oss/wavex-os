/** The goal, from the operator's mouth to the fleet's founding directive.
 *
 *  Two defects these tests exist to keep dead:
 *
 *  1. `stated` stopped at the Review card. The card said "Estimated — no goal
 *     was stated", and then four consumers on the handoff path re-declared
 *     the goal's shape inline WITHOUT that field and rendered a stage band as
 *     a mandate — including the founding planning brief, which
 *     `lib/goal-synthesis.ts` names explicitly as a consumer that must never
 *     do this, and CONTEXT.md, which every agent re-reads on every heartbeat
 *     for the life of the company.
 *
 *  2. Three of those consumers read `goal.metric`, which the manifest goal
 *     does not have — it is `kpiId`. The field being optional plus a
 *     `?? "goal"` fallback meant the compiler was satisfied while the KPI
 *     name was silently swallowed. An operator who chose activation rate got
 *     a seeded goal titled "goal: 22 → 45 in 180d".
 *
 *  Both were invisible to typecheck, so they are pinned here instead. */

import { describe, expect, it } from "vitest";
import { goalProvenance, goalTitle, isStated, kpiLabel, readGoal, UNSTATED } from "../src/lib/goal-line.js";

const STATED = { kpiId: "activation_rate", current: 22, target: 45, days: 180, stated: true };
const BAND = { kpiId: "monthly_recurring_revenue", current: 45_000, target: 100_000, days: 90, stated: false };

describe("readGoal — one reader, so the shape cannot drift again", () => {
  it("reads the manifest goal whole, including the honesty bit", () => {
    expect(readGoal({ goal: BAND })).toEqual(BAND);
  });

  it("returns null rather than half a goal", () => {
    expect(readGoal(null)).toBeNull();
    expect(readGoal({})).toBeNull();
    expect(readGoal({ goal: {} })).toBeNull();
    expect(readGoal({ goal: { kpiId: "cac" } })).toBeNull();          // no target
    expect(readGoal({ goal: { current: 1, target: 2, days: 3 } })).toBeNull();  // no KPI
  });

  it("a manifest signed before `stated` existed is UNKNOWN, not stated", () => {
    // REVERSED, on evidence. The first version read a missing flag as `true`,
    // reasoning that pre-flag goals came from a flow where the bracket
    // question was the operator's own answer.
    //
    // The data says otherwise. The one real company on disk carries
    // {2,500,000 -> 5,000,000, 90d} with no `stated` key — byte-identical to
    // GOALS_BY_STAGE["more_than_1m_mrr"]. The operator picked a BRACKET; the
    // system invented the NUMBERS. Calling that "stated" hands the fleet a
    // fabricated $5M mandate as a founding directive.
    const old = { kpiId: "monthly_recurring_revenue", current: 2_500_000, target: 5_000_000, days: 90 };
    const g = readGoal({ goal: old })!;
    expect(isStated(g)).toBe(false);
    expect(goalProvenance(g)).toBe("unknown");
  });

  it("the three provenances are distinguishable", () => {
    // "we know a band produced this" and "nobody recorded who chose this" are
    // different things to tell someone, and both differ from a real answer.
    const base = { kpiId: "cac", current: 1, target: 2, days: 30 };
    expect(goalProvenance(readGoal({ goal: { ...base, stated: true } })!)).toBe("stated");
    expect(goalProvenance(readGoal({ goal: { ...base, stated: false } })!)).toBe("fallback");
    expect(goalProvenance(readGoal({ goal: base })!)).toBe("unknown");
  });
});

describe("the KPI name survives — the `metric` bug", () => {
  it("titles a non-revenue goal by its own metric, not the word 'goal'", () => {
    // The pre-fix output was literally "goal: 22 → 45 in 180d".
    expect(goalTitle(STATED)).toBe("activation rate: 22 → 45 in 180d");
    expect(goalTitle(STATED)).not.toMatch(/^goal:/);
  });

  it("spells the KPI the way the Review card spelled it", () => {
    // The operator approved "monthly recurring revenue"; the fleet must not
    // be handed "monthly_recurring_revenue" or "goal".
    expect(kpiLabel("monthly_recurring_revenue")).toBe("monthly recurring revenue");
    expect(goalTitle(BAND)).toBe("monthly recurring revenue: 45,000 → 100,000 in 90d");
  });
});

describe("an unstated goal announces itself, in every audience's words", () => {
  it("distinguishes a stated goal from a band", () => {
    expect(isStated(STATED)).toBe(true);
    expect(isStated(BAND)).toBe(false);
  });

  it("the founding directive tells the fleet to confirm it FIRST, not just that it is soft", () => {
    // A label alone changes nothing about what the agent does. The directive
    // has to name the next move, or the fleet derives workstreams from the
    // band anyway.
    expect(UNSTATED.directive).toMatch(/NOT stated by the operator/);
    expect(UNSTATED.directive).toMatch(/step 0/);
    expect(UNSTATED.directive).toMatch(/confirm/i);
  });

  it("every variant says the same two things", () => {
    for (const [audience, text] of Object.entries(UNSTATED)) {
      expect(text.length, `${audience} must be a real sentence`).toBeGreaterThan(20);
      // Each variant must say the number is not the operator's — either
      // because a band produced it, or because nobody recorded who chose it.
      expect(text, `${audience} must disclaim the number`).toMatch(/not stated|estimated|no record/i);
    }
  });
});
