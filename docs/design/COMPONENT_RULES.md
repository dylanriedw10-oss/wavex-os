# Component Rules

Anatomy specs. Tokens in `DESIGN_TOKENS.md`; when a component here and the
code disagree, whichever matches the tokens wins.

## Buttons

Primary: ink fill, white text, radius 10, no shadow, hover darkens, press
translates 0.5px. Secondary: hairline on transparent. Tertiary: bare text in
`--ink-dim`, min-height 24. Never a colored CTA — color is state, not action.

## Cards (`.cv-paper`)

Radius `--radius-lg` (14), hairline `rgba(0,0,0,.05)`, `--elev-1`, padding
20/24. Cards are surfaces: they cast. Nothing inside a card gets its own
shadow. Ghost variant (dashed hairline, 45% white) for not-yet-real states.

## Rows (Working On, queues, feeds)

40px leading tile (Medallion: identity-hue gradient, inner highlight, one
contact hairline) · two lines (title 14/600, excerpt 13 dim, one-line clamp) ·
right-side metadata in 11px dim · status pill · chevron if and only if the row
expands or descends. Row padding 14px vertical; hairline separators; ≥56px tall.

## Status pills

Capsule, tone-tinted at 10%, no border, 11px/600, the status word always
printed. Reserved for STATE. Capability chips are not pills: radius 9,
hairline, dim text — lightweight command suggestions in the composer.

## The kind pill

`--mind` tinted capsule naming the node kind (AGENT, DEPT…) — the one
identity capsule, uppercase 11px.

## Section labels

11px, uppercase, +0.1em, 600, `--ink-dim`, 12px below-margin. Counted labels
append the count in the same size.

## The flywheel

An engineered object, never a chart: recessed well + bezel hairlines behind
top-lit petals (`petalPath` — constant-width gap channels, inward-only corner
easing), one ground shadow on the whole face, hover lifts the petal, the
Constitution is the domed center. Breathing only on real activity. Sub-dials
(hub row) are 30px medallions. Caption: one line, the objective. `d3.arc()` is
the pre-authorized fallback if the wheel ever outgrows one ring (see spec P2).

## Chat

User turns: paper bubble, hairline, radius-lg, right-aligned, ≤85%. Assistant:
bare text. The thread pane wears the deeper surface. Capability suggestions +
scope chip sit above the input.

## The Runtime tray

The one legal overlay: a 380px right sheet on `.cv-pop` (elev-2), full-height
with 12px margins, arriving on a single 160ms glide. Read-only rows in the
standard row grammar (dot · text · meta); section labels standard; a live row
breathes; dismiss via esc, outside click, or ✕. Entry is the header's Runtime
item — a live dot only while something runs, an amber count only above zero.

## The desk

See `SPATIAL_ARCHITECTURE.md` for anatomy. Numbers on a desk are counted store
state; the four refusals (fake percent, personas, invented counts, printed
Healthy) are recorded in `../RECURSIVE_ORG_SPEC.md` Rev 8 and stay refused.
