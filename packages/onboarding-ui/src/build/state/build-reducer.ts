/** State for Build Your Organization — the canvas-first flow.
 *
 *  A data-bearing phase machine like the legacy onboarding reducer, cut to
 *  the shape the spec needs (~/Downloads/onboarding-spec-3.md translation;
 *  the audit behind it is docs/onboarding-review-output.md):
 *
 *    understand_you → strategy → connectors → build_plan → pricing
 *    → birth → born
 *
 *  What is deliberately NOT here:
 *    - connector marker status — derived live from the credentials poll
 *      (vault truth must not be mirrored into client state). Only the
 *      irreversible `connectorsCondensed` bit is ours.
 *    - the plan buckets — Review derives everything from the plan-assembly
 *      run; duplicating it here would be a second source of truth.
 *    - the avatar branch — removed (operator decision). */

import type {
  ConnectorManifest, Pillar1Response, Pillar3Response, Pillar4Response, Pillar5Response,
} from "@wavex-os/plugin-onboarding";
import type { AssemblyRunState } from "../../canvas/plan-contract";

/* ── Thread (ported mechanics, shrunk slot union) ─────────────────────── */

export type ChatRole = "user" | "assistant" | "system";

export type BuildSlot =
  | { kind: "thinking"; phase: "pillar-1" | "phase-2" | "finalize" }
  | { kind: "pillar1-confirm"; response: Pillar1Response }
  | { kind: "pillar1-halt"; operatorMessage: string }
  | { kind: "strategy-prompt"; hypothesis: string | null }
  | { kind: "pillar3-prompt" }
  | { kind: "pillar4-prompt" }
  | { kind: "pillar5-prompt" }
  | { kind: "adopt-url" }
  | { kind: "verify-fail"; fixHint: string }
  | { kind: "transition-pill"; label: string };

export interface ChatMessage {
  id: string;
  role: ChatRole;
  text?: string;
  slot?: BuildSlot;
  ts: number;
  collapsed?: boolean;
}

/* ── The phase machine ────────────────────────────────────────────────── */

export type MotionStage = "fold" | "petals" | "complete" | "runtime" | "done";

/** Build the Plan's three beats. `review` is the CLOSING BEAT of building
 *  the plan, not a phase of its own — one card and one Confirm never
 *  justified a phase, and folding it here is what keeps the spec's union at
 *  five members. */
export type PlanStageKind = "research" | "planning" | "review";

export type BuildPhase =
  | { kind: "understand_you"; stage: 1 | 2 | 3; thinking: boolean }
  /** The one stage that captures INTENT. Nothing here is inferable: the
   *  goal, its baseline, the target, and the operator's own bottleneck are
   *  the only source of the self-prompting loop's fixed half. */
  | { kind: "strategy"; asking: "kpi" | "current" | "target" | "bottleneck" }
  /** Understand Reality: what already exists, plus the two facts that
   *  decide WHICH systems the plan expects — asking them one phase away
   *  from their consequence made the consequence look arbitrary. */
  | { kind: "connectors"; stage: "how_you_sell" | "reporting" | "wiring"; loading: boolean }
  | {
      kind: "build_plan";
      stage: PlanStageKind;
      revealed: number;
      researchSettled: boolean;
      /** Populated only once the stage reaches `review`. */
      review: { manifestSha256: string | null; finalizing: boolean; committing: boolean };
    }
  | { kind: "pricing" }
  | { kind: "birth"; stage: "mvp" | "motion"; motionStage: MotionStage | null }
  | { kind: "born" };

