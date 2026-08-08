/** Canvas wire contract — frontend mirror.
 *
 *  CANONICAL SOURCE: packages/wavex-os-server/src/canvas/catalog.ts and
 *  routes/canvas.ts. Kept in sync BY HAND (the house pattern — see
 *  src/data/slot-to-template.ts). If a shape here drifts from the server,
 *  the server wins. */

/** The semantic vocabulary — thoughts, not components (catalog v2). */
export type ThoughtPrimitive =
  | "observation" | "comparison" | "proposal" | "evidence" | "timeline"
  | "simulation" | "prediction" | "conversation" | "document" | "decision"
  | "investigation" | "risk" | "alert" | "hypothesis" | "memory"
  | "relationship" | "plan" | "progress";

/** Which renderer manifests each primitive today (wave 1). Later waves swap
 *  targets here without touching the wire contract. */
export const PRIMITIVE_RENDERER: Record<ThoughtPrimitive, CellType> = {
  observation: "metric", comparison: "comparison", proposal: "proposal",
  evidence: "table", timeline: "timeline", simulation: "simulation",
  prediction: "simulation", conversation: "text", document: "text",
  decision: "proposal", investigation: "table", risk: "attention",
  alert: "attention", hypothesis: "text", memory: "text",
  relationship: "agent-roster", plan: "table", progress: "comparison",
};

export type CellType =
  | "text" | "metric" | "table" | "trend"
  | "comparison" | "proposal" | "attention" | "agent-roster"
  | "simulation" | "timeline";

export type CatalogKey =
  | "token-usage" | "token-budget" | "obs-mission-control" | "obs-budget"
  | "obs-bottlenecks" | "kpis" | "manifest" | "redundancy" | "ignition" | "mc-report"
  | "runtime-dashboard" | "runtime-activity" | "runtime-approvals" | "runtime-live-runs";

export interface DrillAction { label: string; prompt: string; mode?: "conversation" | "unfold" }

export interface CellSpec {
  id: string;
  type: CellType;
  thought?: ThoughtPrimitive;
  salience?: 0 | 1 | 2;
  /** Adjectives (docs/CELL_GRAMMAR.md): expression of the type, validated
   *  server-side (unknown variants are stripped there — trust the field). */
  variant?: string;
  /** L1 headline … L4 full context; composer-chosen, operator-overridable. */
  density?: 1 | 2 | 3 | 4;
  /** Fusion key — same group renders as one object (G4). */
  group?: string;
  title?: string;
  span?: 1 | 2;
  drill?: DrillAction[];
  /** bound cells */
  source?: { api: CatalogKey; params: Record<string, string | number> };
  /** text cells */
  body?: string;
  /** proposal cells */
  proposalId?: string;
}

export interface LayoutSpec { title: string; cells: CellSpec[] }

export interface CanvasProposal {
  id: string;
  action: string;
  body: Record<string, unknown>;
  summary: string;
  created_at: string;
  status: "pending" | "committed" | "failed" | "expired";
  outcome?: { at: string; detail: string };
}

export interface SinceSnapshot {
  taken_at: string;
  /** cellId → headline value when the operator last looked */
  values: Record<string, number>;
}

export interface CanvasTurn {
  role: "user" | "assistant";
  ts_iso: string;
  text: string;
  intent?: string;
  layout?: LayoutSpec;
  signature?: string;
  since?: SinceSnapshot;
  composedBy?: "memory" | "stub" | "t2";
  /** Groups turns by question, not time — the signature of the intent that
   *  opened this line of thought. */
  threadId?: string;
  proposalId?: string;
  warnings?: string[];
}

export interface LedgerEntry {
  ts_iso: string;
  proposalId: string;
  summary: string;
  action: string;
  status: "committed" | "failed";
  detail?: string;
}

export interface DeskState {
  pinned: Array<{ signature: string; title: string; pinned_at: string }>;
}

export interface CanvasStateResponse {
  ok: boolean;
  transcript: CanvasTurn[];
  proposals: CanvasProposal[];
  ledger: LedgerEntry[];
  desk: DeskState;
}

export interface CanvasPostResponse {
  ok: boolean;
  turn: CanvasTurn;
  proposal?: CanvasProposal;
}

export interface IgnitionStatusResponse {
  ok: boolean;
  status: "not_activated" | "deferred" | "partial" | "ignited";
  agentsWorking: number;
  workflowsQueued: number;
  goalId: string | null;
  paperclipUrl: string | null;
  paperclipCompanyId: string | null;
  steps: Record<string, { status: string; note?: string; created?: string[]; gaps?: string[] }> | null;
  errors: Array<{ step: string; message: string; ts: string }>;
  warnings: string[];
  startedAt: string | null;
  completedAt: string | null;
}

/* ------------------------------------------------------------------ */
/* The recursive org (docs/RECURSIVE_ORG_SPEC.md, R1) — server mirrors  */
/* of packages/wavex-os-server/src/org/{store,nodes}.ts.                */
/* ------------------------------------------------------------------ */

export interface OrgNode {
  id: string;
  kind: "company" | "department" | "agent" | "metric" | "constitution";
  title: string;
  snapshot: string;
  /** Role copy (interface text keyed by template division) — null hides the line. */
  description: string | null;
  activity: "active" | "idle";
  health: "ok" | "at_risk" | "critical" | null;
  momentum: null;                       // R1: honest cold start
  completeness: number | null;
  gravity: number | null;
  objective: { title: string; status: "on_track" | "blocked" | "achieved" | "unknown"; blockedBy: string[] } | null;
  parentId: string | null;
}

export interface OrgChildRef { id: string; kind: OrgNode["kind"]; title: string }

