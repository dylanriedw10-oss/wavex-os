/** The orchestrator — one explicit run-cycle (spec Rev 6).
 *
 *  SERIAL by design in P1: token attribution is time-window based
 *  (lib/token-accounting.ts), so concurrent briefs would mis-attribute
 *  spend. Parallelism arrives with request-id attribution (P2).
 *
 *  The loop that never gives up — bounded: a structural failure requeues
 *  the task with the feedback folded into its next brief; the attempt
 *  ceiling escalates to the operator (status "failed", visible) instead
 *  of looping forever. Budget exhaustion reverts the task WITHOUT burning
 *  an attempt and stops the cycle — running dry is not the agent's fault.
 *
 *  The store is written between steps so /runtime/live-runs tells the
 *  truth mid-cycle. */

import { executeBrief } from "./engine.js";
import {
  DEFAULT_MAX_ATTEMPTS, logEvent, newId, readWork, runStructuralChecks, writeWork,
  type WorkFile, type WorkTask,
} from "./store.js";

export interface CycleOutcome {
  taskId: string;
  title: string;
  outcome: "in_review" | "requeued" | "failed" | "budget_stopped";
  detail: string;
}

export interface CycleSummary {
  ok: true;
  ran: CycleOutcome[];
  ready: number;
  stoppedEarly: string | null;
}

const LOCKS = new Set<string>();

function isReady(w: WorkFile, t: WorkTask): boolean {
  if (t.status !== "todo") return false;
  if (t.attempts >= (t.maxAttempts ?? DEFAULT_MAX_ATTEMPTS)) return false;
  return t.dependsOn.every((id) => w.tasks.find((x) => x.id === id)?.status === "done");
}

export async function runCycle(
  companyId: string,
  opts: { maxTasks?: number } = {},
): Promise<CycleSummary | { ok: false; error: string }> {
  if (LOCKS.has(companyId)) return { ok: false, error: "a cycle is already running for this company" };
  LOCKS.add(companyId);
  try {
    const w = await readWork(companyId);
    if (!w) return { ok: false, error: "runtime not started — seed first" };

    // Sweep runs stranded by a crashed process: honesty about liveness.
    const now = new Date().toISOString();
    for (const t of w.tasks) {
      if (t.status === "in_progress") {
        t.status = "todo";
        t.startedAt = null;
        t.updatedAt = now;
        logEvent(w, "task_requeued", "stale run swept at cycle start", t.id, t.assigneeSlot);
      }
    }

    const ready = w.tasks.filter((t) => isReady(w, t)).sort((a, b) => a.createdAt.localeCompare(b.createdAt));
    const batch = ready.slice(0, Math.max(1, Math.min(opts.maxTasks ?? 3, 10)));
    logEvent(w, "cycle_started", `${ready.length} ready · running ${batch.length} serially`);
    await writeWork(companyId, w);

    const summary: CycleSummary = { ok: true, ran: [], ready: ready.length, stoppedEarly: null };

    for (const task of batch) {
      task.status = "in_progress";
      task.startedAt = new Date().toISOString();
      task.updatedAt = task.startedAt;
      logEvent(w, "task_started", `attempt ${task.attempts + 1} of ${task.maxAttempts}`, task.id, task.assigneeSlot);
      await writeWork(companyId, w);

      const result = await executeBrief(companyId, task);

      if (!result.ok && result.budgetExhausted) {
        // Not the agent's failure: revert with no attempt burned, stop.
        task.status = "todo";
        task.startedAt = null;
        task.updatedAt = new Date().toISOString();
        logEvent(w, "task_requeued", "token budget exhausted — cycle stopped, attempt not counted", task.id, task.assigneeSlot);
        summary.ran.push({ taskId: task.id, title: task.title, outcome: "budget_stopped", detail: "token budget exhausted" });
        summary.stoppedEarly = "token budget exhausted";
        await writeWork(companyId, w);
        break;
      }

      task.attempts += 1;
      const atCeiling = task.attempts >= (task.maxAttempts ?? DEFAULT_MAX_ATTEMPTS);

      if (!result.ok) {
        task.status = atCeiling ? "failed" : "todo";
        task.startedAt = null;
        task.updatedAt = new Date().toISOString();
        logEvent(w, atCeiling ? "task_failed" : "task_requeued",
          `engine error: ${result.error}${atCeiling ? " — attempt ceiling reached, escalated to operator" : ""}`,
          task.id, task.assigneeSlot);
        summary.ran.push({ taskId: task.id, title: task.title, outcome: atCeiling ? "failed" : "requeued", detail: result.error });
        await writeWork(companyId, w);
        continue;
      }

      const structural = runStructuralChecks(task, result.output);
      w.deliverables.push({
        id: newId("del"), taskId: task.id, attempt: task.attempts,
        output: result.output, structural,
        review: structural.passed ? "pending_review" : "changes_requested",
        reviewNote: structural.passed ? null : structuralNote(structural),
        createdAt: new Date().toISOString(), reviewedAt: null,
      });
      logEvent(w, "task_output", `deliverable attempt ${task.attempts} (${result.output.length} chars)`, task.id, task.assigneeSlot);
      logEvent(w, "qa_structural", structural.passed ? "structural checks passed" : `structural checks failed: ${structuralNote(structural)}`, task.id, task.assigneeSlot);

      if (structural.passed) {
        task.status = "in_review";
        task.updatedAt = new Date().toISOString();
        summary.ran.push({ taskId: task.id, title: task.title, outcome: "in_review", detail: "awaiting operator review" });
      } else {
        task.feedback.push(`structural: ${structuralNote(structural)}`);
        task.status = atCeiling ? "failed" : "todo";
        task.startedAt = null;
        task.updatedAt = new Date().toISOString();
        logEvent(w, atCeiling ? "task_failed" : "task_requeued",
          atCeiling ? "attempt ceiling reached after structural failures — escalated to operator" : "requeued with structural feedback",
          task.id, task.assigneeSlot);
        summary.ran.push({ taskId: task.id, title: task.title, outcome: atCeiling ? "failed" : "requeued", detail: structuralNote(structural) });
      }
      await writeWork(companyId, w);
    }

    return summary;
  } finally {
    LOCKS.delete(companyId);
  }
}

function structuralNote(s: { nonEmpty: boolean; meetsMinLength: boolean; missingSections: string[] }): string {
  const parts: string[] = [];
  if (!s.nonEmpty) parts.push("output empty");
  else if (!s.meetsMinLength) parts.push("output too short");
  if (s.missingSections.length) parts.push(`missing sections: ${s.missingSections.join(", ")}`);
  return parts.join(" · ") || "failed";
}
