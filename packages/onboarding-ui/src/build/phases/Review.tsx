/** The review BEAT — the closing act of Build the Plan, not a phase of its
 *  own. The plan settles; the proposed organization renders as one
 *  before/after/reason proposal with ONE Confirm.
 *
 *  Finalize runs at ENTRY (workflow → assemble → sign) so the card shows
 *  the organization that will actually activate. Confirm advances to
 *  pricing — the real proposal is minted and committed at PRICING_DONE.
 *
 *  Space priority is INVERTED here relative to every other phase. Elsewhere
 *  the wheel is the subject and the cells annotate it; at Review the card is
 *  what the operator has to read, and the wheel is a glance confirming its
 *  shape. A fixed 260px face took 374px of an 863px window — 43% — and the
 *  card it displaced ran 396px past the fold, taking the Confirm button with
 *  it. So the wheel now takes a bounded FRACTION of the measured instrument
 *  zone and the card gets the remainder, measured and passed down. */

import { useEffect, useRef, useState } from "react";
import { wavexOsOnboardingApi } from "../../wavex-os/lib/api";
import { OrgFlywheel } from "../../canvas/OrgFlywheel";
import { useInstrumentHeight, useMeasuredHeight } from "../../canvas/layout";

/** Instrument-zone height below which Review drops the wheel entirely.
 *  Set just under the zone a 1280×800 window yields (~719) and above the
 *  floor's (~619), so the wheel survives every size where the plan can be
 *  read alongside it and only sheds where it cannot. */
const WHEEL_SHED_ZONE_PX = 660;
import type { AssemblyRunState, DepartmentsPayload } from "../../canvas/plan-contract";
import { deriveUnits, deptNodes, totalDepts } from "../orchestration/plan-feed";
import { ReviewProposalCell } from "../canvas/ReviewProposalCell";

