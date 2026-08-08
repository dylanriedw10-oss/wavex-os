/** Phase 1 — Understand You. The right pane renders CONTEXT, not content:
 *  the company core (the wheel's still center) and the fact chips that
 *  appear as the conversation confirms them. All orchestration lives in
 *  BuildOrgPage; this component only presents. */

import { CompanyCore } from "../canvas/CompanyCore";
import type { BuildState } from "../state/build-reducer";

/** The badge under the core used to print a revenue BRACKET. It can't
 *  anymore, and shouldn't: the bracket is no longer asked here — it derives
 *  from the number Strategy collects one phase later — and a company that
 *  hasn't reached that point has no revenue figure to show. What it does
 *  have is where the product stands, which is the answer this phase just
 *  took and the one the rung is decided from. */
const PRODUCT_STATE_LABEL: Record<string, string> = {
  idea_only: "idea only",
  prototype_mvp: "prototype / MVP",
  built_not_selling: "built, not selling",
  live_paying_customers: "live, paying customers",
};

export function UnderstandYou({ state, companyId, instrumentH, onAdopt }: {
  state: BuildState;
  companyId: string | null;
  instrumentH: number;
  onAdopt: () => void;
}) {
  const productState = state.draft.productState;
  return (
    <div style={{ height: "100%", display: "grid", placeItems: "center" }}>
      <CompanyCore
        companyId={companyId}
        pillar1={state.draft.pillar1Response ?? null}
        stageLabel={productState ? (PRODUCT_STATE_LABEL[productState] ?? productState) : null}
        // The core owns the whole pane in Phase 1 — chips + adopt row cost
        // roughly 130px of it.
        facePx={Math.max(0, instrumentH - 130)}
        onAdopt={onAdopt}
        // The adopt affordance exists until identity lands — after that the
        // path is set and re-adopting mid-flow would fork the record.
        showAdopt={!state.draft.pillar1Response}
      />
    </div>
  );
}
