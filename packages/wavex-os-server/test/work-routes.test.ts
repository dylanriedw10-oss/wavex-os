/** The native work surface + the runtime contract, end to end through the
 *  real app: seed → cycle (fixture engine) → review → done, gates firing,
 *  and the four /runtime/* reads serving the old adapter's exact shape. */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import Fastify, { type FastifyInstance } from "fastify";

const FIXTURE_BIN = join(dirname(fileURLToPath(import.meta.url)), "fixtures", "fake-claude.sh");

let tempDir: string;
let app: FastifyInstance;
const CO = "acme";
const WORK = `/api/instance/${CO}/work`;
const RT = `/api/instance/${CO}/runtime`;

const MANIFEST = {
  org_id: CO,
  pillar_responses: {
    pillar_1: { industry_hint: "saas-b2b", manual_context: "fixture" },
    pillar_3: { stage: "10k_100k_mrr" },
    pillar_4: { sales_motion: "assisted_demo", lead_sources: ["outbound_cold"] },
  },
  // `kpiId` with the CANONICAL long id — the manifest goal has never carried
  // a `metric` field, and `mrr` is a short alias normalised away before it
  // gets here. This fixture said `metric: "mrr"`, which is why the dropped-
  // KPI-name bug was invisible to the suite.
  goal: { kpiId: "monthly_recurring_revenue", current: 12_000, target: 100_000, days: 90, stated: true },
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

beforeEach(async () => {
  tempDir = mkdtempSync(join(tmpdir(), "work-routes-test-"));
  process.env.WAVEX_OS_STATE_DIR = tempDir;
  process.env.PAPERCLIP_DATA_DIR = tempDir;
  process.env.WAVEX_AUTH_MODE = "dev";
  process.env.WAVEX_COMPOSIO_DISABLED = "1";
  process.env.WAVEX_OS_CLAUDE_BIN = FIXTURE_BIN;
  chmodSync(FIXTURE_BIN, 0o755);
  mkdirSync(onboardingDir(), { recursive: true });
  writeFileSync(join(onboardingDir(), "company.manifest.json"), JSON.stringify(MANIFEST));
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
  delete process.env.WAVEX_OS_CLAUDE_BIN;
  delete process.env.FAKE_CLAUDE_MODE;
  rmSync(tempDir, { recursive: true, force: true });
});

describe("the runtime contract (native)", () => {
  it("all four reads answer 503 before seeding — the pre-seed vocabulary", async () => {
    for (const name of ["dashboard", "activity", "approvals", "live-runs"]) {
      const r = await app.inject({ method: "GET", url: `${RT}/${name}` });
      expect(r.statusCode).toBe(503);
      expect(r.json().error).toMatch(/runtime not started/);
    }
  });

  it("after seeding, the shapes match the old adapter field-for-field", async () => {
    await app.inject({ method: "POST", url: `${WORK}/seed` });

    const dash = (await app.inject({ method: "GET", url: `${RT}/dashboard` })).json();
    expect(dash.ok).toBe(true);
    expect(dash.dashboard.agents).toMatchObject({ running: 0, active: 2 });
    expect(dash.dashboard.tasks).toEqual({ open: 2, inProgress: 0, blocked: 0, done: 0 });
    expect(dash.dashboard.pendingApprovals).toBe(0);
    expect(dash.dashboard.runActivity).toHaveLength(12);
    expect(dash.dashboard.runActivity[11]).toHaveProperty("date");
    expect(dash.dashboard.runActivity[11]).toHaveProperty("total");
    expect(dash.dashboard.runActivity[11]).toHaveProperty("succeeded");
    expect(dash.dashboard.runActivity[11]).toHaveProperty("failed");

    const act = (await app.inject({ method: "GET", url: `${RT}/activity` })).json();
    expect(act.events[0]).toMatchObject({ actorType: "system", action: "runtime.seeded", entityType: "goal" });
    expect(act.events[0].createdAt).toBeTruthy();

    expect((await app.inject({ method: "GET", url: `${RT}/approvals` })).json().approvals).toEqual([]);
    expect((await app.inject({ method: "GET", url: `${RT}/live-runs` })).json().runs).toEqual([]);
  });
});

describe("seed → cycle → review — the whole loop", () => {
  it("seeds idempotently from the manifest", async () => {
    const first = (await app.inject({ method: "POST", url: `${WORK}/seed` })).json();
    expect(first.already).toBe(false);
    expect(first.taskIds).toHaveLength(2);
    const again = (await app.inject({ method: "POST", url: `${WORK}/seed` })).json();
    expect(again.already).toBe(true);

    const w = (await app.inject({ method: "GET", url: WORK })).json();
    expect(w.goals[0].title).toMatch(/monthly recurring revenue: 12,000 → 100,000/);
    expect(w.goals[0].source).toBe("manifest");
    expect(w.tasks.map((t: { assigneeSlot: string }) => t.assigneeSlot).sort()).toEqual(["ceo", "growth"]);
  });

  it("run-cycle produces deliverables; approvals binding shows them; approve completes the task", async () => {
    await app.inject({ method: "POST", url: `${WORK}/seed` });
    const cycle = (await app.inject({ method: "POST", url: `${WORK}/run-cycle`, payload: { maxTasks: 2 } })).json();
    expect(cycle.ok).toBe(true);
    expect(cycle.ran).toHaveLength(2);
    expect(cycle.ran.every((r: { outcome: string }) => r.outcome === "in_review")).toBe(true);

    // The runtime bindings tell the truth mid-flow.
    const approvals = (await app.inject({ method: "GET", url: `${RT}/approvals` })).json().approvals;
    expect(approvals).toHaveLength(2);
    expect(approvals[0]).toHaveProperty("id");
    expect(approvals[0]).toHaveProperty("title");
    expect(approvals[0].type).toBe("deliverable_review");

    // Approve one — task done, ledgered.
    const rev = (await app.inject({ method: "POST", url: `${WORK}/deliverables/${approvals[0].id}/review`, payload: { verdict: "approved", note: "ship it" } })).json();
    expect(rev.task.status).toBe("done");
    expect(rev.deliverable.review).toBe("approved");

    // Replay is idempotent.
    const replay = (await app.inject({ method: "POST", url: `${WORK}/deliverables/${approvals[0].id}/review`, payload: { verdict: "changes_requested" } })).json();
    expect(replay.replayed).toBe(true);
    expect(replay.deliverable.review).toBe("approved");

    const dash = (await app.inject({ method: "GET", url: `${RT}/dashboard` })).json().dashboard;
    expect(dash.tasks.done).toBe(1);
    expect(dash.pendingApprovals).toBe(1);
    expect(dash.runActivity[11].succeeded).toBe(1);
  });

  it("changes_requested requeues the task with the note as feedback", async () => {
    await app.inject({ method: "POST", url: `${WORK}/seed` });
    await app.inject({ method: "POST", url: `${WORK}/run-cycle`, payload: { maxTasks: 1 } });
    const approvals = (await app.inject({ method: "GET", url: `${RT}/approvals` })).json().approvals;
    const rev = (await app.inject({ method: "POST", url: `${WORK}/deliverables/${approvals[0].id}/review`, payload: { verdict: "changes_requested", note: "tighten the plan" } })).json();
    expect(rev.task.status).toBe("todo");
    expect(rev.task.feedback).toContain("tighten the plan");
  });

  it("operator goals and tasks are created through the gate and ledgered", async () => {
    await app.inject({ method: "POST", url: `${WORK}/seed` });
    const g = (await app.inject({ method: "POST", url: `${WORK}/goals`, payload: { title: "Ship the landing page" } })).json();
    expect(g.goal.source).toBe("operator");
    const t = (await app.inject({ method: "POST", url: `${WORK}/tasks`, payload: { goalId: g.goal.id, title: "Draft hero copy", brief: "Write the hero.", assigneeSlot: "growth" } })).json();
    expect(t.task.status).toBe("todo");
    expect((await app.inject({ method: "POST", url: `${WORK}/tasks`, payload: { goalId: "goal_missing", title: "x", brief: "y", assigneeSlot: "growth" } })).statusCode).toBe(404);

    const act = (await app.inject({ method: "GET", url: `${RT}/activity` })).json().events;
    expect(act.some((e: { action: string }) => e.action === "goal.created")).toBe(true);
    expect(act.some((e: { action: string }) => e.action === "task.created")).toBe(true);
  });

  it("the commit allowlist drives the runtime: a create-goal proposal commits into the work store", async () => {
    await app.inject({ method: "POST", url: `${WORK}/seed` });
    const canvasFile = {
      companyId: CO, transcript: [], ledger: [], layouts: {}, snapshots: {}, utterances: {}, desk: { pinned: [] },
      proposals: {
        p_goal1: { id: "p_goal1", action: "create-goal", body: { title: "Ship the launing page" }, summary: "Create goal: ship the landing page", created_at: new Date().toISOString(), status: "pending" },
      },
    };
    writeFileSync(join(onboardingDir(), "canvas.json"), JSON.stringify(canvasFile));

    const c = await app.inject({ method: "POST", url: `/api/instance/${CO}/canvas/commit`, payload: { proposalId: "p_goal1" } });
    expect(c.statusCode).toBe(200);
    expect(c.json().proposal.status).toBe("committed");

    const w = (await app.inject({ method: "GET", url: WORK })).json();
    expect(w.goals.some((g: { title: string; source: string }) => g.title === "Ship the launing page" && g.source === "operator")).toBe(true);
  });

  it("the commit path double-gates: a never-sacrifice action fails at commit, ledgered", async () => {
    await app.inject({ method: "POST", url: `${WORK}/seed` });
    writeFileSync(join(onboardingDir(), "org.json"), JSON.stringify({
      companyId: CO, steps: [], memory: [],
      constitution: [{ id: "never_sacrifice", label: "", content: "run-cycle", updatedAt: new Date().toISOString(), updatedByWalkId: null }],
    }));
    const canvasFile = {
      companyId: CO, transcript: [], ledger: [], layouts: {}, snapshots: {}, utterances: {}, desk: { pinned: [] },
      proposals: {
        p_cyc: { id: "p_cyc", action: "run-cycle", body: {}, summary: "Run a work cycle", created_at: new Date().toISOString(), status: "pending" },
      },
    };
    writeFileSync(join(onboardingDir(), "canvas.json"), JSON.stringify(canvasFile));

    const c = await app.inject({ method: "POST", url: `/api/instance/${CO}/canvas/commit`, payload: { proposalId: "p_cyc" } });
    expect(c.statusCode).toBe(409);
    expect(c.json().error).toMatch(/constitution/);
    const g = (await app.inject({ method: "GET", url: `/api/instance/${CO}/canvas` })).json();
    expect(g.ledger[0].status).toBe("failed");
  });

  it("the constitution gate blocks work mutations by name — 409, never silent", async () => {
    await app.inject({ method: "POST", url: `${WORK}/seed` });
    writeFileSync(join(onboardingDir(), "org.json"), JSON.stringify({
      companyId: CO, steps: [], memory: [],
      constitution: [{ id: "never_sacrifice", label: "", content: "run-cycle, create-task", updatedAt: new Date().toISOString(), updatedByWalkId: null }],
    }));
    const c = await app.inject({ method: "POST", url: `${WORK}/run-cycle`, payload: {} });
    expect(c.statusCode).toBe(409);
    expect(c.json().error).toMatch(/constitution/);
    const t = await app.inject({ method: "POST", url: `${WORK}/tasks`, payload: { goalId: "g", title: "x", brief: "y", assigneeSlot: "growth" } });
    expect(t.statusCode).toBe(409);
  });
});
