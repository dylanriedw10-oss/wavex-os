/** The ONE Confirm — approve-organization end to end: canned utterance →
 *  stub mint with disk-enriched body → commit → activate + native seed +
 *  plan lock. Plus the staleness gate and the lock's KPI preservation. */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Fastify, { type FastifyInstance } from "fastify";

let tempDir: string;
let app: FastifyInstance;
const CO = "approve-co";

const MANIFEST = {
  org_id: CO,
  pillar_responses: {
    pillar_1: { org_name: CO, manual_context: "fixture", has_product: false },
    pillar_3: { product_state: "idea_only", stage: "less_than_10k_mrr" },
    // The bridge's selection scorer reads pillar_4 unconditionally.
    pillar_4: { sales_motion: "assisted_demo", lead_sources: ["outbound_cold"] },
  },
  goal: { kpiId: "monthly_recurring_revenue", current: 0, target: 5_000, days: 90 },
  connector_manifest: { required: [], suggested: [], deferred: [], blocked_on_manual_approval: [] },
  swarm_manifest: {
    agents: {
      "ceo.orchestrator": { status: "active", adapter: "claude-code", heartbeat: "15m", budget_monthly_usd: 300, skill_overlay: null, department: "ceo", level: "L·II", reports_to: null, spawnable: false },
      cpo: { status: "active", adapter: "claude-code", heartbeat: "1h", budget_monthly_usd: 120, skill_overlay: null, department: "product", level: "L·III", reports_to: "ceo.orchestrator", spawnable: false },
      cro: { status: "active", adapter: "claude-code", heartbeat: "1h", budget_monthly_usd: 120, skill_overlay: null, department: "sales", level: "L·III", reports_to: "ceo.orchestrator", spawnable: false },
    },
  },
  workflow_manifest: {
    bundle_workflows: {
      pipeline_velocity: { owner: "cro", cycle_length: "1w", participating_agents: ["cro", "cpo"], kpis_moved: ["mrr", "cac"] },
    },
  },
};

/** A minimal plan run so seedWork picks up the MVP chain. */
const PLAN_RUN = {
  v: 1, runId: "plan_test", companyId: CO, status: "complete",
  startedAt: "2026-08-02T00:00:00Z", finishedAt: "2026-08-02T00:00:01Z",
  steps: [{
    id: "roadmap", seq: 0, status: "ready",
    payload: {
      goal: { kpiId: "monthly_recurring_revenue", current: 0, target: 5000, days: 90 },
      checklist: [
        { id: "mvp-spec", title: "Write the MVP product spec", deliverable: "A build-ready spec", assigneeSlot: "cpo", kind: "mvp", dependsOn: [] },
        { id: "mvp-build", title: "Build the MVP", deliverable: "A working first version", assigneeSlot: "cpo", kind: "mvp", dependsOn: ["mvp-spec"] },
        { id: "op-cro", title: "Stand up pipeline", deliverable: "A pipeline", assigneeSlot: "cro", kind: "operating", dependsOn: [] },
      ],
    },
  }],
  patches: [], warnings: [],
};

function onboardingDir(): string {
  return join(tempDir, "instances/default/companies", CO, "onboarding");
}

beforeEach(async () => {
  tempDir = mkdtempSync(join(tmpdir(), "approve-org-test-"));
  process.env.WAVEX_OS_STATE_DIR = tempDir;
  process.env.PAPERCLIP_DATA_DIR = tempDir;
  process.env.WAVEX_AUTH_MODE = "dev";
  process.env.WAVEX_COMPOSIO_DISABLED = "1";
  process.env.WAVEX_DB_DATA_DIR = join(tempDir, "db");
  process.env.WAVEX_AGENT_QUOTA_PREFLIGHT = "0";
  delete process.env.PAPERCLIP_HANDOFF_URL;
  mkdirSync(onboardingDir(), { recursive: true });
  writeFileSync(join(onboardingDir(), "company.manifest.json"), JSON.stringify(MANIFEST));
  writeFileSync(join(onboardingDir(), "plan_assembly.json"), JSON.stringify(PLAN_RUN));
  const { _resetDbCache, runMigrations } = await import("@wavex-os/db");
  _resetDbCache();
  await runMigrations();
  const { registerWavexOsRoutes } = await import("../src/index.js");
  app = Fastify({ logger: false });
  registerWavexOsRoutes(app);
  await app.ready();
});

afterEach(async () => {
  await app.close();
  const { _resetDbCache } = await import("@wavex-os/db");
  _resetDbCache();
  delete process.env.WAVEX_OS_STATE_DIR;
  delete process.env.PAPERCLIP_DATA_DIR;
  delete process.env.WAVEX_AUTH_MODE;
  delete process.env.WAVEX_COMPOSIO_DISABLED;
  delete process.env.WAVEX_DB_DATA_DIR;
  delete process.env.WAVEX_AGENT_QUOTA_PREFLIGHT;
  rmSync(tempDir, { recursive: true, force: true });
});

