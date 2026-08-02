# Paperclip backend deep dive + frontend design plan

**Purpose:** document what the Paperclip core backend actually exposes — routes, inputs, outputs,
service functions, auth, realtime — and design how much of it should surface in the wavex layer.
**Scope:** `packages/core` (vendored Paperclip subtree) and the wavex layer that hands off to it.
**Status:** analysis + proposal. No code changes.
**Read §1 first.** WaveX OS is intentionally two products — a creation half and a management half —
joined by an opt-in handoff. Several conclusions in this document only make sense against that.

---

## 1. Two parts by design: creation, then management

**WaveX OS is deliberately two products with a seam between them.** Understanding that seam is a
prerequisite for designing anything here — a plan that treats it as a bug will propose the wrong work.

| | **Part 1 — creation** | **Part 2 — management** |
|---|---|---|
| Owner | wavex-os (vendored) + wavex adapters | Paperclip (`packages/core`) |
| What it does | 5 pillars → 4 phases → Monte Carlo → sign → activate | heartbeats, issues, agents, budgets, board |
| API | Fastify, `:3101` | Express 5, `:3100` |
| UI | `packages/onboarding-ui`, `:5173` | `packages/core/ui`, `:5174` by convention |
| Ends when | the fleet is activated and mirrored | never — it is the runtime |

README states the split directly — onboarding is *"Owned by **wavex-os** — a full-fidelity
onboarding pipeline (12K LOC plugin + 2.4K LOC server + 5.4K LOC UI)"*, and its next section is
headed *"The runtime (Paperclip-backed)"*. `ARCHITECTURE.md` §1 frames the whole product as
*"the open-source product layer on top of Paperclip (the agent runtime engine)"*.

### 1.1 The seam is a contract, not a gap

`packages/wavex-os-server/src/bridge/paperclip-handoff.ts`, header comment:

> *"Opt-in via `PAPERCLIP_HANDOFF_URL` env var; when unset, this is a no-op and **bridgeAgents-only
> is the contract**."*

Part 1 completes and is valid on its own. Coupling to Part 2 is optional and explicitly opt-in.

The transition is a literal handoff. At the end of activate, `WavexOsOnboarding.tsx:178`:

```ts
window.open(paperclipUiUrl(pendingPaperclipUrl), "_blank", "noopener");
```

The wizard opens a **new browser tab into Paperclip's UI** and stops. `DEMO_RUNBOOK.md` scripts it
that way — *"Tab A — localhost:5173 (wavex wizard) · Tab B — localhost:5174 (paperclip)"*, and at
activate, *"a new tab opens to Paperclip's UI … switch to Tab B to show the receiving side."*

### 1.2 Activate → handoff → ignition

```
onboarding manifests on disk
   │
   ▼  POST /api/instance/:companyId/activate
bridgeAgents()          writes ~35 agents into the wavex DB      ← always runs
   │
   ▼  handoffToPaperclip()                                        ← opt-in
   │  mirrors the C-Suite into a live Paperclip company on :3100
   │  idempotent via ~/.wavex-os/instances/<id>/paperclip-handoff.json
   ▼
ignition()              seeds first tasks, creates the Goal,
                        wakes CEO + CoS, enables heartbeats
```

`detectAndConfigurePaperclip()` (`lib/paperclip-detect.ts`) pings `3100` then `3000` at boot and sets
`PAPERCLIP_HANDOFF_URL` automatically. It fingerprints the health response on `serverVersion` /
`deploymentMode` specifically so it cannot false-match mock-core:

> *"Otherwise we'd false-match wavex's own mock-core (which also serves `/api/health` on port 3101,
> and would loop the handoff back to itself if detected — exactly the bug we just hit in dev)."*

When nothing answers: *"paperclip not running locally; handoff disabled. Start it with
`cd packages/core && pnpm dev:server`."*

### 1.3 So what is mock-core for?

It is a documented stand-in, described in README:154 as *"In-memory **stand-in** for Paperclip;
Fastify on :3101"*. It exists so Part 1 can be developed and demoed without Part 2 running — which is
exactly what the opt-in contract above promises.

It also hosts the wavex Fastify routes via `registerWavexOsRoutes(app)`, so `:3101` serves two
different things: six mock Paperclip endpoints, and the ~56 real wavex-os onboarding routes. Only the
first six are fake.

`packages/core` being excluded from the root build (`package.json:21`) and from `pnpm dev` follows
from the same decision: Part 2 is a separate program with its own lifecycle, started with
`cd packages/core && pnpm dev:server`.

### 1.4 What this means for the reader

Two things are true at once, and conflating them causes bad plans:

- **The server-to-server integration is built and shipped.** Handoff, auto-detection, idempotent
  mapping, ignition — all real. Phase D in the roadmap.
- **The browser's dashboard reads still fall back to mock-core.** `HealthStrip` polls
  `/api/paperclip/health`, the proxy rewrites it to `/api/health`, and with default config that is
  mock-core's synthetic health, not Paperclip's. Same for `/api/agents`.

The first is by design. The second is a consequence of the proxy configuration in §1.6, and is worth
fixing only if you decide Mission Control should read live runtime state — which is a product
decision, not a defect. See §7.1.

### 1.5 mock-core's actual surface

Six routes. Note two of them are declared with generic type params
(`app.get<{ Params: … }>(…)`), so a naive grep misses them.

| Method | Path | Returns |
|---|---|---|
| GET | `/api/health` | `{ ok, service, version, agents, runs, companyDir }` |
| GET | `/api/agents` | in-memory agent list |
| GET | `/api/probe/claude-max` | Claude CLI / plan-tier probe |
| POST | `/api/spawn` | `{ runId }` — starts a simulated spawn |
| GET | `/api/runs/:runId` | run record |
| GET | `/api/spawn/:runId/events` | **SSE** — `progress` + `done` events, replays history on connect |

Plus `registerWavexOsRoutes(app)` at `server.ts:127-128`, which adds the wavex layer's ~56 Fastify
routes (`/api/instance/*`, `/api/observability/*`, `/wavex-os/onboarding/*`, billing, tiers).

`HealthStrip` polls `/api/paperclip/health`, which the Vite proxy rewrites to `/api/health` — so it
is reading mock-core's synthetic health, not Paperclip's.

### 1.6 The proxy, if you ever want Mission Control reading live state

This section is **conditional**. Under the two-part design, the browser is not required to reach
Paperclip at all — Part 2 has its own UI. Read this only if you decide Mission Control should show
live runtime state (§7.1 argues for a narrow version of that).

`packages/onboarding-ui/vite.config.ts` has three proxy rules:

```ts
"/api/paperclip": { target: WAVEX_CORE_URL ?? "http://127.0.0.1:3101",
                    rewrite: p => p.replace(/^\/api\/paperclip/, "/api") },
"/api":           { target: WAVEX_CORE_URL ?? "http://127.0.0.1:3101" },
"/wavex-os":      { target: WAVEX_CORE_URL ?? "http://127.0.0.1:3101" },
```

**All three read the same `WAVEX_CORE_URL`.** So there is no configuration in which
`/api/paperclip/*` reaches real core on 3100 while `/api/*` keeps reaching the wavex Fastify routes
on 3101. Setting `WAVEX_CORE_URL=http://127.0.0.1:3100` moves *everything* and breaks the entire
onboarding wizard.

The file's own header comment says API calls go to "the local Paperclip core (localhost:3100)". That
matches `ARCHITECTURE.md`'s original §2 diagram, in which the browser talked straight to `:3100`. The
two-tab handoff superseded that design; the comment and the diagram are both leftovers from it.

**If you want browser-side reads,** give `/api/paperclip` its own variable — note this is *additive*
and leaves the handoff path untouched.

```ts
"/api/paperclip": {
  target: process.env.WAVEX_PAPERCLIP_URL ?? process.env.WAVEX_CORE_URL ?? "http://127.0.0.1:3101",
  changeOrigin: true,
  ws: true,                              // required for §5 live events
  rewrite: p => p.replace(/^\/api\/paperclip/, "/api"),
},
```

Rule order also matters and is currently correct: `/api/paperclip` is declared **above** `/api`. Keep
it that way — Vite matches prefixes in insertion order.

### 1.7 The 5174 convention is not configured

The two-part design requires both UIs running side by side — Tab A and Tab B. The code assumes
Paperclip's UI is on **5174**, but derives that by string substitution rather than configuration:

```ts
// WavexOsOnboarding.tsx:28-34, duplicated in Materialize.tsx:18-20
/** Map paperclip API URL → UI URL (dev convention: 3100 → 5174). */
return apiUrl.replace(/:3100\b/, ":5174");
```

Meanwhile `packages/core/ui/vite.config.ts:26` sets `port: 5173` — the same port `onboarding-ui`
claims with `strictPort: true`. So out of the box the two UIs collide, and the "open Tab B" handoff
points at a port nothing is listening on.

**This is a real gap in the intended design, and a small one.** Set core/ui's dev port to 5174 (or
make it configurable and have the wavex side read the same value) so the documented two-tab flow
works without manual intervention. Also worth de-duplicating `paperclipUiUrl` — it exists twice, and
the header comment in `WavexOsOnboarding.tsx` says so.

---

## 2. Auth and the actor model

Every core request gets an `req.actor` from `actorMiddleware` (`server/src/middleware/auth.ts:21`).

### 2.1 Actor resolution order

1. **Deployment mode default.** `PAPERCLIP_DEPLOYMENT_MODE` ∈ `local_trusted | authenticated`,
   defaulting to **`local_trusted`** (`config.ts:170`). In `local_trusted`, every request starts as:

   ```ts
   { type: "board", userId: "local-board", userName: "Local Board",
     isInstanceAdmin: true, source: "local_implicit" }
   ```

   In `authenticated` mode it starts as `{ type: "none", source: "none" }`.

2. **`Authorization: Bearer <token>`** — resolves to either a board key
   (`source: "board_key"`) or an agent key (`type: "agent"`).
3. **Better-Auth session** (`authenticated` mode, `server/src/auth/better-auth.ts`).
4. **`x-paperclip-run-id`** header ties an agent actor to a heartbeat run.

So on localhost, with no configuration, **you are an instance-admin board actor**. This is why the
API feels open in dev.

### 2.2 `boardMutationGuard` — a CSRF check that will bite a cross-origin frontend

`server/src/middleware/board-mutation-guard.ts` runs before every `/api` route. For **non-safe
methods** by a **board** actor it requires `Origin` or `Referer` to be in a trusted set:
`http://localhost:3100`, `http://127.0.0.1:3100`, `http(s)://<request Host>`, and
`PAPERCLIP_PUBLIC_URL`.

Two bypasses (`board-mutation-guard.ts:61-64`):

```ts
if (req.actor.source === "local_implicit" || req.actor.source === "board_key") { next(); return; }
```

**What this means for a frontend on `:5173`:**

- In default `local_trusted` mode → `local_implicit` → **guard bypassed, mutations work.**
- In `authenticated` mode with a browser session → the browser sends `Origin: http://localhost:5173`.
  `changeOrigin: true` rewrites the **Host** header, not `Origin`, so the guard sees an untrusted
  origin and returns **403 `{ error: "Board mutation requires trusted browser origin" }`**.
- Fixes, in order of preference: set `PAPERCLIP_PUBLIC_URL=http://localhost:5173`, or serve the
  frontend from core's own origin, or authenticate with a board key.

Design the client so this 403 is a **distinguishable, actionable error state**, not a generic
failure — it is the single most likely integration wall.

### 2.3 How the wavex layer mirrors this

`@wavex-os/auth-shim` reimplements the same contract for the Fastify side — `assertBoard`,
`assertCompanyAccess`, `assertInstanceAdmin`, `assertBoardOrgAccess`, `assertAuthenticated`,
`hasBoardOrgAccess` — with `WAVEX_AUTH_MODE=dev` synthesizing the same `local_implicit` board actor.
The two layers agree on the actor shape; they just enforce it separately.

---

## 3. Domain model

### 3.1 Enum vocabularies

A frontend must render every one of these. All from `packages/core/packages/shared/src/constants.ts`.

| Enum | Values |
|---|---|
| `AGENT_STATUSES` | `active` `paused` `idle` `running` `error` `pending_approval` `terminated` |
| `AGENT_ROLES` | `ceo` `cto` `cmo` `cfo` `security` `engineer` `designer` `pm` `qa` `devops` `researcher` `general` |
| `AGENT_ADAPTER_TYPES` | `process` `http` `acpx_local` `claude_local` `codex_local` `gemini_local` `opencode_local` `pi_local` `cursor` `openclaw_gateway` (open union) |
| `ISSUE_STATUSES` | `backlog` `todo` `in_progress` `in_review` `done` `blocked` `cancelled` |
| `ISSUE_PRIORITIES` | `critical` `high` `medium` `low` |
| `GOAL_LEVELS` | `company` `team` `agent` `task` |
| `GOAL_STATUSES` | `planned` `active` `achieved` `cancelled` |
| `APPROVAL_TYPES` | `hire_agent` `approve_ceo_strategy` `budget_override_required` `request_board_approval` |
| `APPROVAL_STATUSES` | `pending` `revision_requested` `approved` `rejected` `cancelled` |
| `ROUTINE_STATUSES` | `active` `paused` `archived` |
| `ROUTINE_TRIGGER_KINDS` | `schedule` `webhook` `api` |
| `ROUTINE_RUN_STATUSES` | `received` `coalesced` `skipped` `issue_created` `completed` `failed` |
| `COMPANY_STATUSES` | `active` `paused` `archived` |
| `PAUSE_REASONS` | `manual` `budget` `system` |
| `PROJECT_STATUSES`, `ENVIRONMENT_*`, `FINANCE_*`, `SECRET_PROVIDERS` | see constants.ts |

