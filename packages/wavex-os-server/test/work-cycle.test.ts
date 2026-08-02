/** The native runtime — store derivations + the orchestrator cycle run
 *  against the fixture engine (a real spawn of a canned bin: the exact
 *  path production takes, minus the model). */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { chmodSync, mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { writeFileSync } from "node:fs";

const FIXTURE_BIN = join(dirname(fileURLToPath(import.meta.url)), "fixtures", "fake-claude.sh");

let tempDir: string;
const CO = "acme";

function onboardingDir(): string {
  return join(tempDir, "instances/default/companies", CO, "onboarding");
}

beforeEach(() => {
  tempDir = mkdtempSync(join(tmpdir(), "work-cycle-test-"));
  process.env.WAVEX_OS_STATE_DIR = tempDir;
  process.env.PAPERCLIP_DATA_DIR = tempDir;
  process.env.WAVEX_AUTH_MODE = "dev";
  process.env.WAVEX_OS_CLAUDE_BIN = FIXTURE_BIN;
  chmodSync(FIXTURE_BIN, 0o755);
  mkdirSync(onboardingDir(), { recursive: true });
});

afterEach(() => {
  delete process.env.WAVEX_OS_STATE_DIR;
  delete process.env.PAPERCLIP_DATA_DIR;
  delete process.env.WAVEX_AUTH_MODE;
  delete process.env.WAVEX_OS_CLAUDE_BIN;
  delete process.env.FAKE_CLAUDE_MODE;
  rmSync(tempDir, { recursive: true, force: true });
});

async function seedTask(over: Partial<import("../src/work/store.js").WorkTask> = {}) {
  const { emptyWork, writeWork, newId } = await import("../src/work/store.js");
  const w = emptyWork(CO);
  const now = new Date().toISOString();
  w.goals.push({ id: "goal_1", title: "Primary goal", description: "", status: "active", source: "manifest", createdAt: now });
  w.tasks.push({
    id: newId("task"), goalId: "goal_1", title: "Draft the launch summary",
    brief: "Write the launch summary.\nSections: Summary, Plan, Next steps",
    assigneeSlot: "growth", status: "todo", dependsOn: [],
    attempts: 0, maxAttempts: 3, feedback: [],
    createdAt: now, updatedAt: now, startedAt: null, completedAt: null,
    ...over,
  });
  await writeWork(CO, w);
  return w.tasks[0].id;
}

describe("store derivations", () => {
  it("readWork is NULL before seed — the 503 gate", async () => {
    const { readWork } = await import("../src/work/store.js");
    expect(await readWork(CO)).toBeNull();
  });

  it("derivations serve the old adapter's exact field names", async () => {
    const { emptyWork, deriveDashboard, deriveLiveRuns, deriveApprovals, deriveActivity, logEvent } = await import("../src/work/store.js");
    const w = emptyWork(CO);
    const now = new Date().toISOString();
    w.tasks.push(
      { id: "t1", goalId: "g", title: "A", brief: "", assigneeSlot: "growth", status: "in_progress", dependsOn: [], attempts: 1, maxAttempts: 3, feedback: [], createdAt: now, updatedAt: now, startedAt: now, completedAt: null },
      { id: "t2", goalId: "g", title: "B", brief: "", assigneeSlot: "ops", status: "done", dependsOn: [], attempts: 1, maxAttempts: 3, feedback: [], createdAt: now, updatedAt: now, startedAt: null, completedAt: now },
    );
    w.deliverables.push({ id: "d1", taskId: "t1", attempt: 1, output: "x", structural: { nonEmpty: true, meetsMinLength: true, requiredSections: [], missingSections: [], passed: true }, review: "pending_review", reviewNote: null, createdAt: now, reviewedAt: null });
    logEvent(w, "task_done", "done", "t2", "ops");

    const runs = deriveLiveRuns(w);
    expect(runs).toHaveLength(1);
    expect(runs[0]).toMatchObject({ agentName: "growth", issueTitle: "A", status: "running" });
    expect(runs[0].startedAt).toBeTruthy();

    const approvals = deriveApprovals(w);
    expect(approvals[0]).toMatchObject({ id: "d1", type: "deliverable_review" });
    expect(String(approvals[0].title)).toMatch(/^A — attempt 1/);

    const events = deriveActivity(w);
    expect(events[0]).toMatchObject({ actorType: "agent", action: "task.done", entityType: "task" });
    expect(events[0].createdAt).toBeTruthy();

    const dash = deriveDashboard(w) as any;
    expect(dash.agents).toEqual({ running: 1, active: 1 });
    expect(dash.tasks).toEqual({ open: 0, inProgress: 1, blocked: 0, done: 1 });
    expect(dash.pendingApprovals).toBe(1);
    expect(dash.runActivity).toHaveLength(12);
    const today = dash.runActivity[11];
    expect(today).toMatchObject({ succeeded: 1, failed: 0, total: 1 });
    expect(today.date).toBe(new Date().toISOString().slice(0, 10));
  });
});

describe("the cycle", () => {
  it("done path: engine output passes structural QA and lands in review", async () => {
    const taskId = await seedTask();
    const { runCycle } = await import("../src/work/cycle.js");
    const { readWork } = await import("../src/work/store.js");

    const s = await runCycle(CO);
    expect(s.ok).toBe(true);
    if (!s.ok) return;
    expect(s.ran[0]).toMatchObject({ taskId, outcome: "in_review" });

    const w = (await readWork(CO))!;
    expect(w.tasks[0].status).toBe("in_review");
    expect(w.tasks[0].attempts).toBe(1);
    expect(w.deliverables).toHaveLength(1);
    expect(w.deliverables[0].review).toBe("pending_review");
    expect(w.deliverables[0].output).toMatch(/Fixture engine output \(canned\)/);
    expect(w.deliverables[0].structural.passed).toBe(true);
    // The ledger shows the whole journey.
    const kinds = w.runLog.map((e) => e.kind);
    expect(kinds).toEqual(expect.arrayContaining(["cycle_started", "task_started", "task_output", "qa_structural"]));
  });

  it("structural failure requeues WITH feedback; the ceiling escalates to failed", async () => {
    process.env.FAKE_CLAUDE_MODE = "short";
    const taskId = await seedTask({ maxAttempts: 2 });
    const { runCycle } = await import("../src/work/cycle.js");
    const { readWork } = await import("../src/work/store.js");

    const s1 = await runCycle(CO);
    expect(s1.ok && s1.ran[0].outcome).toBe("requeued");
    let w = (await readWork(CO))!;
    expect(w.tasks[0].status).toBe("todo");
    expect(w.tasks[0].attempts).toBe(1);
    expect(w.tasks[0].feedback[0]).toMatch(/structural/);
    expect(w.deliverables[0].review).toBe("changes_requested");

    const s2 = await runCycle(CO);
    expect(s2.ok && s2.ran[0].outcome).toBe("failed");
    w = (await readWork(CO))!;
    expect(w.tasks[0].status).toBe("failed");
    expect(w.runLog.some((e) => e.kind === "task_failed" && e.taskId === taskId)).toBe(true);

    // Failed-at-ceiling tasks never re-enter the ready set.
    const s3 = await runCycle(CO);
    expect(s3.ok && (s3 as any).ran).toHaveLength(0);
  });

  it("engine failure burns an attempt and requeues", async () => {
    process.env.FAKE_CLAUDE_MODE = "fail";
    await seedTask();
    const { runCycle } = await import("../src/work/cycle.js");
    const { readWork } = await import("../src/work/store.js");
    const s = await runCycle(CO);
    expect(s.ok && s.ran[0].outcome).toBe("requeued");
    const w = (await readWork(CO))!;
    expect(w.tasks[0].status).toBe("todo");
    expect(w.tasks[0].attempts).toBe(1);
    expect(w.deliverables).toHaveLength(0); // no fabricated output, ever
  });

  it("budget exhaustion stops the cycle WITHOUT burning an attempt", async () => {
    await seedTask();
    // Cap 1000, spend 2000 → assertWithinBudget throws before the spawn.
    writeFileSync(join(onboardingDir(), "token-budget.json"), JSON.stringify({ cap_tokens: 1000, set_at: new Date().toISOString() }));
    writeFileSync(join(onboardingDir(), "token-usage.json"), JSON.stringify({
      companyId: CO, started_at: "2026-08-01T00:00:00Z", updated_at: "2026-08-01T00:00:00Z",
      total: { input_tokens: 2000, output_tokens: 0, cached_input_tokens: 0, cost_usd: 0, duration_ms: 0, calls: 1 },
      by_phase: {}, recent_calls: [],
    }));
    const { runCycle } = await import("../src/work/cycle.js");
    const { readWork } = await import("../src/work/store.js");
    const s = await runCycle(CO);
    expect(s.ok && s.ran[0].outcome).toBe("budget_stopped");
    expect(s.ok && (s as any).stoppedEarly).toMatch(/budget/);
    const w = (await readWork(CO))!;
    expect(w.tasks[0].status).toBe("todo");
    expect(w.tasks[0].attempts).toBe(0); // not the agent's failure
  });

  it("dependencies gate readiness; a stale in_progress row is swept", async () => {
    const { emptyWork, writeWork, newId } = await import("../src/work/store.js");
    const w = emptyWork(CO);
    const now = new Date().toISOString();
    const a = newId("task"), b = newId("task");
    w.goals.push({ id: "g", title: "G", description: "", status: "active", source: "manifest", createdAt: now });
    w.tasks.push(
      { id: a, goalId: "g", title: "Stale", brief: "b", assigneeSlot: "ops", status: "in_progress", dependsOn: [], attempts: 1, maxAttempts: 3, feedback: [], createdAt: now, updatedAt: now, startedAt: now, completedAt: null },
      { id: b, goalId: "g", title: "Blocked by A", brief: "b", assigneeSlot: "growth", status: "todo", dependsOn: [a], attempts: 0, maxAttempts: 3, feedback: [], createdAt: now, updatedAt: now, startedAt: null, completedAt: null },
    );
    await writeWork(CO, w);
    const { runCycle } = await import("../src/work/cycle.js");
    const { readWork } = await import("../src/work/store.js");

    const s = await runCycle(CO, { maxTasks: 10 });
    expect(s.ok).toBe(true);
    const after = (await readWork(CO))!;
    // The stale row was swept back to todo and then ran; B stayed gated.
    expect(after.runLog.some((e) => e.kind === "task_requeued" && e.detail.includes("stale"))).toBe(true);
    const taskB = after.tasks.find((t) => t.id === b)!;
    expect(taskB.status).toBe("todo");
    expect(taskB.attempts).toBe(0);
  });
});
