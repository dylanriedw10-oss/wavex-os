/** The reasoning engine — steps 1, 2, 3, 4 and 6 of the architecture.
 *
 *  Each describe block pins one law, and each law exists because its
 *  violation already cost this codebase something:
 *
 *    provenance      — a synthesised goal became a founding directive
 *    read-tracking   — a declared dependency (`goal.metric`) drifted silently
 *    counterfactual  — four separate attempts to score confidence
 *    transformation  — a bracket decided a plan for companies 8x apart
 *    recompile       — nothing ever revised anything
 */

import { describe, expect, it } from "vitest";
import { readObservations, toClaims, findContradictions, findUnmapped } from "../src/lib/observation.js";
import { track, invalidatedBy, diffKeys } from "../src/lib/read-tracker.js";
import { valueOfQuestions, nextQuestion, CANDIDATES } from "../src/lib/counterfactual.js";
import { compileTransformation } from "../src/lib/transformation.js";
import { recompile, shouldRebuild } from "../src/lib/recompile.js";
import { buildCapabilityGraph, type CapabilitySources } from "../src/lib/capability-model.js";

const src = (o: Partial<CapabilitySources>): CapabilitySources =>
  ({ pillars: null, manifest: null, swarm: null, workflow: null, strategy: null, vault: null, ...o });

const OPERATING = src({
  pillars: {
    pillar_1: { has_product: true, industry_hint: "b2b_saas", primary_acquisition_channel: "content seo" },
    pillar_3: { product_state: "live_paying_customers" },
    pillar_4: { lead_sources: ["outbound_cold"], sales_motion: "assisted_demo" },
  },
  // The REAL persisted shape: `stated` is a SIBLING of goal, not inside it.
  // This fixture used to invent `goal.stated`, a shape the .strict() route can
  // never write — which is exactly why the suite stayed green while every
  // operator-stated goal was being reported back to them as unconfirmed.
  strategy: { goal: { kpiId: "monthly_recurring_revenue", current: 12_000 }, stated: true, bottleneck: "onboarding takes three weeks" },
});

/* ── Step 1 ───────────────────────────────────────────────────────────── */

describe("provenance: every value remembers where it came from", () => {
  it("a website guess and an operator answer are different kinds of thing", () => {
    const obs = readObservations({ pillars: OPERATING.pillars, strategy: OPERATING.strategy, manifest: null });
    const industry = obs.find((o) => o.key === "industry")!;
    const product = obs.find((o) => o.key === "product_state")!;
    expect(industry.source).toBe("inferred");
    expect(product.source).toBe("operator");
  });

  it("a defaulted has_product is not an observation at all", () => {
    // `has_product` defaults to true in every producer, so a `true` records
    // nothing. Only an explicit `false` was written on purpose.
    const defaulted = readObservations({ pillars: { pillar_1: { has_product: true } }, strategy: null, manifest: null });
    expect(defaulted.filter((o) => o.key === "has_product")).toHaveLength(0);

    const deliberate = readObservations({ pillars: { pillar_1: { has_product: false } }, strategy: null, manifest: null });
    expect(deliberate.filter((o) => o.key === "has_product")).toHaveLength(1);
  });

  it("a goal the operator DID state is recorded as theirs", () => {
    // Regression: `stated` sits beside `goal` on the persisted Strategy, and
    // reading it from inside `goal` marked every real answer "assumed".
    const obs = readObservations({ pillars: null, strategy: OPERATING.strategy, manifest: null });
    expect(obs.find((o) => o.key === "goal_kpi")!.source).toBe("operator");
    expect(obs.find((o) => o.key === "goal_baseline")!.note).toMatch(/You said/);
    expect(buildCapabilityGraph("co", OPERATING).goalProvenance).toBe("stated");
  });

  it("a goal with no `stated` key is recorded as inferred, not as the operator's", () => {
    const obs = readObservations({
      pillars: null, strategy: null,
      manifest: { goal: { kpiId: "monthly_recurring_revenue", current: 2_500_000 } },
    });
    expect(obs.find((o) => o.key === "goal_kpi")!.source).toBe("inferred");
    expect(obs.find((o) => o.key === "goal_baseline")!.note).toMatch(/not from you/);
  });
});

