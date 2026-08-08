# The execution model — workflows, not agents

> WaveX orchestrates dynamic workflows, not predefined agents. Agents are an
> implementation detail. Workflows are the execution model. Deliverables are
> the user interface. Knowledge is long-term memory. Templates are an emergent
> optimization — not a starting assumption.

Execution phases: `Research → Discovery → Refinement → Action → Feedback → Reactivation`.

## Provenance, stated plainly

This ruling arrived in conversation with the operator. The onboarding spec
(`onboarding-spec-2.md`) cites `execution-engine-spec.md` three times — for
"research is structurally harder than planning", for
"frontend-shows-workflow-phases-never-agents", and for the deferred
departments-vs-loops question — and **that document does not exist on this
machine**. The repo, `~/Downloads`, and a full-text search were all checked.

So the three rulings this file encodes rest on the operator's own statement
plus the paraphrase inside the onboarding spec. If `execution-engine-spec.md`
surfaces, it arbitrates and this file yields to it.

## The line the UI holds

> An agent may be the internal **grouping key** of a fact. It may never be a
> thing the operator sees.

Concretely, as shipped:

| Surface | Before | Now |
|---|---|---|
| Work lens rows | task title + `Cpo.build` + status word | the **deliverable**, in present continuous while running |
| Work lens groups | task status (`todo`, `running`, …) | the **department**, with counted `done/total` |
| Review card summary | "34 agents, 4 KPIs, one goal" | "9 deliverables across 6 departments, 4 KPIs, one goal" |
| Review Departments | `cpo 5 · cmo 5 · …` | `cpo · cmo · …` — the categories, named |
| Review "Timeline" | a list of cadences | **"Workflows"** — they are recurring cycles, not a schedule |
| Wheel petals (Phase 3, Birth) | `5 agents planned` | the department's **real cycle** (`24h insight activation`) |
| Birth `petals` stage | every petal overwritten to `"waking"` | the real cycles, left alone — that *is* workflows activating |
| Deliverable review card | `attempt 1 of 3 · Cpo.build` | `attempt 1 of 3 · Cpo` |

Two rules that fall out of it:

- **Progress is counted, never a percentage.** `done/total` is real store
  state. A per-deliverable `72%` would be a fabricated metric, which
  `CELL_GRAMMAR.md` invariant 2 forbids. Add one only when the runtime
  actually reports it.
- **Present continuous only while running.** `activeForm` ("Writing the MVP
  product spec") shows in flight; `deliverable` shows pending and settled.
  That is the `content`/`activeForm` pair from the dynamic-workflow-panel
  contract, seeded server-side in `work/seed.ts`.

Where the fleet size still lives: the signed manifest and token accounting.
It left the operator NARRATIVE, not the record — cost is adjudicated where
cost is decided.

## The honest gap

**The UI now presents workflows over an engine that is still
template-selection.**

`vendor/wavex-os/onboarding/src/phases/phase-3-swarm/` selects from a frozen
33-agent `BASE_ROSTER` via a decision matrix, with per-role skill templates.
That is precisely the "select agents from a repository" model the ruling
abandons — and it lives under `vendor/wavex-os/**`, which `CLAUDE.md` marks
frozen with an instruction to stop and surface rather than modify.

So this refactor changed what the operator sees and what the plan can grow
(research inserts real build steps that become real tasks), but it did **not**
change how the fleet is chosen. Nobody should read the new UI as evidence the
engine was replaced.

## The separate program

Scoped, not started. In dependency order:

1. **Dynamic orchestrator.** Replace roster selection with an engine that
   constructs the execution path for a goal. The seam already exists:
   `packages/wavex-os-server/src/research/` is deliberately outside `routes/`
   so the work runtime can call `runResearch()` as its own first phase — the
   onboarding Phase 3 research step is that phase's first instance.
2. **Reactivation.** The work runtime already does Action → Feedback →
   Requeue. What it lacks is the orchestrator evaluating results and trying
   another strategy when progress stalls, rather than exhausting attempts.
3. **Emergent templates.** Measure which orchestration patterns produce better
   outcomes, and crystallize only the repeatedly-successful ones. Templates
   become an output.
4. **Knowledge accretion.** Classify results by the content they produce so
   categories emerge from successful work instead of being designed up front.

Steps 1 and 3 both require modifying or replacing the frozen vendored
pipeline, which needs explicit operator sign-off per `CLAUDE.md`.

## What is deliberately unresolved

Whether the flywheel should eventually represent **loops** rather than
**departments**. The onboarding spec flags this as open and declines to decide
it; this repo keeps the department ring (`RECURSIVE_ORG_SPEC.md` §9) until it
is settled on purpose. Note that the operator's own example groups work under
"Marketing" — an organizational category — so departments-as-categories is
consistent with the ruling as stated, and nothing here forecloses the change.
