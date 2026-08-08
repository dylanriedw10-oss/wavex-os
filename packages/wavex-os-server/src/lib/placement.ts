/** Placement — where the operator sits on the product spectrum.
 *
 *  THE ONE AUTHORITY. Before this module there were FOUR independent
 *  computations of "does this operator need to build something", and they
 *  disagreed:
 *
 *    build-reducer.ts   has_product                          → Birth stage
 *    plan-assembly.ts   has_product===false || ps ∈ {…}      → the MVP checklist
 *    goal-synthesis.ts  ps ∈ {…}   (ignoring has_product)    → the goal band
 *    canvas.ts          has_product                          → the summary copy
 *
 *  `has_product: true` + `product_state: "prototype_mvp"` therefore made the
 *  server generate an MVP checklist AND seed a real "Ship the MVP" goal with
 *  dependency edges, while the client sent the operator straight past the MVP
 *  stage into a 2.6s motion. The work existed and was never shown. The
 *  goal-synthesis disagreement independently produced QA finding F12: an MRR
 *  baseline fabricated for a company with no product.
 *
 *  Every consumer now imports from here. Nobody re-derives from raw pillars.
 *
 *  ── Why `product_state` wins over `has_product` ──────────────────────────
 *  Pillar 3 is answered AFTER pillar 1, from a closed-enum card the operator
 *  clicked. `has_product` is frequently T2's guess and **defaults to `true`**
 *  in every producer (routes/pillars.ts, the vendored pillar-1 fallbacks, and
 *  the T2 prompt's own instruction when undetermined). The later, more
 *  specific, operator-clicked answer wins. No blending, no precedence ladder —
 *  one rule, which is what makes the disagreement structurally impossible.
 *
 *  ── Why `stage` is NOT an input ─────────────────────────────────────────
 *  Deliberate, and load-bearing for scope. `stage` is an unvalidated string
 *  with THREE mutually incompatible vocabularies (the UI chips in
 *  lib/options.ts, the T2 suggestion list in routes/pillars.ts, and the
 *  `Stage` type in selection/affinities.ts), each consumer carrying its own
 *  silent fallback. Placement being stage-independent means none of that has
 *  to be reconciled for this to be correct — an unrecognized `stage` string
 *  cannot change where an operator is placed.
 *
 *  ── Why `product_maturity_signal` is NOT an input ───────────────────────
 *  It exists on Pillar1Response and is currently consumed by nothing. It is
 *  pure T2 inference and is never shown to the operator for review.
 *  Promoting an unvetted guess to a load-bearing rung would be a regression
 *  in honesty. Leave it unconsumed.
 */

/** The three rungs the spec names: no product and no revenue, something
 *  informal already generating interest, an existing product with revenue. */
export type Placement = "pre_product" | "informal" | "operating";

export interface PlacementResult {
  rung: Placement;
  /** `product_state` = the operator's own Pillar-3 card answer decided it.
   *  `has_product`   = no usable product_state; the Pillar-1 boolean did —
   *                    and that field defaults to `true`, so this is a
   *                    PRESUMPTION, not a statement. */
  decidedBy: "product_state" | "has_product";
  presumed: boolean;
  /** Verbatim reason. Surfaced in the run's warnings when `presumed`, so the
   *  presumption is visible instead of silent. Never a lie. */
  note: string;
}

/** `| null` is not optional-with-extra-steps here: the vendored
 *  `PillarResponses` types every pillar as `T | null` (unanswered), and an
 *  unanswered pillar 3 is the single most common way this function is called
 *  — it is exactly the case that falls through to the presumption. */
export interface PlacementInputs {
  pillar_1?: { has_product?: boolean } | null;
  pillar_3?: { product_state?: string } | null;
}

/** Every `ProductState` the vendored schema defines, mapped. `"other"` is
 *  deliberately absent — it carries no rung, so it falls through. */
const BY_PRODUCT_STATE: Record<string, Placement> = {
  idea_only: "pre_product",
  prototype_mvp: "informal",
  built_not_selling: "informal",
  live_paying_customers: "operating",
};

export function placeOperator(responses: PlacementInputs): PlacementResult {
  const ps = responses.pillar_3?.product_state;
  const byState = ps ? BY_PRODUCT_STATE[ps] : undefined;
  if (byState) {
    return { rung: byState, decidedBy: "product_state", presumed: false, note: `product_state=${ps}` };
  }
  // The fallback. `!== false` because the field defaults to true everywhere
  // it is produced, including in frozen vendored code.
  const hasProduct = responses.pillar_1?.has_product !== false;
  return {
    rung: hasProduct ? "operating" : "pre_product",
    decidedBy: "has_product",
    presumed: true,
    note: ps === "other"
      ? `product_state="other" carries no rung — placed from has_product=${hasProduct}. Answer "where the product stands" to place this precisely.`
      : `no product_state answered — placed from has_product=${hasProduct}. Answer "where the product stands" to place this precisely.`,
  };
}

/** Which MVP_TEMPLATE keys each rung's build chain contains.
 *
 *  `informal` drops `spec` and `build` — the product exists, informally. What
 *  it is missing is measurement, positioning, and a real validation call.
 *  `operating` builds nothing; its plan is operating cadences from day one.
 *
 *  The partial chain costs almost nothing to honor: buildChecklist's existing
 *  dependency resolver already re-points deps whose key was dropped, so
 *  `instrument` resolves to no dependencies and `validate` to `[instrument]`
 *  with no extra code. */
export const CHAIN_BY_PLACEMENT: Record<Placement, readonly string[]> = {
  pre_product: ["spec", "build", "instrument", "positioning", "validate"],
  informal: ["instrument", "positioning", "validate"],
  operating: [],
};

/** The seeded build goal's title. Copy only — never re-consulted for
 *  structure. Structure is decided once, by the checklist itself. */
export const GOAL_TITLE_BY_PLACEMENT: Record<Placement, string> = {
  pre_product: "Ship the MVP",
  informal: "Get it in front of buyers",
  operating: "Run the operating plan",
};

/** One operator-facing sentence naming where they were placed. Used by the
 *  Review card and the approve-organization proposal summary, which today
 *  derives its copy from `has_product` and can therefore tell the operator
 *  "existing product wired in" while the server seeds an MVP goal. */
export const PLACEMENT_SENTENCE: Record<Placement, string> = {
  pre_product: "No product yet — the plan builds one first.",
  informal: "A product exists informally — the plan measures and positions it.",
  operating: "A live product — the plan runs operating cycles against it.",
};
