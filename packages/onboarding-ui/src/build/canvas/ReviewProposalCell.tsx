/** The Review card — the proposed organization presented the way every
 *  other change in this product is: before / after / reason, applied to the
 *  organization itself before it exists. One Confirm.
 *
 *  This is the ONE screen whose entire purpose is that the operator can SEE
 *  what they are approving, so it may never do either of the two things a
 *  dense card normally gets away with:
 *
 *    clip   — the fit law's cardinal sin. Here it hid 396px including the
 *             Confirm button itself: an approval gate the approver could
 *             not reach.
 *    elide  — `text-overflow: ellipsis` on "owned by cro.expa…" is a silent
 *             cap on a fact under review. A KPI's owner is half the fact.
 *
 *  Four changes buy the room to obey both:
 *
 *  1. GENESIS MODE. When every `before` is null there is no diff to show —
 *     yet the old layout spent a full `1fr` column repeating "— nothing yet"
 *     five times, and squeezed the actual plan into the remaining `2fr`
 *     (which is what forced the ellipsis). Said once, at the top, the plan
 *     gets the whole width. The before/after columns still render whenever
 *     a `before` is genuinely present — this is a genesis special case, not
 *     a replacement.
 *  2. LABELS ON TOP. Costs 16px of height per section, returns 110px of
 *     width to every row — the trade that makes two columns legible.
 *  3. INLINE RUNS for the enumerable-but-low-signal sections. "Departments"
 *     spent six lines restating the six labeled petals of the wheel sitting
 *     directly above it; as `cpo 5 · cmo 5 · …` it is one line and still
 *     COMPLETE. Compaction, not truncation — nothing is hidden.
 *  4. A MEASURED CLAMP on the only unbounded list. The old `slice(0, 6)` was
 *     a hardcoded guess, correct at no window size in particular. Deliverables
 *     now clamp to the budget the card was actually given, state their true
 *     total, and descend into `.cv-record` — the fit law's clamp-and-descend
 *     rather than a cut.
 *
 *  The clamp measures; it does not estimate. A first pass here DID estimate
 *  the chrome (label + rows + reason, in constants) and still left Confirm
 *  25px below the fold, because reason lines WRAP at two-column width and no
 *  constant can know that. So the card is given a bounded height, the
 *  deliverables list is the flex child that absorbs the remainder, and the
 *  row count is fitted to that box's MEASURED height. The box is `flex: 1`
 *  of a fixed card, so its height does not change when the count does —
 *  which is what keeps this from oscillating.
 */

import { useState } from "react";
import { ProposalCard } from "../../canvas/cells";
import type { CanvasProposal } from "../../canvas/contract";
import { fitRows, useMeasuredHeight, useMeasuredWidth } from "../../canvas/layout";
import type {
  AssemblyRunState, ChecklistItem, DepartmentsPayload, DependenciesPayload, KpisPayload, RoadmapPayload,
} from "../../canvas/plan-contract";
import { COPY } from "../copy";

/** One deliverable row. The ONLY layout constant left in the clamp — every
 *  other height is measured, because every other height can wrap. */
const ROW_PX = 22;
const SECTION_GAP_PX = 14;
/** Below this the two columns are narrower than a KPI label + its owner,
 *  and every row wraps — one column is honest at that width. */
const TWO_COL_MIN_W = 560;

interface Section {
  id: string;
  label: string;
  before: string[] | null;
  after: string[];
  /** `inline` renders a complete "a · b · c" run in one row — used where the
   *  items are a roster, not a list of things to read separately. */
  layout: "inline" | "lines";
  /** Parallel to `after` — the value a toggle sends when the item is one the
   *  operator can park. Only the departments section has these. */
  keys?: string[];
  reason: string;
}

