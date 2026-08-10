/** The act-one wait, rendered as WORK — not as a spinner.
 *
 *  What the client actually knows during pillar 1 is small and worth being
 *  strict about: the call is in flight, the passes it makes happen in a
 *  fixed order, and how many seconds have elapsed since we sent it. That's
 *  the whole set. So this trace prints exactly those three things.
 *
 *  What it deliberately does NOT print, because the system does not have
 *  the number: a percentage, a filling bar, a remaining time, an ETA, or a
 *  green check claiming a pass "succeeded". A pass that has scrolled past
 *  is labelled `passed`, which is a statement about the order — not about
 *  a result we never observed.
 *
 *  Every state ships a word next to its colour, so removing colour removes
 *  nothing. */

import { useEffect, useState } from "react";
import { COPY } from "../copy";

/** Steps advance on measured elapsed time, evenly, and the last one holds
 *  until the response lands. This cadence is a presentation choice about
 *  pacing — never a claim about the model's internal progress, which is
 *  why no step is ever marked complete or successful.
 *
 *  WHY 1500 AND NOT 4000. The wait is not one length: the fixture answers in
 *  ~6s and the real API was measured at ~20s. At 4000ms the four passes take
 *  16s to walk, so against the fixture — which is where design work actually
 *  happens — the operator only ever saw the first two, and the last two never
 *  reached "now". Tuned for production, dead in the environment it runs in.
 *
 *  1500ms shows all four inside the fixture's 6s, and on the real 20s call
 *  the final pass simply holds. Holding is the honest state, not a fallback:
 *  the client never learns which pass the model is on, so once the narration
 *  has said what the read does, continuing to advance would be inventing
 *  progress. The elapsed counter keeps ticking, and it is measured. */
const STEP_MS = 1500;

const REDUCE =
  typeof window !== "undefined" &&
  window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;

export function WaitTrace({ active, source = "text" }: {
  active: boolean;
  /** What the operator gave us. Decides the FIRST pass only — a pasted
   *  address is fetched and a typed sentence is not, and this trace marks
   *  each pass `passed` as it scrolls by, so naming a fetch that never
   *  happened is the one lie this component is built to avoid.
   *
   *  Defaults to "text" because that is the claim-less option. */
  source?: "url" | "text";
}) {
  const [ms, setMs] = useState(0);

  useEffect(() => {
    if (!active) return;
    const started = Date.now();
    setMs(0);
    const t = window.setInterval(() => setMs(Date.now() - started), 250);
    return () => window.clearInterval(t);
  }, [active]);

  const steps = COPY.phase1.wait.steps[source] ?? COPY.phase1.wait.steps.text!;
  const current = Math.min(steps.length - 1, Math.floor(ms / STEP_MS));
  const seconds = Math.floor(ms / 1000);

  return (
    <section
      className="paper"
      aria-label={COPY.phase1.wait.eyebrow}
      style={{
        borderRadius: 12,
        padding: "var(--space-3)",
        display: "flex",
        flexDirection: "column",
        gap: 10,
      }}
    >
      <div style={{ display: "flex", alignItems: "baseline", gap: 8 }}>
        <span
          style={{
            fontSize: "var(--text-xs)",
            textTransform: "uppercase",
            letterSpacing: ".1em",
            color: "var(--ink-dim)",
          }}
        >
          {COPY.phase1.wait.eyebrow}
        </span>
        <span
          className="text-dim"
          style={{ fontSize: "var(--text-xs)", marginLeft: "auto", fontVariantNumeric: "tabular-nums" }}
        >
          {COPY.phase1.wait.elapsed(seconds)}
        </span>
      </div>

      <ol
        role="status"
        aria-live="polite"
        style={{ display: "flex", flexDirection: "column", gap: 7, margin: 0, padding: 0, listStyle: "none" }}
      >
        {steps.map((label, i) => {
          const state = i < current ? "past" : i === current ? "now" : "ahead";
          const live = state === "now";
          return (
            <li
              key={label}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 8,
                opacity: state === "ahead" ? 0.42 : 1,
                transition: REDUCE ? undefined : "opacity 320ms var(--ease)",
              }}
            >
              <span
                aria-hidden
                className={live && !REDUCE ? "wavex-pulse-dot" : undefined}
                style={{
                  width: 7,
                  height: 7,
                  borderRadius: "50%",
                  flexShrink: 0,
                  background: live ? "var(--mind)" : "transparent",
                  border: live ? undefined : "1px solid color-mix(in srgb, var(--ink) 22%, transparent)",
                }}
              />
              <span
                style={{
                  fontSize: "var(--text-sm)",
                  color: live ? "var(--ink)" : "var(--ink-dim)",
                }}
              >
                {label}
              </span>
              <span
                className="text-dim"
                style={{
                  fontSize: "var(--text-xs)",
                  marginLeft: "auto",
                  textTransform: "lowercase",
                }}
              >
                {COPY.phase1.wait.state[state]}
              </span>
            </li>
          );
        })}
      </ol>

      <p className="text-dim" style={{ fontSize: "var(--text-xs)", margin: 0, lineHeight: 1.45 }}>
        {COPY.phase1.wait.note}
      </p>
    </section>
  );
}
