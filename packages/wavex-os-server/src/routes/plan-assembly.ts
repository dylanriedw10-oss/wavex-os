/** Plan assembly — Phase 3 of Build Your Organization, as an event log.
 *
 *  The operating plan is CONSTRUCTED, visibly: four ordered steps
 *  (roadmap → kpis → departments → dependencies) derived from the same
 *  deterministic pipeline the rest of the product consumes — this route
 *  calls generateSwarmWithOverlays / generateWorkflowManifest, so the
 *  manifests it persists ARE the phase-3/4 manifests. Plan assembly is
 *  generation with a visible trace, not a parallel world.
 *
 *  Transport (v1): complete JSON + client pacing. The baselines are
 *  model-free and finish in milliseconds — a server stream of them would
 *  be theater. The T2 refinement tail (skipInference: false) is the only
 *  genuinely async content; it lands as `patches` on the run state and a
 *  2-5s poll covers it. The run file is written replay-style so a future
 *  SSE `GET …/events` (mock-core replay-then-live mechanics) is purely
 *  additive.
 *
 *  State: plan_assembly.json in the onboarding dir, atomic tmp+rename
 *  (the work.json discipline). One run per company; a second `start`
 *  returns the existing run. A server restart mid-refinement degrades to
 *  `stale_refinement` — the baseline steps stand because the manifests
 *  were already persisted; `resume: true` re-runs only the T2 tail. */

import { z } from "zod";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { randomBytes } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";
import {
  generateWorkflowManifest,
  loadConnectorManifest,
  loadPillarResponses,
  loadSwarmManifest,
} from "@wavex-os/plugin-onboarding";
import { assertBoard, assertCompanyAccess, AuthError } from "@wavex-os/auth-shim";
import { getOnboardingDir } from "../state-bridge.js";
import { withTokenAccounting } from "../lib/token-accounting.js";
import { generateSwarmWithOverlays } from "../lib/swarm-overlays.js";
import { synthesizeGoal, type SynthesizedGoal } from "../lib/goal-synthesis.js";
import { readStrategy, type StatedGoal, type Strategy } from "../lib/strategy.js";
import { CHAIN_BY_PLACEMENT, placeOperator, type Placement, type PlacementResult } from "../lib/placement.js";
import type { ResearchPayload } from "../research/types.js";
import { applyResearchToChecklist } from "../research/apply.js";
import { runResearch } from "../research/run.js";
import { EMPTY_RESEARCH } from "../research/types.js";
import { readScope } from "../lib/swarm-overlays.js";
import { canonicalKpiId } from "../lib/kpi-registry.js";

/* ------------------------------------------------------------------ */
/* Wire contract — mirrored by onboarding-ui/src/canvas/plan-contract.ts */
/* ------------------------------------------------------------------ */

export type AssemblyStepId = "research" | "roadmap" | "kpis" | "departments" | "dependencies";

/** A step's `seq` is a CONSTANT of its id, not its position in the array.
 *
 *  It used to be the array index, which meant inserting a step silently
 *  renumbered every step after it — and `AssemblyPatch.seq` was computed as
 *  `steps.length + i`, so patches shifted too and collided with any patch
 *  written before the insertion. Both bug classes disappear when the number
 *  is a property of the identity rather than of the layout.
 *
 *  A run that skipped research simply has no step at 0. A hole is exactly
 *  what "that step did not run" should look like. */
export const STEP_SEQ: Record<AssemblyStepId, number> = {
  research: 0, roadmap: 1, kpis: 2, departments: 3, dependencies: 4,
};

/** `ready` = settled content. `running` = in flight (research only — it is
 *  the one step that takes real time). `skipped` = deliberately not run
 *  (disabled, or the token budget was exhausted). `failed` = ran and produced
 *  nothing usable; the deterministic plan stands regardless.
 *
 *  Deliberately NO `pending`: emitting the deterministic steps as empty
 *  placeholders would break both consumers that read presence as truth —
 *  `deriveUnits` would build cells from empty payloads, and `work/seed.ts`
 *  would read a roadmap with an empty checklist as "no MVP". */
export type AssemblyStepStatus = "running" | "ready" | "skipped" | "failed";

export interface ChecklistItem {
  id: string;
  title: string;
  /** What "done" produces — becomes the deliverable expectation in the brief. */
  deliverable: string;
  assigneeSlot: string;
  kind: "mvp" | "operating" | "bundle";
  bundleId?: string;
  dependsOn: string[];
}

export interface AssemblyStep {
  id: AssemblyStepId;
  seq: number;                        // STEP_SEQ[id] — constant per id, forever
  status: AssemblyStepStatus;
  /** One honest operator line when `skipped` or `failed`. */
  note?: string;
  payload:
    | ResearchPayload                                                                           // research
    | { goal: SynthesizedGoal; checklist: ChecklistItem[] }                                    // roadmap
    | { kpis: Array<{ kpiId: string; label: string; direction: "up" | "down"; ownerRole: string | null; bundleId: string | null }> }
    | { departments: Array<{ slot: string; department: string; agents: Array<{ slot: string; status: string }> }>; counts: { active: number; standby: number; parked: number; disabled: number } }
    | { bundles: Array<{ bundleId: string; owner: string; cycleLength: string; participatingAgents: string[]; kpisMoved: string[] }>; edges: Array<{ from: string; to: string; via: string }> };
}

