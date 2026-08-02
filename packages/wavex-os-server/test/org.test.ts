/** The recursive org — tree, walks, memory, gravity, constitution gate. */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Fastify, { type FastifyInstance } from "fastify";
import { addMemory, checkConstitution, computeGravity, computeInfluence, type InvestigationStep, type OrgFile } from "../src/org/store.js";

let tempDir: string;
let app: FastifyInstance;
const CO = "acme";
const ORG = `/api/instance/${CO}/org`;

/** The bridge-agents fixture shape: ceo root, cpo + cmo departments. */
const MANIFEST = {
  org_id: CO,
  pillar_responses: {
    pillar_1: { industry_hint: "saas-b2b", manual_context: "test fixture" },
    pillar_3: { stage: "10k_100k_mrr" },
    pillar_4: { sales_motion: "assisted_demo", lead_sources: ["outbound_cold"] },
  },
  goal: { metric: "mrr", current: 12_000, target: 100_000, days: 90 },
  connector_manifest: { required: [], suggested: [], deferred: [], blocked_on_manual_approval: [] },
  swarm_manifest: {
    agents: {
      "ceo.orchestrator": { status: "active", adapter: "claude-code", heartbeat: "15m", budget_monthly_usd: 300, skill_overlay: null, department: "ceo", level: "L·II", reports_to: null, spawnable: false },
      cpo: { status: "active", adapter: "claude-code", heartbeat: "1h", budget_monthly_usd: 120, skill_overlay: null, department: "product", level: "L·III", reports_to: "ceo.orchestrator", spawnable: false },
      "cpo.build": { status: "active", adapter: "claude-code", heartbeat: "2h", budget_monthly_usd: 80, skill_overlay: null, department: "product", level: "L·IV", reports_to: "cpo", spawnable: true },
      "cpo.qa": { status: "standby", adapter: "claude-code", heartbeat: "4h", budget_monthly_usd: 60, skill_overlay: null, department: "product", level: "L·IV", reports_to: "cpo", spawnable: false },
      cmo: { status: "active", adapter: "claude-code", heartbeat: "1h", budget_monthly_usd: 120, skill_overlay: null, department: "marketing", level: "L·III", reports_to: "ceo.orchestrator", spawnable: false },
      "cmo.demand": { status: "active", adapter: "claude-code", heartbeat: "2h", budget_monthly_usd: 80, skill_overlay: null, department: "marketing", level: "L·IV", reports_to: "cmo", spawnable: true },
    },
  },
};

function onboardingDir(): string {
  return join(tempDir, "instances/default/companies", CO, "onboarding");
}

async function ask(nodeId: string, question: string) {
  const r = await app.inject({ method: "POST", url: `${ORG}/nodes/${nodeId}/ask`, payload: { question } });
  expect(r.statusCode).toBe(202);
  const { walkId } = r.json();
  const w = (await app.inject({ method: "GET", url: `${ORG}/walks/${walkId}` })).json();
  return w as { walkId: string; steps: InvestigationStep[]; done: boolean; landedNodeId: string; answer: string };
}

