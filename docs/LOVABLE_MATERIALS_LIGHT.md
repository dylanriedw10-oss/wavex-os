# §5 Replacement — Materials, Light

**This supersedes §5 of the Frontend Constitution ("How It Looks and Feels")
in full, including its `:root` block.** Everything else in the brief stands —
the node model, Hermes, the depth model, motion, the two tests.

The reason is not preference. **The light system already exists in this
repo and already implements the Constitution's own principles.**
`packages/onboarding-ui/src/styles.css` cites `frontend-constitution.md` by
name and, in its own comments, already encodes: no modals, a fixed elevation
ladder, "color is meaning, not branding," and CVD-safe status separation. The
brief's dark-glass §5 would replace a more evolved system with a less evolved
one, and nothing built against it would port back.

Every value below is copied from `styles.css`, not invented.

---

## The palette

```css
:root {
  /* ground + paper — a warm off-white ground so paper DETACHES from it */
  --void:    #F4F3EF;   /* canvas ground */
  --panel:   #FFFFFF;   /* paper — raised surfaces */
  --panel-2: #ECEBE5;   /* nested / inset surfaces */
  --edge:    rgba(0,0,0,.08);   /* hairlines */

  /* ink carries hierarchy — the interface must read with color removed */
  --ink:     #1B1B1B;   /* primary text — the hero */
  --ink-dim: #63636A;   /* secondary (>=4.9:1 on every surface above) */

  /* STATUS tokens, never series colors. Every use ships a text label.
   * attend/crit are lightness-separated for CVD. */
  --mind:   #605F96;    /* intelligence: generated, reasoning, TEMPORARY */
  --live:   #2A737A;    /* alive: streaming, in-flight, "this is now" */
  --good:   #257A4A;    /* confirmed + trajectory: approved, healthy */
  --attend: #96781F;    /* needs review: uncertainty, degraded, retryable */
  --crit:   #8E3A38;    /* rare: failed mutations, blocked states */

  /* elevation — the ONLY legal shadows. Surfaces cast, controls don't.
   * Canvas -> Workspace(1) -> Popover(2) -> Tooltip(3). Modal never exists. */
  --elev-1:    0 1px 2px rgba(28,25,18,.05), 0 12px 32px -14px rgba(28,25,18,.18);
  --elev-1-up: 0 2px 4px rgba(28,25,18,.06), 0 18px 44px -16px rgba(28,25,18,.22);
  --elev-2:    0 2px 6px rgba(28,25,18,.07), 0 24px 56px -18px rgba(28,25,18,.28);
  --elev-3:    0 8px 24px -12px rgba(0,0,0,.35);

  /* motion — inside the brief's own 120–180ms band */
  --dur-fast: 80ms;  --dur-base: 160ms;
  --ease: cubic-bezier(0.2, 0, 0, 1);

  /* type + rhythm */
  --text-xs: 11px; --text-sm: 13px; --text-base: 14px;
  --text-lg: 18px; --text-xl: 24px; --text-2xl: 32px;  /* 2xl = masthead, one per screen */
  --space-1: 4px; --space-2: 8px; --space-3: 12px; --space-4: 16px;
  --space-5: 20px; --space-6: 24px; --space-8: 32px;
  --radius-sm: 4px; --radius: 8px; --radius-lg: 14px;
  --font-mono: ui-monospace, SFMono-Regular, "SF Mono", Menlo, monospace;
}
```

---

## Mapping the brief's §5 onto it

| brief §5 | use instead | note |
|---|---|---|
| `--om-bg: #0B0B10` | `--void: #F4F3EF` | warm off-white ground |
| glass fluid / standard / solid | `--panel` + `--elev-1 / -2 / -3` | **permanence is carried by elevation, not translucency** |
| `--blur-*`, `backdrop-filter` | *(delete)* | §8 already says limit it; on paper it buys nothing and costs frames |
| `--om-teal` on track | `--good: #257A4A` | |
| `--om-amber` at risk | `--attend: #96781F` | |
| `--om-coral` critical | `--crit: #8E3A38` | |
| `--om-activity` purple | **split — see below** | |
| five depth layers | `--elev-1/2/3` ladder | Canvas → Workspace → Popover → Tooltip; **modal does not exist**, as the brief demands |
| 120–180ms | `--dur-base: 160ms` | independent convergence — leave it |
| `--om-selected` glow | `--mind` at low alpha, or `--elev-1-up` | prefer lift over outline |

**The one place the repo is ahead of the brief.** §5 has a single
`--om-activity` purple meaning "an agent is working here." The repo splits
that in two, and the split maps exactly onto §1's persistent-vs-generated
distinction:

- `--mind` — **generated, reasoning, temporary.** An investigation, a forecast,
  a comparison: things with no id in the tree that vanish when the conversation
  moves on.
- `--live` — **streaming, in-flight, "this is now."** Real work happening.

Bind `--live` to `activity: "active"` from the API. Bind `--mind` to generated
objects. Keeping them separate is what lets a node read "this is a temporary
artifact" and "something is running" at the same time without the two blurring
— which is the §5 requirement that a node can glow while its ring sits red.

---

## Prose changes to §5

Replace the materials paragraph with:

> **Materials.** The ground is a warm off-white; paper detaches from it by
> elevation, never by translucency. There is no glass. Permanence is carried by
> the elevation ladder — a deliverable's raw evidence sits inset on
> `--panel-2`, a department's workspace is paper at `--elev-1`, the
> Constitution is paper at `--elev-2`. Surfaces cast shadows; controls never
> do. The tokens above are the only legal shadow values — no inline
> `box-shadow`, no elevation invented per component.

Everything else in §5 survives verbatim: color communicates state and never
structure; typography carries hierarchy alone and the interface stays legible
with color removed; hover is a 3% shift; cards lift 2px; density adapts to
depth, not to available space; one coherent icon system.

Two rules the repo adds, and Lovable should inherit:

1. **Teal is not identity.** `--accent` is remapped to `--ink` — links, focus
   and primary actions are ink. Color is reserved for state. Nothing is teal
   because it is "the brand."
2. **Every status color ships a text label.** The color is redundant
   reinforcement, never the sole carrier of meaning. This is §7's
   accessibility requirement enforced at the token level.

---

## For the build

- Consume tokens. No component invents a color, a shadow, a radius or a duration.
- If a surface seems to need glass, it needs elevation instead.
- `--crit` is described in-repo as **rare**. If a screen shows several at once,
  that is a design smell, not a palette problem.
- The `.legacy-dark` class exists for surfaces not yet standardized (Mission
  Control, public pages). **Do not build anything new inside it** — it is an
  opt-out being retired, not a theme to target.
