/** Phase 2 — Strategy. The canvas shows the goal ASSEMBLING: the metric,
 *  the two numbers, the horizon, each landing as the operator answers it.
 *
 *  It renders nothing but what has actually been said. A dimmed slot is an
 *  unanswered one — no placeholder number, no stage band standing in, no
 *  preview of what wavex would have guessed. That restraint is the whole
 *  point of the phase: the moment a synthesized figure appears in a slot
 *  where a measurement belongs, it becomes indistinguishable from a
 *  decision, and everything downstream inherits the confusion.
 *
 *  Like every other phase component this one only presents; the card in the
 *  thread does the asking and BuildOrgPage does the orchestration. */

import { formatKpiValue } from "../cards/StrategyCard";

export interface StrategyDraft {
  kpiId: string | null;
  label: string | null;
  current: number | null;
  target: number | null;
  days: number | null;
}

/** Which beat is live — drives the emphasis, nothing else. */
type Asking = "kpi" | "current" | "target" | "bottleneck";

function Slot({ value, caption, live }: { value: string | null; caption: string; live: boolean }) {
  const empty = value === null;
  return (
    <div style={{
      display: "flex", flexDirection: "column", gap: 4, minWidth: 0,
      opacity: empty ? (live ? 0.55 : 0.25) : 1,
      transition: "opacity 320ms ease",
    }}>
      <div style={{
        fontSize: "clamp(1.4rem, 3.2vw, 2.4rem)", fontWeight: 650, letterSpacing: "-0.02em",
        whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis",
        color: empty ? "var(--text-dim)" : "var(--text)",
      }}>
        {value ?? "—"}
      </div>
      <div className="text-dim" style={{ fontSize: "var(--text-xs)", textTransform: "uppercase", letterSpacing: ".1em" }}>
        {caption}
      </div>
    </div>
  );
}

export function Strategy({ draft, asking }: { draft: StrategyDraft; asking: Asking }) {
  const fmt = (n: number | null) => (n === null || !draft.kpiId ? null : formatKpiValue(draft.kpiId, n));
  return (
    <div style={{ height: "100%", display: "grid", placeItems: "center", padding: "var(--space-4)" }}>
      <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-5)", maxWidth: "48ch", width: "100%" }}>
        <div>
          <div className="text-dim" style={{ fontSize: "var(--text-xs)", textTransform: "uppercase", letterSpacing: ".1em", marginBottom: 6 }}>
            The number this company is judged by
          </div>
          <div style={{
            fontSize: "var(--text-lg)", fontWeight: 600,
            opacity: draft.label ? 1 : (asking === "kpi" ? 0.55 : 0.25),
            transition: "opacity 320ms ease",
          }}>
            {draft.label ?? "Not chosen yet"}
          </div>
        </div>

        <div style={{ display: "flex", alignItems: "flex-start", gap: "var(--space-4)" }}>
          <Slot value={fmt(draft.current)} caption="today" live={asking === "current"} />
          <div className="text-dim" style={{ fontSize: "1.6rem", lineHeight: 1.4, opacity: 0.4 }}>→</div>
          <Slot value={fmt(draft.target)} caption="target" live={asking === "target"} />
          <Slot value={draft.days === null ? null : `${draft.days}d`} caption="horizon" live={asking === "target"} />
        </div>

        {/* The consequence, stated plainly — this is the sentence the plan,
            the research prompt, and every later revision are measured
            against, so the operator should read it before it becomes law. */}
        <p className="text-dim" style={{ fontSize: "var(--text-sm)", lineHeight: 1.6, margin: 0 }}>
          Everything below this point — what gets researched, what gets built,
          what the organization checks itself against — is measured against
          this one line.
        </p>
      </div>
    </div>
  );
}
