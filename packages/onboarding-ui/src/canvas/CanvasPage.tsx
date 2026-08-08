/** The cognitive canvas — conversation is the only permanent interface.
 *
 *  Left: the transcript (permanent, aria-live). Right: the workspace — an
 *  ephemeral arrangement of cells composed per intent, collapsing when the
 *  thought is done. Pins persist to the desk. The morning screen is the
 *  empty state: greeting, pulse, attention, composer — nothing else until
 *  asked. The workspace only ever grows in response to a user act. */

import { Component, useEffect, useRef, useState, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { wavexOsOnboardingApi, ApiError } from "../wavex-os/lib/api";
import { useCompany } from "../wavex-os/lib/CompanyContext";
import { Cell, ProposalCard, fmtLocalTs } from "./cells";
import { Ic } from "./icons";
import { OrgView, capIcon } from "./OrgFlywheel";
import { RuntimeTray } from "./RuntimeTray";
import { CELL_PX, InstrumentHeight, WORKSPACE_CHROME_PX, fitRows, useMeasuredHeight } from "./layout";
import { useCellChoreography } from "./useCellChoreography";
import type { CanvasProposal, CanvasTurn, CellSpec, LayoutSpec, OrgWalkStep, SinceSnapshot } from "./contract";

const REDUCE = typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
const MAX_MESSAGE_LEN = 1500; // mirrors the server's postSchema cap

/* A local boundary: a malformed layout degrades to a message, never a
 * white screen — the app has no global error boundary. */
class CanvasBoundary extends Component<{ children: ReactNode }, { err: string | null }> {
  state = { err: null as string | null };
  static getDerivedStateFromError(e: Error) { return { err: e.message }; }
  render() {
    if (this.state.err) {
      return (
        <div className="card" style={{ margin: "var(--space-6)" }}>
          <strong>The canvas hit a rendering error.</strong>
          <p className="text-dim" style={{ fontSize: "var(--text-sm)" }}>{this.state.err}</p>
          <button onClick={() => this.setState({ err: null })}>Try again</button>
        </div>
      );
    }
    return this.props.children;
  }
}

function Pulse({ companyId }: { companyId: string }) {
  const q = useQuery({
    queryKey: ["ignition", companyId],
    queryFn: () => wavexOsOnboardingApi.getIgnitionStatus(companyId),
    refetchInterval: 60_000,
    retry: false,
  });
  const status = q.data?.status;
  // --live means "the system is doing something" — an ignited fleet is the
  // one ambient state that qualifies. Everything short of that is either
  // attention (amber) or silence (edge).
  const tone = status === "ignited" ? "var(--live)"
    : status === "deferred" || status === "partial" ? "var(--attend)"
    : "var(--edge)";
  return <div aria-hidden style={{ height: 2, background: tone, transition: "background var(--dur-base) var(--ease)" }} />;
}

/** The Claude idiom: human turns sit in a quiet paper bubble on the right;
 *  the assistant speaks in plain text — no card, no chrome. The thread pane
 *  is the deeper surface now, so the bubble is white paper on warm gray. */
function Bubble({ turn, faded }: { turn: CanvasTurn; faded: boolean }) {
  const user = turn.role === "user";
  return (
    <div style={{ display: "flex", justifyContent: user ? "flex-end" : "flex-start", opacity: faded ? 0.62 : 1 }}>
      <div style={{
        maxWidth: user ? "85%" : "100%",
        padding: user ? "8px 14px" : "2px 0",
        borderRadius: user ? "var(--radius-lg)" : 0,
        fontSize: "var(--text-sm)", whiteSpace: "pre-wrap", wordBreak: "break-word",
        background: user ? "var(--panel)" : "transparent",
        border: user ? "1px solid rgba(0,0,0,0.05)" : undefined,
        color: "var(--text)",
      }}>
        {turn.text}
        {turn.warnings && turn.warnings.length > 0 && (
          <div className="text-dim" style={{ fontSize: "var(--text-xs)", marginTop: 4 }}>
            (some parts were dropped: {turn.warnings.join("; ")})
          </div>
        )}
      </div>
    </div>
  );
}

export default function CanvasPage() {
  const { companyId } = useCompany();
  const qc = useQueryClient();
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);
  // The optimistic user turn: visible in the thread the moment it's sent —
  // a T2 compose can take 45s and the operator must see their own question.
  const [inflight, setInflight] = useState<string | null>(null);
  // Per-proposal commit state: with several cards visible, busy/error must
  // paint only the card that owns them.
  const [committingId, setCommittingId] = useState<string | null>(null);
  const [commitErr, setCommitErr] = useState<{ id: string; message: string } | null>(null);
  // fresh = composed just now (stub/t2), not recalled from memory. Fresh
  // thinking is illuminated (violet, decaying); settled knowledge arrives
  // grayscale — the glow is the composedBy field made visible.
  const [activeLayout, setActiveLayout] = useState<{ layout: LayoutSpec; signature?: string; fresh?: boolean; since?: SinceSnapshot } | null>(null);
  const glowSeq = useRef(0);
  // The board: prior workspaces coexist as minimized thinking objects that
  // restore in place, no round-trip — the layouts are already in hand.
  // Thinking has geography: the stack keeps insertion order, deduped by
  // signature, capped at 4. Pins remain the durable layer.
  const [board, setBoard] = useState<Array<{ layout: LayoutSpec; signature?: string }>>([]);
  // Cognition choreography (extracted to useCellChoreography so the build
  // surface shares the grammar): appear / morph / dissolve / FLIP. Rects are
  // captured in focusLayout, BEFORE the swap commits.
  const { cellPhase, dissolving, registerCellRef, captureRects } =
    useCellChoreography(activeLayout?.layout.cells ?? [], activeLayout);
  function focusLayout(next: { layout: LayoutSpec; signature?: string; fresh?: boolean; since?: SinceSnapshot }) {
    captureRects();
    if (next.fresh) glowSeq.current += 1;
    setActiveLayout((cur) => {
      if (cur && cur.signature !== next.signature) {
        setBoard((b) => [{ ...cur, fresh: false }, ...b.filter((x) => x.signature !== cur.signature && x.signature !== next.signature)].slice(0, 4));
      } else {
        setBoard((b) => b.filter((x) => x.signature !== next.signature));
      }
      return next;
    });
  }
  const scrollRef = useRef<HTMLDivElement>(null);
  // The fit law's single measurement (spec Rev 10): one observer on the
  // instrument zone, published through context. Every clamped list in the
  // tree derives its row count from this one number.
  const [instrumentRef, instrumentH] = useMeasuredHeight();
  // The composed grid's budget: cells are ~2 per row at typical widths, and
  // a cell costs roughly CELL_PX of column height. Beyond the fit the count
  // prints — a composed thought is never dropped in silence.
  const allCells = activeLayout?.layout.cells ?? [];
  const cellRows = fitRows(instrumentH, CELL_PX, { min: 2, reservedPx: WORKSPACE_CHROME_PX });
  const visibleCells = allCells.slice(0, cellRows * 2);
  const hiddenCells = allCells.length - visibleCells.length;

  // The Organizational OS law (docs/RECURSIVE_ORG_SPEC.md Rev 5): the org is
  // the workspace pane's RESTING state. No toggle — the pane derives from one
  // fact: an active ephemeral workspace shows itself; otherwise you are home,
  // standing in the organization at orgNodeId. Walking INTO a node scopes the
  // composer to walks; at the company root, asking composes an ephemeral
  // workspace (persistent objects are navigated; ephemeral ones generated).
  const [orgNodeId, setOrgNodeId] = useState("company");
  const [orgScope, setOrgScope] = useState<{ nodeId: string; title: string } | null>(null);
  const [walkView, setWalkView] = useState<{ question: string; steps: OrgWalkStep[]; revealed: number; answer: string | null; busy: boolean } | null>(null);

  function labelFor(nodeId: string): string {
    if (nodeId === "company") return companyId ?? "the company";
    if (nodeId === "constitution") return "The Constitution";
    if (nodeId === "metric:spend") return "Token spend";
    if (nodeId === "metric:budget") return "Token budget";
    if (nodeId === "metric:goal") return "Headline goal";
    return nodeId.replace(/^(dept|agent):/, "");
  }

  function navigateOrg(nodeId: string, opts?: { keepWalk?: boolean }) {
    setOrgNodeId(nodeId);
    // The company root is unscoped — Layer 0 asks compose workspaces.
    setOrgScope(nodeId === "company" ? null : { nodeId, title: labelFor(nodeId) });
    if (!opts?.keepWalk) setWalkView(null);
  }

  // Promotion v1 (spec Rev 5): ephemeral → approved → persistent. "Keep"
  // sends only an ADDRESS (node + signature); the server constructs the
  // claim from the stored layout + snapshot, cited by construction.
  const [keepState, setKeepState] = useState<"idle" | "busy" | "kept" | { error: string }>("idle");
  useEffect(() => { setKeepState("idle"); }, [activeLayout?.signature]);
  async function keep() {
    if (!companyId || !activeLayout?.signature || keepState === "busy") return;
    setKeepState("busy");
    try {
      await wavexOsOnboardingApi.keepToOrgMemory(companyId, {
        nodeId: orgScope?.nodeId ?? "company",
        signature: activeLayout.signature,
      });
      setKeepState("kept");
      void qc.invalidateQueries({ queryKey: ["org-node"] });
      void qc.invalidateQueries({ queryKey: ["org-memory", companyId] });
      window.setTimeout(() => setKeepState((s) => (s === "kept" ? "idle" : s)), 2400);
    } catch (e) {
      setKeepState({ error: e instanceof ApiError ? e.message : (e as Error).message });
    }
  }

  /** The header affordance: return to the organization's root. Any active
   *  workspace steps back to the board — nothing is lost, nothing lingers. */
  function goHome() {
    setActiveLayout((cur) => {
      if (cur) setBoard((b) => [cur, ...b.filter((x) => x.signature !== cur.signature)].slice(0, 4));
      return null;
    });
    setOrgNodeId("company");
    setOrgScope(null);
    setWalkView(null);
  }

  /** A scoped ask: run the delegation walk at a node, then replay its hops
   *  one at a time — the trace is the organization thinking out loud. */
  async function orgAsk(nodeId: string, question: string) {
    const text = question.trim();
    if (!companyId || !text || walkView?.busy) return;
    if (draft.trim() === text) setDraft("");
    setSendError(null);
    setWalkView({ question: text, steps: [], revealed: 0, answer: null, busy: true });
    try {
      const { walkId } = await wavexOsOnboardingApi.askOrgNode(companyId, nodeId, text);
      let w = await wavexOsOnboardingApi.getOrgWalk(companyId, walkId);
      for (let i = 0; i < 20 && !w.done; i++) {
        await new Promise((r) => setTimeout(r, 600));
        w = await wavexOsOnboardingApi.getOrgWalk(companyId, walkId);
      }
      const steps = w.steps;
      const stepMs = REDUCE ? 0 : 420;
      steps.forEach((_, i) => {
        window.setTimeout(() => {
          setWalkView((v) => (v && v.question === text ? { ...v, steps, revealed: i + 1, busy: true } : v));
        }, stepMs * (i + 1));
      });
      window.setTimeout(() => {
        setWalkView((v) => (v && v.question === text ? { ...v, steps, revealed: steps.length, answer: w.answer, busy: false } : v));
        if (w.landedNodeId && w.landedNodeId !== nodeId) {
          setOrgNodeId(w.landedNodeId);
          setOrgScope({ nodeId: w.landedNodeId, title: labelFor(w.landedNodeId) });
        }
        // The walk may have distilled memory / moved gravity — reread.
        void qc.invalidateQueries({ queryKey: ["org-node"] });
        void qc.invalidateQueries({ queryKey: ["org-flywheel", companyId] });
        void qc.invalidateQueries({ queryKey: ["org-investigations", companyId] });
        void qc.invalidateQueries({ queryKey: ["org-memory", companyId] });
      }, stepMs * steps.length + 60);
    } catch (e) {
      setSendError(e instanceof ApiError ? e.message : (e as Error).message);
      setWalkView(null);
    }
  }

  const q = useQuery({
    enabled: !!companyId,
    queryKey: ["canvas", companyId],
    queryFn: () => wavexOsOnboardingApi.getCanvas(companyId!),
    refetchOnWindowFocus: false,
  });

  // Capabilities are prompts, so they live where you type (spec Rev 7):
  // the composer suggests the current node's asks. Same cache entry the
  // org view reads — no extra fetch. c-grav is excluded (Gravity is a
  // rail lens now, not a question a walk could answer).
  const nodeCapsQ = useQuery({
    enabled: !!companyId,
    queryKey: ["org-node", companyId, orgNodeId],
    queryFn: () => wavexOsOnboardingApi.getOrgNode(companyId!, orgNodeId),
  });
  // capSuggestions is derived below, after the work read — c-adopt's
  // visibility depends on whether the runtime is seeded.

  // The Runtime tray (spec Rev 9): the one sanctioned overlay. Its read
  // shares the org-work cache; polling tightens while the tray is open
  // or anything is running so the sheet tells the mid-flight truth.
  const [trayOpen, setTrayOpen] = useState(false);
  const trayQ = useQuery({
    enabled: !!companyId,
    queryKey: ["org-work", companyId],
    queryFn: () => wavexOsOnboardingApi.getWork(companyId!),
    retry: false,
    refetchInterval: trayOpen ? 5_000 : 30_000,
  });
  const trayWork = trayQ.data ?? null;
  // Chips: c-grav is a lens, not a question; c-adopt only exists before the
  // runtime is seeded (an operating company has nothing left to adopt).
  const capSuggestions = (nodeCapsQ.data?.capabilities ?? [])
    .filter((c) => c.id !== "c-grav" && (trayWork === null || c.id !== "c-adopt"))
    .slice(0, 4);
  const anyRunning = (trayWork?.tasks ?? []).some((t) => t.status === "in_progress");
  const trayNeedsYou = trayWork
    ? trayWork.deliverables.filter((d) => d.review === "pending_review").length
      + trayWork.tasks.filter((t) => t.status === "failed").length
    : 0;
  const transcript = q.data?.transcript ?? [];
  const ledger = q.data?.ledger ?? [];
  const [showLedger, setShowLedger] = useState(false);
  const desk = q.data?.desk ?? { pinned: [] };
  const proposals = q.data?.proposals ?? [];
  // ALL pending proposals render, chronological. Showing only the first
  // pending meant a new proposal could hide behind a stale one — and the
  // visible Confirm would apply the wrong mutation.
  const pendingProposals: CanvasProposal[] = proposals.filter((p) => p.status === "pending");

  useEffect(() => {
    // Hydrate the workspace with the newest remembered layout on load.
    if (!activeLayout && transcript.length) {
      const last = [...transcript].reverse().find((t) => t.layout);
      if (last?.layout) focusLayout({ layout: last.layout, signature: last.signature, since: last.since });
    }
  }, [transcript.length]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTo({ top: el.scrollHeight, behavior: REDUCE ? "auto" : "smooth" });
  }, [transcript.length, sending]);

  async function send(message: string, extra?: { restoreSignature?: string }) {
    const text = message.trim();
    if (!companyId || !text || sending) return;
    setSending(true);
    setSendError(null);
    setInflight(text);
    // Clear the input immediately (standard chat feel) — but only when the
    // text actually came from it; a drill click must not eat a typed draft.
    const cameFromInput = draft.trim() === text;
    if (cameFromInput) setDraft("");
    try {
      const r = await wavexOsOnboardingApi.sendCanvasMessage(companyId, text, extra);
      if (r.turn.layout) focusLayout({ layout: r.turn.layout, signature: r.turn.signature, fresh: r.turn.composedBy !== "memory", since: r.turn.since });
      await qc.invalidateQueries({ queryKey: ["canvas", companyId] });
    } catch (e) {
      setSendError(e instanceof ApiError ? e.message : (e as Error).message);
      // Give the failed message back to the input unless they've typed anew.
      if (cameFromInput) setDraft((d) => (d.trim() ? d : message));
    } finally {
      setSending(false);
      setInflight(null);
    }
  }

  async function commit(proposalId: string) {
    if (!companyId || committingId) return;
    setCommittingId(proposalId);
    setCommitErr(null);
    try {
      await wavexOsOnboardingApi.commitCanvasProposal(companyId, proposalId);
    } catch (e) {
      setCommitErr({ id: proposalId, message: e instanceof ApiError ? e.message : (e as Error).message });
    } finally {
      // Refetch on BOTH outcomes: a 410 means the proposal just expired and
      // the card must stop offering Confirm.
      await qc.invalidateQueries({ queryKey: ["canvas", companyId] });
      await qc.invalidateQueries({ queryKey: ["canvas-bind"] });
      await qc.invalidateQueries({ queryKey: ["ignition", companyId] });
      setCommittingId(null);
    }
  }

  async function pin() {
    if (!companyId || !activeLayout?.signature) return;
    try {
      await wavexOsOnboardingApi.pinWorkspace(companyId, activeLayout.signature, activeLayout.layout.title);
      await qc.invalidateQueries({ queryKey: ["canvas", companyId] });
    } catch { /* pin is best-effort chrome */ }
  }

  async function unpin(signature: string) {
    if (!companyId) return;
    try {
      await wavexOsOnboardingApi.unpinWorkspace(companyId, signature);
      await qc.invalidateQueries({ queryKey: ["canvas", companyId] });
    } catch { /* pin is best-effort chrome */ }
  }

  async function restorePin(signature: string) {
    if (!companyId) return;
    // Signature-addressed recall on the conversation path — the title is
    // display text, not an address; classifying it back is lossy.
    const pinned = desk.pinned.find((p) => p.signature === signature);
    if (pinned) await send(`Show ${pinned.title} again`, { restoreSignature: signature });
  }

  if (!companyId) {
    return (
      <div className="canvas-root" style={{ height: "100dvh", display: "grid", placeItems: "center", padding: "var(--space-6)" }}>
        <div className="card" style={{ maxWidth: 460 }}>
          <strong>No company selected.</strong>{" "}
          <span className="text-dim">The canvas needs a company. Pick one from <Link to="/">Mission Control</Link> or <Link to="/onboarding">run onboarding</Link>.</span>
        </div>
      </div>
    );
  }

  // Three page states the thread pane must distinguish honestly: still
  // loading (show nothing), failed to load (say so — a 500 must never wear
  // the morning greeting), and genuinely empty (the morning moment).
  const morning = !q.isLoading && !q.isError && transcript.length === 0;
  // One derived fact drives the workspace pane: no active ephemeral
  // workspace ⇒ you are HOME, standing in the organization.
  const orgHome = activeLayout === null;

  return (
    <CanvasBoundary>
      <InstrumentHeight.Provider value={instrumentH}>
      {/* The fit law (spec Rev 10): the shell is LOCKED to the window. A
          minHeight here lets the column grow past the viewport, which makes
          every descendant's overflow inert and pushes the scroll onto the
          document — the zones stop being fixed and the masthead scrolls away.
          dvh, not vh: vh ignores mobile's collapsing URL bar. */}
      <div className="canvas-root cv-shell" style={{ height: "100dvh", overflow: "hidden", display: "flex", flexDirection: "column" }}>
        <Pulse companyId={companyId} />
        <header className="cv-glass" style={{ display: "flex", alignItems: "baseline", gap: "var(--space-3)", padding: "var(--space-3) var(--space-6)", borderLeft: "none", borderRight: "none", borderTop: "none", borderRadius: 0 }}>
          <span style={{ fontWeight: 700, letterSpacing: "-.01em" }}>WaveX <span style={{ color: "var(--text-dim)", fontWeight: 500 }}>Canvas</span></span>
          <span className="text-dim" style={{ fontSize: "var(--text-xs)" }}>{companyId}</span>
          <button className="secondary" onClick={goHome}
            style={{ marginLeft: "auto", fontSize: "var(--text-xs)", padding: "3px 10px", minHeight: 28 }}>
            Organization
          </button>
          <button className="secondary" onClick={() => setTrayOpen((v) => !v)} aria-label="Runtime"
            style={{ fontSize: "var(--text-xs)", padding: "3px 10px", minHeight: 28, display: "inline-flex", alignItems: "center", gap: 6 }}>
            {anyRunning && (
              <span aria-hidden className={REDUCE ? undefined : "cv-breathe"}
                style={{ width: 7, height: 7, borderRadius: "50%", background: "var(--live)" }} />
            )}
            Runtime
            {trayNeedsYou > 0 && (
              <span style={{ color: "var(--attend)", fontWeight: 600 }}>{trayNeedsYou}</span>
            )}
          </button>
          {ledger.length > 0 && (
            <button className="secondary" onClick={() => setShowLedger((v) => !v)}
              style={{ fontSize: "var(--text-xs)", padding: "3px 10px", minHeight: 28 }}>
              Decisions ({ledger.length})
            </button>
          )}
          <Link to={`/?companyId=${encodeURIComponent(companyId)}`} style={{ fontSize: "var(--text-xs)" }}>Mission Control</Link>
        </header>
        {showLedger && (
          <div className="cv-glass cv-record" style={{ borderLeft: "none", borderRight: "none", borderTop: "none", borderRadius: 0, padding: "var(--space-3) var(--space-6)", maxHeight: "32vh", overflowY: "auto" }}>
            {/* The ledger: commitments, never trimmed. Chronological by design. */}
            {ledger.map((e) => (
              <div key={`${e.proposalId}-${e.ts_iso}`} style={{ display: "flex", gap: "var(--space-3)", alignItems: "baseline", padding: "4px 0", fontSize: "var(--text-sm)", borderLeft: `3px solid ${e.status === "committed" ? "var(--success)" : "var(--danger)"}`, paddingLeft: "var(--space-3)", marginBottom: 4 }}>
                <span style={{ fontSize: "var(--text-xs)", color: "var(--text-dim)", whiteSpace: "nowrap" }}>{fmtLocalTs(e.ts_iso)}</span>
                <span>{e.summary}</span>
                <span style={{ marginLeft: "auto", fontSize: "var(--text-xs)", color: e.status === "committed" ? "var(--success)" : "var(--danger)" }}>{e.status}</span>
              </div>
            ))}
          </div>
        )}

        <div style={{ flex: 1, display: "grid", gridTemplateColumns: "minmax(320px, 35%) 1fr", minHeight: 0 }} className="canvas-split">
          {/* conversation — the permanent pane. It wears the deeper surface
              so the two panes read as different materials, not one sheet. */}
          <section style={{ display: "flex", flexDirection: "column", borderRight: "1px solid var(--border)", minHeight: 0, background: "color-mix(in srgb, var(--panel-2) 55%, var(--void))" }}>
            {/* NAMED EXCEPTION 1 of 2 (spec Rev 10): the transcript scrolls.
                Conversation is append-only and §4 makes it "the substrate and
                the record" — clamping turns behind a descend would hide the
                record itself. The composer below stays pinned. */}
            <div ref={scrollRef} role="log" aria-live="polite" aria-relevant="additions" className="cv-thread"
              style={{ flex: 1, overflowY: "auto", padding: "var(--space-4)", display: "flex", flexDirection: "column", gap: "var(--space-3)" }}>
              {q.isLoading && (
                <span className="text-dim" style={{ margin: "auto", fontSize: "var(--text-sm)" }}>loading…</span>
              )}
              {q.isError && (
                <div className="card" style={{ margin: "auto 0" }}>
                  <strong>Couldn't load the conversation.</strong>
                  <p className="text-dim" style={{ fontSize: "var(--text-sm)", margin: "var(--space-2) 0" }}>
                    {q.error instanceof ApiError ? q.error.message : (q.error as Error).message}
                  </p>
                  <button onClick={() => void q.refetch()}>Try again</button>
                </div>
              )}
              {morning && (
                <div style={{ margin: "auto 0", textAlign: "center", padding: "var(--space-6) var(--space-4)" }}>
                  <div style={{ fontSize: "var(--text-xl)", fontWeight: 650, letterSpacing: "-0.01em" }}>Good to see you.</div>
                  <p className="text-dim" style={{ fontSize: "var(--text-sm)", maxWidth: "38ch", margin: "var(--space-2) auto 0" }}>
                    Ask about spend, the team, goals, or fleet state — or say what to change.
                    The workspace builds itself around the question.
                  </p>
                  {/* The morning moment: only what needs a decision. The
                      trajectory lives under the wheel — one address per fact
                      (spec Rev 7); the greeting carries just the attention. */}
                  <div style={{ textAlign: "left", maxWidth: 420, margin: "var(--space-4) auto 0", display: "flex", flexDirection: "column", gap: "var(--space-3)" }}>
                    <Cell
                      cell={{ id: "morning-attention", type: "attention", thought: "alert", salience: 2, title: "Needs you", source: { api: "ignition", params: {} } }}
                      companyId={companyId}
                      onDrill={(p) => void send(p)}
                    />
                  </div>
                </div>
              )}
              {transcript.map((t, i) => (
                <Bubble key={`${t.ts_iso}-${i}`} turn={t} faded={i < transcript.length - 2 || inflight !== null} />
              ))}
              {inflight && (
                <Bubble turn={{ role: "user", ts_iso: "", text: inflight }} faded={false} />
              )}
              {pendingProposals.map((p) => (
                <ProposalCard key={p.id} proposal={p}
                  busy={committingId === p.id}
                  error={commitErr?.id === p.id ? commitErr.message : null}
                  onConfirm={() => void commit(p.id)} />
              ))}
              {sending && (
                <span className={REDUCE ? undefined : "cv-breathe"}
                  style={{ fontSize: "var(--text-sm)", color: "var(--mind)" }}>
                  ⟲ composing…
                </span>
              )}
            </div>
            {sendError && (
              <div style={{ margin: "0 var(--space-4)", padding: "6px 10px", fontSize: "var(--text-xs)", color: "var(--attend)", border: "1px solid var(--attend)", borderRadius: "var(--radius-sm)" }}>
                ✗ {sendError}
              </div>
            )}
            {orgHome && capSuggestions.length > 0 && (
              <div style={{ margin: "0 var(--space-4) var(--space-2)", display: "flex", gap: 6, flexWrap: "wrap" }}>
                {/* The node's capabilities as composer suggestions — quiet
                    hairline chips; each one is a scoped ask at the node the
                    operator is standing in. */}
                {capSuggestions.map((cap) => (
                  <button key={cap.id}
                    onClick={() => {
                      // c-adopt is a MUTATION path: it goes through the canvas
                      // composer (which mints the adopt-product proposal for
                      // the confirm gate), never through a read-only walk.
                      if (cap.id === "c-adopt") { void send(cap.prompt); return; }
                      if (orgNodeId !== "company") setOrgScope({ nodeId: orgNodeId, title: labelFor(orgNodeId) });
                      void orgAsk(orgNodeId, cap.prompt);
                    }}
                    disabled={!!walkView?.busy}
                    style={{
                      display: "inline-flex", alignItems: "center", gap: 6,
                      background: "transparent", border: "1px solid rgba(0,0,0,0.08)",
                      borderRadius: 9, padding: "4px 12px", minHeight: 28,
                      fontSize: "var(--text-xs)", color: "var(--text-dim)", cursor: "pointer",
                    }}>
                    <Ic name={capIcon(cap)} size={12} color="var(--text-dim)" />
                    {cap.label}
                  </button>
                ))}
              </div>
            )}
            {orgHome && orgScope && (
              <div style={{ margin: "0 var(--space-4)", display: "flex" }}>
                {/* The scope chip: questions go to this node's walk, not the
                    canvas composer. ✕ returns the composer to the canvas
                    without leaving the org view. */}
                <span className="cv-glass cv-glass--fluid" style={{ display: "inline-flex", alignItems: "center", gap: 8, borderRadius: 999, padding: "3px 6px 3px 12px", fontSize: "var(--text-xs)", color: "var(--mind)" }}>
                  asking: {orgScope.title}
                  <button onClick={() => setOrgScope(null)} aria-label={`Stop asking ${orgScope.title}`}
                    style={{ all: "unset", cursor: "pointer", padding: "2px 6px", color: "var(--text-dim)", minHeight: 0 }}>✕</button>
                </span>
              </div>
            )}
            <form
              onSubmit={(e) => { e.preventDefault(); void (orgHome && orgScope ? orgAsk(orgScope.nodeId, draft) : send(draft)); }}
              style={{ display: "flex", gap: "var(--space-2)", padding: "var(--space-3) var(--space-4)", borderTop: "1px solid var(--border)" }}>
              <input
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                maxLength={MAX_MESSAGE_LEN}
                placeholder={orgHome && orgScope ? `Ask ${orgScope.title}…` : morning ? "Try: why did spend spike?" : "Ask, or say what to change…"}
                aria-label={orgHome && orgScope ? `Ask ${orgScope.title}` : "Message the canvas"}
                style={{ flex: 1 }}
              />
              <button type="submit" className="secondary" disabled={sending || !!walkView?.busy || !draft.trim()} aria-label="Send"
                style={{ minWidth: 44, minHeight: 44, background: "var(--panel)" }}>↑</button>
            </form>
          </section>

          {/* workspace — the org at rest, ephemeral compositions on top.
              The fit law's zone contract: this section never scrolls. The
              INSTRUMENT flexes and is the measured budget every clamped list
              derives from; the SHELF is pinned below it and never yields. */}
          <section
            style={{ display: "flex", flexDirection: "column", padding: "var(--space-4) var(--space-6)", minHeight: 0, overflow: "hidden" }}>
            <div ref={instrumentRef} className="cv-instrument" style={{ flex: 1, minHeight: 0, overflow: "hidden" }}>
            {activeLayout ? (
              <div style={{ position: "relative" }}>
                {/* Fresh thinking is illuminated: a violet atmosphere that
                    decays to grayscale as the thought settles. Memory recalls
                    never glow — settled knowledge arrives quiet. */}
                {activeLayout.fresh && !REDUCE && (
                  <div key={`glow-${glowSeq.current}`} aria-hidden className="cv-glow" />
                )}
                <div style={{ display: "flex", alignItems: "baseline", gap: "var(--space-3)", marginBottom: "var(--space-3)" }}>
                  <h2 style={{ margin: 0, fontSize: "var(--text-2xl)", fontWeight: 650, letterSpacing: "-0.02em", lineHeight: 1.15 }}>{activeLayout.layout.title}</h2>
                  {activeLayout.signature && (
                    <button className="secondary" onClick={() => void pin()}
                      style={{ fontSize: "var(--text-xs)", padding: "3px 12px", minHeight: 28, display: "inline-flex", alignItems: "center", gap: 6 }}>
                      <Ic name="pin" size={12} color="var(--text-dim)" />
                      Pin
                    </button>
                  )}
                  {activeLayout.signature && (
                    <button className="secondary" onClick={() => void keep()}
                      disabled={keepState === "busy"}
                      aria-label="Keep this workspace as organizational memory"
                      style={{
                        fontSize: "var(--text-xs)", padding: "3px 12px", minHeight: 28,
                        display: "inline-flex", alignItems: "center", gap: 6,
                        color: keepState === "kept" ? "var(--mind)" : undefined,
                        borderColor: keepState === "kept" ? "color-mix(in srgb, var(--mind) 40%, rgba(0,0,0,0.12))" : undefined,
                      }}>
                      <span aria-hidden style={{ width: 7, height: 7, borderRadius: "50%", background: "var(--mind)" }} />
                      {keepState === "kept" ? "Kept ✓" : keepState === "busy" ? "Keeping…" : "Keep"}
                    </button>
                  )}
                  <button className="secondary" onClick={() => {
                      if (activeLayout) setBoard((b) => [activeLayout, ...b.filter((x) => x.signature !== activeLayout.signature)].slice(0, 4));
                      setActiveLayout(null);
                    }}
                    style={{ fontSize: "var(--text-xs)", padding: "3px 10px", minHeight: 28, marginLeft: "auto" }}
                    aria-label="Minimize workspace to the board">Minimize</button>
                </div>
                {typeof keepState === "object" && (
                  <div style={{ margin: "0 0 var(--space-2)", fontSize: "var(--text-xs)", color: "var(--attend)" }}>
                    ✗ couldn't keep: {keepState.error}
                  </div>
                )}
                {/* Rev 10: the composed grid is budgeted too. Cells beyond
                    what fits are counted, not silently cut — Minimize sends
                    the whole workspace to the shelf if you need the room. */}
                <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))", gap: "var(--space-3)" }}>
                  {visibleCells.map((cell, i) => (
                    <div key={cell.id}
                      ref={registerCellRef(cell.id)}
                      style={{
                      gridColumn: cell.span === 2 ? "1 / -1" : undefined,
                      animation: cellPhase[cell.id] === "appear"
                        ? `cv-appear var(--dur-base) var(--ease) ${i * 40}ms both`
                        : cellPhase[cell.id] === "morph"
                          ? "cv-morph 520ms var(--ease)" : undefined,
                    }}>
                      <Cell cell={{ ...cell, span: undefined }} companyId={companyId} since={activeLayout.since} onDrill={(prompt) => void send(prompt)} />
                    </div>
                  ))}
                  {dissolving.map((cell) => (
                    <div key={`x-${cell.id}`} aria-hidden style={{
                      gridColumn: cell.span === 2 ? "1 / -1" : undefined,
                      animation: "cv-dissolve 260ms var(--ease) both", pointerEvents: "none",
                    }}>
                      <Cell cell={{ ...cell, span: undefined }} companyId={companyId} onDrill={() => {}} />
                    </div>
                  ))}
                </div>
                {hiddenCells > 0 && (
                  <div className="text-dim" style={{ fontSize: "var(--text-xs)", marginTop: "var(--space-2)" }}>
                    +{hiddenCells} more thought{hiddenCells === 1 ? "" : "s"} in this workspace — ask to focus one
                  </div>
                )}
              </div>
            ) : (
              // HOME: the organization is the resting state — persistent
              // objects are navigated; ephemeral ones are generated on ask.
              <OrgView
                companyId={companyId}
                nodeId={orgNodeId}
                onNavigate={(id) => navigateOrg(id)}
                onAsk={(prompt, atNodeId) => {
                  // A chip always asks the node it belongs to; a Learned row
                  // asks at ITS node — navigate + scope so chip, view, and
                  // walk agree.
                  const target = atNodeId ?? orgNodeId;
                  if (target !== orgNodeId) navigateOrg(target, { keepWalk: true });
                  else setOrgScope(target === "company" ? null : { nodeId: target, title: labelFor(target) });
                  void orgAsk(target, prompt);
                }}
                walk={walkView}
              />
            )}
            </div>

            {/* The shelf (spec Rev 7): ephemeral things at rest sit LOW —
                resting workspaces and pins never outrank the organization's
                identity. One tap back, exactly as before. Rev 10: it is a
                PINNED zone — it never scrolls and never yields its space. */}
            {(board.length > 0 || desk.pinned.length > 0) && (
              <div style={{ flexShrink: 0, marginTop: "var(--space-4)", paddingTop: "var(--space-4)", borderTop: "1px solid rgba(0,0,0,0.06)", display: "flex", flexDirection: "column", gap: "var(--space-4)" }}>
                {board.length > 0 && (
                  <div>
                    {/* The board: minimized thinking objects — receding, one
                        tap from returning; fluid material because resting. */}
                    <div className="text-dim" style={{ fontSize: "var(--text-xs)", textTransform: "uppercase", letterSpacing: ".1em", marginBottom: "var(--space-2)" }}>On the board</div>
                    <div style={{ display: "flex", gap: "var(--space-2)", flexWrap: "wrap" }}>
                      {board.map((w) => (
                        <button key={w.signature ?? w.layout.title} className="cv-glass cv-glass--fluid cv-lift" onClick={() => focusLayout(w)}
                          style={{
                            borderRadius: "var(--radius-lg)", padding: "var(--space-2) var(--space-4) var(--space-2) var(--space-3)",
                            cursor: "pointer", textAlign: "left", color: "var(--text)", minHeight: 48,
                            display: "inline-flex", alignItems: "center", gap: 10,
                          }}>
                          <Ic name="layers" size={16} color="var(--text-dim)" />
                          <span>
                            <span style={{ display: "block", fontSize: "var(--text-sm)", fontWeight: 600 }}>{w.layout.title}</span>
                            <span className="text-dim" style={{ display: "block", fontSize: "var(--text-xs)", fontWeight: 400 }}>
                              {w.layout.cells.length} thought{w.layout.cells.length === 1 ? "" : "s"} · tap to restore
                            </span>
                          </span>
                        </button>
                      ))}
                    </div>
                  </div>
                )}
                {desk.pinned.length > 0 && (
                  <div>
                    {/* The desk: durable, operator-chosen. Pin glyph in ink —
                        pins are yours, not the mind's. */}
                    <div className="text-dim" style={{ fontSize: "var(--text-xs)", textTransform: "uppercase", letterSpacing: ".1em", marginBottom: "var(--space-2)" }}>Pinned</div>
                    <div style={{ display: "flex", gap: "var(--space-2)", flexWrap: "wrap" }}>
                      {desk.pinned.map((p) => (
                        <span key={p.signature} className="cv-lift" style={{
                          display: "inline-flex", alignItems: "center",
                          background: "var(--panel)", border: "1px solid rgba(0,0,0,0.08)",
                        }}>
                          <button onClick={() => void restorePin(p.signature)}
                            style={{ all: "unset", cursor: "pointer", display: "inline-flex", alignItems: "center", gap: 7, padding: "6px 4px 6px 12px", fontSize: "var(--text-xs)", fontWeight: 600, color: "var(--text)", minHeight: 0 }}>
                            <Ic name="pin" size={13} color="var(--text-dim)" />
                            {p.title}
                          </button>
                          <button onClick={() => void unpin(p.signature)}
                            aria-label={`Unpin ${p.title}`}
                            style={{ all: "unset", cursor: "pointer", padding: "6px 10px 6px 6px", color: "var(--text-dim)", fontSize: "var(--text-xs)", minHeight: 0 }}>
                            ×
                          </button>
                        </span>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}
          </section>
        </div>

        {/* Inside .canvas-root: the tray's paper (.cv-pop) and every token
           var cascade from there — fixed positioning doesn't need the body. */}
        <RuntimeTray open={trayOpen} onClose={() => setTrayOpen(false)} work={trayWork} walk={walkView} />
      </div>
      </InstrumentHeight.Provider>

      <style>{`
        /* Nothing bounces, nothing scales: arrival and departure GLIDE.
           Emphasis is a breath of opacity, never a flash. */
        @keyframes cv-appear { from { opacity: 0; transform: translateY(6px); } to { opacity: 1; transform: none; } }
        @keyframes cv-dissolve { to { opacity: 0; transform: translateY(4px); } }
        @keyframes cv-morph { 0% { opacity: .55; } 100% { opacity: 1; } }
        .cv-glow {
          position: absolute; inset: -14px; border-radius: var(--radius-lg);
          pointer-events: none;
          animation: cv-illuminate 45s var(--ease) forwards;
        }
        /* Fresh thinking still leaves a fingerprint — one whispered wash of
           mind that fades as the thought settles. */
        @keyframes cv-illuminate {
          from { box-shadow: 0 0 90px -30px color-mix(in srgb, var(--mind) 22%, transparent); }
          to   { box-shadow: 0 0 90px -30px transparent; }
        }
        .cv-breathe { animation: cv-breathe 2.4s ease-in-out infinite; }
        @keyframes cv-breathe { 0%, 100% { opacity: .5; } 50% { opacity: 1; } }
        @media (max-width: 900px) {
          .canvas-split { grid-template-columns: 1fr !important; }
          .canvas-split > section:first-child { border-right: none !important; border-bottom: 1px solid var(--border); max-height: 46vh; }
        }
      `}</style>
    </CanvasBoundary>
  );
}