export interface AssemblyPatch {
  /** Patch-LOCAL: 0,1,2… within `patches`. It used to be derived from the
   *  step count, which made it shift whenever a step was added and collide
   *  with patches written before that. Patches are their own sequence. */
  seq: number;
  step: AssemblyStepId;
  source: "t2" | "research";
  kind: "skill_overlay" | "workflow_patch" | "mvp_step_insert" | "mvp_step_refocus";
  slot: string;
  detail: string;                     // human-readable refinement line
  pillarSignal?: string;
}

export interface AssemblyRunState {
  v: 1;
  runId: string;
  companyId: string;
  status: "researching" | "refining" | "complete" | "failed" | "stale_research" | "stale_refinement";
  startedAt: string;
  finishedAt: string | null;
  steps: AssemblyStep[];
  patches: AssemblyPatch[];
  warnings: string[];
  /** Where this operator sits on the product spectrum, and how that was
   *  decided. Published here because the run is ALREADY the shared artifact:
   *  written by the server, read off disk by work/seed.ts, and mirrored into
   *  client state. Consumers read it for COPY only — the structural question
   *  ("does Birth start at the MVP stage?") is answered by the checklist
   *  itself, so the plan and Birth cannot disagree. */
  placement: PlacementResult;
}

/* ------------------------------------------------------------------ */
/* Run state on disk                                                    */
/* ------------------------------------------------------------------ */

function statePath(companyId: string): string {
  return join(getOnboardingDir(companyId), "plan_assembly.json");
}

async function readRun(companyId: string): Promise<AssemblyRunState | null> {
  try {
    return JSON.parse(await readFile(statePath(companyId), "utf8")) as AssemblyRunState;
  } catch {
    return null;
  }
}

async function writeRun(state: AssemblyRunState): Promise<void> {
  const path = statePath(state.companyId);
  await mkdir(getOnboardingDir(state.companyId), { recursive: true });
  const tmp = `${path}.tmp-${randomBytes(4).toString("hex")}`;
  await writeFile(tmp, JSON.stringify(state, null, 2), "utf8");
  await rename(tmp, path);
}

/** One refinement in flight per company, per process. */
const REFINING = new Set<string>();

/* ------------------------------------------------------------------ */
/* Step derivation — all deterministic, all from the persisted manifests */
/* ------------------------------------------------------------------ */

type SwarmAgents = Record<string, { department?: string; status?: string; reports_to?: string | null }>;
interface WorkflowShape {
  agent_workflows?: Record<string, { on_fire?: Array<{ title?: string; expected_output?: string; dry_run_gate?: boolean }> }>;
  bundle_workflows?: Record<string, { owner?: string; cycle_length?: string; participating_agents?: string[]; kpis_moved?: string[] }>;
  t2_patches?: Array<{ agent_id?: string; rationale?: string; pillar_signal?: string }>;
}

const KPI_LABELS: Record<string, { label: string; direction: "up" | "down" }> = {
  monthly_recurring_revenue: { label: "Monthly Recurring Revenue (USD)", direction: "up" },
  burn_multiple: { label: "Burn Multiple", direction: "down" },
  cac: { label: "Customer Acquisition Cost (USD)", direction: "down" },
  cac_payback_months: { label: "CAC Payback Months", direction: "down" },
};

/** The deterministic MVP chain (Path A): each entry names its preferred
 *  slots in order; the first ACTIVE one wins, so a focused scope still
 *  produces a coherent build graph. An entry with no active candidate is
 *  dropped and its dependents re-point past it. */
const MVP_TEMPLATE: Array<{ key: string; title: string; deliverable: string; candidates: string[]; deps: string[] }> = [
  { key: "spec", title: "Write the MVP product spec", deliverable: "A build-ready spec: the ONE core user journey, data model, and out-of-scope list", candidates: ["cpo", "cpo.roadmap", "ceo.orchestrator"], deps: [] },
  { key: "build", title: "Build the MVP", deliverable: "A working first version implementing the spec's core journey end to end", candidates: ["cpo.build", "cpo", "ceo.orchestrator"], deps: ["spec"] },
  { key: "instrument", title: "Instrument the MVP", deliverable: "Activation + usage events wired so the KPI baseline can be measured", candidates: ["cdo.telemetry", "cdo", "cpo"], deps: ["build"] },
  { key: "positioning", title: "Write positioning and landing copy", deliverable: "A landing narrative: who it is for, the problem, the promise, the call to action", candidates: ["cmo.content", "cmo", "ceo.orchestrator"], deps: ["spec"] },
  { key: "validate", title: "Run first-user validation", deliverable: "Findings from the first real users against the spec's core journey, with a revise/ship call", candidates: ["cpo.growth", "cro", "cpo"], deps: ["build", "instrument"] },
];

