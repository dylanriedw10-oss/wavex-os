/** The capability read-model — step 0 of the reasoning architecture.
 *
 *  These tests pin the two things that make the model worth anything:
 *
 *  1. It DISCRIMINATES. Four differently-shaped organizations must produce
 *     four different graphs. If they don't, the ontology is decoration and
 *     the cheapest possible moment to learn that is here.
 *
 *  2. It never says more than it knows. Most of these predicates CANNOT
 *     express absence with today's schema, and the model must return `unknown`
 *     for them rather than guessing — `absent` means "we know it isn't so",
 *     and collapsing that into "nothing told us" is the exact bug that made a
 *     synthesised goal indistinguishable from a chosen one.
 *
 *  Every derivation rule below was ground-truthed against the shipped field
 *  names and enums rather than written from memory, because this codebase has
 *  twice shipped a read of a field that does not exist. */

import { describe, expect, it } from "vitest";
import {
  buildCapabilityGraph, deriveCapabilities, CAPABILITY_IDS,
  type CapabilityId, type CapabilitySources, type Presence,
} from "../src/lib/capability-model.js";

const EMPTY: CapabilitySources = {
  pillars: null, manifest: null, swarm: null, workflow: null, strategy: null, vault: null,
};

const src = (over: Partial<CapabilitySources>): CapabilitySources => ({ ...EMPTY, ...over });

/** Four organizations, deliberately far apart on the spectrum. */
const IDEA = src({
  pillars: { pillar_1: { has_product: false }, pillar_3: { product_state: "idea_only" },
             pillar_4: { lead_sources: ["none_yet"], gtm_profile_enum: "BOOTSTRAP_NO_GTM" } },
});
const BUILDER = src({
  pillars: { pillar_1: { has_product: true }, pillar_3: { product_state: "built_not_selling" },
             pillar_4: { lead_sources: ["content_seo"], sales_motion: "assisted_demo" } },
});
const OPERATING = src({
  pillars: { pillar_1: { has_product: true }, pillar_3: { product_state: "live_paying_customers" },
             pillar_4: { lead_sources: ["outbound_cold", "referral_word_of_mouth"], sales_motion: "assisted_demo" } },
  manifest: { goal: { kpiId: "monthly_recurring_revenue", current: 12_000, target: 25_000, days: 90, stated: true } },
});
const PLG_INSTRUMENTED = src({
  pillars: { pillar_1: { has_product: true }, pillar_3: { product_state: "live_paying_customers" },
             pillar_4: { lead_sources: ["product_led_viral"], sales_motion: "self_serve_plg" } },
  vault: [
    { connectorId: "mixpanel", status: "vaulted_valid" },
    { connectorId: "hubspot", status: "vaulted_valid" },
  ],
});

const byId = (s: CapabilitySources) =>
  new Map(deriveCapabilities(s).map((c) => [c.id, c] as const));
const presenceOf = (s: CapabilitySources, id: CapabilityId): Presence => byId(s).get(id)!.presence;
const shape = (s: CapabilitySources) => deriveCapabilities(s).map((c) => c.presence).join("");

describe("the model discriminates — the question step 0 exists to answer", () => {
  it("four differently-shaped organizations produce four different graphs", () => {
    const shapes = [IDEA, BUILDER, OPERATING, PLG_INSTRUMENTED].map(shape);
    expect(new Set(shapes).size, `graphs collapsed to ${new Set(shapes).size} distinct shapes`).toBe(4);
  });

  it("an idea and an operating company disagree on most of what can be known", () => {
    const a = byId(IDEA), b = byId(OPERATING);
    const differing = CAPABILITY_IDS.filter((id) => a.get(id)!.presence !== b.get(id)!.presence);
    expect(differing.length).toBeGreaterThanOrEqual(5);
  });

  it("wiring connectors is what moves capabilities out of unknown", () => {
    // The same company, twice — the only difference is that something is
    // connected. This is the entire argument for connector reads, as data.
    const dark = byId(PLG_INSTRUMENTED);
    const blind = byId(src({ ...PLG_INSTRUMENTED, vault: null }));
    expect(dark.get("can_attribute_channel")!.presence).toBe("present");
    expect(blind.get("can_attribute_channel")!.presence).toBe("unknown");
    expect(dark.get("has_a_system_of_record")!.presence).toBe("present");
    expect(blind.get("has_a_system_of_record")!.presence).toBe("unknown");
  });
});

