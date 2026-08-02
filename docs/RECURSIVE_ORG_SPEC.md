# The Recursive Org — Build Spec (Revision 9, the runtime tray)

**Status:** canonical. Revision 3 grounded the "NL + Recursive Org Interface" concept in the
shipped surface. Revision 4 made the organization **adaptive**: memory, influence, gravity,
momentum, objectives, and recommending walks — every one derived from data that exists,
none invented by a model. Revision 5 states the **object law** the surface had been
converging on — persistent objects are navigated, ephemeral objects are generated — and
adds the resting-state inversion, Views, the promotion ladder, and the unfold principle.
Revision 6 records **the pivot**: Paperclip is out as the runtime backend; WaveX executes
its own work — goal → task graph → briefs on the operator's own subscription → QA gates →
ledger. Revision 7 states **the density gradient**: density is earned by interaction —
the resting screen is the most minimal, and every level deeper may grow exactly one
stratum of complexity. Revision 8 gives work nodes **the desk**: an L1 anatomy —
masthead with role copy and the reporting structure, the Currently-Working hero, rich
Working-On rows, and a sidebar of counted previews (activity, memory, artifacts) —
every element bound to store state. Revision 9 adds **the runtime tray** — the one
sanctioned overlay: a transient, read-only Popover-layer sheet making the runtime
glanceable from any context (now / up next / just finished / walking), with checklist
semantics translated from Claude Code's verified task-list behavior and an honesty
amendment (no invented present-continuous text; the state word does that job).
Reconciliation records (Rev 2→…→9) are §12.

**Companions:** `docs/design/` (the design system: FRONTEND_CONSTITUTION · DESIGN_TOKENS ·
INTERACTION_SYSTEM · SPATIAL_ARCHITECTURE · COMPONENT_RULES · QUALITY_GATE),
`docs/INTERACTION_SPEC.md` (product interaction grammar), `docs/CELL_GRAMMAR.md` (manifestation layer),
`docs/HELM_SPEC.md` (interface rules), `docs/PAPERCLIP_BACKEND_AND_FRONTEND_PLAN.md`
(historical — the Part-2 surface as designed against Paperclip; superseded by Revision 6).

---

## The four principles (Revision 4)

1. **Organizations are living systems, not hierarchies.** Reporting lines are the tree;
   influence, dependency, and trust are the graph — and the graph is *observed* from real
   behavior (issue dependencies, approval routing, walk history), never declared by a model.
2. **Every interaction increases organizational intelligence.** Questions, walks, and
   decisions distill into cited institutional memory. The transcript remains the substrate
   and the record — memory is its distillation, never its replacement.
3. **The interface shows momentum before it reports state.** Operators see rising and
   falling forces — blocker accumulation, queue growth, cooling activity — rendered from
   real deltas. A *percentage* about the future is earned only by running a simulation,
   never by assertion.
4. **The system optimizes the organization — through governance.** It recommends
   structural improvements, surfaces hidden dependencies, and names bottlenecks; every
   structural change flows recommendation → proposal → confirm → ledger. The org never
   restructures itself silently.

## Revision 5 — the object law and the resting state

**Two object classes, one rule.** Everything on the canvas is one of:

- **Persistent objects** — they exist independently of any conversation: the
  Organization, the Constitution, departments, agents, instruments (the metric nodes —
  an amendment to the six-layer taxonomy, which missed them), and — once backed by
  runtime reads — projects, deliverables, tasks. Promoted memory and ledgered decisions
  are persistent records.
- **Ephemeral objects** — created to answer the current question: comparisons, analyses,
  forecasts, simulations, drafts, plans — every composed workspace.

**The rule: persistent objects can be NAVIGATED; ephemeral objects can only be
GENERATED.** The operator always knows which they're touching: the org is walked,
answers are asked for. The board is graceful ephemerality (four resting workspaces,
one tap back); pins are "unless saved"; nothing ephemeral becomes persistent except
through promotion.

**The resting state.** The workspace pane's home IS the organization — the wheel at the
root, the walked-into node otherwise. An ephemeral workspace takes the pane while it
answers; Minimize steps it to the board and the org returns. There is no empty state,
no dashboard, no arbitrary navigation — only "what part of the organization am I
standing in" plus whatever the current question composed.

**Views.** The company root carries organizational concepts, not dashboards —
Investigations (the walk log, grouped), Learned (org-wide cited memory, each row
re-runnable at its node), Gravity (measured, null before volume), and the Constitution.
One open at a time; all measured, never authored.

**The promotion ladder.** Ephemeral → approved → persistent, always through a gate:

| Rung | Mechanism | Status |
|---|---|---|
| Answer → memory | "Keep this": server-built claim from the stored layout + snapshot, `as of` provenance, `{kind:"canvas"}` citation; feeds later walks by precedent | SHIPPED (O1) |
| Mutation → org state | proposal → confirm → commit allowlist → constitution gate → ledger (add-agent, budgets, ignite) | SHIPPED (R1) |
| Object → runtime | `create-goal` / `create-task` / `run-cycle` in the commit allowlist, gated like every mutation — landed NATIVELY, not via Paperclip | SHIPPED (P1, Rev 6) |