describe("contradiction: the highest-signal question, for free", () => {
  it("catches the site and the operator disagreeing about the product", () => {
    const claims = toClaims(readObservations({
      pillars: { pillar_1: { has_product: false }, pillar_3: { product_state: "live_paying_customers" } },
      strategy: null, manifest: null,
    }));
    const c = findContradictions(claims);
    expect(c).toHaveLength(1);
    expect(c[0]!.key).toBe("has_product");
    expect(c[0]!.question).toMatch(/Which/);
  });

  it("compares against the operator's PRIMARY channel, not their last one", () => {
    // The card says "up to 3, primary first". Reading the last element made a
    // third choice look like the answer — this is ricoma's real shape.
    const claims = toClaims(readObservations({
      pillars: {
        pillar_1: { primary_acquisition_channel: "referral" },
        pillar_4: { lead_sources: ["inbound_ads_meta_google", "content_seo", "outbound_cold"] },
      },
      strategy: null, manifest: null,
    }));
    const ch = claims.find((c) => c.key === "acquisition_channel")!;
    expect(ch.value).toBe("paid");                 // primary, not "direct"
    expect(ch.alternates.map((a) => a.value)).toEqual(["content", "direct"]);
    expect(ch.disagreement.map((d) => d.value)).toEqual(["referral"]);
  });

  it("mode and channel are separate axes", () => {
    // `inbound_ads_meta_google` used to collapse to "paid" and the inbound
    // half was discarded — mode decides demand capture vs generation, which
    // is a different planning question from which tool to use.
    const obs = readObservations({
      pillars: { pillar_4: { lead_sources: ["inbound_ads_meta_google"] } },
      strategy: null, manifest: null,
    });
    expect(obs.find((o) => o.key === "acquisition_mode")!.value).toBe("inbound");
    expect(obs.find((o) => o.key === "acquisition_channel")!.value).toBe("paid");
  });

  it("a chip that does not determine mode says nothing about mode", () => {
    // A booth is inbound; prospecting the attendee list is outbound. `events`
    // cannot tell you which, and guessing would be the bug this file hunts.
    const obs = readObservations({
      pillars: { pillar_4: { lead_sources: ["events"] } }, strategy: null, manifest: null,
    });
    expect(obs.filter((o) => o.key === "acquisition_mode")).toHaveLength(0);
    expect(obs.find((o) => o.key === "acquisition_channel")!.value).toBe("events");
  });

  it("an inbound site against an outbound operator is a MODE contradiction", () => {
    const claims = toClaims(readObservations({
      pillars: {
        pillar_1: { primary_acquisition_channel: "inbound inquiries" },
        pillar_4: { lead_sources: ["outbound_cold"] },
      },
      strategy: null, manifest: null,
    }));
    const c = findContradictions(claims).find((x) => x.key === "acquisition_mode")!;
    expect(c.question).toMatch(/site reads as inbound/);
    expect(c.question).toMatch(/generating demand, or capturing it/);
  });

  it("the operator wins the value, and the loser is kept rather than discarded", () => {
    const claims = toClaims(readObservations({
      pillars: { pillar_1: { has_product: false }, pillar_3: { product_state: "live_paying_customers" } },
      strategy: null, manifest: null,
    }));
    const hp = claims.find((c) => c.key === "has_product")!;
    expect(hp.value).toBe(true);            // operator outranks inference
    expect(hp.source).toBe("operator");
    expect(hp.disagreement).toHaveLength(1); // and the site's view survives
  });

  it("a word the vocabulary lacks is RECORDED, never dropped", () => {
    // The previous behaviour was to drop anything unmapped, so a site saying
    // something the enum has no word for produced no observation and no
    // trace. A lookup miss is `unknown`, not `absent`.
    const claims = toClaims(readObservations({
      pillars: { pillar_1: { primary_acquisition_channel: "carrier pigeon" } },
      strategy: null, manifest: null,
    }));
    const gaps = findUnmapped(claims);
    expect(gaps.map((g) => g.key).sort()).toEqual(["acquisition_channel", "acquisition_mode"]);
    expect(gaps[0]!.raw).toBe("carrier pigeon");
    // Unmapped is not a contradiction — it needs the PRODUCT to grow a word,
    // not the operator to decide something.
    expect(findContradictions(claims)).toHaveLength(0);
  });

  it("an unmapped value never wins over a comparable one", () => {
    const claims = toClaims(readObservations({
      pillars: {
        pillar_1: { primary_acquisition_channel: "carrier pigeon" },
        pillar_4: { lead_sources: ["content_seo"] },
      },
      strategy: null, manifest: null,
    }));
    const ch = claims.find((c) => c.key === "acquisition_channel")!;
    expect(ch.value).toBe("content");
    expect(ch.unmapped).toHaveLength(1);
  });

  it("several channels from ONE source is a set, not a disagreement", () => {
    // An operator who names three channels has given one answer with three
    // parts. Asking them to pick would be the product misreading its own
    // question.
    const claims = toClaims(readObservations({
      pillars: { pillar_4: { lead_sources: ["outbound_cold", "content_seo", "referral_word_of_mouth"] } },
      strategy: null, manifest: null,
    }));
    expect(findContradictions(claims)).toHaveLength(0);
  });

  it("agreement is silent", () => {
    const claims = toClaims(readObservations({
      pillars: { pillar_1: { primary_acquisition_channel: "content seo" }, pillar_4: { lead_sources: ["content_seo"] } },
      strategy: null, manifest: null,
    }));
    expect(findContradictions(claims)).toHaveLength(0);
  });
});

