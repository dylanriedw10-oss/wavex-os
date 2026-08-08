# Onboarding Review — Plan-First Architecture Audit

**Status:** intermediate artifact. This is the audit; it is not the spec. A
subsequent pass takes what this produces and edits the spec, the same way
`execution-engine-spec.md` fed the last round of edits. This document records
judgments and evidence; it changes no code and no spec.

**That pass has run:** the base was `~/Downloads/onboarding-spec-2.md` (the
current spec, and this audit's ground truth) and the output is
`~/Downloads/onboarding-spec-3.md`, forked per the Downloads convention with
v2 left intact beside it. Read the two side by side and the diff is this
audit's ranked changes, one hunk at a time.

**The standard applied throughout:** onboarding's output is an execution plan
— a fixed goal, fixed KPIs, and a revisable checklist that the self-prompting
loop executes, measures, and revises. Agents are an implementation detail of
executing that plan. Every question costs executive attention and must earn
its place by materially improving the plan. Prefer inference and discovery
over asking. A question whose answer populates no `OnboardingState` field is
evidence the question doesn't belong — not a gap in the data model to patch.

---

## 0 · Ground truth

Read, in order:

1. `~/Downloads/onboarding-spec-2.md` — the five phases, two entry paths, the
   flywheel-grows mechanic, the self-prompting loop, and the
   `OnboardingState` data model this audit's output must fit.
2. **`execution-engine-spec.md` — does not exist on this machine.** The repo,
   `~/Downloads`, and a full-disk search were checked. Its three cited
   rulings survive as: (a) the operator's directly-stated execution model
   (workflows not agents; deliverables are the UI; templates are emergent,
   not a starting assumption; the agent-template-repo approach explicitly
   discarded), and (b) `docs/EXECUTION_MODEL.md`, which encodes that ruling
   plus the honest engine gap. **This audit treats those stand-ins as
   authoritative.** If the real document surfaces, it arbitrates.
3. `~/Downloads/recursive-org-spec.md` — the node, capabilities, persistent
   vs generated objects, and the constitution's fixed schema (which includes
   *risk tolerance, budgets and constraints, approval thresholds, success
   definitions* — load-bearing for §2's Constraints verdict).
4. `~/Downloads/interaction-spec-2.md` + `docs/INTERACTION_SPEC.md` — the
   grammar, capabilities, Generated Workspaces, and progressive disclosure —
   including the mechanism this audit leans on repeatedly: *"Selecting a
   low-completeness node doesn't open a report — it opens a short, scoped
   line of questioning in the same conversational input, exactly like
   resuming an onboarding conversation."* That is the named, doctrinal home
   for every question this audit defers out of onboarding.

The question inventory audited below is the **as-implemented** `/build` flow
(the v2 spec's five phases instantiated in code), because a question's real
consumers — not its intended ones — decide whether its answer changes the
plan. Every consumer claim below is traced to file:line.

One implementation fact frames everything: the `/build` flow runs the
generation pipeline **deterministically** (`use-plan-feed.ts:81` passes
`skipInference: true`; `Review.tsx:53` likewise). The vendored T2 prompts for
phases 2/3/4 never run. The only live model consumers of pillar answers are
the pillar-1 enrichment itself, the `/pillar/:n/suggest` calls, and the
Phase-3 research call (`src/research/prompt.ts`). "This field feeds the T2
prompt" is therefore **not** a live consumer unless it is one of those three.

---

## 1 · Background verdict: what actually changed, and what didn't

The architectural change is real at the plan layer and **not yet real at the
engine layer**, and the audit must hold both truths:

- Real: placement (`lib/placement.ts`) decides a build chain, not an agent
  roster; research (`src/research/`) can insert/refocus build-chain steps
  that become real seeded tasks; the Review card presents deliverables and
  departments, not headcounts; Birth executes the plan through the native
  work runtime.
- Not yet real: the fleet is still selected from a frozen 33-agent
  `BASE_ROSTER` by a decision matrix
  (`vendor/wavex-os/onboarding/src/phases/phase-3-swarm/`), which is
  precisely the discarded template-repo model. `docs/EXECUTION_MODEL.md`
  names this the honest gap. **Consequence for this audit:** several
  questions' only consumers are agent-shaping machinery (activation rules,
  template scoring, bundle allocation). Under the new philosophy those
  consumers cannot, by themselves, justify an ask — they are implementation
  details of an engine scheduled for replacement. Criterion 4 is applied
  accordingly, and flagged wherever it decides a verdict.

---

## 2 · The candidate structure, tested

The prompt's candidate — Business Understanding → Strategic Understanding →
Operating Context → Constraints → Execution Plan → Dynamic Workflow
Generation → Runtime Optimization — versus the current five phases:

| Candidate stage | Maps to | Verdict |
|---|---|---|
| Business Understanding | Phase 1 (ingest → enrich → confirm → product state) | **Same shape, different words.** Exists. Rename at most. |
| **Strategic Understanding** | **Nothing** | **Real gap — the largest finding in this audit.** The plan's fixed goal is synthesized from a stage bracket: `lib/goal-synthesis.ts` `GOALS_BY_STAGE` hardcodes current/target pairs per bracket with `kpiId: "monthly_recurring_revenue"` and `days: 90` unconditionally. The KPI baselines are stage-bucket medians stamped `ai_estimated: true` by the vendored estimator (`phase-1-onboard/pillar-3.ts`; client display mirror `stage-baselines.ts:17-22`). **Nobody is ever asked what success means, what their real numbers are, or what target matters to them.** Both fixed anchors of the self-prompting loop are fabricated; only the revisable half is real. §4 designs the fix. |
| Operating Context | Pillar 4 + Pillar 5 + Phase 2 connectors | **Same content, split across two phases.** The GTM answers *drive* the connector matrix (`gtm_profile_enum` → deferrals; `industry_hint` → the whole matrix), yet they're asked one phase before their consequence renders. Consolidate. |
| Constraints | Nothing — **and correctly so, as a stage** | **Partial gap; must not become a stage.** Two reasons. (1) The audit's own standard: constraints/risk/priorities questions have *no consumer anywhere in the codebase*. A Constraints stage would manufacture the next generation of `business_model` chips — asked, stored, consumed by nothing. (2) Doctrinal: `recursive-org-spec.md` already homes risk tolerance, budgets, approval thresholds, and success definitions in **the constitution's fixed schema**, edited conversationally through capabilities post-birth — not collected in a wizard. The one constraint question with a live consumer (the execution bottleneck → research context + MC winner bias, the `primary_friction_hypothesis` mechanism) folds into Strategic Understanding. |
| Execution Plan | Phase 3 (Research → Planning) + Phase 4 (Review) | **Same shape.** Merge Review into it — one card and one confirm is a beat, not a phase. |
| Dynamic Workflow Generation | Phase 5 Birth | **Exists in the UI only.** The engine underneath is template selection (§1). The audit must not describe this stage as dynamic; the spec-edit pass should carry the EXECUTION_MODEL.md caveat verbatim. |
| Runtime Optimization | Nothing — **and correctly so** | **Category error as an onboarding stage.** Learn-over-time today is the feedback-fold only (prior critique concatenated into the next brief, `work/engine.ts:38-44`); cycles run solely on operator click (no scheduler exists); Reactivation, emergent templates, and knowledge accretion are scoped-not-started. Onboarding cannot contain a runtime stage. Its sole legitimate contribution to runtime optimization is seeding the loop with **real** benchmarks instead of guessed ones — which is §4, not a stage. |

**Net:** four of seven candidate stages already exist under other names; one
names the flow's largest real gap; two would be mistakes to adopt as stages.
The current flow's disease is not stage-count — it is **misallocated
attention**: roughly fourteen operator decisions, of which four are dead
(§5), zero capture intent about success, and the two entry paths march
through asks that only apply to one of them.

---

## 3 · Stage-by-stage disposition

Format per the prompt: Purpose · Planning Output (`OnboardingState` fields:
`research` / `roadmap` / `kpis` / `departments` / `dependencies` /
`ConnectorState`) · Path · Research-or-Planning (Phase-3 territory only) ·
verdict.

### Phase 1 — Understand You → **split and prune**

- **Purpose:** produce the context every downstream consumer reads.
- **Planning output:** `research` (the enrichment fields are the research
  call's largest context block), `roadmap`+`kpis` indirectly via placement.
- **Path:** Both — but see the per-question path violations in §5.
- **Verdict:** keep the ingest + confirm + product-state spine; delete the
  dead chip groups (business model, close channel, urgency routing); move
  GTM (Pillar 4) and comms (Pillar 5) into a consolidated Operating Context
  stage; move scope out entirely (§5, Q4); replace the MRR bracket with the
  real-number ask (§4). After pruning, Phase 1 is two screens: one input,
  one confirmation card.

### Phase 2 — Understand Reality → **keep, merged with Pillar 4/5; shrink the constellation**

- **Purpose:** wire the systems the plan expects to read.
- **Planning output:** `ConnectorState`; `dependencies` indirectly (bundle
  membership); `research` (the `{id, bucket, status}` triples).
- **Path:** Both.
- **Verdict:** the GTM and comms questions decide the connector matrix, so
  asking them and showing their consequence should be one act. Shrink what
  is shown to required (comm channel) + top matrix picks, because of the
  honest limit in §6: **connectors gate plan content but feed no data
  today** — credentials are vaulted and never read (7 of 38 connectors have
  liveness probes whose responses are discarded, `vault/probes.ts`; Composio
  is OAuth-brokerage only with no tool execution; agents are launched with
  an intentionally empty MCP config, `paperclip-handoff.ts:622-645`, under
  `--strict-mcp-config`). Every extra wiring minute currently buys manifest
  status, not capability. The spec's own Phase-2 framing ("what already
  exists: website, CRM, GitHub, Stripe…") describes a discovery surface the
  runtime does not yet have.

### Phase 3 — Build the Plan → **keep; absorb Review; feed it real strategy**

- **Purpose:** Research (what's newly possible) then Planning (interpolate
  the gap between the goal and what research found).
- **Planning output:** all five `PlanProgress` fields, in order.
- **Path:** Both. **Research-vs-Planning:** correctly split already — the
  two sub-steps exist and are sequenced (`plan-assembly.ts`
  `researchThenSettle`), satisfying the spec's "different kinds of work"
  requirement structurally, not just visually.
- **Verdict:** the machinery is sound; its **inputs** are the problem.
  Research runs exactly once, at Phase-3 entry, with the fullest context —
  and today that context contains a synthetic goal, guessed baselines, a
  hardcoded `claude_plan: "max_20x"` constant labeled load-bearing
  (`BuildOrgPage.tsx:130-156` → `research/prompt.ts:58`), and not one word
  of the operator's verbatim `raw_input` (only the enriched distillation).
  Feeding the one discovery pass fabricated strategy wastes its ≤6-finding
  budget on generically-plausible discoveries instead of gap-targeted ones.
  The Strategy & Success answers (§4) exist chiefly so that *this call*
  receives them.

### Phase 4 — Review → **merge into Phase 3 as its closing beat; receive the relocated scope control**

- **Purpose:** the one Confirm.
- **Planning output:** none new — it renders `roadmap`/`kpis`/`departments`/
  `dependencies` and commits.
- **Verdict:** one card + one confirm is a beat. It gains the relocated
  department-parking question (§5, Q4) because parking only makes sense once
  the operator can *see* the departments the plan produced.

### Phase 5 — Birth → **keep; question-free; pricing stays non-blocking**

- **Purpose:** execute (Path A) or connect (Path B); the one coordinated
  motion.
- **Planning output:** none — Birth consumes the plan.
- **Verdict:** correct as shipped. The pricing card is currently decorative
  (§5, Q10) and must never cost a decision on the plan path.

### The target shape

```
0  Ingest & Infer       1 input, 0 decisions    URL/free text → 12-field enrichment
1  Confirm Reality      2 decisions             industry + product-state correction gate
2  Strategy & Success   3–5 decisions   ← NEW   goal KPI · current value · target+horizon · bottleneck
3  Operating Context    3 decisions + wires     lead source · motion · comms → constellation
4  Plan & Review        1–2 decisions           research → planning → before/after → parking → Confirm
5  Birth                0 decisions             Path A/B · non-blocking pricing
```

Six beats; four ask anything; on Path B up to four of the asks arrive
pre-answered as confirmations.

---

## 4 · The missing stage: Strategy & Success

The self-prompting loop is *fixed goal + fixed KPIs + revisable checklist*.
As shipped, both fixed anchors are fabricated:

- The goal: `GOALS_BY_STAGE` maps a bracket chip to hardcoded
  current/target numbers; `kpiId` is always MRR; `days` is always 90.
- The baselines: `stage-baselines.ts` medians, `ai_estimated: true` — and
  even those never reach the DB. Activation writes literal `BigInt(0)`
  baselines (`finalize-bridge.ts:348-354`, "real measurement in
  WAVAAAA-118"); the only measurements that ever exist are numbers a human
  types into `POST /api/mission-control/kpi-impacts/:id/measure`. **Stripe
  is vaulted; MRR is asserted. The two never meet.**

Every subsequent cycle therefore critiques the checklist against a goal
nobody stated, measured by baselines nobody has. Four questions repair it —
and they are exactly the questions no present or future discovery mechanism
can answer, because two of the four are *intentions*:

| # | Question | Populates | Path | R/P | Priority | Inferable? |
|---|---|---|---|---|---|---|
| S1 | "What's the one number that tells you this business is working?" — chips seeded from `lib/kpi-registry.ts` so operator vocabulary and canonical ids cannot drift (the `sales_motion` enum mismatch is the cautionary tale); placement-aware sets (operating → revenue/pipeline/activation; pre-product/informal → first paying customer, launch date, waitlist, validation interviews) | `roadmap.goal.kpiId` (today hardcoded) + `kpis[0]` | Both | Planning | **Critical** | **Never — pure intent.** |
| S2 | "What is that number today?" — numeric; "not sure" falls back to the stage baseline, honestly flagged `ai_estimated: true` | `kpis` baseline with `ai_estimated: false`, `roadmap.goal.current`; the stage *bracket* becomes derived, not asked | Operating only (pre-product/informal: current = 0 by placement — which is what `synthesizeGoal`'s placement branch already asserts) | Planning | **Critical** | Not today. **Once connector reads exist:** Stripe (`secret_key` is already vaulted; no read path exists). The question then degrades from ask to pre-filled confirm — "Stripe says $23,400 MRR — right?" — and never disappears entirely. |
| S3 | "Where does it need to be, and by when?" — target + horizon, default 90d; sanity-banded against the stage baseline (challenge, don't block) | `roadmap.goal.target`, `roadmap.goal.days` | Both | Planning | **Critical** | **Never — intent.** Replaces halve-then-triple synthesis. |
| S4 | "What's the biggest thing slowing the company down right now?" — ≤200 chars, pre-filled from the enrichment's `primary_friction_hypothesis` | strategy context → the research prompt + the Monte Carlo winner bias (`mc-invocation.ts:52-75` — the ONE enrichment hypothesis with a live structural consumer today; this extends a mechanism that already exists rather than inventing one) | Both | **Research** | Important | Partially — enrichment infers *customer* friction from the website; the operator's *own* bottleneck is not on the website. Ask with prefill. |
| S5 | (optional) "Up to two other numbers you check weekly, with today's values." | secondary `kpis` entries, `ai_estimated: false` | Both | Planning | Optional | Same ladder as S2. |

Two integrity requirements the spec-edit pass must carry: typed values must
**actually reach the DB** (today `kpi_snapshot_initial` never does — the
manifest copy and the `company_kpis`/`kpi_snapshots` rows are disconnected),
and S2/S3 answers must reach the **research context**, because research is
the terminal consumer of everything and currently plans around a fiction.

---

## 5 · Per-question verdict table

Ten criteria per the prompt; compressed to the decisive points. C10 names the
`OnboardingState` field or says "none."

### Q1 — Welcome free-text / URL → **KEEP** (the anchor)

- C1–C3: the seed for everything; one URL yields 12+ enriched fields in ~5s
  (`runCombinedPillar1Enrichment`, `pillars.ts:248-301`). There is no plan
  without it. C5: not inferable — it *is* the inference mechanism. C4:
  clean. C8: Both. C9: research-seed. C10: `research` (via the enrichment →
  research context).
- **The one defect:** the persisted `raw_input` is read by *nothing* — its
  only consumer is client-side scope regex detection before persistence. The
  operator's own words never reach the research call; only the distillation
  does. Fix: pipe `raw_input` verbatim into `research/prompt.ts` context.

### Q2 — Adopt-URL row (Path B entry) → **MERGE into Q1; delete as a distinct surface**

- C1: a second door to the same room — identical field set, `has_product`
  forced true (`adopt-product.ts:95-97`). C5: Q1 already accepts a URL;
  URL-ness + enrichment implies the path. C7: the better question is no
  question — one entry surface that branches on whether the input is a URL.
  The `c-adopt` canvas capability (`org/nodes.ts:332`) already covers late
  adoption, matching the spec's "Mission Control's second job." C10: same
  fields as Q1 — no unique field justifies a second surface.

### Q3a — "Read from your site" panel (8 read-only rows) → **REWORD**

- C1: trust theater with a real kernel. Of eight displayed fields, exactly
  one has a structural consumer — `primary_friction_hypothesis`, which
  re-selects the Monte Carlo winner via keyword buckets. A wrong silent
  guess reroutes the strategy with no operator checkpoint. C7: make
  friction the ONE editable confirm ("We think your biggest growth friction
  is X — right?" → merges with S4) and collapse the other seven into a
  disclosure. **Stop rendering fields nothing consumes** — display implies
  consumption, and that implication is currently false for 7 of 8 rows.
  C10: `research`.

### Q3b — Industry chips (13 + custom) → **KEEP, as confirm-of-inference**

- C2/C3: the single most load-bearing field: the entire 16-branch connector
  matrix + two adjustment passes (`phase-2-connector/decision-matrix.ts`),
  bundle-allocation deltas, six activation rules, template-scoring weight
  0.35, research context. C4 flag: a *majority* of those consumers are
  agent-shaping; the field survives on its connector-matrix and research
  merits. C5: inferable **today** via URL enrichment (`industry_hint` is an
  enrichment output) — so on Path B this is a pre-selected confirm, asked
  cold only when there's no URL. C8: Both. C10: `research` + `departments`
  (indirect).

### Q3c — Business-model chips (8 + custom) → **DELETE**

- C3: **zero structural consumers.** Appears only in prompt-context string
  builders. The chip vocabulary doesn't even match the enrichment enum
  (`marketplace_take_rate` etc. vs `subscription|usage_based|one_time|…`,
  `pillars.ts:111`) — proof nothing ever depended on the human answer. C5:
  the enrichment already infers `business_model_hint` into the correct enum;
  keep the inferred value flowing to research, delete the ask. C10:
  `research` only — served identically by the inferred value.

### Q3d — Product-status binary (Live-selling / Pre-product) → **DELETE**

- C3: `has_product` is a placement *fallback* that the always-asked
  `product_state` (Q5a) overrides (`placement.ts:73-88`). A question whose
  answer a later question in the same flow supersedes fails C3 by
  construction. C4: its surviving consumers (connector bucket gates, three
  activation rules) are agent/connector-shaping and derivable
  (`product_state === "idea_only" ⇒ false`; URL enrichment corroborates).
  C10: none uniquely.

### Q4 — Scope (full company / focused divisions) → **MOVE to Review as department parking; kill the override**

- C4: **the purest agent-optimizing question in the flow.** Its entire
  purpose is roster sizing — an implementation detail. Goal, KPIs, and
  checklist are identical under full vs focused.
- Worse: `mode: "full"` **un-parks every matrix-parked agent**
  (`swarm-overlays.ts:155-168`), cancelling the entire pillar-driven
  activation verdict set — the only question in the flow that *destroys*
  other questions' outputs. And custom division labels "default to
  Operations" (the card's own footnote): the typed answer is discarded.
- C6/C7: the intent it captures ("leave these parts of the company alone")
  is real and never inferable — but it belongs at **Review**, after the
  departments are visible, as a *subtractive filter applied after activation
  rules run*, never an override that precedes and cancels them. Post-birth
  adjustment already exists (`unpark_condition:
  "operator_unpark_from_mission_control"` — the refinement mechanism, named).
- C8: Both. C10: `departments`.

### Q5a — product_state (4 options + other) → **KEEP**

- C2/C3: the placement authority (`placement.ts`) → build chain vs growth
  chain, goal band, Path A/B itself. The plan is structurally *different*,
  not merely worse, without it. C5: partially inferable on Path B (URL
  enrichment: live site + pricing ⇒ operating; `product_maturity_signal`
  should pre-select the chip — wiring a currently-dead field to work). The
  `built_not_selling` distinction is **never** inferable — a polished site
  with zero sales motion is invisible from outside. C8: Both, pre-selected
  on B. C9: Planning. C10: `roadmap` + `kpis` (goal band).

### Q5b — stage / MRR brackets → **REWORD — the highest-leverage change in this audit**

- C7 is decisive: the system asks which *bracket* revenue falls in, then
  synthesizes the fixed goal from bracket guesswork, while never asking the
  number. Replace with S2/S3 (ask the number + target; derive the bracket).
  Side effects of a number: it has no vocabulary, so the
  three-incompatible-stage-vocabularies defect dissolves (today only 1 of 4
  revenue chips matches `affinities.ts:37-39`, silently zeroing the 0.20
  template-scoring weight for the other three); and the `built_not_selling`
  incoherence ends (currently asked for an MRR bracket that
  `goal-synthesis.ts` discards while allocations still consume it).
- C8 violations fixed by the conditional: Path-A idea-only founders
  currently see MRR brackets that cannot apply. C10: `kpis` + `roadmap`.

### Q5c — KPI baseline preview (display-only) → **MERGE into S2 as editable confirm**

- C3: a read-only estimate the operator cannot correct contributes nothing.
  The old wizard's KPIVerifyPhase did this job; `/build` dropped it (the
  component still exists in `vendor/wavex-os/ui-onboarding-components/`).
  Restoring it as the editable baseline confirmation converts a glance into
  a measurement at zero additional asks. C10: `kpis` — the only route by
  which `kpis` ever holds non-synthetic data.

### Q6a — lead_sources (8 options, max 3) → **KEEP; reword toward primary-first with prefill**

- C2/C3: "where do customers come from" genuinely shapes a growth
  checklist; the primary source drives `gtm_profile_enum`. The 2nd/3rd
  picks feed only connector-bucket nudges (C4 flag: agent/connector-shaping)
  — keep the multi-select but treat the primary as the load-bearing answer.
  C5: pre-seedable **today** from enrichment's `primary_acquisition_channel`
  (currently a dead display row — wire it); fully verifiable only **once
  connector reads exist** (GA4/CRM — none today). C8: conditional — skip
  for pre-product (`none_yet` fast path). C10: `research` + `dependencies`.

### Q6b — sales_motion (4 options) → **KEEP; fix the vocabulary; conditional**

- C2/C3: `gtm_profile_enum` is a real plan-shaping signal (self-serve vs
  enterprise checklists differ materially). C5: partially inferable today
  from site CTAs — **but the suggestion enum is disjoint from the chips**
  (`plg_self_serve` vs `self_serve_plg` etc., `pillars.ts:722-723` vs
  `options.ts:40-46`), so suggestions mostly cannot pre-select. Unify the
  enums before trusting prefill; until then, prefill would be worse than
  silence. C8: conditional — pre-product ⇒ auto `none_yet`. C10:
  `research` + `dependencies`.

### Q6c — close_channel (3 options, conditional) → **DELETE**

- C3: sole consumer is one line of research context
  (`research/prompt.ts:60`). `close_channel_other`: nothing. If channel ever
  matters to execution, the **feedback-fold loop** revises the checklist
  when measurement says so. C10: `research`, marginally — one line of
  prompt decoration does not clear the executive-attention bar.

### Q7a — comm_channel (+ inline Telegram credentials) → **MOVE into the connector step** *(close call)*

- C1/C2: real consumers — it makes slack/telegram *required* connectors and
  captures credentials inline. But it is configuration preference, not
  planning input (C9: neither — it is `ConnectorState` setup), so it
  belongs where connectors are wired: the first card of the constellation.
  Same ask count, one fewer pillar surface. Flagged close: keeping it in
  place is defensible — the cost is one tap and the consumers are real.
  C5: never — preference. C10: `ConnectorState`.

### Q7b — urgency_routing (2 options, conditional) → **DELETE**

- C3: research-context only; **no routing code exists** that reads it. Its
  T2 suggestion enum is disjoint from its chips (`pillars.ts:730` vs
  `options.ts:63-67`), so the suggestion spend is pure waste — the same
  tell as Q3c that nothing ever depended on the answer. If routing is
  built, it is a post-birth preference: a constitution capability
  (escalation paths are already in the constitution's schema per
  `recursive-org-spec.md`). C10: none.

### Q8 — Silent pillar-2 (`claude_plan` hardcoded "max_20x") → **FIX the constant**

- Costs no attention, so the issue is correctness: research receives a
  hardcoded constant labeled load-bearing ("what is newly possible is
  partly a function of how much inference this operator has"). C5:
  trivially inferable **today from runtime config** —
  `WAVEX_INFERENCE_MODE` / the inference adapter know the real answer at
  boot. Populate from reality or drop the field from the research payload.
  C10: none as asked (nothing is asked).

### Q9 — Connector wire/skip (+ 4-option skip reasons) → **KEEP wiring; DELETE the skip-reason sub-ask; shrink the surface**

- Wiring: passes — the only populator of `ConnectorState`; research
  consumes the `{id, bucket, status}` triples; bucket membership shapes the
  manifest. C10: `ConnectorState` + `dependencies`.
- Skip reasons: four canned options land in the vault audit log and are
  consumed by **nothing** downstream. A follow-up ask whose answers no code
  reads fails C3. DELETE.
- The structural flag that outranks both: **credentials are stored and
  never read for data** (§6). Wiring's value proposition — "connect your
  tools so the system can see your business" — is unrealized. Shrink the
  constellation to required + top picks and defer the rest to post-birth
  (the marketplace surface exists), until reads exist.

### Q10 — Pricing tier (4 tiers) → **DELETE from the plan path; keep as the non-blocking Birth card until billing is real**

- C3/C10: the definitional "none" case. `POST /api/tier-subscriptions` is a
  stub (`routes/tiers.ts:48` — a console.log; the answer is discarded);
  Subscribe and Skip invoke the same continuation. Populates no
  `OnboardingState` field. Worse than zero: a question that visibly changes
  nothing trains the operator that this flow's questions are decorative —
  it taxes the credibility of every real ask before it. Monetization
  belongs on a billing surface when the endpoint is real.

---

## 6 · Asked / Inferred / Discovered / Learned — with the limits drawn in ink

The architecture implies a discovery capability the runtime does not have.
The line, drawn precisely:

**B — Inferable today (mechanisms exist and run):**
- Industry, business context, ICP, revenue model, competitive position,
  tone, product maturity, friction/differentiator hypotheses → **URL
  enrichment** (one page, ~5s, 12 fields, `pillars.ts:248-301`). The
  workhorse, and the reason Confirm Reality is a confirmation, not an
  interview.
- Primary lead source, sales motion → partially, from the same enrichment —
  *after* enum unification (today the suggestion vocabularies cannot match
  the chips; see Q6b, Q7b).
- Inference budget → runtime config (Q8).
- Stage bracket → derived from the typed number (S2).

**C — Discovered through connected systems (the honest status: NOT YET):**
- Phase 2's actual job today is *gating*, not discovery: 7 of 38 connectors
  have liveness probes whose responses are discarded (`vault/probes.ts`);
  Composio exposes OAuth/list only — no tool execution surface exists;
  agents receive an intentionally empty MCP config
  (`paperclip-handoff.ts:622-645`: every entry in `KNOWN_MCP_SERVERS` is
  `null`) under `--strict-mcp-config`; the vendored credential→activation
  gate is never wired (`credentialStatus` is passed by nobody). The one
  genuine zero-ask discovery is the MCP config scan
  (`lib/mcp-scanner.ts`), used only to suppress a paste form.
- Therefore: current MRR (Stripe), real lead-source mix (GA4/ads/CRM),
  motion-as-practiced (CRM), activation/burn (analytics/banking) are
  **askable now, discoverable later**. When reads exist, each ask degrades
  to a pre-filled confirm — it never silently disappears, because a wrong
  read confirmed is better than a wrong read assumed. Until then the UI
  should say so: *"We'll read this from Stripe once it's connected — for
  now, tell us."* **Implementing connector reads is the single unlock that
  lets the question count keep falling after this audit.**

**D — Learned over time (the named mechanisms, not vague deferral):**
- Checklist revision → the **feedback-fold**: structural-QA notes and
  operator review verdicts push into `task.feedback`, folded oldest-first
  into the next brief (`work/cycle.ts:124`, `routes/work.ts:206`,
  `work/engine.ts:38-44`). This is what "the checklist is the only
  iterative part" cashes out to today.
- Deferred understanding → **low-completeness scoped questioning**
  (`interaction-spec.md`, Progressive Disclosure): selecting a
  low-completeness node opens a short, scoped line of questioning — the
  doctrinal home for every question this audit removed from the wizard.
- Structural adjustment → **refinement** (`routes/refinement.ts`):
  operator-initiated analyze → apply/revert over the signed manifest, with
  the only true undo in the system.
- Honesty caveat: no scheduler exists — the loop turns only when the
  operator clicks Run cycle — and Reactivation / emergent templates /
  knowledge accretion are scoped-not-started (`docs/EXECUTION_MODEL.md`).
  "Learned over time" is real but manual-cadence today.

**A — Asked, permanently (the floor):** goal KPI choice · target + horizon ·
the operator's own bottleneck · comm-channel preference · department parking
· the `built_not_selling` distinction. These are intentions and private
facts; no read can produce them. **The end-state this audit points at: every
fact question degrades into a confirmation as read mechanisms arrive; the
intent questions are the floor below which the flow cannot shrink — and they
are almost exactly the questions the current flow does not ask.**

---

## 7 · Sequencing — what is actually forced

Hard dependencies, from code:

1. Confirmed industry + GTM + comms → the connector matrix
   (`phase-2-connector/decision-matrix.ts` consumes all of
   `industry_hint`, `gtm_profile_enum`, `lead_sources`, `comm_channel`,
   `has_product`-equivalents). Confirm Reality and Operating Context's
   questions must precede the constellation.
2. `product_state` → placement (`lib/placement.ts`) → build chain, goal
   band, Path A/B, connector gates. Before plan assembly.
3. Everything → **research**, which runs once at Phase-3 entry and is the
   terminal consumer of all context. Whatever is unknown by then is unknown
   to discovery forever (per run).

Nothing else is order-constrained. Strategy & Success has one hard
constraint (before research) and three soft reasons to sit at position 2:
the derived bracket must exist before allocation consumers fire; operator
attention is highest early and these questions most deserve it; and the GTM
prefills benefit from the strategy answers as disambiguation. **Conclusion:
the current order is essentially forced. The fix is one insertion (Strategy
after Confirm), one relocation (scope → Review), and one merge (Review into
Plan) — not a reshuffle.** The candidate structure's ordering is compatible;
its error was stage inflation, not sequence.

The two-entry-path split survives the review: placement already implements
the spec's "spectrum, not a strict binary" (pre_product / informal /
operating), and Path B's entry correctly merges into Q1. The flywheel-grows
mechanic survives untouched — it is presentation of the plan being built,
costs no questions, and the department ring stays as-is per the spec's own
unresolved-flag discipline.

---

## 8 · Defect appendix (feeds the spec-edit pass; none block the audit)

1. **Vocabulary defects.** `sales_motion` and `urgency_routing` suggestion
   enums are disjoint from their chips — suggestions can never pre-select
   (wasted T2 spend). `stage` has three incompatible vocabularies (chips /
   suggest enum / `affinities.ts`); only 1 of 4 revenue chips scores on the
   0.20 template axis. All three dissolve if S2 replaces the bracket ask.
2. **`built_not_selling`** is asked for an MRR bracket that goal synthesis
   discards while bundle allocations and six activation rules still consume
   it — one answer, two contradictory fates.
3. **Dead fields** written and read by nothing: persisted `raw_input`,
   `enriched_at`, `inference_confirmed`, `inference_corrections` (schema
   promises "drives low_confidence flags" — no such code),
   `close_channel_other`, `urgency_routing_other`, the deprecated
   `lead_source`.
4. **`kpi_snapshot_initial` never reaches the DB** — activation writes
   `value: 0` baselines; the manifest estimate and the runtime KPI rows are
   disconnected systems.
5. **The empty MCP config** (`KNOWN_MCP_SERVERS` all-null) — the artifact
   that makes §6's C-verdict unarguable.
6. **`scope: "full"` un-parks everything** — one chip cancels the
   activation model (Q4).
7. **Doc drift:** `docs/prompts/pillar-1-enrichment.md` documents an older
   prompt with different enums and a different caller than the live
   combined path in `pillars.ts`.

---

## 9 · Net effect

**Before:** ~14 interactive decisions + 2 read-only panels + per-connector
wiring + skip-reason sub-asks, across both paths indiscriminately; 4 of the
14 dead; 0 about success.

**After:**

| Path | Decisions |
|---|---|
| B (URL) | 1 entry + 3 pre-selected confirms (industry, product_state, motion) + 1 friction confirm + 1 typed current-KPI + 1 target/horizon + 1 primary lead source (pre-seeded) + wiring incl. comms |
| A (idea-only) | 1 entry + industry + product_state + friction + target/horizon + wiring — MRR, lead source, and motion correctly skipped |

**6–7 decisions, up to 4 arriving pre-answered on Path B.** Dead spend to
zero; strategic coverage from zero to five questions; the only typing beyond
the first sentence is the two numbers that make the plan's fixed half real.

**Top five changes, ranked by leverage:**

1. **Ask the real numbers (S1–S3, absorbing Q5b/Q5c).** Converts the plan's
   entire fixed-goal half from stage-bucket guesswork to statement of
   intent + measurement. Nothing else touches plan quality this directly.
2. **Kill the scope override; park at Review (Q4).** Removes the one
   question that destroys other questions' outputs and the purest
   agent-optimizing ask in the flow.
3. **Implement connector data reads (the Q9/§6 flag).** Not a question
   change — the unlock that lets fact-asks keep degrading into confirms.
   Until then, wiring is ceremony with a manifest.
4. **Merge-and-prefill from enrichment (Q1+Q2; Q3b/Q5a/Q6b prefill) after
   enum unification.** Path B becomes confirm-not-ask end to end; the
   system stops asking questions whose answers it displayed one screen
   earlier.
5. **The dead-question sweep (Q3c, Q3d, Q6c, Q7b, Q10, skip reasons).** Six
   surfaces, zero plan cost, pure attention refund — and it removes the
   credibility tax of visibly inert questions.
