/** The cognitive canvas transport.
 *
 *    GET  /api/instance/:companyId/canvas          → { ok, transcript, proposals, ledger, desk }
 *    POST /api/instance/:companyId/canvas          { message } → { ok, turn, warnings }
 *    POST /api/instance/:companyId/canvas/commit   { proposalId } → { ok, turn, proposal }
 *    POST /api/instance/:companyId/canvas/pin      { signature, title } → { ok, desk }
 *    DELETE /api/instance/:companyId/canvas/pin    { signature } → { ok, desk }
 *
 *  Persistence model (canvas.json, atomic tmp+rename with a unique suffix):
 *  - transcript: capped at 40 turns — a context-window policy, not forgetting
 *  - proposals:  their own map, NOT transcript-embedded, so the cap can never
 *                trim a pending proposal out from under its confirm button
 *  - ledger:     committed/failed outcomes — NEVER trimmed. Dies only with
 *                the company (DELETE /reset wipes the dir; that is accepted:
 *                reset is destructive by design)
 *  - layouts:    signature → layout cache, LRU-capped 50 (a cache, not a ledger)
 *  - utterances: normalized-text → signature aliases, LRU-capped 200
 *  - desk:       pinned workspaces
 *
 *  Composition here is the deterministic ladder only (memory → stub). The T2
 *  tier lands separately; stub composition is never budget-gated — a capped
 *  company still gets layouts.
 *
 *  Single-writer assumption: two tabs POSTing concurrently interleave
 *  read-modify-write (same limitation as help-chat.json). Acceptable for a
 *  single local operator. */

import { randomBytes } from "node:crypto";
import { readFile, writeFile, mkdir, rename } from "node:fs/promises";
import { dirname, join } from "node:path";
import { z } from "zod";
import type { FastifyInstance } from "fastify";
import { assertBoard, assertCompanyAccess, AuthError } from "@wavex-os/auth-shim";
import { getOnboardingDir } from "../state-bridge.js";
import {
  COMMIT_ALLOWLIST, READ_BINDINGS, type CommitAction, type LayoutSpec, validateLayout,
} from "../canvas/catalog.js";
import { composeStub, classify, intentSignature, utteranceKey } from "../canvas/composer.js";
import { composeT2OrStub, type T2Composition } from "../canvas/composer-t2.js";
import { HEADLINES, type Snapshot } from "../canvas/snapshot.js";
import { checkConstitution, readOrg } from "../org/store.js";
import { COMPANY_ID_RE, authReq } from "./ignition.js";

const MAX_TRANSCRIPT = 40;
const MAX_MESSAGE_LEN = 1500;
const LAYOUT_LRU = 50;
const UTTERANCE_LRU = 200;
const PROPOSAL_TTL_MS = 15 * 60_000;
const RESHAPE_RE = /\b(differently|different view|another way|rebuild (this|it|that))\b/i;

export interface CanvasProposal {
  id: string;
  action: CommitAction;
  body: Record<string, unknown>;
  summary: string;
  created_at: string;
  status: "pending" | "committed" | "failed" | "expired";
  outcome?: { at: string; detail: string };
}

export interface CanvasTurn {
  role: "user" | "assistant";
  ts_iso: string;
  text: string;
  intent?: string;
  layout?: LayoutSpec;
  signature?: string;
  composedBy?: "memory" | "stub" | "t2";
  threadId?: string;
  proposalId?: string;
  warnings?: string[];
  /** The PRIOR headline snapshot for this signature — what the numbers were
   *  when the operator last looked. Cells render the delta. */
  since?: Snapshot;
}

interface LedgerEntry {
  ts_iso: string;
  proposalId: string;
  summary: string;
  action: CommitAction;
  status: "committed" | "failed";
  detail?: string;
}

interface CanvasFile {
  companyId: string;
  transcript: CanvasTurn[];
  proposals: Record<string, CanvasProposal>;
  ledger: LedgerEntry[];
  layouts: Record<string, { layout: LayoutSpec; label: string; created_at: string; last_used_at: string; uses: number }>;
  /** signature → headline values at last serve (delta-since-last-looked) */
  snapshots: Record<string, Snapshot>;
  utterances: Record<string, string>;
  desk: { pinned: Array<{ signature: string; title: string; pinned_at: string }> };
}

function emptyFile(companyId: string): CanvasFile {
  return { companyId, transcript: [], proposals: {}, ledger: [], layouts: {}, snapshots: {}, utterances: {}, desk: { pinned: [] } };
}

function canvasPath(companyId: string): string {
  return join(getOnboardingDir(companyId), "canvas.json");
}

