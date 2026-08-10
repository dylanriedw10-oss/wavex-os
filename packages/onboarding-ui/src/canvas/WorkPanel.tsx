/** The Work view (spec Rev 6) — the native runtime made visible: goals
 *  with real done/total meters, the task ladder in status tones, the
 *  review queue (the operator IS the semantic QA gate in P1), and the
 *  cycle trigger that executes briefs on the operator's own subscription.
 *
 *  Honesty rules carried through: every row is store state; empty states
 *  say what's missing; deliverable output renders verbatim, never edited;
 *  status color never travels without its printed status word. */

import { useLayoutEffect, useRef, useState } from "react";
import type { CSSProperties } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { wavexOsOnboardingApi, ApiError } from "../wavex-os/lib/api";
import { ClampedList } from "./ClampedList";
import { regionBudget, useMeasuredHeight } from "./layout";
import type { WorkDeliverable, WorkStateResponse, WorkTask, WorkTaskStatus } from "./contract";
import { BARE_CONTROL } from "./bare-button";

/** A region's own label (spec Rev 10). Everything else is measured. */
const REGION_LABEL_PX = 64;
/** One collapsed/expanded group header in the ladder. */
const GROUP_HEADER_PX = 34;
/** One ladder row.
 *
 *  Was 70 when a row was two lines (title + brief). The deliverable-first row
 *  is ONE line: 9px padding top and bottom around `--text-base` (14px) at
 *  line-height 1.5 — 39px, rounded to 40 for the border-box.
 *
 *  This constant is load-bearing in a way that is easy to miss: it divides
 *  the region budget into "how many groups can be open", so leaving it at 70
 *  after halving the row height made the ladder claim half its real capacity
 *  and auto-close groups that fit perfectly well. The previous note in this
 *  spot records the same class of error in the other direction. If the row's
 *  padding or type size changes, change this with it. */
const LADDER_ROW_PX = 40;
/** Label + one clamped review card — the queue never renders a sliver. */
const QUEUE_MIN_PX = 210;
/** Exception groups first (they arrive open), then the nominal tail. */
const LADDER_ORDER: WorkTaskStatus[] = ["in_progress", "in_review", "blocked", "failed", "todo", "done"];

const REDUCE = typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;

const displayName = (t: string): string => t.charAt(0).toUpperCase() + t.slice(1);

/** The ORGANIZATIONAL CATEGORY a slot belongs to — `cpo.build` → `Cpo`.
 *
 *  This is the only thing the agent slot is used for on this surface. Whether
 *  one agent or fifty participate is an internal concern of the orchestration;
 *  what the operator needs is which part of the organization owns the work.
 *  The slot never renders. */
const categoryOf = (slot: string): string => slot.split(".")[0] || slot;
const categoryLabel = (slot: string): string => displayName(categoryOf(slot));

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

/** One DELIVERABLE as a row — shared by the Work view and the node Queue.
 *
 *  The deliverable is the object the operator interacts with; the task is how
 *  it gets made and the agent is who makes it, and neither is the subject
 *  here. The row therefore prints the artifact and its workflow stage, and
 *  the agent slot appears nowhere — it survives only as the grouping key that
 *  puts this row under the right category.
 *
 *  While a deliverable is in flight the row reads in present continuous
 *  ("Writing the MVP product spec"); pending and settled it reads as the
 *  artifact. That is the content/activeForm pair, and it is why the group
 *  header no longer has to repeat a status word per row.
 *
 *  showStatus=false inside grouped ladders: the stage word already travels
 *  with the row. */
