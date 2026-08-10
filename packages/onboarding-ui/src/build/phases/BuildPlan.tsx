/** Phase 3 — Build the Plan, in TWO acts.
 *
 *  Research first (what is newly possible for this specific business), then
 *  planning (fit the roadmap, KPIs, departments and dependencies into the gap
 *  between the goal and what research found). Nothing happens instantly here
 *  on purpose: the plan assembles piece by piece while the trace narrates,
 *  and the wheel grows one segment per determined department.
 *
 *  This is the Generated Workspaces choreography over a paced feed — NOT a
 *  second progress mechanic, and NOT a corner-docked panel. Rev 9 rejected
 *  the permanent dock on "one address per fact", and that ruling stands: the
 *  strip is the one address, and it gains a single word.
 *
 *  Layout: growing wheel (top) → the research panel, which becomes a plan
 *  cell → the choreographed grid → the stage trace. */

import { useMemo } from "react";
import { Cell } from "../../canvas/cells";
import { OrgFlywheel } from "../../canvas/OrgFlywheel";
import { Ic } from "../../canvas/icons";
import { useInstrumentHeight } from "../../canvas/layout";
import { useCellChoreography } from "../../canvas/useCellChoreography";
import type { AssemblyRunState } from "../../canvas/plan-contract";
import { COPY } from "../copy";
import { deriveUnits, deptNodes, researchUnits, totalDepts, type PlanUnit } from "../orchestration/plan-feed";
import { ResearchPanel } from "../canvas/ResearchPanel";
import { summarize, useConnectorCredentials } from "../canvas/ConnectorConstellation";

const REDUCE = typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;

/** The trace, with an act eyebrow.
 *
 *  The eyebrow prints the CURRENT stage only — no breadcrumb, no "stage 1 of
 *  2", no completed-stage chip. Research's history is the findings panel and
 *  the plan's history is the plan; a third rendering of the same fact is the
 *  duplication "one address per fact" exists to prevent.
 *
 *  The counter is SILENT during research, deliberately. The total is
 *  genuinely unknown while the model is working, and printing "3 of ?" (or
 *  guessing a denominator) is the same failure class as an invented metric.
 *  During act one the panel's rows are the count. */
function StageTrace({ units, revealed, stage, researchSettled, done }: {
  units: PlanUnit[]; revealed: number;
  stage: "research" | "planning"; researchSettled: boolean; done: boolean;
}) {
  const shown = units.slice(0, revealed);
  const last = shown[shown.length - 1];
  const eyebrow = done ? null : stage === "research" ? COPY.plan.stage.research : COPY.plan.stage.plan;
  const line = done
    ? COPY.plan.settled
    : stage === "research"
      ? (researchSettled
          ? COPY.plan.research.settled(
              researchUnits(units).length,
              researchUnits(units).filter((u) => u.finding?.applied).length,
            )
          : COPY.plan.research.opening)
      : (last?.trace ?? COPY.plan.intro);

  return (
    <div role="status" aria-live="polite"
      style={{ display: "flex", alignItems: "center", gap: 8, minHeight: 28, flexWrap: "wrap" }}>
      {!done && (
        <span aria-hidden className={REDUCE ? undefined : "cv-breathe"}
          style={{ width: 7, height: 7, borderRadius: "50%", background: "var(--mind)", flexShrink: 0 }} />
      )}
      {eyebrow && (
        <span style={{ fontSize: "var(--text-xs)", textTransform: "uppercase", letterSpacing: ".1em", color: "var(--text-dim)" }}>
          {eyebrow}
        </span>
      )}
      <span style={{ fontSize: "var(--text-xs)", color: done ? "var(--text-dim)" : "var(--mind)" }}>{line}</span>
      {stage === "planning" && (
        <span className="text-dim" style={{ fontSize: "var(--text-xs)", marginLeft: "auto" }}>
          {revealed} of {units.length}
        </span>
      )}
    </div>
  );
}