/* ── Step 2 ───────────────────────────────────────────────────────────── */

describe("read-tracking: the dependency graph is observed, never declared", () => {
  it("records exactly the leaf paths a computation touched", () => {
    const { result, reads } = track(OPERATING, (s) => s.pillars?.pillar_4?.sales_motion);
    expect(result).toBe("assisted_demo");
    expect(reads).toContain("pillars.pillar_4.sales_motion");
    // Parents dropped: touching pillar_4 only to reach sales_motion is not a
    // dependency on the whole pillar.
    expect(reads).not.toContain("pillars.pillar_4");
  });

  it("a computation that reads nothing depends on nothing", () => {
    expect(track(OPERATING, () => 42).reads).toEqual([]);
  });

  it("a write from inside the planner is a loud failure, not a silent one", () => {
    expect(() => track({ a: { b: 1 } }, (s) => { (s as { a: { b: number } }).a.b = 2; })).toThrow(/must stay pure/);
  });

  it("invalidation runs both directions of containment", () => {
    const reads = ["pillars.pillar_4.sales_motion", "pillars.pillar_3.product_state"];
    expect(invalidatedBy(reads, ["pillars.pillar_4"])).toEqual(["pillars.pillar_4.sales_motion"]);
    expect(invalidatedBy(reads, ["pillars.pillar_3.product_state"])).toEqual(["pillars.pillar_3.product_state"]);
    expect(invalidatedBy(reads, ["strategy.goal"])).toEqual([]);
  });

  it("diffKeys names the paths that moved", () => {
    const after = JSON.parse(JSON.stringify(OPERATING)) as CapabilitySources;
    after.pillars!.pillar_4!.sales_motion = "self_serve_plg";
    expect(diffKeys(OPERATING, after)).toEqual(["pillars.pillar_4.sales_motion"]);
  });
});

/* ── Step 3 ───────────────────────────────────────────────────────────── */

describe("counterfactual: value is computed, never scored", () => {
  it("a question already answered is worth zero, not merely low", () => {
    // OPERATING already states product_state, sales_motion and lead_sources.
    // Asking again buys nothing, however much those fields would move.
    const ranked = valueOfQuestions(OPERATING);
    for (const key of ["pillar_3.product_state", "pillar_4.sales_motion", "pillar_4.lead_sources"]) {
      expect(ranked.find((q) => q.key === key)!.value, `${key} was already answered`).toBe(0);
    }
    // What is left is the connectors — and they are asked OF connectors.
    expect(nextQuestion(OPERATING)!.answerer).toBe("connector");
  });

  it("settles when nothing left would change the organization", () => {
    const everything = { ...OPERATING, vault: [
      { connectorId: "mixpanel", status: "vaulted_valid" as const },
      { connectorId: "hubspot", status: "vaulted_valid" as const },
    ] };
    expect(valueOfQuestions(everything).every((q) => q.value === 0)).toBe(true);
    expect(nextQuestion(everything)).toBeNull();
  });

  it("ranks by how many capabilities actually move, and names them", () => {
    const ranked = valueOfQuestions(OPERATING);
    const top = ranked[0]!;
    expect(top.value).toBeGreaterThan(0);
    expect(top.changes.length).toBe(top.value);
    // The question can justify itself by showing both outcomes rather than
    // asserting importance.
    expect(top.outcomes.length).toBeGreaterThan(1);
  });

  it("product state is the highest-value question, because six capabilities key on it", () => {
    expect(valueOfQuestions(src({}))[0]!.key).toBe("pillar_3.product_state");
  });

  it("connector questions are routed to connectors, not to the operator", () => {
    const q = nextQuestion(src({}), { answerer: "connector" });
    expect(q?.answerer).toBe("connector");
    expect(q?.question).toMatch(/Connect/);
  });

  it("every candidate's answers come from a shipped enum, never from a model", () => {
    for (const c of CANDIDATES) expect(c.values.length).toBeGreaterThan(1);
  });
});

