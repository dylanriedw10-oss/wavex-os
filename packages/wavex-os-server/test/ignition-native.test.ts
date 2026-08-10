/** Native ignition — the seedWork wire that keeps a stock install from
 *  ending activation planning-orphaned. Three layers:
 *    1. igniteNative() unit: seeds, records seed_goal/seed_tasks, idempotent
 *    2. the ignition READ route decodes the native vocabulary
 *    3. POST /activate end-to-end with no Paperclip → ignited, not orphaned */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Fastify, { type FastifyInstance } from "fastify";

let tempDir: string;
const CO = "native-co";

const MANIFEST = {
  org_id: CO,
  pillar_responses: {
    pillar_1: { industry_hint: "saas-b2b", manual_context: "fixture" },
    pillar_3: { stage: "10k_100k_mrr" },
    pillar_4: { sales_motion: "assisted_demo", lead_sources: ["outbound_cold"] },
  },
  // `kpiId`, not `metric` — the manifest goal has never had a `metric`
  // field. This fixture used to say `metric`, which is exactly why the
  // seeded-goal title bug survived: the only test exercising the path was
  // shaped like the defect.
  goal: { kpiId: "activation_rate", current: 22, target: 45, days: 180, stated: true },
  connector_manifest: { required: [], suggested: [], deferred: [], blocked_on_manual_approval: [] },
  swarm_manifest: {
    agents: {
      ceo: { status: "active", adapter: "claude-code", heartbeat: "15m", budget_monthly_usd: 300, skill_overlay: null, department: "ceo", level: "L·II", reports_to: null, spawnable: false },
      growth: { status: "active", adapter: "claude-code", heartbeat: "1h", budget_monthly_usd: 120, skill_overlay: null, department: "growth", level: "L·III", reports_to: "ceo", spawnable: false },
    },
  },
};

function onboardingDir(): string {
  return join(tempDir, "instances/default/companies", CO, "onboarding");
}

function writeManifest(): void {
  mkdirSync(onboardingDir(), { recursive: true });
  writeFileSync(join(onboardingDir(), "company.manifest.json"), JSON.stringify(MANIFEST));
}

beforeEach(() => {
  tempDir = mkdtempSync(join(tmpdir(), "ignition-native-test-"));
  process.env.WAVEX_OS_STATE_DIR = tempDir;
  process.env.PAPERCLIP_DATA_DIR = tempDir;
  process.env.WAVEX_AUTH_MODE = "dev";
  process.env.WAVEX_COMPOSIO_DISABLED = "1";
  process.env.WAVEX_DB_DATA_DIR = join(tempDir, "db");
  process.env.WAVEX_AGENT_QUOTA_PREFLIGHT = "0";
  delete process.env.PAPERCLIP_HANDOFF_URL;
});