function buildChecklist(
  swarmAgents: SwarmAgents,
  workflow: WorkflowShape,
  placement: Placement,
): ChecklistItem[] {
  const items: ChecklistItem[] = [];
  const active = (slot: string) => swarmAgents[slot]?.status === "active";

  // The build chain first — it is the plan's spine wherever there is still
  // something to build. WHICH links it contains is the rung's job
  // (CHAIN_BY_PLACEMENT): the full five pre-product, the last three for a
  // product that exists informally, none for one already operating.
  //
  // Note there is no `if` around this: an empty chain produces no items, so
  // `operating` needs no special case. The same dependency resolver that
  // re-points past a slot with no active candidate also re-points past a
  // link the rung excluded — which is the entire implementation of the
  // partial chain.
  const inChain = new Set(CHAIN_BY_PLACEMENT[placement]);
  const chosen = new Map<string, { id: string; slot: string }>();
  for (const t of MVP_TEMPLATE) {
    if (!inChain.has(t.key)) continue;
    const slot = t.candidates.find(active);
    if (!slot) continue;                    // dropped; dependents re-point past it
    chosen.set(t.key, { id: `mvp-${t.key}`, slot });
  }
  for (const t of MVP_TEMPLATE) {
    const c = chosen.get(t.key);
    if (!c) continue;
    items.push({
      id: c.id,
      title: t.title,
      deliverable: t.deliverable,
      assigneeSlot: c.slot,
      kind: "mvp",
      dependsOn: t.deps.map((d) => chosen.get(d)?.id).filter((x): x is string => Boolean(x)),
    });
  }

  // Operating items: each active slot's first real on-fire task (the same
  // derivation bridge/ignition.ts uses for seed_issues).
  for (const [slot, wf] of Object.entries(workflow.agent_workflows ?? {})) {
    if (!active(slot)) continue;
    const task = (wf.on_fire ?? []).find((t) => !t.dry_run_gate && t.title);
    if (!task?.title) continue;
    items.push({
      id: `op-${slot}`,
      title: task.title,
      deliverable: task.expected_output ?? "The task's stated output, complete and self-contained",
      assigneeSlot: slot,
      kind: "operating",
      dependsOn: [],
    });
  }

  // Bundle items: the cross-agent initiatives, owned and cadenced.
  for (const [bundleId, b] of Object.entries(workflow.bundle_workflows ?? {})) {
    if (!b.owner || !active(b.owner)) continue;
    items.push({
      id: `bundle-${bundleId}`,
      title: `Run the ${bundleId.replace(/_/g, " ")} cycle`,
      deliverable: `A ${b.cycle_length ?? "cycle"} report moving: ${(b.kpis_moved ?? []).map(canonicalKpiId).join(", ") || "its KPIs"}`,
      assigneeSlot: b.owner,
      kind: "bundle",
      bundleId,
      dependsOn: [],
    });
  }
  return items;
}