`AGENT_ROLE_LABELS` (`constants.ts:60`) already provides display strings for roles — use it rather
than re-titling in the UI. `AGENT_ICON_NAMES` (`:81`) is a closed icon vocabulary.

### 3.2 `Agent` — the richest object in the system

`packages/core/packages/shared/src/types/agent.ts`

```ts
interface Agent {
  id, companyId, name, urlKey
  role: AgentRole; title: string | null; icon: string | null
  status: AgentStatus
  reportsTo: string | null          // org chart edge
  capabilities: string | null
  adapterType: AgentAdapterType
  adapterConfig: Record<string, unknown>
  runtimeConfig: { modelProfiles?: Partial<Record<"cheap", AgentModelProfileConfig>> }
  defaultEnvironmentId?: string | null
  budgetMonthlyCents: number; spentMonthlyCents: number
  pauseReason: PauseReason | null; pausedAt: Date | null
  permissions: { canCreateAgents: boolean }
  lastHeartbeatAt: Date | null
  metadata: Record<string, unknown> | null
  createdAt, updatedAt
}

interface AgentDetail extends Agent {
  chainOfCommand: AgentChainOfCommandEntry[]   // resolved ancestry — no client-side walk needed
  access: AgentAccessState                     // canAssignTasks + membership + grants
}
```

`budgetMonthlyCents` / `spentMonthlyCents` sit **on the agent**, so a per-agent budget meter needs no
join. `chainOfCommand` is server-resolved — do not rebuild it from `reportsTo` on the client.

### 3.3 `Issue` — the task record, and it is large

`types/issue.ts:242`. ~45 fields. The ones a UI actually needs:

- **Identity:** `id`, `issueNumber`, `identifier` (human-facing, e.g. `ENG-42`), `title`,
  `description`
- **Placement:** `companyId`, `projectId`, `goalId`, `parentId`, `ancestors[]`
- **State:** `status`, `priority`, `startedAt`, `completedAt`, `cancelledAt`, `hiddenAt`
- **Assignment:** `assigneeAgentId`, `assigneeUserId`
- **Execution/locking:** `checkoutRunId`, `executionRunId`, `executionAgentNameKey`,
  `executionLockedAt` — this is the concurrency mechanism; see §4.3
- **Relations:** `labels[]`, `blockedBy[]`, `blocks[]`, `blockerAttention`
- **Workspace:** `executionWorkspaceId`, `executionWorkspacePreference`, `executionWorkspaceSettings`
- **Policy:** `executionPolicy` (`normal | auto`), `executionState`
  (`idle | pending | changes_requested | completed`)
- **Provenance:** `originKind`, `originId`, `originRunId`, `originFingerprint`, `requestDepth`
  (capped at `MAX_ISSUE_REQUEST_DEPTH = 1024` — agents can create issues recursively)

Optional fields (`ancestors?`, `labels?`, `blockedBy?`) are **populated per-endpoint**. Never assume
a list response hydrates them; check the route.

### 3.4 `Goal` — small, hierarchical, and the natural spine for a dashboard

```ts
interface Goal {
  id, companyId, title, description: string | null
  level: "company" | "team" | "agent" | "task"
  status: "planned" | "active" | "achieved" | "cancelled"
  parentId: string | null            // self-referencing tree
  ownerAgentId: string | null
  createdAt, updatedAt
}
```

`goals` is a real table with a `parentId` self-reference and a `goals_company_idx` on `companyId`
(`packages/core/packages/db/src/schema/goals.ts`). Issues link to goals via `Issue.goalId`, and
`getDefaultCompanyGoal(db, companyId)` (`services/goals.ts:7`) resolves the headline goal with a
three-step fallback: active root company goal → any root company goal → any company-level goal.

**Note for the wavex layer:** this table lives in Paperclip's DB, *not* `@wavex-os/db` (whose 12
tables are `companies`, `agents`, `heartbeat_runs`, `company_kpis`, `kpi_snapshots`, `cost_events`,
`credentials`, `credential_audit_log`, `issues`, `issue_comments`, `task_outcome_attributions`).
There are two parallel `agents` and `issues` tables in this repo with different schemas.

### 3.5 `DashboardSummary` — a purpose-built aggregate

`types/dashboard.ts`. One call, `GET /api/companies/:companyId/dashboard`, returns everything a
landing page needs:

```ts
{
  companyId,
  agents:  { active, running, paused, error },
  tasks:   { open, inProgress, blocked, done },
  costs:   { monthSpendCents, monthBudgetCents, monthUtilizationPercent },
  pendingApprovals: number,
  budgets: { activeIncidents, pendingApprovals, pausedAgents, pausedProjects },
  runActivity: Array<{ date, succeeded, failed, other, total }>,
}
```

This is the endpoint a Mission Control rewrite should be built on. It replaces the current
KpiBoard + HealthStrip + FleetGraph fan-out with a single request.

---

## 4. API surface by domain

All paths are relative to `/api`. Through the wavex proxy they become `/api/paperclip/...`.

### 4.1 Read-only aggregates — build the dashboard from these

| Method | Path | Output |
|---|---|---|
| GET | `/companies/:companyId/dashboard` | `DashboardSummary` (§3.5) |
| GET | `/companies` | company list |
| GET | `/companies/stats` | cross-company rollup |
| GET | `/companies/:companyId` | company detail |
| GET | `/companies/:companyId/org` | org chart (nodes + edges) |
| GET | `/companies/:companyId/org.svg` · `.png` | **server-rendered** org chart |
| GET | `/companies/:companyId/sidebar-badges` | unread/pending counts for nav |
| GET | `/health` | core health |

`org.svg` is worth noting: the wavex UI currently ships `reactflow` (a heavy dependency, plus a
global third-party stylesheet) to draw an org graph the backend can already render.

### 4.2 Agents — 55 routes, the largest surface

**Read**

