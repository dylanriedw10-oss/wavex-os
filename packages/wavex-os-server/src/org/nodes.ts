/** The node service — every object is the same kind of thing.
 *
 *  Adapts EXISTING stores into the OrgNode shape (docs/RECURSIVE_ORG_SPEC.md
 *  §0, §3) — no parallel org tables. Tree in R1:
 *
 *    company
 *    ├── constitution                        (fixed, singular, walks like anything)
 *    ├── dept:<slot>  (children of the root slot in the swarm tree)
 *    │   └── agent:<slot> …recursively
 *    ├── agent:<root> (the CEO reports to the company itself)
 *    └── metric:spend | metric:budget | metric:goal   (bound to catalog reads)
 *
 *  Honesty floors: department completeness is null (no per-department
 *  blueprint exists); momentum is null in R1 (cold start); activity is read
 *  LIVE through the runtime adapter and degrades to idle when the fleet is
 *  unreachable; company health derives from real budget pressure only. */

import { readFile } from "node:fs/promises";
import { join } from "node:path";
import type { FastifyInstance } from "fastify";
import { getOnboardingDir } from "../state-bridge.js";
import { resolveAllSlots } from "../lib/redundancy.js";
import { readGoal, isStated, goalProvenance, goalTitle, UNSTATED, type ManifestGoal } from "../lib/goal-line.js";

/** The provenance suffix for a goal shown on a display surface, or "" when
 *  the operator actually chose it.
 *
 *  One helper because the goal renders on this file TWICE — the company
 *  node's objective and the `metric:goal` node's snapshot — and only the
 *  first carried a marker. The second is the one titled "the compass · the
 *  one number the organization is steering toward", which is the worse place
 *  to print a stage-band constant as if it were a measurement. */
function goalSuffix(goal: ManifestGoal | null): string {
  if (!goal) return "";
  const p = goalProvenance(goal);
  return p === "stated" ? "" : ` · ${p === "fallback" ? UNSTATED.short : UNSTATED.unrecorded}`;
}
import type { OrgFile } from "./store.js";
import { computeGravity } from "./store.js";

export interface OrgNodeDto {
  id: string;
  kind: "company" | "department" | "agent" | "metric" | "constitution";
  title: string;
  snapshot: string;
  /** Role copy for the desk masthead — INTERFACE TEXT keyed by the slot's
   *  template division (product copy, deterministic), never authored per
   *  company and never model-generated. Null when no copy exists. */
  description: string | null;
  activity: "active" | "idle";
  health: "ok" | "at_risk" | "critical" | null;
  momentum: null;                       // R1: honest cold start
  completeness: number | null;
  gravity: number | null;
  objective: { title: string; status: "on_track" | "blocked" | "achieved" | "unknown"; blockedBy: string[] } | null;
  parentId: string | null;
}

export interface NodeChildRef { id: string; kind: OrgNodeDto["kind"]; title: string }

export interface NodeCapability {
  id: string;
  label: string;
  kind: "explain" | "compare" | "show_children" | "custom";
  source: "rule";
  /** R1 capabilities are all reads — they resolve to a scoped prompt (the
   *  drill idiom). Side-effecting capabilities arrive with proposal wiring
   *  in R2; none are minted here. */
  prompt: string;
}

interface SlotRow { slot: string; parent_slot: string; template_id: string; muted: boolean }

interface TreeCtx {
  slots: SlotRow[];
  rootSlot: string | null;
  byParent: Map<string, SlotRow[]>;
  /** The manifest goal verbatim. It is `kpiId`, NOT `metric` — this type
   *  said `metric` and both consumers read it, so the KPI name was silently
   *  swallowed everywhere the company's objective rendered. */
  goal: ManifestGoal | null;
  pillarsAnswered: number;              // 0..5
  budget: { cap: number | null; used: number } | null;
  liveAgents: Set<string>;              // agentName values from live runs (lowercase)
  liveReachable: boolean;
  /** templateId → division, from the 165-template registry (cached). */
  divisionByTemplate: Map<string, string>;
}

/* ------------------------------------------------------------------ */
/* Role copy — interface text, keyed by template division. This is     */
/* PRODUCT COPY like a button label: deterministic, curated once,      */
/* never authored per company, never model-generated. A division with  */
/* no line renders no line (the UI hides the row).                     */
/* ------------------------------------------------------------------ */

const ROLE_COPY: Record<string, string> = {
  ceo: "Leads the organization — sets direction, allocates resources, and holds the goal.",
};

