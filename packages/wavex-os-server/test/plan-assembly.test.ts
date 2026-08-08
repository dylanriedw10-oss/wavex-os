/** Plan assembly — Phase 3 as an event log over the deterministic pipeline.
 *  Everything here runs skipInference (model-free, milliseconds); the T2
 *  tail is covered by the stale/resume mechanics, not by spawning a model. */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Fastify, { type FastifyInstance } from "fastify";

let tempDir: string;
let app: FastifyInstance;
const CO = "plan-co";
const BASE = "/wavex-os/onboarding/plan-assembly";

function onboardingDir(): string {
  return join(tempDir, "instances/default/companies", CO, "onboarding");
}

/** Pillar responses on disk — pre-product SaaS so the MVP chain appears.
 *  schema_version + started_at are REQUIRED: the vendored loader returns
 *  empty responses without them (session.ts:48). */
const PILLARS = {
  schema_version: 1,
  started_at: "2026-08-01T00:00:00.000Z",
  pillar_1: { org_name: CO, company_context: "fixture co", enrichment_status: "manual_capture", has_product: false, industry_hint: "b2b_saas", business_model_hint: "subscription" },
  pillar_2: { claude_plan: "max_20x", verified: true },
  // `pre_product` — the stage a pre-product company can actually reach in the
  // UI. This fixture used to pair `idea_only` with a REVENUE bracket, a
  // combination Pillar3PromptCard cannot produce (it swaps the chip set on
  // exactly this predicate).
  pillar_3: { product_state: "idea_only", stage: "pre_product", kpi_snapshot_initial: { mrr: 0 } },
  pillar_4: { sales_motion: "assisted_demo", lead_sources: ["outbound_cold"], gtm_profile_enum: "OUTBOUND_ASSISTED" },
  pillar_5: { comm_channel: "email", urgency_routing: "daily_digest" },
};

const CONNECTOR = { version: 1, required: [], suggested: [], deferred: [], blocked_on_manual_approval: [] };

beforeEach(async () => {
  tempDir = mkdtempSync(join(tmpdir(), "plan-assembly-test-"));
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
  delete process.env.WAVEX_OS_STATE_DIR;
  delete process.env.PAPERCLIP_DATA_DIR;
  delete process.env.WAVEX_AUTH_MODE;
  delete process.env.WAVEX_COMPOSIO_DISABLED;
  rmSync(tempDir, { recursive: true, force: true });
});

/** `research: false` by default here on purpose: this suite is the
 *  DETERMINISTIC-BASELINE regression guard, and every assertion in it is
 *  about the four model-free steps. Research has its own suite
 *  (plan-research.test.ts) where the async path is the subject. */
async function start(body: Record<string, unknown> = {}) {
  const r = await app.inject({
    method: "POST", url: `${BASE}/start`,
    payload: { companyId: CO, skipInference: true, research: false, ...body },
  });
  return r;
}