function deriveSteps(
  responses: { pillar_1?: { has_product?: boolean }; pillar_3?: { product_state?: string; stage?: string } },
  swarm: { agents: SwarmAgents },
  workflow: WorkflowShape,
  /** The settled research step, when there is one. Threaded in rather than
   *  read from disk so this stays a pure function of its inputs — which is
   *  what makes re-derivation reproduce the same checklist. */
  research: AssemblyStep | null = null,
  /** Collector for the patches research application produces. They belong on
   *  the RUN, not on a step, so they cannot ride the return value — and
   *  silently dropping them would leave the operator with research-inserted
   *  checklist rows and no record of where they came from. */
  outPatches?: Array<Omit<AssemblyPatch, "seq">>,
  /** The operator's Strategy RECORD, when Strategy captured one — the whole
   *  thing, not `.goal`. Threaded rather than read from disk so deriveSteps
   *  stays pure, same reason as `research` above.
   *
   *  It is the record and not the goal because `stated` is a SIBLING of
   *  `goal`: passing `strategy.goal` stranded the flag and made every goal
   *  that reached here claim the operator's endorsement. */
  strategy?: Strategy | null,
): AssemblyStep[] {
  const agents = swarm.agents;
  // ONE placement decision, read by both the chain and the goal band. They
  // used to compute it separately, with different rules, in the same payload.
  const placement = placeOperator(responses).rung;

  // The deterministic chain first, then research's deltas on top of it. This
  // order is the spec's causality made literal: planning interpolates into
  // the gap between the goal and what research found possible.
  let checklist = buildChecklist(agents, workflow, placement);
  if (research?.status === "ready") {
    const applied = applyResearchToChecklist(
      checklist,
      (research.payload as ResearchPayload).findings,
      { activeSlots: new Set(Object.keys(agents).filter((s) => agents[s]?.status === "active")) },
    );
    checklist = applied.checklist as ChecklistItem[];
    // The audit trail is written back onto the research step — the one
    // deliberate mutation here, and the mechanism by which Review can say
    // exactly which lines research put there. `applied` is recomputed from
    // scratch on every derive, so this stays idempotent.
    (research.payload as ResearchPayload).applied = applied.applied;
    // Drop reasons ride on the step's own note rather than the run's
    // warnings: they are facts about research, and the operator reads them
    // where the findings are.
    research.note = applied.warnings.length > 0 ? applied.warnings.join(" · ") : undefined;
    outPatches?.push(...applied.patches);
  }

  // roadmap — the goal + the ONE revisable artifact, the checklist.
  const roadmap: AssemblyStep = {
    id: "roadmap", seq: STEP_SEQ.roadmap, status: "ready",
    payload: { goal: synthesizeGoal(responses.pillar_3, placement, strategy), checklist },
  };

  // kpis — canonical set, owners from bundle owners (first sorted bundle
  // that moves the KPI and is active; null stays honest).
  const bundles = workflow.bundle_workflows ?? {};
  const ownerFor = (kpiId: string): { ownerRole: string | null; bundleId: string | null } => {
    for (const key of Object.keys(bundles).sort()) {
      const b = bundles[key];
      if (!b?.owner) continue;
      if (!(b.kpis_moved ?? []).map(canonicalKpiId).includes(kpiId)) continue;
      if (agents[b.owner]?.status === "active") return { ownerRole: b.owner, bundleId: key };
      const root = b.owner.split(".")[0]!;
      if (root !== b.owner && agents[root]?.status === "active") return { ownerRole: root, bundleId: key };
      return { ownerRole: null, bundleId: key };
    }
    return { ownerRole: null, bundleId: null };
  };
  const kpis: AssemblyStep = {
    id: "kpis", seq: STEP_SEQ.kpis, status: "ready",
    payload: {
      kpis: Object.entries(KPI_LABELS).map(([kpiId, def]) => ({
        kpiId, label: def.label, direction: def.direction, ...ownerFor(kpiId),
      })),
    },
  };

  // departments — chiefs with their reports, counted by status. Only
  // ACTIVE departments enter the plan (a scope-parked chief is not part of
  // this organization — the wheel must not grow a segment for it).
  const chiefs = Object.entries(agents)
    .filter(([slot, a]) => !slot.startsWith("ceo.") && !slot.includes(".") && a.status === "active")
    .map(([slot, a]) => ({
      slot,
      department: a.department ?? slot,
      agents: Object.entries(agents)
        .filter(([s]) => s.startsWith(`${slot}.`))
        .map(([s, sa]) => ({ slot: s, status: sa.status ?? "unknown" })),
    }));
  const counts = { active: 0, standby: 0, parked: 0, disabled: 0 };
  for (const a of Object.values(agents)) {
    if (a.status === "active") counts.active += 1;
    else if (a.status === "standby") counts.standby += 1;
    else if (a.status === "parked") counts.parked += 1;
    else if (a.status === "disabled") counts.disabled += 1;
  }
  const departments: AssemblyStep = {
    id: "departments", seq: STEP_SEQ.departments, status: "ready",
    payload: { departments: chiefs, counts },
  };

  // dependencies — the bundles and the edges their agent sequences imply.
  const edges: Array<{ from: string; to: string; via: string }> = [];
  for (const [bundleId, b] of Object.entries(bundles)) {
    const seq = (b.participating_agents ?? []).filter((s) => agents[s]);
    for (let i = 0; i < seq.length - 1; i++) {
      edges.push({ from: seq[i]!, to: seq[i + 1]!, via: bundleId });
    }
  }
  const dependencies: AssemblyStep = {
    id: "dependencies", seq: STEP_SEQ.dependencies, status: "ready",
    payload: {
      bundles: Object.entries(bundles).map(([bundleId, b]) => ({
        bundleId,
        owner: b.owner ?? "",
        cycleLength: b.cycle_length ?? "",
        participatingAgents: b.participating_agents ?? [],
        kpisMoved: (b.kpis_moved ?? []).map(canonicalKpiId),
      })),
      edges,
    },
  };

  return [roadmap, kpis, departments, dependencies];
}

/* ------------------------------------------------------------------ */
/* The T2 refinement tail                                               */
/* ------------------------------------------------------------------ */

function diffOverlays(before: SwarmAgents & Record<string, { skill_overlay?: string | null }>, after: typeof before): AssemblyPatch[] {
  const patches: AssemblyPatch[] = [];
  for (const [slot, a] of Object.entries(after)) {
    const was = (before[slot] as { skill_overlay?: string | null } | undefined)?.skill_overlay ?? null;
    const now = a.skill_overlay ?? null;
    if (now && now !== was) {
      patches.push({
        seq: 0, step: "departments", source: "t2", kind: "skill_overlay",
        slot, detail: `skill overlay: ${now}`,
      });
    }
  }
  return patches;
}