const DIVISION_COPY: Record<string, string> = {
  "c-suite": "Executive ownership — direction, allocation, and accountability for outcomes.",
  marketing: "Demand and narrative — campaigns, channels, and the pipeline they feed.",
  engineering: "Builds and maintains the product — implementation, quality, and delivery.",
  sales: "Revenue conversations — qualifying, advancing, and closing pipeline.",
  product: "Decides what gets built — priorities, specs, and tradeoffs.",
  design: "Shape and clarity — interfaces, assets, and the experience of the product.",
  support: "Keeps customers unblocked — triage, answers, and escalations.",
  finance: "The numbers — budgets, forecasts, and spend discipline.",
  testing: "Verification — coverage, regressions, and release confidence.",
  "project-management": "Coordination — sequencing, dependencies, and follow-through.",
  "paid-media": "Paid acquisition — spend efficiency and channel performance.",
  strategy: "Direction under uncertainty — positioning, bets, and focus.",
};

let registryCache: Map<string, string> | null = null;
async function loadDivisionMap(): Promise<Map<string, string>> {
  if (registryCache) return registryCache;
  const { fileURLToPath } = await import("node:url");
  const { dirname, resolve } = await import("node:path");
  let dir = dirname(fileURLToPath(import.meta.url));
  for (let i = 0; i < 10; i++) {
    try {
      const raw = await readFile(resolve(dir, "packages", "agent-templates", "_registry.json"), "utf8");
      const parsed = JSON.parse(raw) as { templates: Array<{ templateId: string; division: string }> };
      registryCache = new Map(parsed.templates.map((t) => [t.templateId, t.division]));
      return registryCache;
    } catch { /* keep walking */ }
    const parent = resolve(dir, "..");
    if (parent === dir) break;
    dir = parent;
  }
  registryCache = new Map();
  return registryCache;
}

function roleCopyFor(ctx: TreeCtx, slot: string, templateId: string): string | null {
  const leaf = slot.split(".").pop()!.toLowerCase();
  if (ROLE_COPY[leaf]) return ROLE_COPY[leaf];
  if (ROLE_COPY[templateId]) return ROLE_COPY[templateId];
  const division = ctx.divisionByTemplate.get(templateId);
  return (division && DIVISION_COPY[division]) || null;
}

async function readJson<T>(path: string): Promise<T | null> {
  try { return JSON.parse(await readFile(path, "utf8")) as T; } catch { return null; }
}

/** One context load per request — every node derives from it. Live state
 *  goes through the app's own HTTP surface (the runtime adapter), exactly
 *  like canvas snapshots do, so auth stays identical. */
export async function loadTreeCtx(app: FastifyInstance, req: any, companyId: string): Promise<TreeCtx> {
  const dir = getOnboardingDir(companyId);
  const manifest = await readJson<any>(join(dir, "company.manifest.json"));
  const pillars = await readJson<Record<string, unknown>>(join(dir, "pillar_responses.json"));

  let slots: SlotRow[] = [];
  if (manifest?.swarm_manifest?.agents) {
    try { slots = resolveAllSlots(manifest) as SlotRow[]; } catch { slots = []; }
  }
  const byParent = new Map<string, SlotRow[]>();
  for (const s of slots) {
    const arr = byParent.get(s.parent_slot) ?? [];
    arr.push(s);
    byParent.set(s.parent_slot, arr);
  }
  const rootSlot = slots.find((s) => !s.parent_slot)?.slot ?? null;

  const pillarsAnswered = pillars
    ? ["pillar_1", "pillar_2", "pillar_3", "pillar_4", "pillar_5"]
        .filter((k) => pillars[k] && typeof pillars[k] === "object" && Object.keys(pillars[k] as object).length > 0).length
    : 0;

  const fwd: Record<string, any> = { ...req.headers };
  delete fwd["content-length"];
  delete fwd["transfer-encoding"];
  const inject = async (url: string) => {
    try {
      const r = await app.inject({ method: "GET", url, headers: fwd });
      return r.statusCode === 200 ? r.json() : null;
    } catch { return null; }
  };

  const budgetJson = await inject(`/api/instance/${companyId}/token-budget`);
  const budget = budgetJson
    ? { cap: (budgetJson.budget?.cap_tokens as number | null) ?? null, used: (budgetJson.used as number) ?? 0 }
    : null;

  const runsJson = await inject(`/api/instance/${companyId}/runtime/live-runs`);
  const liveAgents = new Set<string>(
    ((runsJson?.runs as any[]) ?? [])
      .map((r) => String(r.agentName ?? r.agent_name_key ?? "").toLowerCase())
      .filter(Boolean),
  );

  return {
    slots, rootSlot, byParent,
    goal: readGoal(manifest),
    pillarsAnswered,
    budget,
    liveAgents,
    liveReachable: runsJson !== null,
    divisionByTemplate: await loadDivisionMap(),
  };
}

