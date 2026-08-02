/** The recursive org routes (docs/RECURSIVE_ORG_SPEC.md, R1).
 *
 *    GET  /api/instance/:companyId/org/flywheel        departments + constitution + influence
 *    GET  /api/instance/:companyId/org/nodes/:nodeId   node + children + capabilities + memory
 *    POST /api/instance/:companyId/org/nodes/:nodeId/ask   → 202 { walkId }
 *    GET  /api/instance/:companyId/org/walks/:walkId        JSON poll (steps, done, answer)
 *    GET  /api/instance/:companyId/org/walks/:walkId/events SSE replay-then-done
 *    GET  /api/instance/:companyId/org/constitution
 *    GET  /api/instance/:companyId/org/gravity
 *    GET  /api/instance/:companyId/org/investigations/recent
 *
 *  House guard on everything; SSE follows the replay-on-connect pattern. */

import { z } from "zod";
import type { FastifyInstance } from "fastify";
import { assertBoard, assertCompanyAccess, AuthError } from "@wavex-os/auth-shim";
import { COMPANY_ID_RE, authReq } from "./ignition.js";
import { readState as readCanvasState } from "./canvas.js";
import {
  buildNode, capabilitiesOf, childrenOf, loadTreeCtx, childId,
} from "../org/nodes.js";
import { runWalk, getWalk } from "../org/walk.js";
import {
  addMemory, computeGravity, computeInfluence, readOrg, seedConstitution, writeOrg,
} from "../org/store.js";

const askSchema = z.object({
  question: z.string().min(1).max(1500),
  sessionId: z.string().max(60).optional(),
});

const keepSchema = z.object({
  nodeId: z.string().min(1).max(80),
  signature: z.string().min(1).max(40),
  question: z.string().min(1).max(1500).optional(),
});

const NODE_ID_RE = /^[a-z0-9_.:-]{1,80}$/i;

type Reply = { status: (n: number) => { send: (b: unknown) => unknown } };

function guard(app: FastifyInstance, handler: (companyId: string, req: any, reply: any) => Promise<unknown>) {
  return async (req: any, reply: Reply) => {
    const { companyId } = req.params as { companyId: string };
    if (!COMPANY_ID_RE.test(companyId)) {
      return reply.status(400).send({ ok: false, error: "invalid companyId" });
    }
    const ar = authReq(req);
    try {
      assertBoard(ar);
      assertCompanyAccess(ar, companyId);
    } catch (e) {
      if (e instanceof AuthError) return reply.status(e.statusCode).send({ error: e.message });
      throw e;
    }
    return handler(companyId, req, reply);
  };
}

