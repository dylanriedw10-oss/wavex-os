/** Research inside plan assembly — the async path end to end.
 *
 *  The property under test throughout is the same one: RESEARCH CANNOT COST
 *  THE OPERATOR THEIR PLAN. Success enriches it, every failure mode settles
 *  it, and a dead worker recovers it. */

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Fastify, { type FastifyInstance } from "fastify";

let tempDir: string;
let app: FastifyInstance;
const CO = "research-co";
const BASE = "/wavex-os/onboarding/plan-assembly";
const FIXTURE_BIN = join(import.meta.dirname, "fixtures", "fake-claude.sh");

const PILLARS = {
  schema_version: 1,
  started_at: "2026-08-01T00:00:00.000Z",
  pillar_1: { org_name: CO, company_context: "fixture co", enrichment_status: "manual_capture", has_product: false, industry_hint: "b2b_saas", business_model_hint: "subscription" },
  pillar_2: { claude_plan: "max_20x", verified: true },
  pillar_3: { product_state: "idea_only", stage: "pre_product", kpi_snapshot_initial: { mrr: 0 } },
  pillar_4: { sales_motion: "assisted_demo", lead_sources: ["outbound_cold"], gtm_profile_enum: "OUTBOUND_ASSISTED" },
  pillar_5: { comm_channel: "email", urgency_routing: "daily_digest" },
};
const CONNECTOR = { version: 1, required: [], suggested: [], deferred: [], blocked_on_manual_approval: [] };

const onboardingDir = () => join(tempDir, "instances/default/companies", CO, "onboarding");

beforeEach(async () => {
  tempDir = mkdtempSync(join(tmpdir(), "plan-research-test-"));
  process.env.WAVEX_OS_STATE_DIR = tempDir;
  process.env.PAPERCLIP_DATA_DIR = tempDir;
  process.env.WAVEX_AUTH_MODE = "dev";
  process.env.WAVEX_COMPOSIO_DISABLED = "1";
  process.env.WAVEX_INFERENCE_MODE = "apikey";
  process.env.WAVEX_OS_CLAUDE_BIN = FIXTURE_BIN;
  chmodSync(FIXTURE_BIN, 0o755);
  delete process.env.WAVEX_RESEARCH_DISABLED;
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
  for (const k of ["WAVEX_OS_STATE_DIR", "PAPERCLIP_DATA_DIR", "WAVEX_AUTH_MODE", "WAVEX_COMPOSIO_DISABLED", "WAVEX_INFERENCE_MODE", "WAVEX_OS_CLAUDE_BIN", "FAKE_CLAUDE_MODE", "WAVEX_RESEARCH_DISABLED"]) delete process.env[k];
  rmSync(tempDir, { recursive: true, force: true });
});

const start = (body: Record<string, unknown> = {}) =>
  app.inject({ method: "POST", url: `${BASE}/start`, payload: { companyId: CO, skipInference: true, ...body } });

const get = () => app.inject({ method: "GET", url: `${BASE}?companyId=${CO}` });

/** The run settles on a fire-and-forget worker — so await THAT WORKER, not a
 *  status field. `status !== "researching"` was never a settle signal: it is
 *  equally true of a run the GET's stale-research recovery rebuilt WITHOUT
 *  research, which is exactly what a slow worker plus a stale read produced.
 *  The route now hands out the worker's promise; when it resolves the run
 *  file is written, so one read answers. */
async function settled() {
  const { researchInFlight } = await import("../src/routes/plan-assembly.js");
  await researchInFlight(CO);
  return (await get()).json().run;
}

describe("the ordering IS the contract", () => {
  it("start returns a research-only run; the plan lands after", async () => {
    process.env.FAKE_CLAUDE_MODE = "research";
    const immediate = (await start()).json().run;

    // Nothing but research, in flight. A roadmap here would mean the plan was
    // computed BEFORE research and patched afterwards — the causality the
    // spec describes, inverted.
    expect(immediate.status).toBe("researching");
    expect(immediate.steps.map((s: { id: string }) => s.id)).toEqual(["research"]);
    expect(immediate.steps[0].status).toBe("running");

    const run = await settled();
    expect(run.status).toBe("complete");
    expect(run.steps.map((s: { id: string }) => s.id)).toEqual(["research", "roadmap", "kpis", "departments", "dependencies"]);
    expect(run.steps.map((s: { seq: number }) => s.seq)).toEqual([0, 1, 2, 3, 4]);
  });

  it("research: false is today's behavior exactly — four steps, no hole at 0", async () => {
    const run = (await start({ research: false })).json().run;
    expect(run.status).toBe("complete");
    expect(run.steps.map((s: { id: string }) => s.id)).toEqual(["roadmap", "kpis", "departments", "dependencies"]);
    expect(run.steps.map((s: { seq: number }) => s.seq)).toEqual([1, 2, 3, 4]);
  });

  it("WAVEX_RESEARCH_DISABLED is the environment kill switch", async () => {
    process.env.WAVEX_RESEARCH_DISABLED = "1";
    const run = (await start()).json().run;
    expect(run.status).toBe("complete");
    expect(run.steps.find((s: { id: string }) => s.id === "research")).toBeUndefined();
  });
});