/** Exported read-only for the org routes ("Keep this" builds a memory claim
 *  from a stored layout + snapshot). Nothing outside this file may WRITE. */
export async function readState(companyId: string): Promise<CanvasFile> {
  try {
    const raw = JSON.parse(await readFile(canvasPath(companyId), "utf8")) as Partial<CanvasFile>;
    return { ...emptyFile(companyId), ...raw };
  } catch {
    return emptyFile(companyId);
  }
}

async function writeState(companyId: string, file: CanvasFile): Promise<void> {
  const path = canvasPath(companyId);
  await mkdir(dirname(path), { recursive: true });
  const tmp = `${path}.${randomBytes(4).toString("hex")}.tmp`;
  await writeFile(tmp, JSON.stringify(file, null, 2), "utf8");
  await rename(tmp, path);
}

function lruTrim<T extends { last_used_at?: string }>(map: Record<string, T>, cap: number, ts: (v: T) => string): void {
  const keys = Object.keys(map);
  if (keys.length <= cap) return;
  keys.sort((a, b) => ts(map[a]).localeCompare(ts(map[b])))
    .slice(0, keys.length - cap)
    .forEach((k) => delete map[k]);
}

const postSchema = z.object({
  message: z.string().min(1).max(MAX_MESSAGE_LEN),
  /** House idiom (phases.ts): force the deterministic composer. Tests and
   *  inference-less dev use this; T2 failures fall back to it anyway. */
  skipInference: z.boolean().optional(),
  /** Signature-addressed recall (pin restore). Classifying a stored layout's
   *  title back into a topic is lossy — T2-composed titles like "Session
   *  recap: budget & spend" misclassify. When set and the layout is still
   *  known, it is returned as a memory turn; when evicted, the message
   *  composes normally. */
  restoreSignature: z.string().min(1).max(40).optional(),
});
const commitSchema = z.object({ proposalId: z.string().min(1).max(60) });
const pinSchema = z.object({ signature: z.string().min(1).max(40), title: z.string().min(1).max(80).optional() });

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

/** The morph rule (docs/CELL_GRAMMAR.md, Principle 10): within a
 *  conversation, a cell whose subject (source.api + params) persists across
 *  turns keeps its id — so the client choreography TRANSFORMS the object
 *  (same id → morph/FLIP) instead of dissolving and re-creating it. Ask
 *  "show spend" then "show the budget": the cap cell carries over and the
 *  workspace evolves around it. Deterministic; T2 is also instructed but
 *  never trusted to do this itself. */
function rekeyForContinuity(prev: LayoutSpec | undefined, next: LayoutSpec): void {
  if (!prev) return;
  const subject = (c: LayoutSpec["cells"][number]): string | null =>
    "source" in c && c.source ? `${c.source.api}|${JSON.stringify(c.source.params ?? {})}` : null;
  const prevBySubject = new Map<string, string>();
  for (const c of prev.cells) {
    const k = subject(c);
    if (k && !prevBySubject.has(k)) prevBySubject.set(k, c.id);
  }
  const used = new Set(next.cells.map((c) => c.id));
  for (const c of next.cells) {
    const k = subject(c);
    if (!k) continue;
    const prevId = prevBySubject.get(k);
    if (!prevId || prevId === c.id || used.has(prevId)) continue;
    used.delete(c.id);
    used.add(prevId);
    c.id = prevId;
  }
}

/** Attach the prior snapshot to a layout-bearing turn, then take a fresh
 *  one through the same HTTP surface the client fetches (auth identical to
 *  commit's inject). One inject per distinct binding; failures skip the
 *  cell — snapshots degrade, they never block a compose. */
async function applySnapshot(
  app: FastifyInstance, req: any, companyId: string, s: CanvasFile, turn: CanvasTurn,
): Promise<void> {
  if (!turn.layout || !turn.signature) return;
  const prior = s.snapshots[turn.signature];
  if (prior && Object.keys(prior.values).length > 0) turn.since = prior;

  const fwd: Record<string, string | string[] | undefined> = { ...req.headers };
  delete fwd["content-length"];
  delete fwd["transfer-encoding"];
  const byApi = new Map<string, any>();
  const values: Record<string, number> = {};
  for (const cell of turn.layout.cells) {
    if (!("source" in cell) || !cell.source) continue;
    const api = cell.source.api;
    const extract = HEADLINES[api];
    if (!extract) continue;
    try {
      if (!byApi.has(api)) {
        const res = await app.inject({
          method: "GET",
          url: READ_BINDINGS[api].path.replace(":companyId", companyId),
          headers: fwd,
        });
        byApi.set(api, res.statusCode === 200 ? res.json() : null);
      }
      const json = byApi.get(api);
      if (json === null) continue;
      const v = extract(json);
      if (v !== null) values[cell.id] = v;
    } catch { /* degrade */ }
  }
  if (Object.keys(values).length > 0) {
    s.snapshots[turn.signature] = { taken_at: new Date().toISOString(), values };
  }
  // Snapshots live and die with their layouts (which are LRU-capped).
  for (const k of Object.keys(s.snapshots)) if (!s.layouts[k]) delete s.snapshots[k];
}