export function Review({ companyId, run, finalizing, ready, committing, onFinalizing, onReady, onError, onConfirm }: {
  companyId: string;
  run: AssemblyRunState | null;
  finalizing: boolean;
  /** manifestSha256 present = finalize landed; the Confirm can render. */
  ready: boolean;
  /** The commit is in flight — the ONE Confirm latches so a second click
   *  cannot mint a second approval. */
  committing: boolean;
  onFinalizing: () => void;
  onReady: (sha256: string) => void;
  onError: (message: string) => void;
  onConfirm: () => void;
}) {
  /** Departments struck out here. This is where the scope question went:
   *  it used to be asked in the interview, before any plan existed, and its
   *  "whole organization" answer un-parked every agent the matrix had parked
   *  — destroying the activation verdict the operator's own answers had just
   *  produced. As a filter over a visible plan it can only subtract. */
  const [parked, setParked] = useState<ReadonlySet<string>>(new Set());
  const [parking, setParking] = useState(false);
  // Finalize once at entry: reuse a fresh prefetched workflow if the server
  // has one (its own 10-min freshness rule), assemble, sign.
  const ranRef = useRef(false);
  useEffect(() => {
    if (ranRef.current || ready || finalizing) return;
    ranRef.current = true;
    onFinalizing();
    void (async () => {
      try {
        const r = await wavexOsOnboardingApi.finalize({ companyId, skipInference: true });
        onReady(r.sha256);
      } catch (e) {
        onError(e instanceof Error ? e.message : String(e));
      }
    })();
  }, [companyId, ready, finalizing, onFinalizing, onReady, onError]);

  // The plan's own department list — the same array the card renders, read
  // from the run rather than from a catalogue, so a department that never
  // made it into the plan can't be "kept".
  const allDepartments: string[] =
    ((run?.steps.find((st) => st.id === "departments")?.payload as DepartmentsPayload | undefined)?.departments ?? [])
      .map((d) => d.department);

  /** Confirm, with parking applied first.
   *
   *  Order matters and is not negotiable: the scope record has to be on disk
   *  BEFORE the swarm is regenerated, and the manifest has to be re-signed
   *  before the approval quotes its sha — `approve-organization` compares
   *  the sha the operator approved against the one on disk and 409s on a
   *  mismatch. Parking then re-finalizing is what keeps that check true. */
  async function confirm(): Promise<void> {
    if (parked.size === 0) { onConfirm(); return; }
    setParking(true);
    try {
      const keep = allDepartments.filter((d) => !parked.has(d));
      await wavexOsOnboardingApi.setScope({ companyId, mode: "focused", departments: keep });
      const r = await wavexOsOnboardingApi.finalize({ companyId, skipInference: true });
      onReady(r.sha256);
      onConfirm();
    } catch (e) {
      onError(e instanceof Error ? e.message : String(e));
    } finally {
      setParking(false);
    }
  }

  const units = run ? deriveUnits(run) : [];
  const depts = run ? deptNodes(units, units.length) : [];

  // The wheel takes a bounded share of the zone; the card is measured and
  // gets what remains. Measuring the card region rather than deriving it
  // keeps the clamp honest under any chrome the card gains later — and the
  // region's own height does NOT change when the clamp fires (it is
  // `flex: 1` of a fixed remainder), so there is no measure→clamp→measure
  // oscillation.
  const zoneH = useInstrumentHeight();
  const wheelPx = zoneH > 0 ? Math.max(140, Math.min(240, Math.round(zoneH * 0.26))) : 180;
  const [cardRegionRef, cardRegionH] = useMeasuredHeight();

  // At the floor the plan needs the whole window. Measured: at 1024×700 the
  // card's tallest column wants ~392px and its chrome ~157px, against a 619px
  // zone — the wheel's 177px legibility minimum is exactly what does not fit.
  //
  // So the wheel sheds. This is the fit law's own remedy ("below the floor
  // the canvas stops shrinking and sheds a stratum"), and the wheel is the
  // right stratum to lose here: the card's Departments line already names all
  // six and their agent counts, so nothing is LOST — only the picture of it.
  // Shrinking it further instead would keep a shape nobody can read while
  // clipping the plan the operator has to approve.
  const showWheel = zoneH === 0 || zoneH >= WHEEL_SHED_ZONE_PX;

  return (
    <div style={{ height: "100%", minHeight: 0, display: "flex", flexDirection: "column", gap: "var(--space-3)", overflow: "hidden" }}>
      <div style={{ flexShrink: 0, display: showWheel ? "flex" : "none", justifyContent: "center" }}>
        <OrgFlywheel
          departments={depts}
          total={Math.max(totalDepts(units), 1)}
          onEnter={() => {}}
          facePx={wheelPx}
          center={{ eyebrow: "Proposed", title: companyId }}
          caption={null}
          emptyNote={null}
          // The card's Departments line names all six and their counts, so
          // the petal labels are a second copy of a fact already in text.
          // Shedding them lets the shape shrink to its true budget.
          labels={false}
        />
      </div>
      <div ref={cardRegionRef} style={{ flex: 1, minHeight: 0, overflow: "hidden", display: "flex", justifyContent: "center" }}>
        <div style={{ maxWidth: 860, width: "100%", height: "100%", minHeight: 0 }}>
          {run && ready && (
            <ReviewProposalCell
              run={run} busy={committing || parking} availPx={cardRegionH}
              parked={parked}
              onTogglePark={(d) => setParked((prev) => {
                const next = new Set(prev);
                if (next.has(d)) next.delete(d); else next.add(d);
                return next;
              })}
              onConfirm={() => void confirm()}
            />
          )}
          {run && !ready && (
            <div style={{ textAlign: "center", paddingTop: "var(--space-6)" }}>
              <span className="text-dim cv-breathe" style={{ fontSize: "var(--text-sm)" }}>
                assembling and signing the organization…
              </span>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
