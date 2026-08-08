/** Native ignition — the fleet-start moment WITHOUT Paperclip.
 *
 *  Spec Rev 6 recorded "ignition seeds natively (the goal from the manifest,
 *  one bootstrap task per active slot)" — but this tree never wired it: on a
 *  stock install every Paperclip step in bridge/ignition.ts skipped, activate
 *  returned `ignition_orphaned: true`, fired the Telegram alert, and the
 *  native work runtime 503'd until a human clicked Seed in the canvas.
 *
 *  This is that missing wire. It seeds the work store (seedWork is the same
 *  idempotent implementation POST /work/seed uses) and records the outcome in
 *  ignition-state.json under the NATIVE step vocabulary — `seed_goal` /
 *  `seed_tasks` — which routes/ignition.ts's loose accessor was already
 *  written to accept. Returning a real goal_id is what makes the orphan flag
 *  and its alert go quiet naturally: no special-casing in activate.
 *
 *  bridge/ignition.ts (the 8-step Paperclip path) is deliberately untouched —
 *  activate branches between the two on whether a paperclipCompanyId exists. */

import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { getInstanceDir } from "../state-bridge.js";
import { seedWork } from "../work/seed.js";
import { readWork } from "../work/store.js";
import type { IgnitionResult, IgnitionStepStatus } from "./ignition.js";

/** The native state file shape. Same envelope as the Paperclip
 *  IgnitionState (v/company_id/timestamps/errors/warnings — deriveStatus
 *  reads only those), different step vocabulary. */
interface NativeIgnitionState {
  v: 1;
  company_id: string;
  started_at: string;
  completed_at: string | null;
  steps: {
    seed_goal: { status: IgnitionStepStatus; goal_id?: string; note?: string };
    seed_tasks: { status: IgnitionStepStatus; created: string[]; note?: string };
  };
  errors: { step: string; message: string; ts: string }[];
  warnings: string[];
}

export async function igniteNative(companyId: string): Promise<IgnitionResult> {
  const startedAt = new Date().toISOString();
  const statePath = join(getInstanceDir(companyId), "ignition-state.json");
  const state: NativeIgnitionState = {
    v: 1,
    company_id: companyId,
    started_at: startedAt,
    completed_at: null,
    steps: {
      seed_goal: { status: "pending" },
      seed_tasks: { status: "pending", created: [] },
    },
    errors: [],
    warnings: [],
  };

  const seeded = await seedWork(companyId);

  if (!seeded.ok) {
    state.steps.seed_goal = { status: "error", note: seeded.error };
    state.steps.seed_tasks = { status: "skipped", created: [], note: "goal seeding failed" };
    state.errors.push({ step: "seed_goal", message: seeded.error, ts: new Date().toISOString() });
    state.completed_at = new Date().toISOString();
    await persist(statePath, state);
    return {
      status: "deferred",
      agents_working: 0,
      workflows_queued: 0,
      goal_id: null,
      errors: state.errors,
      warnings: state.warnings,
      ignition_state_path: statePath,
    };
  }

  // `already: true` returns no taskIds — count the store so a re-activate
  // reports the truth instead of zeros.
  let taskIds = seeded.taskIds;
  if (seeded.already && taskIds.length === 0) {
    const w = await readWork(companyId);
    taskIds = (w?.tasks ?? []).map((t) => t.id);
    state.warnings.push("work store already seeded — steps re-recorded from the existing store");
  }

  state.steps.seed_goal = {
    status: "ok",
    goal_id: seeded.goalId,
    note: seeded.already ? "already seeded (idempotent)" : "goal from the company manifest",
  };
  state.steps.seed_tasks = {
    status: "ok",
    created: taskIds,
    note: seeded.already ? "already seeded (idempotent)" : `${taskIds.length} bootstrap tasks`,
  };
  state.completed_at = new Date().toISOString();
  await persist(statePath, state);

  return {
    // Warnings must not demote a healthy idempotent re-run below "partial"
    // semantics on the READ side: deriveStatus maps any warning to
    // "partial", which is accurate — the run did less than a fresh seed.
    status: "ignited",
    agents_working: taskIds.length,
    workflows_queued: taskIds.length,
    goal_id: seeded.goalId,
    errors: state.errors,
    warnings: state.warnings,
    ignition_state_path: statePath,
  };
}

async function persist(path: string, state: NativeIgnitionState): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, JSON.stringify(state, null, 2));
}
