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

import { useEffect, useRef, useState } from "react";
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

/** What the poll actually established. `silent` covers both ways of learning
 *  nothing — the cap ran out while the status stayed `not_activated`, and
 *  every attempt threw — because they are the same fact to an operator. */
type RuntimeOutcome = "ignited" | "incomplete" | "silent";

export function BirthChoreographer({ companyId, run, motionStage, onStage, onDone }: {
  companyId: string;
  run: AssemblyRunState | null;
  motionStage: MotionStage;
  onStage: (s: MotionStage) => void;
  onDone: () => void;
}) {
  // The poll's RESULT, which used to be discarded. Local rather than in the
  // reducer: it is a fact about this one motion, and persisting it would mean
  // a resumed session could replay a stale verdict about a runtime that has
  // since come up.
  const [outcome, setOutcome] = useState<RuntimeOutcome | null>(null);

  // THE one sequence. A ref latch keeps StrictMode/HMR from double-running.
  const startedRef = useRef(false);
  const liveRef = useRef(true);
  useEffect(() => {
    liveRef.current = true;
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

      // Poll ignition — activation already committed, so this normally
      // settles in one or two ticks; the cap keeps a wedged server from
      // trapping the operator in the motion.
      //
      // The break condition used to be `status !== "not_activated"`, which
      // treats `deferred` and `partial` — states that mean the runtime
      // answered and told us it had NOT fully started — as a reason to call
      // the organization alive. And `onStage("done")` sat outside the loop
      // entirely, so exhausting the cap or throwing on all 20 attempts also
      // ended in "alive". Every path through here produced the same word.
      let settled: RuntimeOutcome = "silent";
      for (let i = 0; i < 20; i++) {
        try {
          const s = await wavexOsOnboardingApi.getIgnitionStatus(companyId);
          if (s.status === "ignited") { settled = "ignited"; break; }
          if (s.status === "deferred" || s.status === "partial") { settled = "incomplete"; break; }
          // `not_activated` — the write may not have landed yet. Keep going.
        } catch { /* a dropped poll is not an answer; the next one covers it */ }
        await new Promise((r) => setTimeout(r, 600));
      }
      if (!liveRef.current) return;
      setOutcome(settled);

      // Only a CONFIRMED ignition ends the flow on its own. The other two
      // stop here and hand the operator the choice, because an automatic
      // landing is precisely what made the failure indistinguishable from
      // the success.
      if (settled === "ignited") {
        onStage("done");
        await dwell(400);
        if (liveRef.current) onDone();
      }
    })();
    return () => { liveRef.current = false; };
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
              {/* The caption is now downstream of the outcome, so the three
                  endings read as three endings. `outcome === null` at the
                  runtime stage is the genuine in-flight case. */}
              {motionStage === "done"
                ? COPY.birth.runtime.alive
                : outcome === "incomplete"
                  ? COPY.birth.runtime.incomplete
                  : outcome === "silent"
                    ? COPY.birth.runtime.silent
                    : motionStage === "runtime"
                      ? COPY.birth.runtime.polling
                      : motionStage === "fold"
                        ? COPY.birth.motion
                        : COPY.birth.workflows}
            </span>
          }
          emptyNote={null}
        />
      </div>
      {/* The live pulse belongs to the WAIT, not to the stage. It used to key
          off `motionStage === "runtime"`, which is still true after the poll
          has given up — so a runtime that never answered kept a --live dot
          breathing over it. */}
      {motionStage === "runtime" && outcome === null && (
        <span aria-hidden className={REDUCE ? undefined : "cv-breathe"}
          style={{ width: 8, height: 8, borderRadius: "50%", background: "var(--live)" }} />
      )}

      {/* The two endings that are not "alive". Same shape, different fact:
          say what happened, say plainly that the plan and the organization
          survived it, and offer the canvas rather than performing it. */}
      {(outcome === "incomplete" || outcome === "silent") && (
        <div role="status" style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: "var(--space-3)", maxWidth: "52ch", textAlign: "center" }}>
          <p className="text-dim" style={{ fontSize: "var(--text-sm)", margin: 0, lineHeight: 1.5 }}>
            {outcome === "incomplete" ? COPY.birth.runtime.incompleteBody : COPY.birth.runtime.silentBody}
          </p>
          <button onClick={onDone} style={{ minHeight: 44, padding: "0 var(--space-6)" }}>
            {COPY.birth.runtime.continue}
          </button>
        </div>
      )}
    </div>
  );
}
