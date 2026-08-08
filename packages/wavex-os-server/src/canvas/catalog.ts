/** The cognitive canvas capability catalog — the composer's entire vocabulary.
 *
 *  CANONICAL SOURCE for the canvas contract. The frontend mirror lives at
 *  packages/onboarding-ui/src/canvas/contract.ts and must be kept in sync by
 *  hand (the house pattern; see onboarding-ui/src/data/slot-to-template.ts).
 *
 *  Design rules this file enforces:
 *  - The model NEVER produces a number a cell displays. A cell carries only a
 *    binding (catalog key + params); the client fetches the data itself.
 *  - A layout referencing anything outside this catalog is not an error the
 *    operator sees — the offending cell is dropped with a warning
 *    (recommend-agent.ts / refinement/parse.ts precedent).
 *  - Mutations happen only through the commit allowlist below, never through
 *    a layout.
 *
 *  CATALOG_VERSION is embedded in every intent signature ("cv1:…") so a
 *  breaking catalog change silently orphans stored layouts instead of
 *  rendering cells whose params no longer validate. */

import { z } from "zod";

export const CATALOG_VERSION = 3;

/** The semantic vocabulary — thoughts, not components. A cell may declare
 *  which cognitive primitive it manifests; the renderer decides visuals.
 *  Waves: 1 ships now (maps onto existing renderers); later waves add
 *  simulation/timeline/investigation renderers without contract change. */
export const THOUGHT_PRIMITIVES = [
  "observation", "comparison", "proposal", "evidence", "timeline",
  "simulation", "prediction", "conversation", "document", "decision",
  "investigation", "risk", "alert", "hypothesis", "memory",
  "relationship", "plan", "progress",
] as const;
export type ThoughtPrimitive = (typeof THOUGHT_PRIMITIVES)[number];

/** The grammar's primary taxonomy (docs/CELL_GRAMMAR.md): primitives are
 *  organized by the kind of thinking the operator needs, not visual form.
 *  Visual type remains the renderer dispatch key; intent is what the
 *  composer selects by. */
export const INTENTS = [
  "inform", "explain", "compare", "predict", "investigate",
  "decide", "coordinate", "remember", "monitor",
] as const;
export type Intent = (typeof INTENTS)[number];

export const PRIMITIVE_INTENT: Record<ThoughtPrimitive, Intent> = {
  observation: "inform", evidence: "inform",
  hypothesis: "explain",
  comparison: "compare",
  prediction: "predict", simulation: "predict",
  investigation: "investigate",
  decision: "decide", proposal: "decide",
  relationship: "coordinate",
  memory: "remember", timeline: "remember", conversation: "remember", document: "remember",
  risk: "monitor", alert: "monitor", progress: "monitor", plan: "monitor",
};

/** Adjective vocabulary: per-type variants (docs/CELL_GRAMMAR.md). An
 *  unknown variant STRIPS to the type's default with a warning — the cell
 *  survives. Never drop a cell over an adjective. */
export const VARIANTS: Partial<Record<CellType, readonly string[]>> = {
  metric: ["hero", "gauge", "delta", "goal", "live", "split"],
  table: ["rows", "breakdown", "checklist"],
  trend: ["line", "cadence"],
  timeline: ["instance", "activity"],
  attention: ["queue", "approvals"],
};

/* ------------------------------------------------------------------ */
/* Cell vocabulary                                                     */
/* ------------------------------------------------------------------ */

export const CELL_TYPES = [
  "text",         // assistant prose (plain text only — no markdown renderer exists, keep zero-XSS posture)
  "metric",       // one headline number + label (+ optional cap/target for a gauge)
  "table",        // rows from a list-shaped binding
  "trend",        // sparkline; v1 series source is token-usage recent_calls only
  "comparison",   // current vs target (manifest goal)
  "proposal",     // a pending mutation awaiting confirm — the ONLY mutating cell
  "attention",    // the ≤3-item needs-you queue (client-aggregated)
  "agent-roster", // resolved swarm topology from /redundancy
  "simulation",   // Monte Carlo strategies from mc-report.json, winner highlighted
  "timeline",     // decisions + calls + ignition steps interleaved (client-aggregated)
] as const;
export type CellType = (typeof CELL_TYPES)[number];