async function runRefinementTail(companyId: string): Promise<void> {
  const run = await readRun(companyId);
  if (!run) return;
  try {
    const connector = await loadConnectorManifest(companyId);
    if (!connector) throw new Error("connector manifest disappeared before refinement");
    const responses = await loadPillarResponses(companyId);
    const baselineAgents = (await loadSwarmManifest(companyId) as unknown as { agents: SwarmAgents & Record<string, { skill_overlay?: string | null }> }).agents;

    // Swarm T2 — may only refine skill_overlay (the vendored clamp).
    const refinedSwarm = await withTokenAccounting(companyId, "swarm_manifest", () =>
      generateSwarmWithOverlays(companyId, { skipInference: false, connectorManifest: connector }));
    const overlayPatches = diffOverlays(baselineAgents, (refinedSwarm.manifest as unknown as { agents: SwarmAgents & Record<string, { skill_overlay?: string | null }> }).agents);

    // Workflow T2 — gated patches; the persisted manifest carries its own
    // attribution records, which ARE the patch events.
    const refinedWorkflow = await withTokenAccounting(companyId, "workflow_manifest", () =>
      generateWorkflowManifest({
        companyId, responses, connectorManifest: connector,
        swarmManifest: refinedSwarm.manifest as never,
        skipInference: false, bypassBudgetCheck: true,
      }));
    const wfPatches: AssemblyPatch[] = (((refinedWorkflow.manifest as unknown as WorkflowShape).t2_patches) ?? [])
      .filter((p) => p.agent_id)
      .map((p) => ({
        seq: 0, step: "roadmap" as const, source: "t2" as const, kind: "workflow_patch" as const,
        slot: p.agent_id!, detail: p.rationale ?? "workflow refined", pillarSignal: p.pillar_signal,
      }));

    const latest = await readRun(companyId);
    if (!latest) return;
    // Refinement may have re-shaped the deterministic payloads too (overlays
    // live on the departments step's agents) — re-derive the steps so the
    // run file mirrors the manifests on disk.
    //
    // MERGE, never replace. `deriveSteps` only produces the four deterministic
    // steps, so assigning its result wholesale would delete the research step
    // and un-apply every research-derived checklist item — silently, and only
    // for operators who ran with refinement on.
    const workflow = refinedWorkflow.manifest as unknown as WorkflowShape;
    const swarm = refinedSwarm.manifest as unknown as { agents: SwarmAgents };
    const research = latest.steps.find((s) => s.id === "research") ?? null;
    const strategy = await readStrategy(companyId);
    latest.steps = [
      ...(research ? [research] : []),
      ...deriveSteps(responses as never, swarm, workflow, research, undefined, strategy),
    ];
    // Same for patches: research patches are the audit trail of what research
    // changed, and they outlive the tail. Seq is patch-local.
    const kept = latest.patches.filter((p) => p.source === "research");
    latest.patches = [
      ...kept,
      ...[...overlayPatches, ...wfPatches].map((p, i) => ({ ...p, seq: kept.length + i })),
    ];
    latest.warnings = [...new Set([...latest.warnings, ...refinedSwarm.warnings, ...refinedWorkflow.warnings])];
    latest.status = "complete";
    latest.finishedAt = new Date().toISOString();
    await writeRun(latest);
  } catch (e) {
    const latest = await readRun(companyId);
    if (!latest) return;
    // The baseline stands — vendored degradation semantics. Refinement
    // failure is a warning, not a failed plan.
    latest.warnings = [...latest.warnings, `refinement failed: ${e instanceof Error ? e.message : String(e)} — the deterministic plan stands`];
    latest.status = "complete";
    latest.finishedAt = new Date().toISOString();
    await writeRun(latest);
  } finally {
    REFINING.delete(companyId);
  }
}

/* ------------------------------------------------------------------ */
/* Research → settle                                                    */
/* ------------------------------------------------------------------ */

/** One research call in flight per company, per process — and the HANDLE to
 *  await it. A `Set` could only answer "is someone working?"; it could not
 *  answer "tell me when they are done", which left every consumer polling
 *  `status !== "researching"` — a condition that reads the same before the
 *  worker starts and after it finishes, and cannot tell a run settled WITH
 *  research from one the stale recovery below settled WITHOUT it. */
const RESEARCHING = new Map<string, Promise<void>>();

/** The completion signal a fire-and-forget worker otherwise cannot give.
 *  Resolves once the worker has settled the run file; `undefined` when
 *  nothing is in flight for this company (already settled, or never started).
 *  This is also what makes the staleness check below honest: it is sampled
 *  BEFORE the run is read, so the two observations cannot be paired out of
 *  order. */
export function researchInFlight(companyId: string): Promise<void> | undefined {
  return RESEARCHING.get(companyId);
}

