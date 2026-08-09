# API Contract Addendum — WaveX OS Frontend Brief

**Read this with the Frontend Constitution, not instead of it.** The Constitution
says what to build. This says what the backend actually returns, so §12's
"every API state is represented" and §10's "no fake data presented as real"
have something true to be checked against.

**How this was produced, so you can trust or re-verify it:** every shape below
was either probed against the running server (`127.0.0.1:3101`, a seeded
company) or read from the TypeScript interface that produces it. Nothing here
is inferred from naming. Where a shape was not verified, it says so in place.

---

## 0. Transport

Same-origin. The Vite dev server proxies `/api` and `/wavex-os` to the API on
`127.0.0.1:3101` (`WAVEX_CORE_URL`). Call relative paths — `fetch("/api/...")`.

- **No Supabase. No Prisma. No auth provider. Do not add one.** Auth is a
  server-side shim; in dev every request is already authorized.
- Success envelope is `{ ok: true, ...payload }`. Failure is
  `{ ok: false, error: string }` or `{ error: string }` with a 4xx/5xx status.
  Some routes add `{ halt: {...} }` for an operator-facing stop.
- `companyId` is a URL-safe slug and appears in nearly every path.

---

## 1. The node contract already exists — do not invent one

Brief §1 says every object is "a node with a title, a one-line current-state
summary, a health signal, a knowledge-completeness value, capabilities, and
children." **That is already the wire format.** Verbatim from
`packages/wavex-os-server/src/org/nodes.ts`:

```ts
interface OrgNodeDto {
  id: string;
  kind: "company" | "department" | "agent" | "metric" | "constitution";
  title: string;
  snapshot: string;                    // the one-line current-state summary
  description: string | null;          // deterministic interface copy, never model-generated
  activity: "active" | "idle";         // real work right now
  health: "ok" | "at_risk" | "critical" | null;
  momentum: null;                      // always null today — see §4
  completeness: number | null;         // 0..100, the knowledge-completeness value
  gravity: number | null;
  objective: { title: string; status: "on_track" | "blocked" | "achieved" | "unknown"; blockedBy: string[] } | null;
  parentId: string | null;             // children are derived from this
}

interface NodeCapability {
  id: string; label: string;
  kind: "explain" | "compare" | "show_children" | "custom";
  source: "rule";
  prompt: string;                      // all R1 capabilities are READS
}
```

**Bind the brief's colour rules to these enums directly** — do not invent a
status vocabulary:

| brief §5 | field | values |
|---|---|---|
| teal / amber / coral | `health` | `ok` / `at_risk` / `critical` (and `null` = unknown, which must not render as green) |
| `--om-activity` purple | `activity` | `active` / `idle` — **independent of `health`**, exactly as §5 requires |
| completeness | `completeness` | `0..100`, or `null` = not measured |

A node can be `activity: "active"` with `health: "critical"`. The brief says
that is the truth and not a conflict to hide; the API models it that way.

**Verified example** (`GET /api/instance/:companyId/org/flywheel`):

```json
{ "id": "company", "kind": "company", "title": "acme",
  "snapshot": "7 departments · 35 agents · 23 spent",
  "activity": "idle", "health": null, "momentum": null,
  "completeness": 100, "gravity": null, "parentId": null }
{ "id": "dept:cpo", "kind": "department", "title": "cpo",
  "snapshot": "4 agents · lead template cpo",
  "activity": "idle", "health": null, "completeness": null }
```

---

## 2. The delegation walk already exists

Brief §3 describes "Marketing → asking Campaign A → asking Creative" landing on
the node with the evidence. That is `WalkRecord`, verbatim from
`src/org/walk.ts` and `src/org/store.ts`:

```ts
interface WalkRecord {
  walkId: string; companyId: string;
  originNodeId: string; question: string;
  steps: InvestigationStep[];
  done: boolean;
  landedNodeId: string | null;         // the node that becomes the active workspace
  answer: string | null;
}

interface InvestigationStep {
  id: string; walkId: string; sessionId: string | null;
  nodeId: string; nodeTitle: string;   // render nodeTitle as the hop label
  question: string;
  decision: "answered" | "delegated" | "referred" | "precedent";
  delegatedToNodeId: string | null;
  answer: string | null;
  ts: string;
}
```

