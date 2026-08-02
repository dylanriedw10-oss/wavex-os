/** The delegation walk engine — executive, not retrieval (spec §5).
 *
 *  R1 is the deterministic floor: routing reuses the canvas classifier, so
 *  the walk works without inference, in tests, and for capped companies —
 *  the same philosophy as the stub composer. The T2 tier (per-hop model
 *  decisions, reformulation, `convene`) lands in R2 on top of this exact
 *  step/stream shape.
 *
 *  Decisions emitted by the floor:
 *    precedent — a cited MemoryEntry answers this question at this node
 *    delegate  — a child (or the topic's metric node from company) holds it
 *    refer     — evidence lives OUTSIDE this subtree; names the node
 *    answered  — this node holds the evidence; answer built from its
 *                backend-computed snapshot (numbers are truth, not prose)
 *
 *  Every hop persists an InvestigationStep and lands in the in-memory walk
 *  registry the events endpoint streams from. Depth cap 8: the cap returns
 *  the deepest node's best-effort answer — partial beats dead end. Floor
 *  hops are instant, so "streamed as it happens" is client-paced in R1;
 *  the SSE shape is already the R2 live contract. */

import type { FastifyInstance } from "fastify";
import { classify } from "../canvas/composer.js";
import {
  addMemory, findPrecedent, newId, readOrg, writeOrg,
  type InvestigationStep, type OrgFile,
} from "./store.js";
import {
  buildNode, childrenOf, loadTreeCtx, TOPIC_NODE,
  type NodeChildRef, type OrgNodeDto,
} from "./nodes.js";

export interface WalkRecord {
  walkId: string;
  companyId: string;
  originNodeId: string;
  question: string;
  steps: InvestigationStep[];
  done: boolean;
  landedNodeId: string | null;
  answer: string | null;
}

const MAX_DEPTH = 8;
const REGISTRY = new Map<string, WalkRecord>();
const REGISTRY_CAP = 200;

export function getWalk(walkId: string): WalkRecord | null {
  return REGISTRY.get(walkId) ?? null;
}

function keywordsOf(text: string): Set<string> {
  return new Set(text.toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, " ").split(/\s+/).filter((w) => w.length > 2));
}

/** Deterministic child routing: a child whose title tokens appear in the
 *  question wins; ties go to the first in display order. */
function matchChild(question: string, children: NodeChildRef[]): NodeChildRef | null {
  const q = keywordsOf(question);
  for (const c of children) {
    const parts = c.title.toLowerCase().split(/[.\s_-]+/).filter(Boolean);
    if (parts.some((p) => q.has(p))) return c;
  }
  return null;
}

export async function runWalk(
  app: FastifyInstance,
  req: any,
  companyId: string,
  originNodeId: string,
  question: string,
  sessionId: string | null,
): Promise<WalkRecord> {
  const walkId = newId("walk");
  const record: WalkRecord = {
    walkId, companyId, originNodeId, question,
    steps: [], done: false, landedNodeId: null, answer: null,
  };
  REGISTRY.set(walkId, record);
  if (REGISTRY.size > REGISTRY_CAP) {
    const oldest = REGISTRY.keys().next().value;
    if (oldest) REGISTRY.delete(oldest);
  }

  const ctx = await loadTreeCtx(app, req, companyId);
  const org = await readOrg(companyId);

  const step = (
    node: OrgNodeDto, q: string, decision: InvestigationStep["decision"],
    delegatedToNodeId: string | null, answer: string | null,
  ): InvestigationStep => {
    const s: InvestigationStep = {
      id: newId("step"), walkId, sessionId,
      nodeId: node.id, nodeTitle: node.title,
      question: q, decision, delegatedToNodeId, answer,
      ts: new Date().toISOString(),
    };
    record.steps.push(s);
    org.steps.push(s);
    return s;
  };

  let current = buildNode(ctx, org, companyId, originNodeId);
  if (!current) {
    current = buildNode(ctx, org, companyId, "company")!;
  }
  let q = question;
  const topic = classify(question).topic;

  // Precedent first: the organization may already have learned this.
  const prior = findPrecedent(org, current.id, question);
  if (prior) {
    step(current, q, "precedent", null, prior.claim);
    record.done = true;
    record.landedNodeId = current.id;
    record.answer = prior.claim;
    await finish(companyId, org, record, /* remember */ false); // a precedent cites, it doesn't re-learn itself
    return record;
  }

  for (let depth = 0; depth < MAX_DEPTH; depth++) {
    const children = childrenOf(ctx, current.id);
    const metricTarget = TOPIC_NODE[topic];

    // The topic's evidence node, when it's among our children → delegate down.
    const metricChild = metricTarget ? children.find((c) => c.id === metricTarget) : null;
    if (metricChild && current.id !== metricChild.id) {
      step(current, q, "delegated", metricChild.id, null);
      current = buildNode(ctx, org, companyId, metricChild.id)!;
      q = `${q} (asked of ${current.title})`;
      continue;
    }

    // The evidence node exists but OUTSIDE this subtree → refer, don't fake it.
    if (metricTarget && current.kind !== "company" && current.kind !== "metric" && !metricChild) {
      const target = buildNode(ctx, org, companyId, metricTarget);
      if (target) {
        const answer = `${current.title} doesn't hold that evidence — ${target.title} should investigate.`;
        step(current, q, "referred", metricTarget, answer);
        record.done = true;
        record.landedNodeId = current.id;
        record.answer = answer;
        await finish(companyId, org, record, false);
        return record;
      }
    }

    // A named child (department/agent mentioned in the question) → walk down.
    const named = matchChild(q, children.filter((c) => c.kind === "department" || c.kind === "agent"));
    if (named && named.id !== current.id) {
      step(current, q, "delegated", named.id, null);
      current = buildNode(ctx, org, companyId, named.id)!;
      continue;
    }

    // This node holds the evidence: answer from its backend-computed state.
    const answer = `${current.title}: ${current.snapshot}`;
    step(current, q, "answered", null, answer);
    record.done = true;
    record.landedNodeId = current.id;
    record.answer = answer;
    await finish(companyId, org, record, true);
    return record;
  }

  // Depth cap: best-effort terminal at the deepest node reached.
  const answer = `${current.title}: ${current.snapshot} (walk hit the depth cap — partial answer)`;
  step(current, q, "answered", null, answer);
  record.done = true;
  record.landedNodeId = current.id;
  record.answer = answer;
  await finish(companyId, org, record, true);
  return record;
}

/** Persist steps; distill the walk into a CITED memory entry at the origin
 *  node (spec §4 — this is how interactions increase org intelligence). */
async function finish(companyId: string, org: OrgFile, record: WalkRecord, remember: boolean): Promise<void> {
  if (remember && record.answer && record.landedNodeId) {
    try {
      addMemory(org, {
        nodeId: record.originNodeId,
        question: record.question,
        claim: record.answer,
        citations: [
          { kind: "walk", id: record.walkId },
          ...record.steps.map((s) => ({ kind: "walk" as const, id: s.id })),
        ],
      });
    } catch { /* memory degrades, never blocks a walk */ }
  }
  if (org.steps.length > 2000) org.steps = org.steps.slice(-2000);
  await writeOrg(companyId, org);
}