describe("approve-organization", () => {
  it("mints via the canned utterance with the disk sha + path, commits, locks", async () => {
    // 1 — mint (stub path; body enriched from the manifest on disk).
    const compose = await app.inject({
      method: "POST", url: `/api/instance/${CO}/canvas`,
      payload: { message: "approve the organization", skipInference: true },
    });
    expect(compose.statusCode).toBe(200);
    const proposal = compose.json().proposal;
    expect(proposal?.action).toBe("approve-organization");
    expect(proposal?.body?.manifestSha256).toMatch(/^sha256:[0-9a-f]{64}$/);
    expect(proposal?.body?.path).toBe("mvp_build");   // has_product: false

    // 2 — commit executes the transaction.
    const commit = await app.inject({
      method: "POST", url: `/api/instance/${CO}/canvas/commit`,
      payload: { proposalId: proposal.id },
    });
    expect(commit.statusCode).toBe(200);

    // The work store seeded: manifest goal + the plan's MVP goal + chain.
    const work = JSON.parse(readFileSync(join(onboardingDir(), "work.json"), "utf8"));
    expect(work.goals.map((g: { source: string }) => g.source).sort()).toEqual(["manifest", "plan"]);
    const mvpBuild = work.tasks.find((t: { title: string }) => t.title === "Build the MVP");
    const mvpSpec = work.tasks.find((t: { title: string }) => t.title === "Write the MVP product spec");
    expect(mvpBuild.dependsOn).toEqual([mvpSpec.id]);   // real dependency edges

    // Native ignition recorded; nothing orphaned.
    expect(existsSync(join(tempDir, "instances", CO, "ignition-state.json"))).toBe(true);

    // The plan lock landed and the manifest was re-signed.
    const manifest = JSON.parse(readFileSync(join(onboardingDir(), "company.manifest.json"), "utf8"));
    expect(manifest.plan_locked_at).toBeTruthy();

    // KPI owners populated from the bundle (short-id "mrr" joined).
    const { getDb, companyKpis } = await import("@wavex-os/db");
    const { sql } = await import("drizzle-orm");
    const db = await getDb();
    const rows = await db.select().from(companyKpis).where(sql`${companyKpis.companyId} = ${CO}`);
    const mrr = rows.find((r) => r.kpiId === "monthly_recurring_revenue");
    expect(mrr?.ownerRole).toBe("cro");
  }, 60_000);

  it("409s a stale sha — approving an org that changed under you", async () => {
    const r = await app.inject({
      method: "POST", url: `/api/instance/${CO}/approve-organization`,
      payload: { manifestSha256: "sha256:" + "0".repeat(64), path: "mvp_build" },
    });
    expect(r.statusCode).toBe(409);
    expect(r.json().error).toMatch(/changed since it was reviewed/);
  });

  it("locked plan: re-activate preserves KPI rows; goal eclipse is refused", async () => {
    // Approve once (via the direct route with the real sha).
    const { computeManifestHash } = await import("@wavex-os/plugin-onboarding");
    const manifest = JSON.parse(readFileSync(join(onboardingDir(), "company.manifest.json"), "utf8"));
    const ok = await app.inject({
      method: "POST", url: `/api/instance/${CO}/approve-organization`,
      payload: { manifestSha256: computeManifestHash(manifest), path: "mvp_build" },
    });
    if (ok.statusCode !== 200) console.error("[test] approve failed:", ok.body);
    expect(ok.statusCode).toBe(200);

    // Tamper a KPI row's target, then re-activate: the row must survive.
    const { getDb, companyKpis } = await import("@wavex-os/db");
    const { sql } = await import("drizzle-orm");
    const db = await getDb();
    await db.update(companyKpis).set({ targetMicros: BigInt(123_000_000) })
      .where(sql`${companyKpis.companyId} = ${CO} AND ${companyKpis.kpiId} = ${"monthly_recurring_revenue"}`);
    const re = await app.inject({ method: "POST", url: `/api/instance/${CO}/activate` });
    expect(re.statusCode).toBe(200);
    const rows = await db.select().from(companyKpis).where(sql`${companyKpis.companyId} = ${CO}`);
    const mrr = rows.find((r) => r.kpiId === "monthly_recurring_revenue");
    expect(mrr?.targetMicros).toBe(BigInt(123_000_000));   // preserved, not re-seeded

    // The plan goal cannot be eclipsed; auxiliary goals still can be added.
    const work = JSON.parse(readFileSync(join(onboardingDir(), "work.json"), "utf8"));
    const planGoalTitle = work.goals.find((g: { source: string }) => g.source === "manifest").title;
    const eclipse = await app.inject({
      method: "POST", url: `/api/instance/${CO}/work/goals`,
      payload: { title: planGoalTitle },
    });
    expect(eclipse.statusCode).toBe(409);
    const aux = await app.inject({
      method: "POST", url: `/api/instance/${CO}/work/goals`,
      payload: { title: "Explore a partnerships channel" },
    });
    expect(aux.statusCode).toBe(200);
  }, 60_000);
});
