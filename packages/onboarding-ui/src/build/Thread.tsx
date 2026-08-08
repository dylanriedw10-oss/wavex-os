/** The conversation pane — the permanent left side of Build Your
 *  Organization, in the canvas Bubble idiom: human turns in a quiet paper
 *  bubble on the right, the product in plain text. Slots mount the
 *  surviving inline cards (pillars, strategy, adopt) inside assistant
 *  turns. */

import { useEffect, useRef, type ReactNode } from "react";
import { Pillar1ConfirmCard } from "../wavex-os/components/inline-cards/Pillar1ConfirmCard";
import { Pillar1HaltCard } from "../wavex-os/components/inline-cards/Pillar1HaltCard";
import { StrategyCard, type StrategyAsk } from "./cards/StrategyCard";
import type { StrategyDraftPatch } from "./state/build-reducer";
import { Pillar3PromptCard } from "../wavex-os/components/inline-cards/Pillar3PromptCard";
import { Pillar4PromptCard } from "../wavex-os/components/inline-cards/Pillar4PromptCard";
import { Pillar5PromptCard } from "../wavex-os/components/inline-cards/Pillar5PromptCard";
import { T2ProgressIndicator } from "../wavex-os/components/T2ProgressIndicator";
import type {
  Pillar1Response, Pillar4Response, Pillar5Response,
} from "@wavex-os/plugin-onboarding";
import type { BuildSlot, ChatMessage } from "./state/build-reducer";

const REDUCE = typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;

/** The slim callback bag the surviving cards need — a deliberate contrast
 *  with the legacy shell's 20-field slotContext. */
export interface ThreadCallbacks {
  companyId: string | null;
  orgName: string;
  rawInput: string;
  onPillar1Confirmed: () => void;
  /** The halt card runs its own recovery call and hands back the response. */
  onPillar1Recovered: (response: Pillar1Response) => void;
  /** Strategy's three outcomes: a beat advanced, a goal stated, a decline.
   *  The decline is separate on purpose — it must not reach the server as a
   *  goal of zero. */
  onStrategyAsk: (asking: StrategyAsk, draft?: StrategyDraftPatch) => void;
  onStrategyDone: (summary: { kpiId: string; label: string; current: number; target: number; days: number }) => void;
  onStrategySkip: () => void;
  /** Pillar 3 hands back the CHOICE, not a saved response — the write waits
   *  for Strategy's number, which the bracket derives from. */
  onPillar3Done: (productState: string, custom: boolean) => void;
  onPillar4Done: (response: Pillar4Response) => void;
  onPillar5Done: (response: Pillar5Response) => void;
  onAdoptUrl: (url: string) => void;
}

function Slot({ slot, cb }: { slot: BuildSlot; cb: ThreadCallbacks }): ReactNode {
  switch (slot.kind) {
    case "thinking":
      return (
        <div style={{ marginTop: "var(--space-2)" }}>
          <T2ProgressIndicator active phase={slot.phase === "pillar-1" ? "pillar-1" : slot.phase} />
        </div>
      );
    case "pillar1-confirm":
      if (!cb.companyId) return null;
      return <Pillar1ConfirmCard companyId={cb.companyId} response={slot.response} onConfirmed={cb.onPillar1Confirmed} />;
    case "pillar1-halt":
      if (!cb.companyId) return null;
      return <Pillar1HaltCard companyId={cb.companyId} orgName={cb.orgName} rawInput={cb.rawInput} onRecovered={cb.onPillar1Recovered} />;
    case "strategy-prompt":
      if (!cb.companyId) return null;
      return (
        <StrategyCard
          companyId={cb.companyId} hypothesis={slot.hypothesis}
          onAsk={cb.onStrategyAsk} onDone={cb.onStrategyDone} onSkip={cb.onStrategySkip}
        />
      );
    case "pillar3-prompt":
      if (!cb.companyId) return null;
      return <Pillar3PromptCard companyId={cb.companyId} onDone={cb.onPillar3Done} />;
    case "pillar4-prompt":
      if (!cb.companyId) return null;
      return <Pillar4PromptCard companyId={cb.companyId} onDone={cb.onPillar4Done} />;
    case "pillar5-prompt":
      if (!cb.companyId) return null;
      return <Pillar5PromptCard companyId={cb.companyId} onDone={cb.onPillar5Done} />;
    case "adopt-url":
      return <AdoptUrlRow onSubmit={cb.onAdoptUrl} />;
    case "verify-fail":
      return (
        <div style={{ marginTop: "var(--space-2)", padding: "0.6rem 0.75rem", background: "var(--surface)", border: "1px solid var(--warning)", borderRadius: 10, fontSize: "var(--text-xs)" }}>
          <div style={{ color: "var(--warning)", fontWeight: 600, marginBottom: "0.25rem" }}>Fix hint</div>
          <div style={{ whiteSpace: "pre-wrap" }}>{slot.fixHint}</div>
        </div>
      );
    case "transition-pill":
      return (
        <span className="cv-glass cv-glass--fluid" style={{ display: "inline-flex", borderRadius: 999, padding: "3px 12px", fontSize: "var(--text-xs)", color: "var(--text-dim)" }}>
          {slot.label}
        </span>
      );
    default:
      return null;
  }
}

/** A one-line URL form inside the thread — Path B's paste moment. */
function AdoptUrlRow({ onSubmit }: { onSubmit: (url: string) => void }) {
  const ref = useRef<HTMLInputElement>(null);
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        const v = ref.current?.value.trim();
        if (v) onSubmit(v);
      }}
      style={{ display: "flex", gap: "var(--space-2)", marginTop: "var(--space-2)", maxWidth: 420 }}>
      <input ref={ref} placeholder="https://your-product.com" aria-label="Product URL" style={{ flex: 1 }} />
      <button type="submit" style={{ minHeight: 36 }}>Read it</button>
    </form>
  );
}

function Bubble({ m, cb, faded }: { m: ChatMessage; cb: ThreadCallbacks; faded: boolean }) {
  const user = m.role === "user";
  if (m.collapsed) {
    return (
      <div className="text-dim" style={{ fontSize: "var(--text-xs)", opacity: 0.7 }}>
        {m.text ? `· ${m.text.slice(0, 64)}${m.text.length > 64 ? "…" : ""}` : "·"}
      </div>
    );
  }
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
        {m.text}
        {m.slot && <Slot slot={m.slot} cb={cb} />}
      </div>
    </div>
  );
}

export function Thread({ thread, cb, children }: {
  thread: ChatMessage[];
  cb: ThreadCallbacks;
  /** The composer, pinned under the scroll region by the caller. */
  children?: ReactNode;
}) {
  const scrollRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTo({ top: el.scrollHeight, behavior: REDUCE ? "auto" : "smooth" });
  }, [thread.length]);

  return (
    <section style={{ display: "flex", flexDirection: "column", borderRight: "1px solid var(--border)", minHeight: 0, background: "color-mix(in srgb, var(--panel-2) 55%, var(--void))" }}>
      {/* NAMED EXCEPTION (fit law): the transcript scrolls — conversation is
          append-only and IS the record. The composer stays pinned. */}
      <div ref={scrollRef} role="log" aria-live="polite" aria-relevant="additions" className="cv-thread"
        style={{ flex: 1, overflowY: "auto", padding: "var(--space-4)", display: "flex", flexDirection: "column", gap: "var(--space-3)" }}>
        {thread.map((m, i) => (
          <Bubble key={m.id} m={m} cb={cb} faded={i < thread.length - 2} />
        ))}
      </div>
      {children}
    </section>
  );
}