function slotActive(ctx: TreeCtx, slot: string): boolean {
  if (!ctx.liveReachable) return false;
  const leaf = slot.split(".").pop()!.toLowerCase();
  if (ctx.liveAgents.has(slot.toLowerCase()) || ctx.liveAgents.has(leaf)) return true;
  // a parent is active if any descendant is
  for (const child of ctx.byParent.get(slot) ?? []) if (slotActive(ctx, child.slot)) return true;
  return false;
}

function companyHealth(ctx: TreeCtx): OrgNodeDto["health"] {
  if (!ctx.budget || ctx.budget.cap == null) return null; // no basis to judge
  const pct = ctx.budget.used / ctx.budget.cap;
  return pct >= 1 ? "critical" : pct >= 0.9 ? "at_risk" : "ok";
}

const METRICS: Array<{ id: string; title: string; description: string; snapshot: (ctx: TreeCtx) => string; prompt: string }> = [
  { id: "metric:spend", title: "Token spend", prompt: "why did spend spike",
    description: "Every token the organization has spent — total, per phase, over time. Straight from the usage ledger.",
    snapshot: (ctx) => ctx.budget ? `${fmtTokens(ctx.budget.used)} spent${ctx.budget.cap ? ` of ${fmtTokens(ctx.budget.cap)} cap` : ""}` : "no spend recorded yet" },
  { id: "metric:budget", title: "Token budget", prompt: "show the budget",
    description: "The spending ceiling and how much of it is used — the gate checks it before every run.",
    snapshot: (ctx) => ctx.budget?.cap ? `cap ${fmtTokens(ctx.budget.cap)} · ${Math.round((ctx.budget.used / ctx.budget.cap) * 100)}% used` : "no cap set" },
  { id: "metric:goal", title: "Headline goal", prompt: "show goals",
    description: "The compass — the one number the organization is steering toward.",
    snapshot: (ctx) => ctx.goal?.target != null
      ? `${ctx.goal.current?.toLocaleString() ?? "—"} of ${ctx.goal.target.toLocaleString()}${ctx.goal.days ? ` in ${ctx.goal.days}d` : ""}${goalSuffix(ctx.goal)}`
      : "no goal captured" },
];

function fmtTokens(n: number): string {
  return n >= 1_000_000 ? `${(n / 1_000_000).toFixed(1)}M` : n >= 1_000 ? `${(n / 1_000).toFixed(1)}k` : String(n);
}

function gravityFor(org: OrgFile, nodeId: string): number | null {
  const rows = computeGravity(org);
  return rows?.find((r) => r.nodeId === nodeId)?.gravity ?? (rows ? 0 : null);
}

export function buildNode(ctx: TreeCtx, org: OrgFile, companyId: string, id: string): OrgNodeDto | null {
  const grav = (nid: string) => gravityFor(org, nid);

  if (id === "company") {
    const deptCount = ctx.rootSlot ? (ctx.byParent.get(ctx.rootSlot) ?? []).length : 0;
    return {
      id, kind: "company", title: companyId, parentId: null,
      description: null,
      snapshot: `${deptCount} department${deptCount === 1 ? "" : "s"} · ${ctx.slots.filter((s) => !s.muted).length} agents${ctx.budget ? ` · ${fmtTokens(ctx.budget.used)} spent` : ""}`,
      activity: ctx.rootSlot && slotActive(ctx, ctx.rootSlot) ? "active" : "idle",
      health: companyHealth(ctx),
      momentum: null,
      completeness: Math.round((ctx.pillarsAnswered / 5) * 100),
      gravity: grav(id),
      // The objective renders where a measurement belongs, so an estimated
      // target has to say so — same rule the Review card follows.
      objective: ctx.goal
        ? {
            // Three-valued, via the shared helper: "a band produced this" and
            // "nobody recorded who chose this" are different things to say.
            title: `${goalTitle(ctx.goal)}${goalSuffix(ctx.goal)}`,
            status: "unknown", blockedBy: [],
          }
        : null,
    };
  }

  if (id === "constitution") {
    return {
      id, kind: "constitution", title: "The Constitution", parentId: "company",
      description: "The identity and law every action runs under — consulted by every agent, enforced at the gate.",
      snapshot: "identity and law — the rules every action runs under",
      activity: "idle", health: null, momentum: null, completeness: null,
      gravity: grav(id), objective: null,
    };
  }

  const metric = METRICS.find((m) => m.id === id);
  if (metric) {
    return {
      id, kind: "metric", title: metric.title, parentId: "company",
      description: metric.description,
      snapshot: metric.snapshot(ctx),
      activity: "idle", health: null, momentum: null, completeness: null,
      gravity: grav(id), objective: null,
    };
  }

  const slot = id.startsWith("dept:") ? id.slice(5) : id.startsWith("agent:") ? id.slice(6) : null;
  if (!slot) return null;
  const row = ctx.slots.find((s) => s.slot === slot);
  if (!row) return null;
  const isDept = id.startsWith("dept:");
  const kids = ctx.byParent.get(slot) ?? [];
  return {
    id, kind: isDept ? "department" : "agent",
    title: slot,
    description: roleCopyFor(ctx, slot, row.template_id),
    // Direct reports of the root slot hang off the company itself — the
    // root agent reports to the company, so its reports' parent is company.
    parentId: !row.parent_slot || row.parent_slot === ctx.rootSlot ? "company" : childId(ctx, row.parent_slot),
    snapshot: isDept
      ? `${kids.filter((k) => !k.muted).length} agent${kids.length === 1 ? "" : "s"} · lead template ${row.template_id}`
      : `template ${row.template_id} · reports to ${row.parent_slot || "the company"}${row.muted ? " · muted" : ""}`,
    activity: slotActive(ctx, slot) ? "active" : "idle",
    health: null,                      // honest: no per-slot wellness basis in R1
    momentum: null,
    completeness: null,                // honest: no per-department blueprint exists
    gravity: grav(id),
    objective: null,
  };
}