function deriveSections(run: AssemblyRunState): { colA: Section[]; colB: Section[]; checklist: ChecklistItem[] } {
  const byId = new Map(run.steps.map((s) => [s.id, s]));
  const roadmap = byId.get("roadmap")?.payload as RoadmapPayload | undefined;
  const kpis = byId.get("kpis")?.payload as KpisPayload | undefined;
  const departments = byId.get("departments")?.payload as DepartmentsPayload | undefined;
  const deps = byId.get("dependencies")?.payload as DependenciesPayload | undefined;
  const checklist = roadmap?.checklist ?? [];
  const mvp = checklist.filter((c) => c.kind === "mvp");

  // `stated: false` means nobody gave this number — a stage band stood in.
  // It renders as what it is. The whole loop measures itself against this
  // line, so a guess wearing a decision's clothes is the one thing the card
  // must never show.
  // `!== true`, not `=== false`: the contract types the flag optional, so an
  // absent one is "no record of who chose this" — which must read as a guess,
  // not as an endorsement.
  const guessed = !!roadmap && roadmap.goal.stated !== true;
  const goal: Section = {
    id: "goal", label: "Goal", before: null, layout: "lines",
    after: roadmap
      ? [`${roadmap.goal.kpiId.replace(/_/g, " ")}: ${roadmap.goal.current.toLocaleString()} → ${roadmap.goal.target.toLocaleString()} in ${roadmap.goal.days}d`]
      : [],
    // The marker lives on the REASON line, not appended to the value, and it
    // is kept to one line's worth of characters.
    //
    // Column A does not clamp — only deliverables absorbs slack — so any
    // prose that grows here overflows the card's own box rather than being
    // clamped, which is the silent inner clip the fit law names. A suffix on
    // the value line cost 29px at 1280×800; a two-line reason cost 10. The
    // reason line is where the card explains every other fact, so it is the
    // right place for this one, and staying inside one line is the budget.
    reason: guessed
      ? "Estimated — no goal was stated. Set one in Mission Control."
      : "Fixed at approval — the checklist revises, the goal does not.",
  };
  const kpiSection: Section = {
    id: "kpis", label: "KPIs", before: null, layout: "lines",
    after: (kpis?.kpis ?? []).map((k) => `${k.label} — ${k.ownerRole ?? "unowned"}`),
    reason: "The benchmarks the loop measures against; each owned by the slot whose bundle moves it.",
  };
  const timeline: Section = {
    // "Workflows", not "Timeline": these are recurring CYCLES, not a schedule.
    // Inline, like Departments, and for the same reason: five cadence rows
    // were the tallest UNCLAMPED block in the card, so at the floor they
    // overflowed their own column and were clipped inside the card — an
    // overflow the window-level fit check cannot see. As a run it is one
    // wrapped block and still complete.
    id: "timeline", label: "Workflows", before: null, layout: "inline",
    after: (deps?.bundles ?? []).map((b) => `${b.bundleId.replace(/_/g, " ")} (${b.cycleLength})`),
    reason: "Cross-team cycles with owners; the dependency edges route their hand-offs.",
  };
  const deptSection: Section = {
    // The CATEGORIES, named — not their headcounts. A per-department agent
    // count is a bare number with no decision attached to it: the decision it
    // feeds ("is this too many?") is made once, against the total, next to
    // the Confirm button. Agents are an implementation detail of the
    // orchestration; the operator-facing unit is the department.
    id: "departments", label: "Departments", before: null, layout: "inline",
    after: (departments?.departments ?? []).map((d) => d.slot),
    // The parking key — `applyScopeFilter` matches agents on `department`,
    // so that is what a toggle has to carry, not the chief's slot.
    keys: (departments?.departments ?? []).map((d) => d.department),
    reason: `Sized to the plan — ${departments?.departments.length ?? 0} departments, no more.`,
  };
  const deliverables: Section = {
    id: "deliverables", label: "Deliverables", before: null, layout: "lines",
    after: checklist.map((c) => c.title),
    reason: mvp.length > 0
      ? `${mvp.length} MVP-build steps execute first; the rest are operating cadences.`
      : "Operating cadences from day one — the product already exists.",
  };

  // Split for balance, not by category: the tallest column sets the card's
  // height, so goal+KPIs+timeline (10 rows) sits opposite departments+
  // deliverables (10 rows) rather than stacking all five.
  return { colA: [goal, kpiSection, timeline], colB: [deptSection, deliverables], checklist };
}

