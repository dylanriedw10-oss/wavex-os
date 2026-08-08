/** Canvas cell renderers.
 *
 *  Rules enforced here:
 *  - Every number on screen comes from an endpoint via the typed client —
 *    cells fetch their own data; the composer only chose the arrangement.
 *  - Empty ≠ error: statuses listed in EMPTY_STATUSES render a quiet
 *    "nothing yet" state (token-usage 404s until the first T2 call, etc.).
 *  - Drill actions are conversation: clicking one SENDS its prompt as the
 *    operator's next message. No client-side drill logic.
 *  - Assistant prose renders as plain text (pre-wrap). No markdown, no HTML —
 *    the app has no sanitizer and we keep its zero-XSS posture. */

import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { wavexOsOnboardingApi, ApiError } from "../wavex-os/lib/api";
import { EMPTY_STATUSES, type CatalogKey, type CellSpec, type CanvasProposal, type SinceSnapshot } from "./contract";

/* ---- shared formatters (third duplication of TokenCounter/BudgetChip avoided) ---- */
export function formatTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
  return String(n);
}
export function formatCost(usd: number): string {
  if (usd > 0 && usd < 0.01) return "<$0.01";
  return `$${usd.toFixed(usd < 1 ? 3 : 2)}`;
}
/** ISO → operator-local "MM-DD HH:mm". Raw ISO slices display UTC, which
 *  reads as "my decision is timestamped 7 hours ago". */
