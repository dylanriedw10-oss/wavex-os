/** The plan feed — Phase 3's (units, revealed) driver.
 *
 *  Phase 3 is TWO acts, and this module is what makes them one sequence:
 *  research findings and plan pieces are units in the SAME array, so the
 *  counter never resets and the reveal never restarts. `stage` is what tells
 *  the renderer which act a unit belongs to.
 *
 *  Transport-agnostic by construction. Research is genuinely async (a real
 *  model call), the deterministic steps are instant, and neither fact reaches
 *  the renderer — it sees units and a revealed count, exactly as before.
 *
 *  Reveal granularity is finer than the run's steps: each FINDING and each
 *  DEPARTMENT is its own unit, so findings land one at a time and the wheel
 *  visibly grows one segment at a time. The ring's growth is the proof the
 *  plan is being built.
 *
 *  Ordering follows `step.seq`, never array position — a step id owns its
 *  number forever, so a run without research has a hole at 0 rather than
 *  renumbering everything after it. */

import type {
  AssemblyRunState, AssemblyStep, DepartmentsPayload, DependenciesPayload,
  KpisPayload, ResearchPayload, RoadmapPayload,
} from "../../canvas/plan-contract";
import type { CellSpec } from "../../canvas/contract";
import type { OrgNode } from "../../canvas/contract";
import { COPY } from "../copy";

/** Which act a unit belongs to. */
export type PlanStage = "research" | "planning";

export interface PlanUnit {
  id: string;
  kind: "finding" | "roadmap" | "kpis" | "department" | "dependencies";
  stage: PlanStage;
  trace: string;
  /** Grid cell for non-department units (departments grow the wheel instead). */
  cell?: CellSpec;
  /** The wheel segment for department units. */
  dept?: { slot: string; department: string; cycle: string | null; department_label: string };
  /** The finding itself, for the research panel's rows. */
  finding?: { headline: string; claim: string; confidence: string; applied: boolean };
}

function fmtMoney(n: number): string {
  return n.toLocaleString();
}

/** Steps in canonical order, skipping anything that has not settled.
 *  Research is the exception: its partial payload IS the point while it runs. */
function orderedSteps(run: AssemblyRunState): AssemblyStep[] {
  return [...run.steps]
    .sort((a, b) => a.seq - b.seq)
    .filter((s) => s.status === "ready" || (s.id === "research" && s.status === "running"));
}

/** The department a cross-team cycle belongs to, if it owns one.
 *
 *  This is what a department DOES, which is the operator-facing fact about it.
 *  The headcount it replaced was an implementation detail of the orchestration
 *  — and a bare number with no decision attached to it. Never invent a cycle:
 *  a department that owns none falls back to its own name. */
function cycleFor(bundles: DependenciesPayload["bundles"], slot: string): string | null {
  const own = bundles.filter((b) => b.owner === slot || b.owner.split(".")[0] === slot);
  if (own.length === 0) return null;
  if (own.length === 1) return `${own[0]!.cycleLength} ${own[0]!.bundleId.replace(/_/g, " ")}`;
  return `${own.length} cycles`;
}