export interface BuildState {
  phase: BuildPhase;
  thread: ChatMessage[];
  adoptedProductUrl: string | null;
  /** Sticky forever — the condensed connector indicator never re-expands. */
  connectorsCondensed: boolean;
  /** The plan-assembly run, mirrored from the server (replayable). */
  planRun: AssemblyRunState | null;
  draft: {
    pillar1?: { rawInput: string; orgName: string };
    pillar1Response?: Pillar1Response;
    /** The operator's product-state chip, available before the pillar-3
     *  write happens — `lib/placement.ts` decides the rung from it, so the
     *  client can show the right thing without waiting on the round trip. */
    productState?: string;
    productStateCustom?: boolean;
    pillar3Response?: Pillar3Response;
    pillar4Response?: Pillar4Response;
    pillar5Response?: Pillar5Response;
    /** The operator's STATED goal, mirrored client-side so the canvas can
     *  render it assembling. The server copy in `strategy.json` is
     *  authoritative; this is presentation only, and its absence means
     *  "not answered" — never "assume revenue". */
    strategy?: {
      kpiId?: string; label?: string;
      current?: number | null; target?: number | null; days?: number | null;
    };
    connectorManifest?: ConnectorManifest;
  };
}

export function initialBuildState(): BuildState {
  return {
    phase: { kind: "understand_you", stage: 1, thinking: false },
    thread: [],
    adoptedProductUrl: null,
    connectorsCondensed: false,
    planRun: null,
    draft: {},
  };
}

/* ── Actions ──────────────────────────────────────────────────────────── */

let seq = 0;
export function newMsgId(): string {
  seq += 1;
  return `m-${Date.now().toString(36)}-${seq}`;
}

export type BuildAction =
  | { type: "ADD_MESSAGE"; message: Omit<ChatMessage, "id" | "ts"> & { id?: string } }
  | { type: "COLLAPSE_MESSAGE"; id: string }
  | { type: "REMOVE_MESSAGE"; id: string }
  | { type: "SET_THINKING"; thinking: boolean }
  | { type: "PILLAR1_RESPONSE"; response: Pillar1Response; rawInput: string; orgName: string }
  | { type: "PILLAR1_CONFIRMED" }
  | { type: "ADOPTED"; url: string; response: Pillar1Response }
  /** Where the product stands. Held, not written — pillar 3 is POSTed once
   *  Strategy has supplied the number its bracket derives from. */
  | { type: "PILLAR3_DONE"; productState: string; productStateCustom: boolean }
  /** The deferred write landed. */
  | { type: "PILLAR3_SAVED"; response: Pillar3Response }
  | { type: "PILLAR4_DONE"; response: Pillar4Response }
  | { type: "PILLAR5_DONE"; response: Pillar5Response }
  | { type: "CONNECTORS_MANIFEST"; manifest: ConnectorManifest }
  | { type: "CONNECTORS_CONDENSED" }
  | { type: "PLAN_RUN"; run: AssemblyRunState }
  | { type: "PLAN_REVEAL"; revealed: number }
  /** Reducer-side increment: immune to stale closures, and the reducer owns
   *  the per-stage ceiling so a drain tick can never run past reality. */
  | { type: "PLAN_REVEAL_NEXT"; ceiling: number }
  | { type: "PLAN_STAGE"; stage: PlanStageKind }
  /** A beat advanced, carrying whatever has been answered so far. The
   *  partial exists because the canvas renders the goal ASSEMBLING — a
   *  draft that only lands at submit would leave the pane empty for the
   *  whole phase and full for none of it. */
  | { type: "STRATEGY_ASK"; asking: "kpi" | "current" | "target" | "bottleneck"; draft?: StrategyDraftPatch }
  | { type: "STRATEGY_DONE"; strategy?: { kpiId: string; label: string; current: number; target: number; days: number } }
  | { type: "RESEARCH_SETTLED" }
  | { type: "PLAN_DONE" }
  | { type: "REVIEW_FINALIZING" }
  | { type: "REVIEW_READY"; manifestSha256: string }
  | { type: "REVIEW_CONFIRMED" }
  | { type: "REVIEW_TO_PRICING" }
  | { type: "COMMIT_FAILED" }
  | { type: "PRICING_DONE"; startAt: "mvp" | "motion" }
  | { type: "MVP_ACCEPTED" }
  | { type: "MOTION_STAGE"; stage: MotionStage }
  | { type: "BORN" }
  | { type: "HYDRATE"; state: BuildState }
  /** Server-authority resume: the server proved the flow is further along
   *  than the restored session thought. */
  | { type: "SET_PHASE"; phase: BuildPhase };