Render one hop per `step`, appending live. `decision` is what distinguishes a
hop that answered from one that delegated. Max depth is 8 (`MAX_DEPTH`).

---

## 3. Endpoints by surface

### Front door
| method | path | returns |
|---|---|---|
| GET | `/api/companies` | `{ ok, companies: [{ id, name, state, updatedAt }] }` — `state` ∈ `live \| finalized \| draft \| empty`. **Key is `id`, not `companyId`.** |
| GET | `/api/users/me` | `{ ok, user: { id, email, isNewUser, wizardStep, wizardCompletedAt, wizardRepo, createdAt, updatedAt } }` — upsert-on-read |

### Build Your Organization (brief §2)
| method | path | notes |
|---|---|---|
| POST | `/wavex-os/onboarding/pillar/1` | `{ companyId, org_name, raw_input, manual_context, skipInference? }`. `manual_context` **must be ≥ 40 chars** or 400. Returns `{ ok, response, url_fetch? }` |
| POST | `/wavex-os/onboarding/pillar/2..5` | pillar 2 `{ claude_plan }`, 3 `{ product_state, stage }`, 4 `{ lead_sources, sales_motion, close_channel }`, 5 `{ comm_channel, urgency_routing }` |
| POST | `/wavex-os/onboarding/pillar/:n/suggest` | inline suggestions for a field |
| GET | `/wavex-os/onboarding/status?companyId=` | `{ ok, companyId, responses: { schema_version, started_at, completed_at, pillar_1..5 } }` — **the resume source of truth** |
| POST | `/wavex-os/onboarding/{connector,swarm,workflow}-manifest` | phase 2–3 generation; each accepts `skipInference` |
| GET | `/wavex-os/onboarding/plan-assembly?companyId=` · POST `/plan-assembly/start` | phase 3 research + planning feed |
| POST | `/wavex-os/onboarding/strategy` · `/scope` · `/analyze-refinement` · `/apply-refinement` · `/revert-refinement` | before/after/reason review (brief §2.4) |
| POST | `/wavex-os/onboarding/finalize` | `{ companyId, orgId, skipInference?, mc: { horizon_cycles, n_runs, seed } }` |
| POST | `/api/instance/:companyId/activate` | Birth. Inserts the org. **Slow — budget 60s**, returns `{ inserted: { companies, agents, kpis }, warnings: string[] }` |
| POST | `/api/instance/:companyId/adopt-product` | Path B entry — skips the MVP-build step |

**`url_fetch` — the state the brief demands and the UI does not yet render.**
When `raw_input` is a URL, pillar/1 returns:

```json
"url_fetch": { "url": "https://example.com/", "status": "unreachable", "reason": "fetch failed" }
```

`status` ∈ `ok | parked | thin | unreachable | timeout | unsafe_url`. The field
is **absent** when the operator typed prose — "no URL given" and "the URL
failed" are different facts. A non-`ok` status means the plan was built
**without** reading the site, and §10 forbids presenting that as if it read.
Say so on the surface.

**Timing you must design for:** pillar/1 with substantive input takes **~20
seconds** (a real enrichment call). It is *not* URL-specific — plain prose costs
the same. `"no product yet"`-style input returns in ~8ms. This is the single
place the brief's §6 "show what's actually happening" rule earns its keep.