describe("findings with teeth", () => {
  it("an applied insert becomes a real checklist item with provenance and a patch", async () => {
    process.env.FAKE_CLAUDE_MODE = "research";
    await start();
    const run = await settled();

    const research = run.steps.find((s: { id: string }) => s.id === "research");
    expect(research.status).toBe("ready");
    expect(research.payload.findings).toHaveLength(2);
    expect(research.payload.applied).toEqual(["usage-metering"]);

    const roadmap = run.steps.find((s: { id: string }) => s.id === "roadmap");
    const added = roadmap.payload.checklist.find((c: { id: string }) => c.id === "mvp-r-usage-metering");
    expect(added).toBeTruthy();
    expect(added.origin).toBe("research");
    expect(added.assigneeSlot).toBe("cpo.roadmap");
    expect(added.dependsOn).toEqual(["mvp-spec"]);
    // It lands directly after its anchor, so the chain still reads in order.
    const ids = roadmap.payload.checklist.filter((c: { kind: string }) => c.kind === "mvp").map((c: { id: string }) => c.id);
    expect(ids.indexOf("mvp-r-usage-metering")).toBe(ids.indexOf("mvp-spec") + 1);

    expect(run.patches.some((p: { source: string; kind: string }) => p.source === "research" && p.kind === "mvp_step_insert")).toBe(true);
  });

  it("an advisory finding stays advisory — most findings attach nothing", async () => {
    process.env.FAKE_CLAUDE_MODE = "research";
    await start();
    const run = await settled();
    const research = run.steps.find((s: { id: string }) => s.id === "research");
    expect(research.payload.findings.map((f: { id: string }) => f.id)).toContain("changelog-inbound");
    expect(research.payload.applied).not.toContain("changelog-inbound");
  });

  it("a company already operating gets findings but no structural change", async () => {
    const pillars = structuredClone(PILLARS);
    pillars.pillar_1.has_product = true;
    pillars.pillar_3.product_state = "live_paying_customers";
    pillars.pillar_3.stage = "10k_100k_mrr";
    writeFileSync(join(onboardingDir(), "pillar_responses.json"), JSON.stringify(pillars));
    process.env.FAKE_CLAUDE_MODE = "research";
    await start();
    const run = await settled();

    const research = run.steps.find((s: { id: string }) => s.id === "research");
    expect(research.payload.findings.length).toBeGreaterThan(0);
    expect(research.payload.applied).toEqual([]);
    // Said plainly rather than pretended around.
    expect(research.note ?? "").toMatch(/advisory for a company with no build chain/);
  });
});