| Method | Path | Notes |
|---|---|---|
| GET | `/companies/:companyId/agents` | list |
| GET | `/agents/:id` | `AgentDetail` incl. `chainOfCommand` + `access` |
| GET | `/agents/me` · `/agents/me/inbox-lite` · `/agents/me/inbox/mine` | agent-actor self endpoints |
| GET | `/agents/:id/configuration` · `/config-revisions` · `/config-revisions/:revisionId` | config history |
| GET | `/agents/:id/runtime-state` · `/task-sessions` | live runtime |
| GET | `/agents/:id/skills` · `/instructions-bundle` · `/instructions-bundle/file` | instruction files |
| GET | `/agents/:id/keys` | API keys (no secrets) |
| GET | `/companies/:companyId/agent-configurations` | bulk config |
| GET | `/companies/:companyId/adapters/:type/models` · `/model-profiles` · `/detect-model` | model discovery |

**Mutate**

| Method | Path | Notes |
|---|---|---|
| POST | `/companies/:companyId/agents` | create |
| POST | `/companies/:companyId/agent-hires` | hire flow — creates a `hire_agent` **approval** |
| PATCH | `/agents/:id` | update |
| PATCH | `/agents/:id/permissions` · `/instructions-path` · `/instructions-bundle` | |
| PUT/DELETE | `/agents/:id/instructions-bundle/file` | file-level edit |
| POST | `/agents/:id/pause` · `/resume` · `/approve` · `/terminate` | lifecycle |
| DELETE | `/agents/:id` | |
| POST | `/agents/:id/keys` · DELETE `/keys/:keyId` | key mint/revoke |
| POST | `/agents/:id/wakeup` · `/heartbeat/invoke` | **kick the agent into running** |
| POST | `/agents/:id/claude-login` | adapter auth |
| POST | `/agents/:id/config-revisions/:revisionId/rollback` | |
| POST | `/agents/:id/runtime-state/reset-session` | |

**Runs** — the execution telemetry a live UI needs

| Method | Path | Notes |
|---|---|---|
| GET | `/companies/:companyId/heartbeat-runs` · `/live-runs` | history / in-flight |
| GET | `/heartbeat-runs/:runId` · `/events` · `/log` | run detail, event stream, raw log |
| GET | `/heartbeat-runs/:runId/workspace-operations` · `/workspace-operations/:id/log` | |
| POST | `/heartbeat-runs/:runId/cancel` · `/watchdog-decisions` | |
| GET | `/issues/:issueId/live-runs` · `/active-run` | per-issue liveness |
| GET | `/instance/scheduler-heartbeats` | scheduler health |

### 4.3 Issues — 50 routes

**Core CRUD + tree**

| Method | Path |
|---|---|
| GET | `/issues` · `/companies/:companyId/issues` · `/issues/:id` |
| GET | `/issues/:id/heartbeat-context` |
| POST | `/companies/:companyId/issues` · `/issues/:id/children` |
| PATCH · DELETE | `/issues/:id` |

**Checkout — the concurrency model.** This is the part a UI must respect:

| Method | Path | Meaning |
|---|---|---|
| POST | `/issues/:id/checkout` | claim exclusive execution; sets `checkoutRunId` |
| POST | `/issues/:id/release` | release own claim |
| POST | `/issues/:id/admin/force-release` | board override of a stuck lock |

`issueService.assertCheckoutOwner` enforces it server-side. A UI showing `executionLockedAt` /
`executionAgentNameKey` should render an issue as *locked by X* and offer force-release only to a
board actor.

**Threads, comments, interactions**

| Method | Path |
|---|---|
| GET/POST | `/issues/:id/comments` · `/interactions` |
| GET/DELETE | `/issues/:id/comments/:commentId` |
| GET/POST | `/issues/:id/feedback-votes` · GET `/feedback-traces` · `/feedback-traces/:traceId(/bundle)` |

**Interaction lifecycle** — four routes that a flat comment UI would completely miss:

| Method | Path |
|---|---|
| POST | `/issues/:id/interactions/:interactionId/accept` |
| POST | `/issues/:id/interactions/:interactionId/reject` |
| POST | `/issues/:id/interactions/:interactionId/respond` |
| POST | `/issues/:id/interactions/:interactionId/cancel` |

`ISSUE_THREAD_INTERACTION_KINDS` / `_STATUSES` / `_CONTINUATION_POLICIES` mean the thread is a
**structured interaction log**, not a flat comment list — an interaction can be pending, can be
accepted or rejected by the operator, and its continuation policy gates whether the agent resumes.

**This is the second human-in-the-loop surface, and it is easy to overlook.** Approvals (§4.5) are
the coarse gate; interactions are the fine-grained one, living inside an issue thread. A UI that
renders `/issues/:id/interactions` as ordinary comments will show pending decisions with no way to
act on them — and the agent will sit blocked. Render a pending interaction as a card with
Accept / Reject / Respond, exactly like a proposal.

Document revisions are also restorable: `POST /issues/:id/documents/:key/revisions/:revisionId/restore`.

**Documents, work products, attachments, labels, inbox**

| Method | Path |
|---|---|
| GET/PUT/DELETE | `/issues/:id/documents(/:key)` · GET `/documents/:key/revisions` |
| GET/POST | `/issues/:id/work-products` · PATCH/DELETE `/work-products/:id` |
| GET/POST/DELETE | `/issues/:id/attachments` · `/companies/:companyId/issues/:issueId/attachments` · `/attachments/:attachmentId(/content)` |
| GET/POST/DELETE | `/companies/:companyId/labels` · `/labels/:labelId` |
| POST/DELETE | `/issues/:id/read` · `/issues/:id/inbox-archive` |
| GET/POST/DELETE | `/issues/:id/approvals(/:approvalId)` |

Document key `continuation-summary` is reserved (`SYSTEM_ISSUE_DOCUMENT_KEYS`) — do not let a UI
overwrite it.

### 4.4 Goals — only 5 routes

| Method | Path | Input |
|---|---|---|
| GET | `/companies/:companyId/goals` | — |
| GET | `/goals/:id` | — |
| POST | `/companies/:companyId/goals` | `createGoalSchema` |
| PATCH | `/goals/:id` | `updateGoalSchema` (= create, partial) |
| DELETE | `/goals/:id` | — |

```ts
createGoalSchema = z.object({
  title:        z.string().min(1),
  description:  z.string().optional().nullable(),
  level:        z.enum(GOAL_LEVELS).optional().default("task"),
  status:       z.enum(GOAL_STATUSES).optional().default("planned"),
  parentId:     z.string().uuid().optional().nullable(),
  ownerAgentId: z.string().uuid().optional().nullable(),
})
```