### Canvas · Constitution · Hermes (brief §3)
| method | path | returns |
|---|---|---|
| GET | `/api/instance/:companyId/org/flywheel` | `{ ok, company, departments[], constitution, influence }` — all `OrgNodeDto` |
| GET | `/api/instance/:companyId/org/nodes/:nodeId` | one node + children + capabilities |
| POST | `/api/instance/:companyId/org/nodes/:nodeId/ask` | starts a walk; returns a `WalkRecord` |
| GET | `/api/instance/:companyId/org/walks/:walkId` | poll the walk |
| GET | `/api/instance/:companyId/org/investigations/recent` | `{ ok, steps: [] }` — verified shape, **observed empty**; step shape is §2 above |
| GET | `/api/instance/:companyId/org/constitution` | `{ ok, categories: [{ id, label, content, updatedAt, updatedByWalkId }] }` — `updatedByWalkId` ties an edit to the conversation that made it |
| GET · POST | `/api/instance/:companyId/org/memory` | what persists after an investigation closes ("Learned", brief §4) |
| GET · POST | `/api/instance/:companyId/canvas` | `{ ok, transcript[], proposals[], ledger[], desk: { pinned[] } }` |
| POST | `/api/instance/:companyId/canvas/commit` · `/canvas/pin` | promote a generated object into persistent structure (brief §1) |
| GET · POST | `/api/instance/:companyId/help-chat` | Hermes transcript |

### Runtime
| method | path | returns |
|---|---|---|
| GET | `/api/instance/:companyId/kpis` | `{ ok, companyId, kpis: [{ kpiId, label, direction, ownerRole, currentValue, provenance }] }` |
| GET | `/api/instance/:companyId/work` | `{ ok, goals, tasks, deliverables, runLog }` |
| GET | `/api/instance/:companyId/runtime/dashboard` | `{ ok, dashboard }` — inner shape **not verified**, probe before binding |
| GET | `/api/instance/:companyId/runtime/{activity,live-runs,approvals}` | live work for §4's contextual card |
| GET | `/api/instance/:companyId/token-usage` | `{ ok, usage: { total: { input_tokens, output_tokens, cost_usd, calls }, by_phase, recent_calls } }` — **zeroed, never 404**, for a fresh company |

---

## 4. What the brief asks for that the API does not provide

State these as gaps rather than building fiction around them.

- **`momentum` is always `null`.** The interface literally comments `// R1:
  honest cold start`. The backend refuses to invent it. Any momentum
  visualisation has nothing behind it today.
- **`health` is frequently `null`** on real nodes (verified: the company node
  and every department in a seeded org). `null` is *unknown*, not healthy — do
  not default it to teal.
- **No Evidence/Hypothesis/Confidence objects.** Brief §4's investigation
  anatomy is richer than the wire format: there is `answer`, `decision`, and
  memory entries. **Confidence is not a field anywhere.** Do not render "76%
  confidence" from nothing — that is §10's "AI theater" verbatim.
- **No agent roster endpoint by design**, matching §1's "the frontend never
  surfaces the roster" — though `kind: "agent"` nodes do exist (see §5).
- `/api/instance/:id/org/investigations/recent` returned `steps: []` on a
  seeded company. The empty state is the common one; build it first.

---

## 5. This resolves one of brief §13's open forks

**"Whether `agent` stays a first-class node kind."** It is already in the
union: `kind: "company" | "department" | "agent" | "metric" | "constitution"`.
Agents are addressable nodes with the same shape as everything else. That is
compatible with §1's rule that the *visible unit* is the workflow phase — the
kind exists in the model without being the thing you render at level 1.

**"Fixed vs. dynamic departments"** is settled in the backend's favour of
*dynamic*: departments come from `org/flywheel` per company (verified: 6 for
one seeded org, ids like `dept:cpo`). Ops/Growth/Product is an instantiation,
not a schema. Render whatever the array holds.

The remaining forks in §13 are unaffected by anything here.

---

## 6. Rules for the build

1. **Never invent an endpoint.** If a surface needs data not listed here, render
   the empty state and flag it — do not mock a route.
2. **Never fabricate confidence, momentum, or evidence counts.** They are not on
   the wire. §10 forbids it and §4's "a number, not a vibe" cannot be satisfied
   by inventing the number.
3. `ok: false` is a first-class render path, not an exception. Brief §6: errors
   preserve the workspace.
4. Long waits are real (~20s on pillar/1, up to 60s on activate). §6's
   "Observing signals ✓ / Gathering evidence ●" pattern is required, not
   decorative.
5. `null` ≠ zero ≠ healthy. Three different renders.
