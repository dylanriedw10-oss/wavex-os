/** Inline confirmation card for Pillar 1.
 *
 *  Renders inside an assistant chat bubble after the Pillar 1 T2 enrichment
 *  returns. This is a CONFIRMATION, not an interview: the only thing the
 *  operator is asked to correct here is INDUSTRY, because industry decides
 *  the entire connector surface and a wrong one is expensive.
 *
 *  Two chip groups used to sit below it and are gone. The business-model
 *  chips had zero structural consumers — their vocabulary didn't even match
 *  the enum enrichment infers into, which is proof nothing depended on the
 *  human answer. The Live-selling / Pre-product binary was superseded inside
 *  the same flow: `product_state` (asked one card later) overrides it in
 *  `lib/placement.ts`, so the operator answered the same question twice and
 *  the first answer lost. Both INFERRED values still flow to the server
 *  untouched — deleting the ask is not deleting the field. */

import { useState } from "react";
import type { Pillar1Response } from "@wavex-os/plugin-onboarding";
import { wavexOsOnboardingApi, ApiError } from "../../lib/api";
import { ResponseChips } from "../ResponseChips";

const INDUSTRY_OPTIONS = [
  { value: "dev_tools", label: "Dev tools" },
  { value: "dev_infrastructure", label: "Dev infrastructure" },
  { value: "fintech", label: "Fintech" },
  { value: "fintech_retail", label: "Fintech (retail)" },
  { value: "healthtech", label: "Healthtech" },
  { value: "legal_tech", label: "Legal tech" },
  { value: "dtc_ecommerce", label: "DTC ecommerce" },
  { value: "consumer_mobile", label: "Consumer mobile" },
  { value: "enterprise_saas", label: "Enterprise SaaS" },
  { value: "marketplace", label: "Marketplace" },
  { value: "edtech", label: "Edtech" },
  { value: "agency_services", label: "Agency / services" },
  { value: "unknown", label: "Unknown" },
];

interface Props {
  companyId: string;
  response: Pillar1Response;
  onConfirmed: () => void;
}

/** Read either a canonical option value or a custom string from the chip
 *  state. Used to serialize chip selections back to the schema, which
 *  accepts free-text hints. */
function readChipValue(canonical: string[], custom: string[]): string {
  if (custom.length > 0) return custom[custom.length - 1];
  return canonical[0] ?? "";
}

