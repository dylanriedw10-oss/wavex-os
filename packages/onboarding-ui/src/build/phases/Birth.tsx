/** Phase 5 — Birth.
 *
 *  Path A first builds the MVP: the WorkPanel mounted whole — the "named,
 *  Lovable-style generation phase" is the native runtime doing REAL work
 *  (the MVP goal + dependency chain seeded at approval), watched live:
 *  run cycles, review deliverables, request changes. Accepting hands off
 *  to the one coordinated motion. Path B skips straight to the motion —
 *  there is nothing to build, only to connect. */

import { WorkPanel } from "../../canvas/WorkPanel";
import type { AssemblyRunState } from "../../canvas/plan-contract";
import { BirthChoreographer } from "../canvas/BirthChoreographer";
import { COPY } from "../copy";
import type { MotionStage } from "../state/build-reducer";

export function Birth({ companyId, run, stage, motionStage, onAcceptMvp, onMotionStage, onDone }: {
  companyId: string;
  run: AssemblyRunState | null;
  stage: "mvp" | "motion";
  motionStage: MotionStage | null;
  onAcceptMvp: () => void;
  onMotionStage: (s: MotionStage) => void;
  onDone: () => void;
}) {
  if (stage === "mvp") {
    return (
      <div style={{ height: "100%", minHeight: 0, display: "flex", flexDirection: "column", gap: "var(--space-3)", overflow: "hidden" }}>
        <div style={{ flexShrink: 0 }}>
          <h2 style={{ margin: 0, fontSize: "var(--text-xl)", fontWeight: 650, letterSpacing: "-0.01em" }}>{COPY.birth.mvpTitle}</h2>
          <p className="text-dim" style={{ fontSize: "var(--text-sm)", margin: "4px 0 0", maxWidth: "64ch" }}>{COPY.birth.mvpSub}</p>
        </div>
        <div style={{ flex: 1, minHeight: 0, overflow: "hidden" }}>
          {/* The real Work lens — 503 gate, seed, run-cycle, review ladder,
              all unmodified. The MVP goal is already in the store. */}
          <WorkPanel companyId={companyId} />
        </div>
        <div style={{ flexShrink: 0, display: "flex", justifyContent: "flex-end" }}>
          <button onClick={onAcceptMvp} style={{ minHeight: 44, padding: "0 var(--space-6)" }}>
            {COPY.birth.accept} →
          </button>
        </div>
      </div>
    );
  }

  return (
    <BirthChoreographer
      companyId={companyId}
      run={run}
      motionStage={motionStage ?? "fold"}
      onStage={onMotionStage}
      onDone={onDone}
    />
  );
}
