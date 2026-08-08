/** The Runtime tray (spec Rev 9) — the ONE sanctioned overlay.
 *
 *  A single, transient, read-only sheet at the Popover layer: what the
 *  runtime is doing now, what the next cycle would actually pick, what
 *  just finished, and the hops of a walk in flight — glanceable from any
 *  context without leaving it. Summoned from the header, dismissed by
 *  esc or outside click, never auto-opens. Any action it inspires is
 *  spoken through the composer or taken in the Work lens.
 *
 *  Checklist semantics translated from Claude Code's own verified task
 *  list — three states, a five-item cap, groups clearing together — with
 *  one honesty amendment: no invented present-continuous strings; the
 *  printed state word does that job ("Running · <task>").
 *
 *  Every row is counted store state. "Up next" mirrors the cycle's REAL
 *  pick order (ready = todo · attempts under ceiling · deps done, oldest
 *  first) and says so. */

import { useEffect, useRef } from "react";
import type { CSSProperties } from "react";
import { ago, displayName } from "./OrgFlywheel";
import { ClampedList } from "./ClampedList";
import { regionBudget, useMeasuredHeight } from "./layout";
import type { OrgWalkStep, WorkStateResponse } from "./contract";

const REDUCE = typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;

const LABEL: CSSProperties = {
  fontSize: "var(--text-xs)", textTransform: "uppercase", letterSpacing: ".1em",
  fontWeight: 600, color: "var(--text-dim)", marginBottom: "var(--space-2)",
};

const FINISH_PHRASE: Record<string, { text: string; tone: string }> = {
  task_done: { text: "Completed", tone: "var(--good)" },
  review_approved: { text: "Approved", tone: "var(--good)" },
  review_changes: { text: "Changes requested", tone: "var(--attend)" },
  task_failed: { text: "Escalated", tone: "var(--crit)" },
};

const HOP_TONE: Record<OrgWalkStep["decision"], string> = {
  delegated: "var(--text-dim)", referred: "var(--attend)",
  precedent: "var(--mind)", answered: "var(--good)",
};

