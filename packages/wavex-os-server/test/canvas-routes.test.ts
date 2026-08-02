/** Canvas transport — persistence, memory, proposals, commit, pins. */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import Fastify, { type FastifyInstance } from "fastify";

let tempDir: string;
let app: FastifyInstance;
const CO = "acme";
const URL = `/api/instance/${CO}/canvas`;

async function post(message: string, extra: Record<string, unknown> = { skipInference: true }) {
  const r = await app.inject({ method: "POST", url: URL, payload: { message, ...extra } });
  return { status: r.statusCode, body: r.json() };
}

beforeEach(async () => {
  tempDir = mkdtempSync(join(tmpdir(), "canvas-routes-test-"));
  process.env.WAVEX_OS_STATE_DIR = tempDir;
  process.env.PAPERCLIP_DATA_DIR = tempDir;
  process.env.WAVEX_AUTH_MODE = "dev";
  process.env.WAVEX_COMPOSIO_DISABLED = "1";
  // Any accidental T2 attempt must fail fast (ENOENT), not hang 45s.
  process.env.WAVEX_OS_CLAUDE_BIN = "/nonexistent-claude-bin";
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
  rmSync(tempDir, { recursive: true, force: true });
});

describe("canvas routes", () => {
  it("rejects malformed body with 400 + issues", async () => {
    const r = await app.inject({ method: "POST", url: URL, payload: { nope: 1 } });
    expect(r.statusCode).toBe(400);
    expect(r.json().issues).toBeDefined();
  });

  it("rejects a traversal companyId", async () => {
    const r = await app.inject({ method: "POST", url: "/api/instance/..%2Fx/canvas", payload: { message: "hi" } });
    expect(r.statusCode).toBe(400);
  });

  it("composes a workspace, persists it, and survives a fresh GET (refresh)", async () => {
    const { body } = await post("why did spend spike?");
    expect(body.turn.layout.title).toBe("Token spend");
    expect(body.turn.composedBy).toBe("stub");

    const g = (await app.inject({ method: "GET", url: URL })).json();
    expect(g.transcript).toHaveLength(2);
    expect(g.transcript[1].layout.title).toBe("Token spend");
  });

  it("serves an exact repeat from memory, and a paraphrase via its signature alias", async () => {
    await post("why did spend spike?");
    const repeat = await post("Why did spend spike?!");
    expect(repeat.body.turn.composedBy).toBe("memory");

    const para = await post("what did the tokens cost");
    // Different utterance, same classified intent → same stored signature.
    expect(para.body.turn.signature).toBe(repeat.body.turn.signature);
  });

  it("'show it differently' clears the remembered layout and recomposes", async () => {
    await post("why did spend spike?");
    const r = await post("show spend differently please");
    expect(r.body.turn.composedBy).toBe("stub");
  });

  it("creates a proposal, commits it through the real endpoint, and appends the ledger", async () => {
    const p = await post("set the token budget to 60k");
    const proposalId = p.body.turn.proposalId as string;
    expect(p.body.proposal.status).toBe("pending");

    const c = await app.inject({ method: "POST", url: `${URL}/commit`, payload: { proposalId } });
    expect(c.statusCode).toBe(200);
    expect(c.json().proposal.status).toBe("committed");

    // The mutation really happened: token-budget now returns the cap.
    const b = (await app.inject({ method: "GET", url: `/api/instance/${CO}/token-budget` })).json();
    expect(b.budget.cap_tokens).toBe(60_000);

    // Ledger recorded, and transcript states the outcome.
    const g = (await app.inject({ method: "GET", url: URL })).json();
    expect(g.ledger).toHaveLength(1);
    expect(g.ledger[0].status).toBe("committed");
    expect(g.transcript.at(-1).text).toMatch(/^Done/);
  });

  it("double-commit replays the recorded outcome instead of re-executing", async () => {
    const p = await post("set the token budget to 50k");
    const id = p.body.turn.proposalId as string;
    await app.inject({ method: "POST", url: `${URL}/commit`, payload: { proposalId: id } });
    const again = (await app.inject({ method: "POST", url: `${URL}/commit`, payload: { proposalId: id } })).json();
    expect(again.replayed).toBe(true);
    const g = (await app.inject({ method: "GET", url: URL })).json();
    expect(g.ledger).toHaveLength(1); // not two
  });

  it("unknown proposal → 404; pending proposals survive transcript trimming", async () => {
    const r = await app.inject({ method: "POST", url: `${URL}/commit`, payload: { proposalId: "p_missing" } });
    expect(r.statusCode).toBe(404);

    const p = await post("set the token budget to 40k");
    const id = p.body.turn.proposalId as string;
    for (let i = 0; i < 25; i++) await post(`show me the team ${i}`);
    const g = (await app.inject({ method: "GET", url: URL })).json();
    expect(g.transcript.length).toBeLessThanOrEqual(40);
    expect(g.proposals.find((x: { id: string }) => x.id === id)?.status).toBe("pending");
  });

  it("pins a composed workspace to the desk and unpins it", async () => {
    const { body } = await post("show me the team");
    const sig = body.turn.signature as string;
    const pin = (await app.inject({ method: "POST", url: `${URL}/pin`, payload: { signature: sig } })).json();
    expect(pin.desk.pinned).toHaveLength(1);
    const un = (await app.inject({ method: "DELETE", url: `${URL}/pin`, payload: { signature: sig } })).json();
    expect(un.desk.pinned).toHaveLength(0);
  });

  it("T2 unavailable → composes deterministically with a warning, never fails", async () => {
    const { status, body } = await post("why did spend spike?", {}); // no skipInference
    expect(status).toBe(200);
    expect(body.turn.composedBy).toBe("stub");
    expect(body.turn.layout.title).toBe("Token spend");
    expect(body.turn.warnings?.join(" ")).toMatch(/composed deterministically/);
  });

  it("clarify turns carry no layout and no proposal", async () => {
    const { body } = await post("purple monkey dishwasher");
    expect(body.turn.layout).toBeUndefined();
    expect(body.turn.proposalId).toBeUndefined();
  });

  it("restoreSignature recalls the exact stored workspace, not a reclassification", async () => {
    const { body } = await post("show me the team");
    const sig = body.turn.signature as string;
    // A title-derived message would classify this as spend; the signature must win.
    const r = await post("Show Session recap: budget & spend again", { skipInference: true, restoreSignature: sig });
    expect(r.body.turn.composedBy).toBe("memory");
    expect(r.body.turn.signature).toBe(sig);
    expect(r.body.turn.layout.title).toBe("Team");
  });

  it("restoreSignature for an evicted layout falls through to normal composition", async () => {
    const r = await post("why did spend spike?", { skipInference: true, restoreSignature: "cv9:0000000000000000" });
    expect(r.body.turn.composedBy).toBe("stub");
    expect(r.body.turn.layout.title).toBe("Token spend");
  });

  it("recalling a workspace carries the prior headline snapshot (delta-since-last-looked)", async () => {
    const usagePath = join(tempDir, "instances/default/companies", CO, "onboarding/token-usage.json");
    const usage = (total: number) => ({
      companyId: CO, started_at: "2026-07-01T00:00:00Z", updated_at: "2026-07-01T00:00:00Z",
      total: { input_tokens: total, output_tokens: 0, cached_input_tokens: 0, cost_usd: 1, duration_ms: 1, calls: 3 },
      by_phase: {}, recent_calls: [],
    });
    mkdirSync(dirname(usagePath), { recursive: true });
    writeFileSync(usagePath, JSON.stringify(usage(100_000)));

    // First serve: no prior snapshot → no `since`; a snapshot is taken.
    const first = await post("why did spend spike?");
    expect(first.body.turn.since).toBeUndefined();

    // The world moves on.
    writeFileSync(usagePath, JSON.stringify(usage(140_000)));

    // Recall (memory path): the turn carries what the numbers WERE.
    const second = await post("why did spend spike?");
    expect(second.body.turn.composedBy).toBe("memory");
    expect(second.body.turn.since.values["spend-total"]).toBe(100_000);

    // And the fresh snapshot advanced: a third look sees 140k as the baseline.
    const third = await post("why did spend spike?");
    expect(third.body.turn.since.values["spend-total"]).toBe(140_000);
  });

  it("morph, never replace: the same subject keeps its cell id across intents", async () => {
    // Spend workspace shows token-budget{} as "spend-cap"...
    await post("why did spend spike?");
    // ...so the budget workspace's cell (stub id "budget-gauge", same
    // subject) adopts the surviving id — the client morphs it in place.
    const r = await post("show the budget");
    expect(r.body.turn.layout.title).toBe("Token budget");
    expect(r.body.turn.layout.cells[0].id).toBe("spend-cap");

    // And a subject that did NOT appear before keeps its own id.
    const t = await post("show me the team");
    expect(t.body.turn.layout.cells[0].id).toBe("roster");
  });

  it("GET sweeps stale pending proposals to expired before the client can confirm them", async () => {
    const p = await post("set the token budget to 70k");
    const id = p.body.turn.proposalId as string;
    // Age the proposal past the TTL directly in the persisted file.
    const path = join(tempDir, "instances/default/companies", CO, "onboarding/canvas.json");
    const file = JSON.parse(readFileSync(path, "utf8"));
    file.proposals[id].created_at = new Date(Date.now() - 16 * 60_000).toISOString();
    writeFileSync(path, JSON.stringify(file));

    const g = (await app.inject({ method: "GET", url: URL })).json();
    const swept = g.proposals.find((x: { id: string }) => x.id === id);
    expect(swept.status).toBe("expired");
    expect(swept.outcome.detail).toMatch(/expired/);
    // And the sweep persisted: a second read agrees without re-sweeping.
    const g2 = (await app.inject({ method: "GET", url: URL })).json();
    expect(g2.proposals.find((x: { id: string }) => x.id === id).status).toBe("expired");
  });
});