function SectionBlock({ s, rows, genesis, flexible, rowsRef, onMore, parked, onTogglePark }: {
  s: Section; rows: number; genesis: boolean;
  /** The one section that absorbs the card's leftover height. */
  flexible?: boolean;
  rowsRef?: (el: HTMLElement | null) => void;
  onMore?: () => void;
  /** Departments the operator has struck out. */
  parked?: ReadonlySet<string>;
  onTogglePark?: (key: string) => void;
}) {
  const hidden = s.after.length - rows;
  const shown = s.layout === "inline" ? s.after : s.after.slice(0, rows);
  return (
    <div style={flexible ? { flex: 1, minHeight: 0, display: "flex", flexDirection: "column" } : undefined}>
      <div style={{ fontSize: "var(--text-xs)", textTransform: "uppercase", letterSpacing: ".08em", color: "var(--text-dim)", flexShrink: 0 }}>
        {s.label}
      </div>
      <div style={{
        display: "flex", alignItems: "baseline", gap: "var(--space-2)", minWidth: 0,
        ...(flexible ? { flex: 1, minHeight: 0, alignItems: "stretch" } : null),
      }}>
        {/* Outside genesis the `before` still renders — the diff idiom is
            intact for every later review of a live organization. */}
        {!genesis && (
          <>
            <span className="text-dim" style={{ fontSize: "var(--text-xs)", fontStyle: s.before ? undefined : "italic" }}>
              {s.before ? s.before.join(" · ") : COPY.review.nothingYet}
            </span>
            <span aria-hidden className="text-dim" style={{ fontSize: "var(--text-xs)" }}>→</span>
          </>
        )}
        <div style={{
          fontSize: "var(--text-sm)", minWidth: 0, flex: 1,
          ...(flexible ? { display: "flex", flexDirection: "column", minHeight: 0 } : null),
        }}>
          {s.after.length === 0 && <span className="text-dim">—</span>}
          {/* The measured box. `flex: 1` of a card whose height is fixed by
              the caller, so its height is independent of how many rows we
              decide to put in it — no measure→clamp→measure loop. */}
          <div ref={rowsRef} data-rows={s.id} style={flexible ? { flex: 1, minHeight: 0, overflow: "hidden" } : undefined}>
            {s.layout === "inline" && s.keys && onTogglePark
              // Parking, applied to a plan that EXISTS. This is the only
              // moment the departments are visible, which is why the question
              // lives here and not in the interview — before the plan, the
              // same click was a scope guess about an org nobody had seen.
              // Subtractive only: striking one out parks its agents; nothing
              // here can promote an agent the matrix parked.
              ? (
                <span style={{ display: "flex", flexWrap: "wrap", gap: "6px 10px" }}>
                  {shown.map((label, i) => {
                    const key = s.keys![i];
                    const off = parked?.has(key) ?? false;
                    return (
                      <button
                        key={key} type="button" onClick={() => onTogglePark(key)}
                        aria-pressed={!off}
                        title={off ? "Parked — click to keep" : "Click to leave this department out"}
                        style={{
                          padding: 0, minHeight: 0, border: "none", background: "none", boxShadow: "none",
                          font: "inherit", cursor: "pointer",
                          color: off ? "var(--text-dim)" : "var(--text)",
                          textDecoration: off ? "line-through" : "none",
                          opacity: off ? 0.6 : 1,
                        }}>
                        {label}
                      </button>
                    );
                  })}
                </span>
              )
              : s.layout === "inline"
              ? <span style={{ overflowWrap: "anywhere" }}>{shown.join(" · ")}</span>
              : shown.map((line) => (
                  // No ellipsis: a fact under review wraps rather than hides.
                  <div key={line} style={{ overflowWrap: "anywhere" }}>{line}</div>
                ))}
          </div>
          {hidden > 0 && s.layout === "lines" && (
            <button
              onClick={onMore}
              style={{
                flexShrink: 0, alignSelf: "flex-start",
                marginTop: 2, padding: 0, minHeight: 0, border: "none", background: "none", boxShadow: "none",
                font: "inherit", fontSize: "var(--text-xs)", color: "var(--mind)", cursor: "pointer",
              }}
            >
              {COPY.review.more(hidden)}
            </button>
          )}
        </div>
      </div>
      <div className="text-dim" style={{ fontSize: "var(--text-xs)", marginTop: 2, flexShrink: 0 }}>{s.reason}</div>
    </div>
  );
}

/** The descend target for the deliverables clamp — the full checklist,
 *  verbatim, grouped by kind. `.cv-record` is the fit law's named scroll
 *  exception; a clamp must never descend into another clamp. */
function ChecklistRecord({ checklist, onBack }: { checklist: ChecklistItem[]; onBack: () => void }) {
  return (
    <div className="cv-paper" style={{ height: "100%", minHeight: 0, display: "flex", flexDirection: "column", padding: "var(--space-4)", gap: "var(--space-3)" }}>
      <div style={{ flexShrink: 0, display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: "var(--space-3)" }}>
        <div>
          <div style={{ fontSize: "var(--text-sm)", fontWeight: 600 }}>{COPY.review.recordTitle}</div>
          <div className="text-dim" style={{ fontSize: "var(--text-xs)" }}>{checklist.length} in total</div>
        </div>
        <button className="secondary" onClick={onBack} style={{ minHeight: 36 }}>{COPY.review.recordBack}</button>
      </div>
      <ol className="cv-record" style={{ flex: 1, minHeight: 0, margin: 0, paddingLeft: "var(--space-5)", display: "flex", flexDirection: "column", gap: "var(--space-3)" }}>
        {checklist.map((c) => (
          <li key={c.id} style={{ fontSize: "var(--text-sm)" }}>
            <div style={{ display: "flex", alignItems: "baseline", gap: "var(--space-2)", flexWrap: "wrap" }}>
              <span>{c.title}</span>
              <span className="text-dim" style={{ fontSize: "var(--text-xs)" }}>
                {COPY.review.kinds[c.kind] ?? c.kind} · {c.assigneeSlot.split(".")[0]}
              </span>
            </div>
            <div className="text-dim" style={{ fontSize: "var(--text-xs)", marginTop: 2 }}>{c.deliverable}</div>
          </li>
        ))}
      </ol>
    </div>
  );
}