`GET /companies/:companyId/goals` returns a **flat list**. The tree is the client's to assemble from
`parentId` — that is the one place client-side hierarchy building is correct.

### 4.5 Approvals — the human-in-the-loop surface

| Method | Path |
|---|---|
| GET | `/companies/:companyId/approvals` · `/approvals/:id` · `/approvals/:id/issues` |
| POST | `/companies/:companyId/approvals` |
| POST | `/approvals/:id/approve` · `/reject` · `/resubmit` |
| POST | `/approvals/:id/request-revision` |
| GET/POST | `/approvals/:id/comments` |

All four decisions have routes: `approve`, `reject`, `request-revision`, `resubmit`, matching
`approvalService`'s methods and the `revision_requested` status. `approve` / `reject` /
`request-revision` all validate against `resolveApprovalSchema` and accept a `decisionNote`.

> **Counting hazard.** `POST /approvals/:id/request-revision` is declared across two lines
> (`router.post(\n  "/approvals/:id/request-revision"`), so a single-line
> `grep 'router.post("'` misses it — along with **30 other routes**. Always match multi-line when
> inventorying this codebase. The full set of easy-to-miss routes is listed in §4.9.

### 4.6 Routines — scheduled and triggered work

| Method | Path | Notes |
|---|---|---|
| GET/POST | `/companies/:companyId/routines` | |
| GET/PATCH | `/routines/:id` | |
| GET | `/routines/:id/runs` | run history |
| POST | `/routines/:id/run` | manual fire |
| POST | `/routines/:id/triggers` · PATCH/DELETE `/routine-triggers/:id` | |
| POST | `/routine-triggers/public/:publicId/fire` | **public webhook — unauthenticated by design** |

Trigger signing modes: `bearer`, `hmac_sha256`, `github_hmac`, `none`. Concurrency policies:
`coalesce_if_active`, `always_enqueue`, `skip_if_active`. Catch-up: `skip_missed`,
`enqueue_missed_with_cap`. These are all operator-facing settings a routine editor must expose.

### 4.7 Costs and budgets — 20 routes, all pre-aggregated

| Method | Path |
|---|---|
| GET | `/companies/:companyId/costs/summary` · `/by-agent` · `/by-agent-model` · `/by-provider` · `/by-biller` · `/by-project` |
| GET | `/companies/:companyId/costs/finance-summary` · `/finance-by-biller` · `/finance-by-kind` · `/finance-events` |
| GET | `/companies/:companyId/costs/window-spend` · `/quota-windows` |
| GET | `/companies/:companyId/budgets/overview` · `/issues/:id/cost-summary` |
| POST | `/companies/:companyId/cost-events` · `/finance-events` |
| PATCH | `/companies/:companyId/budgets` · `/agents/:agentId/budgets` |
| POST | `/companies/:companyId/budgets/policies` |
| POST | `/companies/:companyId/budget-incidents/:incidentId/resolve` |

`budgets/overview` reports `activeIncidents`; `budget-incidents/:id/resolve` is how an operator clears
one. That pair is a complete, small feature — surface the incident and give it a resolve action.

Every breakdown a cost dashboard needs already exists server-side. **Do not aggregate cost events in
the browser.** All money is integer **cents** — never floats.

### 4.8 Everything else

`projects.ts` (11) · `environments.ts` (10) · `execution-workspaces.ts` (7) · `company-skills.ts`
(10) · `secrets.ts` (6) · `access.ts` (38) · `plugins.ts` (26) · `adapters.ts` (9) ·
`instance-settings.ts` (6) · `issue-tree-control.ts` (6) · `activity.ts` (5) ·
`sidebar-preferences.ts` (4) · `llms.ts` (3) · `auth.ts` (3) · `assets.ts` (3) ·
`inbox-dismissals.ts` (2) · `user-profiles.ts` · `sidebar-badges.ts` ·
`instance-database-backups.ts` · `dashboard.ts` · `health.ts`.

`access.ts` at 38 routes is the third-largest surface — memberships, roles, invites, and permission
grants. Any multi-user frontend lives or dies on it. Its multi-line routes cover CLI auth challenges,
invite acceptance, join-request approval, member role/grant editing, and instance-admin
promote/demote (§4.9).

### 4.9 The 31 routes a single-line grep misses

Declared as `router.post(\n  "/path"` — invisible to `grep 'router.post("'`. Listed in full because
an inventory that omits them looks complete and is not.

```
access.ts              POST   /cli-auth/challenges
                       POST   /cli-auth/challenges/:id/approve
                       POST   /cli-auth/challenges/:id/cancel
                       POST   /companies/:companyId/openclaw/invite-prompt
                       POST   /invites/:token/accept
                       POST   /companies/:companyId/join-requests/:requestId/approve
                       POST   /companies/:companyId/join-requests/:requestId/reject
                       POST   /join-requests/:requestId/claim-api-key
                       PATCH  /companies/:companyId/members/:memberId
                       PATCH  /companies/:companyId/members/:memberId/role-and-grants
                       PATCH  /companies/:companyId/members/:memberId/permissions
                       POST   /companies/:companyId/members/:memberId/archive
                       POST   /admin/users/:userId/promote-instance-admin
                       POST   /admin/users/:userId/demote-instance-admin
agents.ts              POST   /companies/:companyId/adapters/:type/test-environment
                       POST   /agents/:id/skills/sync
approvals.ts           POST   /approvals/:id/request-revision
company-skills.ts      POST   /companies/:companyId/skills/import
                       POST   /companies/:companyId/skills/scan-projects
costs.ts               POST   /companies/:companyId/budgets/policies
                       POST   /companies/:companyId/budget-incidents/:incidentId/resolve
environments.ts        POST   /companies/:companyId/environments/probe-config
instance-settings.ts   POST   /instance/settings/experimental/issue-graph-liveness-auto-recovery/preview
                       POST   /instance/settings/experimental/issue-graph-liveness-auto-recovery/run
issue-tree-control.ts  POST   /issues/:id/tree-holds/:holdId/release
issues.ts              POST   /issues/:id/documents/:key/revisions/:revisionId/restore
                       POST   /issues/:id/interactions/:interactionId/accept
                       POST   /issues/:id/interactions/:interactionId/reject
                       POST   /issues/:id/interactions/:interactionId/respond
                       POST   /issues/:id/interactions/:interactionId/cancel
routines.ts            POST   /routine-triggers/:id/rotate-secret
```

Regex that catches everything:

```bash
rg -U -o 'router\.(get|post|put|patch|delete)\(\s*"([^"]+)"' packages/core/server/src/routes/
```

---

## 5. Realtime

Two mechanisms, and the wavex proxy supports neither today.

