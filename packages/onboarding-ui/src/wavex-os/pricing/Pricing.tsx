/** System Optimizer subscription — the pricing step in the wavex
 *  onboarding wizard. Renders the 4-tier card layout matching the
 *  product design (Free trial / Founder / Growth / Custom). Founder is
 *  highlighted as "Most popular".
 *
 *  Two CTA paths:
 *    - Subscribe (or "Start trial" on the free card) — records the
 *      operator's chosen tier via /api/tier-subscriptions
 *    - Skip — records tierId=trial with origin=skip, advances anyway
 *
 *  Both paths call onContinue(); the parent (WavexOsOnboarding) then opens
 *  the Paperclip tab + redirects to Mission Control. Billing is a stub
 *  for now — see IMPLEMENTATION_PLAN.md §7.1 for the post-demo billing
 *  pass that turns Subscribe into a real Stripe Checkout. */

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { wavexOsOnboardingApi, ApiError } from "../lib/api";
import { H2, P } from "../components/primitives";

interface PricingProps {
  companyId: string;
  /** Called after Subscribe or Skip — parent handles Paperclip tab + nav. */
  onContinue: (chosenTierId: TierId, origin: "subscribe" | "skip") => void;
  /** When true, render as a centered dialog over a dimmed backdrop (used
   *  by the chat-first ImprintTheater hand-off). Default renders the full-
   *  page layout used by the legacy /onboarding wizard. */
  dialogMode?: boolean;
}

type TierId = "trial" | "founder" | "growth" | "custom";

interface TierConfig {
  id: TierId;
  displayName: string;
  priceLabel: string;
  priceCents: number;
  features: string[];
  recommended: boolean;
  ctaLabel: string;
}

export function Pricing({ companyId, onContinue, dialogMode = false }: PricingProps) {
  const [submitting, setSubmitting] = useState<TierId | "skip" | null>(null);
  const [error, setError] = useState<string | null>(null);

  const q = useQuery({
    queryKey: ["tiers"],
    queryFn: () => wavexOsOnboardingApi.listTiers(),
  });

  async function handleChoice(tierId: TierId, origin: "subscribe" | "skip"): Promise<void> {
    setSubmitting(origin === "skip" ? "skip" : tierId);
    setError(null);
    try {
      await wavexOsOnboardingApi.subscribeTier({ orgId: companyId, tierId, origin });
    } catch (e) {
      // RECORD THE INTENT AND CONTINUE. `onContinue` is what mints and commits
      // the APPROVAL — an act that has nothing to do with billing. Returning
      // early here stranded a signed, finalized organization behind a paywall
      // because a billing service was briefly unreachable, with no way
      // forward. The operator's choice is kept for a retry; the organization
      // is not held hostage to it.
      setError(e instanceof ApiError ? e.message : (e as Error).message);
      try {
        localStorage.setItem(`wavex-os-tier-intent:${companyId}`, JSON.stringify({ tierId, origin, at: new Date().toISOString() }));
      } catch { /* best effort */ }
    } finally {
      setSubmitting(null);
    }
    onContinue(tierId, origin);
  }

  if (q.isLoading) {
    return <div style={{ padding: "2rem", color: "var(--text-dim)" }}>Loading pricing…</div>;
  }
  if (q.isError) {
    return <div style={{ padding: "2rem", color: "var(--warning)" }}>Failed to load pricing: {(q.error as Error).message}</div>;
  }

  const tiers = q.data?.tiers ?? [];

  // `!== true`, not `=== false`. The flag is optional on the wire, and the
  // cautious reading has to be the DEFAULT one: an absent flag means we do
  // not know whether a card will be charged, and "we don't know" may not
  // render as "yes it will".
  const billingStub = q.data?.billingLive !== true;

  // The CTA is server copy, and while billing is a stub the server's own word
  // for it — "Subscribe" — is the false part. A button may only name what
  // pressing it does, and pressing this records a preference.
  const ctaFor = (t: { id: string; ctaLabel: string; displayName: string }) =>
    billingStub ? (t.id === "trial" ? "Choose the trial" : `Choose ${t.displayName}`) : t.ctaLabel;

  // No `overflow: auto` and no `92vh`: the pane owns the height, and the fit
  // law allows exactly two scrollers in the product — neither is this. The
  // bottom padding that used to reserve room for a viewport-FIXED skip footer
  // is gone too; the footer sits in normal flow now (see below).
  const containerStyle = dialogMode
    ? {
        maxWidth: 1100,
        width: "min(1100px, 95vw)",
        margin: 0,
        padding: "1.5rem",
        background: "var(--surface)",
        border: "1px solid var(--border)",
        borderRadius: 12,
      }
    : { maxWidth: 1400, margin: "0 auto", padding: "2rem", paddingBottom: "6rem" };

  const inner = (
    <div style={containerStyle}>
      <H2>System Optimizer subscription</H2>
      <P>
        Strategic directives to your CEO. Your WaveX Agent monitors performance and intervenes when agents drift.
      </P>

      {/* Said ABOVE the prices, not in a footnote under them. The prices are
          real numbers and the cards are real controls; what the operator
          cannot otherwise discover is that pressing one of them buys nothing.
          Finding that out later is what turns a stub into a broken promise. */}
      {billingStub && (
        <div
          role="note"
          style={{
            marginTop: "0.75rem",
            padding: "0.6rem 0.9rem",
            border: "1px solid var(--warning)",
            borderRadius: 8,
            fontSize: 13,
            lineHeight: 1.5,
            color: "var(--text)",
          }}
        >
          <strong style={{ color: "var(--warning)" }}>Billing isn’t live yet.</strong>{" "}
          Picking a plan records your choice so we know what you want — no card is
          asked for and nothing is charged. Your organization is created either way.
        </div>
      )}

      <div style={{
        display: "grid",
        gridTemplateColumns: "repeat(4, minmax(0, 1fr))",
        gap: "1rem",
        marginTop: "2rem",
      }}>
        {tiers.map((tier) => (
          <TierCard
            key={tier.id}
            tier={tier}
            submitting={submitting === tier.id}
            disabled={submitting !== null}
            onChoose={() => void handleChoice(tier.id, "subscribe")}
            ctaLabel={ctaFor(tier)}
            busyLabel={billingStub ? "Saving…" : "Processing…"}
          />
        ))}
      </div>

      {error && (
        <div style={{ marginTop: "1rem", color: "var(--warning)", fontSize: 13 }}>
          ✗ {error}
        </div>
      )}

      {/* The skip footer. In the legacy full-page wizard it is viewport-FIXED,
          which is why the dialog had to reserve 5rem of bottom padding for a
          bar it did not contain. Inside a pane that is simply wrong — the bar
          would float over whatever else the phase renders — so in dialogMode
          it sits in normal flow at the end of the card. */}
      <div style={dialogMode ? {
        marginTop: "1rem",
        borderTop: "1px solid var(--border)",
        paddingTop: "0.75rem",
      } : {
        position: "fixed", bottom: 0, left: 0, right: 0,
        background: "color-mix(in srgb, var(--surface) 92%, transparent)",
        borderTop: "1px solid var(--border)",
        backdropFilter: "blur(6px)",
        padding: "0.75rem 2rem",
        zIndex: 20,
      }}>
        <div style={{
          maxWidth: 1400, margin: "0 auto",
          display: "flex", justifyContent: "space-between", alignItems: "center", gap: "1rem",
        }}>
          <span className="text-dim" style={{ fontSize: 12 }}>
            {billingStub
              ? "Either way you keep going — nothing here is charged yet."
              : "Choose a plan or skip to continue without subscription."}
          </span>
          <button
            type="button"
            className="secondary"
            onClick={() => void handleChoice("trial", "skip")}
            disabled={submitting !== null}
          >
            {submitting === "skip" ? "Skipping…" : "Skip — continue without subscription →"}
          </button>
        </div>
      </div>
    </div>
  );

  if (!dialogMode) return inner;

  // `dialogMode` is a misnomer kept for its callers: this is NOT a dialog.
  // A fixed-inset overlay over a dimmed backdrop is a modal, and interaction
  // rule 5 bans modals outright — rule 2 permits exactly one overlay in the
  // product, the Runtime tray, and this is not it. It also introduced a THIRD
  // scroller, which the fit law permits only for `.cv-thread` and
  // `.cv-record`. It escaped the quality gate's greps only because they are
  // scoped to src/canvas/.
  //
  // So it renders as ordinary content in the pane it was given, and scrolls
  // nowhere: the caller owns the height, exactly like every other phase.
  return (
    <div style={{ height: "100%", minHeight: 0, display: "flex", alignItems: "center", justifyContent: "center", overflow: "hidden" }}>
      {inner}
    </div>
  );
}