**The unfold.** The flywheel is compression, not navigation: a petal and its node view
are one object. Entering unfolds the petal into the header (the destination seeded
synchronously from data already in hand); leaving folds it back. Reduced motion or an
unmeasurable target → instant swap. Every level down is more context, never a
different application.

**Superseded (Rev 6).** The paragraph that stood here confirmed O2/O3 feasible against
Paperclip's projects/issues reads. The pivot removed Paperclip as the runtime; the
intent — persistent L2/L5 work objects — landed natively instead. See Revision 6.

## Revision 6 — the pivot: the runtime is native

**The decision (operator, recorded).** Paperclip is out as the runtime backend. WaveX
no longer mirrors someone else's fleet — it IS the execution layer: goal → task graph →
briefs executed on the operator's own subscription → QA gates → ledger, with the
constitution as the compass. The vendored `packages/core` stays in-tree but nothing
calls it (removal is P2).

**The same-contract swap.** The four runtime read bindings
(`/runtime/dashboard|activity|approvals|live-runs`) KEPT their paths, envelopes, field
names, and status vocabulary (503 = runtime not started) — re-served from the native
work store by pure derivations that COUNT store state and never invent. The five
consumers (catalog, composer, snapshot, org nodes, cells) shipped unchanged; the truth
underneath changed from a mirrored fleet to WaveX's own runs.

**The work store** (`work.json` per company, atomic tmp+rename like org.json): goals
(from the manifest at seed + operator-created through governance), tasks (ladder
`todo → in_progress → in_review → done | blocked | failed`, assignee slot,
dependencies, attempts against a ceiling, accumulated feedback), deliverables (engine
output verbatim + review state `pending_review → approved | changes_requested`), and
the run log every binding derives from. `readWork` returning null IS the seeded gate.

**The engine and the loop.** `executeBrief` folds the constitution's identity lines
(the compass), the task brief, and all prior feedback into one prompt and runs it
through tier-router under `withTokenAccounting(companyId, "task_exec", …)` — the
operator's own OAuth locally, an API key in production: the compliant, local-first
form of "agents on your subscription". The run-cycle is SERIAL in P1 because token
attribution is time-window based — concurrency would lie about spend; parallelism
arrives with request-id attribution (P2). The never-give-up loop is bounded and
visible: a structural failure or requested change folds feedback into the next brief
and requeues; the attempt ceiling escalates to the operator (status `failed`, printed)
instead of spinning; budget exhaustion reverts the task without burning an attempt and
stops the cycle — running dry is not the agent's fault.

**The QA ladder — honesty preserved:**

| Gate | What it is | Status |
|---|---|---|
| Structural | dumb, checkable facts: non-empty, minimum length, the brief's `Sections:` line satisfied | SHIPPED (P1) |
| Operator review | the semantic gate: approve / request changes with feedback that reaches the next brief | SHIPPED (P1) |
| T2 verifier | a model pass, LABELED as such — never silent self-grading | P2 |

**Governance unchanged, extended.** `create-goal` / `create-task` / `run-cycle`
entered the commit allowlist; the work routes also run the constitution gate inline,
so the law fires on either path. Ignition seeds natively (the goal from the manifest,
one bootstrap task per active slot); the Paperclip passthrough fields degrade to null;
the activation screen renders the honest disabled handoff state.

**The surface.** Views gained **Work**: goals with counted done/total meters, the task
ladder in labeled status tones (the dot and the printed word travel together), the
review queue rendering deliverable output verbatim with Approve / Request changes, and
the cycle trigger that says "serially" because it is. Agent and department nodes
gained **Queue** — the desk's slice of the store, rendered only once seeded. The 503
gate is a first-class state with a Seed affordance, never an error screen.

**Tests without a model.** The orchestrator suites and the work e2e run the REAL spawn
path against a fixture bin whose first line declares itself canned — execution never
fakes output, even in tests. A default e2e run skips the work spec entirely rather
than spawn a real model.

**P2, named:** db graduation of `work.json`; request-id token attribution + parallel
cycles; the labeled T2 verifier; scheduled cycles; composer topics over the work
store; activation-screen relabel; `packages/core` removal. Two conditional entries,
recorded with their triggers:

- **Wheel geometry fallback:** `petalPath` stays hand-rolled while the wheel is one
  ring of equal petals; if the wheel ever grows nested rings (departments with
  petal-children) or unequal spans (petals weighted by size or gravity), swap to
  `d3.arc()` (`d3-shape`, MIT) — inner/outer radius, pad-angle gaps, and corner
  rounding are its native parameter space, and hand trig stops scaling there. The
  trigger is topology growth, never "correctness": the current wheel emits a real
  SVG path, not a sampled polygon.
