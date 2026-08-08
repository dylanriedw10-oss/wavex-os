/** Applying research findings to the build chain.
 *
 *  PURE, and deliberately so: `deriveSteps` calls this every time it runs, so
 *  re-deriving the plan (the refinement tail, stale recovery, a resume)
 *  reproduces the identical checklist rather than compounding insertions.
 *  Idempotence here is what makes research safe to re-run.
 *
 *  Discipline throughout: DROP WITH A WARNING, never throw. A malformed
 *  finding must cost the operator that one finding, not the plan.
 *
 *  Types are declared structurally rather than imported from
 *  `routes/plan-assembly.ts` — TypeScript matches them by shape, and keeping
 *  the dependency arrow pointing one way (routes → research, never back) is
 *  what lets the work runtime reuse this module without dragging a Fastify
 *  route in behind it. */

import type { ResearchDelta, ResearchFinding } from "./types.js";

/** Structurally identical to plan-assembly's `ChecklistItem`, plus the
 *  provenance fields research adds. Both optional, so run files written
 *  before research existed still parse. */
export interface ChecklistItemShape {
  id: string;
  title: string;
  deliverable: string;
  assigneeSlot: string;
  kind: "mvp" | "operating" | "bundle";
  bundleId?: string;
  dependsOn: string[];
  origin?: "template" | "research";
  researchFindingId?: string;
}

export interface PatchShape {
  seq: number;
  step: "research" | "roadmap" | "kpis" | "departments" | "dependencies";
  source: "t2" | "research";
  kind: "skill_overlay" | "workflow_patch" | "mvp_step_insert" | "mvp_step_refocus";
  slot: string;
  detail: string;
}

export interface ApplyOpts {
  /** Slots whose status is `active` in the swarm manifest. Research may not
   *  invent an assignee — a task addressed to a parked agent never runs. */
  activeSlots: Set<string>;
}

/** Caps. The Review card's layout budget is already under measured pressure
 *  (it clamps against a real height), so an unbounded research section would
 *  push the plan past the fit law. Bounding here rather than in the renderer
 *  keeps the run file and the screen telling the same story. */
const MAX_INSERTS = 2;
const MAX_REFOCUS = 2;
const MAX_APPLIED = 3;
const TITLE_MAX = 80;
const DELIVERABLE_MAX = 240;

const clamp = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1).trimEnd()}…` : s);

export interface ApplyResult {
  checklist: ChecklistItemShape[];
  /** Finding ids whose delta was applied, in application order. */
  applied: string[];
  patches: Array<Omit<PatchShape, "seq">>;
  warnings: string[];
}

export function applyResearchToChecklist(
  checklist: ChecklistItemShape[],
  findings: ResearchFinding[],
  opts: ApplyOpts,
): ApplyResult {
  const out: ApplyResult = { checklist, applied: [], patches: [], warnings: [] };

  const mvpIds = checklist.filter((c) => c.kind === "mvp").map((c) => c.id);
  const withDelta = findings.filter((f) => f.delta !== null);
  if (withDelta.length === 0) return out;

  // The honest limit, stated once. A company already operating has no build
  // chain, so there is nothing structural for research to change. Its
  // findings still render and still reach agent briefs — but pretending they
  // reshaped a plan they could not touch would be a lie.
  if (mvpIds.length === 0) {
    out.warnings.push(
      `research findings are advisory for a company with no build chain — ${withDelta.length} suggested change${withDelta.length === 1 ? "" : "s"} not applied`,
    );
    return out;
  }

  const next = [...checklist];
  let inserts = 0;
  let refocus = 0;

  for (const f of withDelta) {
    if (out.applied.length >= MAX_APPLIED) {
      out.warnings.push(`research: capped at ${MAX_APPLIED} applied changes; the rest are advisory`);
      break;
    }
    const d = f.delta as ResearchDelta;

    if (d.kind === "mvp_step_insert") {
      if (inserts >= MAX_INSERTS) { out.warnings.push(`research: capped at ${MAX_INSERTS} inserted steps (${f.id})`); continue; }
      if (!opts.activeSlots.has(d.assigneeSlot)) {
        out.warnings.push(`research: dropped ${f.id} — "${d.assigneeSlot}" is not an active slot`);
        continue;
      }
      // `after: null` means "at the head" — no dependency. Otherwise the
      // anchor must be a real MVP item.
      if (d.after !== null && !mvpIds.includes(d.after)) {
        out.warnings.push(`research: dropped ${f.id} — unknown anchor "${d.after}"`);
        continue;
      }
      const id = `mvp-r-${f.id}`;
      if (next.some((c) => c.id === id)) continue;      // idempotent re-derive
      // Inserted items are LEAVES: they depend on the anchor and nothing
      // re-points onto them. Acyclic by construction — which is why there is
      // no cycle check here, and why there does not need to be one.
      const item: ChecklistItemShape = {
        id,
        title: clamp(d.title, TITLE_MAX),
        deliverable: clamp(d.deliverable, DELIVERABLE_MAX),
        assigneeSlot: d.assigneeSlot,
        kind: "mvp",
        dependsOn: d.after ? [d.after] : [],
        origin: "research",
        researchFindingId: f.id,
      };
      // Place it directly after its anchor so the chain reads in order.
      const at = d.after ? next.findIndex((c) => c.id === d.after) : -1;
      next.splice(at >= 0 ? at + 1 : 0, 0, item);
      inserts++;
      out.applied.push(f.id);
      out.patches.push({ step: "roadmap", source: "research", kind: "mvp_step_insert", slot: d.assigneeSlot, detail: f.headline });
      continue;
    }

    // mvp_step_refocus
    if (refocus >= MAX_REFOCUS) { out.warnings.push(`research: capped at ${MAX_REFOCUS} refocused steps (${f.id})`); continue; }
    const idx = next.findIndex((c) => c.id === d.target && c.kind === "mvp");
    if (idx < 0) {
      out.warnings.push(`research: dropped ${f.id} — unknown target "${d.target}"`);
      continue;
    }
    const target = next[idx]!;
    if (target.origin === "research") continue;          // idempotent re-derive
    // The TITLE is never rewritten. The operator approved a spine; research
    // may re-aim what a step produces, not rename what it is.
    next[idx] = {
      ...target,
      deliverable: clamp(d.deliverable, DELIVERABLE_MAX),
      origin: "research",
      researchFindingId: f.id,
    };
    refocus++;
    out.applied.push(f.id);
    out.patches.push({ step: "roadmap", source: "research", kind: "mvp_step_refocus", slot: target.assigneeSlot, detail: f.headline });
  }

  out.checklist = next;
  return out;
}
