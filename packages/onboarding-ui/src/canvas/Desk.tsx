/** The desk (spec Rev 8) — a work node's L1 body, recreating the desk
 *  mockup on real store data and nothing else:
 *
 *    main column: the Currently-Working hero (the in_progress task, its
 *    started time, what it's waiting on) and the Working On rows (the
 *    desk's open tasks, rich); sidebar: Recent activity (merged run
 *    events + walk hops), Memory, Artifacts (deliverables) as counted
 *    previews that exit to their lenses.
 *
 *  What the mockup drew that this deliberately does NOT recreate:
 *  fabricated progress percentages, fictional humans with photos,
 *  invented "thought" counts, and a printed "Healthy" pill (nominal is
 *  silence — spec Rev 7). Every number below is counted store state. */

import { useState } from "react";
import type { CSSProperties, ReactNode } from "react";
import { Ic } from "./icons";
import { Medallion, ago, displayName } from "./OrgFlywheel";
import { TASK_TONE } from "./WorkPanel";
import { ClampedList } from "./ClampedList";
import { regionBudget, useMeasuredHeight } from "./layout";
import type {
  OrgChildRef, OrgMemoryEntry, OrgNode, OrgWalkStep,
  WorkDeliverable, WorkRunEvent, WorkTask,
} from "./contract";

/** A region's own label + footer (spec Rev 10). Every other dimension the
 *  desk uses is measured, not guessed. */
const REGION_LABEL_PX = 64;
/** Each sidebar card's label and "view all" footer. */
const SIDE_CARD_CHROME_PX = 74;
/** One Working-On row: medallion + two lines of text. */
const ROW_PX = 69;

const CARD: CSSProperties = { padding: "var(--space-5) var(--space-6)" };
const LABEL: CSSProperties = {
  fontSize: "var(--text-xs)", textTransform: "uppercase", letterSpacing: ".1em",
  marginBottom: "var(--space-3)",
};

/** Status pill: tone-tinted hairline capsule — the word always prints. */
function StatusPill({ status }: { status: WorkTask["status"] }) {
  const tone = TASK_TONE[status];
  return (
    <span style={{
      fontSize: "var(--text-xs)", fontWeight: 600, color: tone.text,
      background: `color-mix(in srgb, ${tone.text} 10%, transparent)`,
      borderRadius: 999, padding: "3px 12px", whiteSpace: "nowrap",
    }}>
      {tone.label}
    </span>
  );
}

/** The reporting structure as a compact tree: this node above, its
 *  reports below, connectors drawn on an even grid. Pure children data. */
export function MiniOrgChart({ node, kids, hueFor, glyph, onNavigate, onViewOrg }: {
  node: OrgNode;
  kids: OrgChildRef[];
  hueFor: (id: string, kind: OrgNode["kind"]) => string;
  glyph: (n: { id: string; kind: OrgNode["kind"]; title: string }) => string;
  onNavigate: (id: string) => void;
  onViewOrg: () => void;
}) {
  const n = kids.length;
  if (n === 0) return null;
  const shown = kids.slice(0, 5);
  const chip = (id: string, kind: OrgNode["kind"], title: string, self = false) => {
    const hue = self ? "#8B8B88" : hueFor(id, kind);
    return (
      <button key={id} onClick={() => !self && onNavigate(id)}
        disabled={self} className={self ? undefined : "cv-lift"}
        style={{
          display: "inline-flex", alignItems: "center", gap: 7, minHeight: 32,
          background: `color-mix(in srgb, ${hue} 8%, #FFFFFF)`,
          border: `1px solid color-mix(in srgb, ${hue} 26%, transparent)`,
          borderRadius: 9, padding: "5px 14px", cursor: self ? "default" : "pointer",
          fontSize: "var(--text-sm)", fontWeight: 600, color: "var(--text)", boxShadow: "none",
        }}>
        <Ic name={glyph({ id, kind, title })} size={12} color={hue} />
        {displayName(title.split(".").pop() ?? title)}
      </button>
    );
  };
  return (
    <div style={{ maxWidth: 400, flex: "0 1 auto" }}>
      <div style={{ display: "flex", justifyContent: "center" }}>
        {chip(node.id, node.kind, node.title, true)}
      </div>
      {/* connectors on an even grid — one drop per shown child */}
      <svg aria-hidden width="100%" height={20} viewBox="0 0 100 20" preserveAspectRatio="none" style={{ display: "block" }}>
        <path d={`M 50 0 V 9 M ${(0.5 / shown.length) * 100} 9 H ${((shown.length - 0.5) / shown.length) * 100} ${shown.map((_, i) => `M ${((i + 0.5) / shown.length) * 100} 9 V 20`).join(" ")}`}
          fill="none" stroke="rgba(0,0,0,0.14)" strokeWidth={1} vectorEffect="non-scaling-stroke" />
      </svg>
      <div style={{ display: "grid", gridTemplateColumns: `repeat(${shown.length}, 1fr)`, gap: 6 }}>
        {shown.map((k) => (
          <div key={k.id} style={{ display: "flex", justifyContent: "center", minWidth: 0 }}>
            {chip(k.id, k.kind, k.title)}
          </div>
        ))}
      </div>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginTop: "var(--space-2)", gap: "var(--space-3)" }}>
        <span className="text-dim" style={{ fontSize: "var(--text-xs)" }}>
          Reporting structure{kids.length > shown.length ? ` · ${kids.length - shown.length} more` : ""}
        </span>
        <button className="secondary" onClick={onViewOrg}
          style={{ fontSize: "var(--text-xs)", padding: "3px 12px", minHeight: 26 }}>
          View Org
        </button>
      </div>
    </div>
  );
}

