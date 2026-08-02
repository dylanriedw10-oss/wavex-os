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
    expect(body.agentsWorking).toBe(2);
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
});
