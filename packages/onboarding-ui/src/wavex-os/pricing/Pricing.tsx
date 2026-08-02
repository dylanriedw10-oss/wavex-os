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
      onContinue(tierId, origin);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : (e as Error).message);
    } finally {
      setSubmitting(null);
    }
  }

  if (q.isLoading) {
    return <div style={{ padding: "2rem", color: "var(--text-dim)" }}>Loading pricing…</div>;
  }
  if (q.isError) {
    return <div style={{ padding: "2rem", color: "var(--warning)" }}>Failed to load pricing: {(q.error as Error).message}</div>;
  }

  const tiers = q.data?.tiers ?? [];

  const containerStyle = dialogMode
    ? {
        maxWidth: 1100,
        width: "min(1100px, 95vw)",
        maxHeight: "92vh",
        margin: 0,
        padding: "1.5rem 1.5rem 5rem",
        background: "var(--surface)",
        border: "1px solid var(--border)",
        borderRadius: 12,
        overflow: "auto" as const,
      }
    : { maxWidth: 1400, margin: "0 auto", padding: "2rem", paddingBottom: "6rem" };

  const inner = (
    <div style={containerStyle}>
      <H2>System Optimizer subscription</H2>
      <P>
        Strategic directives to your CEO. Your WaveX Agent monitors performance and intervenes when agents drift.
      </P>

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
          />
        ))}
      </div>

      {error && (
        <div style={{ marginTop: "1rem", color: "var(--warning)", fontSize: 13 }}>
          ✗ {error}
        </div>
      )}

      {/* Sticky footer with Skip button + secondary nav.
          Matches the rest of the wizard's sticky-footer pattern from
          Materialize so the operator always has a path forward. */}
      <div style={{
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
            Choose a plan or skip to continue without subscription.
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

  return (
    <div style={{
      position: "fixed", inset: 0, zIndex: 80,
      background: "color-mix(in srgb, #000 60%, transparent)",
      display: "flex", alignItems: "center", justifyContent: "center",
      padding: "1.5rem",
    }}>
      {inner}
    </div>
  );
}

interface TierCardProps {
  tier: TierConfig;
  submitting: boolean;
  disabled: boolean;
  onChoose: () => void;
}

function TierCard({ tier, submitting, disabled, onChoose }: TierCardProps) {
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
        {submitting ? "Processing…" : tier.ctaLabel}
      </button>
    </div>
  );
}