/** Read bindings a cell may declare. `emptyStatuses` lists HTTP statuses that
 *  mean "no data yet" for a fresh company — a first-class empty state, NOT an
 *  error (token-usage 404s until the first T2 call; manifest/kpis/redundancy
 *  404 until finalize; observability 503s on empty tables). */
export const READ_BINDINGS = {
  "token-usage":         { path: "/api/instance/:companyId/token-usage",            emptyStatuses: [404], cells: ["metric", "table", "trend"] },
  "token-budget":        { path: "/api/instance/:companyId/token-budget",           emptyStatuses: [],    cells: ["metric"] },
  "obs-mission-control": { path: "/api/observability/:companyId/mission-control",   emptyStatuses: [503], cells: ["metric", "table"] },
  "obs-budget":          { path: "/api/observability/:companyId/budget",            emptyStatuses: [503], cells: ["metric"] },
  "obs-bottlenecks":     { path: "/api/observability/:companyId/bottlenecks",       emptyStatuses: [503], cells: ["table"] },
  "kpis":                { path: "/api/instance/:companyId/kpis",                   emptyStatuses: [404], cells: ["metric", "table"] },
  "manifest":            { path: "/api/instance/:companyId/manifest",               emptyStatuses: [404], cells: ["metric", "comparison"] },
  "redundancy":          { path: "/api/instance/:companyId/redundancy",             emptyStatuses: [404], cells: ["table", "agent-roster"] },
  "ignition":            { path: "/api/instance/:companyId/ignition",               emptyStatuses: [],    cells: ["attention", "metric", "timeline", "table"] },
  "mc-report":           { path: "/api/instance/:companyId/mc-report",              emptyStatuses: [404], cells: ["simulation", "table"] },
  /* Part-2 reads via the runtime adapter (routes/paperclip-read.ts). 503 =
   * fleet never mirrored — the normal pre-handoff empty state. These give
   * the timeline/investigation/decision primitives their REAL backing. */
  "runtime-dashboard":   { path: "/api/instance/:companyId/runtime/dashboard",      emptyStatuses: [503], cells: ["metric", "table", "trend", "attention"] },
  "runtime-activity":    { path: "/api/instance/:companyId/runtime/activity",       emptyStatuses: [503], cells: ["timeline", "table"] },
  "runtime-approvals":   { path: "/api/instance/:companyId/runtime/approvals",      emptyStatuses: [503], cells: ["attention", "table"] },
  "runtime-live-runs":   { path: "/api/instance/:companyId/runtime/live-runs",      emptyStatuses: [503], cells: ["table", "metric"] },
} as const;
export type CatalogKey = keyof typeof READ_BINDINGS;
export const CATALOG_KEYS = Object.keys(READ_BINDINGS) as CatalogKey[];

/** The commit allowlist — the ONLY endpoints a proposal may target. Checked
 *  at commit time, not just propose time. Body re-validated per endpoint.
 *  Deliberate exclusions (refuse, with copy): DELETE add-agent, reset. */
