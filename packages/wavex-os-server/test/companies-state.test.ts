/** /api/companies must say what each company IS, not just that a directory
 *  exists. The onboarding entry screen routes on this: a company with an
 *  org spine is LIVE and belongs on the canvas — sending it back to Pillar 1
 *  restarts onboarding on a running company. */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Fastify, { type FastifyInstance } from "fastify";

let tempDir: string;
let app: FastifyInstance;

function onboardingDir(companyId: string): string {
  return join(tempDir, "instances/default/companies", companyId, "onboarding");
}

/** Lay a company down on disk with exactly the artifacts named. */
function seedCompany(companyId: string, files: Record<string, unknown>): void {
  const dir = onboardingDir(companyId);
  mkdirSync(dir, { recursive: true });
  for (const [name, body] of Object.entries(files)) {
    writeFileSync(join(dir, name), JSON.stringify(body));
  }
}

beforeEach(async () => {
  tempDir = mkdtempSync(join(tmpdir(), "companies-state-test-"));
  process.env.WAVEX_OS_STATE_DIR = tempDir;
  process.env.PAPERCLIP_DATA_DIR = tempDir;
  process.env.WAVEX_AUTH_MODE = "dev";
  process.env.WAVEX_COMPOSIO_DISABLED = "1";
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

describe("GET /api/companies — the state ladder", () => {
  it("reads each company's real state off disk", async () => {
    seedCompany("livewire", { "org.json": { nodes: [] }, "company.manifest.json": { org_id: "livewire" } });
    seedCompany("signed", { "company.manifest.json": { org_id: "signed" } });
    seedCompany("halfway", { "pillar_responses.json": { pillar_1: {} } });
    mkdirSync(onboardingDir("shell"), { recursive: true });

    const r = await app.inject({ method: "GET", url: "/api/companies" });
    expect(r.statusCode).toBe(200);
    const byId = Object.fromEntries(
      r.json().companies.map((c: { id: string }) => [c.id, c]),
    );

    // The ladder: the furthest-along artifact wins.
    expect(byId.livewire.state).toBe("live");
    expect(byId.signed.state).toBe("finalized");
    expect(byId.halfway.state).toBe("draft");
    expect(byId.shell.state).toBe("empty");
  });

  it("stamps updatedAt from real artifacts and leaves it null for empties", async () => {
    seedCompany("halfway", { "pillar_responses.json": { pillar_1: {} } });
    mkdirSync(onboardingDir("shell"), { recursive: true });

    const companies = (await app.inject({ method: "GET", url: "/api/companies" })).json().companies;
    const byId = Object.fromEntries(companies.map((c: { id: string }) => [c.id, c]));

    expect(byId.halfway.updatedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(byId.shell.updatedAt).toBeNull();
  });

  it("sorts most-recently-touched first — the company you were just in leads", async () => {
    seedCompany("older", { "pillar_responses.json": { pillar_1: {} } });
    await new Promise((r) => setTimeout(r, 20));
    seedCompany("newer", { "pillar_responses.json": { pillar_1: {} } });

    const companies = (await app.inject({ method: "GET", url: "/api/companies" })).json().companies;
    const touched = companies.filter((c: { updatedAt: string | null }) => c.updatedAt !== null);
    expect(touched[0].id).toBe("newer");
  });
});