interface DeterministicCtx {
  responses: unknown;
  swarm: { agents: SwarmAgents };
  workflow: WorkflowShape;
  /** The operator's Strategy RECORD, read once at /start and carried, so
   *  every re-derivation (the refinement tail, stale recovery) reproduces the
   *  same goal rather than re-reading disk at a different moment.
   *
   *  The record, not `.goal` — `stated` is its sibling, and stranding it made
   *  a declined goal claim the operator chose it. */
  strategy: Strategy | null;
}

/** THE ONE WRITER of the four deterministic steps.
 *
 *  Called on research success, on research failure, and on stale recovery —
 *  three callers, one path, so "the deterministic plan stands" cannot rot
 *  into three subtly different behaviors. */
async function settleDeterministically(
  companyId: string,
  ctx: DeterministicCtx,
  research: AssemblyStep | null,
  extraWarnings: string[],
  kickRefinementTail: boolean,
): Promise<void> {
  const latest = await readRun(companyId);
  if (!latest) return;
  // deriveSteps mutates `research`'s payload with the applied audit trail and
  // its note, so build the steps BEFORE assembling the array.
  const researchPatches: Array<Omit<AssemblyPatch, "seq">> = [];
  const deterministic = deriveSteps(ctx.responses as never, ctx.swarm, ctx.workflow, research, researchPatches, ctx.strategy);
  latest.steps = [...(research ? [research] : []), ...deterministic];
  // Research patches are the audit trail for every row research put in the
  // plan. Seq is patch-local, so a later refinement tail appends after them.
  latest.patches = researchPatches.map((p, i) => ({ ...p, seq: i }));
  latest.warnings = [...new Set([...latest.warnings, ...extraWarnings])];
  latest.status = kickRefinementTail ? "refining" : "complete";
  latest.finishedAt = kickRefinementTail ? null : new Date().toISOString();
  await writeRun(latest);
  if (kickRefinementTail) {
    REFINING.add(companyId);
    void runRefinementTail(companyId);
  }
}

/** Fire-and-forget: run research, then settle whatever it produced.
 *
 *  Research and the refinement tail are SEQUENCED, never concurrent — both
 *  end in a `deriveSteps` write, and running them together would race. */
async function researchThenSettle(companyId: string, ctx: DeterministicCtx, skipInference: boolean): Promise<void> {
  try {
    const responses = ctx.responses as Record<string, unknown>;
    const connector = await loadConnectorManifest(companyId).catch(() => null);
    const scope = await readScope(companyId).catch(() => null);
    const activeSlots = Object.keys(ctx.swarm.agents).filter((s) => ctx.swarm.agents[s]?.status === "active");
    // Anchors are ADDRESSES ONLY — ids and titles. Research is never shown
    // what a step produces, because being handed the gap is the difference
    // between discovery and critique.
    const anchors = deriveSteps(ctx.responses as never, ctx.swarm, ctx.workflow, null, undefined, ctx.strategy)
      .find((s) => s.id === "roadmap");
    const checklist = (anchors?.payload as { checklist?: ChecklistItem[] })?.checklist ?? [];

    // Research is the terminal consumer and runs once. Everything the
    // operator stated reaches it, including whether the goal is theirs.
    const strategy = await readStrategy(companyId).catch(() => null);
    const goal = synthesizeGoal(
      (responses as { pillar_3?: { product_state?: string; stage?: string } }).pillar_3,
      placeOperator(responses as never).rung,
      ctx.strategy,
    );
    const outcome = await runResearch(companyId, {
      companyId,
      pillars: responses,
      rawInput: typeof (responses as { pillar_1?: { raw_input?: string } }).pillar_1?.raw_input === "string"
        ? (responses as { pillar_1?: { raw_input?: string } }).pillar_1!.raw_input!
        : null,
      strategy: {
        kpiId: goal.kpiId, current: goal.current, target: goal.target, days: goal.days,
        stated: goal.stated, bottleneck: strategy?.bottleneck ?? null,
      },
      connectors: connectorEntries(connector),
      scope: scope ? { mode: scope.mode, departments: scope.departments } : null,
      anchors: checklist.filter((c) => c.kind === "mvp").map((c) => ({ id: c.id, title: c.title })),
      activeSlots,
    });

    const step: AssemblyStep =
      outcome.kind === "ready"
        ? { id: "research", seq: STEP_SEQ.research, status: "ready", payload: outcome.payload }
        : { id: "research", seq: STEP_SEQ.research, status: outcome.kind, note: outcome.note, payload: EMPTY_RESEARCH };

    await settleDeterministically(companyId, ctx, step, outcome.warnings, !skipInference);
  } catch (e) {
    // Even an unexpected throw settles the plan. Nothing about research may
    // leave an operator with no plan at all.
    const note = e instanceof Error ? e.message : String(e);
    await settleDeterministically(
      companyId, ctx,
      { id: "research", seq: STEP_SEQ.research, status: "failed", note: "research didn't complete", payload: EMPTY_RESEARCH },
      [`research failed: ${note} — the deterministic plan stands`],
      !skipInference,
    ).catch(() => { /* the run file is already the operator's best answer */ });
  } finally {
    RESEARCHING.delete(companyId);
  }
}

