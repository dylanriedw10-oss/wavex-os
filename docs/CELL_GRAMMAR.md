# The Cell Grammar

**Status:** canonical design law for the canvas cell library.
**Supersedes:** thinking of `packages/onboarding-ui/src/canvas/cells.tsx` as a component library.
**Companions:** `docs/HELM_SPEC.md` (interface rules), `docs/COGNITIVE_RENDERER_PLAN.md` (origin),
`packages/wavex-os-server/src/canvas/catalog.ts` (the machine-readable half of this document).

---

## Thesis

The library is not a set of widgets. It is a **grammar**:

- **Nouns** — cognitive primitives (`observation`, `hypothesis`, `constraint`, `unknown`…).
  What kind of thought a cell manifests.
- **Verbs** — behaviors (`expand`, `merge`, `split`, `morph`, `spawn`, `pin`, `stream`,
  `supersede`). What a cell can *do* over its lifetime.
- **Adjectives** — presentation (`variant`, `density`, `salience`, liveness). How a thought is
  expressed this time.

The composer does not build dashboards from widgets — it writes sentences in this language.
A small set of primitives × behaviors × presentations generates hundreds of distinct,
coherent manifestations without ever feeling like the same cards rearranged. That is the
difference between *morphic* and merely *dynamic*.

## Invariants (nothing below weakens these)

1. The model never produces a number a cell displays. Bound cells fetch from the catalog.
2. **Authored primitives** (explanation, hypothesis, tradeoff, recommendation…) carry
   structure and prose — never inline numbers presented as data. They wear the violet
   interpretation treatment (`--mind`), visibly distinct from endpoint truth. This is the
   hypothesis rule, generalized.
3. Mutations only via the commit allowlist; drill is conversation; ledger never trims.
4. Validation drops nothing it can degrade: an unknown **variant** strips to the type's
   default (cell survives, warning recorded); an unknown **type** or **binding** drops the
   cell (warning recorded); a broken layout degrades to prose. Never a broken screen.
5. Palette semantics are fixed: violet = mind, teal = alive, emerald = confirmed,
   amber = needs review, coral = failure/blocked. A new manifestation never borrows an
   accent for decoration.

## Nouns — primitives, organized by intent

The catalog is organized by the *kind of thinking the operator needs*, not by visual form.
`INTENTS` in `catalog.ts` is the machine-readable map.

| Intent | Primitives | Wave |
|---|---|---|
| inform / measure | observation, evidence, **unknown** | A |
| explain | hypothesis, **explanation**, causality | A / B |
| compare | comparison, **tradeoff** | A |
| predict / simulate | prediction, simulation | shipped |
| investigate | investigation, contradiction | shipped / B |
| decide / act | decision, proposal, **recommendation** | A |
| coordinate | relationship, consensus, dependency | shipped / B |
| remember | memory, timeline, conversation, document | shipped |
| monitor | risk, alert, progress, plan, **constraint**, opportunity | A / B |

