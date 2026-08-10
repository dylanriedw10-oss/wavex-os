/** Pricing tier config — single source of truth for the System Optimizer
 *  subscription screen. Powers both the Pricing wizard step (renders cards
 *  from this list) and eventually the tier-enforcement middleware
 *  (deferred to post-demo backlog).
 *
 *  Keep copy + structure in sync with the design in
 *  IMPLEMENTATION_PLAN.md §2.1.  Changing prices, perks, or tier IDs
 *  here will reshape the pricing screen on next render. */

/** Is billing actually wired?
 *
 *  It is not. `POST /api/tier-subscriptions` is a stub whose own header says
 *  so — it `console.log`s the choice, writes no row, and fires no charge. The
 *  pricing surface said nothing about that, so an operator clicked Subscribe
 *  on a $29/month card, got a progress state and an advance to Birth, and
 *  had no way to learn that nothing was bought. That is a commercial
 *  commitment asserted on the system's behalf that the system did not make,
 *  in the middle of a flow where the operator is still deciding how much of
 *  it to believe.
 *
 *  A FLAG rather than reworded copy, because the copy is only wrong while
 *  this is false. When Stripe Checkout lands here (post-demo backlog §7.1),
 *  flipping this one constant makes the cards say the true thing again on
 *  every surface that renders them — the build flow's pricing phase and the
 *  standalone /wavex-pricing page both read it from the same response. */
export const BILLING_LIVE = false;

export type TierId = "trial" | "founder" | "growth" | "custom";

export interface TierConfig {
  id: TierId;
  displayName: string;
  priceLabel: string;
  priceCents: number;
  features: string[];
  recommended: boolean;
  ctaLabel: string;
}

export const TIERS: TierConfig[] = [
  {
    id: "trial",
    displayName: "Free trial",
    priceLabel: "$0 / 14 days",
    priceCents: 0,
    features: [
      "14 board directives",
      "Trial capacity (200K tokens)",
      "Full live preview",
    ],
    recommended: false,
    ctaLabel: "Start trial",
  },
  {
    id: "founder",
    displayName: "Founder",
    priceLabel: "$29 / month",
    priceCents: 2900,
    features: [
      "30 board directives / mo",
      "Solo founder capacity (500K tokens / mo)",
      "Weekly performance audit",
    ],
    recommended: true,
    ctaLabel: "Subscribe",
  },
  {
    id: "growth",
    displayName: "Growth",
    priceLabel: "$99 / month",
    priceCents: 9900,
    features: [
      "200 board directives / mo",
      "Team capacity (2M tokens / mo)",
      "Daily performance enforcement",
    ],
    recommended: false,
    ctaLabel: "Subscribe",
  },
  {
    id: "custom",
    displayName: "Custom",
    priceLabel: "$299 / month",
    priceCents: 29900,
    features: [
      "Unlimited board directives",
      "Enterprise capacity (unlimited tokens)",
      "Dedicated WaveX Agent",
      "White-glove launch + VC arm",
    ],
    recommended: false,
    ctaLabel: "Subscribe",
  },
];

export function getTier(id: TierId): TierConfig | undefined {
  return TIERS.find((t) => t.id === id);
}