/** Rebuild the deterministic plan for a run whose research worker died with
 *  the process. Reads the manifests `/start` already persisted, so this costs
 *  three file reads and no model call. Returns the settled run, or null if
 *  the manifests are gone (in which case the caller returns what it has). */
async function recoverStaleResearch(companyId: string): Promise<AssemblyRunState | null> {
  try {
    const responses = await loadPillarResponses(companyId);
    const swarm = await loadSwarmManifest(companyId);
    const connector = await loadConnectorManifest(companyId);
    if (!swarm || !connector) return null;
    const workflowResult = await generateWorkflowManifest({
      companyId, responses, connectorManifest: connector,
      swarmManifest: swarm as never, skipInference: true,
    });
    await settleDeterministically(
      companyId,
      {
        responses,
        swarm: swarm as unknown as { agents: SwarmAgents },
        workflow: workflowResult.manifest as unknown as WorkflowShape,
        strategy: await readStrategy(companyId),
      },
      null,
      ["stale_research: the server restarted mid-research — the deterministic plan stands"],
      false,
    );
    return await readRun(companyId);
  } catch {
    return null;
  }
}

/** Flatten a connector manifest into the {id, bucket, status} rows research
 *  reads. Status is what separates a wired capability from a suggestion. */
function connectorEntries(manifest: unknown): Array<{ id: string; bucket: "required" | "suggested" | "deferred"; status: string }> {
  const m = (manifest ?? {}) as Record<string, unknown>;
  const out: Array<{ id: string; bucket: "required" | "suggested" | "deferred"; status: string }> = [];
  for (const bucket of ["required", "suggested", "deferred"] as const) {
    for (const e of (Array.isArray(m[bucket]) ? m[bucket] : []) as unknown[]) {
      if (typeof e === "string") out.push({ id: e, bucket, status: "unknown" });
      else if (e && typeof e === "object") {
        const r = e as Record<string, unknown>;
        const id = typeof r.id === "string" ? r.id : typeof r.connector === "string" ? r.connector : null;
        if (id) out.push({ id, bucket, status: typeof r.status === "string" ? r.status : "unknown" });
      }
    }
  }
  return out;
}

/* ------------------------------------------------------------------ */
/* Routes                                                               */
/* ------------------------------------------------------------------ */

const startSchema = z.object({
  companyId: z.string().min(1),
  skipInference: z.boolean().optional(),
  resume: z.boolean().optional(),
  /** Research is a required sub-step of Phase 3, so it defaults ON. Tests and
   *  CI pass `false`; `WAVEX_RESEARCH_DISABLED=1` is the environment kill
   *  switch. `skipInference` keeps its own meaning — the T2 REFINEMENT tail. */
  research: z.boolean().optional(),
});

function authReq(req: FastifyRequest) {
  return { method: req.method, headers: req.headers as Record<string, string> };
}

function gate(req: FastifyRequest, reply: FastifyReply): boolean {
  try { assertBoard(authReq(req)); return true; }
  catch (e) {
    if (e instanceof AuthError) { reply.status(e.statusCode).send({ error: e.message }); return false; }
    throw e;
  }
}

