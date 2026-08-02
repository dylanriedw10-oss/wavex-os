/** Native seeding — the fleet-start moment without Paperclip. Derives the
 *  first goal from the manifest and one bootstrap task per active slot.
 *  Idempotent: an existing work.json is never re-seeded. Shared by
 *  POST /work/seed and the ignition path. */

import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { getOnboardingDir } from "../state-bridge.js";
import { resolveAllSlots } from "../lib/redundancy.js";
import {
  DEFAULT_MAX_ATTEMPTS, emptyWork, logEvent, newId, readWork, writeWork,
} from "./store.js";

export interface SeedResult {
  ok: true;
  already: boolean;
  goalId: string;
  taskIds: string[];
}

export async function seedWork(companyId: string): Promise<SeedResult | { ok: false; error: string }> {
  const existing = await readWork(companyId);
  if (existing) {
    return { ok: true, already: true, goalId: existing.goals[0]?.id ?? "", taskIds: [] };
  }

  let manifest: any;
  try {
    manifest = JSON.parse(await readFile(join(getOnboardingDir(companyId), "company.manifest.json"), "utf8"));
  } catch {
    return { ok: false, error: "no company manifest — finalize onboarding first" };
  }

  let slots: Array<{ slot: string; muted: boolean }> = [];
  try {
    slots = (resolveAllSlots(manifest) as Array<{ slot: string; muted: boolean }>).filter((s) => !s.muted);
  } catch {
    slots = [];
  }
  if (slots.length === 0) {
    return { ok: false, error: "manifest has no active agent slots — nothing to seed" };
  }

  const w = emptyWork(companyId);
  const now = new Date().toISOString();
  const g = manifest?.goal;
  const goalId = newId("goal");
  w.goals.push({
    id: goalId,
    title: g?.target != null
      ? `${g.metric ?? "goal"}: ${g.current?.toLocaleString() ?? "?"} → ${g.target.toLocaleString()}${g.days ? ` in ${g.days}d` : ""}`
      : `${companyId} — primary goal`,
    description: "Seeded from the company manifest at fleet start.",
    status: "active",
    source: "manifest",
    createdAt: now,
  });

  const taskIds: string[] = [];
  for (const s of slots) {
    const id = newId("task");
    taskIds.push(id);
    w.tasks.push({
      id, goalId,
      title: `Establish ${s.slot} operating baseline`,
      brief: [
        `You are bootstrapping the "${s.slot}" function of this company.`,
        `Produce the function's operating baseline: what it owns, how it`,
        `contributes to the company goal, and its first concrete moves.`,
        `Sections: Summary, Plan, Next steps`,
      ].join("\n"),
      assigneeSlot: s.slot,
      status: "todo", dependsOn: [],
      attempts: 0, maxAttempts: DEFAULT_MAX_ATTEMPTS, feedback: [],
      createdAt: now, updatedAt: now, startedAt: null, completedAt: null,
    });
  }

  logEvent(w, "seeded", `1 goal · ${taskIds.length} bootstrap tasks from the manifest`);
  await writeWork(companyId, w);
  return { ok: true, already: false, goalId, taskIds };
}
