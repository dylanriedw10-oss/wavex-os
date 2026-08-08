/** applyResearchToChecklist — pure, so tested purely.
 *
 *  The two properties that matter most here are IDEMPOTENCE (deriveSteps runs
 *  this on every re-derive — the refinement tail, stale recovery, a resume —
 *  and must not compound insertions) and DROP-WITH-A-WARNING (a malformed
 *  finding costs that finding, never the plan). */

import { describe, expect, it } from "vitest";
import { applyResearchToChecklist, type ChecklistItemShape } from "../src/research/apply.js";
import type { ResearchFinding } from "../src/research/types.js";

const ACTIVE = new Set(["cpo", "cpo.build", "cdo.telemetry", "cmo.content"]);

const CHAIN: ChecklistItemShape[] = [
  { id: "mvp-spec", title: "Write the MVP product spec", deliverable: "A spec", assigneeSlot: "cpo", kind: "mvp", dependsOn: [] },
  { id: "mvp-build", title: "Build the MVP", deliverable: "A working version", assigneeSlot: "cpo.build", kind: "mvp", dependsOn: ["mvp-spec"] },
  { id: "op-cmo.content", title: "Publish", deliverable: "A post", assigneeSlot: "cmo.content", kind: "operating", dependsOn: [] },
];

function finding(over: Partial<ResearchFinding> = {}): ResearchFinding {
  return {
    id: "f1", headline: "Ship an eval harness before the model layer",
    claim: "c", rationale: "r", signals: ["pillar_1.industry_hint"], confidence: "high",
    delta: { kind: "mvp_step_insert", after: "mvp-spec", title: "Build an eval harness", deliverable: "A harness", assigneeSlot: "cpo.build" },
    ...over,
  };
}

describe("insert", () => {
  it("lands directly after its anchor, as a leaf, with provenance", () => {
    const r = applyResearchToChecklist(CHAIN, [finding()], { activeSlots: ACTIVE });
    const ids = r.checklist.map((c) => c.id);
    expect(ids).toEqual(["mvp-spec", "mvp-r-f1", "mvp-build", "op-cmo.content"]);
    const added = r.checklist.find((c) => c.id === "mvp-r-f1")!;
    expect(added.dependsOn).toEqual(["mvp-spec"]);
    expect(added.origin).toBe("research");
    expect(added.researchFindingId).toBe("f1");
    expect(r.applied).toEqual(["f1"]);
    expect(r.patches[0]).toMatchObject({ kind: "mvp_step_insert", source: "research", detail: finding().headline });
  });

  it("nothing re-points onto an inserted item — acyclic by construction", () => {
    const r = applyResearchToChecklist(CHAIN, [finding()], { activeSlots: ACTIVE });
    expect(r.checklist.every((c) => !c.dependsOn.includes("mvp-r-f1"))).toBe(true);
  });

  it("after: null puts it at the head with no dependency", () => {
    const f = finding({ delta: { kind: "mvp_step_insert", after: null, title: "T", deliverable: "D", assigneeSlot: "cpo" } });
    const r = applyResearchToChecklist(CHAIN, [f], { activeSlots: ACTIVE });
    expect(r.checklist[0]!.id).toBe("mvp-r-f1");
    expect(r.checklist[0]!.dependsOn).toEqual([]);
  });
});

