# Cognitive Rendering Engine — implementation plan

**Source:** operator's three-layer concept (Intent → Reasoning → Manifestation; thoughts not
components; animation-as-cognition; information-as-matter; object permanence; time-as-property).
**Grounding:** the shipped canvas already *is* layers 1→3 in skeleton form — `classify()` is the
intent layer, the catalog+endpoints are the reasoning layer's surface, `LayoutSpec→cells` is the
manifestation layer. This plan deepens each layer; it does not re-architect.

## Disagreements (surfaced per protocol — everything else is followed as written)

1. **"Should I act?" never means autonomous mutation.** Paperclip may *prepare* proposals
   proactively; the confirm click stays human. The concept's own governance framing survives only
   if this holds.
2. **Model-authored thought must look different from endpoint truth.** Hypothesis / Prediction /
   Investigation-narrative primitives are model output. They ship, but visually distinct (prose
   styling, "assistant's read" labeling) and never as numeric cells — otherwise compose-never-
   compute dies in the user's perception even while surviving in the architecture.
3. **Spontaneous appearance conflicts with calm.** "The assistant discovers something → an object
   quietly appears" is allowed *inside a user-initiated investigation*. Unprompted discoveries go
   to the attention queue (offer, never impose).
4. **Time stays visible in exactly one place.** Investigations organize by question→decision→
   consequence, agreed — but the ledger remains chronological. Governance needs a clock.
5. **Eighteen primitives don't ship as eighteen renderers.** They ship as a semantic vocabulary
   *mapped onto* renderers in waves (below); vocabulary churn breaks signatures, so each wave bumps
   `CATALOG_VERSION`.

## Phase S — skeleton remainder (before anything new)

| # | Work | Verify |
|---|---|---|
| S1 | Morning-screen attention queue (the missed phase-9 item): render the attention cell on the empty state; ledger gets a visible "Decisions" view | build + live check |
| S2 | e2e spec walking ask→workspace→proposal→commit on the stub path | playwright run (or documented env blocker) |

## Phases D — the details

| # | Work | Concept it lands |
|---|---|---|
| D1 | **Semantic contract v2**: cells gain `thought` (primitive name) + `salience` (0–2) + turns gain `threadId`; `cv2`; client-side primitive→renderer map | thoughts not components; renderer decides visuals |
| D2 | **Cognition choreography**: diff prior↔new layout per signature — added cells *appear* (discovered), changed cells *morph* (evidence shifted), removed cells *dissolve* (rejected); staggered entries; reduced-motion → end states | animation communicates thinking |
| D3 | **Morning moment**: trajectory line + at most one decision card with confidence + `Review` | intent layer's "what worries you?" |
| D4 | **Context-fed composer + Hypothesis primitive**: last 6 turns + pillar summary + active layout into the T2 prompt; hypothesis cells labeled as assistant's read (disagreement #2 styling) | reasoning layer visible |
| D5 | **The board**: multiple workspaces coexist with stable topic geography (topic→region persisted in desk); minimized miniatures restore in place | object permanence; thinking has geography |
| D6 | **Primitive wave 1**: Simulation (render `mc-report.json`), Timeline (ledger+calls+ignition interleaved), Investigation (drill layers grow *in place* — the information-as-matter column) | simulation/evidence/timeline thoughts |
| D7 | *(named deferrals)* SSE streamed composition; Paperclip decision primitives (approvals/interactions) behind the proxy split; proactive-discovery queue | matter that grows in realtime |

Invariants carried whole from `MORPHIC_INTERFACE.md` §5. Each phase = one commit + tests/build +
live smoke; S must be green before D1 begins; D phases proceed automatically in order.

## Audit — concept → landing

Intent layer → classify/T2 intents (exists) + D3/D4 · Reasoning layer → endpoints + composer
context (D4) + Paperclip (D7) · Manifestation → catalog/renderers + D1 · Thought types 1–5 → text ✅,
trend ✅, simulation D6, proposal ✅, relationship-graph D6/D7 · 18 primitives → D1 vocabulary, waves
D6/D7 · working-memory workspace → D5 · animation-as-cognition → D2 · information-as-matter → D6
(in-place growth), D7 (streaming) · object permanence → D5 · time-as-property → threadId D1,
ledger stays temporal (disagreement #4) · renderer-not-application → D1 contract split.
