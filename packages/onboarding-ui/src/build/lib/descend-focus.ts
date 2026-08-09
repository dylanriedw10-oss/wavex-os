/** Focus for the descend/return move, which the canvas does everywhere.
 *
 *  Descending swaps one panel for another in place — the research rows become
 *  the full record, a section becomes its detail. With a mouse that reads as
 *  motion. With a keyboard it is a hole: the element you activated is
 *  unmounted, focus falls to <body>, and the next Tab starts again from the
 *  top of the document. Coming back is worse, because the thing you were
 *  reading is gone and nothing says where you are.
 *
 *  Nothing here was BROKEN — every control in this surface is a real
 *  <button>, so the app was always operable by keyboard. What was missing is
 *  continuity: the constitution asks that walking into a node be "the same
 *  object continuing", and for a keyboard user it was a teleport.
 *
 *  So: on descend, move focus to the landing element. On return, put it back
 *  on the trigger. `preventScroll` because the canvas positions its own
 *  surfaces and the browser's scroll-into-view fights the layout.
 *
 *  Announce, don't just move: the landing element should carry a heading or
 *  a label a screen reader can read, which is why this returns refs rather
 *  than focusing something arbitrary. */
import { useEffect, useRef } from "react";

export function useDescendFocus(descended: boolean) {
  /** The control that descends. Focus returns here. */
  const triggerRef = useRef<HTMLElement | null>(null);
  /** The first thing worth reading after descending. Focus lands here. */
  const landingRef = useRef<HTMLElement | null>(null);
  const wasDescended = useRef(descended);

  useEffect(() => {
    // Only act on a TRANSITION. Running on every render would steal focus
    // from whatever the operator moved to inside the panel.
    if (descended === wasDescended.current) return;
    const entering = descended;
    wasDescended.current = descended;

    const target = entering ? landingRef.current : triggerRef.current;
    if (!target) return;
    // After paint: on the entering edge the landing element does not exist
    // yet when this effect first runs.
    const id = requestAnimationFrame(() => {
      try {
        target.focus({ preventScroll: true });
      } catch {
        target.focus();
      }
    });
    return () => cancelAnimationFrame(id);
  }, [descended]);

  return { triggerRef, landingRef };
}