export const COMMIT_ALLOWLIST = {
  "set-token-budget": {
    method: "POST" as const,
    path: "/api/instance/:companyId/token-budget",
    body: z.object({ cap_tokens: z.number().int().positive().nullable() }),
  },
  "ignite-fleet": {
    method: "POST" as const,
    path: "/api/instance/:companyId/ignite",
    body: z.object({}).strict(),
  },
  /* Build Your Organization's ONE Confirm: activate + native seed + plan
   * lock, as a single gated transaction. The sha is the staleness gate —
   * the operator must approve the organization that is actually on disk. */
  "approve-organization": {
    method: "POST" as const,
    path: "/api/instance/:companyId/approve-organization",
    body: z.object({
      manifestSha256: z.string().regex(/^sha256:[0-9a-f]{64}$/),
      path: z.enum(["mvp_build", "adopted_product"]),
    }).strict(),
  },
  /* Path B's confirm gate: an operator-pasted URL means an outbound fetch
   * plus a T2 spend — exactly what proposal → confirm exists for. */
  "adopt-product": {
    method: "POST" as const,
    path: "/api/instance/:companyId/adopt-product",
    body: z.object({ url: z.string().min(4).max(2048), orgName: z.string().min(1).max(120).optional() }).strict(),
  },
  "add-agent": {
    method: "POST" as const,
    path: "/api/instance/:companyId/add-agent",
    body: z.object({
      parent_slot: z.string().min(1),
      template_id: z.string().min(1).max(80),
      slot_suffix: z.string().min(1).max(60).regex(/^[a-z0-9-]+$/i).optional(),
    }),
  },
  "swap-template": {
    method: "POST" as const,
    path: "/api/instance/:companyId/swap-template",
    body: z.object({ slot: z.string().min(1), templateId: z.string().min(1).nullable() }),
  },
  "mute-slot": {
    method: "POST" as const,
    path: "/api/instance/:companyId/mute-slot",
    body: z.object({ slot: z.string().min(1) }),
  },
  "unmute-slot": {
    method: "DELETE" as const,
    path: "/api/instance/:companyId/mute-slot",
    body: z.object({ slot: z.string().min(1) }),
  },
  // The native runtime (spec Rev 6): the promotion ladder's object rung.
  // Commit executes these via inject, so the work routes' own constitution
  // check fires as well — double-gated, never silently.
  "create-goal": {
    method: "POST" as const,
    path: "/api/instance/:companyId/work/goals",
    body: z.object({ title: z.string().min(1).max(200), description: z.string().max(2000).optional() }),
  },
  "create-task": {
    method: "POST" as const,
    path: "/api/instance/:companyId/work/tasks",
    body: z.object({
      goalId: z.string().min(1).max(60),
      title: z.string().min(1).max(200),
      brief: z.string().min(1).max(8000),
      assigneeSlot: z.string().min(1).max(80),
      dependsOn: z.array(z.string().max(60)).max(20).optional(),
      maxAttempts: z.number().int().min(1).max(10).optional(),
    }),
  },
  "run-cycle": {
    method: "POST" as const,
    path: "/api/instance/:companyId/work/run-cycle",
    body: z.object({ maxTasks: z.number().int().min(1).max(10).optional() }),
  },
} as const;
export type CommitAction = keyof typeof COMMIT_ALLOWLIST;
export const COMMIT_ACTIONS = Object.keys(COMMIT_ALLOWLIST) as CommitAction[];

/* ------------------------------------------------------------------ */
/* Layout schema                                                       */
/* ------------------------------------------------------------------ */

const cellBase = {
  id: z.string().min(1).max(40),
  /** Which cognitive primitive this cell manifests (semantic, optional). */
  thought: z.enum(THOUGHT_PRIMITIVES).optional(),
  /** 0 = ambient, 1 = normal, 2 = the point of the workspace. */
  salience: z.union([z.literal(0), z.literal(1), z.literal(2)]).optional(),
  /** Adjectives (docs/CELL_GRAMMAR.md). variant = expression of the type
   *  (validated against VARIANTS post-parse; unknown strips to default).
   *  density = L1 headline … L4 full context; composer-chosen, operator-
   *  overridable. group = fusion key: same group renders as one object. */
  variant: z.string().min(1).max(24).optional(),
  density: z.union([z.literal(1), z.literal(2), z.literal(3), z.literal(4)]).optional(),
  group: z.string().min(1).max(24).optional(),
  title: z.string().max(80).optional(),
  span: z.union([z.literal(1), z.literal(2)]).optional(),
  /** Drill actions ARE conversation: the client sends `prompt` as the
   *  operator's next message. The composer should phrase prompts so common
   *  drills hit the deterministic stub path (no LLM latency per click).
   *  mode "unfold" (G4) mutates the cell in place instead of recomposing
   *  the workspace — the transcript still records the exchange. */
  drill: z.array(z.object({
    label: z.string().min(1).max(32),
    prompt: z.string().min(1).max(200),
    mode: z.enum(["conversation", "unfold"]).optional(),
  })).max(3).optional(),
};

