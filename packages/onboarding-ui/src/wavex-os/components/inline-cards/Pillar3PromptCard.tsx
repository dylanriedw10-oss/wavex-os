/** Inline prompt card for Pillar 3 — where the product stands. One chip
 *  group, and the second of the two corrections the interview still makes.
 *
 *  The revenue-BRACKET group that used to follow it is gone. Strategy asks
 *  for the actual number one card later, and a bracket derived from a typed
 *  number beats a bracket clicked from a menu: it can't disagree with the
 *  goal, and it dissolves the vocabulary drift that came from three
 *  different stage lists never being reconciled. The card therefore does not
 *  POST — the answer is held until the number exists, and BuildOrgPage
 *  writes pillar 3 once, complete.
 *
 *  `product_state` is also what `lib/placement.ts` decides the rung from, so
 *  this single chip carries the whole pre-product / informal / operating
 *  distinction. */

import { useState } from "react";
import { ResponseChips } from "../ResponseChips";
import { PRODUCT_STATES } from "../../lib/options";
import { usePillarSuggestion } from "../../lib/use-pillar-suggestion";

const PRODUCT_OPTS = PRODUCT_STATES.filter((o) => o.v !== "other").map((o) => ({ value: o.v, label: o.l }));

interface Props {
  companyId: string;
  /** The chosen product state — canonical id, or the operator's own words
   *  when they picked "other". Nothing is written yet. */
  onDone: (productState: string, custom: boolean) => void;
}

export function Pillar3PromptCard({ companyId, onDone }: Props) {
  const [productCanon, setProductCanon] = useState<string[]>([]);
  const [productCustom, setProductCustom] = useState<string[]>([]);
  const [submitting, setSubmitting] = useState(false);

  // NO AUTO-SELECT. The suggestion is SHOWN — sparkle outline, reasoning line —
  // and the operator clicks it.
  //
  // Preselecting made `ready` true with zero interaction, so one click on
  // Continue persisted a model's guess as the operator's stated answer, and
  // nothing recorded whether a chip was ever touched. Every downstream
  // consumer then read it as `operator-claimed`: the placement rung, the
  // capability graph, the claim ledger, the contradiction detector. One click
  // is the entire difference between a claim and a guess, and it is worth it.
  const suggestion = usePillarSuggestion(3, companyId);
  const suggestedProduct = typeof suggestion.recommended.product_state === "string"
    ? (suggestion.recommended.product_state as string)
    : null;

  const productValue = productCustom[0] ?? productCanon[0] ?? "";
  const productIsCustom = productCustom.length > 0;
  const ready = !!productValue;

  function handleSubmit(): void {
    if (!ready) return;
    setSubmitting(true);
    onDone(productValue, productIsCustom);
  }

  return (
    <div style={{ marginTop: "0.5rem", display: "flex", flexDirection: "column", gap: "0.8rem" }}>
      {/* Inference-grounded reasoning chip. Renders only after the suggest
          call resolves and only when Claude returned a one-sentence why. */}
      {suggestion.loaded && suggestion.reasoning && (
        <div style={{
          padding: "0.4rem 0.6rem",
          background: "var(--bg)",
          border: "1px dashed var(--accent)",
          borderRadius: 6,
          fontSize: 11,
          color: "var(--text-dim)",
          lineHeight: 1.45,
        }}>
          <span style={{ color: "var(--accent)", fontWeight: 600 }}>✨ Suggested for you</span>
          {" — "}{suggestion.reasoning}
        </div>
      )}
      <div>
        <div style={{ fontSize: 11, fontWeight: 600, marginBottom: "0.35rem", color: "var(--text-dim)" }}>
          Product
        </div>
        <ResponseChips
          mode="single"
          options={PRODUCT_OPTS}
          values={productCanon}
          customValues={productCustom}
          allowCustom
          customLabel="Other product status"
          onChange={setProductCanon}
          onCustomChange={setProductCustom}
          disabled={submitting}
          suggestedValues={suggestedProduct ? [suggestedProduct] : []}
        />
      </div>

      <div style={{ display: "flex", justifyContent: "flex-end" }}>
        <button
          type="button"
          data-testid="pillar3-submit"
          onClick={handleSubmit}
          disabled={submitting || !ready}
          style={{
            padding: "0.4rem 0.85rem",
            borderRadius: 6,
            background: "var(--accent)",
            color: "var(--bg)",
            border: "none",
            fontWeight: 600,
            fontSize: 12,
            cursor: submitting || !ready ? "not-allowed" : "pointer",
            opacity: submitting || !ready ? 0.6 : 1,
          }}
        >
          Continue →
        </button>
      </div>
    </div>
  );
}
