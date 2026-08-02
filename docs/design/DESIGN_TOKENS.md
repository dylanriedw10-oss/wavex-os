# Design Tokens

Concrete values only. Philosophy lives in `FRONTEND_CONSTITUTION.md`. Canonical
source of truth is `packages/onboarding-ui/src/styles.css` (canvas scope) — if
this file and the stylesheet drift, the stylesheet wins and this file gets fixed.

## Type

| Token | Value | Use |
|---|---|---|
| `--text-2xl` | 32px / 650 / -0.02em / lh 1.15 | the masthead — ONE per screen |
| `--text-lg` | 18px / 650 | secondary headings (rare) |
| `--text-base` | 14px / 600 | row titles, primary row text |
| `--text-sm` | 13px / 400 | body, briefs, descriptions |
| `--text-xs` | 11px | metadata, section labels (uppercase, +0.1em, 600) |

**The face is sans, everywhere.** `-apple-system / SF Pro / system-ui` for all
interface text including metadata, timestamps, counts, and status words.
`--font-mono` exists for exactly one job: **verbatim machine output** (deliverable
`<pre>` blocks, code). Numbers that must align use `font-variant-numeric:
tabular-nums`, not a font change. (Approved decision — supersedes the earlier
mono-metadata instrument voice.)

## Color

| Token | Value | Meaning |
|---|---|---|
| `--void` | `#F4F3EF` | the ground — one step deeper than paper |
| `--panel` | `#FFFFFF` | paper — raised surfaces |
| `--panel-2` | `#ECEBE5` | nested / inset surfaces, the thread pane |
| `--edge` | `rgba(0,0,0,.08)` | hairlines |
| `--ink` | `#1B1B1B` | primary text |
| `--ink-dim` | `#63636A` | secondary text (≥4.9:1 on every surface) |
| `--good` | `#257A4A` | health: on track / confirmed |
| `--attend` | `#96781F` | health: at risk / needs review |
| `--crit` | `#8E3A38` | health: critical / failed / blocked |
| `--live` | `#2A737A` | activity: an agent is working — independent of health |
| `--mind` | `#605F96` | intelligence: generated, reasoning, temporary; also focus |

Rules: status color never travels without its printed word. Nominal is silence
("healthy" renders nothing — approved). Color never means navigation.

## Elevation (the only legal shadows)

| Token | Layer |
|---|---|
| — | Canvas: no shadow |
| `--elev-1` | Workspace: `.cv-paper`, cards, `.cv-glass` |
| `--elev-2` | Popover: `.cv-pop`, the hover snapshot, `.cv-glass--solid` |
| `--elev-3` | Tooltip: `.cv-tip` |

Surfaces cast; controls don't. Modal does not exist. No inline `box-shadow`
values — tokens or classes only.

## Space & shape

- Spacing scale: 4 / 8 / 12 / 16 / 20 / 24 / 32 (`--space-1..8`).
- Card padding: `--space-5 --space-6` (20/24). Sidebar cards may drop one step.
- Row vertical padding: 14px; rows ≥ 56px tall with a 40px leading tile.
- Radii: cards `--radius-lg` (14px); controls 9–10px; capsules 999 only for
  status pills — capability chips are NOT pills (9px).
- Split view: conversation `minmax(320px, 35%)`, workspace the rest.

## Materials

Three glass weights by permanence (fluid / standard / solid) — reserved for
load-bearing chrome, receding parents, and the Constitution center. Everything
else is opaque paper on the ground. Honest fallbacks: no-blur and
reduced-transparency render solid panels, same layout, same meaning.
