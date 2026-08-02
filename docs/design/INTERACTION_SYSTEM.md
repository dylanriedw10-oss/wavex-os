# Interaction System

Motion, transitions, and tactile states. Values are law; philosophy is the
constitution's Motion and Microinteractions sections.

## The grammar

Hover reveals. Selection commits. Click descends. Back ascends. Navigation is
zoom — never a page change, never a modal, never a stacked panel.

## Motion vocabulary (complete — nothing else animates)

| Name | What | Timing |
|---|---|---|
| appear | arrival glides up 6px, fades in | 160ms, stagger 40ms |
| dissolve | departure sinks 4px, fades out | 260ms |
| morph | same object, new evidence — opacity breath | 520ms |
| FLIP | a surviving cell travels old rect → new rect | 380ms, translate only |
| unfold | petal ⇄ node view shared-element proxy | 300ms |
| breathe | live-activity pulse — only when work is real | 2.4s loop |
| settle | value changed under stable layout | 600ms |
| lift | hover on interactive objects: translateY(-2px) (`.cv-lift`) | 130ms |

Easing: `cubic-bezier(0.2, 0, 0, 1)` everywhere. No bounce, no overshoot.
`prefers-reduced-motion` collapses everything to instant swaps — always.

## Tactile states

- Hover: 2px lift (interactive objects only; resting surfaces never move).
- Press: buttons translate 0.5px down.
- Focus: 2px `--mind` ring, offset 2px — the only chrome the intelligence
  color touches.
- Selection ranges tint `--mind` at 18%.

## Streaming & waiting

Skeleton shimmer for binding fetches; breathing dots for live runs; the walk
trace reveals hops one at a time (currently poll-and-replay; native SSE is the
named upgrade in `../RECURSIVE_ORG_SPEC.md` P2). Never a spinner where a
skeleton fits. The workspace assembles — cells appear staggered, morph in
place, dissolve when rejected — and never tears down to rebuild.
