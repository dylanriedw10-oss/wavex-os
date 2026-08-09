/** The research panel — act one's dominant object.
 *
 *  Findings are the plan's PROVENANCE, so this panel does not dissolve at the
 *  act break; it morphs into the first grid cell and travels there. Dissolve
 *  means "rejected" in this repo's motion vocabulary, and nothing here was
 *  rejected — the findings become most relevant at exactly the moment the
 *  plan they shaped appears.
 *
 *  Rows land one at a time with the grid's own `cv-appear`, on the same
 *  stagger. No new motion vocabulary is invented for this.
 *
 *  Fit law: the count is server-decided and therefore unbounded, so the rows
 *  clamp against a MEASURED budget and the remainder descends into a
 *  `.cv-record` — the sanctioned scroll exception. No ellipsis: a truncated
 *  claim about the operator's own business is the same lie as a truncated
 *  fact under review. */

import type React from "react";
import { useState } from "react";
import { fitRows, regionBudget, useMeasuredHeight } from "../../canvas/layout";
import { useDescendFocus } from "../lib/descend-focus";
import type { PlanUnit } from "../orchestration/plan-feed";
import { COPY } from "../copy";

const ROW_PX = 46;          // headline + claim, two lines
const LABEL_PX = 22;

function Row({ u, i, animate }: { u: PlanUnit; i: number; animate: boolean }) {
  const f = u.finding!;
  return (
    <div
      style={{
        display: "flex", gap: "var(--space-3)", alignItems: "baseline",
        padding: "var(--space-2) 0", minWidth: 0,
        animation: animate ? `cv-appear 160ms var(--ease) both ${i * 40}ms` : undefined,
      }}
    >
      {/* The dot stays decorative and stays aria-hidden; the WORD beside the
          claim is what actually carries the confidence. Colour alone lost two
          of the three server values — `medium` and `low` both fell through to
          `--border` — and said nothing at all to a screen reader. */}
      <span aria-hidden style={{
        width: 6, height: 6, borderRadius: "50%", flexShrink: 0, marginTop: 6,
        background: f.confidence === "high" ? "var(--mind)" : "var(--border)",
      }} />
      <div style={{ minWidth: 0 }}>
        <div style={{ fontSize: "var(--text-sm)", overflowWrap: "anywhere" }}>
          {f.headline}
          {/* The audit trail, where the operator can act on it: this finding
              is not just interesting, it changed the plan. */}
          {f.applied && (
            <span className="text-dim" style={{ fontSize: "var(--text-xs)", marginLeft: "var(--space-2)" }}>
              · {COPY.plan.research.applied}
            </span>
          )}
        </div>
        <div className="text-dim" style={{ fontSize: "var(--text-xs)", overflowWrap: "anywhere" }}>
          {f.claim}
          {COPY.plan.research.confidence[f.confidence] && (
            <> · {COPY.plan.research.confidence[f.confidence]}</>
          )}
        </div>
      </div>
    </div>
  );
}

/** The descend target: every finding, in full, in the one place allowed to
 *  scroll. A clamp must never descend into another clamp. */
function Record({ units, onBack, landingRef }: {
  units: PlanUnit[];
  onBack: () => void;
  /** Focus lands here on descend — see lib/descend-focus.ts. */
  landingRef?: React.Ref<HTMLHeadingElement>;
}) {
  return (
    <div className="cv-paper" style={{ height: "100%", minHeight: 0, display: "flex", flexDirection: "column", padding: "var(--space-4)", gap: "var(--space-3)" }}>
      <div style={{ flexShrink: 0, display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: "var(--space-3)" }}>
        <div>
          {/* A heading, not a div: it is the landing point for focus and
              the first thing a screen reader should read after descending. */}
          <h2 ref={landingRef} tabIndex={-1} style={{ fontSize: "var(--text-sm)", fontWeight: 600, margin: 0 }}>
            {COPY.plan.research.recordTitle}
          </h2>
          <div className="text-dim" style={{ fontSize: "var(--text-xs)" }}>{units.length} in total</div>
        </div>
        <button className="secondary" onClick={onBack} style={{ minHeight: 36 }}>{COPY.plan.research.recordBack}</button>
      </div>
      <div className="cv-record" style={{ flex: 1, minHeight: 0, display: "flex", flexDirection: "column" }}>
        {units.map((u, i) => <Row key={u.id} u={u} i={i} animate={false} />)}
      </div>
    </div>
  );
}

export function ResearchPanel({ units, revealed, settled, dominant }: {
  units: PlanUnit[];
  /** How many of THESE units have been released by the pacer. */
  revealed: number;
  /** Research has finished; the count is final. */
  settled: boolean;
  /** True during act one (the panel is the subject), false once it has
   *  become a grid cell beside the plan. */
  dominant: boolean;
}) {
  const [record, setRecord] = useState(false);
  const { triggerRef, landingRef } = useDescendFocus(record);
  const [rowsRef, rowsH] = useMeasuredHeight();

  const shown = units.slice(0, revealed);
  const budget = fitRows(regionBudget(rowsH, 0), ROW_PX, { min: 2, max: shown.length || 1 });
  const visible = shown.slice(0, budget);
  const hidden = shown.length - visible.length;

  if (record) {
    return (
      <Record
        units={units}
        onBack={() => setRecord(false)}
        landingRef={landingRef as React.Ref<HTMLHeadingElement>}
      />
    );
  }

  return (
    <div className={dominant ? "cv-paper" : undefined} style={{
      height: "100%", minHeight: 0, display: "flex", flexDirection: "column",
      padding: dominant ? "var(--space-4)" : 0, gap: "var(--space-2)",
    }}>
      <div style={{ flexShrink: 0, display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: "var(--space-3)", minHeight: LABEL_PX }}>
        <span style={{ fontSize: "var(--text-xs)", textTransform: "uppercase", letterSpacing: ".08em", color: "var(--text-dim)" }}>
          {COPY.plan.research.panelTitle}
        </span>
        {/* The total appears only once it is TRUE. During the call the count
            is genuinely unknown, and "3 of ?" is the same failure class as an
            invented metric. */}
        {settled && <span className="text-dim" style={{ fontSize: "var(--text-xs)" }}>{units.length}</span>}
      </div>

      <div ref={rowsRef} style={{ flex: 1, minHeight: 0, overflow: "hidden" }}>
        {visible.map((u, i) => <Row key={u.id} u={u} i={i} animate={dominant} />)}
        {settled && units.length === 0 && (
          <div className="text-dim" style={{ fontSize: "var(--text-sm)" }}>{COPY.plan.research.none}</div>
        )}
      </div>

      {hidden > 0 && (
        <button
          ref={triggerRef as React.Ref<HTMLButtonElement>}
          onClick={() => setRecord(true)}
          style={{
            flexShrink: 0, alignSelf: "flex-start", marginTop: 2, padding: 0, minHeight: 0,
            border: "none", background: "none", boxShadow: "none", font: "inherit",
            fontSize: "var(--text-xs)", color: "var(--mind)", cursor: "pointer",
          }}
        >
          {COPY.review.more(hidden)}
        </button>
      )}
    </div>
  );
}
