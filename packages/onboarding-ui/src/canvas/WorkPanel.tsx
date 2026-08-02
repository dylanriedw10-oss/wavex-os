/** The Work view (spec Rev 6) — the native runtime made visible: goals
 *  with real done/total meters, the task ladder in status tones, the
 *  review queue (the operator IS the semantic QA gate in P1), and the
 *  cycle trigger that executes briefs on the operator's own subscription.
 *
 *  Honesty rules carried through: every row is store state; empty states
 *  say what's missing; deliverable output renders verbatim, never edited;
 *  status color never travels without its printed status word. */

import { useState } from "react";
import type { CSSProperties } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { wavexOsOnboardingApi, ApiError } from "../wavex-os/lib/api";
import type { WorkDeliverable, WorkStateResponse, WorkTask, WorkTaskStatus } from "./contract";

const REDUCE = typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;

const displayName = (t: string): string => t.charAt(0).toUpperCase() + t.slice(1);

function ago(iso: string): string {
  const s = Math.max(0, (Date.now() - Date.parse(iso)) / 1000);
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.round(s / 60)}m ago`;
  if (s < 86_400) return `${Math.round(s / 3600)}h ago`;
  return `${Math.round(s / 86_400)}d ago`;
}

/* The task ladder's status tones — the dot and the word always travel
 * together (color alone never carries status). */
export const TASK_TONE: Record<WorkTaskStatus, { dot: string; text: string; label: string }> = {
  todo:        { dot: "rgba(0,0,0,0.18)", text: "var(--text-dim)", label: "todo" },
  in_progress: { dot: "var(--live)",      text: "var(--live)",     label: "running" },
  in_review:   { dot: "var(--attend)",    text: "var(--attend)",   label: "in review" },
  done:        { dot: "var(--good)",      text: "var(--good)",     label: "done" },
  blocked:     { dot: "var(--crit)",      text: "var(--crit)",     label: "blocked" },
  failed:      { dot: "var(--crit)",      text: "var(--crit)",     label: "failed" },
};

const PANEL: CSSProperties = {
  borderRadius: "var(--radius-lg)", padding: "var(--space-5) var(--space-6)",
  background: "var(--panel)", border: "1px solid rgba(0,0,0,0.06)",
  boxShadow: "var(--elev-1)",
};

const GHOST: CSSProperties = {
  borderRadius: "var(--radius-lg)", padding: "var(--space-5) var(--space-6)",
  background: "rgba(255,255,255,0.45)", border: "1px dashed rgba(0,0,0,0.12)",
};

const LABEL: CSSProperties = {
  fontSize: "var(--text-xs)", textTransform: "uppercase", letterSpacing: ".1em",
  marginBottom: "var(--space-3)",
};

/** One task as a row — shared by the Work view and the node Queue sections.
 *  showStatus=false inside grouped ladders: the group header already says
 *  the word once; repeating it per row is noise, not information. */
export function WorkTaskRow({ task, showStatus = true }: { task: WorkTask; showStatus?: boolean }) {
  const tone = TASK_TONE[task.status];
  return (
    <div style={{ display: "flex", alignItems: "center", gap: "var(--space-3)", padding: "9px 0", minWidth: 0 }}>
      <span className={task.status === "in_progress" && !REDUCE ? "cv-breathe" : undefined} aria-hidden
        style={{ width: 7, height: 7, borderRadius: "50%", background: tone.dot, flexShrink: 0 }} />
      <span style={{
        fontSize: "var(--text-base)", flex: 1, minWidth: 0,
        overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
        color: task.status === "todo" ? "var(--text-dim)" : "var(--text)",
      }}>
        {task.title}
      </span>
      <span className="text-dim" style={{ fontSize: "var(--text-xs)", whiteSpace: "nowrap" }}>
        {displayName(task.assigneeSlot)}
      </span>
      {task.attempts > 0 && (
        <span className="text-dim" style={{ fontSize: "var(--text-xs)", whiteSpace: "nowrap" }}
          title="attempts used of the ceiling">
          {task.attempts}/{task.maxAttempts}
        </span>
      )}
      {showStatus && (
        <span style={{ color: tone.text, fontSize: "var(--text-xs)", whiteSpace: "nowrap" }}>
          {tone.label}
        </span>
      )}
    </div>
  );
}

function structuralLine(d: WorkDeliverable): string {
  if (d.structural.passed) return "structural checks passed";
  const parts: string[] = [];
  if (!d.structural.nonEmpty) parts.push("output empty");
  else if (!d.structural.meetsMinLength) parts.push("output too short");
  if (d.structural.missingSections.length) parts.push(`missing sections: ${d.structural.missingSections.join(", ")}`);
  return `structural checks failed: ${parts.join(" · ") || "failed"}`;
}

export function WorkPanel({ companyId }: { companyId: string }) {
  const qc = useQueryClient();
  const [busy, setBusy] = useState<"seed" | "cycle" | null>(null);
  const workQ = useQuery({
    queryKey: ["org-work", companyId],
    queryFn: () => wavexOsOnboardingApi.getWork(companyId),
    retry: false,
    // The cycle writes the store between serial steps — poll fast while
    // one runs so the ladder tells the mid-flight truth (live dots, not
    // a frozen pre-cycle snapshot).
    refetchInterval: busy === "cycle" ? 2_000 : 30_000,
  });
  const [reviewBusy, setReviewBusy] = useState<string | null>(null);
  const [changesFor, setChangesFor] = useState<string | null>(null);
  const [note, setNote] = useState("");
  const [flash, setFlash] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  // The descent (spec Rev 7): exception states arrive open — live work,
  // work awaiting you, work that broke. Nominal states (todo backlog,
  // delivered tail) fold to a counted line until asked.
  const [openGroups, setOpenGroups] = useState<Set<WorkTaskStatus>>(
    () => new Set<WorkTaskStatus>(["in_progress", "in_review", "blocked", "failed"]),
  );
  const toggleGroup = (s: WorkTaskStatus) => setOpenGroups((cur) => {
    const n = new Set(cur);
    if (n.has(s)) n.delete(s); else n.add(s);
    return n;
  });
  // L3: a deliverable's output unrolls per card — verbatim either way.
  const [openOutput, setOpenOutput] = useState<Set<string>>(new Set());
  const toggleOutput = (id: string) => setOpenOutput((cur) => {
    const n = new Set(cur);
    if (n.has(id)) n.delete(id); else n.add(id);
    return n;
  });

  const refresh = () => {
    void qc.invalidateQueries({ queryKey: ["org-work", companyId] });
    void qc.invalidateQueries({ queryKey: ["org-live", companyId] });
    void qc.invalidateQueries({ queryKey: ["org-flywheel", companyId] });
    void qc.invalidateQueries({ queryKey: ["org-node", companyId] });
  };

  const seed = async () => {
    setBusy("seed"); setErr(null);
    try {
      await wavexOsOnboardingApi.seedWork(companyId);
      refresh();
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  };

  const runCycle = async () => {
    setBusy("cycle"); setErr(null); setFlash(null);
    try {
      const r = await wavexOsOnboardingApi.runWorkCycle(companyId);
      const reviews = r.ran.filter((x) => x.outcome === "in_review").length;
      setFlash(r.ran.length === 0
        ? "Nothing ready to run."
        : `Ran ${r.ran.length} task${r.ran.length === 1 ? "" : "s"} — ${reviews} awaiting review${r.stoppedEarly ? ` · stopped: ${r.stoppedEarly}` : ""}`);
      refresh();
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  };

  const review = async (id: string, verdict: "approved" | "changes_requested", noteText?: string) => {
    setReviewBusy(id); setErr(null);
    try {
      await wavexOsOnboardingApi.reviewWorkDeliverable(companyId, id, {
        verdict, ...(noteText?.trim() ? { note: noteText.trim() } : {}),
      });
      setChangesFor(null); setNote("");
      refresh();
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : String(e));
    } finally {
      setReviewBusy(null);
    }
  };

  // 503 = the seeded gate: the store doesn't exist yet, which is a first-
  // class state with its own affordance — never an error screen.
  const notStarted = workQ.error instanceof ApiError && workQ.error.status === 503;

  if (notStarted) {
    return (
      <div style={{ marginTop: "var(--space-3)", maxWidth: 760 }}>
        <div style={GHOST}>
          <div style={{ fontSize: "var(--text-sm)" }}>The runtime hasn't started.</div>
          <div className="text-dim" style={{ fontSize: "var(--text-xs)", marginTop: 4 }}>
            No work store yet — seeding derives the first goal and one bootstrap task per agent from the signed manifest.
          </div>
          <button onClick={() => void seed()} disabled={busy === "seed"} style={{ marginTop: "var(--space-3)" }}>
            {busy === "seed" ? "Seeding…" : "Seed from manifest"}
          </button>
          {err && <div style={{ fontSize: "var(--text-sm)", color: "var(--crit)", marginTop: "var(--space-2)" }}>{err}</div>}
        </div>
      </div>
    );
  }
  if (workQ.isLoading) {
    return <div style={{ marginTop: "var(--space-3)" }}><span className="text-dim" style={{ fontSize: "var(--text-sm)" }}>reading the runtime…</span></div>;
  }
  if (workQ.isError || !workQ.data) {
    const e = workQ.error as Error;
    return (
      <div style={{ marginTop: "var(--space-3)", maxWidth: 760 }}>
        <span style={{ fontSize: "var(--text-sm)", color: "var(--attend)" }}>
          Couldn't read the runtime{e instanceof ApiError ? ` — ${e.message}` : ""}.
          <button className="secondary" onClick={() => void workQ.refetch()}
            style={{ fontSize: "var(--text-xs)", padding: "2px 10px", minHeight: 26, marginLeft: 8 }}>Retry</button>
        </span>
      </div>
    );
  }

  const w: WorkStateResponse = workQ.data;
  const taskById = new Map(w.tasks.map((t) => [t.id, t]));
  const pending = w.deliverables.filter((d) => d.review === "pending_review");

  return (
    <div style={{ marginTop: "var(--space-3)", maxWidth: 760, display: "flex", flexDirection: "column", gap: "var(--space-4)" }}>
      {/* The cycle trigger — serial by design in P1 so token attribution
          stays honest; the copy says so instead of pretending parallelism. */}
      <div>
        <div style={{ display: "flex", alignItems: "center", gap: "var(--space-3)", flexWrap: "wrap" }}>
          <button onClick={() => void runCycle()} disabled={busy === "cycle"}>
            {busy === "cycle" ? "Running cycle…" : "Run cycle"}
          </button>
          <span className="text-dim" style={{ fontSize: "var(--text-xs)" }}>
            executes ready tasks serially on your subscription
          </span>
        </div>
        {flash && <div style={{ fontSize: "var(--text-sm)", marginTop: "var(--space-2)" }}>{flash}</div>}
        {err && <div style={{ fontSize: "var(--text-sm)", color: "var(--crit)", marginTop: "var(--space-2)" }}>{err}</div>}
      </div>

      {/* Goals: the compass — the meter counts DONE tasks, nothing softer. */}
      <div>
        <div className="text-dim" style={LABEL}>Goals</div>
        {w.goals.length === 0 && <span className="text-dim" style={{ fontSize: "var(--text-sm)" }}>No goals yet.</span>}
        {w.goals.map((g) => {
          const gt = w.tasks.filter((t) => t.goalId === g.id);
          const done = gt.filter((t) => t.status === "done").length;
          const pct = gt.length ? Math.round((done / gt.length) * 100) : 0;
          return (
            <div key={g.id} style={{ padding: "4px 0" }}>
              <div style={{ display: "flex", alignItems: "baseline", gap: 10, flexWrap: "wrap" }}>
                <span style={{ fontSize: "var(--text-base)", fontWeight: 600 }}>{g.title}</span>
                <span className="text-dim" style={{ fontSize: "var(--text-xs)" }}>
                  {g.source === "manifest" ? "from the manifest" : "operator"} · {done}/{gt.length} done
                </span>
              </div>
              {gt.length > 0 && (
                <div style={{ marginTop: 8, maxWidth: 380 }}>
                  <div style={{ height: 4, borderRadius: 2, background: "var(--edge)" }}>
                    <div style={{ height: 4, borderRadius: 2, width: `${pct}%`, background: "var(--good)", transition: "width var(--dur-base) var(--ease)" }} />
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* The review queue: the semantic gate. Output renders verbatim —
          approve closes the task, changes fold feedback into the next brief. */}
      <div>
        <div className="text-dim" style={LABEL}>Awaiting review</div>
        {pending.length === 0 && <span className="text-dim" style={{ fontSize: "var(--text-sm)" }}>Nothing awaiting review.</span>}
        {pending.length > 0 && (
          <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-3)" }}>
            {pending.map((d) => {
              const task = taskById.get(d.taskId);
              return (
                <div key={d.id} style={PANEL}>
                  <div style={{ display: "flex", alignItems: "baseline", gap: 10, flexWrap: "wrap" }}>
                    <span style={{ fontSize: "var(--text-base)", fontWeight: 600 }}>{task?.title ?? d.taskId}</span>
                    <span className="text-dim" style={{ fontSize: "var(--text-xs)" }}>
                      attempt {d.attempt}{task ? ` of ${task.maxAttempts}` : ""}{task ? ` · ${displayName(task.assigneeSlot)}` : ""}
                    </span>
                  </div>
                  <div className="text-dim" style={{ fontSize: "var(--text-xs)", marginTop: 2 }}>
                    {structuralLine(d)} · {ago(d.createdAt)}
                  </div>
                  {/* Verbatim always — the descent only controls how much
                      unrolls: three lines by default, everything on ask. */}
                  <pre style={{
                    margin: "var(--space-3) 0 0", padding: "var(--space-3) var(--space-4)",
                    fontSize: "var(--text-xs)", fontFamily: "var(--font-mono)", lineHeight: 1.55,
                    whiteSpace: "pre-wrap", wordBreak: "break-word",
                    background: "rgba(0,0,0,0.025)", borderRadius: "var(--radius-sm)",
                    border: "1px solid rgba(0,0,0,0.05)",
                    ...(openOutput.has(d.id)
                      ? { maxHeight: 340, overflow: "auto" }
                      : { display: "-webkit-box", WebkitLineClamp: 3, WebkitBoxOrient: "vertical" as const, overflow: "hidden" }),
                  }}>
                    {d.output}
                  </pre>
                  <button onClick={() => toggleOutput(d.id)} aria-expanded={openOutput.has(d.id)}
                    style={{ all: "unset", cursor: "pointer", marginTop: 4, fontSize: "var(--text-xs)", color: "var(--text-dim)", minHeight: 24 }}>
                    {openOutput.has(d.id) ? "Collapse output" : "Show full output"}
                  </button>
                  <div style={{ display: "flex", gap: "var(--space-2)", marginTop: "var(--space-3)", alignItems: "center", flexWrap: "wrap" }}>
                    <button onClick={() => void review(d.id, "approved")} disabled={reviewBusy === d.id}
                      style={{
                        fontSize: "var(--text-xs)", padding: "6px 16px", minHeight: 32, borderRadius: 10, cursor: "pointer",
                        background: "color-mix(in srgb, var(--good) 8%, transparent)",
                        border: "1px solid color-mix(in srgb, var(--good) 35%, transparent)",
                        color: "var(--good)",
                      }}>
                      {reviewBusy === d.id ? "…" : "Approve"}
                    </button>
                    <button className="secondary" disabled={reviewBusy === d.id}
                      onClick={() => { setChangesFor((cur) => (cur === d.id ? null : d.id)); setNote(""); }}
                      aria-expanded={changesFor === d.id}
                      style={{ fontSize: "var(--text-xs)", padding: "6px 16px", minHeight: 32, borderRadius: 10 }}>
                      Request changes
                    </button>
                  </div>
                  {changesFor === d.id && (
                    <div style={{ display: "flex", gap: "var(--space-2)", marginTop: "var(--space-2)" }}>
                      <input value={note} onChange={(e) => setNote(e.target.value)}
                        placeholder="What must change?" aria-label="Change request feedback"
                        onKeyDown={(e) => { if (e.key === "Enter" && note.trim()) void review(d.id, "changes_requested", note); }}
                        style={{ flex: 1, minWidth: 0 }} />
                      <button onClick={() => void review(d.id, "changes_requested", note)}
                        disabled={reviewBusy === d.id || !note.trim()}>
                        Send feedback
                      </button>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* The task ladder — grouped by status. Exceptions (running, awaiting
          you, broken) arrive open; the nominal backlog and the delivered
          tail fold to counted lines. Every row is real store state. */}
      <div>
        <div className="text-dim" style={LABEL}>Tasks</div>
        {w.tasks.length === 0 && <span className="text-dim" style={{ fontSize: "var(--text-sm)" }}>Nothing queued.</span>}
        {w.tasks.length > 0 && (
          <div style={{ ...PANEL, padding: "var(--space-2) var(--space-4)", display: "flex", flexDirection: "column" }}>
            {(["in_progress", "in_review", "blocked", "failed", "todo", "done"] as WorkTaskStatus[]).map((status) => {
              const group = w.tasks.filter((t) => t.status === status);
              if (group.length === 0) return null;
              const tone = TASK_TONE[status];
              const open = openGroups.has(status);
              return (
                <div key={status}>
                  <button onClick={() => toggleGroup(status)} aria-expanded={open}
                    style={{ all: "unset", cursor: "pointer", display: "flex", alignItems: "center", gap: 8, minHeight: 34, width: "100%" }}>
                    <span style={{ color: tone.text, fontSize: "var(--text-xs)" }}>{tone.label}</span>
                    <span className="text-dim" style={{ fontSize: "var(--text-xs)" }}>· {group.length}</span>
                    <span className="text-dim" aria-hidden style={{
                      fontSize: "var(--text-xs)", display: "inline-block",
                      transform: open ? "rotate(90deg)" : "none", transition: "transform 130ms var(--ease)",
                    }}>▸</span>
                  </button>
                  {open && group.map((t) => <WorkTaskRow key={t.id} task={t} showStatus={false} />)}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
