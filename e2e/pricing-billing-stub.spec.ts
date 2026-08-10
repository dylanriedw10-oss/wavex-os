/** A priced control may not imply a purchase the server does not make.
 *
 *  `POST /api/tier-subscriptions` is a stub — its own header says it
 *  `console.log`s the choice, writes no row and fires no charge. The pricing
 *  surface said nothing about that: four cards from $0 to $299/month, a
 *  "Subscribe" CTA, a "Processing…" state, then an advance to Birth. Nothing
 *  was bought and nothing on screen let the operator find that out.
 *
 *  TWO-SIDED, on the SERVER flag. `billingLive` travels with the prices, so
 *  the test drives the same surface twice and changes only that field. The
 *  live case must show the real "Subscribe" copy and NO stub notice —
 *  otherwise this fix would be a permanent apology rather than a statement
 *  about the current state, and the day billing ships nobody would notice.
 *
 *  The third case is the one that matters most for safety: `billingLive`
 *  ABSENT. An older or partial server that omits the field must degrade to
 *  the cautious reading. "We don't know whether this charges" may not render
 *  as "yes it charges".
 *
 *  ABLATION, RUN: reverting Pricing.tsx to `tier.ctaLabel` + the
 *  unconditional footer fails the stub and absent cases on every assertion
 *  and leaves the live case passing.
 */

import { test, expect, type Page } from "@playwright/test";

const TIERS = "**/api/tiers";

const CARDS = [
  { id: "trial", displayName: "Free trial", priceLabel: "$0 / 14 days", priceCents: 0, features: ["14 board directives"], recommended: false, ctaLabel: "Start trial" },
  { id: "founder", displayName: "Founder", priceLabel: "$29 / month", priceCents: 2900, features: ["30 board directives / mo"], recommended: true, ctaLabel: "Subscribe" },
];

async function serveTiers(page: Page, body: Record<string, unknown>) {
  await page.route(TIERS, (route) =>
    route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ ok: true, tiers: CARDS, ...body }) }));
}

const CO = `pw-price-${Date.now().toString(36)}`;

/** The pricing PHASE of /build is the only surface that mounts this
 *  component — `/wavex-pricing` renders a different, standalone page. Seed
 *  straight into it; reaching it for real would spend a full approval. */
async function openPricingPhase(page: Page) {
  await page.addInitScript(([co]) => {
    localStorage.setItem(`wavex-os-build-v3:${co}`, JSON.stringify({
      phase: { kind: "pricing" },
      thread: [],
      adoptedProductUrl: null,
      connectorsCondensed: true,
      planRun: null,
      draft: {},
    }));
  }, [CO]);
  await page.goto(`/build?companyId=${CO}`);
}

test.describe("the pricing cards and what pressing them actually does", () => {
  test.skip(!process.env.WAVEX_E2E_FIXTURE_ENGINE, "needs the fixture engine — run with WAVEX_E2E_FIXTURE_ENGINE=1");

  test("billing is a stub → the surface says so, and no button says Subscribe", async ({ page }) => {
    await serveTiers(page, { billingLive: false });
    await openPricingPhase(page);

    await expect(page.getByText("Billing isn’t live yet.")).toBeVisible();
    await expect(page.getByText(/no card is\s+asked for and nothing is charged/)).toBeVisible();

    // THE ASSERTION: a button may only name what pressing it does.
    await expect(page.getByRole("button", { name: "Subscribe" })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Choose Founder" })).toBeVisible();
    await expect(page.getByText(/nothing here is charged yet/)).toBeVisible();
  });

  test("billing is live → the real copy comes back and the notice is gone", async ({ page }) => {
    await serveTiers(page, { billingLive: true });
    await openPricingPhase(page);

    await expect(page.getByRole("button", { name: "Subscribe" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Start trial" })).toBeVisible();
    await expect(page.getByText("Billing isn’t live yet.")).toHaveCount(0);
    await expect(page.getByText("Choose a plan or skip to continue without subscription.")).toBeVisible();
  });

  test("the flag is absent → treated as a stub, not as a charge", async ({ page }) => {
    await serveTiers(page, {});
    await openPricingPhase(page);

    await expect(page.getByText("Billing isn’t live yet.")).toBeVisible();
    await expect(page.getByRole("button", { name: "Subscribe" })).toHaveCount(0);
  });
});
