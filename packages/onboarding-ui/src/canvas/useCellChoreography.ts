/** Cognition choreography — animation communicates thinking, not interface.
 *
 *  Extracted from CanvasPage so the Build Your Organization surface can run
 *  the SAME grammar over its plan-assembly grid: diff the previous cell set
 *  against the next — added cells APPEAR (discovered, staggered), changed
 *  cells MORPH (evidence shifted), removed cells DISSOLVE (rejected), and a
 *  surviving id FLIPs from its old rect to its new one (the object visibly
 *  travels, never reappears). Behavior-identical to the inline original.
 *
 *  Contract:
 *    - `cells` is the CURRENT arrangement (usually a fresh array per render).
 *    - `key` is the identity that means "a new arrangement arrived" — the
 *      diff effect runs when IT changes, not when the array reference does.
 *      CanvasPage passes its activeLayout object; a paced feed passes its
 *      revealed count.
 *    - Call `captureRects()` BEFORE committing a swap that should FLIP
 *      (CanvasPage calls it in focusLayout; incremental feeds that only
 *      append never need it).
 *    - Give every rendered cell wrapper `ref={registerCellRef(cell.id)}`. */

import { useLayoutEffect, useRef, useState } from "react";
import type { CellSpec } from "./contract";

const REDUCE = typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;

export type CellPhase = "appear" | "morph" | "";

export function useCellChoreography(cells: CellSpec[], key: unknown): {
  cellPhase: Record<string, CellPhase>;
  dissolving: CellSpec[];
  registerCellRef: (id: string) => (el: HTMLElement | null) => void;
  captureRects: () => void;
} {
  const cellRefs = useRef<Map<string, HTMLElement>>(new Map());
  const prevRects = useRef<Map<string, DOMRect>>(new Map());
  const prevCellsRef = useRef<Map<string, string>>(new Map());
  const dissolveSpecs = useRef<Map<string, CellSpec>>(new Map());
  const [cellPhase, setCellPhase] = useState<Record<string, CellPhase>>({});
  const [dissolving, setDissolving] = useState<CellSpec[]>([]);

  const registerCellRef = (id: string) => (el: HTMLElement | null) => {
    if (el) cellRefs.current.set(id, el);
    else cellRefs.current.delete(id);
  };

  const captureRects = () => {
    prevRects.current = new Map(
      [...cellRefs.current.entries()].map(([id, el]) => [id, el.getBoundingClientRect()]),
    );
  };

  useLayoutEffect(() => {
    const prev = prevCellsRef.current;
    const next = new Map(cells.map((c) => [c.id, JSON.stringify(c)]));
    const phases: Record<string, CellPhase> = {};
    for (const c of cells) {
      const was = prev.get(c.id);
      phases[c.id] = was === undefined ? "appear" : was !== next.get(c.id) ? "morph" : "";
    }
    // Ghosts only while something is still showing — an emptied arrangement
    // (the pane closed) vanishes silently rather than dissolving everything.
    const gone: CellSpec[] = [];
    if (cells.length > 0) {
      for (const [id] of prev) {
        if (!next.has(id)) {
          const spec = dissolveSpecs.current.get(id);
          if (spec) gone.push(spec);
        }
      }
    }
    setCellPhase(phases);
    // FLIP: a cell id that survived the swap travels from its old rect to
    // its new one. Translate only — content reflow owns the size change.
    if (!REDUCE) {
      for (const [id, was] of prevRects.current) {
        const el = cellRefs.current.get(id);
        if (!el || !next.has(id)) continue;
        const now = el.getBoundingClientRect();
        const dx = was.left - now.left;
        const dy = was.top - now.top;
        if (Math.abs(dx) + Math.abs(dy) < 6) continue;
        el.style.transition = "none";
        el.style.transform = `translate(${dx}px, ${dy}px)`;
        requestAnimationFrame(() => {
          el.style.transition = "transform 380ms var(--ease)";
          el.style.transform = "";
          setTimeout(() => { el.style.transition = ""; }, 420);
        });
      }
    }
    prevRects.current.clear();
    if (gone.length && !REDUCE) {
      setDissolving(gone);
      const t = setTimeout(() => setDissolving([]), 300);
      prevCellsRef.current = next;
      dissolveSpecs.current = new Map(cells.map((c) => [c.id, c]));
      return () => clearTimeout(t);
    }
    prevCellsRef.current = next;
    dissolveSpecs.current = new Map(cells.map((c) => [c.id, c]));
  }, [key]); // eslint-disable-line react-hooks/exhaustive-deps

  return { cellPhase, dissolving, registerCellRef, captureRects };
}