Wave A additions are honest today: `unknown` (the system says "I don't know — here's what I'd
need" instead of bluffing), `constraint` (obs-bottlenecks — real data), `explanation` and
`tradeoff` (authored, rule 2), `recommendation` (authored; spawns into the proposal lifecycle).

Wave B additions (`contradiction`, `consensus`, `causality`, `dependency`, `opportunity`)
need multi-agent position data (Paperclip interactions/comments) or attribution rules —
they ship when that data is readable, every position labeled with its source agent.
Confidence is **not** a primitive: it renders only where data carries it (simulation
spread/Sharpe). Model-self-reported confidence percentages are fabrication with a UI.

## Adjectives — presentation

All optional on `CellSpec`; all additive to the wire contract; all degrade gracefully.

- **`variant`** — the expression of a type. Per-type vocabulary (see `VARIANTS` in
  catalog.ts): `metric.hero`, `metric.gauge`, `metric.delta`, `metric.goal`, `metric.live`,
  `metric.split`; `table.rows`, `table.breakdown`, `table.checklist`; `trend.line`,
  `trend.cadence`; `timeline.instance`, `timeline.activity`; `attention.queue`,
  `attention.approvals`. Unknown variant → default variant, warning, cell survives.
- **`density`** — 1–4. L1 headline only → L2 + context line + delta → L3 + spark/meter/facets
  (today's default) → L4 full context. The composer chooses; the operator can override
  in place (an explicit act — see cell memory). Renderers implement ≥2 levels per type.
- **`salience`** — 0 ambient / 1 normal / 2 the point of the workspace (violet edge). Exists.
- **liveness** — not a field; the binding's polling cadence, made visible by the provenance
  footer, the breathing dot, and elapsed durations. Exists.
- **`group`** — fusion key. Cells sharing a group render as ONE object: one glass shell,
  internal hairlines, per-source provenance. (Principle 5: cells merge.)

## Verbs — behaviors

| Verb | Meaning | Status |
|---|---|---|
| expand / collapse | density shift, composer-chosen or operator act | G2 |
| merge | `group` fusion into one object | G4 |
| split | drill `mode:"unfold"` — the object mutates in place; the transcript still records the exchange | G4 |
| **morph** | same subject, new question → same cell id → the object transforms, never replaced | G3 |
| spawn | lifecycle edges: simulation → recommendation → proposal → ledger → timeline | G5 |
| pin | desk persistence | shipped |
| stream | cells arrive as the composer chooses them (SSE) | G6 |
| supersede | replaced thought dissolves / fades | shipped |

**The morph rule (Principle 10):** within a conversation, a cell whose subject
(`source.api` + params) persists across turns keeps its id. The server enforces this with a
deterministic re-key pass; the T2 composer is instructed to do it; the choreography then
transforms the object (FLIP) instead of dissolving and re-creating it. Ask "show revenue" →
metric. Ask "over time?" → the *same object* stretches into a trend. Never replaced, never
destroyed, always evolving.

## The lifecycle (Principle 2)

A cell is never static. States, unified from today's implicit machinery:

```
loading (shimmer) → discovering/streaming (G6) → stable
   stable → changed (settle pulse, data moved)
   stable → stale (refetch failed: dimmed frame, dated, retryable — never blanked)
   stable → superseded (dissolve/fade when the thought is replaced)
   any    → pinned (desk) → restored
fresh compositions glow violet and decay; memory recalls arrive settled
```

The glow is `composedBy` made visible; the settle is data-change made visible; stale frames
are honesty made visible. New states must map to real system facts, not decoration.

## Degrade ladder (rule 4, operationally)

```
unknown variant        → default variant + warning        (cell keeps rendering)
unknown density        → clamp to nearest valid
missing data for a variant (e.g. gauge with no cap) → fall back to hero
unknown primitive      → render by type, intent unknown   (cell keeps rendering)
unknown type / binding → drop cell + warning              (workspace survives)
broken layout          → prose reply                      (conversation survives)
```

## Cell memory (Principle 9, constrained)

Expression preferences (`variant`, `density` per primitive) are learned **only from explicit
operator acts** — expanding a cell, unfolding, asking "as a table". Stored per company in
`canvas.json → expression`, inspectable, cleared by reset. Never silently inferred. The stub
consults it directly; the T2 prompt receives it as one hint line. You are not personalizing
data — you are personalizing cognition, and the operator can always see and undo it.

## What this replaces

Organizing the catalog by visual type (metric / table / chart / timeline) as the primary
taxonomy. Visual type remains the *renderer dispatch key*; the primary taxonomy is intent.
The backend selects the kind of thinking; the grammar selects the manifestation.

## Build order

G0 this doc · G1 contract adjectives + INTENTS · G2 metric family (variants × densities,
expand-in-place) · G3 morph identity (re-key + FLIP) · G4 merge/split · G5 primitives wave A ·
G6 lifecycle + streaming · G7 expression memory · G8 primitives wave B.