export function ReviewProposalCell({ run, busy, availPx, parked, onTogglePark, onConfirm }: {
  run: AssemblyRunState;
  busy: boolean;
  /** The measured height this card was given. The deliverables clamp is
   *  computed against it — 0 means unmeasured and `fitRows` falls back. */
  availPx: number;
  /** Departments the operator has struck out, and the toggle. Absent means
   *  the run is not parkable (no departments step yet) and the roster
   *  renders as a plain run. */
  parked: ReadonlySet<string>;
  onTogglePark: (department: string) => void;
  onConfirm: () => void;
}) {
  const [record, setRecord] = useState(false);
  const [cardRef, cardW] = useMeasuredWidth();
  const [rowsRef, rowsH] = useMeasuredHeight();
  const { colA, colB, checklist } = deriveSections(run);
  const twoCol = cardW >= TWO_COL_MIN_W;

  // At genesis every `before` is null — the diff has no left side to show.
  const genesis = [...colA, ...colB].every((s) => s.before === null);

  // The clamp. Deliverables is the one section that grows without bound, so
  // it is the flex child that absorbs whatever the card has left, and the
  // count is fitted to that box as MEASURED. `min: 2` because a deliverables
  // list showing one item reads as a plan with one deliverable; two plus a
  // counted "+N more" reads as what it is.
  const bounded = availPx > 0;
  const deliverables = colB[1];
  const deliverableRows = bounded
    ? fitRows(rowsH, ROW_PX, { min: 2, max: deliverables.after.length })
    : deliverables.after.length;

  const kpiCount = colA.find((s) => s.id === "kpis")?.after.length ?? 0;
  // The count the summary states is what will actually run — parking one
  // department must move this number, or the completeness statement above
  // the card contradicts the strikethrough inside it.
  const deptKeys = colB[0].keys ?? [];
  const deptCount = deptKeys.filter((k) => !parked.has(k)).length || colB[0].after.length;
  const display: CanvasProposal = {
    id: "review-display",
    action: "approve-organization",
    body: {},
    // The completeness statement: every total named up front, so a clamp
    // deeper in the card can never read as "that was all of it".
    summary: `${COPY.review.title} — ${checklist.length} deliverables across ${deptCount} departments, ${kpiCount} KPIs, one goal.`,
    created_at: new Date().toISOString(),
    status: "pending",
  };

  if (record) return <ChecklistRecord checklist={checklist} onBack={() => setRecord(false)} />;

  const column = (sections: Section[]) => (
    <div style={{ display: "flex", flexDirection: "column", gap: SECTION_GAP_PX, minWidth: 0, minHeight: 0 }}>
      {sections.map((s) => {
        const isDeliverables = s.id === "deliverables";
        return (
          <SectionBlock
            key={s.id} s={s} genesis={genesis}
            rows={isDeliverables ? deliverableRows : s.after.length}
            flexible={bounded && isDeliverables}
            rowsRef={isDeliverables ? rowsRef : undefined}
            onMore={() => setRecord(true)}
            parked={s.id === "departments" ? parked : undefined}
            onTogglePark={s.id === "departments" ? onTogglePark : undefined}
          />
        );
      })}
    </div>
  );

  return (
    // `height: 100%`, never `height: availPx`. Driving the card's height from
    // the measured number re-introduces the original bug in miniature: the
    // first paint measures the region before the wheel settles, and a card
    // pinned to that stale value overflows its own region by exactly the
    // difference. `availPx` is used ONLY as the signal that the region has
    // been measured at all; the size itself comes from the box.
    <div ref={cardRef} style={{ minWidth: 0, height: bounded ? "100%" : undefined, minHeight: 0 }}>
      <ProposalCard proposal={display} busy={busy} error={null} onConfirm={onConfirm} confirmLabel={COPY.review.confirm} fill={bounded}>
        {genesis && (
          <div className="text-dim" style={{ fontSize: "var(--text-xs)", fontStyle: "italic", flexShrink: 0 }}>
            {COPY.review.genesis}
          </div>
        )}
        <div style={{
          display: "grid",
          gridTemplateColumns: twoCol ? "1fr 1fr" : "1fr",
          gap: `${SECTION_GAP_PX}px var(--space-5)`,
          // stretch, not start: the deliverables column must receive the
          // card's full remaining height for its flex child to measure.
          alignItems: "stretch",
          margin: "var(--space-2) 0",
          minWidth: 0,
          ...(bounded ? { flex: 1, minHeight: 0 } : null),
        }}>
          {twoCol ? <>{column(colA)}{column(colB)}</> : column([...colA, ...colB])}
        </div>
      </ProposalCard>
    </div>
  );
}
