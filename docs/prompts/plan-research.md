# Plan research

**Purpose** — Discover what is newly possible for one specific company, before
any plan exists. This is the execution engine's `Research` phase
(`Research → Discovery → Refinement → Action → Feedback → Reactivation`),
prototyped inside onboarding's Phase 3.

**Caller** — `packages/wavex-os-server/src/research/run.ts` → `runResearch()`,
invoked by `routes/plan-assembly.ts` when `POST …/plan-assembly/start` runs with
research enabled (the default).

**Pool** — T2. `agent_id: onboarding.plan.research`,
`creativity_required: true`, `reasoning_depth: "deep"`, `priority: "high"`,
`timeout_ms: 150_000`. Accounted under `PhaseKey: "research"`.

**Prompt body** — `packages/wavex-os-server/src/research/prompt.ts`. It is code,
not a template, because the context block and the `signals[]` vocabulary are
generated from the same source and must not drift: `allowedSignals()` derives
the closed vocabulary from exactly the keys `buildResearchPrompt()` emitted, and
the parser drops any signal outside it.

## Why this call gets the fullest context

Research is structurally harder than planning and only has real impact where
the whole picture already lives, so it is deliberately **not** delegated to a
narrow specialist. It receives all five pillars, the connector manifest **with
live statuses**, and the scope record.

Connector *status* is load-bearing, not decoration: "Stripe is suggested" and
"Stripe is wired" are the difference between a fantasy and a capability.
Pillar 2 is included for the same reason — what is newly possible depends
partly on how much inference this operator actually has to spend.

## What it is never shown

The build chain is supplied as **addresses only** — step ids and titles, never
deliverables. Handing research the gap it is supposed to be discovering around
turns discovery into critique, which is the one failure the spec calls out by
name ("not interpolating from a known gap yet").

## Two enforced properties

1. **Research precedes planning in the output itself.** The response has two
   top-level keys with `findings` first, so the model must write every finding
   before it reaches `attachments`. The ordering is a property of the token
   stream rather than an instruction we hope was followed.

2. **Findings may not restate the operator.** `parse.ts` measures each headline
   against the operator's own prose (`company_context`,
   `differentiator_hypothesis`, `primary_friction_hypothesis`,
   `ideal_customer_profile`) using bigram **containment** — asymmetric, because
   the question is "has this already been said", not "are these alike" — and
   drops anything at or above 0.7. The threshold is deliberately permissive: a
   false negative lets one derivative finding through, while a false positive
   silently eats the best finding research produced.

## Blast radius

A finding may attach a delta, and a delta may only touch the **build chain** —
the one artifact plan assembly owns rather than mirrors from a frozen manifest.
Departments, KPIs, the goal, and operating/bundle rows are projections; letting
research rewrite them would make the reviewed plan diverge from the manifest
that actually activates, and would grow the flywheel, which the spec forbids.

Applied deltas become real `ChecklistItem`s with `origin: "research"`, which
`work/seed.ts` turns into real tasks with real dependency edges. Different
research therefore causes different work to actually get done.

## Degradation

Never fatal, ever. A T2 error is `failed`, a budget exhaustion or a router
deferral is `skipped`, and prose instead of JSON is `ready` with zero findings.
All three settle the four deterministic steps unchanged — the deterministic
plan is the spine, and research either enriches it or does not.