export function WorkTaskRow({ task, showStatus = true }: { task: WorkTask; showStatus?: boolean }) {
  const tone = TASK_TONE[task.status];
  const running = task.status === "in_progress";
  // What this row IS. Falls back through activeForm → deliverable → title so
  // a work store written before deliverables existed still reads correctly.
  const primary = running ? (task.activeForm ?? task.title) : (task.deliverable ?? task.title);
  return (
    <div style={{ display: "flex", alignItems: "center", gap: "var(--space-3)", padding: "9px 0", minWidth: 0 }}>
      <span className={running && !REDUCE ? "cv-breathe" : undefined} aria-hidden
        style={{ width: 7, height: 7, borderRadius: "50%", background: tone.dot, flexShrink: 0 }} />
      <span style={{
        fontSize: "var(--text-base)", flex: 1, minWidth: 0,
        overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
        color: task.status === "todo" ? "var(--text-dim)" : "var(--text)",
      }} title={task.title}>
        {primary}
      </span>
      {task.attempts > 0 && (
        <span className="text-dim" style={{ fontSize: "var(--text-xs)", whiteSpace: "nowrap" }}
          title="attempts used of the ceiling">
          {task.attempts}/{task.maxAttempts}
        </span>
      )}
      {/* The stage word always travels with the row now, because the group
          header says a CATEGORY rather than a status. */}
      <span style={{ color: tone.text, fontSize: "var(--text-xs)", whiteSpace: "nowrap" }}>
        {showStatus ? tone.label : tone.label}
      </span>
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
  // Rev 10: the two list regions flex against each other inside the lens and
  // each measures its OWN share. Self-correcting — no guessed chrome math.
  const [queueRef, queueH] = useMeasuredHeight();
  const [ladderRef, ladderH] = useMeasuredHeight();
  /** The ladder's "Deliverables" label, measured rather than guessed.
   *
   *  `REGION_LABEL_PX` claims 64px. The label is `--text-xs` (11px) with a
   *  `--space-3` bottom margin, so it renders at 29 — the constant
   *  over-reserves by 35px, which is more than a whole group header. At the
   *  1024x700 floor that pushed `ladderH` under the fold threshold
   *  (64 + 5x34 = 234 against ~230 available) and collapsed five departments
   *  into one counted line, when the five closed headers need 170 and fit
   *  with room to spare.
   *
   *  Measured, not re-guessed: a smaller constant would be right today and
   *  wrong the next time the type scale moves. The constant stays as the
   *  pre-measurement fallback, where over-reserving is the safe direction —
   *  it opens fewer groups, never more.
   *
   *  Deliberately NOT applied to the review queue's `reservedPx` below, which
   *  reserves for its own separate label. That one over-reserves too, but it
   *  only costs a review card and the queue is not clipping; changing it
   *  would move behaviour work.spec pins for no reason I can currently
   *  demonstrate. */
  const [ladderLabelRef, ladderLabelH] = useMeasuredHeight();

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

  /** THE LADDER'S FIT, SETTLED BY MEASUREMENT INSTEAD OF BY CONSTANTS.
   *
   *  The budget below predicts how much room the groups will need from
   *  `REGION_LABEL_PX`, `GROUP_HEADER_PX` and `LADDER_ROW_PX`. Every one of
   *  those had drifted from what the browser actually lays out — the region
   *  label renders at 29px against a reserved 64; the panel's own padding and
   *  border were never reserved at all; and `LADDER_ROW_PX` (40) is the
   *  height of a ROW, not of an open group, which costs 63 once the clamp
   *  adds its "+N more". Five departments therefore laid out 654px of content
   *  into a 300px panel and the last headers were cut off: present in the
   *  DOM, unreachable, the silent cap Rev 10 forbids more strongly than it
   *  forbids scrolling.
   *
   *  I tried correcting the constants. Each correction moved the clip rather
   *  than removing it, because a constant cannot know how tall a wrapped
   *  title or a clamp's descend button will be. So the prediction stays as
   *  the opening guess and the BROWSER settles it: render, measure, and if
   *  the content exceeds the box, close one more group and measure again.
   *
   *  ── WHY THIS CANNOT OSCILLATE ────────────────────────────────────────
   *
   *  The comment on the ladder container below warns about exactly this
   *  failure mode: "fold shrinks the content, which grows the allocation,
   *  which unfolds it, forever." That loop exists only when a box is sized by
   *  its content. The panel is `flex: 1 1 0` with `minHeight: 0`, so its
   *  height is the leftover space and NOTHING it contains can change it —
   *  `clientHeight` is fixed while `scrollHeight` only falls as groups close.
   *  The descent is therefore monotonic and bounded by the group count.
   *
   *  It also runs in `useLayoutEffect`, so the whole descent completes before
   *  the browser paints: the operator never sees the intermediate states. */
  const ladderPanelRef = useRef<HTMLDivElement | null>(null);
  const [openCap, setOpenCap] = useState(Number.POSITIVE_INFINITY);
  const [foldToLine, setFoldToLine] = useState(false);
  const taskCount = workQ.data?.tasks?.length ?? 0;

  // A new epoch: the space or the content changed, so last epoch's verdict is
  // stale. Without this a window that GROWS keeps the groups a smaller one
  // closed — the descent is one-way by design, so something must reopen it.
  useLayoutEffect(() => {
    setOpenCap(Number.POSITIVE_INFINITY);
    setFoldToLine(false);
  }, [ladderH, ladderLabelH, taskCount]);

  useLayoutEffect(() => {
    const el = ladderPanelRef.current;
    // Nothing to decide before the container has been measured; the reset
    // above re-runs this the moment it has.
    if (!el || ladderH <= 0) return;
    if (el.scrollHeight <= el.clientHeight + 1) return;
    // Count the group headers themselves, not any nested disclosure a row
    // might own.
    const openNow = el.querySelectorAll(':scope > div > button[aria-expanded="true"]').length;
    // Out of groups to close and still overflowing: the headers alone do not
    // fit, which is what the counted one-line fold exists to say.
    if (openNow > 0) setOpenCap(openNow - 1); else setFoldToLine(true);
  });
  const [reviewBusy, setReviewBusy] = useState<string | null>(null);
  const [changesFor, setChangesFor] = useState<string | null>(null);
  const [note, setNote] = useState("");
  const [flash, setFlash] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  // The descent (spec Rev 7): categories with work that needs attention
  // arrive open; quiet categories fold to a counted line until asked.
  // Groups are CATEGORIES now, not statuses — see the ladder below.
  const [closedGroups, setClosedGroups] = useState<Set<string>>(() => new Set<string>());
  const toggleGroup = (s: string) => setClosedGroups((cur) => {
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
    // Rev 10: the lens is a COLUMN that shares one budget. Clamping rows
    // inside each region isn't enough — the regions stack, and their sum is
    // what overflows. The two list regions flex against each other and each
    // measures its OWN share, so the split is self-correcting instead of
    // depending on guessed chrome constants.
    // No marginTop: `height: 100%` does not account for it, so the margin
    // pushes the column past its own zone — 12px of silent clipping.
    <div style={{ maxWidth: 760, height: "100%", minHeight: 0, display: "flex", flexDirection: "column", gap: "var(--space-4)" }}>
      {/* The cycle trigger — serial by design in P1 so token attribution
          stays honest; the copy says so instead of pretending parallelism. */}
      <div style={{ flexShrink: 0 }}>
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
      <div style={{ flexShrink: 0 }}>
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
      {/* The queue is this lens's actionable core (Rev 7), so it claims a
          floor of one full card and the ladder yields around it. Without the
          minHeight, flex hands the space to the ladder's content-sized basis
          and the queue renders a 67px sliver of a card. */}
      {/* `1 1 0`, never `1 1 auto`: an auto basis makes the allocation depend
          on the content while the content depends on the allocation — cards
          grow the basis, the basis grows the allocation, which fits another
          card. That loop runs forever. The minHeight, not the basis, is what
          guarantees the queue its floor. */}
      <div ref={queueRef} style={{
        // An EMPTY queue is one line and must not hold a share of the lens —
        // it goes fixed-size so the ladder inherits the room. It only claims
        // a flexible share (and its minimum) once it has cards to show.
        flex: pending.length > 0 ? "1 1 0" : "0 0 auto",
        minHeight: pending.length > 0 ? QUEUE_MIN_PX : 0,
        display: "flex", flexDirection: "column", overflow: "hidden",
      }}>
        <div className="text-dim" style={LABEL}>Awaiting review</div>
        {pending.length === 0 && <span className="text-dim" style={{ fontSize: "var(--text-sm)" }}>Nothing awaiting review.</span>}
        {pending.length > 0 && (
          <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-3)" }}>
            {/* The fit law (spec Rev 10): review cards are budgeted. An
                unreviewed deliverable that doesn't fit stays counted, not
                hidden — the queue never lies about its depth. */}
            <ClampedList items={pending} rowPx={openOutput.size > 0 ? 420 : 190} availPx={queueH} reservedPx={REGION_LABEL_PX} min={1}
              moreLabel={(hidden, total) => `${total - hidden} of ${total} awaiting review · approve to see the next`}
              render={(d) => {
              const task = taskById.get(d.taskId);
              return (
                <div key={d.id} style={PANEL}>
                  <div style={{ display: "flex", alignItems: "baseline", gap: 10, flexWrap: "wrap" }}>
                    <span style={{ fontSize: "var(--text-base)", fontWeight: 600 }}>{task?.title ?? d.taskId}</span>
                    <span className="text-dim" style={{ fontSize: "var(--text-xs)" }}>
                      attempt {d.attempt}{task ? ` of ${task.maxAttempts}` : ""}{task ? ` · ${categoryLabel(task.assigneeSlot)}` : ""}
                    </span>
                  </div>
                  <div className="text-dim" style={{ fontSize: "var(--text-xs)", marginTop: 2 }}>
                    {structuralLine(d)} · {ago(d.createdAt)}
                  </div>
                  {/* Verbatim always — the descent only controls how much
                      unrolls: three lines by default, everything on ask.
                      NAMED EXCEPTION 2 of 2 (spec Rev 10): unrolled output
                      scrolls inside its own box. L3 IS the deepest level, so
                      there is nowhere to descend to, and the honesty law
                      requires engine output render verbatim — a clamp here
                      would be the interface editing the machine's words. */}
                  <pre className={openOutput.has(d.id) ? "cv-record" : undefined} style={{
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
                    style={{ ...BARE_CONTROL, cursor: "pointer", marginTop: 4, fontSize: "var(--text-xs)", color: "var(--text-dim)", minHeight: 24 }}>
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
            }} />
          </div>
        )}
      </div>

      {/* The task ladder — grouped by status. Exceptions (running, awaiting
          you, broken) arrive open; the nominal backlog and the delivered
          tail fold to counted lines. Every row is real store state. */}
      {/* `flex: 1 1 0`, NOT `0 1 auto`, and that is load-bearing: an
          auto basis makes the allocation depend on the content, while the
          fold below depends on the allocation — fold shrinks the content,
          which grows the allocation, which unfolds it, forever. A zero basis
          makes the allocation purely the leftover space, so the fold decision
          has no feedback path. The queue's minHeight is what protects it. */}
      <div ref={ladderRef} style={{ flex: "1 1 0", minHeight: 0, display: "flex", flexDirection: "column", overflow: "hidden" }}>
        <div ref={ladderLabelRef} className="text-dim" style={LABEL}>Deliverables</div>
        {w.tasks.length === 0 && <span className="text-dim" style={{ fontSize: "var(--text-sm)" }}>Nothing queued.</span>}
        {w.tasks.length > 0 && (() => {
          // GROUPED BY CATEGORY, not by status. The status ladder answered
          // "what state is everything in"; the review queue above already
          // answers "what needs me", which is this lens's actionable core.
          // What the category grouping answers is what the operator actually
          // asks — what is each part of my organization producing — and it is
          // the grouping that makes agents disappear: the slot decides which
          // bucket a row lands in and is never rendered.
          const byCat = new Map<string, WorkTask[]>();
          for (const t of w.tasks) {
            const c = categoryOf(t.assigneeSlot);
            (byCat.get(c) ?? byCat.set(c, []).get(c)!).push(t);
          }
          const needsAttention = (t: WorkTask) => t.status === "in_review" || t.status === "failed" || t.status === "blocked";
          // Categories with work that needs attention sort first, then the
          // ones with work in flight, then the rest — the same descent the
          // status ladder encoded, now expressed over categories.
          const rank = (ts: WorkTask[]) =>
            ts.some(needsAttention) ? 0 : ts.some((t) => t.status === "in_progress") ? 1 : 2;
          const present = [...byCat.entries()].sort((a, b) => rank(a[1]) - rank(b[1]) || a[0].localeCompare(b[0]));
          // The measured label, falling back to the constant only until the
          // first measurement lands.
          const labelPx = ladderLabelH > 0 ? ladderLabelH : REGION_LABEL_PX;
          const rowsBudget = regionBudget(ladderH, labelPx + present.length * GROUP_HEADER_PX);
          // How many groups can be open AND still show a row each. Categories
          // are more numerous than statuses were (six departments where the
          // status ladder had four), so "open everything" starves the budget
          // and renders headers with no room beneath them — present in the
          // DOM, clipped out of view, which is the silent cap the fit law
          // exists to forbid. Groups past the budget close themselves, and
          // the ranking already put the ones needing attention first.
          // The prediction is the OPENING GUESS; `openCap` is the browser's
          // correction to it. See the note on `ladderPanelRef` above.
          // BEFORE THE MEASUREMENT ARRIVES, OPEN NOTHING.
          //
          // This said `rowsBudget === 0 ? present.length` — with no height
          // yet, open EVERY group. That is the permissive reading of "I do
          // not know how much room I have", and it is backwards: the
          // ResizeObserver reports in a later frame, so the FIRST painted
          // frame had all five groups expanded and overflowing. The shrink
          // loop above corrects it, but it corrects it after that paint, and
          // a frame of clipped headers is still a frame of clipped headers.
          //
          // Closed is the conservative default and costs nothing: the reset
          // effect re-runs the moment the height lands, and the descent from
          // the prediction happens before the next paint.
          const predicted = rowsBudget === 0
            ? 0
            : Math.max(1, Math.floor(rowsBudget / LADDER_ROW_PX));
          const canOpen = Math.min(predicted, openCap);
          const autoOpen = new Set(present.slice(0, canOpen).map(([c]) => c));
          const open = (c: string) => autoOpen.has(c) && !closedGroups.has(c);
          const openCount = present.filter(([c]) => open(c)).length;
          const perGroupPx = rowsBudget === 0 ? 0 : Math.max(1, rowsBudget / Math.max(1, openCount));

          // The density gradient made real: when the window cannot even seat
          // the category headers, the whole ladder folds to ONE counted line.
          // `foldToLine` is the MEASURED verdict — set when every group is
          // already closed and the headers still overflow. The constant-based
          // test beside it stays as the cheap first pass so the common case
          // never renders a doomed layout at all.
          if (foldToLine || (ladderH > 0 && ladderH < labelPx + present.length * GROUP_HEADER_PX)) {
            const needsYou = w.tasks.filter(needsAttention).length;
            return (
              <div style={{ ...PANEL, padding: "var(--space-3) var(--space-4)" }}>
                <span className="text-dim" style={{ fontSize: "var(--text-sm)" }}>
                  {w.tasks.length} deliverable{w.tasks.length === 1 ? "" : "s"} across {present.length} department{present.length === 1 ? "" : "s"}
                  {needsYou > 0 ? ` · ${needsYou} awaiting you` : ""} — open a desk to see them
                </span>
              </div>
            );
          }
          return (
          <div ref={ladderPanelRef} style={{
            ...PANEL, padding: "var(--space-2) var(--space-4)",
            display: "flex", flexDirection: "column",
            // Sized by the box, never by the content — the property the
            // measurement loop above depends on, and the one whose absence
            // let the panel grow straight through its container.
            flex: "1 1 0", minHeight: 0, overflow: "hidden",
          }}>
            {present.map(([cat, group]) => {
              const isOpen = open(cat);
              const attention = group.filter(needsAttention).length;
              const running = group.filter((t) => t.status === "in_progress").length;
              const done = group.filter((t) => t.status === "done").length;
              return (
                <div key={cat}>
                  <button onClick={() => toggleGroup(cat)} aria-expanded={isOpen}
                    style={{ ...BARE_CONTROL, cursor: "pointer", display: "flex", alignItems: "center", gap: 8, minHeight: 34, width: "100%" }}>
                    <span style={{ fontSize: "var(--text-sm)", fontWeight: 600 }}>{displayName(cat)}</span>
                    {/* Counted progress, never a percentage: done/total is
                        real store state. A per-deliverable percentage would
                        be a fabricated metric. */}
                    <span className="text-dim" style={{ fontSize: "var(--text-xs)" }}>· {done}/{group.length} done</span>
                    {running > 0 && (
                      <span style={{ color: "var(--live)", fontSize: "var(--text-xs)" }}>· {running} running</span>
                    )}
                    {attention > 0 && (
                      <span style={{ color: "var(--attend)", fontSize: "var(--text-xs)" }}>· {attention} needs you</span>
                    )}
                    <span className="text-dim" aria-hidden style={{
                      fontSize: "var(--text-xs)", display: "inline-block", marginLeft: "auto",
                      transform: isOpen ? "rotate(90deg)" : "none", transition: "transform 130ms var(--ease)",
                    }}>▸</span>
                  </button>
                  {/* Rev 10: an expanded group shows what fits and counts the
                      rest. min 1 — expanding is an explicit act, and an act
                      that returns nothing is worse than one row too many. */}
                  {isOpen && (
                    <ClampedList items={group} rowPx={LADDER_ROW_PX} availPx={perGroupPx} min={1}
                      moreLabel={(hidden, total) => `+${hidden} more in ${displayName(cat)} (${total} total)`}
                      render={(t) => <WorkTaskRow key={t.id} task={t} showStatus={false} />} />
                  )}
                </div>
              );
            })}
          </div>
          );
        })()}
      </div>
    </div>
  );
}