export function registerPlanAssemblyRoutes(app: FastifyInstance): void {
  app.post("/wavex-os/onboarding/plan-assembly/start", async (req, reply) => {
    if (!gate(req, reply)) return;
    const parsed = startSchema.safeParse(req.body);
    if (!parsed.success) return reply.status(400).send({ error: "validation failed", issues: parsed.error.issues });
    const { companyId, skipInference = true, resume = false } = parsed.data;
    // Default ON: research is part of Phase 3, not an opt-in.
    const research = (parsed.data.research ?? true) && process.env.WAVEX_RESEARCH_DISABLED !== "1";
    assertCompanyAccess(authReq(req), companyId);

    const existing = await readRun(companyId);

    // Idempotency: a live or completed run answers as-is unless the caller
    // explicitly resumes a stale refinement.
    if (existing && !resume) {
      if (existing.status === "refining" && !REFINING.has(companyId)) {
        existing.status = "stale_refinement";
        await writeRun(existing);
      }
      return { ok: true, run: existing };
    }
    if (existing && resume) {
      if (REFINING.has(companyId)) return { ok: true, run: existing };
      existing.status = "refining";
      existing.finishedAt = null;
      await writeRun(existing);
      REFINING.add(companyId);
      void runRefinementTail(companyId);
      return { ok: true, run: existing };
    }

    // Fresh run: the deterministic pipeline, synchronously — milliseconds,
    // no model. 409 mirrors the phase routes' precondition vocabulary.
    const connector = await loadConnectorManifest(companyId).catch(() => null);
    if (!connector) return reply.status(409).send({ error: "connector manifest not generated" });
    const responses = await loadPillarResponses(companyId);

    const swarmResult = await generateSwarmWithOverlays(companyId, { skipInference: true, connectorManifest: connector });
    const workflowResult = await generateWorkflowManifest({
      companyId, responses, connectorManifest: connector,
      swarmManifest: swarmResult.manifest as never,
      skipInference: true,
    });

    // A placement decided from `has_product` is a PRESUMPTION — that field
    // defaults to true in every producer. Surfacing the note turns a silent
    // default into something the operator can see and correct.
    const placement = placeOperator(responses);
    const baseWarnings = [...new Set([
      ...swarmResult.warnings,
      ...workflowResult.warnings,
      ...(placement.presumed ? [placement.note] : []),
    ])];

    const ctx: DeterministicCtx = {
      responses,
      swarm: swarmResult.manifest as unknown as { agents: SwarmAgents },
      workflow: workflowResult.manifest as unknown as WorkflowShape,
      strategy: await readStrategy(companyId),
    };

    const runId = `plan_${Date.now().toString(36)}_${randomBytes(3).toString("hex")}`;
    const startedAt = new Date().toISOString();

    if (!research) {
      // Research off: today's behavior exactly — the four deterministic
      // steps, complete, in milliseconds.
      const run: AssemblyRunState = {
        v: 1, runId, companyId,
        status: skipInference ? "complete" : "refining",
        startedAt, finishedAt: skipInference ? new Date().toISOString() : null,
        steps: deriveSteps(ctx.responses as never, ctx.swarm, ctx.workflow, null, undefined, ctx.strategy),
        patches: [], warnings: baseWarnings, placement,
      };
      await writeRun(run);
      if (!skipInference) { REFINING.add(companyId); void runRefinementTail(companyId); }
      return { ok: true, run };
    }

    // Research on: the run comes back carrying ONLY the research step, in
    // flight. The four deterministic steps land in one atomic write when it
    // resolves.
    //
    // This ordering is the contract, not a rendering choice. Returning the
    // plan first and patching research over it afterwards would make the run
    // file assert a causality that did not happen — the spec's "research
    // first, planning interpolates second" would become decoration. Every
    // consumer is safe meanwhile: they look steps up by id, so a mid-research
    // run simply has no roadmap yet.
    const run: AssemblyRunState = {
      v: 1, runId, companyId,
      status: "researching",
      startedAt, finishedAt: null,
      steps: [{ id: "research", seq: STEP_SEQ.research, status: "running", payload: EMPTY_RESEARCH }],
      patches: [], warnings: baseWarnings, placement,
    };
    await writeRun(run);
    // The worker's own promise IS the registry entry: `researchThenSettle`
    // runs to its first await and hands back a handle, which is stored before
    // anything can yield, so the run file never says "researching" while the
    // registry says nobody is on it.
    RESEARCHING.set(companyId, researchThenSettle(companyId, ctx, skipInference));
    return { ok: true, run };
  });

  app.get("/wavex-os/onboarding/plan-assembly", async (req, reply) => {
    if (!gate(req, reply)) return;
    const { companyId } = (req.query ?? {}) as { companyId?: string };
    if (!companyId) return reply.status(400).send({ error: "companyId required" });
    assertCompanyAccess(authReq(req), companyId);
    // Sampled BEFORE the read, and that order is the whole point. `readRun`
    // is a yield: the bytes are taken at one instant and the continuation
    // runs at a later one, so asking the registry after the read pairs an
    // OLD view of the file with a NEW view of who is working. Under load
    // that window is wide enough for a worker to finish inside it, and the
    // recovery below would then rebuild the plan from the manifests with
    // `research = null` — overwriting, on disk, the findings it had just
    // produced. Sampling first makes "in flight" strictly no younger than
    // the snapshot, so a worker seen as gone really is gone.
    const researchWorker = researchInFlight(companyId);
    const run = await readRun(companyId);
    if (!run) return { ok: true, exists: false, run: null };
    // A refining run with no in-process worker means the server restarted
    // mid-tail: report it honestly so the client can offer resume.
    if (run.status === "refining" && !REFINING.has(companyId)) {
      run.status = "stale_refinement";
      await writeRun(run);
    }
    // A RESEARCHING run with no worker is different, and cannot simply be
    // relabelled: that run holds one in-flight step and no plan at all, which
    // is useless to the operator. Settle it from the manifests already on
    // disk (all written at /start, all cheap reads) so the GET answers with a
    // complete plan. `stale_research` therefore never persists as a terminal
    // state — it exists only as the warning explaining the missing findings.
    if (run.status === "researching" && !researchWorker) {
      const recovered = await recoverStaleResearch(companyId);
      if (recovered) return { ok: true, exists: true, run: recovered };
    }
    return { ok: true, exists: true, run };
  });
}