describe("POST plan-assembly/start (deterministic)", () => {
  it("409s without a connector manifest — the phase vocabulary", async () => {
    rmSync(join(onboardingDir(), "connector_manifest.json"));
    const r = await start();
    expect(r.statusCode).toBe(409);
  });

  it("emits the four steps in canonical order with real payloads", async () => {
    const r = await start();
    expect(r.statusCode).toBe(200);
    const { run } = r.json();
    expect(run.status).toBe("complete");
    expect(run.steps.map((s: { id: string }) => s.id)).toEqual(["roadmap", "kpis", "departments", "dependencies"]);
    // `seq` is a constant of the step's IDENTITY, not its array position, so
    // these start at 1: slot 0 belongs to `research` forever, and the hole is
    // exactly what "research did not run" should look like. Asserting the
    // literals (rather than STEP_SEQ) is deliberate — this is a wire contract,
    // and a test that imported the table would agree with any renumbering.
    expect(run.steps.map((s: { seq: number }) => s.seq)).toEqual([1, 2, 3, 4]);

    const [roadmap, kpis, departments, dependencies] = run.steps;
    // roadmap: the synthesized goal (pre-product band) + a checklist with
    // the MVP chain AND its dependency edges.
    expect(roadmap.payload.goal.kpiId).toBe("monthly_recurring_revenue");
    expect(roadmap.payload.goal.current).toBe(0);
    const mvp = roadmap.payload.checklist.filter((c: { kind: string }) => c.kind === "mvp");
    expect(mvp.length).toBeGreaterThanOrEqual(3);
    const build = mvp.find((c: { id: string }) => c.id === "mvp-build");
    expect(build.dependsOn).toContain("mvp-spec");

    // kpis: canonical ids only — the short "mrr" never crosses the wire.
    const ids = kpis.payload.kpis.map((k: { kpiId: string }) => k.kpiId);
    expect(ids).toContain("monthly_recurring_revenue");
    expect(ids).not.toContain("mrr");

    // departments: active chiefs only, counted honestly.
    expect(departments.payload.departments.length).toBeGreaterThan(0);
    expect(departments.payload.counts.active).toBeGreaterThan(0);
    for (const d of departments.payload.departments) {
      expect(d.slot.includes(".")).toBe(false);
    }

    // dependencies: bundles filtered to what the swarm can actually run.
    expect(Array.isArray(dependencies.payload.bundles)).toBe(true);
  });

  it("persists the run AND the manifests — plan assembly IS generation", async () => {
    await start();
    expect(existsSync(join(onboardingDir(), "plan_assembly.json"))).toBe(true);
    expect(existsSync(join(onboardingDir(), "swarm_manifest.json"))).toBe(true);
    expect(existsSync(join(onboardingDir(), "workflow_manifest.json"))).toBe(true);
    // The departments step mirrors the swarm on disk.
    const run = JSON.parse(readFileSync(join(onboardingDir(), "plan_assembly.json"), "utf8"));
    const swarm = JSON.parse(readFileSync(join(onboardingDir(), "swarm_manifest.json"), "utf8"));
    const stepDepts = run.steps[2].payload.departments.map((d: { slot: string }) => d.slot).sort();
    const swarmChiefs = Object.entries(swarm.agents as Record<string, { status: string }>)
      .filter(([slot, a]) => !slot.startsWith("ceo.") && !slot.includes(".") && a.status === "active")
      .map(([slot]) => slot).sort();
    expect(stepDepts).toEqual(swarmChiefs);
  });

  it("is idempotent — a second start returns the same run", async () => {
    const first = (await start()).json().run;
    const second = (await start()).json().run;
    expect(second.runId).toBe(first.runId);
  });

  it("GET replays; a refining run with no worker reports stale_refinement", async () => {
    await start();
    // Simulate a server that died mid-tail: rewrite status to refining.
    const path = join(onboardingDir(), "plan_assembly.json");
    const run = JSON.parse(readFileSync(path, "utf8"));
    run.status = "refining";
    writeFileSync(path, JSON.stringify(run));

    const r = await app.inject({ method: "GET", url: `${BASE}?companyId=${CO}` });
    expect(r.statusCode).toBe(200);
    expect(r.json().run.status).toBe("stale_refinement");
  });

  it("a product company (has_product) gets no MVP chain", async () => {
    const pillars = structuredClone(PILLARS);
    pillars.pillar_1.has_product = true;
    // `live_paying_customers` — the real ProductState. This fixture used to
    // say "live_paying", which is not a member of the enum; it passed only
    // because the old pre-product test was a negative check, so an
    // unrecognized value silently counted as "has a product".
    pillars.pillar_3.product_state = "live_paying_customers";
    pillars.pillar_3.stage = "10k_100k_mrr";
    writeFileSync(join(onboardingDir(), "pillar_responses.json"), JSON.stringify(pillars));
    const r = await start();
    const run = r.json().run;
    const roadmap = run.steps[0];
    expect(roadmap.payload.checklist.every((c: { kind: string }) => c.kind !== "mvp")).toBe(true);
    // …and the goal is the stage band, not the pre-product zero.
    expect(roadmap.payload.goal.current).toBeGreaterThan(0);
    expect(run.placement.rung).toBe("operating");
    expect(run.placement.decidedBy).toBe("product_state");
  });

  /* ---- placement: the four-way disagreement this module closed ---- */

  /** THE REGRESSION TEST. This exact input made the server generate an MVP
   *  checklist and seed a real "Ship the MVP" goal with dependency edges,
   *  while the client's own `has_product` rule sent the operator straight
   *  past the MVP stage into a 2.6s motion. The work existed and was never
   *  shown. One rung now answers for both sides. */
  it("has_product:true + prototype_mvp still gets build work — the bug that shipped", async () => {
    const pillars = structuredClone(PILLARS);
    pillars.pillar_1.has_product = true;
    pillars.pillar_3.product_state = "prototype_mvp";
    writeFileSync(join(onboardingDir(), "pillar_responses.json"), JSON.stringify(pillars));
    const run = (await start()).json().run;

    expect(run.placement.rung).toBe("informal");
    const mvp = run.steps[0].payload.checklist.filter((c: { kind: string }) => c.kind === "mvp");
    expect(mvp.length).toBeGreaterThan(0);
    // The client asks the checklist, not `has_product` — so the presence of
    // these items IS the instruction to start Birth at the MVP stage.
    expect(run.steps[0].payload.goal.current).toBe(0);
  });

  it("the informal chain is instrument → positioning → validate, re-pointed past the dropped links", async () => {
    const pillars = structuredClone(PILLARS);
    pillars.pillar_3.product_state = "built_not_selling";
    writeFileSync(join(onboardingDir(), "pillar_responses.json"), JSON.stringify(pillars));
    const run = (await start()).json().run;

    expect(run.placement.rung).toBe("informal");
    const mvp = run.steps[0].payload.checklist.filter((c: { kind: string }) => c.kind === "mvp");
    expect(mvp.map((c: { id: string }) => c.id)).toEqual(["mvp-instrument", "mvp-positioning", "mvp-validate"]);
    // `instrument` depended on `build`, which this rung excludes — the
    // existing resolver drops the edge rather than dangling it.
    expect(mvp.find((c: { id: string }) => c.id === "mvp-instrument").dependsOn).toEqual([]);
    // `validate` depended on both `build` and `instrument`; only the
    // surviving one remains.
    expect(mvp.find((c: { id: string }) => c.id === "mvp-validate").dependsOn).toEqual(["mvp-instrument"]);
  });

  it("an unanswered pillar 3 is placed from has_product and says so in the warnings", async () => {
    const pillars = structuredClone(PILLARS) as Record<string, unknown>;
    delete pillars.pillar_3;
    writeFileSync(join(onboardingDir(), "pillar_responses.json"), JSON.stringify(pillars));
    const run = (await start()).json().run;

    expect(run.placement.presumed).toBe(true);
    expect(run.placement.decidedBy).toBe("has_product");
    // The presumption is visible, not silent — and the note names the fix.
    expect(run.warnings.some((w: string) => /where the product stands/i.test(w))).toBe(true);
  });

  it("a confidently placed run carries no placement warning", async () => {
    const run = (await start()).json().run;
    expect(run.placement.presumed).toBe(false);
    expect(run.warnings.some((w: string) => /product stands/i.test(w))).toBe(false);
  });
});
