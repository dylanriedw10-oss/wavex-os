/** Strategy — the four questions that are the ONLY intent in the flow.
 *
 *  Every other question onboarding asks can, in principle, be inferred from
 *  the site, discovered from a connector, or learned from the work. These
 *  four cannot: a goal is a decision. Before this card existed the goal was
 *  synthesized from a revenue BRACKET chip — always MRR, always 90 days —
 *  and that invented number became the plan the operator approved, the
 *  organization's current-state line, the seeded work goal, and the fleet's
 *  founding directive. Two companies eight times apart in size picked the
 *  same bracket and received identical marching orders.
 *
 *  The card walks its own four beats rather than mounting four cards,
 *  because the answers compose into one sentence and reading them together
 *  is how the operator checks them. Declining is a first-class outcome: it
 *  posts NOTHING, so the server's fallback runs and marks itself
 *  `stated: false` everywhere it renders. A skipped question must never look
 *  like an answered one. */

import { useState } from "react";
import { wavexOsOnboardingApi, ApiError } from "../../wavex-os/lib/api";
import { ResponseChips } from "../../wavex-os/components/ResponseChips";
import { COPY } from "../copy";
import type { StrategyDraftPatch } from "../state/build-reducer";

export type StrategyAsk = "kpi" | "current" | "target" | "bottleneck";

/** Canonical ids — the source of truth is
 *  `packages/wavex-os-server/src/lib/kpi-registry.ts` (CANONICAL_KPI_ORDER).
 *  The server REJECTS an id it cannot name rather than coercing it, so this
 *  list must stay a subset of that one. Labels and units are display-only.
 *
 *  The list leads with revenue because most companies do, and then keeps
 *  going — a dev-tools company measuring activation and a marketplace
 *  measuring win rate are not both MRR businesses, which is precisely what
 *  the old bracket assumed. */
const KPIS: { id: string; label: string; unit: "currency" | "percent" | "days" | "months" | "ratio" }[] = [
  { id: "monthly_recurring_revenue", label: "Monthly recurring revenue", unit: "currency" },
  { id: "activation_rate", label: "Activation rate", unit: "percent" },
  { id: "win_rate", label: "Win rate", unit: "percent" },
  { id: "nrr", label: "Net revenue retention", unit: "percent" },
  { id: "grr", label: "Gross revenue retention", unit: "percent" },
  { id: "cac", label: "Customer acquisition cost", unit: "currency" },
  { id: "cac_payback_months", label: "CAC payback", unit: "months" },
  { id: "ltv_cac_ratio", label: "LTV / CAC", unit: "ratio" },
  { id: "sales_cycle_days", label: "Sales cycle", unit: "days" },
  { id: "burn_multiple", label: "Burn multiple", unit: "ratio" },
];

const HORIZONS = [
  { value: "30", label: "30 days" },
  { value: "60", label: "60 days" },
  { value: "90", label: "90 days" },
  { value: "180", label: "6 months" },
  { value: "365", label: "1 year" },
];

/** One token per real unit.
 *
 *  `days` used to render as "months" and BOTH `sales_cycle_days` and
 *  `cac_payback_months` shared it — so an operator typing a 45-day sales
 *  cycle read back "45 months", a 30x misstatement in the one sentence they
 *  are asked to confirm, and the number the whole loop is then measured
 *  against. */
const UNIT_HINT: Record<string, string> = {
  currency: "$", percent: "%", days: "days", months: "months", ratio: "×",
};

function kpiOf(id: string) {
  return KPIS.find((k) => k.id === id) ?? KPIS[0];
}

/** The number as the operator typed it, formatted back for the summary line
 *  — no rounding, no unit invention beyond the KPI's own. */
export function formatKpiValue(id: string, n: number): string {
  const { unit } = kpiOf(id);
  if (unit === "currency") return `$${n.toLocaleString()}`;
  if (unit === "percent") return `${n}%`;
  if (unit === "ratio") return `${n}×`;
  if (unit === "days") return `${n} days`;
  return `${n} months`;
}

interface Props {
  companyId: string;
  /** The enrichment's guess at what's in the way, if the site said enough to
   *  make one. Prefilled so the operator CORRECTS rather than composes —
   *  and it is only ever a prefill, because the site does not know. */
  hypothesis: string | null;
  /** Mirrors the current beat AND whatever has been answered into the
   *  canvas, so the goal visibly assembles instead of appearing all at once
   *  after the phase is already over. */
  onAsk: (asking: StrategyAsk, draft?: StrategyDraftPatch) => void;
  /** Stated. The summary line is the caller's to print. */
  onDone: (summary: { kpiId: string; label: string; current: number; target: number; days: number }) => void;
  /** Declined. Nothing was posted; the fallback will mark itself. */
  onSkip: () => void;
}

