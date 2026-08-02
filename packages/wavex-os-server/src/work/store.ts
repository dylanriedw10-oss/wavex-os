/** The native work store — WaveX's OWN runtime, replacing Paperclip
 *  (docs/RECURSIVE_ORG_SPEC.md Rev 6). One per-company file (work.json,
 *  atomic tmp+rename like org.json): goals, tasks, deliverables, and the
 *  run log every runtime binding is derived from.
 *
 *  The seeded gate: readWork returns NULL when the file doesn't exist —
 *  the native runtime routes translate that to 503 ("runtime not started"),
 *  preserving the status vocabulary the catalog's emptyStatuses and the
 *  org's liveReachable logic already encode.
 *
 *  Honesty rules:
 *  - every row is real store state; derivations COUNT, they never invent
 *  - deliverable output is engine text, capped, never edited server-side
 *  - the attempt/requeue history is ledgered in runLog — the "never give
 *    up" loop is visible, not magic */

import { randomBytes } from "node:crypto";
import { readFile, writeFile, mkdir, rename } from "node:fs/promises";
import { dirname, join } from "node:path";
import { getOnboardingDir } from "../state-bridge.js";

export type GoalStatus = "active" | "achieved" | "cancelled";
export type TaskStatus = "todo" | "in_progress" | "in_review" | "done" | "blocked" | "failed";
export type ReviewState = "pending_review" | "approved" | "changes_requested";

export interface WorkGoal {
  id: string;
  title: string;
  description: string;
  status: GoalStatus;
  source: "manifest" | "operator";
  createdAt: string;
}

export interface WorkTask {
  id: string;
  goalId: string;
  title: string;
  brief: string;
  assigneeSlot: string;
  status: TaskStatus;
  dependsOn: string[];
  attempts: number;
  maxAttempts: number;
  /** Review + structural feedback, oldest first — folded into the next brief. */
  feedback: string[];
  createdAt: string;
  updatedAt: string;
  startedAt: string | null;
  completedAt: string | null;
}

export interface StructuralChecks {
  nonEmpty: boolean;
  meetsMinLength: boolean;
  requiredSections: string[];
  missingSections: string[];
  passed: boolean;
}

export interface WorkDeliverable {
  id: string;
  taskId: string;
  attempt: number;
  /** The engine's text, verbatim (capped) — never edited server-side. */
  output: string;
  structural: StructuralChecks;
  review: ReviewState;
  reviewNote: string | null;
  createdAt: string;
  reviewedAt: string | null;
}

export type RunEventKind =
  | "seeded" | "goal_created" | "task_created"
  | "cycle_started" | "task_started" | "task_output" | "qa_structural"
  | "review_approved" | "review_changes" | "task_requeued" | "task_failed" | "task_done";

export interface WorkRunEvent {
  id: string;
  ts: string;
  kind: RunEventKind;
  taskId: string | null;
  agentSlot: string | null;
  detail: string;
}

export interface WorkFile {
  companyId: string;
  v: 1;
  goals: WorkGoal[];
  tasks: WorkTask[];
  deliverables: WorkDeliverable[];
  runLog: WorkRunEvent[];
}

const RUNLOG_CAP = 2000;
export const OUTPUT_CAP = 64_000;
export const DEFAULT_MAX_ATTEMPTS = 3;
const MIN_OUTPUT_LEN = 200;

function workPath(companyId: string): string {
  return join(getOnboardingDir(companyId), "work.json");
}

export function emptyWork(companyId: string): WorkFile {
  return { companyId, v: 1, goals: [], tasks: [], deliverables: [], runLog: [] };
}

/** NULL = not seeded — the 503 gate. A present file (even empty) is live. */
export async function readWork(companyId: string): Promise<WorkFile | null> {
  try {
    const raw = JSON.parse(await readFile(workPath(companyId), "utf8")) as Partial<WorkFile>;
    return { ...emptyWork(companyId), ...raw };
  } catch {
    return null;
  }
}

export async function writeWork(companyId: string, file: WorkFile): Promise<void> {
  if (file.runLog.length > RUNLOG_CAP) file.runLog = file.runLog.slice(-RUNLOG_CAP);
  const path = workPath(companyId);
  await mkdir(dirname(path), { recursive: true });
  const tmp = `${path}.${randomBytes(4).toString("hex")}.tmp`;
  await writeFile(tmp, JSON.stringify(file, null, 2), "utf8");
  await rename(tmp, path);
}

export function newId(prefix: string): string {
  return `${prefix}_${Date.now().toString(36)}_${randomBytes(3).toString("hex")}`;
}

export function logEvent(
  file: WorkFile, kind: RunEventKind, detail: string,
  taskId: string | null = null, agentSlot: string | null = null,
): void {
  file.runLog.push({ id: newId("ev"), ts: new Date().toISOString(), kind, taskId, agentSlot, detail });
}

/* ------------------------------------------------------------------ */
/* Structural QA — dumb, honest checks. Semantic judgment is the       */
/* operator's (T2 verifier is P2, and it will be LABELED).             */
/* ------------------------------------------------------------------ */