describe("it never claims more than it knows", () => {
  it("an empty company is entirely unknown, never absent", () => {
    const v = deriveCapabilities(EMPTY);
    // `can_measure_the_goal_kpi` is the one honest exception: it is absent for
    // everyone because no connector read exists anywhere in the product. That
    // is a code-level impossibility, not missing data.
    const absent = v.filter((c) => c.presence === "absent").map((c) => c.id);
    expect(absent).toEqual(["can_measure_the_goal_kpi"]);
  });

  it("skipping a connector never reads as absence", () => {
    // Skipping records a decision about WaveX's ACCESS, not about whether the
    // company has the thing. Conflating them would tell the planner a
    // capability is missing when it may be thriving unobserved.
    const skipped = byId(src({ vault: [{ connectorId: "hubspot", status: "skipped" }] }));
    expect(skipped.get("has_a_system_of_record")!.presence).toBe("unknown");
    expect(skipped.get("can_see_the_pipeline")!.presence).toBe("unknown");
  });

  it("an unwired-but-suggested connector is unknown, not absent", () => {
    const pending = byId(src({ vault: [{ connectorId: "mixpanel", status: "pending" }] }));
    expect(pending.get("can_attribute_channel")!.presence).toBe("unknown");
  });

  it("a human in the sales loop does not prove the founder is required", () => {
    // "assisted_demo" says a person closes. It does not say WHICH person, so
    // absence is unreachable and the model must say unknown.
    const c = byId(OPERATING).get("converts_without_founder")!;
    expect(c.presence).toBe("unknown");
    expect(c.absenceUnreachable).toBe(true);
  });

  it("has_product alone never proves a product — it defaults to true everywhere", () => {
    const presumed = src({ pillars: { pillar_1: { has_product: true } } });
    expect(presenceOf(presumed, "has_something_to_sell")).toBe("unknown");
  });

  it("a product state in the operator's own words carries no verdict", () => {
    const other = src({ pillars: { pillar_3: { product_state: "other", product_state_other: "a private beta" } } });
    expect(presenceOf(other, "has_something_to_sell")).toBe("unknown");
  });
});

describe("the holes in the ontology are reported, not hidden", () => {
  it("five predicates have no signal on disk at all", () => {
    const none = deriveCapabilities(OPERATING).filter((c) => c.noSignal).map((c) => c.id);
    expect(none.sort()).toEqual([
      "can_deliver_repeatably", "can_support_customers",
      "knows_why_customers_leave", "reach_is_repeatable", "revenue_repeats",
    ]);
  });

  it("no connected system can read the goal's KPI, for anyone", () => {
    for (const s of [IDEA, BUILDER, OPERATING, PLG_INSTRUMENTED]) {
      expect(presenceOf(s, "can_measure_the_goal_kpi")).toBe("absent");
    }
  });

  it("every verdict can explain itself", () => {
    // A verdict that cannot say why must never reach the canvas.
    for (const c of deriveCapabilities(OPERATING)) {
      expect(c.because.length, `${c.id} has no explanation`).toBeGreaterThan(20);
    }
  });
});

describe("goal provenance is read strictly", () => {
  it("a stated goal is stated — read from where the route actually writes it", () => {
    const stated = src({ strategy: { goal: { kpiId: "activation_rate", current: 22 }, stated: true } });
    expect(buildCapabilityGraph("co", stated).goalProvenance).toBe("stated");
  });

  it("a goal with no `stated` key is UNKNOWN provenance, not stated", () => {
    // The live company on disk carries a goal whose numbers are byte-identical
    // to the synthesis table's stage band and no `stated` key at all. The
    // display layer reads missing-as-true; this model must not, or it reports
    // a fabrication as a decision.
    const legacy = src({ manifest: { goal: { kpiId: "monthly_recurring_revenue", current: 2_500_000, target: 5_000_000, days: 90 } } });
    expect(buildCapabilityGraph("co", legacy).goalProvenance).toBe("unknown");
  });

  it("an explicit fallback says so", () => {
    const band = src({ manifest: { goal: { kpiId: "monthly_recurring_revenue", current: 45_000, target: 100_000, days: 90, stated: false } } });
    expect(buildCapabilityGraph("co", band).goalProvenance).toBe("fallback");
  });
});

describe("the tally is counts, never a score", () => {
  it("counts every capability exactly once and offers no denominator", () => {
    const g = buildCapabilityGraph("co", OPERATING);
    expect(g.tally.present + g.tally.absent + g.tally.unknown).toBe(CAPABILITY_IDS.length);
    expect(g).not.toHaveProperty("completeness");
    expect(g).not.toHaveProperty("score");
  });
});
