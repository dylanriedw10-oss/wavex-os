# The Morphic Interface — vision, current state, and the honest gap

**Status:** v1 shipped (`/canvas`, commits `f20d3a6..0c39e5e`). This document is the vision, the
technical record of what exists, and a deliberately hard review of the distance between them.

---

## 1. The vision

Most software stores UI. This system stores reasoning.

> **State is permanent. Views are ephemeral. The model composes; it never computes.**

Conversation is the only permanent interface. Ask a question and the workspace *builds itself
around it* — cells chosen and arranged for that thought, fetching their own truth from the backend,
collapsing when the thought is done. No pages. No navigation. No dashboard waiting to be visited.
The interface expands and contracts around cognition — the operator's, never the model's: the
system may offer (one line in an attention queue), it may never impose.

Six rules, none negotiable:

1. The model never produces a number a cell displays — it picks views; endpoints supply data.
2. Same intent → same shape. Generative but idempotent (the Monday problem).
3. Mutations only through proposal → confirm. The model cannot act; it can only ask.
4. Drilling is conversation — every expansion is a turn, not client-side logic.
5. Growth only follows a user act. Calm by default.
6. Decisions are never ephemeral. The ledger forgets nothing.

## 2. What exists — the technical process

The loop, end to end (all shipped, 100/100 server tests, verified live over HTTP):

```
operator message
  → POST /api/instance/:id/canvas                    routes/canvas.ts
  → the composition ladder:
      (a) memory   utterance key → signature → stored layout, <50ms
      (b) t2       claude -p via tier-router; JSON extracted from text,
                   fence-stripped, catalog-validated, invalid cells dropped
      (c) stub     deterministic keyword→layout floor — never budget-gated,
                   never fails, answers the common drill verbs instantly
  → validateLayout()                                 canvas/catalog.ts
  → turn persisted (canvas.json, atomic write)
  → client renders LayoutSpec; each cell fetches its
    own data through the typed client                canvas/cells.tsx
  → proposal? → confirm → commit re-validates body, executes through the
    real endpoint via app.inject, appends the never-trimmed ledger,
    states the outcome as a transcript turn
```

Load-bearing pieces:

- **The catalog** (`canvas/catalog.ts`) — 8 cell types × 9 endpoint bindings, each annotated with
  which HTTP statuses mean *empty, not error*. It is simultaneously the composer's vocabulary, the
  validation schema, and the security boundary. A new genre = one renderer + one entry; the T2
  prompt learns it automatically.
- **Intent signatures** (`cv1:`-prefixed, classified fields not text hashes) — paraphrases
  converge; catalog version bumps orphan stale layouts silently. The T2 prompt carries the known
  signature index so reuse is a closed-vocabulary task, not a hash coincidence.
- **The proposals map** — separate from the transcript so the 40-turn cap can never trim a pending
  confirm button. TTL 15 min; double-commit replays the recorded outcome (add-agent is not
  idempotent); propose-intents never reach the model at all.
- **Both new routes fix the three repo-wide auth defects** rather than inheriting them.

## 3. The honest review

What shipped is a **faithful skeleton**: the loop is real, the invariants hold, the concept is
provable on screen. It is also — correctly diagnosed — *simple*. The gap is not in the
architecture; it is in expression and depth. Graded against the vision:

| Dimension | Vision | Today | Grade |
|---|---|---|---|
| The loop (ask → compose → render → collapse → recall) | — | fully working | **A−** |
| Governance (proposal, ledger, allowlist) | — | working, tested end-to-end | **A−** |
| Determinism / memory | remembers how you think | remembers *what you asked* — layouts replay identically; `uses` count collected but unused | **B** |
| **Motion & choreography** | the workspace *unfolds*, cells arrive as thought progresses, collapse is an exhale | state swap — layouts appear and vanish instantly; zero animation | **D** |
| **The workspace as space** | a desk: several thinking objects coexist, minimized stacks, live pinned artifacts | exactly one layout at a time; pins are chips that re-ask; no coexistence | **D+** |
| **The morning moment** | "One decision requires you. 87% confidence. [Review]" — millions of observations pre-filtered to almost nothing | greeting + placeholder + composer; the attention queue only renders *inside* composed layouts, not on the empty state | **C−** |
| Conversation as protagonist | streamed replies, thinking states, 15px presence | 13px HelpChat-grade bubbles, whole turn arrives at once, "⟲ composing…" is the entire theater | **C−** |
| Curiosity unfolding | proposal → evidence → graph → transcript, layers all the way down | drill depth is 1, and only where the stub authored buttons | **C** |
| Composer intelligence | context-aware, multi-turn | **statelessly composed** — T2 receives the message + signature index but *no conversation history and no company facts*; stub replies are eight fixed strings | **C−** |
| Cell craft | endpoint-emphasized sparklines, tabular-nums tables, hero hierarchy | uniform flat cards, every cell the same visual weight, bare polyline | **C** |
| Genre coverage | simulation, timeline, evidence tree, approvals, live cells | 8 read-genres + 2 conversationally-reachable proposals; `mc-report.json` — the most differentiated data in the product — sits on disk unrendered | **C+** |
| Liveness | long investigations stream into pinned artifacts | polling only; no SSE/WS; nothing updates itself visibly | **D** |