export function RuntimeTray({ open, onClose, work, walk }: {
  open: boolean;
  onClose: () => void;
  /** null = the seeded gate (503): the store doesn't exist yet. */
  work: WorkStateResponse | null;
  walk: { question: string; steps: OrgWalkStep[]; revealed: number; busy: boolean } | null;
}) {
  // The tray is its own bounded region (spec Rev 10) — it measures itself
  // rather than reading the instrument budget, because it floats over the
  // instrument instead of living inside it.
  const [trayRef, trayH] = useMeasuredHeight();
  useEffect(() => {
    if (!open) return;
    const h = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, [open, onClose]);
  if (!open) return null;
  // Four sections share the sheet; each gets a quarter minus its own label.
  const sectionPx = regionBudget(trayH / 4, 44);

  const tasks = work?.tasks ?? [];
  const byId = new Map(tasks.map((t) => [t.id, t]));
  const running = tasks.filter((t) => t.status === "in_progress");
  // The cycle's true pick order — the same predicate the server runs.
  const ready = tasks
    .filter((t) => t.status === "todo" && t.attempts < t.maxAttempts
      && t.dependsOn.every((id) => byId.get(id)?.status === "done"))
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  const finished = (work?.runLog ?? []).filter((e) => e.kind in FINISH_PHRASE).slice(0, 6);
  const hops = walk ? walk.steps.slice(0, walk.revealed) : [];

  const row = (key: string, dot: string, breathing: boolean, main: string, meta?: string) => (
    <div key={key} style={{ display: "flex", alignItems: "center", gap: 10, minWidth: 0, padding: "5px 0" }}>
      <span aria-hidden className={breathing && !REDUCE ? "cv-breathe" : undefined}
        style={{ width: 7, height: 7, borderRadius: "50%", background: dot, flexShrink: 0 }} />
      <span style={{ flex: 1, minWidth: 0, fontSize: "var(--text-sm)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{main}</span>
      {meta && <span className="text-dim" style={{ fontSize: "var(--text-xs)", whiteSpace: "nowrap" }}>{meta}</span>}
    </div>
  );

  return (
    <>
      {/* outside-click catcher — no scrim: this is a popover, not a modal */}
      <div onClick={onClose} aria-hidden style={{ position: "fixed", inset: 0, zIndex: 40 }} />
      <aside ref={trayRef} role="complementary" aria-label="Runtime" className="cv-pop" style={{
        position: "fixed", top: 12, right: 12, bottom: 12, width: 380, maxWidth: "92vw", zIndex: 41,
        display: "flex", flexDirection: "column", gap: "var(--space-5)",
        padding: "var(--space-5) var(--space-6)", overflow: "hidden",
        animation: REDUCE ? undefined : "cv-tray-in 160ms var(--ease) both",
      }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <span style={{ fontSize: "var(--text-lg)", fontWeight: 650, letterSpacing: "-0.01em" }}>Runtime</span>
          <button onClick={onClose} aria-label="Close runtime"
            style={{ all: "unset", cursor: "pointer", padding: "4px 8px", color: "var(--text-dim)", fontSize: "var(--text-base)", minHeight: 0 }}>✕</button>
        </div>

        {work === null && (
          <div style={{
            borderRadius: "var(--radius-lg)", padding: "var(--space-4) var(--space-5)",
            background: "rgba(255,255,255,0.45)", border: "1px dashed rgba(0,0,0,0.12)",
          }}>
            <span className="text-dim" style={{ fontSize: "var(--text-sm)" }}>
              The runtime hasn't started — seed it from the Work lens.
            </span>
          </div>
        )}

        {/* Walking: a live investigation's hops, appending as they land. */}
        {walk && hops.length > 0 && (
          <div>
            <div style={LABEL}>Walking</div>
            <div className="text-dim" style={{ fontSize: "var(--text-xs)", marginBottom: 6, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{walk.question}</div>
            {hops.map((s) => row(`hop-${s.id}`, HOP_TONE[s.decision], walk.busy && s === hops[hops.length - 1],
              displayName(s.nodeTitle), s.decision))}
          </div>
        )}

        {work !== null && (
          <div>
            <div style={LABEL}>Now</div>
            {running.length === 0
              ? <span className="text-dim" style={{ fontSize: "var(--text-sm)" }}>Nothing running.</span>
              : <ClampedList items={running} rowPx={27} availPx={sectionPx} min={1} max={5}
                  render={(t) => row(t.id, "var(--live)", true,
                    `Running · ${t.title}`, `attempt ${t.attempts + 1} of ${t.maxAttempts}`)} />}
          </div>
        )}

        {work !== null && (
          <div>
            <div style={LABEL}>Up next</div>
            {ready.length === 0
              ? <span className="text-dim" style={{ fontSize: "var(--text-sm)" }}>Nothing ready.</span>
              : (
                <>
                  <ClampedList items={ready} rowPx={27} availPx={sectionPx} min={1} max={5}
                    moreLabel={(hidden, total) => `next ${total - hidden} of ${total} ready`}
                    render={(t) => row(t.id, "rgba(0,0,0,0.18)", false,
                      t.title, displayName(t.assigneeSlot.split(".").pop() ?? t.assigneeSlot))} />
                  <div className="text-dim" style={{ fontSize: "var(--text-xs)", marginTop: 4 }}>
                    the order a cycle would pick
                  </div>
                </>
              )}
          </div>
        )}

        {/* Just finished: an accumulated record — silent until it exists. */}
        {finished.length > 0 && (
          <div>
            <div style={LABEL}>Just finished</div>
            <ClampedList items={finished} rowPx={27} availPx={sectionPx} min={1} max={6} render={(e) => {
              const p = FINISH_PHRASE[e.kind]!;
              const title = (e.taskId && byId.get(e.taskId)?.title) || e.detail;
              return row(e.id, p.tone, false, `${p.text} · ${title}`, ago(e.ts));
            }} />
          </div>
        )}
      </aside>
    </>
  );
}