export function BuildPlan({ companyId, run, stage, revealed, researchSettled }: {
  companyId: string;
  run: AssemblyRunState | null;
  stage: "research" | "planning";
  revealed: number;
  researchSettled: boolean;
}) {
  // The condensed indicator's counts — vault truth, read not mirrored.
  const credsQ = useConnectorCredentials(companyId, true);
  const { wired, deferred } = summarize(credsQ.data?.connectors ?? []);
  const units = useMemo(() => (run ? deriveUnits(run) : []), [run]);
  const research = useMemo(() => researchUnits(units), [units]);
  const done = run !== null && stage === "planning" && revealed >= units.length;
  const cells = units.slice(0, revealed).map((u) => u.cell).filter((c): c is NonNullable<PlanUnit["cell"]> => !!c);
  const { cellPhase, registerCellRef } = useCellChoreography(cells, revealed);
  const depts = deptNodes(units, revealed);

  // The fit law: derive the face from the MEASURED zone rather than from a
  // constant. `facePx={300}` survived here only on slack that the research
  // panel removes — and a hardcoded face is exactly the class Rev 10
  // abolished. The wheel is small while the panel is the subject, and grows
  // at the act break when it becomes the subject again.
  const zoneH = useInstrumentHeight();
  const share = stage === "research" ? 0.28 : 0.42;
  const facePx = zoneH > 0
    ? Math.max(140, Math.min(stage === "research" ? 220 : 300, Math.round(zoneH * share)))
    : 200;

  if (!run) {
    return (
      <div style={{ height: "100%", display: "grid", placeItems: "center" }}>
        <span className="text-dim cv-breathe" style={{ fontSize: "var(--text-sm)" }}>
          reading the connectors and sizing the plan…
        </span>
      </div>
    );
  }

  const dominant = stage === "research";

  return (
    <div style={{ height: "100%", minHeight: 0, display: "flex", flexDirection: "column", gap: "var(--space-3)", overflow: "hidden" }}>
      {/* The wheel stays MOUNTED through research, empty. Popping it in at
          the act break would break spatial continuity with Phase 2's core;
          growing it in place explains where the departments came from. */}
      <div style={{
        flexShrink: 0, display: "flex", justifyContent: "center",
        transition: REDUCE ? undefined : "height 400ms var(--ease)",
      }}>
        <OrgFlywheel
          departments={depts}
          total={Math.max(totalDepts(units), 1)}
          onEnter={() => {}}
          facePx={facePx}
          center={{ eyebrow: "Building", title: companyId }}
          caption={null}
          emptyNote={null}
          labels={!dominant}
        />
      </div>

      <div style={{ flex: 1, minHeight: 0, overflow: "hidden", display: "flex", flexDirection: "column", gap: "var(--space-3)" }}>
        {/* Act one's dominant object. It does not dissolve at the break — it
            becomes the first thing in the grid, because the findings are the
            plan's provenance and are most relevant once the plan appears. */}
        {(dominant || research.length > 0) && (
          <div
            ref={registerCellRef("plan-research")}
            style={{
              flex: dominant ? 1 : "0 0 auto",
              minHeight: 0,
              maxHeight: dominant ? undefined : 150,
              overflow: "hidden",
            }}
          >
            <ResearchPanel
              units={research}
              revealed={Math.min(revealed, research.length)}
              settled={researchSettled}
              dominant={dominant}
            />
          </div>
        )}

        {/* The plan cells, choreographed — one appears as each piece lands. */}
        {!dominant && (
          <div style={{ flex: 1, minHeight: 0, overflow: "hidden" }}>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))", gap: "var(--space-3)" }}>
              {cells.map((cell, i) => (
                <div key={cell.id} ref={registerCellRef(cell.id)}
                  style={{
                    animation: cellPhase[cell.id] === "appear"
                      ? `cv-appear var(--dur-base) var(--ease) ${i * 40}ms both`
                      : cellPhase[cell.id] === "morph" ? "cv-morph 520ms var(--ease)" : undefined,
                  }}>
                  <Cell cell={cell} companyId={companyId} onDrill={() => {}} />
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Pinned low: the trace + the forever-condensed connectors. */}
      <div style={{ flexShrink: 0, display: "flex", flexDirection: "column", gap: 6 }}>
        <StageTrace units={units} revealed={revealed} stage={stage} researchSettled={researchSettled} done={done} />
        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <Ic name="check" size={11} color="var(--good)" />
          <span className="text-dim" style={{ fontSize: "var(--text-xs)" }}>
            {COPY.connectors.condensed(wired, deferred)}
          </span>
        </div>
      </div>

      {/* cv-appear and cv-morph were redeclared here because the originals sat
          inside CanvasPage, which /build never mounts. Two copies of one
          animation is how the vocabulary drifted: cv-breathe was never
          duplicated, so it was simply dead on this surface. Both now come
          from styles.css. */}
    </div>
  );
}
