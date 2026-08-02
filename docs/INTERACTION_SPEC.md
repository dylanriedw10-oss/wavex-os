# WaveX — Interaction Spec

Defines how people interact with the organization defined in `RECURSIVE_ORG_SPEC.md`, and how
WaveX specifically instantiates the timeless principles in `FRONTEND_CONSTITUTION.md`. Colors,
motion timing, and material rules are decided there; this document only says what happens and,
where a concrete value is needed, what WaveX's own value is.

## Grammar
Hover reveals. Selection commits. Click descends. Back ascends. Navigation should feel like
zooming through a living system, not opening a sequence of unrelated pages.

## Rules
1. One conversational input, always present, scoped to whatever node is currently active —
   asking a question inside a department's workspace is a question *to* that department, not a
   global query.
2. Walking into any node is a first-class interaction and replaces the current view — never a
   modal, never a new tab, never a stacked panel. There is exactly one view at a time; it just
   changes which node is showing. Going back restores the parent exactly. ONE named exception
   (spec Rev 9): the Runtime tray — a single, transient, read-only sheet at the Popover layer,
   summoned from the header, dismissed by esc or outside click, never auto-opening. It is a
   glance, not a view; any action it inspires is spoken through the composer.
3. A node's available actions render as its capability list — a lightweight reveal, never a
   fixed global button bar and never hardcoded by node kind. Capabilities are prompts, so they
   live in the composer, beside where questions are typed (spec Rev 7).
4. The Constitution is one fixed, singular node — the wheel's still center. Same interaction
   model as everything else: walk into it. Its content is a fixed schema instead of a
   business-object subtree.
5. No traditional forms, no settings screens, no dropdowns, no modals anywhere. Configuration is
   either a capability invoked conversationally, or a direct edit on a living deliverable's
   sub-part — never a form.

## Progressive Disclosure
Information is earned, never dumped — WaveX states this as the **density gradient**
(`RECURSIVE_ORG_SPEC.md` Revision 7): density is earned by interaction, with per-level budgets
from the L0 watch face down to the raw record. At rest, a node shows only its identity.
Hovering reveals a snapshot as a floating card near the node (the Popover layer), not crowded
inline into it. Selecting walks in.

Knowledge-completeness is never labeled as raw onboarding progress in the copy — render the
backend's own label, never a bare percentage without its noun.

## Delegation Trace
When a question can't be answered at the current node, the system walks to the child that can,
one hop at a time, rendered as a step list — directly analogous to an agent's own tool-call
trace — appending one at a time as the walk actually happens, never a batch reveal. The walk
ends by landing on the node with the evidence; that node becomes the active workspace, and the
trace stays visible above it as the path that produced it. Manually clicking into a child is
the same walk, done by hand instead of by question. (Transport upgrade to native SSE is a
named P2 entry in `RECURSIVE_ORG_SPEC.md`.)

## Generated Workspaces
A node's children are a stable ontology. But the workspace shown when a node is landed on isn't
a fixed template keyed to that node's kind; it's assembled from whichever children, plus
whichever freshly generated objects, are actually relevant to the question that got there. A
panel can show either a persistent child (walking into it is a normal descent) or a freshly
generated object that exists only in that workspace.

If the next question needs a panel already on screen in a different state, that panel morphs
into its new content in place rather than being torn down and rebuilt. One panel always
dominates; everything else is clearly supporting — a workspace where five panels compete has
failed regardless of how relevant each one is individually.

## Promoting a Generated Object
When a generated object is worth keeping, promoting it turns it into persistent structure —
this is an explicit action ("Keep"), never automatic and never silent. WaveX's shipped rung:
the server constructs the claim from the stored layout, cited by construction
(`RECURSIVE_ORG_SPEC.md` Rev 5, promotion ladder).