export function StrategyCard({ companyId, hypothesis, onAsk, onDone, onSkip }: Props) {
  const [ask, setAsk] = useState<StrategyAsk>("kpi");
  const [kpiId, setKpiId] = useState<string[]>([]);
  const [current, setCurrent] = useState("");
  const [target, setTarget] = useState("");
  const [days, setDays] = useState<string[]>(["90"]);
  const [bottleneck, setBottleneck] = useState(hypothesis ?? "");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const kpi = kpiOf(kpiId[0] ?? "");
  const chosen = kpiId.length > 0;

  /** The canvas mirror. `num` returns null rather than NaN for a half-typed
   *  field — the pane must render a blank slot, never `NaN`. */
  const num = (v: string) => (v.trim() === "" || !Number.isFinite(Number(v)) ? null : Number(v));
  function advance(next: StrategyAsk, patch?: StrategyDraftPatch): void {
    setAsk(next);
    onAsk(next, patch);
  }

  function decline(): void {
    // No POST. An unstated goal must reach the server as ABSENT, not as a
    // zero — absent is what makes the fallback mark itself.
    onSkip();
  }

  async function handleSubmit(): Promise<void> {
    const c = Number(current), t = Number(target), d = Number(days[0] ?? "90");
    if (!chosen || !Number.isFinite(c) || !Number.isFinite(t) || !d) return;
    setSubmitting(true);
    setError(null);
    try {
      await wavexOsOnboardingApi.strategy({
        companyId,
        goal: { kpiId: kpi.id, current: c, target: t, days: d },
        bottleneck: bottleneck.trim() || null,
        stated: true,
      });
      onDone({ kpiId: kpi.id, label: kpi.label, current: c, target: t, days: d });
    } catch (e) {
      setError(e instanceof ApiError ? e.message : (e as Error).message);
    } finally {
      setSubmitting(false);
    }
  }

  const numberField = (value: string, set: (v: string) => void, label: string, testId: string) => (
    <label style={{ display: "flex", alignItems: "center", gap: "var(--space-2)", fontSize: 11, color: "var(--text-dim)" }}>
      <span style={{ minWidth: 52, fontWeight: 600 }}>{label}</span>
      <span style={{ color: "var(--text-dim)" }}>{UNIT_HINT[kpi.unit] === "$" ? "$" : ""}</span>
      <input
        type="number" inputMode="decimal" value={value} data-testid={testId}
        onChange={(e) => set(e.target.value)} disabled={submitting}
        style={{ width: 130, fontSize: "var(--text-sm)" }} aria-label={label}
      />
      <span>{UNIT_HINT[kpi.unit] === "$" ? "" : UNIT_HINT[kpi.unit]}</span>
    </label>
  );

  return (
    <div style={{ marginTop: "0.5rem", display: "flex", flexDirection: "column", gap: "0.8rem" }}>
      <div>
        <div style={{ fontSize: 11, fontWeight: 600, marginBottom: "0.35rem", color: "var(--text-dim)" }}>
          {COPY.strategy.kpi}
        </div>
        <ResponseChips
          mode="single"
          options={KPIS.map((k) => ({ value: k.id, label: k.label }))}
          values={kpiId}
          customValues={[]}
          // No custom KPI: the server rejects an id the runtime cannot name,
          // and a goal measured by a KPI nothing tracks is not a goal.
          onChange={(v) => {
            setKpiId(v);
            if (v.length) advance("current", { kpiId: v[0], label: kpiOf(v[0]).label });
          }}
          onCustomChange={() => {}}
          disabled={submitting}
        />
      </div>

      {chosen && (
        <div style={{ display: "flex", flexDirection: "column", gap: "0.55rem" }}>
          {numberField(current, (v) => {
            setCurrent(v);
            advance(ask === "current" ? "target" : ask, { current: num(v) });
          }, "Today", "strategy-current")}
          {numberField(target, (v) => {
            setTarget(v);
            advance(ask, { target: num(v), days: Number(days[0] ?? "90") });
          }, "Target", "strategy-target")}
          <div>
            <div style={{ fontSize: 11, fontWeight: 600, marginBottom: "0.35rem", color: "var(--text-dim)" }}>By when</div>
            <ResponseChips
              mode="single" options={HORIZONS} values={days} customValues={[]}
              onChange={(v) => {
                const next = v.length ? v : ["90"];
                setDays(next);
                advance(ask === "bottleneck" ? ask : "bottleneck", { days: Number(next[0]) });
              }}
              onCustomChange={() => {}} disabled={submitting}
            />
          </div>
        </div>
      )}

      {chosen && (
        <div>
          <div style={{ fontSize: 11, fontWeight: 600, marginBottom: "0.35rem", color: "var(--text-dim)" }}>
            {COPY.strategy.bottleneck}
          </div>
          <textarea
            value={bottleneck} onChange={(e) => setBottleneck(e.target.value)}
            onFocus={() => advance("bottleneck")}
            rows={2} maxLength={400} disabled={submitting} data-testid="strategy-bottleneck"
            aria-label="What's in the way"
            style={{ width: "100%", fontSize: "var(--text-sm)", resize: "none" }}
          />
          <div className="text-dim" style={{ fontSize: 11, marginTop: "0.25rem" }}>
            {COPY.strategy.bottleneckHint}
          </div>
        </div>
      )}

      {error && <div style={{ color: "var(--warning)", fontSize: 12 }}>✗ {error}</div>}

      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: "var(--space-2)" }}>
        <button type="button" className="secondary" onClick={decline} disabled={submitting}
          data-testid="strategy-skip"
          style={{ background: "none", border: "none", padding: 0, fontSize: 11, color: "var(--text-dim)", textDecoration: "underline", cursor: "pointer" }}>
          {COPY.strategy.skip}
        </button>
        <button
          type="button" data-testid="strategy-submit" onClick={() => void handleSubmit()}
          disabled={submitting || !chosen || current === "" || target === ""}
          style={{
            padding: "0.4rem 0.85rem", borderRadius: 6, background: "var(--accent)", color: "var(--bg)",
            border: "none", fontWeight: 600, fontSize: 12,
            cursor: submitting ? "not-allowed" : "pointer",
            opacity: submitting || !chosen || current === "" || target === "" ? 0.6 : 1,
          }}>
          {submitting ? "Saving…" : "Continue →"}
        </button>
      </div>
    </div>
  );
}