interface TierCardProps {
  tier: TierConfig;
  submitting: boolean;
  disabled: boolean;
  onChoose: () => void;
  /** Resolved by the parent from `billingLive` — a button may only name what
   *  pressing it actually does. */
  ctaLabel: string;
  /** "Processing…" implies a transaction. While billing is a stub the only
   *  thing in flight is a recorded preference. */
  busyLabel: string;
}

function TierCard({ tier, submitting, disabled, onChoose, ctaLabel, busyLabel }: TierCardProps) {
  const isRecommended = tier.recommended;
  return (
    <div style={{
      position: "relative",
      padding: "1.5rem",
      background: "var(--surface)",
      border: `1px solid ${isRecommended ? "var(--accent)" : "var(--border)"}`,
      borderRadius: 8,
      display: "flex", flexDirection: "column", gap: "1rem",
      minHeight: 360,
    }}>
      {isRecommended && (
        <div style={{
          position: "absolute", top: -12, left: "50%", transform: "translateX(-50%)",
          background: "var(--accent)", color: "var(--bg)",
          padding: "0.15rem 0.75rem", borderRadius: 12,
          fontSize: 11, fontWeight: 600,
        }}>
          Most popular
        </div>
      )}

      <div style={{ fontSize: 18, fontWeight: 700 }}>{tier.displayName}</div>

      <div style={{ display: "flex", alignItems: "baseline", gap: "0.4rem" }}>
        <span style={{ fontSize: 30, fontWeight: 700 }}>
          ${(tier.priceCents / 100).toFixed(tier.priceCents % 100 === 0 ? 0 : 2)}
        </span>
        <span className="text-dim" style={{ fontSize: 13 }}>
          / {tier.priceLabel.split(" / ")[1] ?? "month"}
        </span>
      </div>

      <ul style={{
        listStyle: "none", padding: 0, margin: 0,
        display: "flex", flexDirection: "column", gap: "0.5rem",
        fontSize: 13, flex: 1,
      }}>
        {tier.features.map((feat) => (
          <li key={feat} style={{ display: "flex", gap: "0.5rem", alignItems: "flex-start" }}>
            <span style={{ color: "var(--accent)", fontWeight: 700 }}>✓</span>
            <span>{feat}</span>
          </li>
        ))}
      </ul>

      <button
        type="button"
        onClick={onChoose}
        disabled={disabled}
        className={isRecommended ? "" : "secondary"}
        style={{ width: "100%" }}
      >
        {submitting ? busyLabel : ctaLabel}
      </button>
    </div>
  );
}