const boundCell = (types: [CellType, ...CellType[]]) =>
  z.object({
    ...cellBase,
    type: z.enum(types),
    source: z.object({
      api: z.enum(CATALOG_KEYS as [CatalogKey, ...CatalogKey[]]),
      params: z.record(z.union([z.string().max(80), z.number()])).default({}),
    }),
  });

export const cellSchema = z.discriminatedUnion("type", [
  z.object({ ...cellBase, type: z.literal("text"), body: z.string().min(1).max(1600) }),
  boundCell(["metric"]),
  boundCell(["table"]),
  boundCell(["trend"]),
  boundCell(["comparison"]),
  boundCell(["attention"]),
  boundCell(["agent-roster"]),
  boundCell(["simulation"]),
  boundCell(["timeline"]),
  z.object({
    ...cellBase,
    type: z.literal("proposal"),
    proposalId: z.string().min(1).max(60),
  }),
]);
export type CellSpec = z.infer<typeof cellSchema>;

export const layoutSchema = z.object({
  title: z.string().min(1).max(80),
  cells: z.array(cellSchema).min(1).max(8), // cap per refinement/parse.ts precedent
});
export type LayoutSpec = z.infer<typeof layoutSchema>;

/* ------------------------------------------------------------------ */
/* Validation: drop invalid cells, never fail the layout               */
/* ------------------------------------------------------------------ */

export interface ValidatedLayout {
  layout: LayoutSpec | null;
  warnings: string[];
}

/** Validate a raw (model-emitted or stored) layout. Invalid cells are
 *  dropped with a warning; a cell whose binding disallows its type is
 *  dropped; an empty survivor set nulls the layout. */
export function validateLayout(raw: unknown): ValidatedLayout {
  const warnings: string[] = [];
  if (typeof raw !== "object" || raw === null) return { layout: null, warnings: ["layout is not an object"] };
  const obj = raw as Record<string, unknown>;
  const title = typeof obj.title === "string" && obj.title.trim() ? obj.title.slice(0, 80) : "Workspace";
  const rawCells = Array.isArray(obj.cells) ? obj.cells : [];
  const cells: CellSpec[] = [];
  for (const rc of rawCells.slice(0, 8)) {
    const parsed = cellSchema.safeParse(rc);
    if (!parsed.success) {
      warnings.push(`dropped cell: ${parsed.error.issues[0]?.message ?? "invalid"}`);
      continue;
    }
    const cell = parsed.data;
    if ("source" in cell) {
      const binding = READ_BINDINGS[cell.source.api];
      if (!(binding.cells as readonly string[]).includes(cell.type)) {
        warnings.push(`dropped ${cell.type} cell: binding "${cell.source.api}" does not support it`);
        continue;
      }
    }
    // Degrade ladder: an unknown ADJECTIVE never costs a cell. Strip the
    // variant to the type's default and keep rendering.
    if (cell.variant !== undefined) {
      const allowed = VARIANTS[cell.type];
      if (!allowed || !allowed.includes(cell.variant)) {
        warnings.push(`stripped unknown variant "${cell.variant}" on ${cell.type} cell "${cell.id}"`);
        delete cell.variant;
      }
    }
    cells.push(cell);
  }
  if (rawCells.length > 8) warnings.push(`trimmed ${rawCells.length - 8} cells (cap is 8)`);
  if (cells.length === 0) return { layout: null, warnings };
  return { layout: { title, cells }, warnings };
}
