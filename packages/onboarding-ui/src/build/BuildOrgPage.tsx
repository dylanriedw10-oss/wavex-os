/** Build Your Organization — the five-phase, canvas-first flow.
 *
 *  Conversation left (35%), the LIVE canvas right — the same split as
 *  /canvas, because the two surfaces are reflections of each other. The
 *  right pane is the phase router: the company core at genesis, connector
 *  markers, the growing wheel + plan assembly, the review proposal, and
 *  the birth motion. The shell is viewport-locked (fit law, Rev 10) and
 *  mounts its OWN InstrumentHeight provider.
 *
 *  Phase-1 conversation orchestration lives HERE (one altitude for all
 *  effects); the phases/ components own only their right-pane rendering. */

import { useCallback, useEffect, useReducer, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import { wavexOsOnboardingApi, ApiError } from "../wavex-os/lib/api";
import { useCompany, slugifyCompanyId } from "../wavex-os/lib/CompanyContext";
import { InstrumentHeight, useMeasuredHeight } from "../canvas/layout";
import { Thread, type ThreadCallbacks } from "./Thread";
import { COPY } from "./copy";
import { formatKpiValue } from "./cards/StrategyCard";
import { deriveStage } from "./lib/stage-from-goal";
import { usePlanFeed } from "./orchestration/use-plan-feed";
import { birthStartFromRun } from "./orchestration/plan-feed";
import {
  buildReducer, initialBuildState, type BuildState,
} from "./state/build-reducer";
import { clearBuildSession, loadBuildSession, saveBuildSession } from "./state/persistence";
import { hydrateFromServer } from "./state/hydrate";
import { UnderstandYou } from "./phases/UnderstandYou";
import { Strategy } from "./phases/Strategy";
import { UnderstandReality } from "./phases/UnderstandReality";
import { BuildPlan } from "./phases/BuildPlan";
import { Review } from "./phases/Review";
import { Birth } from "./phases/Birth";
import { Pricing } from "../wavex-os/pricing/Pricing";

const REDUCE = typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;

/** URL-or-hostname heuristic → slug seed (ported from the legacy shell). */
function deriveSlug(rawInput: string): string {
  const trimmed = rawInput.trim();
  const urlMatch = trimmed.match(/(?:https?:\/\/)?([a-z0-9-]+(?:\.[a-z0-9-]+)+)/i);
  if (urlMatch) {
    const host = urlMatch[1].replace(/^www\./i, "");
    return slugifyCompanyId(host.split(".")[0] ?? host);
  }
  const words = trimmed.split(/\s+/).slice(0, 3).join(" ");
  return slugifyCompanyId(words || "company");
}

export default function BuildOrgPage() {
  const { companyId, setCompanyId } = useCompany();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [state, dispatch] = useReducer(
    buildReducer,
    null,
    (): BuildState => (companyId && loadBuildSession(companyId)) || initialBuildState(),
  );
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);

  // Persist the conversation record; the server stays the progress authority.
  useEffect(() => {
    if (companyId) saveBuildSession(companyId, state);
  }, [companyId, state]);

  /** Server-authority resume: correct the restored phase if the server has
   *  already moved past it. Once per company, before anything else runs. */
  const hydratedRef = useRef<string | null>(null);
  useEffect(() => {
    if (!companyId || hydratedRef.current === companyId) return;
    hydratedRef.current = companyId;
    void (async () => {
      const { phase, planRun } = await hydrateFromServer(companyId, state);
      if (planRun) dispatch({ type: "PLAN_RUN", run: planRun });
      if (phase) dispatch({ type: "SET_PHASE", phase });
    })();
    // Deliberately not keyed on `state`: this is a one-shot correction at
    // mount, and re-running it on every state change would fight the flow.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [companyId]);

  // The fit law: one measured instrument zone, published through context.
  const [instrumentRef, instrumentH] = useMeasuredHeight();

  /* ── Phase 1 orchestration ─────────────────────────────────────────── */

  const runPillar1 = useCallback(async (slug: string, rawInput: string, manualContext?: string) => {
    const thinkingId = `thinking-${Date.now().toString(36)}`;
    setBusy(true);
    dispatch({
      type: "ADD_MESSAGE",
      message: {
        id: thinkingId, role: "assistant",
        text: manualContext ? COPY.phase1.describing : COPY.phase1.reading,
        slot: { kind: "thinking", phase: "pillar-1" },
      },
    });
    try {
      const result = await wavexOsOnboardingApi.pillar1({
        companyId: slug, org_name: slug, raw_input: rawInput, manual_context: manualContext,
      });
      dispatch({ type: "REMOVE_MESSAGE", id: thinkingId });
      dispatch({ type: "PILLAR1_RESPONSE", response: result.response, rawInput, orgName: slug });
      // Said BEFORE the inference, because it changes how the inference
      // should be read: if the site was not reached, everything below came
      // from the operator's own words and nothing from the address they
      // pasted. `url_fetch` is absent when they typed prose — that is not a
      // failure and must stay silent.
      if (result.url_fetch && result.url_fetch.status !== "ok") {
        const line = COPY.phase1.urlNotRead[result.url_fetch.status];
        if (line) {
          dispatch({
            type: "ADD_MESSAGE",
            message: {
              role: "assistant",
              text: `${line(result.url_fetch.url)} ${COPY.phase1.urlNotReadTail}`,
            },
          });
        }
      }
      dispatch({
        type: "ADD_MESSAGE",
        message: { role: "assistant", text: COPY.phase1.inferred, slot: { kind: "pillar1-confirm", response: result.response } },
      });
      qc.invalidateQueries({ queryKey: ["status", slug] });
    } catch (e) {
      dispatch({ type: "REMOVE_MESSAGE", id: thinkingId });
      if (e instanceof ApiError && e.halt) {
        dispatch({
          type: "ADD_MESSAGE",
          message: { role: "assistant", text: e.halt.operator_message, slot: { kind: "pillar1-halt", operatorMessage: e.halt.operator_message } },
        });
      } else {
        dispatch({
          type: "ADD_MESSAGE",
          message: { role: "assistant", text: `That didn't go through: ${e instanceof Error ? e.message : String(e)}` },
        });
      }
    } finally {
      setBusy(false);
    }
  }, [qc]);

  /** Silent pillar-2 verify → straight to where the product stands.
   *
   *  The scope question used to sit here ("whole organization, or a focused
   *  team?") and it is gone: the plan's own checklist answers it, so asking
   *  first made the operator guess at a shape they were about to be shown.
   *  Department parking moved into the plan, where the departments exist. */
  const verifiedRef = useRef(false);
  useEffect(() => {
    if (state.phase.kind !== "understand_you" || state.phase.stage !== 2 || !state.phase.thinking) return;
    if (!companyId || verifiedRef.current) return;
    verifiedRef.current = true;
    void (async () => {
      try {
        const outcome = await wavexOsOnboardingApi.pillar2({ companyId, claude_plan: "max_20x" });
        if (outcome.ok) {
          dispatch({ type: "SET_THINKING", thinking: false });
          dispatch({
            type: "ADD_MESSAGE",
            message: { role: "assistant", text: COPY.phase1.p3, slot: { kind: "pillar3-prompt" } },
          });
        } else {
          const fixHint = (outcome as { fix_hint?: string }).fix_hint
            ?? "Claude CLI isn't responding. Check `claude --version` works in your terminal.";
          dispatch({ type: "ADD_MESSAGE", message: { role: "assistant", text: "I can't reach your Claude setup.", slot: { kind: "verify-fail", fixHint } } });
        }
      } catch (e) {
        dispatch({
          type: "ADD_MESSAGE",
          message: { role: "assistant", text: "Couldn't verify your Claude setup.", slot: { kind: "verify-fail", fixHint: e instanceof Error ? e.message : String(e) } },
        });
      }
    })();
  }, [state.phase, companyId, state.draft.pillar1?.rawInput]);

  /** Phase 2 entry: load-or-generate the connector manifest (disk read
   *  first — free; generation is deterministic by default). One retry on
   *  transient failure, then an honest error in the thread. */
  const connectorsRef = useRef(false);
  useEffect(() => {
    if (state.phase.kind !== "connectors" || !state.phase.loading) return;
    if (!companyId || connectorsRef.current) return;
    connectorsRef.current = true;
    void (async () => {
      dispatch({ type: "ADD_MESSAGE", message: { role: "assistant", text: COPY.connectors.intro } });
      for (let attempt = 0; attempt < 2; attempt++) {
        try {
          const loaded = await wavexOsOnboardingApi.loadConnector(companyId);
          const manifest = loaded.exists && loaded.manifest
            ? loaded.manifest
            : (await wavexOsOnboardingApi.generateConnector(companyId, true)).manifest;
          dispatch({ type: "CONNECTORS_MANIFEST", manifest });
          return;
        } catch (e) {
          if (attempt === 1) {
            dispatch({
              type: "ADD_MESSAGE",
              message: { role: "assistant", text: `Couldn't map your connectors: ${e instanceof Error ? e.message : String(e)}. Reload to retry.` },
            });
          } else {
            await new Promise((r) => setTimeout(r, 1500));
          }
        }
      }
    })();
  }, [state.phase, companyId]);

  /** Phase 3: research, then planning — one cancellable machine, in a hook.
   *  It replaced a block of pre-scheduled setTimeouts that nothing cleared. */
  usePlanFeed({ companyId, phase: state.phase, dispatch });

  /** Pillar 3, written ONCE — after Strategy, because its `stage` is the
   *  bracket the operator's own number falls in rather than a chip they
   *  clicked. A declined strategy still writes: the product state is a real
   *  answer, and `deriveStage` records that the revenue side was not stated
   *  instead of inventing a bracket for it.
   *
   *  A failure here is surfaced and non-blocking. The flow continues on the
   *  client's own copy of the product state, and plan assembly reads the
   *  file — so the honest outcome of a failed write is a plan built without
   *  the rung, which the operator can see in the thread. */
  async function savePillar3(goal: { kpiId: string; current: number } | null): Promise<void> {
    const productState = state.draft.productState;
    if (!companyId || !productState) return;
    const isCustom = state.draft.productStateCustom === true;
    const derived = deriveStage(isCustom ? "other" : productState, goal);
    try {
      const result = await wavexOsOnboardingApi.pillar3({
        companyId,
        product_state: (isCustom ? "other" : productState) as Parameters<typeof wavexOsOnboardingApi.pillar3>[0]["product_state"],
        product_state_other: isCustom ? productState : undefined,
        stage: derived.stage,
        stage_other: derived.stage_other,
      });
      dispatch({ type: "PILLAR3_SAVED", response: result.response });
    } catch (e) {
      dispatch({
        type: "ADD_MESSAGE",
        message: { role: "assistant", text: `Couldn't save where the product stands: ${e instanceof Error ? e.message : String(e)}. The plan will be built without it.` },
      });
    }
  }

  /* ── Thread callbacks (the slim bag) ───────────────────────────────── */

  const cb: ThreadCallbacks = {
    companyId,
    orgName: state.draft.pillar1?.orgName ?? companyId ?? "",
    rawInput: state.draft.pillar1?.rawInput ?? "",
    onPillar1Confirmed: () => dispatch({ type: "PILLAR1_CONFIRMED" }),
    onPillar1Recovered: (response) => {
      if (!companyId) return;
      dispatch({ type: "PILLAR1_RESPONSE", response, rawInput: state.draft.pillar1?.rawInput ?? "", orgName: companyId });
      dispatch({
        type: "ADD_MESSAGE",
        message: { role: "assistant", text: COPY.phase1.inferred, slot: { kind: "pillar1-confirm", response } },
      });
    },
    onStrategyAsk: (asking, draft) => dispatch({ type: "STRATEGY_ASK", asking, draft }),
    onStrategyDone: (summary) => {
      dispatch({ type: "STRATEGY_DONE", strategy: summary });
      void savePillar3({ kpiId: summary.kpiId, current: summary.current });
      dispatch({
        type: "ADD_MESSAGE",
        message: {
          role: "assistant",
          text: COPY.strategy.done(
            summary.label,
            formatKpiValue(summary.kpiId, summary.current),
            formatKpiValue(summary.kpiId, summary.target),
            summary.days,
          ),
        },
      });
      dispatch({ type: "ADD_MESSAGE", message: { role: "assistant", text: COPY.phase1.p4, slot: { kind: "pillar4-prompt" } } });
    },
    onStrategySkip: () => {
      // Nothing is posted. The band that stands in will label itself a
      // guess wherever it renders — that is the whole contract.
      dispatch({ type: "STRATEGY_DONE" });
      void savePillar3(null);
      dispatch({ type: "ADD_MESSAGE", message: { role: "assistant", text: COPY.strategy.skipped } });
      dispatch({ type: "ADD_MESSAGE", message: { role: "assistant", text: COPY.phase1.p4, slot: { kind: "pillar4-prompt" } } });
    },
    onPillar3Done: (productState, productStateCustom) => {
      dispatch({ type: "PILLAR3_DONE", productState, productStateCustom });
      dispatch({
        type: "ADD_MESSAGE",
        message: {
          role: "assistant", text: COPY.strategy.intro,
          slot: { kind: "strategy-prompt", hypothesis: state.draft.pillar1Response?.primary_friction_hypothesis ?? null },
        },
      });
    },
    onPillar4Done: (response) => {
      dispatch({ type: "PILLAR4_DONE", response });
      dispatch({ type: "ADD_MESSAGE", message: { role: "assistant", text: COPY.phase1.p5, slot: { kind: "pillar5-prompt" } } });
    },
    onPillar5Done: (response) => {
      dispatch({ type: "PILLAR5_DONE", response });
      dispatch({ type: "ADD_MESSAGE", message: { role: "assistant", text: COPY.phase1.done } });
    },
    onAdoptUrl: (url: string) => void adoptFromUrl(url),
  };

  /** Path B: paste URL → hardened read → adopted pillar-1 (or the honest
   *  fallback). The company slug derives from the URL when none exists. */
  async function adoptFromUrl(url: string): Promise<void> {
    const slug = companyId ?? deriveSlug(url);
    if (!companyId) setCompanyId(slug);
    setBusy(true);
    dispatch({ type: "ADD_MESSAGE", message: { role: "user", text: url } });
    const thinkingId = `adopt-${Date.now().toString(36)}`;
    dispatch({ type: "ADD_MESSAGE", message: { id: thinkingId, role: "assistant", text: COPY.adopt.reading(url), slot: { kind: "thinking", phase: "pillar-1" } } });
    try {
      const r = await wavexOsOnboardingApi.adoptProduct(slug, { url });
      dispatch({ type: "REMOVE_MESSAGE", id: thinkingId });
      if (r.adopted && r.fields) {
        const response = r.fields as never;
        dispatch({ type: "ADOPTED", url, response });
        dispatch({ type: "ADD_MESSAGE", message: { role: "assistant", text: COPY.adopt.ok, slot: { kind: "pillar1-confirm", response } } });
      } else {
        dispatch({ type: "ADD_MESSAGE", message: { role: "assistant", text: COPY.adopt.fallback[r.fetch.status] ?? COPY.adopt.fallback.ok } });
      }
    } catch (e) {
      dispatch({ type: "REMOVE_MESSAGE", id: thinkingId });
      dispatch({ type: "ADD_MESSAGE", message: { role: "assistant", text: `Couldn't read it: ${e instanceof Error ? e.message : String(e)}` } });
    } finally {
      setBusy(false);
    }
  }

  /** The ONE Confirm's execution — runs at PRICING_DONE: the canned
   *  utterance mints the approve-organization proposal (stub, body enriched
   *  from the signed manifest) and the commit pipeline runs activate +
   *  native seed + plan lock. */
  async function approveAndAdvance(): Promise<void> {
    if (!companyId || busy) return;
    setBusy(true);
    try {
      const composed = await wavexOsOnboardingApi.sendCanvasMessage(companyId, "approve the organization");
      const proposal = composed.proposal;
      if (!proposal) throw new Error(composed.turn.text || "no proposal was minted");
      await wavexOsOnboardingApi.commitCanvasProposal(companyId, proposal.id);

      // Where Birth starts is asked of the APPROVED PLAN, never of a stored
      // path. `work/seed.ts` filters the same array for the same `kind`, so
      // the two cannot disagree — which they could, and did.
      let run = state.planRun;
      if (!run) {
        // The client never guesses. If the run isn't mirrored yet, ask.
        run = await wavexOsOnboardingApi.getPlanAssembly(companyId).then((r) => r.run).catch(() => null);
      }
      dispatch({ type: "ADD_MESSAGE", message: { role: "assistant", text: COPY.birth.motion } });
      dispatch({ type: "PRICING_DONE", startAt: birthStartFromRun(run) });
    } catch (e) {
      dispatch({
        type: "ADD_MESSAGE",
        message: { role: "assistant", text: `Approval didn't go through: ${e instanceof Error ? e.message : String(e)}. Try again from Review.` },
      });
      // Back to Review with the commit guard released, so the operator can
      // actually retry rather than being stuck behind a latched button.
      dispatch({ type: "COMMIT_FAILED" });
    } finally {
      setBusy(false);
    }
  }

  /* ── Composer submit ───────────────────────────────────────────────── */

  async function submit(): Promise<void> {
    const text = draft.trim();
    if (!text || busy) return;
    setDraft("");
    dispatch({ type: "ADD_MESSAGE", message: { role: "user", text } });
    if (state.phase.kind === "understand_you" && state.phase.stage === 1 && !state.draft.pillar1Response) {
      const slug = companyId ?? deriveSlug(text);
      if (!companyId) setCompanyId(slug);
      await runPillar1(slug, text);
      return;
    }
    // Between structured cards, free text is acknowledged, not swallowed.
    dispatch({
      type: "ADD_MESSAGE",
      message: { role: "assistant", text: "Noted — the current card is the next step; answer there and we keep moving." },
    });
  }

  /* ── Render ────────────────────────────────────────────────────────── */

  // Review is a stage, not a kind — but the eyebrow names the ACT, and
  // "Building the plan" over a finished plan awaiting approval is wrong.
  const reviewing = state.phase.kind === "build_plan" && state.phase.stage === "review";
  const phaseKey = reviewing ? "build_plan_review" : state.phase.kind;
  const phaseLabel = COPY.phaseLabel[phaseKey] ?? "";
  const empty = state.thread.length === 0 && state.phase.kind === "understand_you" && state.phase.stage === 1;

  return (
    <InstrumentHeight.Provider value={instrumentH}>
      <div className="canvas-root" style={{ height: "100dvh", overflow: "hidden", display: "flex", flexDirection: "column" }}>
        <header className="cv-glass" style={{ display: "flex", alignItems: "baseline", gap: "var(--space-3)", padding: "var(--space-3) var(--space-6)", borderLeft: "none", borderRight: "none", borderTop: "none", borderRadius: 0 }}>
          <span style={{ fontWeight: 700, letterSpacing: "-.01em" }}>
            {COPY.wordmark} <span style={{ color: "var(--text-dim)", fontWeight: 500 }}>{COPY.productName}</span>
          </span>
          {companyId && <span className="text-dim" style={{ fontSize: "var(--text-xs)" }}>{companyId}</span>}
          <span className="text-dim" style={{ marginLeft: "auto", fontSize: "var(--text-xs)", textTransform: "uppercase", letterSpacing: ".1em" }}>
            {phaseLabel}
          </span>
        </header>

        <div style={{ flex: 1, display: "grid", gridTemplateColumns: "minmax(320px, 35%) 1fr", minHeight: 0 }} className="canvas-split">
          <Thread thread={state.thread} cb={cb}>
            {empty && (
              <div style={{ padding: "0 var(--space-4) var(--space-3)", textAlign: "center" }}>
                <div style={{ fontSize: "var(--text-xl)", fontWeight: 650, letterSpacing: "-0.01em" }}>{COPY.welcome.title}</div>
                <p className="text-dim" style={{ fontSize: "var(--text-sm)", maxWidth: "40ch", margin: "var(--space-2) auto 0" }}>
                  {COPY.welcome.sub}
                </p>
              </div>
            )}
            <form
              onSubmit={(e) => { e.preventDefault(); void submit(); }}
              style={{ display: "flex", gap: "var(--space-2)", padding: "var(--space-3) var(--space-4)", borderTop: "1px solid var(--border)" }}>
              <input
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                maxLength={2048}
                placeholder={empty ? COPY.welcome.placeholder : (COPY.composerPlaceholder[phaseKey] ?? "Ask…")}
                aria-label="Message"
                style={{ flex: 1 }}
              />
              <button type="submit" className="secondary" disabled={busy || !draft.trim()} aria-label="Send"
                style={{ minWidth: 44, minHeight: 44, background: "var(--panel)" }}>↑</button>
            </form>
          </Thread>

          {/* The canvas pane — instrument zone under the fit law. */}
          <section style={{ display: "flex", flexDirection: "column", padding: "var(--space-4) var(--space-6)", minHeight: 0, overflow: "hidden" }}>
            <div ref={instrumentRef} className="cv-instrument" style={{ flex: 1, minHeight: 0, overflow: "hidden" }}>
              {state.phase.kind === "understand_you" && (
                <UnderstandYou state={state} companyId={companyId} instrumentH={instrumentH}
                  onAdopt={() => dispatch({ type: "ADD_MESSAGE", message: { role: "assistant", text: COPY.adopt.prompt, slot: { kind: "adopt-url" } } })} />
              )}
              {state.phase.kind === "strategy" && (
                <Strategy
                  draft={{
                    kpiId: state.draft.strategy?.kpiId ?? null,
                    label: state.draft.strategy?.label ?? null,
                    current: state.draft.strategy?.current ?? null,
                    target: state.draft.strategy?.target ?? null,
                    days: state.draft.strategy?.days ?? null,
                  }}
                  asking={state.phase.asking}
                />
              )}
              {state.phase.kind === "connectors" && companyId && (
                <UnderstandReality
                  companyId={companyId}
                  loading={state.phase.loading}
                  condensed={state.connectorsCondensed}
                  onCondensed={() => {
                    dispatch({ type: "CONNECTORS_CONDENSED" });
                    dispatch({ type: "ADD_MESSAGE", message: { role: "assistant", text: COPY.plan.intro } });
                  }}
                />
              )}
              {state.phase.kind === "build_plan" && state.phase.stage !== "review" && companyId && (
                <BuildPlan
                  companyId={companyId} run={state.planRun}
                  stage={state.phase.stage} revealed={state.phase.revealed}
                  researchSettled={state.phase.researchSettled}
                />
              )}
              {/* The review BEAT — the plan's closing act, not a phase of its
                  own. Same phase, same run, one card and one Confirm. */}
              {state.phase.kind === "build_plan" && state.phase.stage === "review" && companyId && (
                <Review
                  companyId={companyId}
                  run={state.planRun}
                  finalizing={state.phase.review.finalizing}
                  ready={state.phase.review.manifestSha256 !== null}
                  committing={state.phase.review.committing}
                  onFinalizing={() => dispatch({ type: "REVIEW_FINALIZING" })}
                  onReady={(sha) => dispatch({ type: "REVIEW_READY", manifestSha256: sha })}
                  onError={(m) => dispatch({ type: "ADD_MESSAGE", message: { role: "assistant", text: `Couldn't assemble the organization: ${m}. Reload to retry.` } })}
                  onConfirm={() => {
                    // Latch first, then advance — the latch is what makes a
                    // second click a no-op rather than a second commit.
                    dispatch({ type: "REVIEW_CONFIRMED" });
                    dispatch({ type: "REVIEW_TO_PRICING" });
                  }}
                />
              )}
              {/* Pricing is a PHASE, rendered in the instrument zone like
                  every other one — not an overlay over the shell. Continuing
                  (subscribe OR skip) fires the real commit, and a billing
                  failure no longer blocks it. */}
              {state.phase.kind === "pricing" && companyId && (
                <Pricing companyId={companyId} dialogMode onContinue={() => void approveAndAdvance()} />
              )}
              {state.phase.kind === "birth" && companyId && (
                <Birth
                  companyId={companyId}
                  run={state.planRun}
                  stage={state.phase.stage}
                  motionStage={state.phase.motionStage}
                  onAcceptMvp={() => dispatch({ type: "MVP_ACCEPTED" })}
                  onMotionStage={(s) => dispatch({ type: "MOTION_STAGE", stage: s })}
                  onDone={() => {
                    dispatch({ type: "BORN" });
                    clearBuildSession(companyId);
                    // Land on the real canvas — the same wheel geometry,
                    // now backed by the live organization.
                    navigate(`/canvas?companyId=${encodeURIComponent(companyId)}`);
                  }}
                />
              )}
              {state.phase.kind === "born" && (
                <div style={{ height: "100%", display: "grid", placeItems: "center" }}>
                  <span className="text-dim" style={{ fontSize: "var(--text-sm)" }}>alive — opening the canvas…</span>
                </div>
              )}
            </div>
          </section>
        </div>

      </div>
    </InstrumentHeight.Provider>
  );
}