/* ── Step 4 ───────────────────────────────────────────────────────────── */

describe("transformation: the target is stated, the route is feasible", () => {
  const graph = buildCapabilityGraph("co", OPERATING);

  it("derives what the goal requires and what is missing", () => {
    const t = compileTransformation(graph, { kpiId: "monthly_recurring_revenue", days: 90 });
    expect(t.required.length).toBeGreaterThan(0);
    expect(t.have).toContain("can_take_money");
    expect(t.have).toContain("can_reach_new_buyers");
    // Growing a number needs more than having it: repeatable reach, and some
    // way to read the number at all.
    expect(t.gap.map((g) => g.capability)).toContain("reach_is_repeatable");
    expect(t.gap.map((g) => g.capability)).toContain("can_measure_the_goal_kpi");
  });

  it("without a stated goal there is no target and it says so", () => {
    const t = compileTransformation(graph, null);
    expect(t.goal).toBeNull();
    expect(t.notes.join()).toMatch(/No goal has been stated/);
  });

  it("an unconfirmed goal is flagged before anything is executed against it", () => {
    const band = buildCapabilityGraph("co", src({
      manifest: { goal: { kpiId: "monthly_recurring_revenue", current: 45_000, stated: false } },
    }));
    const t = compileTransformation(band, { kpiId: "monthly_recurring_revenue", days: 90 });
    expect(t.notes.join()).toMatch(/not stated by the operator/);
  });

  it("only offers strategies the organization can run today", () => {
    // Paid acquisition needs attribution, which nothing here has observed.
    const t = compileTransformation(graph, { kpiId: "monthly_recurring_revenue", days: 90 });
    const reach = t.gap.find((g) => g.capability === "can_reach_new_buyers");
    if (reach) expect(reach.strategies.map((s) => s.id)).not.toContain("paid_acquisition");
  });

  it("the horizon rules routes out — feasible, not merely shortest", () => {
    const idea = buildCapabilityGraph("co", src({ pillars: { pillar_3: { product_state: "idea_only" } } }));
    const long = compileTransformation(idea, { kpiId: "monthly_recurring_revenue", days: 90 });
    const short = compileTransformation(idea, { kpiId: "monthly_recurring_revenue", days: 30 });
    const mvpIn = (t: ReturnType<typeof compileTransformation>) =>
      t.gap.find((g) => g.capability === "has_something_to_sell")?.strategies.map((s) => s.id) ?? [];
    expect(mvpIn(long)).toContain("mvp_build");     // 60 days fits in 90
    expect(mvpIn(short)).not.toContain("mvp_build"); // and not in 30
    expect(short.notes.join()).toMatch(/horizon is too short|No approach fits/);
  });

  it("sequences the gap in dependency order", () => {
    const idea = buildCapabilityGraph("co", src({ pillars: { pillar_3: { product_state: "idea_only" } } }));
    const t = compileTransformation(idea, { kpiId: "monthly_recurring_revenue", days: 365 });
    const seq = t.sequence;
    expect(seq.indexOf("has_something_to_sell")).toBeLessThan(seq.indexOf("has_a_priced_offer"));
    expect(seq.indexOf("has_a_priced_offer")).toBeLessThan(seq.indexOf("can_take_money"));
  });

  it("says when the constraint is unobserved rather than optimizing what it can see", () => {
    // A goal whose requirements are mostly things no connector reads.
    const t = compileTransformation(buildCapabilityGraph("co", src({})), { kpiId: "nrr", days: 90 });
    expect(t.constraintUnknown).toBe(true);
    expect(t.notes.join()).toMatch(/unobserved rather than known-absent/);
  });
});

/* ── Step 6 ───────────────────────────────────────────────────────────── */