export function fmtLocalTs(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso.slice(5, 16).replace("T", " ");
  const p = (n: number) => String(n).padStart(2, "0");
  return `${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}
/** Elapsed duration for live rows: "for 42m" reads; a raw start time asks
 *  the reader to do arithmetic. */
export function fmtElapsed(iso: string): string {
  const ms = Date.now() - Date.parse(iso);
  if (!Number.isFinite(ms) || ms < 0) return "—";
  const m = Math.floor(ms / 60_000);
  return m < 60 ? `${m}m` : `${Math.floor(m / 60)}h ${m % 60}m`;
}

const REDUCE = typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;

/** The liveness mark: a breathing teal dot. --live's one job made visible. */
function LiveDot() {
  return (
    <span aria-hidden className={REDUCE ? undefined : "cv-breathe"}
      style={{ display: "inline-block", width: 7, height: 7, borderRadius: "50%", background: "var(--live)", marginRight: 6, verticalAlign: "middle" }} />
  );
}

/* ---- binding hook: one fetch path for every bound cell ---- */
const FETCHERS: Record<CatalogKey, (companyId: string) => Promise<unknown>> = {
  "token-usage": (c) => wavexOsOnboardingApi.tokenUsage(c),
  "token-budget": (c) => wavexOsOnboardingApi.getTokenBudget(c),
  "obs-mission-control": (c) => wavexOsOnboardingApi.obsMissionControl(c),
  "obs-budget": (c) => wavexOsOnboardingApi.obsBudget(c),
  "obs-bottlenecks": (c) => wavexOsOnboardingApi.obsBottlenecks(c),
  "kpis": (c) => wavexOsOnboardingApi.getInstanceKpis(c),
  "manifest": (c) => wavexOsOnboardingApi.getInstanceManifest(c),
  "redundancy": (c) => wavexOsOnboardingApi.getRedundancy(c),
  "ignition": (c) => wavexOsOnboardingApi.getIgnitionStatus(c),
  "mc-report": (c) => wavexOsOnboardingApi.getMcReport(c),
  "runtime-dashboard": (c) => wavexOsOnboardingApi.getRuntimeDashboard(c),
  "runtime-activity": (c) => wavexOsOnboardingApi.getRuntimeActivity(c),
  "runtime-approvals": (c) => wavexOsOnboardingApi.getRuntimeApprovals(c),
  "runtime-live-runs": (c) => wavexOsOnboardingApi.getRuntimeLiveRuns(c),
};

type BindState =
  | { kind: "loading" }
  | { kind: "empty" }
  | { kind: "error"; message: string; retry: () => void }
  /** staleError set = the refetch failed but we still hold the last good
   *  data. Never throw away what we had — render it dimmed, say its age. */
  | { kind: "data"; data: any; fetchedAt: number; fetching: boolean; staleError: string | null; retry: () => void };

/** Live bindings poll; settled ones refetch only on invalidation. The
 *  provenance footer makes the cadence visible, so polling earns its cost. */
const POLL_MS: Partial<Record<CatalogKey, number>> = {
  "runtime-dashboard": 30_000,
  "runtime-activity": 30_000,
  "runtime-approvals": 30_000,
  "runtime-live-runs": 30_000,
  "token-usage": 60_000,
  "token-budget": 60_000,
};

function useBinding(api: CatalogKey | undefined, companyId: string): BindState {
  const q = useQuery({
    enabled: !!api,
    queryKey: ["canvas-bind", api, companyId],
    queryFn: () => FETCHERS[api!](companyId),
    staleTime: 15_000,
    retry: false,
    refetchOnWindowFocus: false,
    refetchInterval: api ? POLL_MS[api] : undefined,
  });
  if (!api) return { kind: "empty" };
  const retry = () => void q.refetch();
  if (q.isError) {
    const e = q.error;
    if (e instanceof ApiError && e.status && EMPTY_STATUSES[api].includes(e.status)) {
      return { kind: "empty" };
    }
    const message = e instanceof ApiError ? e.message : (e as Error).message;
    // A refetch failure with data in hand is a stale frame, not an error.
    if (q.data !== undefined) {
      return { kind: "data", data: q.data, fetchedAt: q.dataUpdatedAt, fetching: q.isFetching, staleError: message, retry };
    }
    // retry:false + no refetch trigger meant a transient failure froze the
    // cell in its error state until a full page reload. Recovery is a cell
    // concern, so the affordance lives in the cell.
    return { kind: "error", message, retry };
  }
  if (q.isLoading || q.data === undefined) return { kind: "loading" };
  return { kind: "data", data: q.data, fetchedAt: q.dataUpdatedAt, fetching: q.isFetching, staleError: null, retry };
}

/** Provenance: which side of the seam a number came from. */
function srcLabel(api: CatalogKey): string {
  if (api.startsWith("runtime-")) return "runtime";
  if (api.startsWith("obs-")) return "observability";
  return "instance";
}

function fmtAgo(ts: number): string {
  const s = Math.max(0, Math.round((Date.now() - ts) / 1000));
  if (s < 10) return "just now";
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  return `${Math.floor(m / 60)}h ago`;
}

/** Delta-since-you-last-looked. Neutral ink by design: whether a change is
 *  good depends on the number (spend up ≠ progress up), so the chip states
 *  the change and lets the reader judge. Zero deltas stay silent. */
function SinceDelta({ cell, since, current, fmt }: {
  cell: CellSpec; since?: SinceSnapshot; current: number | null | undefined;
  fmt: (n: number) => string;
}) {
  const prior = since?.values?.[cell.id];
  if (prior === undefined || current == null || !Number.isFinite(current) || current === prior) return null;
  const d = current - prior;
  return (
    <div className="text-dim" style={{ fontSize: "var(--text-xs)", marginTop: 4, fontVariantNumeric: "tabular-nums" }}>
      <span aria-hidden>{d > 0 ? "▲" : "▼"}</span>
      <span aria-label={d > 0 ? "up" : "down"}> {d > 0 ? "+" : "−"}{fmt(Math.abs(d))}</span>
      <span> since {fmtLocalTs(since!.taken_at)}</span>
    </div>
  );
}

/* ---- chrome shared by every cell ----
 * Background + border live in .cv-glass (styles.css) so the glass recipe,
 * its no-blur fallback, and prefers-reduced-transparency stay in one place. */
const cellStyle: CSSProperties = {
  borderRadius: "var(--radius-lg)", padding: "var(--space-4) var(--space-5)",
  minWidth: 0, display: "flex", flexDirection: "column", gap: "var(--space-3)",
};

function Shell({ cell, state, onDrill, children }: {
  cell: CellSpec; state?: BindState; onDrill: (prompt: string) => void; children?: ReactNode;
}) {
  // Value-change settle: when a refetch delivers DIFFERENT data under the
  // same layout, the content pulses once. Same fetch, same data → nothing.
  const [settle, setSettle] = useState(0);
  const prevRef = useRef<{ at: number; hash: string } | null>(null);
  const isData = state?.kind === "data";
  const fetchedAt = isData ? state.fetchedAt : 0;
  const hash = isData ? JSON.stringify(state.data) : "";
  useEffect(() => {
    if (!isData) return;
    const prev = prevRef.current;
    if (prev && prev.at !== fetchedAt && prev.hash !== hash) setSettle((n) => n + 1);
    prevRef.current = { at: fetchedAt, hash };
  }, [fetchedAt]); // eslint-disable-line react-hooks/exhaustive-deps
  const staleError = isData ? state.staleError : null;
  return (
    <div className="cv-glass" style={{
      ...cellStyle,
      gridColumn: cell.span === 2 ? "1 / -1" : undefined,
      // Salience is the composer's emphasis: 2 = the point of the workspace,
      // 0 = ambient context. Emphasis is the mind speaking — violet.
      borderLeft: cell.salience === 2 ? "3px solid var(--mind)" : undefined,
      opacity: cell.salience === 0 ? 0.75 : undefined,
    }}>
      {cell.title && (
        <div style={{ fontSize: "var(--text-xs)", textTransform: "uppercase", letterSpacing: ".1em", fontWeight: 600, color: "var(--text-dim)" }}>
          {cell.title}
        </div>
      )}
      {state?.kind === "loading" && (
        <div aria-label="loading" style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          <div className="cv-skeleton" style={{ height: 20, width: "56%" }} />
          <div className="cv-skeleton" style={{ height: 10, width: "38%" }} />
        </div>
      )}
      {state?.kind === "empty" && <span className="text-dim" style={{ fontSize: "var(--text-sm)" }}>Nothing here yet.</span>}
      {state?.kind === "error" && (
        // A failed read is degraded and retryable — amber, not red. Coral is
        // reserved for failed mutations and blocked states.
        <span style={{ fontSize: "var(--text-sm)", color: "var(--attend)", display: "flex", alignItems: "center", gap: "var(--space-2)", flexWrap: "wrap" }}>
          ✗ {state.message}
          <button className="secondary" onClick={state.retry}
            style={{ fontSize: "var(--text-xs)", padding: "2px 8px", minHeight: 24 }}>
            Retry
          </button>
        </span>
      )}
      {(!state || state.kind === "data") && (
        <div key={settle} className={settle > 0 ? "cv-settle" : undefined}
          style={{
            display: "flex", flexDirection: "column", gap: "var(--space-2)", minWidth: 0,
            // A stale frame dims hardest; an in-flight refetch dims gently.
            // The frame is kept either way — no skeleton, no layout jump.
            opacity: staleError ? 0.65 : isData && state.fetching ? 0.85 : 1,
            transition: "opacity var(--dur-base) var(--ease)",
          }}>
          {children}
        </div>
      )}
      {staleError && isData && (
        <div style={{ display: "flex", alignItems: "center", gap: "var(--space-2)", fontSize: "var(--text-xs)", color: "var(--attend)", flexWrap: "wrap" }}>
          ⚠ couldn't refresh — showing data from {fmtAgo(state.fetchedAt)}
          <button className="secondary" onClick={state.retry}
            style={{ fontSize: "var(--text-xs)", padding: "2px 8px", minHeight: 22 }}>
            Retry
          </button>
        </div>
      )}
      {cell.drill && cell.drill.length > 0 && (
        <div style={{ display: "flex", gap: "var(--space-2)", flexWrap: "wrap", marginTop: "var(--space-1)" }}>
          {cell.drill.map((d) => (
            <button key={d.label} className="secondary" onClick={() => onDrill(d.prompt)}
              style={{ fontSize: "var(--text-xs)", padding: "4px 10px", minHeight: 28 }}>
              {d.label} →
            </button>
          ))}
        </div>
      )}
      {isData && cell.source && (
        // Provenance: which side of the seam, and how fresh. The two-tables
        // problem (wavex vs runtime counts) stays visible instead of silent.
        <div className="text-dim" style={{ fontSize: "10px", letterSpacing: ".04em", textAlign: "right", opacity: 0.75, marginTop: "auto" }}>
          {srcLabel(cell.source.api)} · {fmtAgo(state.fetchedAt)}
        </div>
      )}
    </div>
  );
}

/** Stat-tile value: proportional figures at display size (tabular-nums makes
 *  every digit as wide as a 0 and reads loose); tabular is reserved for
 *  columns that must align. */
function Big({ value, sub }: { value: string; sub?: string }) {
  return (
    <div>
      <div style={{ fontSize: "var(--text-2xl)", fontWeight: 700, letterSpacing: "-.02em", lineHeight: 1.1, fontVariantNumeric: "tabular-nums" }}>{value}</div>
      {sub && <div className="text-dim" style={{ fontSize: "var(--text-xs)", marginTop: 2 }}>{sub}</div>}
    </div>
  );
}

/** 12-point micro-sparkline for stat tiles: history is a dim line; only the
 *  current point is alive. */
function MicroSpark({ vals }: { vals: number[] }) {
  if (vals.length < 2) return null;
  const max = Math.max(...vals, 1);
  const y = (v: number) => 22 - (v / max) * 18;
  const pts = vals.map((v, i) => `${(i / (vals.length - 1)) * 100},${y(v)}`).join(" ");
  const lastTop = (y(vals[vals.length - 1]) / 24) * 100;
  return (
    <div style={{ position: "relative", width: 120, marginTop: 8 }}>
      <svg viewBox="0 0 100 24" preserveAspectRatio="none" style={{ width: "100%", height: 24, display: "block" }} aria-hidden>
        <polyline points={pts} fill="none" stroke="var(--ink-dim)" strokeOpacity="0.5" strokeWidth="1.6" strokeLinejoin="round" strokeLinecap="round" vectorEffect="non-scaling-stroke" />
      </svg>
      <span aria-hidden style={{ position: "absolute", right: 0, top: `${lastTop}%`, width: 7, height: 7, borderRadius: "50%", background: "var(--live)", boxShadow: "0 0 0 2px var(--surface)", transform: "translate(50%, -50%)" }} />
    </div>
  );
}

/** Meter per spec: the unfilled track is a lighter step of the fill's own
 *  color, so state reads across the whole bar. */
function Meter({ pct, tone = "var(--ink)" }: { pct: number; tone?: string }) {
  return (
    <div style={{ height: 5, background: `color-mix(in srgb, ${tone} 14%, transparent)`, borderRadius: 999, marginTop: 8, overflow: "hidden" }}>
      <div style={{ height: "100%", width: `${Math.max(0, Math.min(100, pct))}%`, borderRadius: "0 999px 999px 0", background: tone }} />
    </div>
  );
}

/** Numeric columns right-align (headers too); identity column carries ink,
 *  the rest stay quiet. `align` is per-column: "l" | "r". */
function Rows({ head, rows, align }: { head: string[]; rows: Array<Array<ReactNode>>; align?: Array<"l" | "r"> }) {
  if (rows.length === 0) return <span className="text-dim" style={{ fontSize: "var(--text-sm)" }}>Nothing here yet.</span>;
  const a = (j: number) => (align?.[j] === "r" ? "right" : "left") as "right" | "left";
  return (
    <div style={{ overflowX: "auto" }}>
      <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "var(--text-sm)" }}>
        <thead><tr>{head.map((h, j) => (
          <th key={h} style={{ textAlign: a(j), padding: "4px 8px", color: "var(--text-dim)", fontSize: "10px", textTransform: "uppercase", letterSpacing: ".06em", borderBottom: "1px solid var(--border)" }}>{h}</th>
        ))}</tr></thead>
        <tbody>{rows.map((r, i) => (
          <tr key={i}>{r.map((c, j) => (
            <td key={j} style={{ padding: "5px 8px", borderBottom: "1px solid var(--border)", textAlign: a(j), fontVariantNumeric: "tabular-nums", color: j === 0 ? "var(--text)" : undefined }}>{c}</td>
          ))}</tr>
        ))}</tbody>
      </table>
    </div>
  );
}

/** Breakdown: a horizontal bar list for "where did it go" questions — far
 *  more scannable than a table of numbers. Magnitude is length (single hue);
 *  only the loudest row wears full ink (emphasis form). Bars grow from one
 *  baseline: square there, 4px rounded at the data end. */
function Breakdown({ rows }: { rows: Array<{ label: string; value: number; display: string; sub?: string; detail?: string }> }) {
  // The mark is the hit target: the whole row responds, the hovered bar
  // lifts, and the tooltip carries the detail that doesn't fit inline.
  const [hover, setHover] = useState<number | null>(null);
  if (rows.length === 0) return <span className="text-dim" style={{ fontSize: "var(--text-sm)" }}>Nothing here yet.</span>;
  const sorted = [...rows].sort((x, y) => y.value - x.value);
  const max = Math.max(...sorted.map((r) => r.value), 1);
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 7 }}>
      {sorted.map((r, i) => (
        <div key={r.label}
          onMouseEnter={() => setHover(i)} onMouseLeave={() => setHover(null)}
          style={{ position: "relative", display: "grid", gridTemplateColumns: "140px 1fr 110px", gap: "var(--space-3)", alignItems: "center", fontSize: "var(--text-sm)", minHeight: 24 }}>
          <span style={{ fontSize: "var(--text-xs)", color: i === 0 ? "var(--text)" : "var(--text-dim)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            {r.label}
          </span>
          <span aria-hidden style={{
            height: 8, borderRadius: "0 4px 4px 0", width: `${Math.max(1.5, (r.value / max) * 100)}%`,
            background: i === 0 ? "color-mix(in srgb, var(--ink) 75%, transparent)" : "color-mix(in srgb, var(--ink) 24%, transparent)",
            filter: hover === i ? "brightness(1.2)" : undefined,
            transition: "filter var(--dur-fast)",
          }} />
          <span style={{ textAlign: "right", whiteSpace: "nowrap", fontVariantNumeric: "tabular-nums", color: i === 0 ? "var(--text)" : "var(--text-dim)" }}>
            {r.display}{r.sub && <span className="text-dim" style={{ fontSize: "var(--text-xs)" }}> · {r.sub}</span>}
          </span>
          {hover === i && r.detail && (
            <div className="cv-tip" role="status" style={{ bottom: "calc(100% + 2px)", right: 0 }}>
              <strong>{r.display}</strong>
              <span className="text-dim"> · {r.detail}</span>
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

/* ---- per-type renderers ---- */

/** One normalized reading per binding — the metric family's raw material.
 *  Variants are EXPRESSIONS of a reading; what a variant needs but the
 *  reading lacks degrades down the ladder (gauge without a cap → hero). */
interface MetricReading {
  value: number | null;
  display: string;
  sub?: string;
  fmt: (n: number) => string;
  cap?: number | null;
  target?: number | null;
  days?: number | null;
  series?: number[];
  breakdown?: Array<{ label: string; value: number; display: string }>;
  live?: boolean;
}

function readMetric(api: CatalogKey, d: any): MetricReading | null {
  switch (api) {
    case "token-usage": {
      const t = d.usage.total;
      const v = t.input_tokens + t.output_tokens;
      return {
        value: v, display: formatTokens(v), sub: `${formatCost(t.cost_usd)} · ${t.calls} calls`, fmt: formatTokens,
        series: (d.usage.recent_calls as any[]).slice(-12).map((c) => c.input_tokens + c.output_tokens),
        breakdown: Object.entries(d.usage.by_phase as Record<string, any>)
          .map(([label, a]) => ({ label, value: a.input_tokens + a.output_tokens, display: formatTokens(a.input_tokens + a.output_tokens) })),
        live: true,
      };
    }
    case "token-budget": {
      const cap = d.budget.cap_tokens as number | null;
      const used = d.used as number;
      const pct = cap ? Math.min(100, Math.round((used / cap) * 100)) : null;
      return { value: used, display: formatTokens(used), sub: cap ? `of ${formatTokens(cap)} cap (${pct}%)` : "no cap set", fmt: formatTokens, cap };
    }
    case "manifest": {
      const g = d.manifest?.goal;
      // The sub-line is the only room this cell has, so provenance goes
      // there. `stated !== true` covers the absent flag: the live manifest
      // carries a stage-band pair with no `stated` key at all.
      const guessed = g != null && g.stated !== true;
      return { value: g?.current ?? null, display: g?.current != null ? g.current.toLocaleString() : "—",
        sub: g?.target != null ? `target ${g.target.toLocaleString()}${guessed ? " · estimated, not stated" : ""}` : "no goal",
        fmt: (n) => n.toLocaleString(), target: g?.target ?? null, days: g?.days ?? null };
    }
    case "kpis": {
      const k = d.kpis?.[0];
      const prov = k?.provenance && k.provenance !== "measured" ? ` · ${k.provenance}` : "";
      return { value: k?.currentValue ?? null, display: k?.currentValue != null ? String(k.currentValue) : "—",
        sub: k?.label != null ? `${k.label}${prov}` : "no KPI", fmt: String };
    }
    case "ignition":
      return { value: d.agentsWorking ?? null, display: String(d.agentsWorking ?? 0), sub: `agents working · ${d.status}`, fmt: String };
    case "obs-budget": {
      const w = d.data?.windows;
      return { value: w?.last24h?.burnCents ?? null, display: w ? `$${(w.last24h.burnCents / 100).toFixed(2)}` : "—", sub: "burn, last 24h", fmt: (n) => `$${(n / 100).toFixed(2)}` };
    }
    case "obs-mission-control": {
      const ft = d.data?.fleetTotals;
      return { value: ft?.agents ?? null, display: String(ft?.agents ?? 0), sub: `agents · ${ft?.runs24h ?? 0} runs 24h`, fmt: String };
    }
    case "runtime-dashboard": {
      const db = d.dashboard ?? {};
      const t = db.tasks ?? {};
      return {
        value: db.agents?.running ?? null, display: String(db.agents?.running ?? 0),
        sub: `of ${db.agents?.active ?? 0} agents running · ${t.blocked ?? 0} blocked · ${db.pendingApprovals ?? 0} approval${(db.pendingApprovals ?? 0) === 1 ? "" : "s"} pending`,
        fmt: String,
        series: ((db.runActivity as Array<{ total?: number }>) ?? []).map((r) => r.total ?? 0).slice(-12),
        breakdown: [
          { label: "open", value: t.open ?? 0, display: String(t.open ?? 0) },
          { label: "in progress", value: t.inProgress ?? 0, display: String(t.inProgress ?? 0) },
          { label: "blocked", value: t.blocked ?? 0, display: String(t.blocked ?? 0) },
          { label: "done", value: t.done ?? 0, display: String(t.done ?? 0) },
        ],
        live: true,
      };
    }
    case "runtime-live-runs": {
      const runs = (d.runs as any[]) ?? [];
      return { value: runs.length, display: String(runs.length), sub: "runs in flight", fmt: String, live: true };
    }
    default:
      return null;
  }
}

/** Sensible default expression per binding — preserves the pre-grammar look. */
function defaultMetricVariant(api: CatalogKey, r: MetricReading): string {
  if (api === "token-budget") return "gauge";
  if (r.live && r.series?.length) return "live";
  return "hero";
}

/** The metric family: one primitive, many manifestations (grammar G2).
 *  variant chooses the expression; density gates how much of it shows
 *  (L1 headline · L2 +context/delta · L3 +spark/meter/facets). The
 *  operator can override density in place — an explicit act. */
function MetricCell({ cell, companyId, onDrill, since }: CellProps) {
  const api = cell.source!.api;
  const state = useBinding(api, companyId);
  const [densityOverride, setDensityOverride] = useState<1 | 2 | 3 | null>(null);
  const density = densityOverride ?? cell.density ?? 3;
  let body: ReactNode = null;
  if (state.kind === "data") {
    const r = readMetric(api, state.data);
    if (r) {
      // Degrade ladder: a variant whose data is missing falls back to hero.
      let variant = cell.variant ?? defaultMetricVariant(api, r);
      if (variant === "gauge" && r.cap == null && r.target == null) variant = "hero";
      if (variant === "goal" && r.target == null) variant = "hero";
      if (variant === "delta" && since?.values?.[cell.id] === undefined) variant = "hero";
      if (variant === "live" && !r.series?.length) variant = "hero";
      if (variant === "split" && !r.breakdown?.length) variant = "hero";

      const sub = density >= 2 ? r.sub : undefined;
      const delta = density >= 2 ? <SinceDelta cell={cell} since={since} current={r.value} fmt={r.fmt} /> : null;
      const capBase = r.cap ?? r.target;
      const pct = capBase && r.value != null ? Math.min(100, Math.round((r.value / capBase) * 100)) : null;

      switch (variant) {
        case "gauge":
          body = (
            <div>
              <Big value={r.display} sub={sub} />
              {delta}
              {pct != null && <Meter pct={pct} tone={pct >= 90 ? "var(--attend)" : "var(--ink)"} />}
            </div>
          );
          break;
        case "goal":
          body = (
            <div>
              <div style={{ display: "flex", alignItems: "baseline", gap: "var(--space-2)" }}>
                <span style={{ fontSize: "var(--text-2xl)", fontWeight: 700, letterSpacing: "-.02em", lineHeight: 1.1, fontVariantNumeric: "tabular-nums" }}>{r.display}</span>
                <span className="text-dim" style={{ fontSize: "var(--text-sm)" }}>/ {r.target!.toLocaleString()}</span>
              </div>
              {density >= 2 && pct != null && (
                <div className="text-dim" style={{ fontSize: "var(--text-xs)", marginTop: 2 }}>
                  {pct}% of target{r.days != null ? ` · ${r.days}d horizon` : ""}
                </div>
              )}
              {delta}
              {density >= 3 && pct != null && <Meter pct={pct} tone="var(--good)" />}
            </div>
          );
          break;
        case "delta": {
          const prior = since!.values[cell.id];
          const diff = (r.value ?? prior) - prior;
          body = (
            <div>
              <div style={{ fontSize: "var(--text-2xl)", fontWeight: 700, letterSpacing: "-.02em", lineHeight: 1.1, fontVariantNumeric: "tabular-nums" }}>
                <span aria-hidden>{diff >= 0 ? "▲" : "▼"}</span> {diff >= 0 ? "+" : "−"}{r.fmt(Math.abs(diff))}
              </div>
              {density >= 2 && (
                <div className="text-dim" style={{ fontSize: "var(--text-xs)", marginTop: 2 }}>
                  now {r.display} · since {fmtLocalTs(since!.taken_at)}
                </div>
              )}
              {density >= 3 && r.series && <MicroSpark vals={r.series} />}
            </div>
          );
          break;
        }
        case "live":
          body = (
            <div>
              <Big value={r.display} sub={sub} />
              {delta}
              {density >= 3 && r.series && <MicroSpark vals={r.series} />}
            </div>
          );
          break;
        case "split":
          body = (
            <div>
              <Big value={r.display} sub={sub} />
              {delta}
              {density >= 3 && (
                <div style={{ marginTop: 8, display: "flex", flexDirection: "column", gap: 4 }}>
                  {[...r.breakdown!].sort((a, b) => b.value - a.value).slice(0, 3).map((x, i) => (
                    <div key={x.label} style={{ display: "grid", gridTemplateColumns: "90px 1fr 56px", gap: 8, alignItems: "center", fontSize: "var(--text-xs)" }}>
                      <span className="text-dim" style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{x.label}</span>
                      <span aria-hidden style={{ height: 5, borderRadius: "0 3px 3px 0", width: `${Math.max(2, (x.value / Math.max(...r.breakdown!.map((b) => b.value), 1)) * 100)}%`, background: i === 0 ? "var(--ink)" : "color-mix(in srgb, var(--ink) 30%, transparent)" }} />
                      <span className="text-dim" style={{ textAlign: "right", fontVariantNumeric: "tabular-nums" }}>{x.display}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          );
          break;
        default: // hero
          body = (
            <div>
              <Big value={r.display} sub={sub} />
              {delta}
            </div>
          );
      }
      body = (
        <div style={{ position: "relative" }}>
          {body}
          {/* Density is operator-overridable in place — an explicit act. */}
          <div style={{ position: "absolute", top: 0, right: 0, display: "flex", gap: 4 }}>
            {density > 1 && (
              <button className="secondary" aria-label="Show less detail"
                onClick={() => setDensityOverride(Math.max(1, density - 1) as 1 | 2 | 3)}
                style={{ fontSize: "var(--text-xs)", padding: "0 7px", minHeight: 20, lineHeight: "18px", opacity: 0.6 }}>−</button>
            )}
            {density < 3 && (
              <button className="secondary" aria-label="Show more detail"
                onClick={() => setDensityOverride(Math.min(3, density + 1) as 1 | 2 | 3)}
                style={{ fontSize: "var(--text-xs)", padding: "0 7px", minHeight: 20, lineHeight: "18px", opacity: 0.6 }}>+</button>
            )}
          </div>
        </div>
      );
    }
  }
  return <Shell cell={cell} state={state} onDrill={onDrill}>{body}</Shell>;
}

function TableCell({ cell, companyId, onDrill }: CellProps) {
  const api = cell.source!.api;
  const view = cell.source!.params?.view;
  const state = useBinding(api, companyId);
  let body: ReactNode = null;
  if (state.kind === "data") {
    const d = state.data;
    if (api === "token-usage" && view === "breakdown") {
      body = <Breakdown rows={Object.entries(d.usage.by_phase as Record<string, any>)
        .map(([phase, a]) => ({
          label: phase, value: a.input_tokens + a.output_tokens,
          display: formatTokens(a.input_tokens + a.output_tokens), sub: formatCost(a.cost_usd),
          detail: `${a.calls} call${a.calls === 1 ? "" : "s"} · ${formatTokens(a.input_tokens)} in / ${formatTokens(a.output_tokens)} out`,
        }))} />;
    } else if (api === "token-usage") {
      const rows = Object.entries(d.usage.by_phase as Record<string, any>)
        .map(([phase, a]) => [phase, formatTokens(a.input_tokens + a.output_tokens), formatCost(a.cost_usd), a.calls])
        .sort((a, b) => Number(b[3]) - Number(a[3]));
      body = <Rows head={["Phase", "Tokens", "Cost", "Calls"]} align={["l", "r", "r", "r"]} rows={rows} />;
    } else if (api === "redundancy" && view === "groups") {
      body = <Rows head={["Template", "Slots", "Weight"]} align={["l", "l", "r"]}
        rows={(d.groups as any[]).map((g) => [g.template_id, g.slots.map((s: any) => s.slot).join(", "), g.weight])} />;
    } else if (api === "redundancy") {
      body = <Rows head={["Slot", "Template", "Origin"]}
        rows={(d.all_slots as any[]).filter((s) => !s.muted).map((s) => [s.slot, s.template_id, s.origin])} />;
    } else if (api === "kpis") {
      // "Current" is a measurement word and none of these rows earned it —
      // the pillar-3 baselines are stage-band estimates and the MC row is a
      // forecast. The column now says which, per row, because the alternative
      // is a fabricated constant sitting in a table an agent reads as fact.
      body = <Rows head={["KPI", "Direction", "Owner", "Value", "Source"]} align={["l", "l", "l", "r", "l"]}
        rows={(d.kpis as any[]).map((k) => [k.label, k.direction === "higher_is_better" ? "↑" : "↓", k.ownerRole ?? "—", k.currentValue ?? "—", k.provenance ?? "unknown"])} />;
    } else if (api === "obs-bottlenecks") {
      body = <Rows head={["KPI", "Owner", "Gap", "Score"]} align={["l", "l", "r", "r"]}
        rows={(d.data as any[]).map((b) => [b.label, b.ownerName ?? "—", b.gap ?? "—", Math.round(b.score)])} />;
    } else if (api === "obs-mission-control") {
      body = <Rows head={["Agent", "Burn 24h", "Runs", "Done"]} align={["l", "r", "r", "r"]}
        rows={(d.data?.topBurners as any[] ?? []).map((a) => [a.name, `$${(a.burnCents24h / 100).toFixed(2)}`, a.runs24h, a.done24h])} />;
    } else if (api === "runtime-live-runs") {
      // Field names are defensive: run summaries vary across Paperclip
      // endpoints (agentName vs agent_name_key, camel vs snake timestamps).
      // Running rows carry the breathing live mark; duration reads as
      // elapsed ("for 42m") instead of asking the reader to do arithmetic.
      const runs = (d.runs as any[]) ?? [];
      body = (
        <div>
          <Rows head={["Agent", "Working on", "Status", "Running"]} align={["l", "l", "l", "r"]}
            rows={runs.slice(0, 12).map((r) => [
              r.agentName ?? r.agent_name_key ?? r.agentId ?? "—",
              r.issueTitle ?? r.issue_title ?? r.issueIdentifier ?? r.issue_id ?? "—",
              (r.status ?? "running") === "running"
                ? <span><LiveDot />running</span>
                : r.status,
              `for ${fmtElapsed(r.startedAt ?? r.started_at ?? r.createdAt ?? "")}`,
            ])} />
          {runs.length > 12 && (
            <div className="text-dim" style={{ fontSize: "var(--text-xs)", marginTop: 6 }}>…and {runs.length - 12} more running</div>
          )}
        </div>
      );
    } else if (api === "runtime-activity") {
      const events = (d.events as any[]) ?? [];
      body = (
        <div>
          <Rows head={["When", "Actor", "Action", "On"]} align={["l", "l", "l", "l"]}
            rows={events.slice(0, 12).map((e) => [
              fmtLocalTs(e.createdAt ?? e.created_at ?? ""),
              e.actorType ?? "—",
              e.action ?? "—",
              e.entityType ?? "—",
            ])} />
          {events.length > 12 && (
            <div className="text-dim" style={{ fontSize: "var(--text-xs)", marginTop: 6 }}>…and {events.length - 12} earlier</div>
          )}
        </div>
      );
    } else if (api === "ignition") {
      // The plan primitive's real shape: activate's step ledger as a
      // checklist. Emerald = done (a confirmed state), amber = deferred,
      // coral = failed — glyph + word, never color alone.
      const steps = Object.entries((d.steps as Record<string, { status?: string; created?: string[] }>) ?? {});
      body = steps.length === 0 ? (
        <span className="text-dim" style={{ fontSize: "var(--text-sm)" }}>Not activated yet — no plan to show.</span>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          {steps.map(([name, s]) => {
            const st = s?.status ?? "pending";
            const [glyph, tone] = st === "done" ? ["✓", "var(--good)"]
              : st === "failed" ? ["✗", "var(--crit)"]
              : st === "deferred" ? ["○", "var(--attend)"]
              : ["○", "var(--text-dim)"];
            return (
              <div key={name} style={{ display: "flex", alignItems: "baseline", gap: 10, fontSize: "var(--text-sm)" }}>
                <span aria-hidden style={{ color: tone, width: 14, textAlign: "center", flex: "none" }}>{glyph}</span>
                <span style={{ minWidth: 0 }}>{name.replace(/_/g, " ")}</span>
                {(s?.created?.length ?? 0) > 0 && (
                  <span className="text-dim" style={{ fontSize: "var(--text-xs)" }}>{s!.created!.length} created</span>
                )}
                <span className="text-dim" style={{ marginLeft: "auto", fontSize: "var(--text-xs)" }}>{st}</span>
              </div>
            );
          })}
        </div>
      );
    } else if (api === "runtime-dashboard") {
      const t = d.dashboard?.tasks ?? {};
      body = <Breakdown rows={[
        { label: "open", value: t.open ?? 0, display: String(t.open ?? 0) },
        { label: "in progress", value: t.inProgress ?? 0, display: String(t.inProgress ?? 0) },
        { label: "blocked", value: t.blocked ?? 0, display: String(t.blocked ?? 0) },
        { label: "done", value: t.done ?? 0, display: String(t.done ?? 0) },
      ]} />;
    }
  }
  return <Shell cell={cell} state={state} onDrill={onDrill}>{body}</Shell>;
}

function TrendCell({ cell, companyId, onDrill }: CellProps) {
  const state = useBinding(cell.source!.api, companyId);
  // Crosshair hover: the pointer aims at a position, we snap to the nearest
  // call. Keyboard gets the same readout (focus + arrows). Tooltips enhance,
  // never gate — endpoint, peak, and range are all direct-labeled below.
  const [hover, setHover] = useState<number | null>(null);
  const plotRef = useRef<HTMLDivElement>(null);
  let body: ReactNode = null;
  if (state.kind === "data" && cell.source!.api === "token-usage") {
    const calls = state.data.usage.recent_calls as Array<{ input_tokens: number; output_tokens: number; cost_usd: number; ts_iso: string }>;
    if (calls.length < 2) {
      body = <span className="text-dim" style={{ fontSize: "var(--text-sm)" }}>Not enough calls yet for a trend.</span>;
    } else {
      const vals = calls.map((c) => c.input_tokens + c.output_tokens);
      const n = vals.length;
      const max = Math.max(...vals, 1);
      const y = (v: number) => 34 - (v / max) * 30;
      const pts = vals.map((v, i) => `${(i / (n - 1)) * 100},${y(v)}`).join(" ");
      const last = vals[n - 1];
      const peak = Math.max(...vals);
      const snap = (clientX: number) => {
        const r = plotRef.current?.getBoundingClientRect();
        if (!r || r.width === 0) return;
        setHover(Math.max(0, Math.min(n - 1, Math.round(((clientX - r.left) / r.width) * (n - 1)))));
      };
      const hv = hover;
      const xPct = hv != null ? (hv / (n - 1)) * 100 : 0;
      body = (
        <div>
          <div style={{ display: "flex", alignItems: "stretch", gap: "var(--space-3)" }}>
            <div ref={plotRef} tabIndex={0} role="img"
              aria-label={`Token spend across the last ${n} calls, currently ${formatTokens(last)}. Focus and use arrow keys to inspect each call.`}
              onMouseMove={(e) => snap(e.clientX)}
              onMouseLeave={() => setHover(null)}
              onFocus={() => setHover(n - 1)}
              onBlur={() => setHover(null)}
              onKeyDown={(e) => {
                if (e.key === "ArrowLeft") { setHover((h) => Math.max(0, (h ?? n - 1) - 1)); e.preventDefault(); }
                if (e.key === "ArrowRight") { setHover((h) => Math.min(n - 1, (h ?? n - 1) + 1)); e.preventDefault(); }
              }}
              style={{ position: "relative", flex: 1, minWidth: 0, outlineOffset: 4 }}>
              <svg viewBox="0 0 100 36" preserveAspectRatio="none" style={{ width: "100%", height: 64, display: "block" }} aria-hidden>
                <polygon points={`0,34 ${pts} 100,34`} fill="var(--ink)" fillOpacity="0.07" />
                <line x1="0" y1="34" x2="100" y2="34" stroke="var(--edge)" strokeWidth="1" vectorEffect="non-scaling-stroke" />
                <polyline points={pts} fill="none" stroke="var(--ink-dim)" strokeOpacity="0.6" strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" vectorEffect="non-scaling-stroke" />
              </svg>
              <span aria-hidden style={{ position: "absolute", right: 0, top: `${(y(last) / 36) * 100}%`, width: 8, height: 8, borderRadius: "50%", background: "var(--live)", boxShadow: "0 0 0 2px var(--surface)", transform: "translate(40%, -50%)" }} />
              {hv != null && (
                <>
                  <span aria-hidden style={{ position: "absolute", left: `${xPct}%`, top: 0, bottom: 4, width: 1, background: "rgba(0,0,0,0.20)" }} />
                  <span aria-hidden style={{ position: "absolute", left: `${xPct}%`, top: `${(y(vals[hv]) / 36) * 100}%`, width: 8, height: 8, borderRadius: "50%", background: "var(--ink)", boxShadow: "0 0 0 2px var(--surface)", transform: "translate(-50%, -50%)" }} />
                  <div className="cv-tip" role="status" style={{ bottom: "calc(100% + 6px)", left: `${xPct}%`, transform: xPct > 55 ? "translateX(-100%)" : undefined }}>
                    <strong>{formatTokens(vals[hv])}</strong>
                    <span className="text-dim"> · {formatCost(calls[hv].cost_usd)} · {fmtLocalTs(calls[hv].ts_iso)}</span>
                  </div>
                </>
              )}
            </div>
            <div style={{ alignSelf: "center", textAlign: "right", whiteSpace: "nowrap" }}>
              <div style={{ fontSize: "var(--text-base)", fontWeight: 650 }}>{formatTokens(last)}</div>
              <div className="text-dim" style={{ fontSize: "var(--text-xs)" }}>last call</div>
            </div>
          </div>
          <div className="text-dim" style={{ display: "flex", justifyContent: "space-between", fontSize: "var(--text-xs)", marginTop: 4 }}>
            <span>{fmtLocalTs(calls[0].ts_iso)}</span>
            <span>peak {formatTokens(peak)}</span>
            <span>{fmtLocalTs(calls[n - 1].ts_iso)}</span>
          </div>
        </div>
      );
    }
  }
  return <Shell cell={cell} state={state} onDrill={onDrill}>{body}</Shell>;
}

/** 12-day run cadence as an intensity strip — the progress primitive with
 *  real runtime data. Sequential single hue (magnitude is opacity); today
 *  is ringed in the live color; a day with failures carries a coral tick
 *  whose count lives in the tooltip and the aria-label. */
function RunCadenceCell({ cell, companyId, onDrill }: CellProps) {
  const state = useBinding("runtime-dashboard", companyId);
  const [hover, setHover] = useState<number | null>(null);
  let body: ReactNode = null;
  if (state.kind === "data") {
    const days = ((state.data.dashboard?.runActivity as Array<{ date?: string; total?: number; succeeded?: number; failed?: number }>) ?? []).slice(-12);
    if (days.length === 0) {
      body = <span className="text-dim" style={{ fontSize: "var(--text-sm)" }}>No run history yet.</span>;
    } else {
      const max = Math.max(...days.map((d) => d.total ?? 0), 1);
      const today = days[days.length - 1];
      body = (
        <div>
          <div style={{ display: "flex", gap: 4, position: "relative" }} onMouseLeave={() => setHover(null)}>
            {days.map((d, i) => {
              const ratio = (d.total ?? 0) / max;
              const isToday = i === days.length - 1;
              return (
                <span key={d.date ?? i} role="img"
                  aria-label={`${d.date ?? `day ${i + 1}`} — ${d.total ?? 0} runs${d.failed ? `, ${d.failed} failed` : ""}`}
                  onMouseEnter={() => setHover(i)}
                  style={{
                    position: "relative", flex: 1, maxWidth: 26, height: 22, borderRadius: 4, cursor: "default",
                    background: `color-mix(in srgb, var(--ink) ${Math.round(8 + ratio * 62)}%, transparent)`,
                    boxShadow: isToday ? "0 0 0 2px var(--surface), 0 0 0 3.5px var(--live)" : hover === i ? "0 0 0 1.5px rgba(0,0,0,0.25)" : undefined,
                  }}>
                  {(d.failed ?? 0) > 0 && (
                    <span aria-hidden style={{ position: "absolute", left: 3, right: 3, bottom: 2, height: 2, borderRadius: 1, background: "var(--crit)" }} />
                  )}
                </span>
              );
            })}
            {hover != null && (
              <div className="cv-tip" role="status" style={{ bottom: "calc(100% + 6px)", left: `${(hover / Math.max(1, days.length - 1)) * 90}%`, transform: hover > days.length / 2 ? "translateX(-100%)" : undefined }}>
                <strong>{days[hover].total ?? 0} runs</strong>
                <span className="text-dim"> · {days[hover].succeeded ?? 0} ok{days[hover].failed ? ` · ${days[hover].failed} failed` : ""} · {days[hover].date ?? ""}</span>
              </div>
            )}
          </div>
          <div className="text-dim" style={{ display: "flex", justifyContent: "space-between", fontSize: "var(--text-xs)", marginTop: 6 }}>
            <span>{days[0].date ?? ""}</span>
            <span>today {today.total ?? 0} · peak {max}</span>
          </div>
        </div>
      );
    }
  }
  return <Shell cell={cell} state={state} onDrill={onDrill}>{body}</Shell>;
}

function ComparisonCell({ cell, companyId, onDrill, since }: CellProps) {
  const state = useBinding(cell.source!.api, companyId);
  let body: ReactNode = null;
  if (state.kind === "data") {
    const g = state.data.manifest?.goal;
    if (!g || g.current == null || g.target == null) {
      body = <span className="text-dim" style={{ fontSize: "var(--text-sm)" }}>No goal captured yet.</span>;
    } else {
      const pct = Math.max(0, Math.min(100, Math.round((g.current / g.target) * 100)));
      // Trajectory wears green: progress toward the goal is the one place
      // the interface is allowed a note of optimism. The number stays hero.
      body = (
        <div>
          <div style={{ display: "flex", alignItems: "baseline", gap: "var(--space-2)" }}>
            <span style={{ fontSize: "var(--text-lg)", fontWeight: 700, letterSpacing: "-.01em" }}>{g.current.toLocaleString()}</span>
            <span className="text-dim" style={{ fontSize: "var(--text-sm)" }}>/ {g.target.toLocaleString()}</span>
          </div>
          <Meter pct={pct} tone="var(--good)" />
          <div className="text-dim" style={{ fontSize: "var(--text-xs)", marginTop: 4 }}>
            {pct}% of target{g.days != null ? ` · ${g.days}d horizon` : ""}
          </div>
          <SinceDelta cell={cell} since={since} current={g.current} fmt={(n) => n.toLocaleString()} />
        </div>
      );
    }
  }
  return <Shell cell={cell} state={state} onDrill={onDrill}>{body}</Shell>;
}

const IGNITION_COPY: Record<string, { tone: string; label: (d: any) => string }> = {
  not_activated: { tone: "var(--text-dim)", label: () => "Not activated yet — finish onboarding to build a fleet." },
  deferred: { tone: "var(--warning)", label: () => "Fleet activated but not ignited — agents are idle." },
  partial: { tone: "var(--warning)", label: (d) => `Fleet ignited (partial) — ${d.agentsWorking} working, ${d.warnings.length} gaps.` },
  ignited: { tone: "var(--success)", label: (d) => `Fleet ignited — ${d.agentsWorking} agents working, ${d.workflowsQueued} queued.` },
};

function AttentionCell({ cell, companyId, onDrill }: CellProps) {
  const ign = useBinding("ignition", companyId);
  const budget = useBinding("token-budget", companyId);
  const items: Array<{ tone: string; text: string; prompt: string }> = [];
  if (ign.kind === "data") {
    const c = IGNITION_COPY[ign.data.status];
    if (c && ign.data.status !== "ignited") {
      items.push({ tone: c.tone, text: c.label(ign.data), prompt: "ignite the fleet" });
    } else if (c) {
      items.push({ tone: c.tone, text: c.label(ign.data), prompt: "show fleet state" });
    }
  }
  if (budget.kind === "data") {
    const cap = budget.data.budget.cap_tokens as number | null;
    const used = budget.data.used as number;
    if (cap && used / cap >= 0.9) {
      items.push({ tone: "var(--warning)", text: `Token budget ${Math.round((used / cap) * 100)}% used.`, prompt: "set the token budget" });
    }
  }
  // Severity orders the queue; a dot mark carries the state color so the
  // text stays ink and nothing rests on color alone (position + dot + copy).
  const rank = (tone: string) =>
    tone.includes("crit") ? 0 : tone.includes("attend") || tone.includes("warning") ? 1 : tone.includes("good") || tone.includes("success") ? 3 : 2;
  const ordered = [...items].sort((a, b) => rank(a.tone) - rank(b.tone));
  return (
    <Shell cell={cell} onDrill={onDrill}>
      {ordered.length === 0 ? (
        <span className="text-dim" style={{ fontSize: "var(--text-sm)" }}>Nothing needs you right now.</span>
      ) : ordered.slice(0, 3).map((it, i) => (
        <button key={i} onClick={() => onDrill(it.prompt)}
          style={{ display: "flex", alignItems: "center", gap: 10, background: "transparent", border: "1px solid var(--border)", borderLeft: `3px solid ${it.tone}`, borderRadius: "var(--radius-sm)", padding: "8px 12px", color: "var(--text)", cursor: "pointer", textAlign: "left", fontSize: "var(--text-sm)", minHeight: 40 }}>
          <span aria-hidden style={{ flex: "none", width: 7, height: 7, borderRadius: "50%", background: it.tone }} />
          <span style={{ minWidth: 0 }}>{it.text}</span>
        </button>
      ))}
    </Shell>
  );
}

/** Pending approvals from the mirrored fleet — the decision primitive's
 *  real backing. Read-only v1: acting on one is a deliberate later step
 *  (the commit allowlist grows separately from reads). */
function RuntimeApprovalsCell({ cell, companyId, onDrill }: CellProps) {
  const state = useBinding("runtime-approvals", companyId);
  let body: ReactNode = null;
  if (state.kind === "data") {
    const approvals = (state.data.approvals as any[]) ?? [];
    body = approvals.length === 0 ? (
      <span className="text-dim" style={{ fontSize: "var(--text-sm)" }}>No approvals waiting.</span>
    ) : (
      <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-2)" }}>
        {approvals.slice(0, 5).map((a, i) => (
          <div key={a.id ?? i} style={{ display: "flex", alignItems: "baseline", gap: 10, border: "1px solid var(--border)", borderLeft: "3px solid var(--attend)", borderRadius: "var(--radius-sm)", padding: "8px 12px", fontSize: "var(--text-sm)" }}>
            <span aria-hidden style={{ flex: "none", width: 7, height: 7, borderRadius: "50%", background: "var(--attend)", alignSelf: "center" }} />
            <span style={{ minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
              {a.title ?? a.summary ?? a.type ?? "approval"}
            </span>
            <span className="text-dim" style={{ marginLeft: "auto", fontSize: "var(--text-xs)", whiteSpace: "nowrap" }}>
              {a.type ?? "pending"}
            </span>
          </div>
        ))}
        {approvals.length > 5 && (
          <span className="text-dim" style={{ fontSize: "var(--text-xs)" }}>and {approvals.length - 5} more</span>
        )}
      </div>
    );
  }
  return <Shell cell={cell} state={state} onDrill={onDrill}>{body}</Shell>;
}

/** The organizational memory made visible: Paperclip's activity feed with
 *  real actors — the timeline primitive's true backing. */
function RuntimeTimelineCell({ cell, companyId, onDrill }: CellProps) {
  const state = useBinding("runtime-activity", companyId);
  let body: ReactNode = null;
  if (state.kind === "data") {
    const allEvents = (state.data.events as any[]) ?? [];
    const events = allEvents.slice(0, 10).map((e) => {
      const action = String(e.action ?? "");
      const tone = /approve|complete|done|achiev/.test(action) ? "var(--good)"
        : /fail|error|block|reject/.test(action) ? "var(--crit)"
        : "var(--ink-dim)";
      return {
        ts: String(e.createdAt ?? e.created_at ?? ""),
        tone,
        text: `${e.actorType ?? "system"} · ${action.replace(/[._]/g, " ")}${e.entityType ? ` — ${e.entityType}` : ""}`,
      };
    });
    body = events.length === 0 ? (
      <span className="text-dim" style={{ fontSize: "var(--text-sm)" }}>Nothing has happened yet.</span>
    ) : (
      <div style={{ position: "relative", display: "flex", flexDirection: "column", gap: 6 }}>
        <span aria-hidden style={{ position: "absolute", left: 3, top: 6, bottom: 6, width: 1, background: "var(--edge)" }} />
        {events.map((e, i) => (
          <div key={i} style={{ display: "flex", gap: 10, alignItems: "baseline", fontSize: "var(--text-sm)" }}>
            <span aria-hidden style={{ flex: "none", width: 7, height: 7, borderRadius: "50%", background: e.tone, marginTop: 5, boxShadow: "0 0 0 2px var(--surface)", position: "relative" }} />
            <span style={{ fontSize: "var(--text-xs)", color: "var(--text-dim)", whiteSpace: "nowrap" }}>{fmtLocalTs(e.ts)}</span>
            <span style={{ minWidth: 0 }}>{e.text}</span>
          </div>
        ))}
        {allEvents.length > 10 && (
          <span className="text-dim" style={{ fontSize: "var(--text-xs)", marginLeft: 17 }}>…and {allEvents.length - 10} earlier</span>
        )}
      </div>
    );
  }
  return <Shell cell={cell} state={state} onDrill={onDrill}>{body}</Shell>;
}

function RosterCell({ cell, companyId, onDrill }: CellProps) {
  const state = useBinding("redundancy", companyId);
  let body: ReactNode = null;
  if (state.kind === "data") {
    const all = state.data.all_slots as any[];
    const slots = all.filter((s) => !s.muted);
    const muted = all.length - slots.length;
    const byParent = new Map<string, any[]>();
    for (const s of slots) {
      const arr = byParent.get(s.parent_slot) ?? [];
      arr.push(s); byParent.set(s.parent_slot, arr);
    }
    // A real tree: hairline guides carry the reporting structure; each leaf
    // shows its slot (ink) and the template it resolved to (quiet). Width is
    // capped so slot ↔ template stay associated in a span-2 cell; roots
    // (empty parent) render as standalone rows, not a nameless group.
    const roots = byParent.get("") ?? [];
    byParent.delete("");
    const leaf = (k: any) => (
      <div key={k.slot} style={{ display: "flex", justifyContent: "space-between", gap: "var(--space-4)", fontSize: "var(--text-sm)", minWidth: 0 }}>
        <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{k.slot.split(".").pop()}</span>
        <span className="text-dim" style={{ fontSize: "var(--text-xs)", whiteSpace: "nowrap" }}>{k.template_id}</span>
      </div>
    );
    body = (
      <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-3)", maxWidth: 560 }}>
        {roots.map((k) => (
          <div key={k.slot} style={{ display: "flex", justifyContent: "space-between", gap: "var(--space-4)", fontSize: "var(--text-sm)" }}>
            <span style={{ fontWeight: 600 }}>{k.slot}</span>
            <span className="text-dim" style={{ fontSize: "var(--text-xs)" }}>{k.template_id}</span>
          </div>
        ))}
        {[...byParent.entries()].map(([parent, kids]) => (
          <div key={parent}>
            <div style={{ fontSize: "var(--text-sm)", color: "var(--ink)", fontWeight: 600 }}>
              {parent}
              <span className="text-dim" style={{ fontWeight: 400, fontSize: "var(--text-xs)" }}> · {kids.length} report{kids.length === 1 ? "" : "s"}</span>
            </div>
            <div style={{ borderLeft: "1px solid var(--edge)", marginLeft: 5, paddingLeft: 14, marginTop: 4, display: "flex", flexDirection: "column", gap: 3 }}>
              {kids.map(leaf)}
            </div>
          </div>
        ))}
        {muted > 0 && (
          <div className="text-dim" style={{ fontSize: "var(--text-xs)" }}>{muted} slot{muted === 1 ? "" : "s"} muted</div>
        )}
      </div>
    );
  }
  return <Shell cell={cell} state={state} onDrill={onDrill}>{body}</Shell>;
}

export function ProposalCard({ proposal, busy, error, onConfirm, onDismiss, confirmLabel, children, fill }: {
  proposal: CanvasProposal; busy: boolean; error: string | null;
  onConfirm: () => void; onDismiss?: () => void;
  confirmLabel?: string;
  /** Rendered between the summary and the buttons — the Review phase's
   *  before/after/reason body lives here, inside the same status chrome. */
  children?: ReactNode;
  /** Fill the height the caller gave it instead of sizing to content.
   *
   *  This is what lets a bounded card compute its own budget in CSS: the
   *  status chrome and the buttons keep their intrinsic height, `children`
   *  takes the remainder, and a list inside `children` can flex against a
   *  box whose height does NOT change when that list clamps. Estimating
   *  the chrome in JS instead is what let Review's Confirm button fall
   *  25px below the fold — reason lines wrap, and an estimate cannot know. */
  fill?: boolean;
}) {
  const decided = proposal.status !== "pending";
  return (
    // Pending = awaiting your review (amber); committed = decided (emerald);
    // failed = a mutation that did not apply (coral, the rare case).
    <div className="cv-glass" style={{ ...cellStyle, ...(fill ? { height: "100%", minHeight: 0 } : null), borderLeft: `3px solid ${proposal.status === "failed" ? "var(--crit)" : proposal.status === "committed" ? "var(--good)" : "var(--attend)"}` }}>
      <div style={{ fontSize: "var(--text-xs)", textTransform: "uppercase", letterSpacing: ".06em", color: "var(--text-dim)" }}>
        Proposal · {proposal.status}
      </div>
      <div style={{ fontSize: "var(--text-sm)" }}>{proposal.summary}</div>
      {children}
      {proposal.outcome && <div className="text-dim" style={{ fontSize: "var(--text-xs)" }}>{proposal.outcome.detail}</div>}
      {error && <div style={{ fontSize: "var(--text-xs)", color: "var(--danger)" }}>✗ {error}</div>}
      {!decided && (
        <div style={{ display: "flex", gap: "var(--space-2)" }}>
          <button onClick={onConfirm} disabled={busy} style={{ minHeight: 36 }}>
            {busy ? "Applying…" : (confirmLabel ?? "Confirm")}
          </button>
          {onDismiss && <button className="secondary" onClick={onDismiss} disabled={busy} style={{ minHeight: 36 }}>Not now</button>}
        </div>
      )}
    </div>
  );
}

function SimulationCell({ cell, companyId, onDrill }: CellProps) {
  const state = useBinding("mc-report", companyId);
  const [hover, setHover] = useState<string | null>(null);
  let body: ReactNode = null;
  if (state.kind === "data") {
    const rep = state.data.report ?? {};
    const winnerId = rep.winner?.strategy_id;
    const strategies: any[] = Array.isArray(rep.strategies) ? rep.strategies : [];
    if (!strategies.length) {
      body = <span className="text-dim" style={{ fontSize: "var(--text-sm)" }}>Report present but no strategies inside.</span>;
    } else {
      // Sorted by outcome (presentation, not data), bars square at the
      // baseline with a 4px rounded data-end. The winner is the ONE colored
      // mark — its label stays ink (text never wears the data color); the
      // ★ beside it carries identity, so it never rests on color alone.
      const sorted = [...strategies].sort((a, b) => (b.mean_mrr_growth ?? 0) - (a.mean_mrr_growth ?? 0));
      const max = Math.max(...sorted.map((x) => Math.abs(x.mean_mrr_growth ?? 0)), 0.0001);
      body = (
        <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-2)" }}>
          {sorted.map((x) => {
            const won = x.strategy_id === winnerId;
            const pct = Math.round(((x.mean_mrr_growth ?? 0) / max) * 100);
            return (
              <div key={x.strategy_id}
                onMouseEnter={() => setHover(x.strategy_id)} onMouseLeave={() => setHover(null)}
                style={{ position: "relative", display: "grid", gridTemplateColumns: "150px 1fr 56px", gap: "var(--space-3)", alignItems: "center", fontSize: "var(--text-sm)", minHeight: 24 }}>
                <span style={{ fontSize: "var(--text-xs)", color: won ? "var(--text)" : "var(--text-dim)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  {won && <span style={{ color: "var(--good)" }}>★ </span>}{x.strategy_id}
                </span>
                <span aria-hidden style={{
                  height: 8, borderRadius: "0 4px 4px 0", width: `${Math.max(1.5, pct)}%`,
                  background: won ? "var(--good)" : "color-mix(in srgb, var(--ink) 30%, transparent)",
                  filter: hover === x.strategy_id ? "brightness(1.2)" : undefined,
                  transition: "filter var(--dur-fast)",
                }} />
                <span style={{ textAlign: "right", fontVariantNumeric: "tabular-nums", color: won ? "var(--text)" : "var(--text-dim)" }}>
                  {((x.mean_mrr_growth ?? 0) * 100).toFixed(0)}%
                </span>
                {hover === x.strategy_id && (
                  <div className="cv-tip" role="status" style={{ bottom: "calc(100% + 2px)", right: 0 }}>
                    <strong>{((x.mean_mrr_growth ?? 0) * 100).toFixed(1)}%</strong>
                    <span className="text-dim"> mean MRR growth{won && rep.winner?.sharpe != null ? ` · Sharpe ${Number(rep.winner.sharpe).toFixed(2)}` : ""}</span>
                  </div>
                )}
              </div>
            );
          })}
          <div className="text-dim" style={{ fontSize: "var(--text-xs)" }}>
            mean MRR growth over horizon · winner by Sharpe {rep.winner?.sharpe != null ? `(${Number(rep.winner.sharpe).toFixed(2)})` : ""}
          </div>
        </div>
      );
    }
  }
  return <Shell cell={cell} state={state} onDrill={onDrill}>{body}</Shell>;
}

function TimelineCell({ cell, companyId, onDrill }: CellProps) {
  // Client-aggregated like AttentionCell: ignition steps + spend calls +
  // committed decisions, interleaved chronologically.
  const ign = useBinding("ignition", companyId);
  const usage = useBinding("token-usage", companyId);
  const canvasQ = useQuery({
    queryKey: ["canvas", companyId],
    queryFn: () => wavexOsOnboardingApi.getCanvas(companyId),
    staleTime: 15_000, retry: false, refetchOnWindowFocus: false,
  });
  const events: Array<{ ts: string; tone: string; text: string }> = [];
  if (ign.kind === "data" && ign.data.startedAt) {
    events.push({ ts: ign.data.startedAt, tone: "var(--ink-dim)", text: "Ignition started" });
    if (ign.data.completedAt) events.push({ ts: ign.data.completedAt, tone: "var(--success)", text: `Ignition ${ign.data.status}` });
  }
  if (usage.kind === "data") {
    for (const c of (usage.data.usage.recent_calls as any[]).slice(-6)) {
      events.push({ ts: c.ts_iso, tone: "var(--text-dim)", text: `${c.phase} · ${formatTokens(c.input_tokens + c.output_tokens)} tokens` });
    }
  }
  for (const e of canvasQ.data?.ledger ?? []) {
    events.push({ ts: e.ts_iso, tone: e.status === "committed" ? "var(--success)" : "var(--danger)", text: e.summary });
  }
  events.sort((a, b) => b.ts.localeCompare(a.ts));
  // A spine connects the dots; events group under day headers; each dot
  // wears a 2px surface ring so it reads where it crosses the spine.
  const shown = events.slice(0, 10);
  const groups: Array<{ day: string; items: typeof shown }> = [];
  for (const e of shown) {
    const day = fmtLocalTs(e.ts).slice(0, 5);
    const g = groups[groups.length - 1];
    if (g && g.day === day) g.items.push(e);
    else groups.push({ day, items: [e] });
  }
  return (
    <Shell cell={cell} onDrill={onDrill}>
      {events.length === 0 ? (
        <span className="text-dim" style={{ fontSize: "var(--text-sm)" }}>Nothing has happened yet.</span>
      ) : (
        <div style={{ position: "relative", display: "flex", flexDirection: "column", gap: 8 }}>
          <span aria-hidden style={{ position: "absolute", left: 3, top: 6, bottom: 6, width: 1, background: "var(--edge)" }} />
          {groups.map((g) => (
            <div key={g.day} style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              {groups.length > 1 && (
                <span className="text-dim" style={{ fontSize: "10px", textTransform: "uppercase", letterSpacing: ".06em", background: "var(--surface)", position: "relative", width: "fit-content", padding: "0 4px 0 0", marginLeft: 14 }}>
                  {g.day}
                </span>
              )}
              {g.items.map((e, i) => (
                <div key={i} style={{ display: "flex", gap: 10, alignItems: "baseline", fontSize: "var(--text-sm)" }}>
                  <span aria-hidden style={{ flex: "none", width: 7, height: 7, borderRadius: "50%", background: e.tone, marginTop: 5, boxShadow: "0 0 0 2px var(--surface)", position: "relative" }} />
                  <span style={{ fontSize: "var(--text-xs)", color: "var(--text-dim)", whiteSpace: "nowrap" }}>{fmtLocalTs(e.ts).slice(6)}</span>
                  <span style={{ minWidth: 0 }}>{e.text}</span>
                </div>
              ))}
            </div>
          ))}
        </div>
      )}
    </Shell>
  );
}

/* ---- registry ---- */
interface CellProps { cell: CellSpec; companyId: string; onDrill: (prompt: string) => void; since?: SinceSnapshot }

export function Cell(props: CellProps) {
  const { cell } = props;
  // A bound cell type without a source must degrade to a quiet empty state.
  // `cell.source!` in a renderer would throw instead — and one malformed
  // spec would take the whole workspace down through the error boundary.
  if ((cell.type === "metric" || cell.type === "table" || cell.type === "trend" || cell.type === "comparison") && !cell.source) {
    return <Shell cell={cell} state={{ kind: "empty" }} onDrill={props.onDrill} />;
  }
  switch (cell.type) {
    case "text":
      // Hypothesis is model-authored interpretation — it must LOOK different
      // from endpoint truth (disagreement #2 in COGNITIVE_RENDERER_PLAN.md).
      if (cell.thought === "hypothesis") {
        return (
          <Shell cell={{ ...cell, title: undefined }} onDrill={props.onDrill}>
            <div style={{ fontSize: "10px", letterSpacing: ".07em", textTransform: "uppercase", color: "var(--mind)" }}>
              Assistant's read — interpretation, not data
            </div>
            <p style={{ margin: 0, fontSize: "var(--text-base)", fontStyle: "italic", color: "var(--text-dim)", whiteSpace: "pre-wrap", wordBreak: "break-word", borderLeft: "2px dashed var(--border)", paddingLeft: "var(--space-3)" }}>
              {cell.body}
            </p>
          </Shell>
        );
      }
      return (
        <Shell cell={cell} onDrill={props.onDrill}>
          <p style={{ margin: 0, fontSize: "var(--text-base)", whiteSpace: "pre-wrap", wordBreak: "break-word" }}>{cell.body}</p>
        </Shell>
      );
    case "metric": return <MetricCell {...props} />;
    case "table": return <TableCell {...props} />;
    case "trend":
      if (cell.source?.api === "runtime-dashboard") return <RunCadenceCell {...props} />;
      return <TrendCell {...props} />;
    case "comparison": return <ComparisonCell {...props} />;
    case "attention":
      // Source-aware: fleet approvals get their own renderer; the default
      // composite (ignition + budget) keeps its hardcoded bindings.
      if (cell.source?.api === "runtime-approvals") return <RuntimeApprovalsCell {...props} />;
      return <AttentionCell {...props} />;
    case "agent-roster": return <RosterCell {...props} />;
    case "simulation": return <SimulationCell {...props} />;
    case "timeline":
      if (cell.source?.api === "runtime-activity") return <RuntimeTimelineCell {...props} />;
      return <TimelineCell {...props} />;
    default:
      return null; // proposal cells render through ProposalCard in the thread
  }
}