export function registerCanvasRoutes(app: FastifyInstance): void {
  app.get("/api/instance/:companyId/canvas", guard(app, async (companyId) => {
    const s = await readState(companyId);
    // Sweep stale pending proposals on read. Without this the client renders
    // a Confirm button whose click can only ever return 410 — expiry must be
    // visible before the user acts, not after.
    const nowMs = Date.now();
    let swept = false;
    for (const p of Object.values(s.proposals)) {
      if (p.status === "pending" && nowMs - Date.parse(p.created_at) > PROPOSAL_TTL_MS) {
        p.status = "expired";
        p.outcome = { at: new Date(nowMs).toISOString(), detail: "proposal expired before confirmation" };
        swept = true;
      }
    }
    if (swept) await writeState(companyId, s);
    return { ok: true, transcript: s.transcript, proposals: Object.values(s.proposals), ledger: s.ledger, desk: s.desk };
  }));

  app.post("/api/instance/:companyId/canvas", guard(app, async (companyId, req, reply) => {
    const parsed = postSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.status(400).send({ ok: false, error: "validation failed", issues: parsed.error.issues });
    }
    const message = parsed.data.message;
    const s = await readState(companyId);
    const now = new Date().toISOString();
    s.transcript.push({ role: "user", ts_iso: now, text: message });

    // Explicit reshape escape: clear the remembered layout for this intent.
    if (RESHAPE_RE.test(message)) {
      const sig = intentSignature(classify(message));
      delete s.layouts[sig];
    }

    // Signature-addressed recall: a pin restore names the workspace it wants;
    // never re-derive it from the title. Evicted layout → normal composition.
    const restore = parsed.data.restoreSignature ? s.layouts[parsed.data.restoreSignature] : undefined;
    if (restore) {
      restore.last_used_at = now;
      restore.uses += 1;
      const turn: CanvasTurn = {
        role: "assistant", ts_iso: now, intent: "query",
        text: `Here's ${restore.label} again — same view as last time.`,
        layout: restore.layout, signature: parsed.data.restoreSignature,
        composedBy: "memory", threadId: parsed.data.restoreSignature,
      };
      await applySnapshot(app, req, companyId, s, turn);
      s.transcript.push(turn);
      if (s.transcript.length > MAX_TRANSCRIPT) s.transcript = s.transcript.slice(-MAX_TRANSCRIPT);
      await writeState(companyId, s);
      return { ok: true, turn };
    }

    // Rung 0 — utterance/memory hit: same question, same shape, no compose.
    const uKey = utteranceKey(message);
    const knownSig = s.utterances[uKey];
    const remembered = knownSig ? s.layouts[knownSig] : undefined;

    let turn: CanvasTurn;
    if (remembered && !RESHAPE_RE.test(message)) {
      remembered.last_used_at = now;
      remembered.uses += 1;
      turn = {
        role: "assistant", ts_iso: now, intent: "query",
        text: `Here's ${remembered.label} again — same view as last time.`,
        layout: remembered.layout, signature: knownSig, composedBy: "memory",
        threadId: knownSig,
      };
    } else {
      // The ladder: proposals stay deterministic (mutations must never
      // depend on model output); queries try T2 unless skipInference, and
      // any T2 failure lands on the stub. Composition never throws.
      const floor = classify(message);
      let c: T2Composition;
      if (parsed.data.skipInference || floor.kind === "propose") {
        c = { ...composeStub(message) };
      } else {
        const idx = Object.entries(s.layouts).map(([signature, v]) => ({ signature, label: v.label }));
        const lastLayoutTurn = [...s.transcript].reverse().find((t) => t.layout);
        c = await composeT2OrStub(message, companyId, idx, {
          history: s.transcript.slice(-7, -1).map((t) => `${t.role}: ${t.text}`).join("\n"),
          activeLayout: lastLayoutTurn?.layout
            ? `${lastLayoutTurn.layout.title} [${lastLayoutTurn.layout.cells.map((x) => x.id).join(", ")}]`
            : "",
        });
        // T2 matched a known workspace — serve the remembered layout.
        const reused = c.reuseSignature ? s.layouts[c.reuseSignature] : undefined;
        if (reused) {
          reused.last_used_at = now;
          reused.uses += 1;
          s.utterances[uKey] = c.reuseSignature!;
          const reuseTurn: CanvasTurn = {
            role: "assistant", ts_iso: now, intent: "query", text: c.reply,
            layout: reused.layout, signature: c.reuseSignature, composedBy: "memory",
          };
          await applySnapshot(app, req, companyId, s, reuseTurn);
          s.transcript.push(reuseTurn);
          if (s.transcript.length > MAX_TRANSCRIPT) s.transcript = s.transcript.slice(-MAX_TRANSCRIPT);
          await writeState(companyId, s);
          return { ok: true, turn: reuseTurn };
        }
      }
      const { layout, warnings: vWarnings } = c.layout ? validateLayout(c.layout) : { layout: null, warnings: [] };
      const warnings = [...(c.warnings ?? []), ...vWarnings];
      if (layout) {
        const prevLayout = [...s.transcript].reverse().find((t) => t.layout)?.layout;
        rekeyForContinuity(prevLayout, layout);
      }
      turn = {
        role: "assistant", ts_iso: now, intent: c.intent.kind, text: c.reply,
        signature: c.signature, composedBy: c.composedBy, threadId: c.signature,
        ...(layout ? { layout } : {}),
        ...(warnings.length ? { warnings } : {}),
      };
      if (layout) {
        s.layouts[c.signature] = {
          layout, label: layout.title.toLowerCase(),
          created_at: s.layouts[c.signature]?.created_at ?? now, last_used_at: now,
          uses: (s.layouts[c.signature]?.uses ?? 0) + 1,
        };
        s.utterances[uKey] = c.signature;
      }
      if (c.proposal) {
        const id = `p_${Date.now().toString(36)}_${randomBytes(3).toString("hex")}`;
        s.proposals[id] = {
          id, action: c.proposal.action as CommitAction, body: c.proposal.body,
          summary: c.proposal.summary, created_at: now, status: "pending",
        };
        turn.proposalId = id;
      }
    }

    await applySnapshot(app, req, companyId, s, turn);
    s.transcript.push(turn);
    if (s.transcript.length > MAX_TRANSCRIPT) s.transcript = s.transcript.slice(-MAX_TRANSCRIPT);
    lruTrim(s.layouts, LAYOUT_LRU, (v) => v.last_used_at);
    const uKeys = Object.keys(s.utterances);
    if (uKeys.length > UTTERANCE_LRU) uKeys.slice(0, uKeys.length - UTTERANCE_LRU).forEach((k) => delete s.utterances[k]);
    await writeState(companyId, s);
    return { ok: true, turn, proposal: turn.proposalId ? s.proposals[turn.proposalId] : undefined };
  }));

  app.post("/api/instance/:companyId/canvas/commit", guard(app, async (companyId, req, reply) => {
    const parsed = commitSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.status(400).send({ ok: false, error: "validation failed", issues: parsed.error.issues });
    }
    const s = await readState(companyId);
    const p = s.proposals[parsed.data.proposalId];
    const now = new Date().toISOString();

    if (!p) return reply.status(404).send({ ok: false, error: "proposal not found" });
    // Idempotent: re-committing a decided proposal returns the recorded
    // outcome — add-agent is NOT safe to re-execute.
    if (p.status === "committed" || p.status === "failed") {
      return { ok: true, proposal: p, replayed: true };
    }
    const spec = COMMIT_ALLOWLIST[p.action];
    if (!spec) {
      return reply.status(400).send({ ok: false, error: `action "${p.action}" is not allowlisted` });
    }
    if (Date.now() - Date.parse(p.created_at) > PROPOSAL_TTL_MS) {
      p.status = "expired";
      p.outcome = { at: now, detail: "proposal expired before confirmation" };
      await writeState(companyId, s);
      return reply.status(410).send({ ok: false, error: "proposal expired — ask again", proposal: p });
    }
    // Re-validate the stored body at commit time, not just propose time.
    const bodyCheck = spec.body.safeParse(p.body);
    if (!bodyCheck.success) {
      return reply.status(400).send({ ok: false, error: "stored proposal body no longer validates", issues: bodyCheck.error.issues });
    }

    // The constitution gate (docs/RECURSIVE_ORG_SPEC.md §10): checked at the
    // moment of execution, not proposal time. A rejection is ledgered as a
    // failed proposal with the gate's reason — never silent.
    const org = await readOrg(companyId);
    const verdict = checkConstitution(org, p.action, bodyCheck.data as Record<string, unknown>);
    if (!verdict.allowed) {
      p.status = "failed";
      p.outcome = { at: now, detail: `constitution: ${verdict.reason}` };
      s.ledger.push({
        ts_iso: now, proposalId: p.id, summary: p.summary, action: p.action,
        status: "failed", detail: `constitution: ${verdict.reason}`,
      });
      const gateTurn: CanvasTurn = {
        role: "assistant", ts_iso: now, intent: "query",
        text: `The constitution blocked this: ${verdict.reason}. Amend the constitution first if this should be allowed.`,
        proposalId: p.id,
      };
      s.transcript.push(gateTurn);
      if (s.transcript.length > MAX_TRANSCRIPT) s.transcript = s.transcript.slice(-MAX_TRANSCRIPT);
      await writeState(companyId, s);
      return reply.status(409).send({ ok: false, error: `constitution: ${verdict.reason}`, turn: gateTurn, proposal: p });
    }

    // Execute through the SAME HTTP surface (route logic lives in handler
    // closures and is not importable). Forward headers so auth is identical —
    // but strip the entity headers, which describe the ORIGINAL body and
    // would make Fastify reject the injected payload's length.
    const fwd: Record<string, string | string[] | undefined> = { ...req.headers };
    delete fwd["content-length"];
    delete fwd["transfer-encoding"];
    fwd["content-type"] = "application/json";
    const res = await app.inject({
      method: spec.method,
      url: spec.path.replace(":companyId", companyId),
      headers: fwd,
      payload: bodyCheck.data,
    });
    const succeeded = res.statusCode >= 200 && res.statusCode < 300;
    const detail = succeeded ? undefined : `HTTP ${res.statusCode}: ${res.body.slice(0, 200)}`;

    p.status = succeeded ? "committed" : "failed";
    p.outcome = { at: now, detail: detail ?? "applied" };
    s.ledger.push({
      ts_iso: now, proposalId: p.id, summary: p.summary, action: p.action,
      status: p.status, ...(detail ? { detail } : {}),
    });
    // State what happened, in the transcript.
    const turn: CanvasTurn = {
      role: "assistant", ts_iso: now, intent: "query",
      text: succeeded ? `Done — ${p.summary}` : `That didn't apply: ${detail}. The proposal is recorded as failed; ask again to retry.`,
      proposalId: p.id,
    };
    s.transcript.push(turn);
    if (s.transcript.length > MAX_TRANSCRIPT) s.transcript = s.transcript.slice(-MAX_TRANSCRIPT);
    await writeState(companyId, s);
    return { ok: true, turn, proposal: p };
  }));

  // Read side of the finalize Monte Carlo — the most differentiated data in
  // the product, previously unrendered. 404 = not finalized yet (empty).
  app.get("/api/instance/:companyId/mc-report", guard(app, async (companyId, _req, reply) => {
    try {
      const raw = await readFile(join(getOnboardingDir(companyId), "mc-report.json"), "utf8");
      return { ok: true, report: JSON.parse(raw) };
    } catch {
      return reply.status(404).send({ ok: false, error: "no mc report yet — finalize first" });
    }
  }));

  app.post("/api/instance/:companyId/canvas/pin", guard(app, async (companyId, req, reply) => {
    const parsed = pinSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.status(400).send({ ok: false, error: "validation failed", issues: parsed.error.issues });
    }
    const s = await readState(companyId);
    const known = s.layouts[parsed.data.signature];
    if (!known) return reply.status(404).send({ ok: false, error: "no such workspace to pin" });
    if (!s.desk.pinned.some((x) => x.signature === parsed.data.signature)) {
      s.desk.pinned.push({
        signature: parsed.data.signature,
        title: parsed.data.title ?? known.layout.title,
        pinned_at: new Date().toISOString(),
      });
      await writeState(companyId, s);
    }
    return { ok: true, desk: s.desk, layout: known.layout };
  }));

  app.delete("/api/instance/:companyId/canvas/pin", guard(app, async (companyId, req, reply) => {
    const parsed = pinSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.status(400).send({ ok: false, error: "validation failed", issues: parsed.error.issues });
    }
    const s = await readState(companyId);
    s.desk.pinned = s.desk.pinned.filter((x) => x.signature !== parsed.data.signature);
    await writeState(companyId, s);
    return { ok: true, desk: s.desk };
  }));
}
