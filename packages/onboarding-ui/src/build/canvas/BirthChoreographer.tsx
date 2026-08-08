/** Birth — ONE coordinated motion, not a series of state changes to notice
 *  separately. A single linear stage machine advanced by ONE async sequence;
 *  every animated participant reads `motionStage` from props and none mounts
 *  its own timer. The states it reveals are REAL — activation and seeding
 *  already committed at approval; this is the organization being SHOWN
 *  waking, not pretended into existence.
 *
 *    fold     — the plan's cells dissolve; the org is no longer a proposal
 *    petals   — the wheel's segments take their live styling
 *    complete — the center crossfades company name → "The Constitution"
 *    runtime  — ignition status polled until it answers; the pulse goes live
 *    done     — land on /canvas: the same wheel geometry, now the real thing */

import { useEffect, useRef } from "react";
import { wavexOsOnboardingApi } from "../../wavex-os/lib/api";
import { OrgFlywheel } from "../../canvas/OrgFlywheel";
import type { AssemblyRunState } from "../../canvas/plan-contract";
import { deriveUnits, deptNodes, totalDepts } from "../orchestration/plan-feed";
import { COPY } from "../copy";
import type { MotionStage } from "../state/build-reducer";

const REDUCE = typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;

const DWELL: Record<Exclude<MotionStage, "runtime" | "done">, number> = {
  fold: 600,
  petals: 900,
  complete: 700,
};

export function BirthChoreographer({ companyId, run, motionStage, onStage, onDone }: {
  companyId: string;
  run: AssemblyRunState | null;
  motionStage: MotionStage;
  onStage: (s: MotionStage) => void;
  onDone: () => void;
}) {
  // THE one sequence. A ref latch keeps StrictMode/HMR from double-running.
  const startedRef = useRef(false);
  useEffect(() => {
    if (startedRef.current) return;
    startedRef.current = true;
    void (async () => {
      const dwell = (ms: number) => new Promise((r) => setTimeout(r, REDUCE ? 0 : ms));
      onStage("fold");
      await dwell(DWELL.fold);
      onStage("petals");
      await dwell(DWELL.petals);
      onStage("complete");
      await dwell(DWELL.complete);
      onStage("runtime");
      // Poll ignition until it answers — activation already committed, so
      // this settles in one or two polls; the cap keeps a wedged server
      // from trapping the operator in the motion.
      for (let i = 0; i < 20; i++) {
        try {
          const s = await wavexOsOnboardingApi.getIgnitionStatus(companyId);
          if (s.status !== "not_activated") break;
        } catch { /* poll again */ }
        await new Promise((r) => setTimeout(r, 600));
      }
      onStage("done");
      await dwell(400);
      onDone();
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const units = run ? deriveUnits(run) : [];
  // NO snapshot overwrite. The petals already carry each department's real
  // cycle (plan-feed's `cycleFor`), so leaving them alone IS "workflows
  // activating" — built from the plan's own dependency data, with no new
  // stage and nothing narrated over it. The overwrite that used to replace
  // every snapshot with "waking" was a word standing in for a fact we now
  // actually have.
  const depts = deptNodes(units, units.length);
  const centerIsConstitution = motionStage === "complete" || motionStage === "runtime" || motionStage === "done";

  return (
    <div style={{ height: "100%", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: "var(--space-4)" }}>
      <div style={{
        transition: REDUCE ? undefined : "opacity 500ms var(--ease), transform 500ms var(--ease)",
        opacity: motionStage === "fold" ? 0.55 : 1,
        transform: motionStage === "fold" ? "scale(0.98)" : "none",
      }}>
        <OrgFlywheel
          departments={depts}
          total={Math.max(totalDepts(units), 1)}
          onEnter={() => {}}
          facePx={360}
          center={centerIsConstitution
            ? undefined                                  // the default: The Constitution
            : { eyebrow: "Born", title: companyId }}
          caption={
            <span className="text-dim" style={{ fontSize: "var(--text-xs)" }}>
              {motionStage === "runtime"
              ? "runtime igniting…"
              : motionStage === "done"
                ? "alive"
                : motionStage === "fold"
                  ? COPY.birth.motion
                  : COPY.birth.workflows}
            </span>
          }
          emptyNote={null}
        />
      </div>
      {motionStage === "runtime" && (
        <span aria-hidden className={REDUCE ? undefined : "cv-breathe"}
          style={{ width: 8, height: 8, borderRadius: "50%", background: "var(--live)" }} />
      )}
    </div>
  );
}
