/** Build Your Organization wire contract — frontend mirror.
 *
 *  CANONICAL SOURCE: packages/wavex-os-server/src/routes/plan-assembly.ts,
 *  routes/adopt-product.ts, routes/approve-organization.ts, and
 *  src/lib/url-prefetch.ts. Kept in sync BY HAND (the house pattern — see
 *  ./contract.ts). If a shape here drifts from the server, the server wins. */

/* ------------------------------------------------------------------ */
/* Plan assembly (Phase 3)                                              */
/* ------------------------------------------------------------------ */

export type AssemblyStepId = "research" | "roadmap" | "kpis" | "departments" | "dependencies";

/** `seq` is a constant of the step's IDENTITY, not its array position — so a
 *  run without research has a HOLE at 0 rather than renumbering. Clients must
 *  order by `seq` and never by index. */
export const STEP_SEQ: Record<AssemblyStepId, number> = {
  research: 0, roadmap: 1, kpis: 2, departments: 3, dependencies: 4,
};

/** `running` is research-only — it is the one step that takes real time.
 *  There is no `pending`: absence means "did not run". */
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
  /** Present when research inserted or re-aimed this row. */
  origin?: "template" | "research";
  researchFindingId?: string;
}

/* ---- research (the execution engine's first phase) ---- */

export interface ResearchFinding {
  id: string;
  /** One line, as the operator would say it. */
  headline: string;
  claim: string;
  rationale: string;
  /** Context keys that justify it — a closed vocabulary, never a URL. */
  signals: string[];
  confidence: "high" | "medium" | "low";
  /** Non-null when this finding changed the build chain. */
  delta:
    | { kind: "mvp_step_insert"; after: string | null; title: string; deliverable: string; assigneeSlot: string }
    | { kind: "mvp_step_refocus"; target: string; deliverable: string }
    | null;
}

export interface ResearchPayload {
  findings: ResearchFinding[];
  /** Finding ids whose delta was applied — the audit trail. */
  applied: string[];
  durationMs: number;
}

export interface RoadmapPayload {
  goal: {
    kpiId: string; current: number; target: number; days: number;
    /** True when the operator stated this goal in Strategy; false when a
     *  stage band stood in for one they never gave. A `false` here must
     *  never render as a plain measurement — the card says it is a guess. */
    stated?: boolean;
  };
  /** THE revisable half of the plan — the goal and KPIs are fixed at approval. */
  checklist: ChecklistItem[];
}

export interface KpisPayload {
  kpis: Array<{
    kpiId: string;                       // canonical long ids, never "mrr"
    label: string;
    direction: "up" | "down";
    ownerRole: string | null;            // owning slot; null = honestly unowned
    bundleId: string | null;
  }>;
}

export interface DepartmentsPayload {
  departments: Array<{
    slot: string;                        // the chief's slot — a wheel segment
    department: string;
    agents: Array<{ slot: string; status: string }>;
  }>;
  counts: { active: number; standby: number; parked: number; disabled: number };
}

export interface DependenciesPayload {
  bundles: Array<{
    bundleId: string;
    owner: string;
    cycleLength: string;
    participatingAgents: string[];
    kpisMoved: string[];
  }>;
  edges: Array<{ from: string; to: string; via: string }>;
}

export interface AssemblyStep {
  id: AssemblyStepId;
  seq: number;                           // STEP_SEQ[id] — constant per id
  status: AssemblyStepStatus;
  /** One honest operator line when `skipped` or `failed`, and the place
   *  research reports why a finding could not be applied. */
  note?: string;
  payload: ResearchPayload | RoadmapPayload | KpisPayload | DepartmentsPayload | DependenciesPayload;
}

export interface AssemblyPatch {
  seq: number;                           // patch-local: 0,1,2… within `patches`
  step: AssemblyStepId;
  source: "t2" | "research";
  kind: "skill_overlay" | "workflow_patch" | "mvp_step_insert" | "mvp_step_refocus";
  slot: string;
  detail: string;
  pillarSignal?: string;
}

/** Where the operator sits on the product spectrum. Read for COPY only — the
 *  structural question ("does Birth start at the MVP stage?") is answered by
 *  the checklist itself, so the plan and Birth cannot disagree. */
export type Placement = "pre_product" | "informal" | "operating";

export interface PlacementResult {
  rung: Placement;
  decidedBy: "product_state" | "has_product";
  /** True when it fell back to `has_product`, which defaults to true — so the
   *  placement is a presumption the operator should be able to see. */
  presumed: boolean;
  note: string;
}

export interface AssemblyRunState {
  v: 1;
  runId: string;
  companyId: string;
  /** `researching` = the first phase is in flight and there is no plan yet.
   *  `stale_refinement` = the server restarted mid-T2-tail; the deterministic
   *  steps stand and `start {resume:true}` re-runs only the tail.
   *  `stale_research` never persists — a stale research run settles itself on
   *  read, and the staleness survives only as a warning. */
  status: "researching" | "refining" | "complete" | "failed" | "stale_research" | "stale_refinement";
  startedAt: string;
  finishedAt: string | null;
  steps: AssemblyStep[];
  patches: AssemblyPatch[];
  warnings: string[];
  placement: PlacementResult;
}

export interface PlanAssemblyStartResponse { ok: boolean; run: AssemblyRunState }
export interface PlanAssemblyGetResponse { ok: boolean; exists: boolean; run: AssemblyRunState | null }

/* ------------------------------------------------------------------ */
/* Adopt an existing product (Path B)                                   */
/* ------------------------------------------------------------------ */

/** The honest fetch vocabulary — parked/thin sites must fall back to
 *  "tell me more", never to a hallucinated company. */
export type FetchStatus = "ok" | "parked" | "thin" | "unreachable" | "unsafe_url" | "timeout";

export interface AdoptProductResult {
  ok: true;
  adopted: boolean;
  fetch: { status: FetchStatus; reason: string | null };
  /** Present when adopted — the enriched pillar-1 fields. */
  fields?: Record<string, unknown>;
  /** Set whenever adopted === false. */
  fallback?: "tell_me_more";
}

/* ------------------------------------------------------------------ */
/* Approve the organization (Phase 4 → 5)                               */
/* ------------------------------------------------------------------ */

export interface ApproveOrganizationBody {
  /** Staleness gate: must match the signed manifest on disk at commit time. */
  manifestSha256: string;
  path: "mvp_build" | "adopted_product";
}
