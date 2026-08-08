/** localStorage persistence for Build Your Organization.
 *
 *  Key: `wavex-os-build-v2:<companyId>`. Stores the conversation record and
 *  the client-owned facts; the SERVER stays the authority on progress —
 *  resume recomputes the phase from disk artifacts, the stored phase is only
 *  the starting guess.
 *
 *  Thinking bubbles are stripped on save (an in-flight spinner restored hours
 *  later would be a lie). planRun is persisted as-is — it is itself a replay
 *  log the server can re-serve.
 *
 *  ── Two things this file now does that it did not ───────────────────────
 *
 *  1. VALIDATES THE PHASE KIND. It used to check only that `phase.kind` was
 *     truthy. Every render branch in BuildOrgPage is an equality check, so an
 *     unrecognized kind rendered NOTHING — a silent blank instrument zone,
 *     not a crash, with no way for the operator to recover. That was already
 *     a bug for any corrupted or forward-version blob; the v2 renames made it
 *     reachable by ordinary means.
 *
 *  2. MIGRATES v1. `understand_reality` became `connectors`, `path` was
 *     deleted, and `build_plan` gained a stage. A v1 session that skipped
 *     migration would hit (1) and blank.
 */

import type { BuildPhase, BuildState, ChatMessage } from "./build-reducer";
import { initialBuildState } from "./build-reducer";

const KEY_PREFIX = "wavex-os-build-v3:";
/** Every prior key, newest first. Migration walks them in order, so a v1
 *  session that never opened during v2 still lands correctly. */
const LEGACY_PREFIXES = ["wavex-os-build-v2:", "wavex-os-build-v1:"] as const;

const key = (companyId: string) => `${KEY_PREFIX}${companyId}`;


/** The closed set. Anything outside it is unreadable by definition, because
 *  no render branch will match it. */
const PHASE_KINDS = new Set<string>([
  "understand_you", "strategy", "connectors", "build_plan", "pricing", "birth", "born",
]);

function stripInflight(thread: ChatMessage[]): ChatMessage[] {
  return thread.filter((m) => m.slot?.kind !== "thinking");
}

export function saveBuildSession(companyId: string, state: BuildState): void {
  try {
    const toStore: BuildState = { ...state, thread: stripInflight(state.thread) };
    localStorage.setItem(key(companyId), JSON.stringify(toStore));
  } catch { /* storage full/blocked — persistence is best-effort */ }
}

/** Forward-migrate any prior session shape.
 *
 *  Returning null discards the session, and discarding is the failure mode
 *  this file exists to prevent — an unrecognised phase kind renders NOTHING
 *  (every branch is an equality check), so an operator mid-build would find
 *  a blank pane with no way back. Every kind that ever existed is therefore
 *  mapped forward explicitly.
 *
 *  v1 → understand_reality became `connectors`.
 *  v2 → `review` became a STAGE of `build_plan`; `strategy` was inserted
 *       before `connectors`. A v2 session sitting anywhere before the plan
 *       has not answered Strategy, so it re-enters there — the alternative
 *       is a plan built on a goal nobody stated, which is the whole reason
 *       Strategy exists. */
function migrateLegacy(parsed: unknown): BuildState | null {
  if (!parsed || typeof parsed !== "object") return null;
  const old = parsed as Record<string, unknown> & { phase?: { kind?: string; loading?: unknown } };
  const kind = old.phase?.kind;
  if (typeof kind !== "string") return null;

  let phase: BuildPhase | null = null;
  if (kind === "understand_reality" || kind === "connectors") {
    // Connectors now opens on the two questions that decide the matrix, so
    // a resumed session re-enters at the top of the phase rather than at a
    // constellation whose inputs it never gave.
    phase = { kind: "connectors", stage: "how_you_sell", loading: false };
  } else if (kind === "understand_you") {
    phase = old.phase as unknown as BuildPhase;
  } else if (kind === "build_plan") {
    // Reset the reveal rather than restoring a position. The pacer is
    // idempotent and cancellable and `POST start` returns the existing run,
    // so replaying a few seconds beats landing mid-list in the wrong act.
    phase = {
      kind: "build_plan", stage: "research", revealed: 0, researchSettled: false,
      review: { manifestSha256: null, finalizing: false, committing: false },
    };
  } else if (kind === "pricing" || kind === "review") {
    // `pricing` goes BACK to Review, deliberately. Never auto-advance a
    // resumed session past an approval gate — the ONE Confirm is a human act,
    // and a v1 session sat in `pricing` precisely because it had not been
    // made yet.
    phase = {
    kind: "build_plan", stage: "review", revealed: 0, researchSettled: true,
    review: { manifestSha256: null, finalizing: false, committing: false },
  };
  } else if (PHASE_KINDS.has(kind)) {
    phase = old.phase as unknown as BuildPhase;
  }
  if (!phase) return null;

  // `path` is gone entirely — the checklist answers that question now.
  const { path: _legacyPath, phase: _oldPhase, ...rest } = old;
  return { ...initialBuildState(), ...(rest as Partial<BuildState>), phase };
}

export function loadBuildSession(companyId: string): BuildState | null {
  try {
    const raw = localStorage.getItem(key(companyId));
    if (raw) {
      const parsed = JSON.parse(raw) as BuildState;
      if (!parsed || typeof parsed !== "object") return null;
      // Reject an unrecognized kind AFTER the spread, so a partially-valid
      // blob cannot smuggle one through.
      const merged = { ...initialBuildState(), ...parsed };
      return merged.phase && PHASE_KINDS.has(merged.phase.kind) ? merged : null;
    }
    // Walk every prior key newest-first, so a session that skipped a
    // version still migrates rather than being silently lost.
    for (const prefix of LEGACY_PREFIXES) {
      const legacy = localStorage.getItem(`${prefix}${companyId}`);
      if (!legacy) continue;
      const migrated = migrateLegacy(JSON.parse(legacy));
      if (migrated) {
        saveBuildSession(companyId, migrated);
        for (const p of LEGACY_PREFIXES) {
          try { localStorage.removeItem(`${p}${companyId}`); } catch { /* ignore */ }
        }
      }
      return migrated;
    }
    return null;
  } catch {
    return null;
  }
}

export function clearBuildSession(companyId: string): void {
  try {
    localStorage.removeItem(key(companyId));
    for (const p of LEGACY_PREFIXES) localStorage.removeItem(`${p}${companyId}`);
  } catch { /* ignore */ }
}