/** A slot's node id: departments are the root's direct reports (they have
 *  children); everything else is an agent. */
export function childId(ctx: TreeCtx, slot: string): string {
  const row = ctx.slots.find((s) => s.slot === slot);
  if (!row) return `agent:${slot}`;
  const isRootReport = row.parent_slot === ctx.rootSlot;
  const hasKids = (ctx.byParent.get(slot) ?? []).length > 0;
  return isRootReport && hasKids ? `dept:${slot}` : `agent:${slot}`;
}

export function childrenOf(ctx: TreeCtx, id: string): NodeChildRef[] {
  if (id === "company") {
    const refs: NodeChildRef[] = [{ id: "constitution", kind: "constitution", title: "The Constitution" }];
    if (ctx.rootSlot) {
      for (const s of ctx.byParent.get(ctx.rootSlot) ?? []) {
        const cid = childId(ctx, s.slot);
        refs.push({ id: cid, kind: cid.startsWith("dept:") ? "department" : "agent", title: s.slot });
      }
      refs.push({ id: `agent:${ctx.rootSlot}`, kind: "agent", title: ctx.rootSlot });
    }
    for (const m of METRICS) refs.push({ id: m.id, kind: "metric", title: m.title });
    return refs;
  }
  const slot = id.startsWith("dept:") ? id.slice(5) : id.startsWith("agent:") ? id.slice(6) : null;
  if (!slot) return [];
  return (ctx.byParent.get(slot) ?? []).map((s) => {
    const cid = childId(ctx, s.slot);
    return { id: cid, kind: cid.startsWith("dept:") ? ("department" as const) : ("agent" as const), title: s.slot };
  });
}

export function capabilitiesOf(node: OrgNodeDto): NodeCapability[] {
  const cap = (id: string, label: string, kind: NodeCapability["kind"], prompt: string): NodeCapability =>
    ({ id, label, kind, source: "rule", prompt });
  switch (node.kind) {
    case "company":
      return [
        // FIRST deliberately: pre-activation, adoption is the company's most
        // valuable affordance and the composer caps chips at 4 — the client
        // filters it out once the runtime is seeded (an operating company
        // has nothing left to adopt).
        cap("c-adopt", "Can Adopt Existing Product", "custom", "adopt my existing product"),
        cap("c-spend", "Can Explain Spend", "explain", "why did spend spike"),
        cap("c-goal", "Can Show Goals", "explain", "show goals"),
        cap("c-team", "Can Show Team", "show_children", "show me the team"),
        cap("c-live", "Can Show Live Runtime", "explain", "what are the agents working on"),
        cap("c-grav", "Can Show Gravity", "custom", "where does the organization bend"),
      ];
    case "department":
      return [
        cap("d-explain", "Can Explain", "explain", `what is ${node.title} working on`),
        cap("d-team", "Can Show Team", "show_children", "show me the team"),
        cap("d-hist", "Can Show History", "explain", "what happened so far"),
      ];
    case "agent":
      return [
        cap("a-explain", "Can Explain", "explain", `what is ${node.title} working on`),
        cap("a-hist", "Can Show History", "explain", "what happened so far"),
      ];
    case "metric": {
      const m = METRICS.find((x) => x.id === node.id)!;
      return [
        cap("m-explain", "Can Explain", "explain", m.prompt),
        cap("m-compare", "Can Compare", "compare", "show it against the cap"),
      ];
    }
    case "constitution":
      return [cap("k-read", "Can Show Constitution", "custom", "show the constitution")];
  }
}

/** Which topics land on which node — the walk's deterministic routing map. */
export const TOPIC_NODE: Record<string, string> = {
  spend: "metric:spend",
  budget: "metric:budget",
  kpis: "metric:goal",
};
