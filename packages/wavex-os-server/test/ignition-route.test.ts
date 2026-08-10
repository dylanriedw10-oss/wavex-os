/** GET /api/instance/:companyId/ignition — status derivation + hardening. */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Fastify, { type FastifyInstance } from "fastify";

let tempDir: string;
let app: FastifyInstance;

async function buildApp(): Promise<FastifyInstance> {
  const { registerWavexOsRoutes } = await import("../src/index.js");
  const a = Fastify({ logger: false });
  registerWavexOsRoutes(a);
  await a.ready();
  return a;
}

function writeState(companyId: string, state: Record<string, unknown>): void {
  const dir = join(tempDir, "instances", companyId);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "ignition-state.json"), JSON.stringify(state));
}

const BASE_STEPS = {
  workflow_load: { status: "ok" },
  goal_create: { status: "ok", goal_id: "goal_1" },
  seed_issues: { status: "ok", created: ["i1", "i2"] },
  kickoff_probe: { status: "ok" },
  validate_coverage: { status: "ok", gaps: [] },
  stagger_heartbeats: { status: "ok", offsets: {} },
};

beforeEach(async () => {
  tempDir = mkdtempSync(join(tmpdir(), "ignition-route-test-"));
  process.env.WAVEX_OS_STATE_DIR = tempDir;
  process.env.PAPERCLIP_DATA_DIR = tempDir;
  process.env.WAVEX_AUTH_MODE = "dev";
  process.env.WAVEX_COMPOSIO_DISABLED = "1";
  app = await buildApp();
});

afterEach(async () => {
  await app.close();
  delete process.env.WAVEX_OS_STATE_DIR;
  delete process.env.PAPERCLIP_DATA_DIR;
  delete process.env.WAVEX_AUTH_MODE;
  delete process.env.WAVEX_COMPOSIO_DISABLED;
  rmSync(tempDir, { recursive: true, force: true });
});

