/** Stub composer — determinism, the three canonical questions, signatures. */
import { describe, expect, it } from "vitest";
import { composeStub, classify, intentSignature, utteranceKey } from "../src/canvas/composer.js";
import { signaturesForTopic } from "../src/canvas/composer-t2.js";
import { validateLayout } from "../src/canvas/catalog.js";

describe("canvas stub composer", () => {
  it("canonical Q1 (investigative): why did spend spike → spend workspace", () => {
    const c = composeStub("Why did spend spike?");
    expect(c.intent.topic).toBe("spend");
    expect(c.layout?.title).toBe("Token spend");
    expect(validateLayout(c.layout).warnings).toEqual([]);
  });

  it("canonical Q2 (decisional): raise the budget to 60k → proposal, no layout", () => {
    const c = composeStub("raise the token budget to 60k");
    expect(c.intent.kind).toBe("propose");
    expect(c.proposal?.action).toBe("set-token-budget");
    expect(c.proposal?.body).toEqual({ cap_tokens: 60_000 });
  });

  it("canonical Q3 (ambient): what needs me → attention workspace", () => {
    const c = composeStub("what needs my attention?");
    expect(c.intent.topic).toBe("attention");
    expect(c.layout?.cells[0].type).toBe("attention");
  });

  it("is deterministic: identical input, identical composition", () => {
    const a = composeStub("show me the team");
    const b = composeStub("show me the team");
    expect(a).toEqual(b);
  });

  it("paraphrases converge on one signature; different questions do not", () => {
    const s1 = intentSignature(classify("why did spend spike"));
    const s2 = intentSignature(classify("what did the tokens cost"));
    const s3 = intentSignature(classify("show me the team"));
    expect(s1).toBe(s2);
    expect(s1).not.toBe(s3);
    expect(s1).toMatch(/^cv\d+:/); // version-agnostic: bumps orphan layouts by design
  });

  it("proposal without an amount degrades to clarify, never guesses", () => {
    const c = composeStub("raise the budget");
    expect(c.intent.kind).toBe("clarify");
    expect(c.proposal).toBeUndefined();
  });

  it("gibberish degrades to clarify with an orientation reply", () => {
    const c = composeStub("purple monkey dishwasher");
    expect(c.intent.kind).toBe("clarify");
    expect(c.layout).toBeNull();
  });

  it("every stub layout validates against the catalog with zero warnings", () => {
    for (const q of ["spend?", "budget?", "kpis?", "team?", "redundant slots?", "ignition?", "how are we doing", "what needs me"]) {
      const c = composeStub(q);
      if (c.layout) expect(validateLayout(c.layout).warnings).toEqual([]);
    }
  });

  it("utteranceKey normalizes politeness and punctuation", () => {
    expect(utteranceKey("Show me — why did spend spike?!")).toBe(utteranceKey("why did spend spike"));
  });
});

describe("topic classification stems", () => {
  // Regression: /\bsimulat\b/ never matches "simulate" — a trailing word
  // boundary after a stem is unsatisfiable. Assert TOPICS, not just validity.
  const cases: Array<[string, string]> = [
    ["simulate strategies", "simulation"],
    ["run a simulation", "simulation"],
    ["which strategy wins?", "simulation"],
    ["what happened so far?", "timeline"],
    ["show me the history", "timeline"],
    ["are there redundant slots?", "redundancy"],
    ["show redundancy", "redundancy"],
    ["did ignition complete?", "ignition"],
    ["is the fleet activated?", "ignition"],
    ["what did it cost", "spend"],
    ["show goals", "kpis"],
    ["show me the team", "roster"],
    // runtime must beat roster: "agents" appears in both, but the question
    // is about live work, not org shape.
    ["what are the agents working on", "runtime"],
    ["show live activity", "runtime"],
    ["what's running right now?", "runtime"],
  ];
  it.each(cases)("%s → %s", (msg, topic) => {
    const c = composeStub(msg);
    expect(c.intent.topic).toBe(topic);
    expect(c.layout).not.toBeNull();
  });
});

describe("T2 reuse topic guard", () => {
  // Regression: T2 answered "what happened so far?" by reusing a remembered
  // spend workspace. The route then aliases the utterance to that signature,
  // so an off-topic reuse is permanent, not a one-turn miss.
  it("accepts a reuse whose signature carries the same topic", () => {
    const sig = intentSignature({ kind: "query", topic: "spend", window: "all" });
    expect(signaturesForTopic("spend").has(sig)).toBe(true);
  });

  it("accepts any window variant of the same topic", () => {
    for (const window of ["today", "7d", "30d", "all"] as const) {
      const sig = intentSignature({ kind: "query", topic: "timeline", window });
      expect(signaturesForTopic("timeline").has(sig)).toBe(true);
    }
  });

  it("rejects a reuse that crosses topics", () => {
    const spend = intentSignature({ kind: "query", topic: "spend", window: "all" });
    expect(signaturesForTopic("timeline").has(spend)).toBe(false);
  });

  it("rejects every reuse when the question did not classify", () => {
    expect(signaturesForTopic("unknown").size).toBe(0);
  });
});
