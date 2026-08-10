/** The style prelude for a button that must not look like a button.
 *
 *  Nineteen places in this app write `all: "unset"` inline to turn a
 *  `<button>` into a row, a chip, a marker, or a bare label — correctly, and
 *  for a good reason: the thing IS a control, so it has to be a real button
 *  for keyboard and screen-reader users, but it must not carry the ink fill
 *  `.canvas-root button` gives every other control.
 *
 *  `all: unset` also resets `outline-style` to `none`. An INLINE declaration
 *  outranks every author stylesheet rule, so the constitution's focus law —
 *  `2px --mind ring, offset 2px`, the only chrome the intelligence color
 *  touches — could never paint on any of them. Tabbing across the connector
 *  markers, the canvas sub-dials (the only keyboard-reachable descent at L0),
 *  every "+N more" clamp and the Runtime tray's close button moved focus with
 *  no visual indication of where it had gone. Icon-only circles on a
 *  near-white ground: entirely invisible.
 *
 *  `revert-layer` is the fix, and it is the RIGHT one rather than the
 *  convenient one — measured, not assumed. Tabbing to a live probe in the
 *  running app:
 *
 *    all: unset                      → outline: none          (erased)
 *    all: unset; outline: revert     → auto 1px rgb(0,95,204) (the BROWSER's
 *                                       blue default — wrong ring, wrong color)
 *    all: unset; outline: revert-layer → solid 2px color(srgb .376 .373 .588
 *                                       / .6)                (--mind at 60% —
 *                                       the constitution's own ring)
 *
 *  `outlineOffset` needs it too: `all: unset` flattens the 2px offset to 0
 *  and only the paired revert brings it back.
 *
 *  It lives here, spread rather than retyped, so that a twentieth bare button
 *  cannot be written without it. That is the actual defect — not any one of
 *  the nineteen, but that the pattern had no home. */
export const BARE_CONTROL = {
  all: "unset",
  outline: "revert-layer",
  outlineOffset: "revert-layer",
} as const;