export interface OrgCapability {
  id: string;
  label: string;
  kind: "explain" | "compare" | "show_children" | "custom";
  source: "rule";
  prompt: string;
}

export interface OrgMemoryEntry {
  id: string;
  nodeId: string;
  question: string;
  claim: string;
  /** "canvas" = promoted from an ephemeral workspace (id = its signature). */
  citations: Array<{ kind: "walk" | "ledger" | "activity" | "issue" | "canvas"; id: string }>;
  derivedAt: string;
  supersededBy: string | null;
}

export interface OrgInfluenceEdge {
  from: string;
  to: string;
  kind: "asks";
  weight: number;
  lastObservedAt: string;
  evidence: { source: "walk_history"; count: number };
}

export interface OrgWalkStep {
  id: string;
  walkId: string;
  sessionId: string | null;
  nodeId: string;
  nodeTitle: string;
  question: string;
  decision: "answered" | "delegated" | "referred" | "precedent";
  delegatedToNodeId: string | null;
  answer: string | null;
  ts: string;
}

export interface OrgFlywheelResponse {
  ok: boolean;
  company: OrgNode;
  departments: OrgNode[];
  constitution: OrgNode | null;
  influence: OrgInfluenceEdge[];
}

export interface OrgNodeResponse {
  ok: boolean;
  node: OrgNode;
  children: OrgChildRef[];
  capabilities: OrgCapability[];
  memory: OrgMemoryEntry[];
  /** Influence edges touching this node — observed walk history only. */
  edges: OrgInfluenceEdge[];
}

export interface OrgInvestigationsResponse { ok: boolean; steps: OrgWalkStep[] }
export interface OrgMemoryListResponse { ok: boolean; entries: OrgMemoryEntry[] }
export interface OrgKeepResponse { ok: boolean; entry: OrgMemoryEntry; deduped?: boolean }

export interface OrgWalkResponse {
  ok: boolean;
  walkId: string;
  steps: OrgWalkStep[];
  done: boolean;
  landedNodeId: string | null;
  answer: string | null;
}

export interface OrgConstitutionResponse {
  ok: boolean;
  categories: Array<{ id: string; label: string; content: string; updatedAt: string; updatedByWalkId: string | null }>;
}

export interface OrgGravityRow {
  nodeId: string;
  title: string;
  gravity: number;              // 0–100, normalized from observed walks
  evidence: { inboundAsks: number; landings: number };
}

export interface OrgGravityResponse {
  ok: boolean;
  /** false = not enough observed hops yet — gravity is measured, never invented */
  threshold: boolean;
  rows: OrgGravityRow[];
  observedSteps: number;
}

/* ------------------------------------------------------------------ */
/* The native work runtime (spec Rev 6) — server mirrors of             */
/* packages/wavex-os-server/src/work/store.ts + routes/work.ts.         */
/* ------------------------------------------------------------------ */

export type WorkTaskStatus = "todo" | "in_progress" | "in_review" | "done" | "blocked" | "failed";
export type WorkReviewState = "pending_review" | "approved" | "changes_requested";

export interface WorkGoal {
  id: string;
  title: string;
  description: string;
  status: "active" | "achieved" | "cancelled";
  source: "manifest" | "operator" | "plan";
  createdAt: string;
}

export interface WorkTask {
  id: string;
  goalId: string;
  title: string;
  brief: string;
  /** THE ARTIFACT this task produces — deliverables are the UI. Optional so
   *  work stores written before this existed still parse. */
  deliverable?: string;
  /** Present-continuous, shown ONLY while running. `title` is shown pending
   *  and settled. (The content/activeForm pair.) */
  activeForm?: string;
  assigneeSlot: string;
  status: WorkTaskStatus;
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

export interface WorkStructuralChecks {
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
  /** The engine's text, verbatim (capped server-side) — never edited. */
  output: string;
  structural: WorkStructuralChecks;
  review: WorkReviewState;
  reviewNote: string | null;
  createdAt: string;
  reviewedAt: string | null;
}

export interface WorkRunEvent {
  id: string;
  ts: string;
  kind: string;
  taskId: string | null;
  agentSlot: string | null;
  detail: string;
}

/** GET /work — deliverables are the last 20 newest-first; runLog the last 40. */
export interface WorkStateResponse {
  ok: boolean;
  goals: WorkGoal[];
  tasks: WorkTask[];
  deliverables: WorkDeliverable[];
  runLog: WorkRunEvent[];
}

export interface WorkSeedResponse { ok: boolean; already: boolean; goalId: string; taskIds: string[] }

export interface WorkCycleOutcome {
  taskId: string;
  title: string;
  outcome: "in_review" | "requeued" | "failed" | "budget_stopped";
  detail: string;
}

export interface WorkCycleSummary { ok: boolean; ran: WorkCycleOutcome[]; ready: number; stoppedEarly: string | null }

export interface WorkReviewResponse { ok: boolean; deliverable: WorkDeliverable; task?: WorkTask; replayed?: boolean }

/** Which ApiError statuses mean "no data yet" (a first-class empty state,
 *  never an error) — mirrors READ_BINDINGS.emptyStatuses on the server. */
export const EMPTY_STATUSES: Record<CatalogKey, number[]> = {
  "token-usage": [404],
  "token-budget": [],
  "obs-mission-control": [503],
  "obs-budget": [503],
  "obs-bottlenecks": [503],
  "kpis": [404],
  "manifest": [404],
  "redundancy": [404],
  "ignition": [],
  "mc-report": [404],
  /* 503 = fleet never mirrored (normal pre-handoff); 502 = unreachable (a
   * real error — renders the retry state, not the quiet empty). */
  "runtime-dashboard": [503],
  "runtime-activity": [503],
  "runtime-approvals": [503],
  "runtime-live-runs": [503],
};