/** A brief may declare required sections on a line: `Sections: A, B, C`. */
export function requiredSectionsOf(brief: string): string[] {
  const m = brief.match(/^\s*Sections:\s*(.+)$/im);
  if (!m) return [];
  return m[1].split(",").map((s) => s.trim()).filter(Boolean);
}

export function runStructuralChecks(task: WorkTask, output: string): StructuralChecks {
  const required = requiredSectionsOf(task.brief);
  const lower = output.toLowerCase();
  const missing = required.filter((s) => !lower.includes(s.toLowerCase()));
  const nonEmpty = output.trim().length > 0;
  const meetsMinLength = output.trim().length >= MIN_OUTPUT_LEN;
  return {
    nonEmpty, meetsMinLength,
    requiredSections: required, missingSections: missing,
    passed: nonEmpty && meetsMinLength && missing.length === 0,
  };
}

/* ------------------------------------------------------------------ */
/* Derivations — the four runtime bindings, COUNTED from store state.  */
/* Field names are the wire contract the old adapter served; the five  */
/* consumers (catalog/composer/snapshot/org-nodes/cells) read exactly  */
/* these keys.                                                         */
/* ------------------------------------------------------------------ */

export function deriveLiveRuns(w: WorkFile): Array<Record<string, unknown>> {
  return w.tasks
    .filter((t) => t.status === "in_progress")
    .map((t) => ({
      runId: t.id,
      agentName: t.assigneeSlot,
      issueTitle: t.title,
      status: "running",
      startedAt: t.startedAt ?? t.updatedAt,
    }));
}

export function deriveApprovals(w: WorkFile): Array<Record<string, unknown>> {
  const titleOf = (taskId: string) => w.tasks.find((t) => t.id === taskId)?.title ?? taskId;
  return w.deliverables
    .filter((d) => d.review === "pending_review")
    .map((d) => ({
      id: d.id,
      title: `${titleOf(d.taskId)} — attempt ${d.attempt}`,
      type: "deliverable_review",
    }));
}

const EVENT_WIRE: Record<RunEventKind, { action: string; actorType: string; entityType: string }> = {
  seeded: { action: "runtime.seeded", actorType: "system", entityType: "goal" },
  goal_created: { action: "goal.created", actorType: "user", entityType: "goal" },
  task_created: { action: "task.created", actorType: "user", entityType: "task" },
  cycle_started: { action: "cycle.started", actorType: "system", entityType: "cycle" },
  task_started: { action: "task.started", actorType: "agent", entityType: "task" },
  task_output: { action: "task.output", actorType: "agent", entityType: "deliverable" },
  qa_structural: { action: "qa.structural_check", actorType: "system", entityType: "deliverable" },
  review_approved: { action: "review.approved", actorType: "user", entityType: "deliverable" },
  review_changes: { action: "review.changes_requested", actorType: "user", entityType: "deliverable" },
  task_requeued: { action: "task.requeued", actorType: "system", entityType: "task" },
  task_failed: { action: "task.failed", actorType: "system", entityType: "task" },
  task_done: { action: "task.done", actorType: "agent", entityType: "task" },
};

export function deriveActivity(w: WorkFile, limit = 30): Array<Record<string, unknown>> {
  return w.runLog.slice(-limit).reverse().map((e) => ({
    createdAt: e.ts,
    ...EVENT_WIRE[e.kind],
    detail: e.detail,
  }));
}

export function deriveDashboard(w: WorkFile): Record<string, unknown> {
  const slotsWith = (pred: (t: WorkTask) => boolean) => new Set(w.tasks.filter(pred).map((t) => t.assigneeSlot)).size;
  const count = (s: TaskStatus) => w.tasks.filter((t) => t.status === s).length;

  // Last 12 days, zero-filled, today last — the RunCadence contract.
  const days: Array<{ date: string; total: number; succeeded: number; failed: number }> = [];
  const byDate = new Map<string, { succeeded: number; failed: number }>();
  for (const e of w.runLog) {
    if (e.kind !== "task_done" && e.kind !== "task_failed") continue;
    const date = e.ts.slice(0, 10);
    const row = byDate.get(date) ?? { succeeded: 0, failed: 0 };
    if (e.kind === "task_done") row.succeeded++;
    else row.failed++;
    byDate.set(date, row);
  }
  for (let i = 11; i >= 0; i--) {
    const d = new Date(Date.now() - i * 86_400_000).toISOString().slice(0, 10);
    const row = byDate.get(d) ?? { succeeded: 0, failed: 0 };
    days.push({ date: d, total: row.succeeded + row.failed, ...row });
  }

  return {
    agents: {
      running: slotsWith((t) => t.status === "in_progress"),
      active: slotsWith((t) => t.status !== "done" && t.status !== "failed"),
    },
    tasks: {
      open: count("todo"),
      inProgress: count("in_progress"),
      blocked: count("blocked"),
      done: count("done"),
    },
    pendingApprovals: w.deliverables.filter((d) => d.review === "pending_review").length,
    runActivity: days,
  };
}