/** Flatten a run into ordered reveal units. Pure. */
export function deriveUnits(run: AssemblyRunState): PlanUnit[] {
  const steps = orderedSteps(run);
  const byId = new Map(steps.map((s) => [s.id, s]));
  const units: PlanUnit[] = [];

  /* ---- act one: research ---- */
  const research = byId.get("research");
  if (research) {
    const payload = research.payload as ResearchPayload;
    const applied = new Set(payload.applied ?? []);
    for (const f of payload.findings ?? []) {
      units.push({
        id: `u-finding-${f.id}`,
        kind: "finding",
        stage: "research",
        trace: COPY.plan.research.opening,
        finding: { headline: f.headline, claim: f.claim, confidence: f.confidence, applied: applied.has(f.id) },
      });
    }
  }

  /* ---- act two: the plan ---- */
  const roadmap = byId.get("roadmap")?.payload as RoadmapPayload | undefined;
  if (roadmap) {
    const mvp = roadmap.checklist.filter((c) => c.kind === "mvp").length;
    const fromResearch = roadmap.checklist.filter((c) => c.origin === "research").length;
    units.push({
      id: "u-roadmap",
      kind: "roadmap",
      stage: "planning",
      trace: COPY.plan.trace.roadmap,
      cell: {
        id: "plan-roadmap", type: "text", thought: "plan", salience: 2, title: "The goal",
        body: [
          `${roadmap.goal.kpiId.replace(/_/g, " ")}: ${fmtMoney(roadmap.goal.current)} → ${fmtMoney(roadmap.goal.target)} in ${roadmap.goal.days}d`,
          ``,
          `${roadmap.checklist.length} checklist items${mvp > 0 ? ` — ${mvp} build the product first` : ""}.`,
          fromResearch > 0 ? `${fromResearch} came from what research found.` : ``,
          // `stated !== true`, not `=== false`: the contract types the flag
          // OPTIONAL, so an absent one must read as "nobody recorded who chose
          // this" rather than as an endorsement.
          //
          // This is the FIRST surface the goal appears on — earlier than the
          // Review card that does carry the marker — and it was printing the
          // hardest claim in the flow ("fixed at approval") over a stage-band
          // guess, breaking the promise COPY.strategy.skipped makes by name:
          // "I'll use a stage band and label it as a guess wherever it shows."
          roadmap.goal.stated !== true ? COPY.plan.goalEstimated : COPY.plan.goalFixed,
        ].filter(Boolean).join("\n"),
      },
    });
  }

  const kpis = byId.get("kpis")?.payload as KpisPayload | undefined;
  if (kpis) {
    units.push({
      id: "u-kpis",
      kind: "kpis",
      stage: "planning",
      trace: COPY.plan.trace.kpis,
      cell: {
        id: "plan-kpis", type: "text", thought: "observation", title: "KPI benchmarks",
        body: kpis.kpis
          .map((k) => `${k.direction === "up" ? "▲" : "▼"} ${k.label}${k.ownerRole ? ` — ${k.ownerRole}` : ""}`)
          .join("\n"),
      },
    });
  }

  const deps = byId.get("dependencies")?.payload as DependenciesPayload | undefined;
  const bundles = deps?.bundles ?? [];

  const departments = byId.get("departments")?.payload as DepartmentsPayload | undefined;
  for (const d of departments?.departments ?? []) {
    units.push({
      id: `u-dept-${d.slot}`,
      kind: "department",
      stage: "planning",
      trace: `${COPY.plan.trace.departments} — ${d.slot}`,
      dept: { slot: d.slot, department: d.department, department_label: d.department, cycle: cycleFor(bundles, d.slot) },
    });
  }

  if (deps) {
    units.push({
      id: "u-deps",
      kind: "dependencies",
      stage: "planning",
      trace: COPY.plan.trace.dependencies,
      cell: {
        id: "plan-deps", type: "text", thought: "relationship", title: "Cross-team workflows",
        body: bundles.length > 0
          ? bundles.map((b) => `${b.bundleId.replace(/_/g, " ")} — every ${b.cycleLength} · moves ${b.kpisMoved.join(", ")}`).join("\n")
          : "No cross-team workflows at this scope — every cycle runs inside one department.",
      },
    });
  }

  return units;
}

export function researchUnits(units: PlanUnit[]): PlanUnit[] {
  return units.filter((u) => u.stage === "research");
}

/** The revealed departments as synthetic OrgNodes for the growing wheel —
 *  cheap because the wheel reads only id/title/snapshot/activity/completeness.
 *
 *  `snapshot` is the department's real cycle, not a headcount. See `cycleFor`. */
export function deptNodes(units: PlanUnit[], revealed: number): OrgNode[] {
  return units.slice(0, revealed)
    .filter((u): u is PlanUnit & { dept: NonNullable<PlanUnit["dept"]> } => u.kind === "department" && !!u.dept)
    .map((u) => ({
      id: `dept:${u.dept.slot}`,
      kind: "department" as const,
      title: u.dept.slot,
      snapshot: u.dept.cycle ?? u.dept.department_label,
      description: null,
      activity: "idle" as const,
      health: null,
      momentum: null,
      completeness: null,
      gravity: null,
      objective: null,
      parentId: "company",
    }));
}

export function totalDepts(units: PlanUnit[]): number {
  return units.filter((u) => u.kind === "department").length;
}

/** THE structural question, answered by the checklist and nothing else.
 *
 *  Birth starts at the MVP stage IF AND ONLY IF the approved plan contains
 *  build work. Both sides now read the same array — `work/seed.ts` filters
 *  `kind === "mvp"` to seed the goal, and this asks the identical question —
 *  so the plan and Birth cannot disagree. The client no longer holds a `path`
 *  fork at all, which is what made them able to. */
export function birthStartFromRun(run: AssemblyRunState | null): "mvp" | "motion" {
  const roadmap = run?.steps.find((s) => s.id === "roadmap")?.payload as RoadmapPayload | undefined;
  return (roadmap?.checklist ?? []).some((c) => c.kind === "mvp") ? "mvp" : "motion";
}

/** The spec's `PlanProgress`, DERIVED rather than stored.
 *
 *  The reducer's own charter forbids mirroring the run into client state — a
 *  copy of the authority is a second source of truth. The shape is still the
 *  right vocabulary for "which pieces exist yet", so it lives here as a pure
 *  function, unit-testable without a DOM. */
export type StepProgress = "pending" | "revealing" | "settled";

export interface PlanProgress {
  research: StepProgress;
  roadmap: StepProgress;
  kpis: StepProgress;
  departments: StepProgress;
  dependencies: StepProgress;
}

export function planProgress(units: PlanUnit[], revealed: number): PlanProgress {
  const of = (kind: PlanUnit["kind"]): StepProgress => {
    const idx = units.map((u, i) => (u.kind === kind ? i : -1)).filter((i) => i >= 0);
    if (idx.length === 0) return "pending";
    const shown = idx.filter((i) => i < revealed).length;
    return shown === 0 ? "pending" : shown < idx.length ? "revealing" : "settled";
  };
  return {
    research: of("finding"),
    roadmap: of("roadmap"),
    kpis: of("kpis"),
    departments: of("department"),
    dependencies: of("dependencies"),
  };
}