describe("drop-with-a-warning", () => {
  it("an inactive assignee is dropped — a task addressed to a parked agent never runs", () => {
    const f = finding({ delta: { kind: "mvp_step_insert", after: "mvp-spec", title: "T", deliverable: "D", assigneeSlot: "cfo.ghost" } });
    const r = applyResearchToChecklist(CHAIN, [f], { activeSlots: ACTIVE });
    expect(r.checklist).toEqual(CHAIN);
    expect(r.applied).toEqual([]);
    expect(r.warnings.join()).toMatch(/not an active slot/);
  });

  it("an unknown anchor is dropped", () => {
    const f = finding({ delta: { kind: "mvp_step_insert", after: "mvp-nope", title: "T", deliverable: "D", assigneeSlot: "cpo" } });
    const r = applyResearchToChecklist(CHAIN, [f], { activeSlots: ACTIVE });
    expect(r.applied).toEqual([]);
    expect(r.warnings.join()).toMatch(/unknown anchor/);
  });

  it("refocusing a non-MVP row is dropped — research owns the build chain only", () => {
    const f = finding({ delta: { kind: "mvp_step_refocus", target: "op-cmo.content", deliverable: "D" } });
    const r = applyResearchToChecklist(CHAIN, [f], { activeSlots: ACTIVE });
    expect(r.applied).toEqual([]);
    expect(r.warnings.join()).toMatch(/unknown target/);
  });

  it("a company with no build chain gets findings but no structural change, stated plainly", () => {
    const operating = CHAIN.filter((c) => c.kind !== "mvp");
    const r = applyResearchToChecklist(operating, [finding()], { activeSlots: ACTIVE });
    expect(r.checklist).toEqual(operating);
    expect(r.applied).toEqual([]);
    expect(r.warnings.join()).toMatch(/advisory for a company with no build chain/);
  });
});

describe("refocus", () => {
  it("re-aims the deliverable and never the title", () => {
    const f = finding({ delta: { kind: "mvp_step_refocus", target: "mvp-build", deliverable: "A working version WITH telemetry" } });
    const r = applyResearchToChecklist(CHAIN, [f], { activeSlots: ACTIVE });
    const t = r.checklist.find((c) => c.id === "mvp-build")!;
    expect(t.title).toBe("Build the MVP");
    expect(t.deliverable).toBe("A working version WITH telemetry");
    expect(t.origin).toBe("research");
  });
});

describe("idempotence — deriveSteps re-runs this on every re-derive", () => {
  it("applying twice inserts once", () => {
    const once = applyResearchToChecklist(CHAIN, [finding()], { activeSlots: ACTIVE });
    const twice = applyResearchToChecklist(once.checklist, [finding()], { activeSlots: ACTIVE });
    expect(twice.checklist.filter((c) => c.id === "mvp-r-f1")).toHaveLength(1);
    expect(twice.checklist.map((c) => c.id)).toEqual(once.checklist.map((c) => c.id));
  });

  it("refocusing twice does not double-clamp the deliverable", () => {
    const f = finding({ delta: { kind: "mvp_step_refocus", target: "mvp-build", deliverable: "X" } });
    const once = applyResearchToChecklist(CHAIN, [f], { activeSlots: ACTIVE });
    const twice = applyResearchToChecklist(once.checklist, [f], { activeSlots: ACTIVE });
    expect(twice.checklist.find((c) => c.id === "mvp-build")!.deliverable).toBe("X");
  });

  it("never mutates the input array", () => {
    const input = structuredClone(CHAIN);
    applyResearchToChecklist(input, [finding()], { activeSlots: ACTIVE });
    expect(input).toEqual(CHAIN);
  });
});

describe("caps — the fit law reaches back into the data", () => {
  it("at most 3 changes apply; the rest are advisory and said so", () => {
    const many = Array.from({ length: 6 }, (_, i) => finding({
      id: `f${i}`,
      delta: { kind: "mvp_step_insert", after: "mvp-spec", title: `T${i}`, deliverable: "D", assigneeSlot: "cpo" },
    }));
    const r = applyResearchToChecklist(CHAIN, many, { activeSlots: ACTIVE });
    expect(r.applied.length).toBeLessThanOrEqual(3);
    expect(r.warnings.join()).toMatch(/capped/);
  });

  it("an over-long title is clamped rather than dropped", () => {
    const f = finding({ delta: { kind: "mvp_step_insert", after: "mvp-spec", title: "T".repeat(200), deliverable: "D", assigneeSlot: "cpo" } });
    const r = applyResearchToChecklist(CHAIN, [f], { activeSlots: ACTIVE });
    expect(r.checklist.find((c) => c.id === "mvp-r-f1")!.title.length).toBeLessThanOrEqual(80);
  });
});

describe("no deltas", () => {
  it("advisory-only findings leave the checklist identical and warn about nothing", () => {
    const r = applyResearchToChecklist(CHAIN, [finding({ delta: null })], { activeSlots: ACTIVE });
    expect(r.checklist).toEqual(CHAIN);
    expect(r.warnings).toEqual([]);
  });
});