### 5.1 WebSocket — live company events

`server/src/realtime/live-events-ws.ts`, using `ws` with `noServer: true` and a manual
`server.on("upgrade")` handler.

- **Path:** `GET /api/companies/:companyId/events/ws` (regex-matched at `:64`)
- **Auth:** `?token=` query param, or headers, via `authorizeUpgrade`
- Rejects the upgrade with a proper HTTP status on bad company id or failed authorization

The Vite proxy has **no `ws: true`** on any rule, so this cannot be reached from `:5173` today.
Adding `ws: true` to the `/api/paperclip` rule is the fix.

### 5.2 SSE

- Core: `routes/plugins.ts:1392` sets `text/event-stream` for plugin event streams.
- mock-core: `GET /api/spawn/:runId/events`, which **replays buffered events on connect** before
  subscribing — a good pattern to copy, since it makes reconnection lossless.

### 5.3 What the wavex UI does instead

Polling, in three inconsistent idioms: raw `setInterval` (`HealthStrip` 5s, `FleetGraph` 8s,
`T2ProgressIndicator` 1.5s), React Query `refetchInterval` (5s/30s/60s), and a bounded
`for`-loop with `setTimeout` in `pages/Pricing.tsx` (30 × 2s). Six different cadences, no shared
policy.

---

## 6. The service layer

38 factories in `server/src/services/`, all shaped as `xService(db)` returning a method object.
Routes are thin; the services hold the logic. Notable method sets:

**`agentService(db)`** — `list` `create` `update` `pause` `resume` `terminate` `remove`
`activatePendingApproval` `updatePermissions` `listConfigRevisions` `getConfigRevision`
`rollbackConfigRevision` `createApiKey` `listKeys` `getKeyById` `revokeKey` `orgForCompany`
`getChainOfCommand` `runningForAgent` `resolveByReference`

**`issueService(db)`** — `list` `getById` `getByIdentifier` `create` `createChild` `update` `remove`
`checkout` `assertCheckoutOwner` `release` `adminForceRelease` `markRead` `markUnread`
`archiveInbox` `unarchiveInbox` `getRelationSummaries` `getDependencyReadiness`
`listDependencyReadiness` `listBlockerAttention` `listProductivityReviews`
`listWakeableBlockedDependents` `getWakeableParentAfterChildCompletion` `listLabels` `createLabel`
`deleteLabel` `listComments` `addComment` `getComment` `removeComment` `getCommentCursor`
`createAttachment` `listAttachments` `removeAttachment` `findMentionedAgents`
`findMentionedProjectIds` `getAncestors` `countUnreadTouchedByUser`

The `listWakeable*` / `getWakeableParentAfterChildCompletion` methods reveal the scheduler's
dependency-driven wake model — completing a child can wake a parent.

**`heartbeatService(db)`** — `list` `getRuntimeState` `listTaskSessions` `resetRuntimeSession`
`listEvents` `getRetryExhaustedReason` `readLog` `invoke` `wakeup` `reportRunActivity`
`scheduleBoundedRetry` `tickTimers` `cancelRun` `cancelActiveForAgent` `getRunIssueSummary`
`getActiveRunForAgent` `getActiveRunIssueSummaryForAgent`

**`approvalService(db)`** — `list` `getById` `create` `approve` `reject` `requestRevision` `resubmit`
`listComments` `addComment`

**`routineService(db)`** — `get` `getTrigger` `list` `getDetail` `create` `update` `createTrigger`
`updateTrigger` `deleteTrigger` `rotateTriggerSecret` `runRoutine` `firePublicTrigger` `listRuns`
`tickScheduledTriggers` `syncRunStatusForIssue`

**`dashboardService(db)`** — `summary` only. One method, one endpoint, the whole landing page.

**`goalService(db)`** — `list` `getById` `getDefaultCompanyGoal` `create` `update` (+ delete)

Others: `accessService` `activityService` `agentInstructionsService` `assetService`
`boardAuthService` `budgetService` `companyPortabilityService` `companyService`
`companySkillService` `costService` `documentService` `environmentRuntimeService`
`environmentService` `executionWorkspaceService` `feedbackService` `financeService`
`inboxDismissalService` `instanceSettingsService` `issueApprovalService` `issueReferenceService`
`issueThreadInteractionService` `issueTreeControlService` `pluginDatabaseService`
`pluginRegistryService` `productivityReviewService` `projectService` `secretService`
`sidebarBadgeService` `sidebarPreferenceService` `workProductService` `workspaceOperationService`.

---

## 7. Frontend design

### 7.1 The decision to make first

`packages/core/ui` **already exists** and already consumes this backend: **120 `<Route>` declarations**,
React 19, react-router-dom 7.1, Tailwind v4 (`@tailwindcss/vite`), shadcn-style `@/components/ui/*`,
React Query 5.90, `useMutation`, vitest 3, Storybook, and working pages for Goals, Issues, Approvals,
Routines, Projects, and Costs. It imports `@paperclipai/shared` directly, so its types are the
backend's types.

`packages/onboarding-ui` is React 18, react-router-dom 6.26, hand-written inline styles (588
`style={{}}` vs 136 `className`), no tests, and zero `useMutation`.

Note core/ui routes through a **company-prefix-injecting shim** at `src/lib/router.tsx` — a plain
`<Link to="/foo">` there silently becomes `/<companyPrefix>/foo`. Do not copy its navigation code
into the wavex app.

**Under the two-part design, core/ui is not a candidate — it *is* Part 2.** The wizard already opens
it in a new tab (§1.1). So the question is not "which frontend do we build," it is the much narrower:

> **How much of Part 2, if any, should be visible from Part 1?**

Three answers:

| Option | What it means | Cost | Risk |
|---|---|---|---|
| **A. Pure handoff** | Mission Control stays a Part-1 artifact — onboarding status, manifest, activation result. Everything live lives in Tab B. | Zero | Operator has no single place to see whether the fleet is actually working |
| **B. Thin live strip** *(recommended)* | Mission Control adds a small read-only window onto Part 2 — is the fleet ignited, how many agents working, anything blocked — and deep-links into core/ui for detail | Low | Needs the proxy split (§1.6) and the port fix (§1.7) |
| **C. Full management surface in wavex** | Reimplement fleet, queue, approvals, spend in `onboarding-ui` | Highest — duplicates 120 working screens across a 323-route API | Guaranteed divergence; contradicts the architecture |

**Recommendation: B.** The justification is not aesthetic — it is that the documented success
criterion for ignition lives on the wavex side. `IGNITION.md` §5:

> *"within 5 minutes of a successful activate … the operator sees a **Mission Control banner** reading
> 'Fleet ignited — N agents working, M workflows queued'."*

