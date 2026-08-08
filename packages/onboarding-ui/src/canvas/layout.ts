/** The fit law (docs/RECURSIVE_ORG_SPEC.md Rev 10) — density is bounded by
 *  the WINDOW, not by the content.
 *
 *  Before Rev 10 every list approximated "what fits" with a hardcoded
 *  `slice(0, N)`: correct at exactly one window size and wrong at every
 *  other. This module replaces those constants with the measured budget of
 *  the instrument zone, so a list renders what actually fits, states its
 *  TRUE total, and sends the remainder one level deeper.
 *
 *  Measurement discipline: ONE ResizeObserver on the instrument zone,
 *  published through context. A per-list observer would thrash — every
 *  clamp changes height, which re-triggers every other observer.
 *
 *  `fitRows` is deliberately PURE so the budget arithmetic is unit-testable
 *  without a DOM. */

import { createContext, useCallback, useContext, useEffect, useState } from "react";

/** The supported floor. Below this the canvas stops shrinking and sheds a
 *  stratum instead — shrinking further would make labels illegible, which
 *  is a worse failure than folding a row. */
export const MIN_CANVAS_H = 700;

/** Instrument height in px. 0 means "not measured yet" — consumers fall
 *  back to their conservative floor rather than rendering an empty list on
 *  the first paint. */
export const InstrumentHeight = createContext(0);

export function useInstrumentHeight(): number {
  return useContext(InstrumentHeight);
}

/** Track an element's content-box height.
 *
 *  Returns a CALLBACK ref, not a ref object, and this is load-bearing: the
 *  zones it measures mount late (OrgView early-returns while its node query
 *  loads; the Runtime tray returns null until opened). A `useEffect` keyed on
 *  a stable ref object runs once, before those elements exist, and then never
 *  again — the height stays 0 forever and every budget silently falls back.
 *  Keying on the NODE means observation starts whenever the node attaches.
 *
 *  Usage: `const [ref, h] = useMeasuredHeight(); … <div ref={ref}>` */
export function useMeasuredHeight(): [(el: HTMLElement | null) => void, number] {
  const [el, setEl] = useState<HTMLElement | null>(null);
  const [h, setH] = useState(0);
  const ref = useCallback((node: HTMLElement | null) => setEl(node), []);
  useEffect(() => {
    if (!el) return;
    // ResizeObserver fires on the element's own box changes — including the
    // ones OUR clamping causes. Only commit real changes so a 1px reflow
    // can't drive a render loop.
    const ro = new ResizeObserver(([entry]) => {
      const next = entry?.contentRect.height ?? 0;
      setH((cur) => (Math.abs(cur - next) > 1 ? next : cur));
    });
    ro.observe(el);
    setH(el.getBoundingClientRect().height);
    return () => ro.disconnect();
  }, [el]);
  return [ref, h];
}

/** Track an element's content-box WIDTH. Same callback-ref discipline as
 *  `useMeasuredHeight` and for the same reason.
 *
 *  Used where a layout must respond to the box it was actually given rather
 *  than to the viewport: the Review card flows its sections in two columns
 *  when its own width allows it, which a `@media` query can't know because
 *  the card sits inside a percentage-split pane. */
export function useMeasuredWidth(): [(el: HTMLElement | null) => void, number] {
  const [el, setEl] = useState<HTMLElement | null>(null);
  const [w, setW] = useState(0);
  const ref = useCallback((node: HTMLElement | null) => setEl(node), []);
  useEffect(() => {
    if (!el) return;
    const ro = new ResizeObserver(([entry]) => {
      const next = entry?.contentRect.width ?? 0;
      setW((cur) => (Math.abs(cur - next) > 1 ? next : cur));
    });
    ro.observe(el);
    setW(el.getBoundingClientRect().width);
    return () => ro.disconnect();
  }, [el]);
  return [ref, w];
}

export interface FitOpts {
  /** Never render fewer than this, even when the budget says zero — a list
   *  that renders nothing is less honest than one that slightly overflows. */
  min?: number;
  /** Never render more than this, even in a tall window (Rev 7's density
   *  budget still applies — space is permission, not obligation). */
  max?: number;
  /** Chrome inside the region that isn't rows: a label, the "+N more" line. */
  reservedPx?: number;
}

/** How many rows of `rowPx` fit in `availPx`. Pure — no DOM, no React. */
export function fitRows(availPx: number, rowPx: number, opts: FitOpts = {}): number {
  const { min = 1, max = Infinity, reservedPx = 0 } = opts;
  if (rowPx <= 0) return min;
  // availPx === 0 means UNMEASURED and falls back to the floor's budget so a
  // fresh mount doesn't flash a one-row list. Callers must therefore never
  // pass a clamped-to-zero value for a region that is merely small — clamp to
  // 1, not 0, or "no room at all" reads as "measure me later" and the region
  // silently gets a 350px budget it does not have.
  const budget = (availPx > 0 ? availPx : MIN_CANVAS_H * 0.5) - reservedPx;
  const n = Math.floor(budget / rowPx);
  return Math.max(min, Math.min(max, n));
}

/** Turn a measured region height into a row budget, preserving the one
 *  distinction that matters:
 *
 *    unmeasured (0) → 0, so `fitRows` uses its first-paint fallback and the
 *                     region doesn't flash empty before the observer fires
 *    measured tiny  → 1, so the region honestly gets no rows instead of
 *                     accidentally buying that same fallback
 *
 *  Collapsing those two cases in either direction is a bug: clamping to 0
 *  makes a cramped region render a full list it can't hold; clamping to 1
 *  makes every region render empty on its first paint. */
export function regionBudget(measuredPx: number, chromePx = 0): number {
  if (measuredPx <= 0) return 0;
  return Math.max(1, measuredPx - chromePx);
}

/** The wheel's scale factor. The face's internal geometry stays at 520 (see
 *  OrgFlywheel) and only the rendered box scales, so SVG and the absolutely
 *  positioned HTML petal labels scale together with no drift.
 *
 *  The 0.72 floor is a LEGIBILITY constraint, not a round number: petal
 *  labels are 14px, and 14 × 0.72 ≈ 10px is the smallest honest size. */
export const WHEEL_BASE = 520;
export const WHEEL_MIN_SCALE = 0.72;

/** One composed cell's column cost, and the workspace title row above the
 *  grid (spec Rev 10). Shared by CanvasPage and the build surface so both
 *  budget the same grid the same way. */
export const CELL_PX = 200;
export const WORKSPACE_CHROME_PX = 64;

export function wheelScale(availPx: number): number {
  // Unmeasured starts SMALL, never large. Defaulting to 1 paints a 520px
  // face into an unknown box, which overflows and clips the hub row for a
  // frame; growing into the space is the safe direction to be wrong in.
  if (availPx <= 0) return WHEEL_MIN_SCALE;
  return Math.max(WHEEL_MIN_SCALE, Math.min(1, availPx / WHEEL_BASE));
}