export function registerOrgRoutes(app: FastifyInstance): void {
  app.get("/api/instance/:companyId/org/flywheel", guard(app, async (companyId, req) => {
    const ctx = await loadTreeCtx(app, req, companyId);
    const org = await readOrg(companyId);
    const company = buildNode(ctx, org, companyId, "company")!;
    const departments = childrenOf(ctx, "company")
      .filter((c) => c.kind === "department")
      .map((c) => buildNode(ctx, org, companyId, c.id)!)
      .filter(Boolean);
    return {
      ok: true,
      company,
      departments,
      constitution: buildNode(ctx, org, companyId, "constitution"),
      influence: computeInfluence(org).slice(0, 20),
    };
  }));

  app.get("/api/instance/:companyId/org/nodes/:nodeId", guard(app, async (companyId, req, reply) => {
    const { nodeId } = req.params as { nodeId: string };
    if (!NODE_ID_RE.test(nodeId)) return reply.status(400).send({ ok: false, error: "invalid nodeId" });
    const ctx = await loadTreeCtx(app, req, companyId);
    const org = await readOrg(companyId);
    const node = buildNode(ctx, org, companyId, nodeId);
    if (!node) return reply.status(404).send({ ok: false, error: "no such node" });
    return {
      ok: true,
      node,
      children: childrenOf(ctx, nodeId),
      capabilities: capabilitiesOf(node),
      memory: org.memory.filter((m) => m.nodeId === nodeId && !m.supersededBy).slice(-8).reverse(),
      // Relationships: influence edges touching this node — observed walk
      // history only, never authored.
      edges: computeInfluence(org).filter((e) => e.from === nodeId || e.to === nodeId).slice(0, 12),
    };
  }));

  // Org-wide learned memory — the Views layer's "Learned" read.
  app.get("/api/instance/:companyId/org/memory", guard(app, async (companyId) => {
    const org = await readOrg(companyId);
    return { ok: true, entries: org.memory.filter((m) => !m.supersededBy).slice(-50).reverse() };
  }));

  /** Promotion v1 (docs/RECURSIVE_ORG_SPEC.md §promotion): "Keep this"
   *  turns an ephemeral workspace into cited org memory. The CLAIM is
   *  constructed here from the stored layout + headline snapshot — the
   *  client sends only an address, never text, so nothing uncited or
   *  operator-invented can enter memory through this door. */
  app.post("/api/instance/:companyId/org/memory", guard(app, async (companyId, req, reply) => {
    const parsed = keepSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.status(400).send({ ok: false, error: "validation failed", issues: parsed.error.issues });
    }
    const { nodeId, signature } = parsed.data;
    if (!NODE_ID_RE.test(nodeId)) return reply.status(400).send({ ok: false, error: "invalid nodeId" });

    const ctx = await loadTreeCtx(app, req, companyId);
    const org = await readOrg(companyId);
    if (!buildNode(ctx, org, companyId, nodeId)) {
      return reply.status(404).send({ ok: false, error: "no such node" });
    }

    const canvas = await readCanvasState(companyId);
    const stored = canvas.layouts[signature];
    if (!stored) {
      return reply.status(404).send({ ok: false, error: "no such workspace — it may have been evicted; ask again first" });
    }
    const snap = canvas.snapshots[signature];
    const cellTitle = (id: string) => stored.layout.cells.find((c) => c.id === id)?.title ?? id;
    const lines = snap
      ? Object.entries(snap.values).map(([id, v]) => `${cellTitle(id)} ${v.toLocaleString()}`).join(" · ")
      : "";
    const claim = snap && lines
      ? `${stored.layout.title} — ${lines} (as of ${snap.taken_at})`
      : `${stored.layout.title} — kept from the workspace (no headline snapshot)`;
    const question = parsed.data.question ?? stored.label;

    // Idempotent: keeping the same workspace state twice is one memory.
    const existing = org.memory.find((m) =>
      m.nodeId === nodeId && !m.supersededBy && m.claim === claim
      && m.citations.some((c) => c.kind === "canvas" && c.id === signature));
    if (existing) return { ok: true, entry: existing, deduped: true };

    try {
      const entry = addMemory(org, {
        nodeId, question, claim,
        citations: [{ kind: "canvas", id: signature }],
      });
      await writeOrg(companyId, org);
      return { ok: true, entry };
    } catch (e) {
      return reply.status(422).send({ ok: false, error: (e as Error).message });
    }
  }));

  app.post("/api/instance/:companyId/org/nodes/:nodeId/ask", guard(app, async (companyId, req, reply) => {
    const { nodeId } = req.params as { nodeId: string };
    if (!NODE_ID_RE.test(nodeId)) return reply.status(400).send({ ok: false, error: "invalid nodeId" });
    const parsed = askSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.status(400).send({ ok: false, error: "validation failed", issues: parsed.error.issues });
    }
    const record = await runWalk(app, req, companyId, nodeId, parsed.data.question, parsed.data.sessionId ?? null);
    return reply.status(202).send({ ok: true, walkId: record.walkId });
  }));

  app.get("/api/instance/:companyId/org/walks/:walkId", guard(app, async (companyId, req, reply) => {
    const { walkId } = req.params as { walkId: string };
    const w = getWalk(walkId);
    if (!w || w.companyId !== companyId) return reply.status(404).send({ ok: false, error: "no such walk" });
    return { ok: true, walkId: w.walkId, steps: w.steps, done: w.done, landedNodeId: w.landedNodeId, answer: w.answer };
  }));

  app.get("/api/instance/:companyId/org/walks/:walkId/events", guard(app, async (companyId, req, reply) => {
    const { walkId } = req.params as { walkId: string };
    const w = getWalk(walkId);
    if (!w || w.companyId !== companyId) return reply.status(404).send({ ok: false, error: "no such walk" });
    // Replay-then-done (the mock-core SSE pattern). R1 walks complete before
    // the stream is opened; the event shape is already the R2 live contract.
    reply.raw.writeHead(200, {
      "content-type": "text/event-stream",
      "cache-control": "no-cache",
      connection: "keep-alive",
    });
    for (const s of w.steps) {
      reply.raw.write(`event: step\ndata: ${JSON.stringify(s)}\n\n`);
    }
    if (w.done) {
      reply.raw.write(`event: done\ndata: ${JSON.stringify({ landedNodeId: w.landedNodeId, answer: w.answer })}\n\n`);
    }
    reply.raw.end();
    return reply;
  }));

  app.get("/api/instance/:companyId/org/constitution", guard(app, async (companyId, req) => {
    const ctx = await loadTreeCtx(app, req, companyId);
    const org = await readOrg(companyId);
    const before = org.constitution.length;
    seedConstitution(
      org,
      ctx.goal?.target != null
        ? `${ctx.goal.metric ?? "goal"}: ${ctx.goal.current?.toLocaleString() ?? "?"} → ${ctx.goal.target.toLocaleString()}${ctx.goal.days ? ` in ${ctx.goal.days}d` : ""}`
        : null,
    );
    if (org.constitution.length !== before) await writeOrg(companyId, org);
    return { ok: true, categories: org.constitution };
  }));

  app.get("/api/instance/:companyId/org/gravity", guard(app, async (companyId) => {
    const org = await readOrg(companyId);
    const rows = computeGravity(org);
    return {
      ok: true,
      threshold: rows !== null,
      rows: rows ?? [],
      observedSteps: org.steps.length,
    };
  }));

  app.get("/api/instance/:companyId/org/investigations/recent", guard(app, async (companyId, req, reply) => {
    const { sessionId, nodeId } = (req.query ?? {}) as { sessionId?: string; nodeId?: string };
    if (nodeId && !NODE_ID_RE.test(nodeId)) {
      return reply.status(400).send({ ok: false, error: "invalid nodeId" });
    }
    const org = await readOrg(companyId);
    let steps = sessionId ? org.steps.filter((s) => s.sessionId === sessionId) : org.steps;
    // "Touched this node": hops that happened AT it or were delegated INTO it.
    if (nodeId) steps = steps.filter((s) => s.nodeId === nodeId || s.delegatedToNodeId === nodeId);
    return { ok: true, steps: steps.slice(-30).reverse() };
  }));

  // referenced to keep the tree helpers exported-and-used from one place
  void childId;
}
