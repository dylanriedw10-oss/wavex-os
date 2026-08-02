/** The recursive org — persistent state + the adaptive layer's honest floors.
 *
 *  One per-company file (org.json, atomic tmp+rename like canvas.json):
 *  investigation steps, cited memory, constitution categories. Gravity and
 *  influence are COMPUTED from steps on read — never authored rows.
 *
 *  Honesty rules enforced here (docs/RECURSIVE_ORG_SPEC.md §4, §7, §8):
 *  - a MemoryEntry with no citations is rejected at write time
 *  - influence edges carry their observed evidence source and counts
 *  - gravity is null until observation volume crosses GRAVITY_MIN_STEPS */

import { randomBytes } from "node:crypto";
import { readFile, writeFile, mkdir, rename } from "node:fs/promises";
import { dirname, join } from "node:path";
import { getOnboardingDir } from "../state-bridge.js";

export type WalkDecision = "answered" | "delegated" | "referred" | "precedent";

export interface InvestigationStep {
  id: string;
  walkId: string;
  sessionId: string | null;
  nodeId: string;
  nodeTitle: string;
  question: string;
  decision: WalkDecision;
  delegatedToNodeId: string | null;
  answer: string | null;
  ts: string;
}

export interface MemoryEntry {
  id: string;
  nodeId: string;
  question: string;
  claim: string;                 // authored distillation — renders violet
  /** "canvas" = promoted from an ephemeral workspace; id is its signature. */
  citations: Array<{ kind: "walk" | "ledger" | "activity" | "issue" | "canvas"; id: string }>;
  derivedAt: string;
  supersededBy: string | null;
}

export interface ConstitutionCategory {
  id: string;
  label: string;
  content: string;
  updatedAt: string;
  updatedByWalkId: string | null;
}

export interface OrgFile {
  companyId: string;
  steps: InvestigationStep[];
  memory: MemoryEntry[];
  constitution: ConstitutionCategory[];
}

const MAX_STEPS = 2000; // observation log, generously bounded
export const GRAVITY_MIN_STEPS = 10;

function orgPath(companyId: string): string {
  return join(getOnboardingDir(companyId), "org.json");
}

function emptyFile(companyId: string): OrgFile {
  return { companyId, steps: [], memory: [], constitution: [] };
}

export async function readOrg(companyId: string): Promise<OrgFile> {
  try {
    const raw = JSON.parse(await readFile(orgPath(companyId), "utf8")) as Partial<OrgFile>;
    return { ...emptyFile(companyId), ...raw };
  } catch {
    return emptyFile(companyId);
  }
}

export async function writeOrg(companyId: string, file: OrgFile): Promise<void> {
  const path = orgPath(companyId);
  await mkdir(dirname(path), { recursive: true });
  const tmp = `${path}.${randomBytes(4).toString("hex")}.tmp`;
  await writeFile(tmp, JSON.stringify(file, null, 2), "utf8");
  await rename(tmp, path);
}

export function newId(prefix: string): string {
  return `${prefix}_${Date.now().toString(36)}_${randomBytes(3).toString("hex")}`;
}

/* ------------------------------------------------------------------ */
/* Memory — cited or rejected                                          */
/* ------------------------------------------------------------------ */

export function addMemory(
  file: OrgFile,
  entry: Omit<MemoryEntry, "id" | "derivedAt" | "supersededBy">,
): MemoryEntry {
  if (!entry.citations || entry.citations.length === 0) {
    throw new Error("memory entry rejected: a claim with no citations is invalid");
  }
  const full: MemoryEntry = { ...entry, id: newId("mem"), derivedAt: new Date().toISOString(), supersededBy: null };
  file.memory.push(full);
  return full;
}

const STOP = new Set(["the", "a", "an", "is", "are", "was", "were", "did", "do", "does",
  "what", "why", "how", "when", "who", "show", "me", "my", "our", "we", "to", "of", "in",
  "on", "for", "and", "or", "it", "this", "that", "so", "far", "much", "many"]);

export function keywords(text: string): Set<string> {
  return new Set(
    text.toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, " ").split(/\s+/)
      .filter((w) => w.length > 1 && !STOP.has(w)),
  );
}

/** Precedent retrieval: keyword overlap between the new question and a
 *  stored entry's question. Returns the best entry above threshold. */
export function findPrecedent(file: OrgFile, nodeId: string, question: string): MemoryEntry | null {
  const q = keywords(question);
  if (q.size === 0) return null;
  let best: { entry: MemoryEntry; score: number } | null = null;
  for (const m of file.memory) {
    if (m.nodeId !== nodeId || m.supersededBy) continue;
    const mk = keywords(m.question);
    let shared = 0;
    for (const w of q) if (mk.has(w)) shared++;
    const score = shared / Math.max(q.size, 1);
    if (shared >= 2 && score >= 0.6 && (!best || score > best.score)) best = { entry: m, score };
  }
  return best?.entry ?? null;
}

/* ------------------------------------------------------------------ */
/* Gravity + influence — computed from observed walks, never authored  */
/* ------------------------------------------------------------------ */

export interface GravityRow {
  nodeId: string;
  title: string;
  gravity: number;              // 0–100 normalized
  evidence: { inboundAsks: number; landings: number };
}

