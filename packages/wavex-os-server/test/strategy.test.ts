/** The stated goal — the loop's fixed half, and the one thing that must
 *  never be invented.
 *
 *  Before this existed, `GOALS_BY_STAGE` mapped a revenue BRACKET to
 *  hardcoded numbers and that guess became the approved plan, the seeded
 *  work goal, and the fleet's founding directive. Two companies eight times
 *  apart in size picked the same bracket and got identical targets. These
 *  tests exist to keep that from coming back: the operator's answer wins,
 *  and where no answer exists the fallback must SAY it is a fallback. */

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Fastify, { type FastifyInstance } from "fastify";
import { synthesizeGoal } from "../src/lib/goal-synthesis.js";

let tempDir: string;
let app: FastifyInstance;
const CO = "strategy-co";
const BASE = "/wavex-os/onboarding/strategy";

const PILLARS = {
  schema_version: 1,
  started_at: "2026-08-01T00:00:00.000Z",
  pillar_1: { org_name: CO, company_context: "fixture co", enrichment_status: "manual_capture", has_product: true, industry_hint: "b2b_saas", business_model_hint: "subscription" },
  pillar_2: { claude_plan: "max_20x", verified: true },
  pillar_3: { product_state: "live_paying_customers", stage: "10k_100k_mrr", kpi_snapshot_initial: { mrr: 12_000 } },
  pillar_4: { sales_motion: "assisted_demo", lead_sources: ["outbound_cold"], gtm_profile_enum: "OUTBOUND_ASSISTED" },
  pillar_5: { comm_channel: "email", urgency_routing: "daily_digest" },
};
const CONNECTOR = { version: 1, required: [], suggested: [], deferred: [], blocked_on_manual_approval: [] };
const onboardingDir = () => join(tempDir, "instances/default/companies", CO, "onboarding");

beforeEach(async () => {
  tempDir = mkdtempSync(join(tmpdir(), "strategy-test-"));
  process.env.WAVEX_OS_STATE_DIR = tempDir;
  process.env.PAPERCLIP_DATA_DIR = tempDir;
  process.env.WAVEX_AUTH_MODE = "dev";
  process.env.WAVEX_COMPOSIO_DISABLED = "1";
  mkdirSync(onboardingDir(), { recursive: true });
  writeFileSync(join(onboardingDir(), "pillar_responses.json"), JSON.stringify(PILLARS));
  writeFileSync(join(onboardingDir(), "connector_manifest.json"), JSON.stringify(CONNECTOR));
  const { registerWavexOsRoutes } = await import("../src/index.js");
  app = Fastify({ logger: false });
  registerWavexOsRoutes(app);
  await app.ready();
});

afterEach(async () => {
  await app.close();
  for (const k of ["WAVEX_OS_STATE_DIR", "PAPERCLIP_DATA_DIR", "WAVEX_AUTH_MODE", "WAVEX_COMPOSIO_DISABLED"]) delete process.env[k];
  rmSync(tempDir, { recursive: true, force: true });
});

const state = (body: Record<string, unknown>) =>
  app.inject({ method: "POST", url: BASE, payload: { companyId: CO, ...body } });

const GOAL = { kpiId: "monthly_recurring_revenue", current: 12_000, target: 25_000, days: 120 };
/** The persisted RECORD. `stated` is a sibling of `goal`, and synthesizeGoal
 *  now takes the record whole precisely so a caller cannot pass the goal and
 *  strand the flag — the shape this fixture used to have. */
const REC = (over: Record<string, unknown> = {}) => ({ goal: GOAL, stated: true, ...over });

