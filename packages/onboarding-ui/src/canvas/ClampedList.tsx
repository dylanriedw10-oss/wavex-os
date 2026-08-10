/** The counted clamp (spec Rev 10) — the one way a list may be shortened.
 *
 *  Generalizes the shape Desk.tsx's `sideCard` already had right: render
 *  what fits, print the TRUE total, and offer a descent for the remainder.
 *  The only change is that the count comes from measured space instead of a
 *  hardcoded constant.
 *
 *  NO SILENT CAPS. A hidden row is always announced with its real number —
 *  a clamp the operator can't see is the interface lying about how much
 *  exists, which is the same failure class as an invented metric. */

import type { ReactNode } from "react";
import { fitRows, useInstrumentHeight, type FitOpts } from "./layout";
import { BARE_CONTROL } from "./bare-button";

export function ClampedList<T>({
  items, rowPx, render, onMore, moreLabel, availPx, countInHeader, ...fit
}: {
  items: T[];
  /** Measured row height in px — the cost of one row, chrome included. */
  rowPx: number;
  render: (item: T, index: number) => ReactNode;
  /** Where the remainder lives. Omitted = the count prints without a descent
   *  (honest, but prefer giving overflow somewhere to go). */
  onMore?: () => void;
  /** Override the default "+N more →" phrasing. */
  moreLabel?: (hidden: number, total: number) => string;
  /** Budget override for regions that aren't the instrument zone (the tray). */
  availPx?: number;
  /** The CALLER already prints the true total (a card header, a group
   *  header), so the "+N more" line would say it twice. This is not a silent
   *  cap — the count is still on screen, just once instead of twice. */
  countInHeader?: boolean;
} & FitOpts) {
  const instrument = useInstrumentHeight();
  const n = fitRows(availPx ?? instrument, rowPx, fit);
  const shown = items.slice(0, n);
  const hidden = items.length - shown.length;

  return (
    <>
      {shown.map(render)}
      {hidden > 0 && !countInHeader && (
        onMore ? (
          <button onClick={onMore}
            style={{
              ...BARE_CONTROL, cursor: "pointer", minHeight: 24, padding: "2px 0",
              fontSize: "var(--text-xs)", color: "var(--text-dim)",
            }}>
            {moreLabel ? moreLabel(hidden, items.length) : `+${hidden} more →`}
          </button>
        ) : (
          <span className="text-dim" style={{ fontSize: "var(--text-xs)", padding: "2px 0" }}>
            {moreLabel ? moreLabel(hidden, items.length) : `+${hidden} more`}
          </span>
        )
      )}
    </>
  );
}
