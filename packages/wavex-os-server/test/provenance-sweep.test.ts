/** The provenance sweep — a marker exists at a source hop, and the consumer
 *  drops it, so a fabrication arrives somewhere wearing a fact's clothes.
 *
 *  Six of these survived adversarial verification. Each `it` below is one of
 *  them, and each is written against the shape the ONE real company on disk
 *  actually has — because in every case the reason the bug shipped is that
 *  the fixture was cleaner than the data.
 *
 *  The class, stated once: a value and its provenance travel as siblings, and
 *  every hop that re-declares the shape inline is a chance to keep the value
 *  and drop the sibling. Typecheck cannot see it — both sides compile. */

import { describe, expect, it } from "vitest";
import { HEADLINES } from "../src/canvas/snapshot.js";
import { buildAgentWorkflowMd } from "../src/bridge/paperclip-handoff.js";
import { synthesizeGoal } from "../src/lib/goal-synthesis.js";

/** ricoma's real manifest goal: a stage-band pair with NO `stated` key. */
const LEGACY_GOAL = { kpiId: "monthly_recurring_revenue", current: 2_500_000, target: 5_000_000, days: 90 };

describe("a headline slot demands a positive record, not the absence of a denial", () => {
  it("a goal with no `stated` key is not headlined", () => {
    // `=== false` passed this through, because the flag is simply absent —
    // and the two numbers are byte-identical to GOALS_BY_STAGE's
    // `more_than_1m_mrr` row. A machine-invented pair was the big number the
    // operator's delta was measured from.
    expect(HEADLINES.manifest!({ manifest: { goal: LEGACY_GOAL } })).toBeNull();
  });

  it("a goal the operator stated IS headlined", () => {
    expect(HEADLINES.manifest!({ manifest: { goal: { ...LEGACY_GOAL, stated: true } } })).toBe(2_500_000);
  });

  it("an explicit fallback is not headlined either", () => {
    expect(HEADLINES.manifest!({ manifest: { goal: { ...LEGACY_GOAL, stated: false } } })).toBeNull();
  });

  it("an estimated KPI baseline is not headlined", () => {
    // pillar-3 stamps `ai_estimated: true` on every path, so kpis[0] is a
    // stage-table constant. It still renders in the KPI table — labelled —
    // but it cannot be a measurement a delta is taken against.
    expect(HEADLINES.kpis!({ kpis: [{ currentValue: 1_800_000, provenance: "estimated" }] })).toBeNull();
    expect(HEADLINES.kpis!({ kpis: [{ currentValue: 1_800_000, provenance: "projected" }] })).toBeNull();
    expect(HEADLINES.kpis!({ kpis: [{ currentValue: 1_800_000, provenance: "measured" }] })).toBe(1_800_000);
  });

  it("an unmarked KPI row is treated as unproven, not as measured", () => {
    // The safe direction: a row from a producer that has not yet been taught
    // to declare provenance must not be promoted to a measurement.
    expect(HEADLINES.kpis!({ kpis: [{ currentValue: 1_800_000 }] })).toBeNull();
  });
});

describe("the workflow an agent reads every heartbeat marks its gated steps", () => {
  const WM = {
    agent_workflows: {
      "cro.close": {
        heartbeat: "2h",
        on_fire: [
          { task: "read_pipeline", tier: "T1", flow_type: "VAL", expected_output: "pipeline rows" },
          { task: "execute_close_action", tier: "T2", flow_type: "VAL", connector: "stripe",
            expected_output: "Stripe charge/subscription created; order row in supabase", dry_run_gate: true },
        ],
      },
    },
  };

  it("a gated step is marked in its own title, not only in metadata", () => {
    const md = buildAgentWorkflowMd(WM, "cro.close")!;
    // The step is an INSTRUCTION under a preamble that says "read it top to
    // bottom". Anything qualifying the instruction has to sit where the
    // instruction is — metadata parentheticals are skimmable.
    expect(md).toMatch(/2\. 🔒 GATED — \*\*execute_close_action\*\*/);
    expect(md).toMatch(/Do NOT execute this step for real/);
  });

  it("the connector the step touches is named", () => {
    // Dropped alongside the gate. "create a charge" and "create a charge in
    // Stripe" are different instructions.
    expect(buildAgentWorkflowMd(WM, "cro.close")!).toMatch(/via stripe/);
  });

  it("an ungated step gains no marker", () => {
    const md = buildAgentWorkflowMd(WM, "cro.close")!;
    expect(md).toMatch(/1\. \*\*read_pipeline\*\*/);
    expect(md.match(/GATED/g)).toHaveLength(1);
  });

  it("the count of gated steps is stated before the list", () => {
    expect(buildAgentWorkflowMd(WM, "cro.close")!).toMatch(/\*\*1 of these 2 steps is under the dry-run gate\*\*/);
  });

  it("a workflow with no gates says nothing about gates", () => {
    const clean = { agent_workflows: { "cro.close": { on_fire: [{ task: "read_pipeline" }] } } };
    const md = buildAgentWorkflowMd(clean, "cro.close")!;
    expect(md).not.toMatch(/gate|GATED/);
  });
});

describe("`stated` is a sibling of `goal`, and siblings get stranded", () => {
  it("a declined goal cannot be laundered into a stated one by passing `.goal`", () => {
    // The call sites all read `readStrategy(id)?.goal ?? null`, so presence
    // alone produced `stated: true`. The parameter now REQUIRES the record,
    // which turned every one of those call sites into a compile error rather
    // than a silent lie in a signed manifest.
    const rec = { goal: { kpiId: "activation_rate", current: 22, target: 45, days: 180 }, stated: false };
    expect(synthesizeGoal({ product_state: "live_paying_customers" }, "operating", rec).stated).toBe(false);
    expect(synthesizeGoal({ product_state: "live_paying_customers" }, "operating", { ...rec, stated: true }).stated).toBe(true);
  });
});