/** A tiny cadence sparkline from the dashboard's 12-day run series —
 *  real counts, labeled org-wide. Renders nothing when all-zero. */
function Cadence({ days }: { days: Array<{ date: string; total: number }> }) {
  const max = Math.max(...days.map((d) => d.total), 0);
  if (max === 0) return null;
  const pts = days.map((d, i) => `${(i / (days.length - 1)) * 100},${28 - (d.total / max) * 24}`).join(" ");
  return (
    <div style={{ textAlign: "right" }}>
      <svg aria-hidden width={110} height={30} viewBox="0 0 100 30" preserveAspectRatio="none">
        <polyline points={pts} fill="none" stroke="var(--live)" strokeWidth={1.5} vectorEffect="non-scaling-stroke" />
      </svg>
      <div className="text-dim" style={{ fontSize: "var(--text-xs)" }}>runs · 12d · org-wide</div>
    </div>
  );
}

export function DeskBody({ seeded, mine, allTasks, deliverables, runLog, walkSteps, memory, runDays, hue, onOpenLens }: {
  /** False = the work store doesn't exist yet — say so, imply nothing. */
  seeded: boolean;
  /** This desk's tasks (assignee slot in the desk's name set). */
  mine: WorkTask[];
  allTasks: WorkTask[];
  deliverables: WorkDeliverable[];
  runLog: WorkRunEvent[];
  walkSteps: OrgWalkStep[];
  memory: OrgMemoryEntry[];
  runDays: Array<{ date: string; total: number }> | null;
  hue: string;
  /** Exit to a company lens (work / investigations / learned). */
  onOpenLens: (lens: "work" | "investigations" | "learned") => void;
}) {
  const byId = new Map(allTasks.map((t) => [t.id, t]));
  // The sidebar's three cards share the column: each gets its slice of the
  // instrument budget, so a short window thins all three evenly rather than
  // letting the first card eat the space and push the rest off-screen.
  const [workingRef, workingH] = useMeasuredHeight();
  const [sideRef, sideH] = useMeasuredHeight();
  const cards = (memory.length > 0 ? 1 : 0) + (deliverables.length > 0 ? 1 : 0) + 1;
  const sidebarPx = regionBudget(sideH / Math.max(1, cards), SIDE_CARD_CHROME_PX);
  // L2 per row: the chevron is honest — a row expands to the full brief
  // and its latest deliverable state. Nothing navigates away.
  const [openRows, setOpenRows] = useState<Set<string>>(new Set());
  const toggleRow = (id: string) => setOpenRows((cur) => {
    const n = new Set(cur);
    if (n.has(id)) n.delete(id); else n.add(id);
    return n;
  });
  const mineIds = new Set(mine.map((t) => t.id));
  const running = mine.find((t) => t.status === "in_progress") ?? null;
  const nextUp = mine.find((t) => t.status === "todo") ?? null;
  const open = mine.filter((t) => t.status !== "done");
  const delivered = mine.length - open.length;
  const myDeliverables = deliverables.filter((d) => mineIds.has(d.taskId));

  /** Unmet dependencies → who this task is actually waiting on. Real. */
  const waitingOn = (t: WorkTask): string[] =>
    t.dependsOn
      .map((id) => byId.get(id))
      .filter((d): d is WorkTask => !!d && d.status !== "done")
      .map((d) => displayName(d.assigneeSlot));

  /* The activity feed: run events for this desk merged with walk hops,
   * newest first — the "thinking" stream, from the two real logs. The
   * phrasing is human; every line is still a real logged event. */
  const EVENT_PHRASE: Record<string, string> = {
    seeded: "Runtime seeded", goal_created: "Goal created", task_created: "Task created",
    cycle_started: "Cycle started", task_started: "Started", task_output: "Delivered a draft",
    qa_structural: "Structural checks", review_approved: "Approved", review_changes: "Changes requested",
    task_requeued: "Requeued", task_failed: "Escalated", task_done: "Completed",
  };
  const feed: Array<{ key: string; ts: string; text: string; tone: string }> = [
    ...runLog.map((e) => ({
      key: `ev-${e.id}`, ts: e.ts,
      text: `${EVENT_PHRASE[e.kind] ?? e.kind} · ${e.detail}`,
      tone: e.kind === "task_done" ? "var(--good)"
        : e.kind === "task_failed" ? "var(--crit)"
        : e.kind === "task_started" || e.kind === "task_output" ? "var(--live)"
        : "rgba(0,0,0,0.22)",
    })),
    ...walkSteps.map((s) => ({
      key: `hop-${s.id}`, ts: s.ts,
      text: `asked: ${s.question}`,
      tone: "var(--mind)",
    })),
  ].sort((a, b) => b.ts.localeCompare(a.ts));

  const sideCard = (label: string, count: number, rows: ReactNode, footer?: { text: string; onClick: () => void }) => (
    <div className="cv-paper" style={CARD}>
      <div className="text-dim" style={{ ...LABEL, display: "flex", gap: 8 }}>
        <span>{label}</span>
        <span style={{ textTransform: "none", letterSpacing: 0 }}>{count}</span>
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>{rows}</div>
      {footer && (
        <button onClick={footer.onClick}
          style={{ all: "unset", cursor: "pointer", marginTop: "var(--space-2)", fontSize: "var(--text-xs)", color: "var(--text-dim)", minHeight: 24 }}>
          {footer.text} →
        </button>
      )}
    </div>
  );

  return (
    // Rev 10: the desk fills its zone and its two columns share it. No
    // marginTop — `height: 100%` doesn't account for margin, and the excess
    // becomes silent clipping.
    <div style={{ height: "100%", minHeight: 0, display: "flex", gap: "var(--space-4)", alignItems: "stretch", paddingTop: "var(--space-4)", boxSizing: "border-box" }}>
      {/* ---------------- main column: the work ---------------- */}
      <div style={{ flex: "1 1 480px", minWidth: 0, minHeight: 0, display: "flex", flexDirection: "column", gap: "var(--space-4)" }}>
        <div style={{ flexShrink: 0 }}>
          <div className="text-dim" style={LABEL}>Currently working</div>
          <div className="cv-paper" style={{ ...CARD, display: "flex", alignItems: "center", gap: "var(--space-4)" }}>
            {running ? (
              <>
                <span className="cv-breathe" aria-hidden
                  style={{ width: 10, height: 10, borderRadius: "50%", background: "var(--live)", flexShrink: 0 }} />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: "var(--text-base)", fontWeight: 600 }}>{running.title}</div>
                  <div className="text-dim" style={{ fontSize: "var(--text-sm)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    {running.brief.split("\n")[0]}
                  </div>
                  <div style={{ display: "flex", gap: 8, marginTop: 8, flexWrap: "wrap", alignItems: "center" }}>
                    {running.startedAt && (
                      <span className="text-dim" style={{ fontSize: "var(--text-xs)", border: "1px solid rgba(0,0,0,0.08)", borderRadius: 999, padding: "2px 10px" }}>
                        started {new Date(running.startedAt).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}
                      </span>
                    )}
                    {waitingOn(running).map((w) => (
                      <span key={w} style={{ fontSize: "var(--text-xs)", color: "var(--attend)", border: "1px solid color-mix(in srgb, var(--attend) 30%, transparent)", background: "color-mix(in srgb, var(--attend) 8%, transparent)", borderRadius: 999, padding: "2px 10px" }}>
                        waiting on {w}
                      </span>
                    ))}
                    <span style={{ fontSize: "var(--text-xs)", color: "var(--live)" }}>
                      attempt {running.attempts + 1} of {running.maxAttempts}
                    </span>
                  </div>
                </div>
              </>
            ) : (
              <div style={{ flex: 1, minWidth: 0 }}>
                <div className="text-dim" style={{ fontSize: "var(--text-sm)" }}>
                  {seeded ? "Idle right now." : "The runtime hasn't started — seed it from the Work lens."}
                </div>
                {nextUp && (
                  <div style={{ fontSize: "var(--text-sm)", marginTop: 4 }}>
                    <span className="text-dim">next in queue · </span>{nextUp.title}
                  </div>
                )}
              </div>
            )}
            {runDays && <Cadence days={runDays} />}
          </div>
        </div>

        {seeded && (
        <div ref={workingRef} style={{ flex: 1, minHeight: 0, overflow: "hidden" }}>
          <div className="text-dim" style={LABEL}>Working on</div>
          {mine.length === 0 && <span className="text-dim" style={{ fontSize: "var(--text-sm)" }}>Nothing queued for this desk.</span>}
          {/* The density gradient made real (Rev 10): when the window can't
              seat even one row, the region folds to its counted line rather
              than forcing a row that would overflow the zone. */}
          {open.length > 0 && workingH > 0 && workingH - REGION_LABEL_PX < ROW_PX && (
            <button onClick={() => onOpenLens("work")}
              style={{ all: "unset", cursor: "pointer", fontSize: "var(--text-sm)", color: "var(--text-dim)", minHeight: 24 }}>
              {open.length} open task{open.length === 1 ? "" : "s"} · View all work →
            </button>
          )}
          {open.length > 0 && !(workingH > 0 && workingH - REGION_LABEL_PX < ROW_PX) && (
            <div className="cv-paper" style={{ padding: "0 var(--space-4)" }}>
              {/* The fit law (spec Rev 10): rows are budgeted by the window,
                  not by a constant. Overflow descends to the Work lens. */}
              <ClampedList items={open} rowPx={ROW_PX} availPx={workingH} reservedPx={REGION_LABEL_PX} min={1} max={8}
                onMore={() => onOpenLens("work")}
                moreLabel={(hidden) => `+${hidden} more in Work →`}
                render={(t, i) => {
                const waits = waitingOn(t);
                const expanded = openRows.has(t.id);
                const latest = myDeliverables.find((d) => d.taskId === t.id) ?? null;
                return (
                  <div key={t.id} style={{ borderTop: i > 0 ? "1px solid rgba(0,0,0,0.05)" : undefined }}>
                    <button onClick={() => toggleRow(t.id)} aria-expanded={expanded}
                      style={{
                        all: "unset", boxSizing: "border-box", cursor: "pointer", width: "100%",
                        display: "flex", alignItems: "center", gap: "var(--space-3)",
                        padding: "14px 0", minWidth: 0, minHeight: 0,
                      }}>
                      <Medallion icon="box" hue={hue} size={40} />
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontSize: "var(--text-base)", fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", color: "var(--text)" }}>{t.title}</div>
                        <div className="text-dim" style={{ fontSize: "var(--text-sm)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                          {t.brief.split("\n")[0]}
                        </div>
                      </div>
                      {waits.length > 0 && (
                        <span className="text-dim" style={{ fontSize: "var(--text-xs)", whiteSpace: "nowrap" }}>
                          waits on {waits.join(", ")}
                        </span>
                      )}
                      {t.attempts > 0 && (
                        <span className="text-dim" style={{ fontSize: "var(--text-xs)", whiteSpace: "nowrap" }} title="attempts used of the ceiling">
                          {t.attempts}/{t.maxAttempts}
                        </span>
                      )}
                      <span className="text-dim" style={{ fontSize: "var(--text-xs)", whiteSpace: "nowrap" }}>
                        {displayName(t.assigneeSlot.split(".").pop() ?? t.assigneeSlot)} · {ago(t.updatedAt)}
                      </span>
                      <StatusPill status={t.status} />
                      <span aria-hidden className="text-dim" style={{
                        fontSize: "var(--text-sm)", display: "inline-block",
                        transform: expanded ? "rotate(90deg)" : "none", transition: "transform 130ms var(--ease)",
                      }}>›</span>
                    </button>
                    {expanded && (
                      <div style={{ padding: "0 0 14px 52px" }}>
                        <div className="text-dim" style={{ fontSize: "var(--text-sm)", whiteSpace: "pre-wrap", wordBreak: "break-word" }}>{t.brief}</div>
                        {latest && (
                          <div style={{ fontSize: "var(--text-xs)", marginTop: 8, color: latest.review === "approved" ? "var(--good)" : latest.review === "changes_requested" ? "var(--attend)" : "var(--mind)" }}>
                            latest deliverable · attempt {latest.attempt} · {latest.review.replace(/_/g, " ")} · {ago(latest.createdAt)}
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                );
              }} />
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "10px 0", borderTop: "1px solid rgba(0,0,0,0.05)" }}>
                <button onClick={() => onOpenLens("work")}
                  style={{ all: "unset", cursor: "pointer", fontSize: "var(--text-xs)", color: "var(--text-dim)", minHeight: 24 }}>
                  View all work →
                </button>
                {delivered > 0 && (
                  <span className="text-dim" style={{ fontSize: "var(--text-xs)" }}>{delivered} delivered</span>
                )}
              </div>
            </div>
          )}
          {mine.length > 0 && open.length === 0 && (
            <span className="text-dim" style={{ fontSize: "var(--text-sm)" }}>Queue clear — every task delivered ({delivered}).</span>
          )}
        </div>
        )}
      </div>

      {/* ---------------- sidebar: the desk's record ---------------- */}
      <div ref={sideRef} style={{ flex: "0 1 320px", minWidth: 260, minHeight: 0, display: "flex", flexDirection: "column", gap: "var(--space-3)" }}>
        {feed.length > 0 && sideCard("Recent activity", feed.length,
          <ClampedList items={feed} rowPx={22} availPx={sidebarPx} min={0} max={6} countInHeader render={(f) => (
            <div key={f.key} style={{ display: "flex", alignItems: "baseline", gap: 8, minWidth: 0 }}>
              <span aria-hidden style={{ width: 6, height: 6, borderRadius: "50%", background: f.tone, flexShrink: 0, alignSelf: "center" }} />
              <span style={{ flex: 1, minWidth: 0, fontSize: "var(--text-xs)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{f.text}</span>
              <span className="text-dim" style={{ fontSize: "var(--text-xs)", whiteSpace: "nowrap" }}>{ago(f.ts)}</span>
            </div>
          )} />,
          { text: "View investigations", onClick: () => onOpenLens("investigations") },
        )}
        {memory.length > 0 && sideCard("Memory", memory.length,
          <ClampedList items={memory} rowPx={22} availPx={sidebarPx} min={0} max={5} countInHeader render={(m) => (
            <div key={m.id} style={{ display: "flex", alignItems: "baseline", gap: 8, minWidth: 0 }}>
              <span aria-hidden style={{ width: 6, height: 6, borderRadius: "50%", background: "var(--mind)", flexShrink: 0, alignSelf: "center" }} />
              <span style={{ flex: 1, minWidth: 0, fontSize: "var(--text-xs)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{m.claim}</span>
              <span className="text-dim" style={{ fontSize: "var(--text-xs)", whiteSpace: "nowrap" }}>{ago(m.derivedAt)}</span>
            </div>
          )} />,
          { text: "View all memories", onClick: () => onOpenLens("learned") },
        )}
        {myDeliverables.length > 0 && sideCard("Artifacts", myDeliverables.length,
          <ClampedList items={myDeliverables} rowPx={22} availPx={sidebarPx} min={0} max={5} countInHeader render={(d) => {
            const t = byId.get(d.taskId);
            const tone = d.review === "approved" ? "var(--good)" : d.review === "changes_requested" ? "var(--attend)" : "var(--mind)";
            return (
              <div key={d.id} style={{ display: "flex", alignItems: "center", gap: 8, minWidth: 0 }}>
                <Ic name="box" size={13} color={tone} />
                <span style={{ flex: 1, minWidth: 0, fontSize: "var(--text-xs)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  {t?.title ?? d.taskId}
                </span>
                <span className="text-dim" style={{ fontSize: "var(--text-xs)", whiteSpace: "nowrap" }}>
                  attempt {d.attempt} · {ago(d.createdAt)}
                </span>
              </div>
            );
          }} />,
          { text: "Review in Work", onClick: () => onOpenLens("work") },
        )}
      </div>
    </div>
  );
}
