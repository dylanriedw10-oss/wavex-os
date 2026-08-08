/** Native seeding — the fleet-start moment without Paperclip. Derives the
 *  first goal from the manifest and one bootstrap task per active slot.
 *  Idempotent: an existing work.json is never re-seeded. Shared by
 *  POST /work/seed and the ignition path. */

import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { getOnboardingDir } from "../state-bridge.js";
import { resolveAllSlots } from "../lib/redundancy.js";
import { GOAL_TITLE_BY_PLACEMENT, type Placement } from "../lib/placement.js";
import { readGoal, isStated, goalTitle, UNSTATED } from "../lib/goal-line.js";

/** Imperative title → present-continuous, for the running state.
 *
 *  Deliverables are the UI, and a deliverable in flight reads as an action:
 *  "Write the MVP product spec" pending becomes "Writing the MVP product
 *  spec" while it runs. Only the FIRST word is conjugated — English
 *  imperatives put the verb there, and rewriting further would risk mangling
 *  a title the operator already approved in Review.
 *
 *  Honest limitation: this handles regular verbs and the common doubling
 *  rule, which covers every title the deterministic templates produce. An
 *  irregular verb from a research-inserted step degrades to a slightly odd
 *  gerund, never to a wrong or missing label. */
function activeFormFor(title: string): string {
  const [first, ...rest] = title.split(" ");
  if (!first) return title;
  const w = first.toLowerCase();
  let ing: string;
  if (/[^aeiou]e$/.test(w)) ing = `${w.slice(0, -1)}ing`;              // write → writing
  else if (/^[a-z]*[aeiou][^aeiouwxy]$/.test(w) && w.length <= 5) ing = `${w}${w.slice(-1)}ing`; // run → running
  else ing = `${w}ing`;                                                 // build → building
  return [ing.charAt(0).toUpperCase() + ing.slice(1), ...rest].join(" ");
}
import {
  DEFAULT_MAX_ATTEMPTS, emptyWork, logEvent, newId, readWork, writeWork,
} from "./store.js";

/** `cdo.telemetry` → `telemetry`; a bare `cdo` → `cdo`. The department is
 *  already the row's group, so the leaf is the informative half. */