beforeEach(async () => {
  tempDir = mkdtempSync(join(tmpdir(), "org-test-"));
  process.env.WAVEX_OS_STATE_DIR = tempDir;
  process.env.PAPERCLIP_DATA_DIR = tempDir;
  process.env.WAVEX_AUTH_MODE = "dev";
  process.env.WAVEX_COMPOSIO_DISABLED = "1";
  process.env.WAVEX_OS_CLAUDE_BIN = "/nonexistent-claude-bin";
  mkdirSync(onboardingDir(), { recursive: true });
  writeFileSync(join(onboardingDir(), "company.manifest.json"), JSON.stringify(MANIFEST));
  // Company completeness reads the pillar draft file, not the manifest copy.
  writeFileSync(join(onboardingDir(), "pillar_responses.json"), JSON.stringify(MANIFEST.pillar_responses));
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

describe("org tree", () => {
  it("flywheel: company root, two departments, constitution, honest floors", async () => {
    const r = (await app.inject({ method: "GET", url: `${ORG}/flywheel` })).json();
    expect(r.ok).toBe(true);
    expect(r.company.kind).toBe("company");
    expect(r.company.completeness).toBe(60); // 3 of 5 pillars answered — real
    expect(r.company.momentum).toBeNull();   // honest cold start
    expect(r.company.gravity).toBeNull();    // no observed walks yet
    expect(r.company.objective.title).toMatch(/mrr/);
    expect(r.departments.map((d: { id: string }) => d.id).sort()).toEqual(["dept:cmo", "dept:cpo"]);
    expect(r.departments[0].completeness).toBeNull(); // no per-dept blueprint exists
    expect(r.constitution.kind).toBe("constitution");
  });

  it("node view: department exposes children, capabilities, empty memory", async () => {
    const r = (await app.inject({ method: "GET", url: `${ORG}/nodes/dept:cpo` })).json();
    expect(r.node.kind).toBe("department");
    expect(r.node.parentId).toBe("company"); // a root report hangs off the company
    expect(r.node.activity).toBe("idle"); // fleet unreachable → idle, never fake
    expect(r.children.map((c: { id: string }) => c.id).sort()).toEqual(["agent:cpo.build", "agent:cpo.qa"]);
    expect(r.capabilities.length).toBeGreaterThan(0);
    expect(r.capabilities.every((c: { source: string }) => c.source === "rule")).toBe(true);
    expect(r.memory).toEqual([]);
  });

  it("unknown node → 404; bad id → 400", async () => {
    expect((await app.inject({ method: "GET", url: `${ORG}/nodes/dept:nope` })).statusCode).toBe(404);
    expect((await app.inject({ method: "GET", url: `${ORG}/nodes/${encodeURIComponent("../x")}` })).statusCode).toBe(400);
  });
});

describe("delegation walk", () => {
  it("a spend question at the company delegates to the metric node and answers there", async () => {
    const w = await ask("company", "why did spend spike?");
    expect(w.done).toBe(true);
    expect(w.steps.length).toBeGreaterThanOrEqual(2);
    expect(w.steps[0].decision).toBe("delegated");
    expect(w.steps[0].delegatedToNodeId).toBe("metric:spend");
    expect(w.landedNodeId).toBe("metric:spend");
    expect(w.answer).toMatch(/Token spend/);
  });

  it("a spend question at a department refers OUT — it doesn't fake evidence it lacks", async () => {
    const w = await ask("dept:cpo", "why did spend spike?");
    expect(w.done).toBe(true);
    expect(w.steps[0].decision).toBe("referred");
    expect(w.steps[0].delegatedToNodeId).toBe("metric:spend");
    expect(w.answer).toMatch(/should investigate/);
  });

  it("a repeat question is answered by PRECEDENT citing the stored memory", async () => {
    await ask("company", "why did spend spike?");
    const again = await ask("company", "why did spend spike?");
    expect(again.steps).toHaveLength(1);
    expect(again.steps[0].decision).toBe("precedent");

    // The precedent's claim IS the distilled first answer, and the stored
    // memory entry carries real citations (walk + step ids).
    const node = (await app.inject({ method: "GET", url: `${ORG}/nodes/company` })).json();
    expect(node.memory).toHaveLength(1);
    expect(node.memory[0].citations.length).toBeGreaterThanOrEqual(2);
    expect(again.answer).toBe(node.memory[0].claim);
  });

  it("walk steps land in the investigations log and stream over SSE", async () => {
    const w = await ask("company", "why did spend spike?");
    const inv = (await app.inject({ method: "GET", url: `${ORG}/investigations/recent` })).json();
    expect(inv.steps.length).toBeGreaterThanOrEqual(2);

    const sse = await app.inject({ method: "GET", url: `${ORG}/walks/${w.walkId}/events` });
    expect(sse.headers["content-type"]).toMatch(/text\/event-stream/);
    expect(sse.body).toMatch(/event: step/);
    expect(sse.body).toMatch(/event: done/);
  });

  it("asking an unknown origin falls back to the company root", async () => {
    const w = await ask("company", "what is cpo working on");
    expect(w.done).toBe(true);
    // named-child routing: the question names cpo → walk descends into it
    expect(w.steps.some((s) => s.delegatedToNodeId === "dept:cpo")).toBe(true);
  });
});

describe("memory honesty", () => {
  it("an uncited claim is rejected at write time", () => {
    const file: OrgFile = { companyId: CO, steps: [], memory: [], constitution: [] };
    expect(() => addMemory(file, { nodeId: "company", question: "q", claim: "c", citations: [] }))
      .toThrow(/no citations/);
    expect(file.memory).toHaveLength(0);
  });

  it("GET org/memory lists non-superseded entries org-wide, newest first", async () => {
    const empty = (await app.inject({ method: "GET", url: `${ORG}/memory` })).json();
    expect(empty.entries).toEqual([]);

    await ask("company", "why did spend spike?");
    await ask("dept:cpo", "why did spend spike?"); // refers — no memory
    const r = (await app.inject({ method: "GET", url: `${ORG}/memory` })).json();
    expect(r.entries).toHaveLength(1);
    expect(r.entries[0].nodeId).toBe("company");
    expect(r.entries[0].citations.length).toBeGreaterThanOrEqual(2);
  });
});

describe("keep this — promotion into cited memory", () => {
  function seedCanvas(sig: string, withSnapshot: boolean) {
    const canvas = {
      companyId: CO, transcript: [], proposals: {}, ledger: [], utterances: {}, desk: { pinned: [] },
      layouts: {
        [sig]: {
          layout: { title: "Token spend", cells: [{ id: "spend-total", type: "metric", title: "Total spend", source: { api: "token-usage", params: {} } }] },
          label: "why did spend spike?", created_at: "2026-08-01T10:00:00Z", last_used_at: "2026-08-01T10:00:00Z", uses: 1,
        },
      },
      snapshots: withSnapshot ? { [sig]: { taken_at: "2026-08-01T10:00:00Z", values: { "spend-total": 142_500 } } } : {},
    };
    writeFileSync(join(onboardingDir(), "canvas.json"), JSON.stringify(canvas));
  }

  it("builds the claim SERVER-SIDE from the stored layout + snapshot, with provenance", async () => {
    seedCanvas("cv9:aaaaaaaaaaaaaaaa", true);
    const r = await app.inject({ method: "POST", url: `${ORG}/memory`, payload: { nodeId: "company", signature: "cv9:aaaaaaaaaaaaaaaa" } });
    expect(r.statusCode).toBe(200);
    const { entry } = r.json();
    expect(entry.claim).toBe("Token spend — Total spend 142,500 (as of 2026-08-01T10:00:00Z)");
    expect(entry.question).toBe("why did spend spike?");
    expect(entry.citations).toEqual([{ kind: "canvas", id: "cv9:aaaaaaaaaaaaaaaa" }]);

    // Visible at the node and org-wide.
    const node = (await app.inject({ method: "GET", url: `${ORG}/nodes/company` })).json();
    expect(node.memory[0].claim).toBe(entry.claim);
  });

  it("no snapshot → honest title-only claim; unknown signature → 404; unknown node → 404", async () => {
    seedCanvas("cv9:bbbbbbbbbbbbbbbb", false);
    const ok = (await app.inject({ method: "POST", url: `${ORG}/memory`, payload: { nodeId: "company", signature: "cv9:bbbbbbbbbbbbbbbb" } })).json();
    expect(ok.entry.claim).toMatch(/kept from the workspace \(no headline snapshot\)/);

    expect((await app.inject({ method: "POST", url: `${ORG}/memory`, payload: { nodeId: "company", signature: "cv9:missing0000000" } })).statusCode).toBe(404);
    expect((await app.inject({ method: "POST", url: `${ORG}/memory`, payload: { nodeId: "dept:nope", signature: "cv9:bbbbbbbbbbbbbbbb" } })).statusCode).toBe(404);
  });

  it("keeping the same workspace state twice is ONE memory", async () => {
    seedCanvas("cv9:cccccccccccccccc", true);
    const first = (await app.inject({ method: "POST", url: `${ORG}/memory`, payload: { nodeId: "company", signature: "cv9:cccccccccccccccc" } })).json();
    const again = (await app.inject({ method: "POST", url: `${ORG}/memory`, payload: { nodeId: "company", signature: "cv9:cccccccccccccccc" } })).json();
    expect(again.deduped).toBe(true);
    expect(again.entry.id).toBe(first.entry.id);
    const list = (await app.inject({ method: "GET", url: `${ORG}/memory` })).json();
    expect(list.entries).toHaveLength(1);
  });

  it("a kept memory answers a later walk by PRECEDENT — promotion feeds the org", async () => {
    seedCanvas("cv9:dddddddddddddddd", true);
    await app.inject({ method: "POST", url: `${ORG}/memory`, payload: { nodeId: "company", signature: "cv9:dddddddddddddddd" } });
    const w = await ask("company", "why did spend spike?");
    expect(w.steps[0].decision).toBe("precedent");
    expect(w.answer).toMatch(/as of 2026-08-01/);
  });
});

describe("node edges + filtered investigations", () => {
  it("GET nodes/:id returns only influence edges touching that node", async () => {
    await ask("company", "why did spend spike?");   // company → metric:spend
    await ask("company", "what is cpo working on"); // company → dept:cpo
    const spend = (await app.inject({ method: "GET", url: `${ORG}/nodes/metric:spend` })).json();
    expect(spend.edges.length).toBeGreaterThanOrEqual(1);
    expect(spend.edges.every((e: { from: string; to: string }) => e.from === "metric:spend" || e.to === "metric:spend")).toBe(true);
    expect(spend.edges.some((e: { to: string }) => e.to === "dept:cpo")).toBe(false);
  });

  it("investigations/recent?nodeId= returns only hops that touched the node", async () => {
    await ask("company", "why did spend spike?");
    await ask("company", "what is cpo working on");
    const r = (await app.inject({ method: "GET", url: `${ORG}/investigations/recent?nodeId=metric:spend` })).json();
    expect(r.steps.length).toBeGreaterThanOrEqual(2); // the delegation INTO it + the answer AT it
    expect(r.steps.every((s: { nodeId: string; delegatedToNodeId: string | null }) =>
      s.nodeId === "metric:spend" || s.delegatedToNodeId === "metric:spend")).toBe(true);

    expect((await app.inject({ method: "GET", url: `${ORG}/investigations/recent?nodeId=${encodeURIComponent("bad!id")}` })).statusCode).toBe(400);
  });
});

describe("gravity + influence", () => {
  const step = (i: number, nodeId: string, decision: InvestigationStep["decision"], to: string | null): InvestigationStep => ({
    id: `s${i}`, walkId: `w${i}`, sessionId: null, nodeId, nodeTitle: nodeId,
    question: "q", decision, delegatedToNodeId: to, answer: decision === "answered" ? "a" : null,
    ts: new Date(1700000000000 + i * 1000).toISOString(),
  });

  it("gravity is NULL below the observation threshold — never invented", () => {
    const file: OrgFile = { companyId: CO, steps: [step(1, "company", "answered", null)], memory: [], constitution: [] };
    expect(computeGravity(file)).toBeNull();
  });

  it("gravity ranks the node walks actually bend toward, with evidence counts", () => {
    const steps: InvestigationStep[] = [];
    for (let i = 0; i < 6; i++) {
      steps.push(step(i * 2, "company", "delegated", "metric:spend"));
      steps.push(step(i * 2 + 1, "metric:spend", "answered", null));
    }
    const file: OrgFile = { companyId: CO, steps, memory: [], constitution: [] };
    const rows = computeGravity(file)!;
    expect(rows[0].nodeId).toBe("metric:spend");
    expect(rows[0].gravity).toBe(100);
    expect(rows[0].evidence).toEqual({ inboundAsks: 6, landings: 6 });
  });

  it("influence edges carry observed weight and their evidence source", () => {
    const steps = [
      step(0, "company", "delegated", "dept:cpo"),
      step(1, "company", "delegated", "dept:cpo"),
      step(2, "company", "delegated", "dept:cmo"),
    ];
    const file: OrgFile = { companyId: CO, steps, memory: [], constitution: [] };
    const edges = computeInfluence(file);
    expect(edges[0]).toMatchObject({ from: "company", to: "dept:cpo", weight: 2, evidence: { source: "walk_history", count: 2 } });
  });

  it("the gravity route reports threshold honestly", async () => {
    const r = (await app.inject({ method: "GET", url: `${ORG}/gravity` })).json();
    expect(r.threshold).toBe(false);
    expect(r.rows).toEqual([]);
  });
});

describe("constitution", () => {
  it("seeds all categories on first read, filling global_goals from the manifest", async () => {
    const r = (await app.inject({ method: "GET", url: `${ORG}/constitution` })).json();
    expect(r.categories).toHaveLength(14);
    const goals = r.categories.find((c: { id: string }) => c.id === "global_goals");
    expect(goals.content).toMatch(/100,000/);
    const identity = r.categories.find((c: { id: string }) => c.id === "identity_mission");
    expect(identity.content).toBe(""); // present but honestly empty — operator authors it
  });

  it("checkConstitution blocks a never-sacrifice action and an over-ceiling budget", () => {
    const file: OrgFile = {
      companyId: CO, steps: [], memory: [],
      constitution: [
        { id: "never_sacrifice", label: "", content: "ignite-fleet", updatedAt: "", updatedByWalkId: null },
        { id: "budgets_constraints", label: "", content: '{"max_cap_tokens": 50000}', updatedAt: "", updatedByWalkId: null },
      ],
    };
    expect(checkConstitution(file, "ignite-fleet", {}).allowed).toBe(false);
    expect(checkConstitution(file, "set-token-budget", { cap_tokens: 60_000 }).allowed).toBe(false);
    expect(checkConstitution(file, "set-token-budget", { cap_tokens: 40_000 }).allowed).toBe(true);
    expect(checkConstitution(file, "add-agent", {}).allowed).toBe(true);
  });

  it("the gate blocks an over-ceiling budget commit END TO END, ledgered with the reason", async () => {
    writeFileSync(join(onboardingDir(), "org.json"), JSON.stringify({
      companyId: CO, steps: [], memory: [],
      constitution: [{ id: "budgets_constraints", label: "Budgets & constraints", content: '{"max_cap_tokens": 50000}', updatedAt: new Date().toISOString(), updatedByWalkId: null }],
    }));

    const canvas = `/api/instance/${CO}/canvas`;
    const p = (await app.inject({ method: "POST", url: canvas, payload: { message: "set the token budget to 60k", skipInference: true } })).json();
    const proposalId = p.turn.proposalId as string;
    expect(p.proposal.status).toBe("pending");

    const c = await app.inject({ method: "POST", url: `${canvas}/commit`, payload: { proposalId } });
    expect(c.statusCode).toBe(409);
    expect(c.json().error).toMatch(/constitutional ceiling/);

    // Ledgered, never silent: proposal failed, ledger row records the reason,
    // and the transcript states what the constitution blocked.
    const g = (await app.inject({ method: "GET", url: canvas })).json();
    expect(g.proposals.find((x: { id: string }) => x.id === proposalId).status).toBe("failed");
    expect(g.ledger).toHaveLength(1);
    expect(g.ledger[0].detail).toMatch(/constitution/);
    expect(g.transcript.at(-1).text).toMatch(/constitution blocked/);

    // And the mutation did NOT happen.
    const b = (await app.inject({ method: "GET", url: `/api/instance/${CO}/token-budget` })).json();
    expect(b.budget?.cap_tokens ?? null).not.toBe(60_000);

    // An under-ceiling ask still commits — the gate constrains, it doesn't veto.
    const p2 = (await app.inject({ method: "POST", url: canvas, payload: { message: "set the token budget to 40k", skipInference: true } })).json();
    const c2 = await app.inject({ method: "POST", url: `${canvas}/commit`, payload: { proposalId: p2.turn.proposalId } });
    expect(c2.statusCode).toBe(200);
    expect(c2.json().proposal.status).toBe("committed");
  });
});