/** Every field is optional: the canvas must render exactly what has been
 *  said and nothing more, and a partially-answered goal is the normal state
 *  for most of this phase. */
export interface StrategyDraftPatch {
  kpiId?: string; label?: string; current?: number | null; target?: number | null; days?: number | null;
}

const EMPTY_REVIEW = { manifestSha256: null, finalizing: false, committing: false } as const;

/** Narrowing helper — the review beat is a STAGE now, so every guard that
 *  used to be `kind === "review"` is two conditions. */
function inReview(state: BuildState): state is BuildState & { phase: Extract<BuildPhase, { kind: "build_plan" }> } {
  return state.phase.kind === "build_plan" && state.phase.stage === "review";
}

/* ── Reducer ──────────────────────────────────────────────────────────── */

export function buildReducer(state: BuildState, action: BuildAction): BuildState {
  switch (action.type) {
    case "ADD_MESSAGE":
      return {
        ...state,
        thread: [...state.thread, { ...action.message, id: action.message.id ?? newMsgId(), ts: Date.now() }],
      };
    case "COLLAPSE_MESSAGE":
      return { ...state, thread: state.thread.map((m) => (m.id === action.id ? { ...m, collapsed: true } : m)) };
    case "REMOVE_MESSAGE":
      return { ...state, thread: state.thread.filter((m) => m.id !== action.id) };

    case "SET_THINKING":
      return state.phase.kind === "understand_you"
        ? { ...state, phase: { ...state.phase, thinking: action.thinking } }
        : state;

    case "PILLAR1_RESPONSE":
      return {
        ...state,
        draft: { ...state.draft, pillar1Response: action.response, pillar1: { rawInput: action.rawInput, orgName: action.orgName } },
      };
    case "PILLAR1_CONFIRMED":
      return {
        ...state,
        phase: { kind: "understand_you", stage: 2, thinking: true },
      };
    case "ADOPTED":
      return {
        ...state,
        adoptedProductUrl: action.url,
        draft: { ...state.draft, pillar1Response: action.response, pillar1: { rawInput: action.url, orgName: action.response.org_name } },
      };

    case "PILLAR3_DONE":
      // Where the product stands is the last thing the interview needs; the
      // revenue BRACKET that used to follow it is gone, because Strategy now
      // asks for the actual number and the bracket derives from that.
      return {
        ...state,
        draft: { ...state.draft, productState: action.productState, productStateCustom: action.productStateCustom },
        phase: { kind: "strategy", asking: "kpi" },
      };
    case "PILLAR3_SAVED":
      return { ...state, draft: { ...state.draft, pillar3Response: action.response } };

    case "STRATEGY_ASK":
      return state.phase.kind === "strategy"
        ? {
            ...state,
            draft: action.draft
              ? { ...state.draft, strategy: { ...state.draft.strategy, ...action.draft } }
              : state.draft,
            phase: { kind: "strategy", asking: action.asking },
          }
        : state;
    case "STRATEGY_DONE":
      // No `strategy` on the action is a DECLINE, and it must leave the
      // draft empty rather than write a zero — absent is what makes the
      // server's fallback mark itself `stated: false`.
      return {
        ...state,
        draft: action.strategy ? { ...state.draft, strategy: action.strategy } : state.draft,
        phase: { kind: "connectors", stage: "how_you_sell", loading: false },
      };

    case "PILLAR4_DONE":
      return {
        ...state,
        draft: { ...state.draft, pillar4Response: action.response },
        phase: { kind: "connectors", stage: "reporting", loading: false },
      };
    case "PILLAR5_DONE":
      return {
        ...state,
        draft: { ...state.draft, pillar5Response: action.response },
        phase: { kind: "connectors", stage: "wiring", loading: true },
      };

    case "CONNECTORS_MANIFEST":
      return {
        ...state,
        draft: { ...state.draft, connectorManifest: action.manifest },
        phase: state.phase.kind === "connectors" ? { ...state.phase, stage: "wiring", loading: false } : state.phase,
      };
    case "CONNECTORS_CONDENSED":
      // The one irreversible client bit — and the phase advance in one act.
      return {
        ...state,
        connectorsCondensed: true,
        phase: { kind: "build_plan", stage: "research", revealed: 0, researchSettled: false, review: EMPTY_REVIEW },
      };

    case "PLAN_RUN":
      return { ...state, planRun: action.run };
    case "PLAN_REVEAL":
      return state.phase.kind === "build_plan"
        ? { ...state, phase: { ...state.phase, revealed: action.revealed } }
        : state;
    case "PLAN_REVEAL_NEXT": {
      if (state.phase.kind !== "build_plan") return state;
      const next = Math.min(state.phase.revealed + 1, action.ceiling);
      return next === state.phase.revealed ? state : { ...state, phase: { ...state.phase, revealed: next } };
    }
    case "PLAN_STAGE":
      return state.phase.kind === "build_plan"
        ? { ...state, phase: { ...state.phase, stage: action.stage } }
        : state;
    case "RESEARCH_SETTLED":
      return state.phase.kind === "build_plan"
        ? { ...state, phase: { ...state.phase, researchSettled: true } }
        : state;
    case "PLAN_DONE":
      // Not a new phase — the plan's closing beat.
      return state.phase.kind === "build_plan"
        ? { ...state, phase: { ...state.phase, stage: "review" } }
        : state;

    case "REVIEW_FINALIZING":
      return inReview(state)
        ? { ...state, phase: { ...state.phase, review: { ...state.phase.review, finalizing: true } } }
        : state;
    case "REVIEW_READY":
      return inReview(state)
        ? { ...state, phase: { ...state.phase, review: { ...state.phase.review, manifestSha256: action.manifestSha256, finalizing: false } } }
        : state;
    case "REVIEW_CONFIRMED":
      // `committing` is the double-commit guard. Pricing used to provide it
      // accidentally, by being a phase you could not click Confirm behind.
      return inReview(state)
        ? { ...state, phase: { ...state.phase, review: { ...state.phase.review, committing: true } } }
        : state;
    case "REVIEW_TO_PRICING":
      return { ...state, phase: { kind: "pricing" } };
    case "COMMIT_FAILED":
      // Back to the review beat, un-stuck: the operator must be able to try
      // again. Revealed stays where it was — the plan is already built.
      return {
        ...state,
        phase: {
          kind: "build_plan", stage: "review",
          revealed: state.phase.kind === "build_plan" ? state.phase.revealed : 0,
          researchSettled: true, review: EMPTY_REVIEW,
        },
      };

    case "PRICING_DONE":
      // The caller resolves this from the APPROVED PLAN's checklist, not from
      // a stored path — see birthStartFromRun. Two consumers now ask the same
      // array the same question, so the plan and Birth cannot disagree.
      return {
        ...state,
        phase: action.startAt === "mvp"
          ? { kind: "birth", stage: "mvp", motionStage: null }
          : { kind: "birth", stage: "motion", motionStage: "fold" },
      };
    case "MVP_ACCEPTED":
      return { ...state, phase: { kind: "birth", stage: "motion", motionStage: "fold" } };
    case "MOTION_STAGE":
      return state.phase.kind === "birth"
        ? { ...state, phase: { ...state.phase, stage: "motion", motionStage: action.stage } }
        : state;
    case "BORN":
      return { ...state, phase: { kind: "born" } };

    case "HYDRATE":
      return action.state;
    case "SET_PHASE":
      return { ...state, phase: action.phase };

    default:
      return state;
  }
}