describe("recompile: bounded, caused, and narrated", () => {
  const goal = { kpiId: "monthly_recurring_revenue", days: 90 };

  it("no change means no rebuild — the loop does not churn", () => {
    const r = recompile("co", OPERATING, OPERATING, goal);
    expect(r.changedBeliefs).toEqual([]);
    expect(r.narration).toBeNull();
    expect(shouldRebuild(r)).toBe(false);
  });

  it("a belief that moves no capability does not trigger a rebuild", () => {
    const after = JSON.parse(JSON.stringify(OPERATING)) as CapabilitySources;
    after.pillars!.pillar_1!.industry_hint = "fintech";
    const r = recompile("co", OPERATING, after, goal);
    expect(r.changedBeliefs).toEqual(["pillars.pillar_1.industry_hint"]);
    expect(r.changedCapabilities).toEqual([]);
    expect(shouldRebuild(r)).toBe(false);
  });

  it("wiring a connector closes capabilities and says which", () => {
    const after = { ...OPERATING, vault: [{ connectorId: "hubspot", status: "vaulted_valid" as const }] };
    const r = recompile("co", OPERATING, after, goal);
    expect(r.closed).toContain("has_a_system_of_record");
    expect(r.closed).toContain("can_see_the_pipeline");
    expect(r.narration).toMatch(/now in place/);
    expect(shouldRebuild(r)).toBe(true);
  });

  it("regression is reported, not silently dropped", () => {
    // A loop that only looks for progress misses the one thing worth acting on.
    const before = { ...OPERATING, vault: [{ connectorId: "hubspot", status: "vaulted_valid" as const }] };
    const r = recompile("co", before, OPERATING, goal);
    expect(r.regressed).toContain("has_a_system_of_record");
    expect(r.narration).toMatch(/no longer holds/);
  });

  it("names when the binding constraint moves", () => {
    const before = buildCapabilityGraph("co", src({ pillars: { pillar_3: { product_state: "idea_only" } } }));
    const after = buildCapabilityGraph("co", OPERATING);
    expect(compileTransformation(before, goal).bindingConstraint)
      .not.toBe(compileTransformation(after, goal).bindingConstraint);
  });
});

/* ── Audit regressions ────────────────────────────────────────────────── */

describe("the GTM tag honours the operator's ranking", () => {
  it("the PRIMARY lead source decides, not set membership", async () => {
    // deriveGtm asked ".includes()" over an unordered set AND refused to
    // answer at all past two selections, so an operator who used the full
    // three-chip allowance got a different agent roster than one who named
    // the same primary and stopped at two.
    const { __testDeriveGtm } = await import("../src/selection/scorer.js");
    const mk = (lead_sources: string[]) => ({
      pillar_responses: { pillar_4: { sales_motion: "self_serve_plg", lead_sources } },
    }) as never;

    expect(__testDeriveGtm(mk(["inbound_ads_meta_google", "content_seo"]))).toBe("paid-led");
    // Same primary, one more chip — must not change the answer.
    expect(__testDeriveGtm(mk(["inbound_ads_meta_google", "content_seo", "outbound_cold"]))).toBe("paid-led");
    // Different primary, same membership — must change it.
    expect(__testDeriveGtm(mk(["content_seo", "inbound_ads_meta_google"]))).toBe("community-led");
  });
});

describe("the template stage axis actually matches something", () => {
  it("annualises the goal's own baseline instead of casting a band string", async () => {
    // `Stage` is an ARR ladder; every producer emits MRR ids. The old body
    // cast the string straight in, so it matched no affinity and scored zero
    // on a 0.20-weight axis — silently, forever.
    const { __testDeriveStage } = await import("../src/selection/scorer.js");
    const mk = (goal: unknown, stage?: string) =>
      ({ pillar_responses: { pillar_3: stage ? { stage } : {} }, goal }) as never;

    expect(__testDeriveStage(mk({ kpiId: "monthly_recurring_revenue", current: 12_000 }))).toBe("100k_500k_arr");
    expect(__testDeriveStage(mk({ kpiId: "monthly_recurring_revenue", current: 2_500_000 }))).toBe("10m_plus_arr");
    expect(__testDeriveStage(mk({ kpiId: "monthly_recurring_revenue", current: 500 }))).toBe("0_10k_arr");
  });

  it("a non-revenue baseline is never read as dollars", () => {
    // An activation rate of 22 is not $22/mo, and annualising it would place
    // a real company in the wrong band entirely.
    return import("../src/selection/scorer.js").then(({ __testDeriveStage }) => {
      const m = { pillar_responses: { pillar_3: {} }, goal: { kpiId: "activation_rate", current: 22 } } as never;
      expect(__testDeriveStage(m)).toBeNull();
    });
  });

  it("an ambiguous band skips the axis rather than guessing", async () => {
    const { __testDeriveStage } = await import("../src/selection/scorer.js");
    const m = (stage: string) => ({ pillar_responses: { pillar_3: { stage } } }) as never;
    // 0-10k MRR is 0-120k ARR — three ARR bands. Null is the honest answer.
    expect(__testDeriveStage(m("less_than_10k_mrr"))).toBeNull();
    expect(__testDeriveStage(m("pre_launch"))).toBe("pre_product");
  });
});