export function Pillar1ConfirmCard({ companyId, response, onConfirmed }: Props) {
  // Seed chip state from the inferred response. If the inferred industry
  // matches a canonical option, render it as a canonical chip; otherwise
  // treat it as a custom value.
  const initialIndustryCanonical = INDUSTRY_OPTIONS.some((o) => o.value === response.industry_hint)
    ? [response.industry_hint as string]
    : [];
  const initialIndustryCustom = initialIndustryCanonical.length === 0 && response.industry_hint
    ? [response.industry_hint]
    : [];

  const [industryCanon, setIndustryCanon] = useState<string[]>(initialIndustryCanonical);
  const [industryCustom, setIndustryCustom] = useState<string[]>(initialIndustryCustom);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const inferredIndustry = response.industry_hint ?? "";
  const currentIndustry = readChipValue(industryCanon, industryCustom);
  const dirty = currentIndustry !== inferredIndustry;

  async function handleConfirm(): Promise<void> {
    setSubmitting(true);
    setError(null);
    try {
      if (dirty) {
        // Industry only. The other two fields keep whatever enrichment
        // inferred — an edit call that echoed them back would be a
        // round-trip through a value nobody looked at.
        await wavexOsOnboardingApi.pillar1Edit({ companyId, industry_hint: currentIndustry });
      }
      onConfirmed();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : (e as Error).message);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div style={{ marginTop: "0.5rem", display: "flex", flexDirection: "column", gap: "0.85rem" }}>
      <div className="text-dim" style={{ fontSize: 12 }}>
        Here's what I inferred. Adjust if it's off, then continue.
      </div>

      {response.company_context && (
        <div style={{
          fontSize: 12,
          padding: "0.6rem 0.75rem",
          background: "var(--bg)",
          border: "1px solid var(--border)",
          borderRadius: 6,
          color: "var(--text)",
          maxHeight: 160,
          overflowY: "auto",
        }}>
          {response.company_context}
        </div>
      )}

      {/* Inferred signals preview — surfaces every field T2 populated from
       *  the operator's site/pitch so they see the full reading, not just
       *  industry + business_model chips. Read-only, with a clear "read from
       *  your site" label to earn trust at the first inflection moment. */}
      {(response.ideal_customer_profile
        || response.competitive_position
        || response.tone_signal
        || response.primary_acquisition_channel
        || response.revenue_model
        || response.product_maturity_signal
        || response.primary_friction_hypothesis
        || response.differentiator_hypothesis) && (
        <div style={{
          padding: "0.65rem 0.85rem",
          background: "var(--bg)",
          border: "1px solid var(--border)",
          borderRadius: 6,
          fontSize: 11,
        }}>
          <div style={{
            fontSize: 10,
            fontWeight: 700,
            textTransform: "uppercase",
            letterSpacing: "0.05em",
            color: "var(--accent)",
            marginBottom: "0.5rem",
          }}>
            Read from your site
          </div>
          <div style={{
            display: "grid",
            gridTemplateColumns: "auto 1fr",
            columnGap: "0.85rem",
            rowGap: "0.4rem",
            color: "var(--text-dim)",
          }}>
            {response.ideal_customer_profile && (
              <>
                <div style={{ fontWeight: 600 }}>ICP</div>
                <div style={{ color: "var(--text)" }}>{response.ideal_customer_profile}</div>
              </>
            )}
            {response.revenue_model && (
              <>
                <div style={{ fontWeight: 600 }}>Revenue</div>
                <div style={{ color: "var(--text)" }}>{response.revenue_model}</div>
              </>
            )}
            {response.competitive_position && (
              <>
                <div style={{ fontWeight: 600 }}>Position</div>
                <div style={{ color: "var(--text)" }}>{response.competitive_position}</div>
              </>
            )}
            {response.primary_acquisition_channel && (
              <>
                <div style={{ fontWeight: 600 }}>Primary acq.</div>
                <div style={{ color: "var(--text)" }}>{response.primary_acquisition_channel}</div>
              </>
            )}
            {response.product_maturity_signal && (
              <>
                <div style={{ fontWeight: 600 }}>Maturity</div>
                <div style={{ color: "var(--text)" }}>{response.product_maturity_signal.replace(/_/g, " ")}</div>
              </>
            )}
            {response.tone_signal && (
              <>
                <div style={{ fontWeight: 600 }}>Tone</div>
                <div style={{ color: "var(--text)" }}>{response.tone_signal}</div>
              </>
            )}
            {response.differentiator_hypothesis && (
              <>
                <div style={{ fontWeight: 600 }}>Differentiator</div>
                <div style={{ color: "var(--text)", lineHeight: 1.45 }}>{response.differentiator_hypothesis}</div>
              </>
            )}
            {response.primary_friction_hypothesis && (
              <>
                <div style={{ fontWeight: 600 }}>Friction</div>
                <div style={{ color: "var(--text)", lineHeight: 1.45 }}>{response.primary_friction_hypothesis}</div>
              </>
            )}
          </div>
        </div>
      )}

      <div>
        <div style={{ fontSize: 11, fontWeight: 600, marginBottom: "0.35rem", color: "var(--text-dim)" }}>
          Industry
        </div>
        <ResponseChips
          mode="single"
          options={INDUSTRY_OPTIONS}
          values={industryCanon}
          customValues={industryCustom}
          allowCustom
          customLabel="Custom industry"
          onChange={setIndustryCanon}
          onCustomChange={setIndustryCustom}
          disabled={submitting}
        />
      </div>


      {error && (
        <div style={{ color: "var(--warning)", fontSize: 12 }}>
          ✗ {error}
        </div>
      )}

      <div style={{ display: "flex", justifyContent: "flex-end", marginTop: "0.25rem" }}>
        <button
          type="button"
          onClick={() => void handleConfirm()}
          disabled={submitting || !currentIndustry}
          style={{
            padding: "0.45rem 0.9rem",
            borderRadius: 6,
            background: "var(--accent)",
            color: "var(--bg)",
            border: "none",
            fontWeight: 600,
            fontSize: 12,
            cursor: submitting ? "wait" : "pointer",
            opacity: submitting || !currentIndustry ? 0.6 : 1,
          }}
        >
          {submitting ? "Saving…" : dirty ? "Update + continue →" : "Looks right — keep going →"}
        </button>
      </div>
    </div>
  );
}