function functionName(slot: string): string {
  const leaf = slot.split(".").pop() ?? slot;
  return leaf.replace(/[-_]/g, " ");
}

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

  // `muted` is the operator's MANUAL mute list. It is NOT the activation
  // verdict, and filtering on it alone seeded work for every department the
  // operator scoped out at Review — the parking they had just done was
  // honoured by the plan and then silently undone by the work store.
  //
  // The verdict lives on the swarm manifest as `status`. Park an agent and it
  // must get no work; the whole point of subtractive parking is that nothing
  // downstream promotes it back.
  const agentStatus = (manifest?.swarm_manifest?.agents ?? {}) as Record<string, { status?: string }>;
  const RUNNABLE = new Set(["active", "standby"]);
  let slots: Array<{ slot: string; muted: boolean }> = [];
  try {
    slots = (resolveAllSlots(manifest) as Array<{ slot: string; muted: boolean }>)
      .filter((s) => !s.muted)
      // A slot with no entry at all is an ADDITION the operator made by hand,
      // which is a deliberate act and runs. A slot the matrix parked does not.
      .filter((s) => !(s.slot in agentStatus) || RUNNABLE.has(agentStatus[s.slot]?.status ?? "active"));
  } catch {
    slots = [];
  }
  if (slots.length === 0) {
    return { ok: false, error: "manifest has no active agent slots — nothing to seed" };
  }

  const w = emptyWork(companyId);
  const now = new Date().toISOString();
  // Read through `lib/goal-line.ts` rather than reaching into the manifest.
  // This line used to say `g.metric`, a field the manifest goal does not
  // have — it is `kpiId` — so the KPI name was dropped and an operator who
  // chose activation rate got a goal titled "goal: 22 → 45 in 180d". The
  // field being optional plus a `?? "goal"` fallback is exactly why the
  // compiler never objected.
  const g = readGoal(manifest);
  const goalId = newId("goal");
  w.goals.push({
    id: goalId,
    title: g ? goalTitle(g) : `${companyId} — primary goal`,
    description: g && !isStated(g)
      ? `Seeded from the company manifest at fleet start. ${UNSTATED.seed}`
      : "Seeded from the company manifest at fleet start.",
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
      // Titled by FUNCTION, not by slot. The row already sits under its
      // department, so `cdo.telemetry` would be both redundant and an agent
      // identifier in operator copy — agents are an implementation detail
      // (docs/EXECUTION_MODEL.md). The brief still addresses the slot,
      // because that is machine-facing.
      title: `Establish the ${functionName(s.slot)} operating baseline`,
      deliverable: `The ${functionName(s.slot)} function's operating baseline`,
      activeForm: `Establishing the ${functionName(s.slot)} baseline`,
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

  // Path A (Build Your Organization): the plan's build chain seeds as its own
  // goal with REAL dependency edges — what the operator approved in Review
  // is exactly what Birth executes. Read from plan_assembly.json (the run
  // is itself the record); absent or product-adopting companies skip this.
  let mvpSeeded = 0;
  try {
    const planRaw = await readFile(join(getOnboardingDir(companyId), "plan_assembly.json"), "utf8");
    const plan = JSON.parse(planRaw) as {
      placement?: { rung?: string };
      steps?: Array<{ id: string; status?: string; payload?: {
        findings?: Array<{ headline: string; claim: string }>;
        checklist?: Array<{
          id: string; title: string; deliverable: string; assigneeSlot: string;
          kind: string; dependsOn: string[]; origin?: string;
        }>;
      } }>;
    };
    const checklist = plan.steps?.find((s) => s.id === "roadmap")?.payload?.checklist ?? [];
    const mvpItems = checklist.filter((c) => c.kind === "mvp");

    // What research found, folded into every brief. This is the second half
    // of research having teeth: even where it changed no structure, the
    // agents doing the work read what it discovered.
    const research = plan.steps?.find((s) => s.id === "research");
    const preamble = research?.status === "ready"
      ? (research.payload?.findings ?? []).slice(0, 3)
          .map((f) => `- ${f.headline}: ${f.claim}`).join("\n").slice(0, 600)
      : "";
    const withResearch = (lines: string[]): string =>
      (preamble ? [...lines, `What research found:\n${preamble}`] : lines).join("\n");

    if (mvpItems.length > 0) {
      const mvpGoalId = newId("goal");
      w.goals.push({
        id: mvpGoalId,
        // Rung-aware: an `informal` company is not shipping an MVP, it is
        // getting an existing one in front of buyers. Copy only — the
        // structural decision was the checklist's.
        title: GOAL_TITLE_BY_PLACEMENT[(plan.placement?.rung ?? "pre_product") as Placement] ?? "Ship the MVP",
        description: "The plan's build spine — executed first, before operating cadences matter.",
        status: "active",
        source: "plan",
        createdAt: now,
      });
      // Two passes: mint ids, then map the checklist's dependency edges.
      const idFor = new Map(mvpItems.map((c) => [c.id, newId("task")]));
      for (const c of mvpItems) {
        const id = idFor.get(c.id)!;
        taskIds.push(id);
        mvpSeeded += 1;
        w.tasks.push({
          id, goalId: mvpGoalId,
          title: c.title,
          deliverable: c.deliverable,
          activeForm: activeFormFor(c.title),
          brief: withResearch([
            c.deliverable,
            `You are the "${c.assigneeSlot}" agent executing one build step.`,
            c.origin === "research" ? `This step exists because research found it necessary.` : ``,
            `Sections: Summary, Plan, Next steps`,
          ].filter(Boolean)),
          assigneeSlot: c.assigneeSlot,
          status: "todo",
          dependsOn: c.dependsOn.map((d) => idFor.get(d)).filter((x): x is string => Boolean(x)),
          attempts: 0, maxAttempts: DEFAULT_MAX_ATTEMPTS, feedback: [],
          createdAt: now, updatedAt: now, startedAt: null, completedAt: null,
        });
      }
    }
  } catch { /* no plan on disk — the baseline seed stands alone */ }

  logEvent(w, "seeded",
    `${w.goals.length} goal${w.goals.length === 1 ? "" : "s"} · ${taskIds.length - mvpSeeded} bootstrap tasks` +
    (mvpSeeded ? ` · ${mvpSeeded}-task MVP chain from the plan` : ""));
  await writeWork(companyId, w);
  return { ok: true, already: false, goalId, taskIds };
}