- **Walk trace over SSE:** replace the trace's poll-and-replay loop with native
  `EventSource` on the per-hop emit the backend half already specifies — hops
  stream as the organization actually takes them instead of being re-enacted on a
  timer. Native only; no client SSE library (reconnect needs are trivial, and the
  no-new-runtime-deps rule holds).

## Revision 7 — the density gradient

**The law.** Density is earned by interaction: every click is consent to more
complexity. Depth in the organization and depth of detail are the SAME axis — the
system is exactly as complex as the operator's curiosity. Each level has a density
budget, and the budget is law: a feature that cannot fit a level's budget belongs one
level deeper, never squeezed in.

| Level | You are | Budget |
|---|---|---|
| **L0 — at rest** | on the watch face | the wheel · ONE caption line (the objective — the compass earns the line) · the whisper rail · the hub row of sub-dials · ONE attention signal (needs-you count on Work, absent at zero). Nothing else may render here, ever. |
| **L1 — one step in** | at a desk or inside a lens | full masthead (identity, snapshot, health-if-deviating, completeness) + the ONE primary instrument: a desk's operational strata (Currently doing, Queue), a lens's actionable core (Work: command line + review queue) |
| **L2 — a stratum opened** | inside a section | counted lines become rows: the folded strata (Reports, Relationships, History, Learned), the folded ladder groups (todo backlog, delivered tail) |
| **L3 — full detail** | at the record | verbatim deliverable output unrolled, full lists |

**One object at a time.** A lens open REPLACES the wheel — never two heroes stacked.
The rail is chrome and position-stable: plain text at L0 (no pill material), a
segmented control at L1. The screen zones are fixed everywhere: masthead → rail →
instrument → shelf; only the instrument changes.

**Exception-based rendering.** Nominal is silence: the health chip exists only for
*at risk* / *critical* (healthy prints nothing); the attention count is absent at
zero; idle is a resting petal, not a status line. The honesty law survives because
absence-when-nominal IS the honest signal at rest — the full statements still exist
one level down. Corollary in the ladder: exception groups (running, awaiting you,
broken) arrive open; nominal groups (todo backlog, delivered tail) arrive folded
with counts.

**Operational vs accumulated empties.** Operational truths render even when empty
("Idle right now", "Nothing queued") — their emptiness is live information.
Accumulated records (relationships, history, memory) are SILENT at zero and appear
as counted strata once they exist — absence is their default state, not a fact
worth a labeled section. The Constitution's unwritten categories collapse to one
ghost line naming the empty slots.

**One address per fact per screen.** The objective lives under the wheel at L0 and
fuses into the Work lens's goal meter when that lens is open; the morning card hands
trajectory to the wheel and keeps only the greeting and what needs a decision; the
Constitution chip died — the wheel's center is that door; the snapshot line died at
L0 — the wheel says it.

**Relocations.** Capability chips are prompts → they render in the composer, beside
where questions are typed (c-grav excluded: Gravity is a lens, not a question a walk
can answer). The board and pins → a shelf below the pane: ephemera rest low. The
company's non-petal children (the CEO desk, the instruments) → the hub row of
sub-dial medallions under the face — complications, glanceable, one tap in.

**The Work descent.** Attention count (L0) → clamped review card, first lines
verbatim (L1) → folded ladder groups expand (L2) → full output unrolls (L3). Three
consents between a number on the watch face and the raw record — the same path as
walking into the organization.

## Revision 8 — the desk

**A work node's L1 body, recreated from the desk mockup on real data.** Anatomy:

- **Masthead**: medallion · display title · kind pill · role copy (`description` — a
  new OrgNode field: INTERFACE TEXT keyed by the slot's template division, curated
  once in the node service, never authored per company, never model-generated;
  null hides the line) · the mechanical snapshot · a status strip of counted facts
  (N running, last decision age), absent at zero. Health prints only on deviation
  (Rev 7 stands).
- **The reporting structure**: a compact tree of this node and its reports, drawn
  from children data alone — chips tinted by identity hue, click descends, View Org
  ascends to the wheel. Replaces the desk's folded Reports stratum.
- **Currently-Working hero**: the in_progress task — title, brief line, started
  time, `waiting on <slot>` chips from unmet dependencies, attempt N of M, and the
  org-wide 12-day run-cadence sparkline (counted, labeled). Idle desks say so and
  name the next queued task; an unseeded runtime says exactly that.
- **Working-On rows**: the desk's open tasks, rich — title + brief excerpt, status
  pill, waits-on, attempts, assignee, updated age. "View all work →" exits to the
  company Work lens (a navigation intent that survives the view reset).
