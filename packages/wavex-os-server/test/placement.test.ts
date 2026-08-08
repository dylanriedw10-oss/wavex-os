/** Placement — the full truth table.
 *
 *  This module exists because four call sites disagreed about one question.
 *  A truth table is therefore the right test shape: every combination gets an
 *  asserted rung, so a future edit that reintroduces a partition shows up as
 *  a failing row rather than as a bug someone finds in Birth. */

import { describe, expect, it } from "vitest";
import {
  CHAIN_BY_PLACEMENT, placeOperator, type Placement,
} from "../src/lib/placement.js";

/** Every ProductState the vendored schema defines, plus the two escapes. */
const PRODUCT_STATES = [
  "idea_only", "prototype_mvp", "built_not_selling", "live_paying_customers", "other",
] as const;

describe("placeOperator — product_state decides", () => {
  const cases: Array<[string, Placement]> = [
    ["idea_only", "pre_product"],
    ["prototype_mvp", "informal"],
    ["built_not_selling", "informal"],
    ["live_paying_customers", "operating"],
  ];

  for (const [productState, rung] of cases) {
    it(`${productState} → ${rung}, whatever has_product says`, () => {
      for (const hasProduct of [true, false, undefined]) {
        const r = placeOperator({ pillar_1: { has_product: hasProduct }, pillar_3: { product_state: productState } });
        expect(r.rung, `has_product=${hasProduct}`).toBe(rung);
        expect(r.decidedBy).toBe("product_state");
        expect(r.presumed).toBe(false);
      }
    });
  }
});

describe("placeOperator — has_product is the presumed fallback", () => {
  // `"other"` carries no rung; absent means pillar 3 hasn't been answered yet.
  for (const productState of [undefined, "other"]) {
    const label = productState ?? "absent";

    it(`${label} + has_product:true → operating, marked presumed`, () => {
      const r = placeOperator({ pillar_1: { has_product: true }, pillar_3: productState ? { product_state: productState } : undefined });
      expect(r.rung).toBe("operating");
      expect(r.decidedBy).toBe("has_product");
      expect(r.presumed).toBe(true);
      expect(r.note).toMatch(/has_product=true/);
    });

    it(`${label} + has_product:false → pre_product, marked presumed`, () => {
      const r = placeOperator({ pillar_1: { has_product: false }, pillar_3: productState ? { product_state: productState } : undefined });
      expect(r.rung).toBe("pre_product");
      expect(r.presumed).toBe(true);
    });
  }

  it("an entirely empty response defaults to operating — the field defaults to true everywhere it is produced", () => {
    const r = placeOperator({});
    expect(r.rung).toBe("operating");
    expect(r.presumed).toBe(true);
  });

  it("the presumption note names the fix, so the warning is actionable", () => {
    expect(placeOperator({}).note).toMatch(/where the product stands/i);
  });
});

describe("placeOperator — the disagreements that made this module necessary", () => {
  /** The exact input that made the server seed a real "Ship the MVP" goal
   *  with dependency edges while the client skipped the MVP stage entirely.
   *  One rung now answers for both. */
  it("has_product:true + prototype_mvp is INFORMAL — it does not get railroaded past build work", () => {
    const r = placeOperator({ pillar_1: { has_product: true }, pillar_3: { product_state: "prototype_mvp" } });
    expect(r.rung).toBe("informal");
    expect(CHAIN_BY_PLACEMENT[r.rung].length).toBeGreaterThan(0);
  });

  /** goal-synthesis ignored has_product entirely, so this case got a
   *  $5k→$15k MRR band for a company with no product (QA F12). */
  it("has_product:false with pillar 3 unanswered is PRE_PRODUCT for every consumer at once", () => {
    const r = placeOperator({ pillar_1: { has_product: false } });
    expect(r.rung).toBe("pre_product");
  });

  it("adopting a URL does not decide the rung — it only sets has_product", () => {
    // adopt-product.ts forces has_product:true. If the operator then answers
    // prototype_mvp, they must still get build work.
    const afterAdopt = placeOperator({ pillar_1: { has_product: true } });
    expect(afterAdopt.rung).toBe("operating");
    const afterPillar3 = placeOperator({ pillar_1: { has_product: true }, pillar_3: { product_state: "prototype_mvp" } });
    expect(afterPillar3.rung).toBe("informal");
  });
});

describe("placeOperator — stage is not an input", () => {
  /** Load-bearing for scope: `stage` has three incompatible vocabularies in
   *  this codebase. Placement being stage-independent is what lets this land
   *  without reconciling them. */
  const STAGES = [
    "less_than_10k_mrr", "10k_100k_mrr", "pre_revenue_validating",  // three different vocabularies
    "0_10k_arr", "", "not-a-real-stage", "🙂",
  ];

  for (const productState of PRODUCT_STATES) {
    it(`${productState} places identically across every stage vocabulary`, () => {
      const rungs = new Set(
        STAGES.map((stage) => placeOperator({
          pillar_1: { has_product: true },
          pillar_3: { product_state: productState, stage } as { product_state: string },
        }).rung),
      );
      expect(rungs.size, `stage changed the rung for ${productState}`).toBe(1);
    });
  }
});

describe("CHAIN_BY_PLACEMENT", () => {
  it("informal drops spec and build — the product exists, informally", () => {
    expect(CHAIN_BY_PLACEMENT.informal).toEqual(["instrument", "positioning", "validate"]);
  });

  it("operating builds nothing", () => {
    expect(CHAIN_BY_PLACEMENT.operating).toEqual([]);
  });

  it("pre_product keeps the full chain — unchanged from today's Path A", () => {
    expect(CHAIN_BY_PLACEMENT.pre_product).toEqual(["spec", "build", "instrument", "positioning", "validate"]);
  });

  it("every rung's chain is a subset of the full chain, in the same order", () => {
    const full = CHAIN_BY_PLACEMENT.pre_product;
    for (const rung of Object.keys(CHAIN_BY_PLACEMENT) as Placement[]) {
      const chain = CHAIN_BY_PLACEMENT[rung];
      expect(chain.every((k) => full.includes(k)), rung).toBe(true);
      const positions = chain.map((k) => full.indexOf(k));
      expect(positions, `${rung} is out of chain order`).toEqual([...positions].sort((a, b) => a - b));
    }
  });
});
