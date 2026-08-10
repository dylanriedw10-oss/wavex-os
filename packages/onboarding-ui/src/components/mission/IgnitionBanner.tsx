/** Did the fleet actually start, and if not, start it.
 *
 *  Mission Control is where an operator lands after onboarding and every
 *  time afterwards, and until now it could not answer that question at all.
 *  The card in this slot asserted "your fleet is live" from a fetch whose
 *  failure it swallowed, and the app's only retry path was typing "ignite the
 *  fleet" into the canvas chat.
 *
 *  ── What it may say ──────────────────────────────────────────────────────
 *
 *  Every sentence comes from lib/ignition-copy.ts, shared with the canvas
 *  attention cell so the two surfaces cannot disagree about one fact. The
 *  numbers are omitted rather than zeroed when the run did not record them —
 *  see that file.
 *
 *  ── What it does NOT do ──────────────────────────────────────────────────
 *
 *  It does not render at all without a company: a banner about the ignition
 *  state of nothing is noise, and the page already says "no company
 *  selected" above it.
 *
 *  It does not hide a failed READ. A banner whose whole job is to report
 *  whether something is running must not go quiet when it cannot tell —
 *  that is the exact failure it was built to correct.
 *
 *  The step detail is collapsed by default and lists the ignition steps with
 *  their status. Ignition is re-entrant and resumes at the first incomplete
 *  step, so knowing WHICH step stalled is what makes the retry button a
 *  decision rather than a blind redo. */

import { useState } from "react";
import { Link } from "react-router-dom";
import { useIgnitionStatus } from "./useIgnitionStatus";
import { ignitionLine, type IgnitionFacts } from "../../lib/ignition-copy";

const STEP_TONE: Record<string, { tone: string; word: string }> = {
  ok: { tone: "var(--success)", word: "ok" },
  error: { tone: "var(--danger)", word: "failed" },
  skipped: { tone: "var(--text-dim)", word: "skipped" },
  pending: { tone: "var(--warning)", word: "never ran" },
};

export function IgnitionBanner({ companyId }: { companyId: string | null }) {
  const { query, ignite, igniting, error } = useIgnitionStatus(companyId);
  const [openSteps, setOpenSteps] = useState(false);

  if (!companyId) return null;

  const box = {
    display: "flex", flexDirection: "column" as const, gap: "0.5rem",
    padding: "0.75rem 1rem", marginBottom: "1.25rem",
    border: "1px solid var(--border)", borderRadius: 8,
    background: "var(--surface)",
  };

  // The read has not answered yet. Says what it is waiting on rather than
  // implying a state.
  if (query.isPending) {
    return (
      <div style={box} data-testid="ignition-banner">
        <span className="text-dim" style={{ fontSize: 13 }}>Checking whether the fleet is running…</span>
      </div>
    );
  }

  // The read FAILED. Loud, because a silent ignition banner is indis-
  // tinguishable from an ignited fleet, and that is the whole defect.
  if (query.isError || !query.data) {
    const msg = query.error instanceof Error ? query.error.message : "the request failed";
    return (
      <div style={{ ...box, borderColor: "var(--warning)" }} role="alert" data-testid="ignition-banner">
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <span aria-hidden style={{ width: 8, height: 8, borderRadius: "50%", background: "var(--warning)", flex: "none" }} />
          <strong style={{ fontSize: 13 }}>Can’t tell whether the fleet is running.</strong>
          <span className="text-dim" style={{ fontSize: 12 }}>unknown</span>
        </div>
        <span className="text-dim" style={{ fontSize: 12 }}>
          The ignition status request failed ({msg}). This says nothing about the fleet itself — only that this panel could not read it.
        </span>
        <div>
          <button type="button" className="secondary" onClick={() => void query.refetch()}
            style={{ minHeight: 34, fontSize: 12 }}>
            Check again
          </button>
        </div>
      </div>
    );
  }

  const d = query.data;
  const line = ignitionLine(d as IgnitionFacts);
  const steps = Object.entries(d.steps ?? {});

  return (
    <div style={{ ...box, borderColor: line.actionable ? "var(--warning)" : "var(--border)" }} data-testid="ignition-banner">
      {/* aria-live: this line changes asynchronously — on the poll, and after
          an ignite — and a screen-reader user must hear the RESULT rather
          than having to go looking for it. */}
      <div aria-live="polite" style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
        <span aria-hidden style={{ width: 8, height: 8, borderRadius: "50%", background: line.tone, flex: "none" }} />
        <strong style={{ fontSize: 13 }}>{line.headline}</strong>
        {/* The word beside the colour — DESIGN_TOKENS: a status colour never
            travels alone, and this banner is worthless in grayscale without it. */}
        <span className="text-dim" style={{ fontSize: 12 }}>{line.word}</span>
        {line.detail && (
          <span className="text-dim" style={{ fontSize: 12 }}>· {line.detail}</span>
        )}
      </div>

      {error && (
        <span style={{ fontSize: 12, color: "var(--warning)" }}>
          Couldn’t ignite: {error}
        </span>
      )}

      <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", flexWrap: "wrap" }}>
        {d.status === "not_activated" ? (
          <Link to="/build" style={{ fontSize: 12 }}>Build an organization →</Link>
        ) : (
          <button
            type="button"
            onClick={() => void ignite()}
            disabled={igniting}
            className={line.actionable ? "" : "secondary"}
            style={{ minHeight: 34, fontSize: 12 }}
          >
            {igniting ? "Igniting…" : line.actionable ? "Ignite fleet" : "Ignite again"}
          </button>
        )}

        {d.paperclipUrl && (
          <a href={d.paperclipUrl} target="_blank" rel="noreferrer" style={{ fontSize: 12 }}>
            Open Paperclip ↗
          </a>
        )}

        {steps.length > 0 && (
          <button type="button" className="secondary" onClick={() => setOpenSteps((v) => !v)}
            aria-expanded={openSteps}
            style={{ minHeight: 34, fontSize: 12, marginLeft: "auto" }}>
            {openSteps ? "Hide steps" : `Steps (${steps.length})`}
          </button>
        )}
      </div>

      {openSteps && (
        <ul style={{ listStyle: "none", margin: 0, padding: 0, display: "flex", flexDirection: "column", gap: 4 }}>
          {steps.map(([name, s]) => {
            const st = (s as { status?: string })?.status ?? "pending";
            const t = STEP_TONE[st] ?? STEP_TONE.pending!;
            const note = (s as { note?: string })?.note;
            return (
              <li key={name} style={{ display: "flex", alignItems: "baseline", gap: 8, fontSize: 12 }}>
                <span aria-hidden style={{ width: 6, height: 6, borderRadius: "50%", background: t.tone, flex: "none" }} />
                <span style={{ minWidth: 150 }}>{name.replace(/_/g, " ")}</span>
                <span className="text-dim">{t.word}</span>
                {note && <span className="text-dim" style={{ minWidth: 0 }}>· {note}</span>}
              </li>
            );
          })}
        </ul>
      )}

      {d.errors.length > 0 && (
        <ul style={{ listStyle: "none", margin: 0, padding: 0, display: "flex", flexDirection: "column", gap: 2 }}>
          {d.errors.map((e, i) => (
            <li key={i} style={{ fontSize: 12, color: "var(--warning)" }}>
              {e.step}: {e.message}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