describe("synthesizeGoal — the stated goal always wins", () => {
  it("returns the operator's goal verbatim, marked stated", () => {
    const g = synthesizeGoal(PILLARS.pillar_3, "operating", REC());
    expect(g).toEqual({ ...GOAL, stated: true });
  });

  it("the band NEVER overrides a stated goal, even when they disagree wildly", () => {
    // The bracket would say 45,000 → 100,000. The operator says 12,000 →
    // 25,000. This is the exact case that shipped identical plans to
    // companies eight times apart in size.
    const g = synthesizeGoal(PILLARS.pillar_3, "operating", REC());
    expect(g.current).toBe(12_000);
    expect(g.target).toBe(25_000);
    expect(g.days).toBe(120);
  });

  it("a non-revenue goal survives — MRR is no longer assumed", () => {
    const g = synthesizeGoal(PILLARS.pillar_3, "operating", REC({ goal: { ...GOAL, kpiId: "activation_rate", current: 22, target: 40 } }));
    expect(g.kpiId).toBe("activation_rate");
  });

  it("a DECLINED goal is not laundered into a stated one", () => {
    // Regression, and the sibling bug's twin one layer up. `readStrategy`
    // returns `{ goal, stated }`; every call site used to pass `.goal`, so
    // presence alone produced `stated: true` — and that stamps the SIGNED
    // manifest, the founding directive, and CONTEXT.md with an endorsement
    // the operator explicitly withheld.
    const g = synthesizeGoal(PILLARS.pillar_3, "operating", REC({ stated: false }));
    expect(g.stated).toBe(false);
    expect(g.current).toBe(12_000);   // still THEIR numbers — only the claim changes
  });

  it("with no stated goal the band stands in AND says so", () => {
    const g = synthesizeGoal(PILLARS.pillar_3, "operating", null);
    expect(g.stated).toBe(false);
    expect(g.kpiId).toBe("monthly_recurring_revenue");
    expect(g.current).toBe(45_000);       // the bracket median — a guess
  });

  it("pre-product starts at zero, still marked unstated", () => {
    const g = synthesizeGoal({ product_state: "idea_only" }, "pre_product", null);
    expect(g).toMatchObject({ current: 0, target: 5_000, days: 90, stated: false });
  });
});

describe("POST /strategy", () => {
  it("persists the goal and reads it back", async () => {
    const r = await state({ goal: GOAL, bottleneck: "onboarding takes three weeks", secondaryKpis: ["cac"] });
    expect(r.statusCode).toBe(200);
    expect(r.json().strategy).toMatchObject({ goal: GOAL, bottleneck: "onboarding takes three weeks", stated: true });

    const got = await app.inject({ method: "GET", url: `${BASE}?companyId=${CO}` });
    expect(got.json().strategy.goal).toEqual(GOAL);
  });

  it("rejects a KPI the runtime cannot name, rather than coercing it", async () => {
    // A goal measured by an unknown KPI is a goal nothing will ever measure
    // against — the failure mode the stage/motion enum mismatches produced.
    const r = await state({ goal: { ...GOAL, kpiId: "vibes" } });
    expect(r.statusCode).toBe(400);
    expect(r.json().allowed).toContain("monthly_recurring_revenue");
  });

  it("accepts the short alias and stores the canonical id", async () => {
    const r = await state({ goal: { ...GOAL, kpiId: "mrr" } });
    expect(r.statusCode).toBe(200);
    expect(r.json().strategy.goal.kpiId).toBe("monthly_recurring_revenue");
  });

  it("caps secondary KPIs at two", async () => {
    const r = await state({ goal: GOAL, secondaryKpis: ["cac", "nrr", "grr"] });
    expect(r.statusCode).toBe(400);
  });

  it("an explicit decline is recorded as unstated, not as a decision", async () => {
    const r = await state({ goal: GOAL, stated: false });
    expect(r.json().strategy.stated).toBe(false);
  });
});

describe("the plan carries the stated goal end to end", () => {
  it("the roadmap step's goal is the operator's, not the bracket's", async () => {
    await state({ goal: GOAL });
    const run = (await app.inject({
      method: "POST", url: "/wavex-os/onboarding/plan-assembly/start",
      payload: { companyId: CO, skipInference: true, research: false },
    })).json().run;

    const roadmap = run.steps.find((s: { id: string }) => s.id === "roadmap");
    expect(roadmap.payload.goal).toMatchObject({ current: 12_000, target: 25_000, days: 120, stated: true });
  });

  it("without a strategy the roadmap goal is the band, and admits it", async () => {
    const run = (await app.inject({
      method: "POST", url: "/wavex-os/onboarding/plan-assembly/start",
      payload: { companyId: CO, skipInference: true, research: false },
    })).json().run;

    const roadmap = run.steps.find((s: { id: string }) => s.id === "roadmap");
    expect(roadmap.payload.goal.stated).toBe(false);
    expect(roadmap.payload.goal.current).toBe(45_000);
  });
});