describe("failure never costs the plan", () => {
  it("a T2 failure leaves the four deterministic steps standing", async () => {
    process.env.FAKE_CLAUDE_MODE = "fail";
    await start();
    const run = await settled();

    expect(run.status).toBe("complete");
    const research = run.steps.find((s: { id: string }) => s.id === "research");
    expect(research.status).toBe("failed");
    expect(research.note).toMatch(/didn't complete/);
    expect(run.steps.filter((s: { status: string; id: string }) => s.id !== "research").every((s: { status: string }) => s.status === "ready")).toBe(true);
    expect(run.warnings.join()).toMatch(/the deterministic plan stands/);
    // The plan is real, not a husk.
    expect(run.steps.find((s: { id: string }) => s.id === "roadmap").payload.checklist.length).toBeGreaterThan(0);
  });

  it("prose instead of JSON is zero findings, NOT a failed run", async () => {
    process.env.FAKE_CLAUDE_MODE = "research_garbage";
    await start();
    const run = await settled();

    const research = run.steps.find((s: { id: string }) => s.id === "research");
    expect(research.status).toBe("ready");
    expect(research.payload.findings).toEqual([]);
    expect(run.status).toBe("complete");
  });

  it("a researching run with no worker settles deterministically on read", async () => {
    // Simulate the process dying mid-research: the run file says researching,
    // but nothing is in flight in THIS process.
    process.env.FAKE_CLAUDE_MODE = "research";
    await start();
    await settled();
    const path = join(onboardingDir(), "plan_assembly.json");
    const { readFileSync } = await import("node:fs");
    const stale = JSON.parse(readFileSync(path, "utf8"));
    stale.status = "researching";
    stale.steps = [{ id: "research", seq: 0, status: "running", payload: { findings: [], applied: [], durationMs: 0 } }];
    writeFileSync(path, JSON.stringify(stale));

    const run = (await get()).json().run;
    // Not merely relabelled: a one-step run is useless to the operator, so
    // the read rebuilds the plan from the manifests already on disk.
    expect(run.status).toBe("complete");
    expect(run.steps.map((s: { id: string }) => s.id)).toContain("roadmap");
    expect(run.warnings.join()).toMatch(/stale_research/);
  });
});

describe("idempotency still holds with research in the picture", () => {
  it("a second start returns the settled run rather than re-researching", async () => {
    process.env.FAKE_CLAUDE_MODE = "research";
    await start();
    const first = await settled();
    const second = (await start()).json().run;
    expect(second.runId).toBe(first.runId);
    expect(second.steps.map((s: { id: string }) => s.id)).toEqual(first.steps.map((s: { id: string }) => s.id));
  });
});

/** The rule the removal of the "full org" override made load-bearing.
 *
 *  Before it, `scope: "full"` — and, worse, no scope record at all — promoted
 *  every matrix-parked agent to active, so a delta could name any slot in the
 *  fleet and land. With parking now purely subtractive, the matrix's verdict
 *  stands, and research assigning work to an agent that verdict parked would
 *  produce a checklist item nobody is running. It is dropped, and the reason
 *  is stated where the findings are rather than swallowed. */
describe("research may not assign work to a parked agent", () => {
  const insert = (slot: string) => ([{
    id: "f1", headline: "h", claim: "c", rationale: "r", signals: [], confidence: "high" as const,
    delta: {
      kind: "mvp_step_insert" as const, after: "mvp-spec",
      title: "t", deliverable: "d", assigneeSlot: slot,
    },
  }]);
  const chain = [
    { id: "mvp-spec", title: "Spec", deliverable: "d", assigneeSlot: "cpo", kind: "mvp" as const, dependsOn: [] },
  ];

  it("drops the insert and says why", async () => {
    const { applyResearchToChecklist } = await import("../src/research/apply.js");
    const out = applyResearchToChecklist(chain, insert("cpo.build"), { activeSlots: new Set(["cpo"]) });
    expect(out.applied).toEqual([]);
    expect(out.checklist).toHaveLength(1);
    expect(out.warnings.join()).toMatch(/cpo\.build.*not an active slot/);
  });

  it("applies it when the slot survived the matrix", async () => {
    const { applyResearchToChecklist } = await import("../src/research/apply.js");
    const out = applyResearchToChecklist(chain, insert("cpo"), { activeSlots: new Set(["cpo"]) });
    expect(out.applied).toEqual(["f1"]);
    expect(out.checklist.map((c) => c.id)).toEqual(["mvp-spec", "mvp-r-f1"]);
  });
});

/** Parking is applied where it is ANSWERED, not merely recorded.
 *
 *  The scope record used to be written and nothing else, because the
 *  question was asked in the interview — before the swarm existed, so the
 *  generator read it on the way past. The question now lives at Review, over
 *  a plan the operator can see, and by then the fleet is already on disk. A
 *  route that only wrote the file would leave departments struck out on
 *  screen and a fleet that never heard about it. */
describe("department parking reaches the fleet", () => {
  const swarmPath = () => join(onboardingDir(), "swarm_manifest.json");
  const statuses = async () => {
    const { readFileSync } = await import("node:fs");
    const agents = JSON.parse(readFileSync(swarmPath(), "utf8")).agents as
      Record<string, { department?: string; status: string }>;
    const by: Record<string, Record<string, number>> = {};
    for (const a of Object.values(agents)) {
      const d = a.department ?? "—";
      by[d] = by[d] ?? {};
      by[d][a.status] = (by[d][a.status] ?? 0) + 1;
    }
    return by;
  };

  it("parks everything outside the kept set, and says how many", async () => {
    await start({ research: false });                       // generates the swarm
    const before = await statuses();
    expect(Object.keys(before.finance ?? {})).toContain("active");

    const r = await app.inject({
      method: "POST", url: "/wavex-os/onboarding/scope",
      payload: { companyId: CO, mode: "focused", departments: ["product", "revenue"] },
    });
    expect(r.statusCode).toBe(200);
    expect(r.json().applied).toBe(true);
    expect(r.json().warnings.join()).toMatch(/parked \d+ agents outside/);

    const after = await statuses();
    expect(after.finance?.active ?? 0).toBe(0);
    expect(after.ceo?.active ?? 0).toBeGreaterThan(0);      // CEO + CoS are sacrosanct
  });

  it("recomputes rather than accumulating — a retry with fewer parked is honoured", async () => {
    await start({ research: false });
    const scope = (departments: string[]) => app.inject({
      method: "POST", url: "/wavex-os/onboarding/scope",
      payload: { companyId: CO, mode: "focused", departments },
    });
    await scope(["product"]);
    expect((await statuses()).revenue?.active ?? 0).toBe(0);

    // The operator un-strikes revenue and confirms again. Patching in place
    // could only ever ADD parks, so this is the case that proves the route
    // regenerates instead.
    await scope(["product", "revenue"]);
    expect((await statuses()).revenue?.active ?? 0).toBeGreaterThan(0);
  });
});