- **Sidebar of counted previews** (an amendment to Rev 7's folded strata, desks
  only): Recent activity (the desk's run-log events merged with its walk hops,
  newest first), Memory, Artifacts (this desk's deliverables with review tone) —
  top rows + a count, each exiting to its lens. Accumulated records still vanish
  at zero; operational cards still render their empties.

**Revision 9 — the runtime tray, in brief.** Interaction rule 2 gains its single named
exception (recorded in `INTERACTION_SPEC.md`): one transient, read-only overlay at the
Popover layer. Contents are counted store state only: in_progress tasks ("Running ·" —
the state word, never a conjugated string), the next cycle's REAL pick order (the
server's ready predicate mirrored, capped at five, labeled), recent terminal events
(human-phrased, each a logged event), and live walk hops. Rejected from the source
prompt: the permanent corner dock (it would duplicate the walk trace — one address per
fact), the dark-glass tokens (translated to the light system), and the workspace
panel-assembly feed (composition doesn't stream yet; wire it when it does).

**What the mockup drew that Rev 8 refuses**: fabricated progress percentages (a
ring binds to counted ratios or doesn't render), fictional humans with photos
(slots wear medallions), invented "thought" counts (attempts, deliverables, and
hops are the real counts), a printed "Healthy" pill (nominal is silence), and the
Filters/Customize bar (filtering is what the descent and the composer are for).

## Thesis

Every object the interface shows — a department, a project, an agent, a deliverable, a
metric, a decision, a single piece of evidence — is the same kind of thing: a **node**
with a name, a one-line current-state summary, independent signals (activity, health,
momentum), an objective, accumulated memory, a capability list, and children. The layout
is the shipped one: **conversation in the fixed left panel, the canvas on the right**.
The canvas's active workspace is always some node's workspace, rendered through the cell
grammar — the node is the subject; cells are its manifestation.

Getting an answer is **delegation, not drill-down** — and delegation is executive, not
retrieval: a walk may answer, refer, convene, or cite precedent. The flywheel is how the
operator perceives organizational health and momentum at rest. The Constitution is the
organization's identity and law, and its gate runs server-side before any side-effecting
action.

## §0 Ground truth — backing stores (discovery, answered)

Stack: Fastify (`packages/wavex-os-server`), React canvas
(`packages/onboarding-ui/src/canvas/`), the native work runtime
(`src/work/{store,engine,cycle}.ts` served by `routes/work.ts` +
`routes/runtime-native.ts` — Rev 6; the Paperclip adapter is gone). **No parallel org
tables** — nodes adapt existing stores:

| Node kind | Backing store |
|---|---|
| company | company.manifest.json + pillar_responses |
| department / team | swarm_manifest tree (reports_to) |
| agent | resolved slots (+ native task assignment by slot — Rev 6) |
| project / goal + tasks | the native work store (`work.json`) — Rev 6 |
| deliverable | native deliverables: engine output verbatim + review state — Rev 6 |
| metric | catalog read bindings (token-usage, kpis, costs, dashboard) |
| decision | canvas ledger + deliverable reviews |
| evidence | activity events, the work run log, feedback traces |

**Adaptive-layer backing (Rev 4) — all observed, none invented:**

| New concept | Derived from |
|---|---|
| memory | distillation over InvestigationSteps + ledger + activity, every claim cited |
| objectives | manifest goal + native work goals (Rev 6) |
| influence | issue `blockedBy`/`blocks` + `blockerAttention`, approval routing, walk history |
| gravity | walk-landing frequency, delegation in-degree, dependency in-degree, approval concentration |
| momentum | headline-snapshot deltas (already captured), queue/blocker count deltas, run cadence |

Already shipped and reused: glass + reduced-transparency fallbacks; the board (receding
parents); drill-as-conversation; FLIP morph identity; SSE precedent; commit allowlist +
proposal→confirm; house auth (one guard, actor forwarded, `COMPANY_ID_RE`).

## §1 Render-only data discipline

Truth arrives precomputed: health, activity, momentum, completeness, gravity, memory,
influence edges, capabilities, walk decisions, constitution verdicts. The frontend never
derives a truth-value; it may do presentation arithmetic on delivered data. **Nothing the
frontend computes may change what is true — only how it reads.**

## §2 Interaction rules

1. **One conversational input, always present, scoped to the active node** (scope chip:
   `asking: Campaign A ✕`; cleared = company root).
2. **Walking replaces the view.** One workspace at a time; back restores the parent
   exactly. Never a modal, never a stacked panel. Walking is conversation given a body —
   every hop is a transcript turn; a manual walk-in is the same walk done by hand; the
   child's cell travels into becoming the workspace (FLIP morph rule).
3. **Capabilities are the node's affordances** — backend-supplied, context-aware (§6),
   revealed on hover/selection as drill chips, never a global button bar. Reads send
   conversation; side effects resolve to proposal → confirm.
4. **Delegation renders as a trace**, one hop at a time, landing node becomes the
   workspace, trace persists above it.
5. **The Constitution is one fixed, singular node** (renamed from Rev 2's "Mission
   Control" over the repo name collision; the legacy dashboard's fate remains the
   phase-10 gate).
6. **No forms, no settings screens, no dropdowns, no modals.** Law, unchanged.

## §3 The node

```ts
interface OrgNode {
  id: string;
  kind: 'company' | 'department' | 'team' | 'project' | 'agent' | 'deliverable'
      | 'metric' | 'decision' | 'evidence' | string;   // open set
  title: string;                     // shown at rest; nothing else is
  snapshot: string;                  // one-line current state (hover/selection)
  activity: 'active' | 'idle';       // working RIGHT NOW — read live, never cached
  health: 'ok' | 'at_risk' | 'critical' | null;        // wellness, independent of activity
  momentum: 'rising' | 'steady' | 'falling' | null;    // trend of signals; null cold-start
  completeness: number | null;       // blueprint coverage; null where none applies
  gravity: number | null;            // 0–100 organizational pull; null until volume (§8)
  objective: {                       // what this node is trying to accomplish (goals tree)
    title: string;
    status: 'on_track' | 'blocked' | 'achieved' | 'unknown';
    blockedBy: string[];             // node ids, from the observed dependency graph
  } | null;
  parentId: string | null;
  createdAt: string;
  updatedAt: string;
}
```

Two-signals rule (Rev 3's fix, kept): `activity` and `health` never merge; a node may
glow while critical. Momentum is a third independent signal — an enum with evidence,
never a probability. Children are universal `{id, kind, title}` refs, lazy-loaded; a leaf
returns an empty list. Living folders are just nodes whose children are grouping nodes.

**Full node detail** (`GET nodes/:id`) additionally carries `children`, `capabilities`,
`memory: MemoryEntry[]` (§4), and `influence: InfluenceEdge[]` (§7).

**Grammar integration:** a node's workspace is a `LayoutSpec`; node kinds map to intents;
capabilities are drills; memory renders through the `memory` primitive, objectives
through `progress`/`goal`, recommendations through `recommendation`.

## §4 Memory — state is what is; memory is what was learned

Selecting Marketing should not only say *healthy, active* — it should say *"launches
slip when Creative waits on Product"*, and that line must be earned:

```ts
interface MemoryEntry {
  id: string;
  nodeId: string;
  claim: string;                     // authored distillation — renders violet, as interpretation
  citations: Array<{ kind: 'walk' | 'ledger' | 'activity' | 'issue'; id: string }>;
  derivedAt: string;
  supersededBy: string | null;       // memory revises; it never silently deletes
}
```

Rules: **every claim cites the walks, decisions, or events that ground it** — a memory
entry with no citations is invalid at write time. Claims are qualitative distillations;
a numeric claim ("underestimates QA by 18%") is only permitted when the cited evidence
actually computes it. Memory is written by a distillation pass (post-walk and periodic),
retrieved into walk prompts (§5) and capability suggestion (§6), and rendered under
authored rules. The transcript/ledger remain the substrate; memory is the index, not the
archive.

## §5 The delegation walk — executive, not retrieval

Given `(nodeId, question, sessionId)`, each hop the model sees: the node's identity +
snapshot + objective, its children refs, **relevant memory entries and precedent walks**,
and the question (reformulation allowed per hop). It returns one of:

| decision | meaning | renders as |
|---|---|---|
| `answer` | this node holds the evidence | landing workspace + authored answer (violet); numbers come from bound cells |
| `delegate` | walk to `childId` with a (re)formulated question | one trace hop, streamed immediately |
| `refer` | outside my subtree — names the node that should investigate (`Legal`) | recommendation cell; one click starts that walk (a new turn) |
| `convene` | needs multiple nodes (`Engineering + Product`) | recommendation cell listing participants; acting on it is proposal-gated |
| `precedent` | already solved / previously learned — cites MemoryEntry or walk id | answer + "picking up from…" continuity, citation rendered |

Each hop persists an `InvestigationStep` and emits on the stream immediately (SSE — the
same transport as streamed composition; one streaming mechanism in the product). Depth
cap 8; hitting the cap returns the deepest node's best-effort answer — partial beats
dead end. Walk answers are authored content: violet treatment, cited, numbers only from
bound cells.

## §6 Capabilities — context-aware affordances

Capabilities = static rules table by kind ∪ LLM-suggested for this node's current
content **and the active investigation context** — investigating churn at Marketing
surfaces `Compare churn campaigns` / `Interview Support`, not the resting list. The
suggestion prompt receives: node content, memory entries, the current walk/session
context. Trust boundary unchanged and absolute: **an `llm_suggested` capability's
invocation must resolve to a catalog-validated endpoint or a commit-allowlist action —
the model proposes affordances, never mints executables.** `source` records provenance.
Side-effecting capabilities flow proposal → confirm; invocations stream like walks and
are idempotent on retry.

## §7 Influence — the graph under the tree

```ts
interface InfluenceEdge {
  from: string; to: string;          // node ids
  kind: 'depends_on' | 'blocks' | 'approves' | 'asks';
  weight: number;                    // observation count, time-decayed
  lastObservedAt: string;
  evidence: { source: 'issue_dependency' | 'approval_routing' | 'walk_history'; count: number };
}
```

**Derivation, never declaration:** edges are computed from issue `blockedBy`/`blocks`
(dependency), approval routing (veto/approve structure), and walk history (who actually
asks whom). A model never asserts an influence edge; the Constitution may *declare* rules
("Legal reviews all external sends") but those live as constitution content feeding the
gate, not as fabricated graph edges. Influence renders on the flywheel as faint arcs
between segments (hover reveals the evidence counts) and feeds the walk engine's `refer`
decisions.

## §8 Gravity — where the organization actually bends

The invisible score made visible, computed entirely from observed behavior:

```
gravity(node) = f( inbound walk hops, walk landings (evidence lives here),
                   dependency in-degree, approval-routing concentration,
                   memory accumulation rate )
```

High gravity = everyone asks this node, everything depends on it, decisions bottleneck
here. This is how "Engineering isn't overloaded by tasks — everyone routes decisions
through one architect" becomes visible: the *agent* node's gravity outweighs its
department's. Backend-computed on read, `null` until observation volume crosses a
threshold — an honest null, never a fake score. Renders as visual weight on the flywheel
and a `Can Show Gravity` capability at the company node (a breakdown cell of the
highest-pull nodes with their evidence).

## §9 Flywheel — health, momentum, and pull at rest

Departments radial around the Constitution. Independent signals, never merged:
**fill** = completeness (rendered under the backend's label, never "onboarding
progress"); **breathe** = activity, only while an agent under the segment is actually
running; **drift/tempo** = momentum — a rising segment leans in with quickened breath, a
falling one dims and slows; **visual weight** = gravity; **faint arcs** = influence
edges. Hover reveals a floating snapshot card whose momentum line always shows its
evidence — *"blocked issues 2→5 this week; run cadence −40%"* — never an invented
probability. When a true forecast is wanted, the honest path exists: a simulation
capability (the Monte Carlo precedent) whose distribution earns its percentage.

At rest a segment shows its title only. Selecting a low-completeness segment opens a
short scoped line of questioning in the composer — resuming a conversation, not a form.
The morning moment stays in the left thread; the flywheel is the right pane's rest state.

## §10 The Constitution — identity, then law

Two layers, one node, fixed schema:

- **Identity (new, Rev 4):** `identity_mission` (why we exist), `optimization_priorities`
  (what we optimize, in order), `pace_rules` (when we move slowly / take risks),
  `never_sacrifice` (what is never traded away).
- **Law (Rev 2/3, kept):** global goals, budgets and constraints, approval thresholds,
  risk tolerance, brand voice, compliance rules, agent permissions, working hours,
  escalation paths, success definitions.

**Identity must be load-bearing or it is an About page:** identity categories are
injected into walk prompts, capability suggestion, and `checkConstitution`'s reasoning —
a `never_sacrifice` entry is a hard gate input, `optimization_priorities` order tie-break
recommendations. The gate itself is unchanged from Rev 3: `checkConstitution(action)`
runs before every side-effecting execution (allowlist actions, capability invocations,
walk-proposed actions), composed with — never replacing — proposal → confirm → ledger.
Edits to any category, identity included, are conversational diff proposals routed to
that category's node. No settings-form path exists.

## §11 Visual language, motion (unchanged from Rev 3, plus momentum)

Shipped semantic tokens stay (the Rev 2 token fork remains rejected — see the Rev 3
record). Activity glow = `--live` teal; violet remains the mind's authorship mark; health
states = `--good`/`--attend`/`--crit`. Three glass weights by permanence (solid =
Constitution, standard = working nodes, fluid = deliverable parts/evidence/walk bottoms);
receding parents step down one weight; glass only on node-panel containers.
Reduced-transparency and no-blur fallbacks already shipped.

Motion: breathing only on real activity; walking forward/back are directional inverses
(direction is information); trace steps append one at a time; FLIP morph on walk-in;
momentum drift is slow and subtle (minutes-scale interpolation, not animation flourish);
reduced-motion collapses everything via the global rule.

---

# Backend half

**Data model:** `OrgNode` (§3), `NodeChildRef`, `Capability` (+ context-aware suggestion
inputs), `ConstitutionCategory` (identity + law ids, content, updatedByWalkId),
`InvestigationSession`/`InvestigationStep` (decision now:
`answered|delegated|referred|convened|precedent`), **`MemoryEntry`** (§4, citations
required at write), **`InfluenceEdge`** (§7, evidence required). Momentum and gravity are
computed columns/views, not authored rows.

**Node service.** Activity live on every read; health from run outcomes/blockers;
completeness = blueprint ratio; momentum from snapshot/queue/blocker deltas; gravity per
§8 with the volume threshold; objective joined from the goals tree + dependency graph.

**Memory service.** Distillation pass (post-walk + periodic) writes cited entries;
rejects uncited claims; supersedes instead of deleting; retrieval API feeds walks and
suggestions (top-k by node + recency + citation overlap with the question).

**Walk engine.** §5's five-decision vocabulary; memory + precedent retrieval in the hop
prompt; step persisted + emitted per hop; depth cap 8 with best-effort terminal;
`refer`/`convene` produce recommendation payloads (never auto-execute).

**Influence + gravity jobs.** Periodic derivation from the three observed sources;
time-decay on weights; both exposed read-only.

**Constitution service + gate.** Identity + law categories; `checkConstitution` wired
into every side-effecting path (allowlist execution, capability invocation, walk-proposed
actions); identity categories injected into walk/suggestion prompts. Grep every
agent-action call site; none bypass the gate.

**API surface** (house pattern `/api/instance/:companyId/…`, house guard, SSE per the
replay-on-connect precedent):

- `GET  …/org/flywheel` → `{ departments: OrgNode[], constitution: OrgNode, influence: InfluenceEdge[] }`
- `GET  …/org/nodes/:id` → `OrgNode & { children, capabilities, memory, influence }`
- `POST …/org/nodes/:id/ask` → `202 { walkId }`; steps + terminal over `GET …/org/walks/:walkId/events`
- `GET  …/org/constitution` → `ConstitutionCategory[]` · `POST …/org/constitution/:categoryId/ask`
- `POST …/org/nodes/:id/capabilities/:capabilityId/invoke` → `202 { invocationId }` + SSE
- `GET  …/org/investigations/recent?sessionId=` → `InvestigationStep[]`
- `GET  …/org/gravity` → ranked nodes with evidence breakdown (null-safe pre-threshold)

**Execution order** (memory is the foundation; cheap wins next):

1. Schema/store adapters per §0; new tables: constitution categories, investigation
   sessions/steps, memory entries, influence edges.
2. Node service v1 (activity/health/completeness/objective — objective is nearly free on
   the goals tree) + tests.
3. Walk engine with the five-decision vocabulary + SSE + depth-cap tests (one-hop,
   cap bottom-out, refer, precedent-with-citation).
4. **Memory service** — distillation, citation enforcement (uncited write rejected),
   retrieval into walk prompts; test: a precedent decision cites a real entry.
5. Gravity + influence derivation jobs (walk logs exist from step 3 onward); volume
   threshold honored; `…/org/gravity` route.
6. Momentum computation from snapshot deltas + queue/blocker deltas.
7. Constitution service (identity + law) + `checkConstitution` gate into every
   side-effecting path; test: a rejection blocks execution; identity injection visible
   in walk prompts.
8. Capability execution (context-aware suggestion, idempotency-on-retry test).
9. Frontend: scope chip, walk trace, flywheel (fill/breathe/drift/weight/arcs),
   receding weights, Constitution view, memory + recommendation cells — each phase
   against the shipped harness (seeded northwind + screenshot rounds; the fake-Paperclip
   half of the harness is historical — Rev 6 replaced it with the fixture engine).

## §12 Reconciliation record

**Rev 2 → Rev 3** (kept for the record): supersession of "one input, zero navigation"
adopted as walking-is-conversation; token fork rejected (roles mapped); activity glow
amended to `--live`; `health:'active'|'idle'` split into activity + health; "Mission
Control" renamed the Constitution; three glass weights adopted; parent-recede = the
board upgraded; walk engine/depth cap/partial answers adopted verbatim; `checkConstitution`
composed with allowlist + proposal→confirm; discovery answered with the §0 mapping.

**Rev 3 → Rev 4 (the critique, resolved):**

| # | Critique | Resolution |
|---|---|---|
| 1 | memory, not just state | **Adopted** — cited distillations (§4); uncited claims rejected at write; numeric claims only where evidence computes them |
| 2 | walks should recommend, not just answer | **Adopted** — five-decision vocabulary (§5): refer / convene / precedent join answer / delegate |
| 3 | influence graphs, not trees | **Adopted, derivation-only** (§7) — observed from issue dependencies, approval routing, walk history; never model-declared |
| 4 | nodes own objectives | **Adopted** — backed by the existing goals tree; nearly free |
| 5 | confidence field | **Rejected** — it is completeness rediscovered plus an invented number; specific claims render data-carried uncertainty; the honest gap primitive is `unknown` |
| 6 | predictive flywheel ("82% in six days") | **Amended to momentum** (§9) — enum + evidence from real deltas; a percentage is earned only by simulation (Monte Carlo precedent) |
| 7 | capabilities evolve with context | **Adopted** (§6) — suggestion pass receives investigation context + memory; trust boundary unchanged |
| 8 | Constitution as identity/DNA | **Adopted with the load-bearing condition** (§10) — identity categories feed walk prompts, suggestions, and the gate, or they don't ship |
| 9 | the organization learns | **Adopted as the compounding of 1+2+3** — distill, retrieve, precedent; the transcript stays the substrate |
| 10 | organizational gravity | **Adopted enthusiastically** (§8) — fully computable from observed behavior; honest null before volume |
| — | principle 4 "redistribute work" | **Amended** — structural changes are recommendations through proposal → confirm → ledger; the org never restructures itself silently |

**Rev 4 → Rev 5 (the Organizational-OS prompt, resolved):**

| Prompt concept | Resolution |
|---|---|
| Six-layer persistent hierarchy | **Adopted + amended** — instruments (metric nodes) belong to the Organization layer; L2/L5 confirmed backed by runtime reads (O2), L3 per-issue (O3) |
| "Home is the organization" | **Adopted** — the resting-state inversion; the collapsed-workspace placeholder removed |
| Views under Organization | **Adopted** — Investigations / Learned / Gravity / Constitution, all measured |
| Persistent navigated / ephemeral generated | **Adopted as law** — it names the shipped split |
| Promotion (ephemeral → approved → persistent) | **Adopted as a ladder** — memory rung shipped; object rung gated on allowlist growth |
| Flywheel as compression (unfold) | **Adopted** — petal ⇄ node view shared-element continuity, reduced-motion floor |
| Campaigns A/B/C, Sarah/Emma personas, sample percentages | **Rejected as content** — fixtures of the idea, not data; every section renders real rows or an honest empty state |
| "Nothing scrolls" | **Amended to restraint** — the pane scrolls when real content demands it |

**Rev 5 → Rev 6 (the pivot, resolved):**

| Decision / concern | Resolution |
|---|---|
| "The backend being Paperclip is out the door" | **Executed** — detect, handoff, and the read adapter deleted; `packages/core` inert in-tree, removal named P2 |
| Five consumers of the runtime reads | **Zero frontend churn** — same paths, envelopes, field names, and 503 vocabulary, re-served from the native work store |
| "I deploy the agents on your subscription" | **Adopted, local-first** — the engine spawns the operator's own bin (OAuth in dev, API key in prod); hosted puppeting of consumer subscriptions rejected on ToS grounds |
| QA gates verifying work against purpose | **Laddered** — structural checks + operator review shipped; the T2 verifier is P2 and will be LABELED, never silent self-grading |
| "A loop that never gives up" | **Bounded and visible** — feedback-folding requeue; the attempt ceiling escalates to the operator instead of spinning; a budget stop burns no attempt |
| Autonomous parallel execution | **Deferred honestly** — serial while token attribution is time-window based; parallelism arrives with request-id attribution (P2) |
| O2/O3 (grow L2/L5 through Paperclip reads) | **Dead as a path, alive as intent** — goals/tasks/deliverables landed natively through the same governance gate |
| Testing an execution engine without a model | **The fixture engine** — the real spawn path against a canned bin whose first line declares itself canned; output is never faked silently, even in tests |

**Rev 6 → Rev 7 (the density gradient, resolved):**

| Direction | Resolution |
|---|---|
| "The starting screen must be the most minimalist" | **Adopted as law** — L0 budget: wheel + one caption + whisper rail + hub row + one attention signal; nothing else may render at rest |
| "Every level after grows in complexity" | **Adopted as the four-level descent** with per-level budgets; org depth and detail depth unified into one axis |
| Ten look-alike pills in two rows | **Dissolved** — capabilities to the composer (they are prompts), views to the rail (they are modes), Constitution chip removed (the center is the door) |
| Two heroes stacked (wheel + open view) | **Replaced** — a lens takes the pane; the wheel yields; zones fixed: masthead → rail → instrument → shelf |
| "healthy" pill everywhere | **Exception-based rendering** — nominal is silence; deviations get the ink; full statements remain one level down |
| Honest empties vs visual weight | **Split by kind** — operational empties always render (live information); accumulated records silent at zero, counted strata after |
| Same fact twice on one screen | **One address per fact** — objective/trajectory/snapshot deduped by giving each a single home per level |
| Sub-dial complications for the instruments | **Adopted under the face** (rim placement deferred) — tiny medallions: the CEO desk + the metric family, glanceable, one tap in |

**Rev 7 → Rev 8 (the desk mockup, resolved):**

| Mockup element | Resolution |
|---|---|
| Role description under the title | **Adopted as interface text** — division-keyed copy in the node service; a new nullable `description` on OrgNode; never per-company, never generated |
| Mini org chart in the masthead | **Adopted** — children data alone; replaces the desk's folded Reports stratum |
| Currently-Working hero with started/waiting chips | **Adopted** — in_progress task + unmet-dependency slots (real, first surfacing of dependsOn) |
| 42% progress ring | **Rejected** — no per-task percent exists; rings bind to counted ratios or don't render |
| "Emma" + photo avatars | **Rejected** — slots wear their medallions; the fleet is agents, not fictional humans |
| "12 thoughts" counts | **Rejected as drawn** — the real counts are attempts, deliverables, feedback notes, hops |
| Thinking / Memory / Artifacts sidebar | **Adopted as counted previews** — desk-scoped run events + walk hops, node memory, desk deliverables; each exits to its lens (a desk-only amendment to Rev 7's folded strata) |
| Printed "Healthy" pill · Filters/Customize bar | **Rejected** — nominal is silence; filtering is the descent's job |