The summary sentence: **the skeleton is honest, the flesh is missing.** Every D above is
expression; every C is depth. None require re-architecture — that is what the skeleton bought.

## 4. The path to the true vision

Ordered by leverage. Each is additive to the shipped contract.

### 4.1 Choreography (the D that hurts most)
The concept's emotional core is the interface *breathing*. Define the motion vocabulary once
(`--dur-fast/base/slow` exist; add three easings): cells enter staggered 40ms apart, rising 8px;
collapse is a 260ms contraction toward the thread, not a deletion; the workspace title crossfades
between intents. Reduced-motion resolves everything to end-states (contract already global).
~150 lines of CSS-in-cells; zero contract change.

### 4.2 The morning moment
Move the attention queue onto the empty state and give it the vision's shape: one line of trajectory
(goal comparison), then **at most one decision card** with its confidence and a single `Review`
action that opens the full proposal workspace. Everything else stays hidden. The data already
exists (`ignition`, `token-budget`, `redundancy.groups`, ledger).

### 4.3 A composer with context
Feed T2 (a) the last 6 turns, (b) a pillar-1 company summary (the `summarizePillars` helper in
help-chat.ts is lift-ready), and (c) the current workspace's layout so "add the trend to that" is
answerable. This single change moves replies from generic to situated, and unlocks follow-up
composition — the real test of "the room remembers".

### 4.4 The desk becomes real
Multiple workspaces coexist: the active one full-width, prior ones minimized into genuinely
rendered miniatures (not chips) that restore *in place* without a round-trip — the layouts are
already in the transcript and the memory map; this is pure client work. Pinned artifacts refresh
their cells on interval so a pinned investigation is visibly alive.

### 4.5 Streamed composition
Split the POST into compose-then-render phases client-side: optimistic user turn → thinking
indicator with elapsed time (T2ProgressIndicator pattern exists) → text arrives → cells mount one
by one as their queries resolve. True token streaming needs SSE on the canvas route — mock-core's
spawn SSE is the in-repo pattern; this is the one contract extension in the list.

### 4.6 The three missing genres that change what the canvas *is*
1. **Simulation** — render `mc-report.json`: 5 strategies × outcome distributions, the winner
   highlighted. "Should we hire another AE?" becomes answerable the day the roster feeds back into
   the MC harness.
2. **Timeline** — ledger + `recent_calls` + ignition steps interleaved. Cheap, and it makes time
   visible.
3. **Evidence tree** — drill chains rendered as an unfolding column rather than replacing the
   workspace, so layer N stays visible above layer N+1. Curiosity gets depth.

### 4.7 Paperclip-gated decision genres
Approval cards and blocked-interaction cards (the queue that silently strands agents) — gated on
the proxy split (`PAPERCLIP_BACKEND_AND_FRONTEND_PLAN.md` §1.6). These turn the canvas from
observability into governance.

## 5. Invariants — what must survive every iteration above

- The model never computes. All richness comes from better *arrangement* of endpoint-fetched truth.
- The stub floor stays. Every feature must degrade to it; a capped, offline company still thinks.
- The ledger never trims. The desk may forget; decisions may not.
- One catalog. If a cell can't be expressed as renderer + binding + params, it doesn't ship.
- Calm wins ties. When a feature could surface itself, it goes to the queue instead.

The distance between today's skeleton and the vision is real but it is *surface-deep by design* —
the contract underneath was built for exactly this flesh.