and its failure table routes recovery through Mission Control too: *"Operator hits '**Ignite Fleet**'
button in Mission Control to retry."* So a small amount of Part-2 state is *already specified* to
surface in Part 1. Option B builds exactly that and nothing more.

**Option C is the one to avoid.** It is not merely expensive — it rebuilds the thing the handoff
hands off to.

What follows designs B. The screen designs in §7.3 are deliberately written so each one can be
dropped without affecting the others, and so anything beyond the live strip is an explicit,
reversible decision rather than a drift into Option C.

### 7.2 Information architecture

The full surface map is below **so the shape of Option C is visible and costed**, not because all of
it should be built. Under the recommended Option B only `/` is new work in `onboarding-ui`; the rest
is what you would deep-link into core/ui for, and what you would be reimplementing if you chose C.

Each maps to endpoints that already return exactly what they need.

```
/                    Mission Control      GET /companies/:id/dashboard          (1 call)
/fleet               Fleet                GET /companies/:id/agents
                                          GET /companies/:id/live-runs
                                          GET /companies/:id/org(.svg)
/fleet/:agentId      Agent detail         GET /agents/:id                       (AgentDetail)
                                          GET /agents/:id/runtime-state
                                          GET /companies/:id/heartbeat-runs?agentId=
/queue               Work queue           GET /companies/:id/issues?status=…
                                          GET /companies/:id/labels
/queue/:issueId      Issue thread         GET /issues/:id
                                          GET /issues/:id/interactions
                                          GET /issues/:id/live-runs
/approvals           Approvals tray       GET /companies/:id/approvals?status=pending
/spend               Spend                GET /companies/:id/costs/summary
                                          GET /companies/:id/costs/by-agent
                                          GET /companies/:id/budgets/overview
```

**Two distinct human-in-the-loop queues, and both must be reachable.** `/approvals` is the coarse
gate — `hire_agent`, `budget_override_required`, and friends. `/queue/:issueId` carries the
fine-grained one: pending thread *interactions* that block an agent until accepted, rejected, or
answered (§4.3). A frontend that ships only `/approvals` leaves agents silently blocked with no
operator affordance. If only one gets built first, build the interactions view — a blocked agent is
worse than a queued approval.

This is also, near-verbatim, the "Coming next" list already printed in `MissionControl.tsx:117-121`
— workflows queue, approvals tray, workspace tray. The backend supports all of it today.

### 7.3 Screen designs

**Mission Control (`/`)** — one request, four bands.

```
┌─────────────────────────────────────────────────────────────┐
│ WaveX OS · Mission Control      [company ▾]   ● core ok     │
├─────────────────────────────────────────────────────────────┤
│  HEADLINE GOAL                                              │
│  <getDefaultCompanyGoal().title>          planned│active    │
│  ───────────────────────────────────────────────────────    │
│  AGENTS            TASKS              SPEND                 │
│  4 active          12 open            $48.10 / $200.00      │
│  1 running         3 in progress      24% of month          │
│  0 paused          1 blocked                                │
│  0 error           31 done                                  │
├─────────────────────────────────────────────────────────────┤
│  ⚠ 2 approvals pending                        [Review →]    │
├─────────────────────────────────────────────────────────────┤
│  RUN ACTIVITY (14d)   ▁▂▅▃▇▅▂▁▃▅▇▆▃▂                       │
│                       succeeded / failed / other            │
└─────────────────────────────────────────────────────────────┘
```

Every number above comes from the single `DashboardSummary`. `runActivity` is already bucketed by
day with `succeeded`/`failed`/`other`/`total` — a stacked bar needs no client math. The approvals
banner uses `pendingApprovals`; it should only render when `> 0`.

**Fleet (`/fleet`)** — roster plus org, with live-run overlay.

Two panes: a table of `Agent` rows (name, role via `AGENT_ROLE_LABELS`, status dot, adapter,
`spentMonthlyCents / budgetMonthlyCents` meter, `lastHeartbeatAt` as relative time), and the org
chart. **Use `GET /companies/:id/org.svg`** — an `<img>` tag replaces `reactflow` entirely, along
with its global stylesheet injection. Reach for the JSON `/org` endpoint only if nodes must be
interactive.

Overlay `live-runs` onto the roster so a `running` agent shows its current issue title inline.

**Agent detail (`/fleet/:agentId`)** — `AgentDetail` gives `chainOfCommand` and `access` in the same
payload, so the breadcrumb and the permission state need no extra calls. Tabs: Overview,
Runs (`/heartbeat-runs`, drill to `/events` and `/log`), Configuration (with `config-revisions` and
rollback), Instructions (`instructions-bundle`), Keys.

Lifecycle actions map one-to-one: `pause` `resume` `terminate` `wakeup` `heartbeat/invoke`
`runtime-state/reset-session`. **`terminate` and `DELETE` need a typed confirmation** — they are
irreversible.

**Approvals (`/approvals`)** — a decision queue, not a table. One card per approval: type
(`hire_agent` reads very differently from `budget_override_required`), requester, linked issues from
`/approvals/:id/issues`, comment thread, and Approve / Reject. Only surface Reject-with-comment if
you have confirmed a revision route exists (§4.5).

**Spend (`/spend`)** — `costs/summary` for the headline, `by-agent` as a ranked bar, `budgets/overview`
for incidents and paused entities, `quota-windows` for window state. All integer cents; format once,
in one helper.

### 7.4 Client architecture

```
src/paperclip/
├── client.ts          typed fetch wrapper over /api/paperclip
├── types.ts           re-export from @paperclipai/shared — do NOT redeclare
├── queries.ts         React Query hooks, one per endpoint
├── live.ts            WebSocket client for /companies/:id/events/ws
└── format.ts          cents, relative time, status→tone
```

**Types.** `@paperclipai/shared` already exports every interface and every zod validator. Importing
them is the difference between a client that stays correct and one that drifts. `packages/core` is a
vendored subtree, so its types are stable to import and should not be hand-copied.

**Client.** One wrapper, mirroring the conventions the wavex layer already established in
`src/wavex-os/lib/api.ts` — a `call<T>()` that throws a typed error — plus one addition that file
lacks: **`AbortSignal` support**, so React Query can cancel. (`api.ts` accepts no signal, and
`Pillar1.tsx:144-176` already has an `AbortController` whose signal is never passed to the request,
making its `AbortError` branch unreachable. Do not repeat that.)

Errors the client must distinguish, because each needs different UI:

