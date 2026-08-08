/** parseResearchResponse — never throws, drops with a warning.
 *
 *  The load-bearing case is the restatement guard: it is the only thing that
 *  makes "discovering approaches the operator's own answers didn't already
 *  name" a checkable property rather than an instruction we hope was
 *  followed. */

import { describe, expect, it } from "vitest";
import { parseResearchResponse } from "../src/research/parse.js";

const SIGNALS = new Set(["pillar_1.industry_hint", "pillar_3.stage", "connector.stripe"]);
const opts = (prose: string[] = []) => ({ allowedSignals: SIGNALS, operatorProse: prose });

const ok = JSON.stringify({
  findings: [
    { id: "usage-billing", headline: "Meter usage and bill on consumption", claim: "c", rationale: "r", signals: ["connector.stripe", "nope.bad"], confidence: "high" },
    { id: "second", headline: "Publish a public changelog for inbound", claim: "c2", rationale: "r2", signals: [], confidence: "low" },
  ],
  attachments: [
    { finding_id: "usage-billing", kind: "mvp_step_insert", after: "mvp-spec", title: "Wire metering", deliverable: "Events flowing", assignee_slot: "cpo.build" },
  ],
});

describe("happy path", () => {
  it("parses findings, attaches deltas by finding id, and drops uncited signals", () => {
    const r = parseResearchResponse(ok, opts());
    expect(r.findings).toHaveLength(2);
    const f = r.findings.find((x) => x.id === "usage-billing")!;
    expect(f.signals).toEqual(["connector.stripe"]);          // "nope.bad" dropped
    expect(f.delta).toMatchObject({ kind: "mvp_step_insert", after: "mvp-spec" });
    expect(r.findings.find((x) => x.id === "second")!.delta).toBeNull();
  });

  it("sorts by confidence — the panel reveals the strongest first", () => {
    expect(parseResearchResponse(ok, opts()).findings.map((f) => f.confidence)).toEqual(["high", "low"]);
  });

  it("reads through a ```json fence and surrounding prose", () => {
    const r = parseResearchResponse("Here you go:\n```json\n" + ok + "\n```\nHope that helps!", opts());
    expect(r.findings).toHaveLength(2);
  });
});

describe("the restatement guard", () => {
  it("drops a headline that substantially restates the operator's own prose", () => {
    const prose = ["We help mid-market teams meter usage and bill on consumption"];
    const r = parseResearchResponse(ok, opts(prose));
    expect(r.findings.map((f) => f.id)).not.toContain("usage-billing");
    expect(r.warnings.join()).toMatch(/restates what the operator already told us/);
  });

  it("is permissive — a merely adjacent headline survives", () => {
    // A false positive silently eats the best finding, so the threshold errs
    // toward letting things through. Shared topic, different claim.
    const prose = ["We sell billing software to finance teams"];
    const r = parseResearchResponse(ok, opts(prose));
    expect(r.findings.map((f) => f.id)).toContain("usage-billing");
  });

  it("empty operator prose never drops anything", () => {
    expect(parseResearchResponse(ok, opts([""])).findings).toHaveLength(2);
  });
});

describe("degradation — a bad response costs research, never the plan", () => {
  it("prose with no JSON parses to zero findings and a warning, not a throw", () => {
    const r = parseResearchResponse("I could not determine anything useful.", opts());
    expect(r.findings).toEqual([]);
    expect(r.warnings.join()).toMatch(/no usable JSON/);
  });

  it("valid JSON with no findings array warns and returns empty", () => {
    const r = parseResearchResponse('{"notes":"hi"}', opts());
    expect(r.findings).toEqual([]);
    expect(r.warnings.join()).toMatch(/no findings array/);
  });

  it("a finding missing required fields is dropped, its siblings survive", () => {
    const raw = JSON.stringify({ findings: [{ id: "a" }, { id: "b", headline: "H", claim: "C" }] });
    const r = parseResearchResponse(raw, opts());
    expect(r.findings.map((f) => f.id)).toEqual(["b"]);
    expect(r.warnings.join()).toMatch(/missing id\/headline\/claim/);
  });

  it("an incomplete attachment is dropped but its finding survives, advisory", () => {
    const raw = JSON.stringify({
      findings: [{ id: "a", headline: "H", claim: "C" }],
      attachments: [{ finding_id: "a", kind: "mvp_step_insert", title: "T" }],   // no slot/deliverable
    });
    const r = parseResearchResponse(raw, opts());
    expect(r.findings[0]!.delta).toBeNull();
    expect(r.warnings.join()).toMatch(/incomplete insert/);
  });

  it("caps findings at 6 and attachments at 3, and says so", () => {
    const raw = JSON.stringify({
      findings: Array.from({ length: 9 }, (_, i) => ({ id: `f${i}`, headline: `Distinct headline number ${i}`, claim: "c" })),
      attachments: Array.from({ length: 5 }, (_, i) => ({ finding_id: `f${i}`, kind: "mvp_step_insert", after: null, title: "T", deliverable: "D", assignee_slot: "cpo" })),
    });
    const r = parseResearchResponse(raw, opts());
    expect(r.findings).toHaveLength(6);
    expect(r.findings.filter((f) => f.delta).length).toBeLessThanOrEqual(3);
    expect(r.warnings.join()).toMatch(/kept 6|kept 3/);
  });

  it("duplicate ids collapse", () => {
    const raw = JSON.stringify({ findings: [
      { id: "dup", headline: "One headline here", claim: "c" },
      { id: "dup", headline: "Another headline entirely", claim: "c" },
    ] });
    expect(parseResearchResponse(raw, opts()).findings).toHaveLength(1);
  });

  it("an unknown confidence falls back to medium rather than dropping the finding", () => {
    const raw = JSON.stringify({ findings: [{ id: "a", headline: "H", claim: "C", confidence: "certain" }] });
    expect(parseResearchResponse(raw, opts()).findings[0]!.confidence).toBe("medium");
  });
});
