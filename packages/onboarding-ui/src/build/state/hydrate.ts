/** Server-authority resume.
 *
 *  The stored session is a CONVERSATION RECORD, not a progress record. The
 *  server owns progress — it has the pillar responses, the connector
 *  manifest, the plan-assembly run, and the signed manifest on disk — so a
 *  resumed session must never render a phase the server has already moved
 *  past.
 *
 *  Why this matters concretely: a session persisted at `understand_you` for a
 *  company whose plan is already built and signed would replay the whole
 *  interview and then re-finalize, which is both wrong and expensive. The
 *  reverse is safe and deliberate — see the approval rule below.
 *
 *  Cheap by construction: one status read, plus the plan run only when the
 *  status says there is one. No model calls, nothing written. */

import { wavexOsOnboardingApi } from "../../wavex-os/lib/api";
import type { AssemblyRunState } from "../../canvas/plan-contract";
import type { BuildPhase, BuildState } from "./build-reducer";

/** Rank a phase so "behind" is a comparison rather than a pile of ifs.
 *
 *  Gaps of 10 leave room for the sub-order inside `build_plan`. Review used
 *  to be its own kind and therefore ranked above the plan for free; as a
 *  STAGE it needs saying, or a session stored mid-research would outrank a
 *  server that has already settled the run and the operator would be sent
 *  back through research they finished. */
const ORDER: Record<BuildPhase["kind"], number> = {
  understand_you: 0, strategy: 10, connectors: 20, build_plan: 30, pricing: 40, birth: 50, born: 60,
};
const PLAN_STAGE_ORDER: Record<string, number> = { research: 0, planning: 1, review: 2 };

function rank(phase: BuildPhase): number {
  const base = ORDER[phase.kind];
  return phase.kind === "build_plan" ? base + PLAN_STAGE_ORDER[phase.stage] : base;
}

export interface HydrateResult {
  phase: BuildPhase | null;      // null = the stored phase already leads
  planRun: AssemblyRunState | null;
}

/** What the server can prove exists, expressed as the phase it implies. */
export async function hydrateFromServer(companyId: string, stored: BuildState): Promise<HydrateResult> {
  let planRun: AssemblyRunState | null = null;
  let implied: BuildPhase | null = null;

  try {
    const got = await wavexOsOnboardingApi.getPlanAssembly(companyId).catch(() => null);
    planRun = got?.run ?? null;
  } catch { /* no run — the flow is earlier than Phase 3 */ }

  if (planRun) {
    const settled = planRun.status === "complete" || planRun.status === "failed";
    implied = settled
      // A settled run means the plan exists. The review BEAT is as far as
      // the server can prove on its own; anything past it needed a human act.
      ? {
          kind: "build_plan", stage: "review", revealed: 0, researchSettled: true,
          review: { manifestSha256: null, finalizing: false, committing: false },
        }
      // Mid-run: re-enter Phase 3, which re-attaches to the SAME run
      // (`start` is idempotent and returns the existing one).
      : {
          kind: "build_plan", stage: "research", revealed: 0, researchSettled: false,
          review: { manifestSha256: null, finalizing: false, committing: false },
        };
  }

  if (!implied) return { phase: null, planRun };

  // NEVER advance past an approval on the server's word alone. Approving the
  // organization is a human act with a commit behind it; if the operator's
  // stored phase is beyond Review, they made that choice and it stands.
  if (rank(stored.phase) >= rank(implied)) return { phase: null, planRun };

  return { phase: implied, planRun };
}