| Status | Meaning | UI |
|---|---|---|
| 401 | no actor (`authenticated` mode, no session) | sign-in prompt |
| 403 `Board mutation requires trusted browser origin` | §2.2 — the origin guard | config banner, **not** a permission error |
| 403 other | genuine permission failure | explain what is missing |
| 409 | checkout conflict (§4.3) | "locked by X", offer force-release to board |
| 429 | quota / budget | show `budgets/overview` |

**State.** React Query for all server state. Do not introduce a client store — `store.ts` in the
wavex UI is 111 lines of Zustand with zero importers, and reviving it for this would be the wrong
first consumer. Navigational state stays in the URL, matching the existing `?companyId=` convention
(`CompanyContext.tsx`) — always copy the existing params (`new URLSearchParams(searchParams)`) before
writing, as both current writers correctly do.

**Query keys.** Namespace them so they cannot collide with the existing `["companies"]` key, which
already has two different producers with two different fetchers:

```ts
["pc", "dashboard", companyId]
["pc", "agents", companyId]
["pc", "agent", agentId]
["pc", "approvals", companyId, { status }]
```

**Writes.** The existing app has **zero** `useMutation` calls; the house pattern is a hand-rolled
`busy`/`error` pair plus `invalidateQueries`. For a new module that is mostly mutations — approve,
reject, pause, resume, terminate — `useMutation` is genuinely the better tool. Introduce it
deliberately, in `src/paperclip/` only, and say so in the PR rather than letting two conventions
appear by accident.

**Realtime.** Replace polling with the WebSocket at `/companies/:companyId/events/ws`: on message,
`invalidateQueries` the affected key rather than merging payloads by hand. Keep a slow
`refetchInterval` (60s) as a safety net, and fall back to polling if the socket fails to connect —
which it will until `ws: true` is added to the proxy (§1.2).

### 7.5 Visual system

The Helm spec (`docs/HELM_SPEC.md`) §3 defines the additive token extension this should share:
`--brand` for identity, a **new `--success`** so teal is not simultaneously brand and health, and the
three global contracts the app has never had (`:focus-visible`, `prefers-reduced-motion`,
`@media` breakpoints). Land that first; both surfaces need it.

Status→tone, using the enums from §3.1:

| Tone | Agent | Issue | Approval | Goal |
|---|---|---|---|---|
| `--success` | `active` `running` | `done` | `approved` | `achieved` `active` |
| `--warning` | `idle` `paused` `pending_approval` | `in_review` `blocked` | `pending` `revision_requested` | `planned` |
| `--danger` | `error` | — | `rejected` | — |
| `--text-dim` | `terminated` | `backlog` `cancelled` | `cancelled` | `cancelled` |

Two constraints from the existing codebase: **purple is already taken** (`#b88dff` means "derived" in
`Pillar4.tsx` and across the vendored upstream), and **`--danger` currently reaches the screen in only
two places** — most failure states in this app render orange. Using red correctly in a new surface is
fine; retrofitting it across the old ones is a visible change and a separate decision.

### 7.6 Phasing

**Phases 0–2 complete the two-part design as already specified. Phase 3 onward is optional scope that
should be argued for on its own merits, because each step moves toward Option C.**

| Phase | Work | Why | Option |
|---|---|---|---|
| **0** | Set core/ui's dev port to 5174 and de-duplicate `paperclipUiUrl` (§1.7) | The documented Tab A → Tab B handoff currently points at a dead port | design fix |
| **1** | Split the proxy target (`WAVEX_PAPERCLIP_URL`), add `ws: true` (§1.6) | Lets Part 1 read Part 2 without moving the wizard's own traffic | design fix |
| **2** | `src/paperclip/` client + the **ignition banner and Ignite Fleet button** | Already specified in `IGNITION.md` §5 and its recovery table — this is unbuilt spec, not new scope | **B** |
| **3** | Rebuild Mission Control's live panel on the single `/dashboard` call | Replaces the KpiBoard/HealthStrip/FleetGraph fan-out with one real request | B |
| **4** | Blocked-work indicator: count pending thread interactions + approvals, deep-link into core/ui | A blocked agent is invisible today; core/ui shows it but nobody is looking at Tab B | B |
| **5** | `/fleet` read-only roster using `org.svg` | Lets `reactflow` and its global stylesheet be dropped | B/C edge |
| **6** | `/queue`, `/approvals`, `/spend` as full surfaces | Duplicates core/ui — **only if** you have decided wavex owns management | **C** |
| **7** | Swap polling for the live-events WebSocket | Removes six polling cadences | B |

Phases 0 and 1 are configuration, roughly a dozen lines between them. Phase 2 is the highest-value
work in this document because it is already written down as a requirement and simply has not been
built. **Phase 6 should not be started without an explicit decision to reverse §7.1.**

### 7.7 Risks

1. **The fleet lands switched off.** This is the real gap in the two-part design, and it is already
   documented — `IGNITION.md`: *"Activate is declarative — it writes 34+ rows to `agents`, mirrors
   them to Paperclip, and **stops**. The fleet then **sits idle** because
   `runtimeConfig.heartbeat.enabled = false` is hard-coded in the handoff
   (`paperclip-handoff.ts:219`) and the `workflow_manifest.on_fire` task list is never converted into
   actual Paperclip issues."* Any UI that reports "activated" without reporting *ignited* will tell
   the operator the opposite of the truth.

2. **Only 7 of ~35 agents cross the seam.** `paperclip-handoff.ts` hires the C-Suite and explicitly
   skips L·IV specialists — *"mapping to Paperclip's constrained role enum is lossy for sub-roles;
   that's a v2 mapping problem."* So the wavex DB and the Paperclip company hold different rosters,
   and a fleet count taken from one will not match the other. Label which side any count came from.

3. **`packages/core` is a vendored subtree.** It is not on `CLAUDE.md`'s frozen list, but editing it
   complicates subtree pulls. Treat it as read-only: import its types, call its API, do not patch it.
   The one exception this document recommends — the 5174 dev port (§1.7) — is a one-line config
   change; weigh even that against the subtree-pull cost.
4. **Two `agents` tables and two `issues` tables** exist with different schemas — Paperclip's and
   `@wavex-os/db`'s. A UI must know which backend a record came from. This is the most likely source
   of a subtle data bug.
5. **The origin guard (§2.2)** will block board mutations the moment anyone switches to
   `authenticated` mode. Handle the 403 explicitly from day one.
6. **`packages/core` is excluded from the build**, so `pnpm build` will not typecheck code that
   imports `@paperclipai/shared` unless that changes. Verify before Phase 1.
7. **Optional hydration.** `Issue.ancestors`, `.labels`, `.blockedBy` are populated per-endpoint.
   Check each route rather than assuming list parity with detail.