afterEach(async () => {
  // Drop the cached PGlite handle before the tempdir is deleted.
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

describe("igniteNative()", () => {
  it("seeds the work store and records the native step vocabulary", async () => {
    writeManifest();
    const { igniteNative } = await import("../src/bridge/ignition-native.js");
    const r = await igniteNative(CO);

    expect(r.status).toBe("ignited");
    expect(r.goal_id).toMatch(/^goal_/);
    expect(r.agents_working).toBe(2);           // one bootstrap task per active slot
    expect(r.errors).toEqual([]);

    // work.json exists with the seeded goal + tasks
    const work = JSON.parse(readFileSync(join(onboardingDir(), "work.json"), "utf8"));
    expect(work.goals).toHaveLength(1);
    expect(work.goals[0].id).toBe(r.goal_id);
    // The KPI the operator chose reaches the work store by name. Before the
    // fix this read "goal: 22 → 45 in 180d" — the metric silently dropped.
    expect(work.goals[0].title).toBe("activation rate: 22 → 45 in 180d");
    // A stated goal carries no estimate caveat.
    expect(work.goals[0].description).not.toMatch(/estimated|not state/i);
    expect(work.tasks).toHaveLength(2);

    // ignition-state.json carries seed_goal/seed_tasks with completed_at set
    const state = JSON.parse(readFileSync(join(tempDir, "instances", CO, "ignition-state.json"), "utf8"));
    expect(state.steps.seed_goal.status).toBe("ok");
    expect(state.steps.seed_goal.goal_id).toBe(r.goal_id);
    expect(state.steps.seed_tasks.status).toBe("ok");
    expect(state.steps.seed_tasks.created).toHaveLength(2);
    expect(state.completed_at).toBeTruthy();
  });

  it("a goal the operator never stated reaches the work store labelled as an estimate", async () => {
    // The whole point of the honesty bit: the band still seeds work — the
    // fleet needs something to drive — but nothing downstream may read it as
    // a number somebody chose.
    const band = { ...MANIFEST, goal: { kpiId: "monthly_recurring_revenue", current: 45_000, target: 100_000, days: 90, stated: false } };
    mkdirSync(onboardingDir(), { recursive: true });
    writeFileSync(join(onboardingDir(), "company.manifest.json"), JSON.stringify(band));

    const { igniteNative } = await import("../src/bridge/ignition-native.js");
    const r = await igniteNative(CO);
    expect(r.goal_id).toMatch(/^goal_/);

    const work = JSON.parse(readFileSync(join(onboardingDir(), "work.json"), "utf8"));
    // The title still names the real KPI — an estimate is not an excuse to
    // drop the metric.
    expect(work.goals[0].title).toBe("monthly recurring revenue: 45,000 → 100,000 in 90d");
    // …and the record says who did not choose it.
    expect(work.goals[0].description).toMatch(/did not state a goal/i);
  });

  it("does NOT seed work for a department the operator parked at review", () => {
    // The seed filtered on `muted` — the manual mute list — not on `status`,
    // so parking a department in Review was honoured by the plan and then
    // silently undone by the work store. This is the regression guard.
    const parked = {
      ...MANIFEST,
      swarm_manifest: { agents: {
        ...MANIFEST.swarm_manifest.agents,
        growth: { ...MANIFEST.swarm_manifest.agents.growth, status: "parked", unpark_condition: "operator_unpark_from_mission_control" },
      } },
    };
    mkdirSync(onboardingDir(), { recursive: true });
    writeFileSync(join(onboardingDir(), "company.manifest.json"), JSON.stringify(parked));

    return import("../src/bridge/ignition-native.js").then(async ({ igniteNative }) => {
      await igniteNative(CO);
      const work = JSON.parse(readFileSync(join(onboardingDir(), "work.json"), "utf8"));
      const owners = work.tasks.map((t: { assigneeSlot: string }) => t.assigneeSlot);
      expect(owners).not.toContain("growth");
      expect(owners).toContain("ceo");
    });
  });

  it("is idempotent — a re-run re-records the existing store, never re-seeds", async () => {
    writeManifest();
    const { igniteNative } = await import("../src/bridge/ignition-native.js");
    const first = await igniteNative(CO);
    const again = await igniteNative(CO);

    expect(again.status).toBe("ignited");
    expect(again.goal_id).toBe(first.goal_id);
    expect(again.agents_working).toBe(2);       // counted from the store, not zeros
    expect(again.warnings.join(" ")).toMatch(/already seeded/);

    const work = JSON.parse(readFileSync(join(onboardingDir(), "work.json"), "utf8"));
    expect(work.goals).toHaveLength(1);         // never duplicated
    expect(work.tasks).toHaveLength(2);
  });

  it("defers with a recorded error when there is no manifest", async () => {
    const { igniteNative } = await import("../src/bridge/ignition-native.js");
    const r = await igniteNative(CO);

    expect(r.status).toBe("deferred");
    expect(r.goal_id).toBeNull();
    expect(r.errors[0]?.step).toBe("seed_goal");

    const state = JSON.parse(readFileSync(join(tempDir, "instances", CO, "ignition-state.json"), "utf8"));
    expect(state.steps.seed_goal.status).toBe("error");
    expect(state.steps.seed_tasks.status).toBe("skipped");
  });
});

describe("GET /api/instance/:companyId/ignition after native ignition", () => {
  it("decodes seed_goal/seed_tasks into goalId + queued work, and reports NO agent count", async () => {
    writeManifest();
    const { igniteNative } = await import("../src/bridge/ignition-native.js");
    const ignited = await igniteNative(CO);

    const { registerWavexOsRoutes } = await import("../src/index.js");
    const app: FastifyInstance = Fastify({ logger: false });
    registerWavexOsRoutes(app);
    await app.ready();
    try {
      const r = await app.inject({ method: "GET", url: `/api/instance/${CO}/ignition` });
      expect(r.statusCode).toBe(200);
      const body = r.json();
      expect(body.status).toBe("ignited");
      expect(body.goalId).toBe(ignited.goal_id);
      // The two seeded TASKS are queued work, and that is all this path
      // knows. It never touches the fleet — no `stagger_heartbeats` step is
      // written — so there is no agent count to report.
      expect(body.workflowsQueued).toBe(2);
      // WAS `expect(body.agentsWorking).toBe(2)`, which pinned the defect:
      // the route was serving the task count under an agent's name, so a
      // 35-agent company read "2 agents working". Null is the honest answer
      // and is distinguishable from a measured zero.
      expect(body.agentsWorking).toBeNull();
    } finally {
      await app.close();
    }
  });
});

describe("POST /api/instance/:companyId/activate with no Paperclip", () => {
  it("ends with a planned fleet: work seeded, not orphaned", async () => {
    writeManifest();
    // Migrate BEFORE building the app (the bridge-agents.test.ts pattern):
    // registerWavexOsRoutes starts the referral scheduler, whose un-awaited
    // run calls runMigrations() and races the activate route's own migration
    // on a fresh PGlite — two migrators, one empty journal, one collision.
    const { _resetDbCache, runMigrations } = await import("@wavex-os/db");
    _resetDbCache();
    await runMigrations();
    const { registerWavexOsRoutes } = await import("../src/index.js");
    const app: FastifyInstance = Fastify({ logger: false });
    registerWavexOsRoutes(app);
    await app.ready();
    try {
      const r = await app.inject({ method: "POST", url: `/api/instance/${CO}/activate` });
      if (r.statusCode !== 200) console.error("[test] activate failed:", r.body);
      expect(r.statusCode).toBe(200);
      const body = r.json();
      expect(body.ok).toBe(true);
      // THE point of the native wire: no Paperclip, yet the fleet is planned.
      expect(body.ignition_orphaned).toBe(false);
      expect(body.ignition.status).toBe("ignited");
      expect(body.ignition.goal_id).toMatch(/^goal_/);
      expect(existsSync(join(onboardingDir(), "work.json"))).toBe(true);
    } finally {
      await app.close();
    }
  }, 60_000);   // first PGlite migration run is slow
});
