/** Phase 3's orchestration — the two-act pacer.
 *
 *  Lives in a hook rather than in BuildOrgPage because it is a cancellable
 *  state machine with a poll loop, a drain queue, and an act break. The page
 *  owns conversation effects at one altitude; this is a different altitude
 *  and a different lifetime, and inlining it would bury the cancellation.
 *
 *  ── The pacing problem this exists to solve ─────────────────────────────
 *
 *  Act one is genuinely async: a real model call taking 60–150 seconds, with
 *  findings appearing as the server writes them. Act two is instant and
 *  deterministic. The old approach — pre-schedule N setTimeouts at a flat
 *  700ms — cannot express "waiting on the server" at all, and it leaked:
 *  nothing cleared those handles, so unmounting mid-phase kept dispatching
 *  into a dead reducer (and double-scheduled under StrictMode/HMR).
 *
 *  So: POLL for truth, DRAIN for pace. The poll reflects what the server
 *  actually has; the drain releases at most one unit per tick, so a burst of
 *  four findings still lands one at a time — but the drain can only ever run
 *  BEHIND reality, never ahead of it. Nothing is ever shown that does not
 *  exist yet.
 *
 *  Every handle goes into a ref and is cleared on unmount or company change. */

import { useEffect } from "react";
import { wavexOsOnboardingApi } from "../../wavex-os/lib/api";
import type { AssemblyRunState } from "../../canvas/plan-contract";
import type { BuildAction, BuildPhase } from "../state/build-reducer";
import { deriveUnits, researchUnits } from "./plan-feed";
import { COPY } from "../copy";

const REDUCE = typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;

const RESEARCH_ROW_MS = 450;   // one finding lands
const PLAN_STEP_MS = 700;      // one plan piece lands (unchanged)
const ACT_BREAK_MS = 800;      // the beat between the two acts
const SETTLE_MS = 900;         // before handing the pane to Review
const POLL_MS = 800;
/** ~2 minutes. The server's own research timeout is 150s; past that the run
 *  has settled one way or another and the poll is only confirming it. */
const POLL_CAP = 150;

const ms = (n: number) => (REDUCE ? 0 : n);

export function usePlanFeed(args: {
  companyId: string | null;
  phase: BuildPhase;
  dispatch: (a: BuildAction) => void;
}): void {
  const { companyId, phase, dispatch } = args;

  useEffect(() => {
    // The review BEAT is a stage of `build_plan`, so "kind is build_plan" is
    // no longer the same question as "the plan still needs feeding". A
    // session RESUMED at review re-enters this effect with the plan already
    // built; without this guard the feed restarts, dispatches PLAN_STAGE
    // back to "planning", and drags the operator out of the review they were
    // returning to.
    //
    // Reading `phase.stage` here is reading the stage the phase was ENTERED
    // at — the dep array is keyed on `phase.kind`, so this effect does not
    // re-run when the feed advances its own stage. That is what makes the
    // check a gate on entry rather than an abort mid-run.
    if (phase.kind !== "build_plan" || phase.stage === "review" || !companyId) return;

    // Cancellation is PER INVOCATION, and there is deliberately no
    // "already started" ref guarding across invocations.
    //
    // A cross-invocation latch looks right and is a trap: React 18 StrictMode
    // mounts, unmounts, and remounts every effect in development. The cleanup
    // flips the latch's cancel flag, and the remount then hits the latch and
    // returns early — so the first run is dead, the second never starts, and
    // Phase 3 hangs forever on "reading the connectors…". The same thing
    // happens on any legitimate remount.
    //
    // Idempotency belongs on the server instead, where it already is: `POST
    // start` returns the existing run rather than beginning a second one. A
    // duplicate invocation therefore costs one HTTP round trip and converges
    // on the same state.
    let cancelled = false;
    const timers: number[] = [];

    const sleep = (n: number) => new Promise<void>((r) => {
      if (n <= 0) { r(); return; }
      timers.push(window.setTimeout(r, n));
    });
    const alive = () => !cancelled;

    void (async () => {
      let run: AssemblyRunState;
      try {
        ({ run } = await wavexOsOnboardingApi.startPlanAssembly(companyId, { skipInference: true }));
      } catch (e) {
        if (!alive()) return;
        dispatch({ type: "ADD_MESSAGE", message: { role: "assistant", text: `Couldn't build the plan: ${e instanceof Error ? e.message : String(e)}. Reload to retry.` } });
        return;
      }
      if (!alive()) return;
      dispatch({ type: "PLAN_RUN", run });

      /* ---- act one: research ---- */
      // A server without research returns a settled run immediately; the act
      // is then empty and we go straight to planning. Backward compatible by
      // construction — nothing here requires the research step to exist.
      let drained = 0;
      if (run.status === "researching") {
        for (let i = 0; i < POLL_CAP && alive(); i++) {
          await sleep(POLL_MS);
          if (!alive()) return;
          let latest: AssemblyRunState | null = null;
          try {
            const got = await wavexOsOnboardingApi.getPlanAssembly(companyId);
            latest = got.run;
          } catch { /* a dropped poll is not an error; the next one covers it */ }
          if (!alive()) return;
          if (latest) {
            run = latest;
            dispatch({ type: "PLAN_RUN", run });
            // Drain toward what the server actually has, one row per tick.
            const found = researchUnits(deriveUnits(run)).length;
            while (drained < found && alive()) {
              dispatch({ type: "PLAN_REVEAL_NEXT", ceiling: found });
              drained++;
              await sleep(RESEARCH_ROW_MS);
            }
          }
          if (run.status !== "researching") break;
        }
      }
      if (!alive()) return;

      // The act break — one honest sentence about what research produced.
      const research = run.steps.find((s) => s.id === "research");
      const found = researchUnits(deriveUnits(run));
      const findings = found.length;
      // What research produced and what the plan took are different numbers.
      const used = found.filter((u) => u.finding?.applied).length;
      const line =
        !research ? null
          : research.status === "ready" && findings > 0 ? COPY.plan.research.settled(findings, used)
          : research.status === "ready" ? COPY.plan.research.none
          : COPY.plan.research.unavailable;
      if (line) dispatch({ type: "ADD_MESSAGE", message: { role: "assistant", text: line } });
      dispatch({ type: "RESEARCH_SETTLED" });
      await sleep(ACT_BREAK_MS);
      if (!alive()) return;

      /* ---- act two: the plan ---- */
      dispatch({ type: "PLAN_STAGE", stage: "planning" });
      const units = deriveUnits(run);
      for (let i = drained; i < units.length && alive(); i++) {
        dispatch({ type: "PLAN_REVEAL_NEXT", ceiling: units.length });
        await sleep(PLAN_STEP_MS);
      }
      await sleep(SETTLE_MS);
      if (!alive()) return;
      dispatch({ type: "ADD_MESSAGE", message: { role: "assistant", text: COPY.plan.settled } });
      dispatch({ type: "PLAN_DONE" });
    })();

    return () => {
      cancelled = true;
      for (const t of timers) window.clearTimeout(t);
    };
    // Intentionally keyed on the phase KIND, not the whole phase object: the
    // machine drives `revealed`, so depending on it would restart the effect
    // on every tick it causes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [companyId, phase.kind, dispatch]);
}