export function computeGravity(file: OrgFile): GravityRow[] | null {
  if (file.steps.length < GRAVITY_MIN_STEPS) return null; // honest null before volume
  const byNode = new Map<string, { title: string; inbound: number; landings: number }>();
  const bump = (id: string, title: string) => {
    const r = byNode.get(id) ?? { title, inbound: 0, landings: 0 };
    byNode.set(id, r);
    return r;
  };
  for (const s of file.steps) {
    if (s.decision === "delegated" && s.delegatedToNodeId) bump(s.delegatedToNodeId, "").inbound++;
    if (s.decision === "answered" || s.decision === "precedent") bump(s.nodeId, s.nodeTitle).landings++;
    if (byNode.has(s.nodeId)) byNode.get(s.nodeId)!.title = s.nodeTitle;
  }
  const raw = [...byNode.entries()].map(([nodeId, r]) => ({
    nodeId, title: r.title || nodeId,
    score: r.inbound + 2 * r.landings,
    evidence: { inboundAsks: r.inbound, landings: r.landings },
  }));
  const max = Math.max(...raw.map((r) => r.score), 1);
  return raw
    .map((r) => ({ nodeId: r.nodeId, title: r.title, gravity: Math.round((r.score / max) * 100), evidence: r.evidence }))
    .sort((a, b) => b.gravity - a.gravity);
}

export interface InfluenceEdge {
  from: string;
  to: string;
  kind: "asks";
  weight: number;
  lastObservedAt: string;
  evidence: { source: "walk_history"; count: number };
}

export function computeInfluence(file: OrgFile): InfluenceEdge[] {
  const edges = new Map<string, InfluenceEdge>();
  for (const s of file.steps) {
    if (s.decision !== "delegated" || !s.delegatedToNodeId) continue;
    const key = `${s.nodeId}→${s.delegatedToNodeId}`;
    const e = edges.get(key) ?? {
      from: s.nodeId, to: s.delegatedToNodeId, kind: "asks" as const,
      weight: 0, lastObservedAt: s.ts, evidence: { source: "walk_history" as const, count: 0 },
    };
    e.weight++;
    e.evidence.count++;
    if (s.ts > e.lastObservedAt) e.lastObservedAt = s.ts;
    edges.set(key, e);
  }
  return [...edges.values()].sort((a, b) => b.weight - a.weight);
}

/* ------------------------------------------------------------------ */
/* Constitution — identity + law; the gate                             */
/* ------------------------------------------------------------------ */

const CATEGORY_DEFS: Array<{ id: string; label: string }> = [
  { id: "identity_mission", label: "Why we exist" },
  { id: "optimization_priorities", label: "What we optimize" },
  { id: "pace_rules", label: "When we move slowly / take risks" },
  { id: "never_sacrifice", label: "What we never sacrifice" },
  { id: "global_goals", label: "Global goals" },
  { id: "budgets_constraints", label: "Budgets & constraints" },
  { id: "approval_thresholds", label: "Approval thresholds" },
  { id: "risk_tolerance", label: "Risk tolerance" },
  { id: "brand_voice", label: "Brand voice" },
  { id: "compliance_rules", label: "Compliance rules" },
  { id: "agent_permissions", label: "Agent permissions" },
  { id: "working_hours", label: "Working hours" },
  { id: "escalation_paths", label: "Escalation paths" },
  { id: "success_definitions", label: "Success definitions" },
];

/** Seed missing categories in place (idempotent). `goalLine` fills
 *  global_goals on first seed when the manifest has one. */
export function seedConstitution(file: OrgFile, goalLine: string | null): void {
  const have = new Set(file.constitution.map((c) => c.id));
  const now = new Date().toISOString();
  for (const def of CATEGORY_DEFS) {
    if (have.has(def.id)) continue;
    file.constitution.push({
      id: def.id, label: def.label,
      content: def.id === "global_goals" && goalLine ? goalLine : "",
      updatedAt: now, updatedByWalkId: null,
    });
  }
}

export interface ConstitutionVerdict { allowed: boolean; reason?: string }

/** The gate (§10). R1 rules — deterministic, content-driven:
 *  - budgets_constraints may declare {"max_cap_tokens": N}: a
 *    set-token-budget beyond it is blocked.
 *  - never_sacrifice may name commit actions (one per line or comma
 *    separated): a named action is blocked outright.
 *  Empty content = no constraint (existing behavior unchanged). */
export function checkConstitution(
  file: OrgFile,
  action: string,
  body: Record<string, unknown>,
): ConstitutionVerdict {
  const cat = (id: string) => file.constitution.find((c) => c.id === id);

  const never = cat("never_sacrifice")?.content ?? "";
  if (never && never.split(/[\n,]+/).map((s) => s.trim()).filter(Boolean).includes(action)) {
    return { allowed: false, reason: `the constitution lists "${action}" under never-sacrifice` };
  }

  if (action === "set-token-budget") {
    const raw = cat("budgets_constraints")?.content ?? "";
    if (raw) {
      try {
        const parsed = JSON.parse(raw) as { max_cap_tokens?: number };
        const max = parsed.max_cap_tokens;
        const requested = body.cap_tokens;
        if (typeof max === "number" && typeof requested === "number" && requested > max) {
          return { allowed: false, reason: `requested cap ${requested.toLocaleString()} exceeds the constitutional ceiling of ${max.toLocaleString()} tokens` };
        }
      } catch { /* non-JSON content constrains nothing — honest no-op */ }
    }
  }

  return { allowed: true };
}