## The Runtime Tray
The runtime's glanceable surface (spec Rev 9), reachable from any context without leaving it:
**Now** (in_progress tasks — the state word does the present-continuous job: "Running · <task>",
never invented conjugations), **Up next** (the exact tasks the next cycle would pick — the
server's own ready predicate, oldest first, capped at five and labeled as the pick order),
**Just finished** (recent terminal events, human-phrased, real), and **Walking** (a live
investigation's hops as they land). Checklist semantics translated from Claude Code's verified
task-list behavior: three states, a five-item cap, groups clearing together. The tray renders
honest empties for operational sections and stays silent where records don't exist yet.

## Investigative Momentum
A lightweight "recently investigated" trail — the Investigations lens: past delegation walks
with timestamps, grouped by question, in the trace's own vocabulary. Shown, never computed or
stored on the client.

## WaveX Visual Tokens

Moved: concrete values live in `design/DESIGN_TOKENS.md` (with `design/COMPONENT_RULES.md`
for anatomy and `design/QUALITY_GATE.md` for the merge gate). This section keeps only the
history that matters: the dark-glass token block (`#0B0B10` ground, purple glow, heavy blur)
is superseded by the light architectural system; the structural ideas survive (three material
weights by permanence; an activity signal independent of health); the face is fully sans with
mono reserved for verbatim machine output (approved). Canonical source remains
`packages/onboarding-ui/src/styles.css` — the stylesheet wins over any doc.

```css
.canvas-root {
  --void: #F4F3EF;        /* the GROUND — one step deeper than paper */
  --panel: #FFFFFF;       /* paper — raised surfaces */
  --panel-2: #ECEBE5;     /* nested / inset surfaces */
  --edge: rgba(0,0,0,.08);/* hairlines */
  --ink: #1B1B1B;         /* primary text — the hero */
  --ink-dim: #63636A;     /* secondary text (≥4.9:1 on every surface) */
  --mind: #605F96;        /* intelligence: generated, reasoning, temporary */
  --live: #2A737A;        /* alive: an agent is working — independent of health */
  --good: #257A4A;        /* health: on track / confirmed / trajectory */
  --attend: #96781F;      /* health: at risk / needs review */
  --crit: #8E3A38;        /* health: critical / failed / blocked */

  /* the Constitution's fixed elevation ladder — the ONLY legal shadows.
     Surfaces cast; controls don't. Modal deliberately never exists. */
  --elev-1: 0 1px 2px rgba(28,25,18,.05), 0 12px 32px -14px rgba(28,25,18,.18); /* Workspace */
  --elev-2: 0 2px 6px rgba(28,25,18,.07), 0 24px 56px -18px rgba(28,25,18,.28); /* Popover  */
  --elev-3: 0 8px 24px -12px rgba(0,0,0,.35);                                   /* Tooltip  */
}
```

**Materials, resolved fork #1 (glass liberality → tightened to the Constitution's default):**
translucency is reserved for load-bearing chrome and receding objects — the sticky lens rail
(content scrolls under real frost), the Constitution center, parents stepped back to fluid
weight, resting board chips. Every node panel, card, and queue is opaque paper (`.cv-paper`,
elev-1). Three weights remain, assigned by permanence: fluid (receding/ephemeral), standard
(chrome), solid (the Constitution).

**Depth, WaveX-specific:** of the Constitution's five layers, WaveX uses four — Canvas (the
wheel and every node view), Workspace (`.cv-paper` panels, elev-1), Popover (the floating
hover snapshot, `.cv-pop`, elev-2), Tooltip (`.cv-tip`, elev-3). Modal is deliberately never
used — rule 5 replaces it with conversational capability invocation.

**Color, resolved fork #2 (teal/amber/coral/purple vs. the Constitution's muted trio → both,
correctly split):** health wears the Constitution's muted trio — `--good` / `--attend` /
`--crit`, desaturated so nothing screams. The old system's real insight — *activity is a
signal independent of health* — survives as `--live` (teal: an agent is working right now)
plus `--mind` (violet: generated intelligence, temporary reasoning). A node can breathe teal
while its health reads critical; that combination is the truth, not a conflict. Status color
never travels without its printed status word.

**Motion, WaveX-specific:** breathing is tied strictly to real per-node activity — never
decorative, never running just because a node exists. Hover lifts (brightness + shadow), never
recolors alone. The unfold carries petal ⇄ node-view continuity; FLIP carries cell identity
across workspace morphs. Reduced motion collapses all of it to instant swaps.

**Exception-based rendering (Rev 7):** nominal is silence — "healthy" prints nothing, zero
pending shows no badge, idle is a resting petal. Deviations get the ink. Full statements live
one level down.