describe("GET /api/instance/:companyId/ignition", () => {
  it("returns 200 not_activated when nothing is on disk (not 404)", async () => {
    const r = await app.inject({ method: "GET", url: "/api/instance/fresh-co/ignition" });
    expect(r.statusCode).toBe(200);
    const body = r.json();
    expect(body.ok).toBe(true);
    expect(body.status).toBe("not_activated");
    expect(body.steps).toBeNull();
  });

  it("rejects a path-traversal companyId before touching the filesystem", async () => {
    const r = await app.inject({ method: "GET", url: "/api/instance/..%2F..%2Fetc/ignition" });
    expect(r.statusCode).toBe(400);
    expect(r.json().error).toMatch(/invalid companyId/);
  });

  it("derives deferred when ignition started but never completed", async () => {
    writeState("acme", {
      v: 1, company_id: "acme", started_at: "2026-07-30T00:00:00Z", completed_at: null,
      steps: { ...BASE_STEPS, seed_issues: { status: "pending", created: [] } },
      errors: [], warnings: [],
    });
    const r = await app.inject({ method: "GET", url: "/api/instance/acme/ignition" });
    expect(r.json().status).toBe("deferred");
  });

  it("derives partial when completed with warnings, and counts seeded issues", async () => {
    writeState("acme", {
      v: 1, company_id: "acme", started_at: "2026-07-30T00:00:00Z",
      completed_at: "2026-07-30T00:05:00Z",
      steps: BASE_STEPS, errors: [], warnings: ["2 slots uncovered"],
    });
    const body = (await app.inject({ method: "GET", url: "/api/instance/acme/ignition" })).json();
    expect(body.status).toBe("partial");
    // WAS `expect(body.agentsWorking).toBe(2)`, which pinned the defect
    // rather than the behaviour: 2 is the length of `seed_issues.created`,
    // and the route was serving that as the agent count. BASE_STEPS has
    // `stagger_heartbeats.offsets: {}` — the step RAN and recorded no
    // agents, which is a measurement of zero, not an absence of one.
    expect(body.workflowsQueued).toBe(2);
    expect(body.agentsWorking).toBe(0);
    expect(body.goalId).toBe("goal_1");
  });

  it("derives ignited when completed clean, and surfaces the handoff mapping", async () => {
    writeState("acme", {
      v: 1, company_id: "acme", started_at: "2026-07-30T00:00:00Z",
      completed_at: "2026-07-30T00:05:00Z",
      steps: BASE_STEPS, errors: [], warnings: [],
    });
    const hDir = join(tempDir, "instances", "default", "companies", "acme");
    mkdirSync(hDir, { recursive: true });
    writeFileSync(join(hDir, "paperclip-handoff.json"), JSON.stringify({
      paperclipUrl: "http://127.0.0.1:3100", paperclipCompanyId: "pc_1",
      createdAt: "2026-07-30T00:00:00Z", agents: {},
    }));
    const body = (await app.inject({ method: "GET", url: "/api/instance/acme/ignition" })).json();
    expect(body.status).toBe("ignited");
    expect(body.paperclipUrl).toBe("http://127.0.0.1:3100");
    expect(body.paperclipCompanyId).toBe("pc_1");
  });

  it("tolerates corrupt state files by treating them as absent", async () => {
    const dir = join(tempDir, "instances", "acme");
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "ignition-state.json"), "{not json");
    const body = (await app.inject({ method: "GET", url: "/api/instance/acme/ignition" })).json();
    expect(body.status).toBe("not_activated");
  });

  /** The counts, each derived from the thing it is named after.
   *
   *  This route used to serve ONE value — the seeded task count — as both
   *  `agentsWorking` and `workflowsQueued`, so a 35-agent company reported
   *  "7 agents working, 7 queued": a sentence that looks like two
   *  measurements and is one number printed twice. `gaps` did not exist and
   *  the UI substituted `warnings.length`, which turned a healthy idempotent
   *  re-activate ("work store already seeded") into "1 gaps". */
  describe("the counts say what they are named", () => {
    it("derives agentsWorking from heartbeat offsets minus coverage gaps", async () => {
      writeState("acme", {
        v: 1, company_id: "acme", started_at: "2026-07-30T00:00:00Z",
        completed_at: "2026-07-30T00:05:00Z",
        steps: {
          ...BASE_STEPS,
          // 5 non-muted agents got an offset; 2 of them are uncovered.
          stagger_heartbeats: { status: "ok", offsets: { a: 1, b: 2, c: 3, d: 4, e: 5 } },
          validate_coverage: { status: "error", gaps: ["d", "e"] },
          seed_issues: { status: "ok", created: ["i1", "i2", "i3"] },
          seed_roadmap: { status: "ok", created: ["r1"] },
        },
        errors: [], warnings: [],
      });
      const body = (await app.inject({ method: "GET", url: "/api/instance/acme/ignition" })).json();
      // Exactly what the POST path computes as `nonMuted.length - gaps.length`.
      expect(body.agentsWorking).toBe(3);
      // Issues + roadmap, which is the POST path's `workflows_queued`.
      expect(body.workflowsQueued).toBe(4);
      expect(body.gaps).toEqual(["d", "e"]);
      // THE POINT: two different numbers, because they count two things.
      expect(body.agentsWorking).not.toBe(body.workflowsQueued);
    });

    it("returns agentsWorking NULL when the run never counted agents", async () => {
      // The native seeding variant: a goal and tasks, no fleet step at all.
      writeState("native-co", {
        v: 1, company_id: "native-co", started_at: "2026-07-30T00:00:00Z",
        completed_at: "2026-07-30T00:00:03Z",
        steps: {
          seed_goal: { status: "ok", goal_id: "goal_9" },
          seed_tasks: { status: "ok", created: ["t1", "t2", "t3", "t4", "t5", "t6", "t7"] },
        },
        errors: [], warnings: [],
      });
      const body = (await app.inject({ method: "GET", url: "/api/instance/native-co/ignition" })).json();
      // Null, NOT 0 and NOT 7. "No agents are working" and "nobody counted"
      // are different facts, and serving the task count here is what made a
      // 35-agent company read "7 agents working".
      expect(body.agentsWorking).toBeNull();
      expect(body.workflowsQueued).toBe(7);
      expect(body.goalId).toBe("goal_9");
    });

    it("keeps gaps separate from warnings — a benign re-seed is not a gap", async () => {
      writeState("acme", {
        v: 1, company_id: "acme", started_at: "2026-07-30T00:00:00Z",
        completed_at: "2026-07-30T00:00:03Z",
        steps: {
          seed_goal: { status: "ok", goal_id: "g1" },
          seed_tasks: { status: "ok", created: ["t1"] },
        },
        errors: [],
        warnings: ["work store already seeded — steps re-recorded from the existing store"],
      });
      const body = (await app.inject({ method: "GET", url: "/api/instance/acme/ignition" })).json();
      expect(body.warnings).toHaveLength(1);
      expect(body.gaps).toEqual([]);
      // deriveStatus still demotes it, which is accurate — the run did less
      // than a fresh seed. What must NOT happen is calling that a gap.
      expect(body.status).toBe("partial");
    });

    it("never lets gaps outnumber offsets into a negative agent count", async () => {
      writeState("acme", {
        v: 1, company_id: "acme", started_at: "2026-07-30T00:00:00Z",
        completed_at: "2026-07-30T00:05:00Z",
        steps: {
          ...BASE_STEPS,
          stagger_heartbeats: { status: "ok", offsets: { a: 1 } },
          validate_coverage: { status: "error", gaps: ["a", "b", "c"] },
        },
        errors: [], warnings: [],
      });
      const body = (await app.inject({ method: "GET", url: "/api/instance/acme/ignition" })).json();
      expect(body.agentsWorking).toBe(0);
    });
  });
});
