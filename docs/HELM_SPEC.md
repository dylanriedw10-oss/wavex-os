# The Helm — natural-language operator surface

**Purpose:** give the Board a single conversational surface that can answer questions about a
company and *propose* changes to it, without ever becoming another form.
**Surface:** `/helm` (new route; does not touch `/`, `/onboarding`, or `/pricing`)
**Part:** **Part 1 (creation).** WaveX OS is two products joined by an opt-in handoff — see
[`ARCHITECTURE.md`](./ARCHITECTURE.md) §0. The Helm lives on the wavex side, alongside the wizard and
Mission Control, and talks to the Fastify server on `:3101`. It is **not** a management console for a
running fleet; that is Part 2 (Paperclip, `:3100`, its own UI on `:5174`).
**Caller:** this document is a build spec. It is handed to an implementing agent as-is.
**Status:** ready to build. Every fact in §0 has been verified against the tree — do not re-derive it.

---

## 0. Verified ground truth

This section exists so the implementer does not waste a pass rediscovering the codebase, and does
not invent things that aren't there. Each row was read directly.

### 0.1 What is true

| Fact | Evidence |
|---|---|
| Router is `react-router-dom` v6, `BrowserRouter` | `packages/onboarding-ui/src/main.tsx:3,18` |
| `/` already renders `MissionControl` — **do not take this route** | `packages/onboarding-ui/src/main.tsx:21` |
| Existing routes: `/`, `/onboarding`, `/pricing`, `*` → redirect to `/` | `main.tsx:21-24` |
| Server state is **React Query**. It is the only live state library. | `main.tsx:4,11-13` |
| React Query defaults: `staleTime: 30_000`, `refetchOnWindowFocus: false` | `main.tsx:12` |
| Zustand is a declared dependency, but `store.ts` has **zero consumers** — it is dead code | `store.ts` (111 lines); `grep useOnboarding` → no hits outside its own file |
| Active company comes from the **URL query param** `?companyId=<slug>`, not localStorage | `src/wavex-os/lib/CompanyContext.tsx` (`useSearchParams`) |
| `useCompany()` is the only correct way to read `companyId` | same file |
| The Zustand store is onboarding-scoped and persisted to `localStorage` key `wavex-os-onboarding` | `store.ts:80-110` |
| Global stylesheet is **161 lines**, 12 custom properties | `src/styles.css:1-161` |
| Part 1's backend is Fastify on port **3101**, env `WAVEX_MOCK_CORE_PORT` (mock-core hosts the real wavex-os routes) | `packages/mock-core/src/server.ts:27,127-128` |
| Part 2 (Paperclip, Express 5 on **3100**) is a separate program — out of scope for this surface | `ARCHITECTURE.md` §0 |
| Vite dev server is port **5173**, host `127.0.0.1`, `strictPort` | `packages/onboarding-ui/vite.config.ts` |
| Vite proxies `/api` → `:3101` | `vite.config.ts` |
| Auth gates are `assertBoard` + `assertCompanyAccess` from `@wavex-os/auth-shim` | `packages/auth-shim/src/assertions.ts:24,51` |
| In `WAVEX_AUTH_MODE=dev` a synthetic `local_implicit` board actor is injected, so gates pass locally | `assertions.ts:11-18` |
| `assertCompanyAccess` additionally requires an **active membership for non-safe methods** | `assertions.ts:65-72` |
| Request validation is **zod** | `routes/help-chat.ts:21` |
| LLM calls go through `route()` from `@wavex-os/plugin-tier-router` | `routes/help-chat.ts:25` |
| All LLM calls must be wrapped in `withTokenAccounting(companyId, phase, fn)` | `lib/token-accounting.ts:166` |
| `PhaseKey` is a closed union — a new surface must add its own key | `lib/token-accounting.ts:25-28` |
| Budget exhaustion throws `BudgetExhaustedError` → HTTP **429** | `routes/help-chat.ts` |
| Per-company scratch state is written under `getOnboardingDir(companyId)` | `src/state-bridge.ts:31-34` |
| Goals **are** first-class — hierarchical, with `parentId`, in the Paperclip core subtree | `packages/core/packages/db/src/schema/goals.ts` |
| `GOAL_LEVELS = ["company","team","agent","task"]` | `packages/core/packages/shared/src/constants.ts:230` |
| `GOAL_STATUSES = ["planned","active","achieved","cancelled"]` | `packages/core/packages/shared/src/constants.ts:233` |
| KPI wire shape uses `higher_is_better`/`lower_is_better` and `targetMicros` | `components/mission/KpiBoard.tsx:20-28` |
| Agent status vocabulary is 8 values | `components/OrgGraph.tsx:63-70` |
| A conversational surface **already exists**, end to end — read both before writing a line | `routes/help-chat.ts` + `src/wavex-os/components/HelpChat.tsx` |
| `HelpChat.tsx` is a `position: fixed` right-docked panel, width 380, z-index 25/30, mounted **only** inside the wizard | `HelpChat.tsx:77-102` |
| Of the class rules in `styles.css`, only `.card`, `.nav-buttons`, and `.text-dim` are used. `.layout`, `.sidebar`, `.main`, `.step-num`, `.text-warning`, `.text-danger`, `.text-accent` are **dead selectors** | `grep className` across `src/**/*.tsx` |
| `packages/core` is excluded from the root build | `package.json:21` |
| **Purple is already in use and already means something.** `#b88dff` is the GTM-profile "derived" card; `#c97aa1` is the third pricing-tier badge | `wavex-os/pillars/Pillar4.tsx:5,151,156`; `components/HireAgentFlow.tsx:244-245` |
| `var(--danger)` reaches the screen through only **two** live paths; every other failure surface uses `var(--warning)` | `OrgGraph.tsx:68`, `HealthStrip.tsx:37` |
| 139 raw hex values live in the UI package; four files use **zero** `var(--)` | `HireAgentFlow.tsx`, `SignInWidget.tsx`, `PrivacyPanel.tsx`, `pages/Pricing.tsx` |
| Styling is 81% inline (`588 style={{` vs `136 className`) — **inline styles beat any stylesheet rule** | across `src/**/*.tsx` |
| A central API client exists — `wavexOsOnboardingApi` (38 methods) + `ApiError`, 21 importers | `src/wavex-os/lib/api.ts:17-42` |
| Its `call()` throws when `!resp.ok` **or** when a 200 body contains `ok === false` | `api.ts:27-42` |
| But Mission Control bypasses the client entirely — 10 raw `fetch(` calls | `HealthStrip.tsx:21`, `KpiBoard.tsx:38,50`, `MissionControl.tsx:19` |
| **`useMutation` is used zero times.** Writes are hand-rolled `busy`/`error` state + `invalidateQueries` | `grep useMutation src/**` → no hits |
| `invalidateQueries` is the only cache-coherence mechanism — no `setQueryData`, no optimistic updates | 8 call sites |
| `tsconfig` is `strict: true` but `noUnusedLocals`/`noUnusedParameters` are **off** | `tsconfig.json:9-10` |
| There are **no tests** in `packages/onboarding-ui` — no vitest, no testing-library | no `*.test.tsx` in the package |
| Vite dev port 5173 is `strictPort` and **collides** with `packages/core/ui` | `vite.config.ts:11-12`, `packages/core/ui/vite.config.ts:26` |

### 0.2 What does **not** exist — do not reference it

Each of these was searched for and is absent. If a plan mentions one, the plan is wrong.

| Claimed | Reality |
|---|---|
| `packages/shared` | Does not exist. `@paperclipai/shared` is at `packages/core/packages/shared` (Paperclip subtree) and `vendor/wavex-os/shared` (frozen). |
| `routes/users.ts` | Does not exist anywhere in the repo. |
| `routes/device-status.ts` | Does not exist anywhere in the repo. |
| `expected-kpi-impacts` | No such table, file, or symbol. |
| `ops_company_goals` RPC | No such function. The real Supabase RPCs are `wavex_os_pool_a_burn_today`, `wavex_os_subscription_by_checkout`, `wavex_os_list_my_hires`. |
| A `'info' \| 'amber' \| 'coral'` wire enum | No such enum. `amber` appears only as agent-template frontmatter. The tone enum is defined by *this* spec (§4). |
| Any `@media`, `@keyframes`, `animation`, `:focus-visible`, or `prefers-reduced-motion` rule | Zero occurrences across the whole UI package. §3 adds the first ones. |
| A central status→colour helper (`lib/colors.ts`, `theme.ts`, `tokens.ts`) | None. There are **six** independent mappings instead — see §3.6. |
| An icon library or any inline `<svg>` | None. Iconography is Unicode glyphs and emoji only. |
| A `--success`, `--info`, `--font-*`, `--space-*`, `--shadow-*`, or `--z-*` token | None. §3.2 adds the first ones. |

### 0.3 The routes that are actually ungated

Eight of the server's routes have no auth assertion at all: the five in `billing.ts`, the two in
`inference-status.ts` — neither file even imports `@wavex-os/auth-shim` — and `GET /api/tiers`
(`tiers.ts:24`), whose sibling `POST /api/tier-subscriptions` *is* gated. They are the anti-pattern.
**Copy `help-chat.ts`.** It is the correct and closest template: same auth pair, same zod validation,
same token accounting, same per-company JSON persistence, same 429 path.

Its own header comment scopes out exactly what this document specifies:

> *"The chat is read-only: it explains, recommends ways to think about a field, but does NOT mutate
> any pillar/phase state. Mutating the wizard via natural language is a separate (bigger) project."*

The Helm is that project. Build it as help-chat's successor, not as a parallel invention.

---

## 1. Architecture boundary

The Helm is a **thin conversational shell over endpoints that already exist**. It owns the
conversation and the proposal lifecycle. It owns nothing else.

```
┌──────────────────────────────────────────────┐
│  /helm  (new)                                │
│  · transcript · composer · proposal cards    │
└───────────────┬──────────────────────────────┘
                │  POST /api/instance/:id/helm
                ▼
┌──────────────────────────────────────────────┐
│  helm.ts route  (new, mirrors help-chat.ts)  │
│  · assertBoard + assertCompanyAccess         │
│  · zod validate · withTokenAccounting        │
│  · tierRoute() → intent JSON                 │
└───────────────┬──────────────────────────────┘
                │  reads / proposes against
                ▼
┌──────────────────────────────────────────────┐
│  EXISTING endpoints — unchanged              │
│  /api/instance/:id/{manifest,kpis}           │
│  /api/observability/:id/mission-control      │
│  /api/instance/:id/{add-agent,swap-template} │
└──────────────────────────────────────────────┘
```

**Hard boundary.** The Helm route must not contain business logic. It classifies intent, reads
through existing endpoints, and emits a proposal. Committing a proposal calls the *same* endpoint
the dashboard already calls. If the Helm needs behaviour no endpoint provides, that endpoint is a
separate change — stop and say so rather than reimplementing it inside the Helm.

**The seam is also a hard boundary.** Every endpoint in the box above is a Part 1 endpoint on
`:3101`. The Helm may *read* Part 2 state to answer a question, but it must never call a mutating
Paperclip endpoint on `:3100`. If an operator asks the Helm to do something that belongs to the
runtime — "pause the CEO agent", "close that issue" — the correct response is `navigate`, handing
them to Part 2's UI, not `propose`. Enforce this in the endpoint allowlist (§5), not in the prompt.

---

## 2. The six interface rules

These are the product thesis. They are not stylistic preferences and they are not negotiable.

1. **A button is a chat reply.** Every affordance the Helm offers is a message in the transcript,
   not chrome around it. There is no toolbar, no sidebar of actions, no settings drawer.
2. **If it needs a form, it's a conversation.** Multi-field input is gathered by asking one thing at
   a time. If you find yourself rendering three inputs and a submit, you have built the wrong thing.
3. **Never mutate without a confirmable proposal.** The Helm proposes; the Board commits. A
   `propose` intent renders a card with an explicit confirm action and a plain-English statement of
   what will change. No mutation may be a side effect of asking a question.
4. **State what you did, in the transcript.** After a commit, the outcome is a message. The operator
   never has to go look somewhere else to find out whether it worked.
5. **Refuse rather than guess.** If the intent is ambiguous, emit `clarify`. If it is out of scope,
   emit `refuse` with a one-line reason. A confidently wrong action is worse than a question.
6. **The transcript is the record.** No hidden state. Anything the Helm knows about the session is
   either in the transcript or re-derivable from the existing endpoints.

---

## 3. Visual system

### 3.1 Rule: extend, never redefine

`styles.css` is shared by onboarding, Mission Control, and pricing. Every existing custom property
**keeps its current value**. You are adding names, not changing them. Changing `--accent` would
silently restyle three surfaces.

### 3.2 The real problem to fix: `--accent` is doing six jobs

Today `--accent: #4ec9b0` simultaneously means brand identity, primary button, link, completed step,
healthy system, and ready agent:

| Current use | Location |
|---|---|
| Link colour | `styles.css:30` |
| Primary button background | `styles.css:43` |
| Input focus ring | `styles.css:72` |
| Completed onboarding step | `styles.css:120,133` |
| "core healthy" dot | `components/mission/HealthStrip.tsx:37` |
| agent `active` / `ready` | `components/OrgGraph.tsx:65` |

`OrgGraph.tsx:64` even documents the intent as *"active+ready = green"* while resolving to teal.
The palette is missing a success colour, so brand is standing in for it.

**Split it.** Brand stays teal; health gets its own token. No purple is introduced — the palette
stays teal-led.

```css
:root {
  /* ---- identity: command surface, links, focus, primary action ---- */
  --brand:        #4ec9b0;   /* alias of the existing --accent value */
  --brand-dim:    #3a9484;   /* alias of the existing --accent-dim value */
  --on-brand:     #08221d;   /* was hardcoded at styles.css:44 */

  /* ---- semantic status: never used for identity ---- */
  --success:      #3fb98f;   /* NEW — healthy, ready, achieved, on-track */
  --warning:      #f0b070;   /* unchanged */
  --danger:       #e06070;   /* unchanged */

  /* ---- type scale ---- */
  --text-xs:      11px;
  --text-sm:      13px;
  --text-base:    14px;      /* matches existing button/input size */
  --text-lg:      18px;
  --text-xl:      24px;
  --font-mono:    ui-monospace, SFMono-Regular, "SF Mono", Menlo, monospace;

  /* ---- 8px spacing scale ---- */
  --space-1: 4px;  --space-2: 8px;  --space-3: 12px;
  --space-4: 16px; --space-6: 24px; --space-8: 32px;

  /* ---- radii + motion ---- */
  --radius-sm:    4px;
  --radius-lg:    12px;      /* --radius: 8px already exists */
  --dur-fast:     80ms;      /* matches styles.css:50 */
  --dur-base:     160ms;
  --ease:         cubic-bezier(0.2, 0, 0, 1);
}
```

`--accent` and `--accent-dim` **remain defined and unchanged** so no existing rule breaks.

### 3.3 Status → token map

The Helm uses this map, and nothing else, for status colour:

| Meaning | Token |
|---|---|
| identity, command surface, links, focus ring | `--brand` |
| healthy · ready · active · achieved · confirmed | `--success` |
| attention · pending · spawning · standby · overdue | `--warning` |
| critical · failed · disabled · halted | `--danger` |
| inert · unknown | `--text-dim` |

**This map governs the Helm only.** Do not retrofit it onto existing screens as part of this work —
see §3.6 for why that is a visible change, not a cleanup.

### 3.4 Three global contracts this repo has never had

All three counts are currently **zero**. Add them once, in `styles.css`, and every surface benefits.

```css
/* 1. Focus. Buttons currently have NO focus style at all — a real a11y defect. */
:focus-visible {
  outline: 2px solid var(--brand);
  outline-offset: 2px;
  border-radius: var(--radius-sm);
}

/* 2. Motion. */
@media (prefers-reduced-motion: reduce) {
  *, *::before, *::after {
    animation-duration: 0.01ms !important;
    animation-iteration-count: 1 !important;
    transition-duration: 0.01ms !important;
    scroll-behavior: auto !important;
  }
}

/* 3. Responsive — the app has no breakpoints at all today.
      NOTE: `.layout`, `.sidebar`, `.main`, and `.step-num` are DEAD selectors
      (zero className hits in src/**). Do NOT write breakpoints against them —
      that is how you ship CSS that appears to work and does nothing. */
@media (max-width: 900px) {
  .card { padding: var(--space-4); }
  .nav-buttons { flex-direction: column; gap: var(--space-2); }
}
```

Because the app is inline-styled, a stylesheet breakpoint cannot reach most of the UI. The Helm must
therefore be **responsive by construction**: no fixed pixel widths on containers, `minmax()` /
`flex-wrap` for any multi-column area, and the composer pinned to the bottom of a flex column rather
than positioned absolutely. Do not copy `HelpChat`'s `position: fixed; width: 380` docking — the Helm
is a full route, not a docked panel.

Interactive targets are **min 44×44px**. The Helm is dark-theme only, matching the rest of the app.

### 3.5 Styling method

The UI package has no Tailwind, no CSS modules, no styled-components — it is a global stylesheet
plus inline `style={{}}`. Match that. Do not add a styling dependency. Colours in the Helm must be
`var(--token)`; raw hex in the feature is a build failure (§10).

Be aware of the direction of the cascade: **81% of styling is inline, and an inline style beats any
stylesheet rule without `!important`.** New `.css` rules for cards, badges, or dots will simply be
overridden by the `style={{}}` objects already in the `.tsx` files. This is why §3.4 adds only
things inline styles do not set — focus outlines, motion preferences — and why the Helm's own
appearance must come from its own inline styles reading tokens, not from new global classes.

### 3.6 Three traps in the existing colour system

Read these before touching anything outside `src/helm/`.

1. **Purple is taken.** `#b88dff` is the GTM-profile preview card in `Pillar4.tsx`, documented at
   line 5 as showing *derived* state, and the frozen vendored upstream uses `text-purple-*` /
   `bg-purple-*` across ~35 sites for the same "inferred" meaning. `#c97aa1` is the third
   pricing-tier badge. Purple is therefore neither free nor meaningless — the Helm stays teal-led
   and simply does not use it.

2. **Red does not currently mean error.** `var(--danger)` has exactly two live render paths
   (`OrgGraph.tsx:68`, `HealthStrip.tsx:37`). Every other failure surface in the app — failed
   credential tests, activation failures, the destructive reset confirm — renders
   `var(--warning)` orange. Introducing correct danger semantics app-wide is a **visible change to
   roughly twenty surfaces**, not an additive one. The Helm may use `--danger` correctly within its
   own surface; changing the others is a separate, deliberate PR.

3. **There are six competing status→colour maps, and two of them contradict.**
   `OrgGraph.statusColor` (8 statuses), `Phase3Swarm.STATUS_COLOR` (4), `CredentialConcierge`
   status badges (4), `Phase2Connectors` bucket ternary (3), `HireAgentFlow.tierBadge` (3), and
   `OrgGraph.originLabel` (3). `OrgGraph` and `Phase3Swarm` disagree on the same data — `parked` is
   warning in one and dim in the other; `disabled` is `var(--danger)` in one and raw `#555` in the
   other — **and both render on the Phase 3 screen at once**. Do not "unify" these while building
   the Helm. Add a seventh map and you have made it worse; unify them and you have changed Phase 3.
   The Helm defines its tone mapping internally (§4 `HelmTone`) and touches none of the six.

---

## 4. The contract

Place at `packages/onboarding-ui/src/helm/contract.ts`. It is frontend-owned and imported by the
route via a relative type-only import — **do not create a new workspace package for it**, and do not
put it in `packages/core/packages/shared` (Paperclip subtree) or `vendor/` (frozen).

```ts
/** Wire contract for the Helm. Mirrors HelpMessage in routes/help-chat.ts
 *  where the shapes overlap, so the two transcripts stay convergent. */

export type HelmTone = "neutral" | "success" | "warning" | "danger";

/** What the operator's message resolved to. Exactly one per turn. */
export type HelmIntentKind =
  | "query"     // read-only: answer from existing endpoints
  | "navigate"  // send the operator somewhere in the app
  | "propose"   // a mutation, pending Board confirmation
  | "clarify"   // not enough information to act
  | "refuse";   // out of scope or not permitted

/** An affordance rendered inside the transcript. Never chrome. (Rule 1) */
export interface HelmAction {
  id: string;
  /** Imperative, <= 32 chars. "Add the agent", not "OK". */
  label: string;
  kind: "confirm" | "dismiss" | "navigate" | "followup";
  tone?: HelmTone;
  /** kind:"navigate" only — an in-app path such as `/?companyId=acme`. */
  href?: string;
  /** kind:"confirm" only — the proposal this commits. */
  proposalId?: string;
  /** kind:"followup" only — text resubmitted as the operator's next message. */
  prompt?: string;
}

/** A mutation the Helm wants to make. Rendered as a confirmable card. (Rule 3) */
export interface HelmProposal {
  id: string;
  /** Plain-English statement of the change. Shown verbatim. */
  summary: string;
  /** The existing endpoint that will be called on confirm. */
  endpoint: {
    method: "POST" | "DELETE";
    /** Must already exist. The Helm never invents endpoints. */
    path: string;
    body?: Record<string, unknown>;
  };
  /** Field-level before/after, when the change is an edit. */
  diff?: Array<{ field: string; from: string | null; to: string | null }>;
  /** Anything the operator should weigh before confirming. */
  caveats?: string[];
  expiresAtIso: string;
}

/** Optional structured payload attached to an assistant turn. */
export interface HelmCard {
  kind: "kpi" | "goal" | "agent" | "budget" | "health";
  title: string;
  tone?: HelmTone;
  rows: Array<{ label: string; value: string; tone?: HelmTone }>;
}

/** Transcript entry. `role` and `ts_iso` intentionally match HelpMessage. */
export interface HelmMessage {
  role: "user" | "assistant";
  ts_iso: string;
  text: string;
  intent?: HelmIntentKind;
  actions?: HelmAction[];
  proposal?: HelmProposal;
  cards?: HelmCard[];
  /** Set when a proposal was committed or dismissed on this turn. */
  outcome?: { proposalId: string; status: "committed" | "dismissed" | "failed"; detail?: string };
}

/* ---- request / response ---- */

export interface HelmPostRequest {
  message: string;
  /** Free-text context the operator injected, e.g. a selected KPI id. */
  context?: { kpiId?: string; agentSlot?: string; goalId?: string };
}

export interface HelmPostResponse {
  ok: boolean;
  messages: HelmMessage[];
  latest_assistant?: HelmMessage;
}

export interface HelmCommitRequest {
  proposalId: string;
}

/* ---- domain shapes, mirrored from the live wire ---- */

/** From GET /api/instance/:companyId/kpis — see KpiBoard.tsx:20-28. */
export interface HelmKpi {
  kpiId: string;
  label: string;
  direction: "higher_is_better" | "lower_is_better";
  ownerRole?: string;
  currentValue?: number;
  targetMicros?: number;
  windowDays?: number;
}

/** Mirrors the goals table in the Paperclip core subtree. Hierarchical. */
export interface HelmGoalNode {
  id: string;
  companyId: string;
  title: string;
  description: string | null;
  level: "company" | "team" | "agent" | "task";
  status: "planned" | "active" | "achieved" | "cancelled";
  parentId: string | null;
  ownerAgentId: string | null;
  children?: HelmGoalNode[];
}

/** The 8-value vocabulary from OrgGraph.tsx:63-70. Do not extend it here.
 *  NOTE: the DB does not enforce this — `agents.status` is unconstrained
 *  `text` defaulting to "ready" (packages/db/src/schema/agents.ts). Treat any
 *  value outside this union as "unknown" and render it with --text-dim
 *  rather than throwing. */
export type HelmAgentStatus =
  | "active" | "ready" | "spawning" | "standby"
  | "parked" | "pending" | "disabled" | "failed";
```

**Goals note.** `HelmGoalNode` is backed by a real hierarchical table, but that table lives in the
Paperclip core subtree — *not* in `@wavex-os/db`, whose tables are `companies`, `agents`,
`heartbeat_runs`, `company_kpis`, `kpi_snapshots`, `issues`, `issue_comments`, `cost_events`,
`credentials`, `credential_audit_log`. **Do not add a goals table to `packages/db`.**

**Goals are Part 2 data, and the Helm is a Part 1 surface.** Treat them as read-only and
best-effort: render a goal card when reachable, render it as unavailable when not, and **never
propose a mutation against them**. The Helm's `propose` intents must target the wavex endpoints on
`:3101` only. Writing into the runtime from Part 1 would cross the seam in the wrong direction — the
handoff is one-way by design.

Note that `packages/core` is excluded from the root build (`package.json:21`) and `pnpm dev` does not
start it. In a default dev session the goals endpoint is therefore **not running at all** — the
"unavailable" path is the normal path, not an edge case. Build and test it first, not last.

---

## 5. The route

New file, modelled line-for-line on `help-chat.ts`.

```
GET    /api/instance/:companyId/helm          → { ok, messages }
POST   /api/instance/:companyId/helm          → { ok, messages, latest_assistant }
POST   /api/instance/:companyId/helm/commit   → { ok, messages, latest_assistant }
```

Required, in this order, on every handler:

1. `assertBoard(ar)` **and** `assertCompanyAccess(ar, companyId)` — **both inside the same
   try/catch**, mapping `AuthError` → `reply.status(e.statusCode).send({ error: e.message })`.
2. Validate `companyId` before it reaches the filesystem (see the callout below).
3. zod `safeParse` on the body → 400 with `issues` on failure.
4. `withTokenAccounting(companyId, "helm", …)` around the `tierRoute()` call.
5. `BudgetExhaustedError` → 429 with `{ used, cap, companyId }`.
6. Persist the user's message **even when the model call fails**, surfacing the failure as the
   assistant's reply — help-chat does this deliberately so the question is never lost.

### Copy help-chat's shape, but not these three defects

`help-chat.ts` is the right template, and it carries three problems that all 19 route files share.
Do not propagate them into a new file.

1. **`assertCompanyAccess` is called outside the try/catch** (`help-chat.ts:132-137`, and the same
   at `:144-149`). The `try` closes before it runs, so its 403 `AuthError` escapes as an unhandled
   Fastify **500 instead of a 403**. It is invisible in dev because the synthetic `local_implicit`
   actor never throws there. Put both assertions inside one `try`.

2. **`authReq()` drops the actor.** It returns a fresh `{ method, headers }` object
   (`help-chat.ts:57-59`) with no `actor` field. `ensureActor` therefore writes its dev actor to a
   throwaway, and — more importantly — a production Better-Auth middleware setting `req.actor` on
   the real `FastifyRequest` would be **invisible to every assertion**, so `assertBoard` would
   reject every gated route. Forward the actor: `{ method, headers, actor: (req as ...).actor }`.
   Fixing it repo-wide is out of scope; do not add a 20th copy of the broken helper.

3. **`companyId` is never validated before it hits the filesystem.** `getOnboardingDir` interpolates
   it straight into `join()` (`state-bridge.ts:31-34`), path params get no zod schema anywhere, and
   `DELETE /api/instance/:companyId/reset` is a recursive wipe reached through that same value.
   Validate with `z.string().regex(/^[a-z0-9][a-z0-9_-]*$/).max(64)` — matching what
   `slugifyCompanyId` actually produces — before any path join.

Also note there is **no `/api` Fastify prefix**: every path is a hardcoded absolute string, and
`registerWavexOsRoutes(app)` takes no prefix. Write the full literal paths.

Persistence: `join(getOnboardingDir(companyId), "helm.json")`, written atomically via
`tmp` + `rename`. Cap the transcript at **40 messages** (`MAX_HISTORY`), message length at 1500,
reply length at 800 — same constants as help-chat.

Error envelope: the repo has no single convention — handlers variously emit `{ error }`,
`{ ok: false, error }`, and `{ ok: false, detail }`. The Helm uses `{ ok: false, error }`
consistently, plus the two structured specials it inherits: 429 `{ ok:false, error, budget }` and
400 `{ ok:false, error, issues }`.

Add `"helm"` to the `PhaseKey` union in `lib/token-accounting.ts:25-28`. This is the one existing
file outside the feature you must edit; it is not a frozen path.

`tierRoute` metadata for an intent classification is `reasoning_depth: "shallow"`,
`creativity_required: false`, `customer_facing: false`, `priority: "interactive"`.

**Commit is not a model call.** `/helm/commit` looks the proposal up in the transcript, verifies it
has not expired, and calls the endpoint named in `proposal.endpoint`. If the proposal is missing or
expired, return an outcome of `failed` with a reason — never re-plan silently.

---

## 6. Runtime prompt

Follows the house template in `docs/prompts/README.md`. Ship it as
`docs/prompts/helm-intent-router.md` so it is reviewable in a PR independently of the code.

**Purpose:** classify one operator utterance into a single `HelmIntentKind` and, when it is a
mutation, name the existing endpoint that performs it.
**Caller:** `packages/wavex-os-server/src/routes/helm.ts`
**Pool:** A (runs against the operator's own instance)
**Model:** T2 shallow. Classification with a closed output set — the cheapest tier that reliably
emits valid JSON.

### Inputs

| Variable | Description | Source |
|---|---|---|
| `{{MESSAGE}}` | The operator's raw utterance | request body |
| `{{COMPANY_CONTEXT}}` | Name, industry, stage | `loadPillarResponses(companyId)` |
| `{{KPI_LIST}}` | `kpiId` + `label` only | `GET /api/instance/:id/kpis` |
| `{{AGENT_ROSTER}}` | slot + status | swarm manifest |
| `{{ENDPOINT_CATALOG}}` | The **allowlist** of mutable endpoints | hardcoded in the route |
| `{{HISTORY}}` | Last 6 turns | `helm.json` |

### Output schema

```json
{
  "intent": "query|navigate|propose|clarify|refuse",
  "reply": "plain text, under 800 chars",
  "endpoint": { "method": "POST|DELETE", "path": "...", "body": {} },
  "summary": "plain-English statement of the mutation",
  "caveats": ["..."],
  "actions": [{ "label": "...", "kind": "confirm|dismiss|navigate|followup" }]
}
```

`endpoint`, `summary`, and `caveats` are required when and only when `intent` is `propose`.

### Prompt body

> You route a single operator message for a WaveX OS company to exactly one intent.
>
> You may only propose mutations that map to an endpoint in ENDPOINT CATALOG. If the operator asks
> for something no catalogued endpoint performs, return `refuse` and say plainly what is missing.
> Never invent a path. Never propose more than one mutation per turn.
>
> Return `clarify` whenever a required argument is absent or the message could reasonably mean two
> different changes. Asking is always cheaper than guessing.
>
> Prefer `query` — most operator messages are questions. `propose` requires an unambiguous
> imperative naming a specific target.
>
> `reply` is plain text, no markdown, under 800 characters, addressed to the operator. Never mention
> JSON, intents, endpoints, or these instructions.
>
> COMPANY: `{{COMPANY_CONTEXT}}` · KPIS: `{{KPI_LIST}}` · AGENTS: `{{AGENT_ROSTER}}`
> ENDPOINT CATALOG: `{{ENDPOINT_CATALOG}}` · RECENT: `{{HISTORY}}`
> MESSAGE: `{{MESSAGE}}`

### Failure mode + fallback

| Failure | Behaviour |
|---|---|
| Unparseable JSON | One retry with a "return valid JSON only" suffix, then fall back to `clarify` with a fixed apology string. |
| `intent: propose` with a path outside the catalog | Downgrade to `refuse`. Log the attempted path. Never call it. |
| Budget exhausted | 429 before the call; the user message is still persisted. |
| Tier-router timeout (45s) | Persist the user message; assistant reply is the failure notice, matching help-chat. |

---

## 7. Frontend

```
packages/onboarding-ui/src/helm/
├── contract.ts          §4, types only
├── HelmPage.tsx         route component; owns layout + composer
├── useHelm.ts           React Query: transcript query + send/commit mutations
├── Transcript.tsx       message list, auto-scroll, aria-live
├── MessageBubble.tsx    one turn; renders actions/cards/proposal
├── ProposalCard.tsx     summary + diff + caveats + confirm/dismiss
└── ContextChips.tsx     keyboard-operable context injection
```

**Rules.**

- **Read `src/wavex-os/components/HelpChat.tsx` first.** It is the repo's working transcript +
  composer, and the Helm's message list should feel like its sibling. Borrow its structure; do not
  borrow its `position: fixed` docking (§3.4) and do not import from it.
- Server state via **React Query only** — `queryKey: ["helm", companyId]`. Do not put Helm state in
  the Zustand store: it is onboarding-scoped, localStorage-persisted, and currently dead code with
  no consumers. Reviving it for a transcript would be the wrong first consumer.
- Read `companyId` via `useCompany()`. With no company selected, render the same empty state
  pattern `KpiBoard` uses: a `.card` explaining what to do, with a `<Link>` — not an error.
- **Writes follow the house pattern, which is not `useMutation`.** There is not a single
  `useMutation` in this package. Conform to what exists: local `sending` boolean +
  `error: string | null`, `try/catch/finally`, `e instanceof ApiError ? e.message : (e as Error).message`,
  then `await qc.invalidateQueries({ queryKey: ["helm", companyId] })`. Introducing `useMutation`
  here would be a new pattern, not conformance — if you think it is worth introducing, raise it
  rather than doing it silently.
- Echo the operator's turn into local state immediately so the transcript feels live, then
  reconcile on invalidate. There are no optimistic cache writes anywhere in this app
  (no `setQueryData`); do not add the first one here.
- **Route Helm calls through `src/wavex-os/lib/api.ts`**, adding methods to `wavexOsOnboardingApi`
  rather than calling `fetch` directly. Mission Control's raw-`fetch` habit is the anti-pattern —
  `KpiBoard` re-implements two endpoints the client already wraps. Note `call()` throws when a
  **200 response body contains `ok: false`**, so the Helm's error replies must come back as HTTP
  errors or as `ok: true` payloads carrying a failure `outcome` (§4) — never as `200 { ok: false }`,
  which the client converts into a thrown `ApiError`.
- `refetchInterval` is **not** used. The transcript changes only when the operator acts.
- Composer: `Enter` sends, `Shift+Enter` newlines, disabled while in flight, never disabled on error.
- Transcript is `aria-live="polite"`; each turn is a list item; actions are real `<button>`s so
  §3.4's `:focus-visible` applies.
- Context chips are `<button>`s, reachable by Tab — not drag-and-drop, not hover-only.

Register in `main.tsx`, one line, inside the existing `<Routes>`, leaving `/` untouched:

```tsx
<Route path="/helm" element={<HelmPage />} />
```

Add a `<Link to="/helm">` from `MissionControl`'s header so the surface is reachable. That is the
only permitted edit to `MissionControl.tsx`.

**Two shell gaps that will bite this surface.** Neither is your job to fix repo-wide, but the Helm
must not assume they are handled:

1. *No SPA history fallback.* Nothing in the wavex layer serves `index.html` for unknown paths
   (`@fastify/static` appears nowhere). `/helm` will deep-link correctly under `vite dev` and **404
   on a production static serve**, exactly like `/onboarding` does today. Reach the Helm via in-app
   `<Link>` navigation and note the limitation; do not add a static-file server as part of this work.
2. *No error boundary anywhere.* A render-time throw white-screens the entire app. Wrap `HelmPage`'s
   subtree in a local error boundary that renders a `.card` with the failure and a retry action, so a
   malformed model reply degrades to a message instead of taking down Mission Control.

Also avoid the two live name collisions when writing imports: there are two `Pricing` components
(`src/pages/Pricing.tsx` vs `src/wavex-os/pricing/Pricing.tsx`) and two `CompanyContext` modules
(onboarding-ui's vs `packages/core/ui`'s). Always import by full path.

---

## 8. Build order

Each step is a commit. Conventional-commit prefixes per `CLAUDE.md`.

| # | Step | Commit |
|---|---|---|
| 1 | Extend `styles.css` with §3.2 tokens + §3.4 global contracts. Change no existing value. | `feat(ui): additive design tokens + focus/motion/responsive contracts` |
| 2 | Add `src/helm/contract.ts` (§4). Types only, no runtime code. | `feat(helm): wire contract` |
| 3 | Add `"helm"` to `PhaseKey`. | `feat(helm): token-accounting phase key` |
| 4 | Add `routes/helm.ts` GET + POST, transcript persistence, auth, zod, accounting. No model call yet — echo a stub `clarify`. | `feat(helm): transcript route` |
| 5 | Add `docs/prompts/helm-intent-router.md` (§6). | `docs(prompts): helm intent router` |
| 6 | Wire `tierRoute()` + JSON parsing + retry + downgrade-to-refuse. | `feat(helm): intent routing via tier-router` |
| 7 | Add the endpoint allowlist and `/helm/commit`. | `feat(helm): proposal commit` |
| 8 | Frontend shell: `HelmPage`, `useHelm`, `Transcript`, `MessageBubble`. | `feat(helm): conversational surface` |
| 9 | `ProposalCard` + `ContextChips`. | `feat(helm): proposal cards + context injection` |
| 10 | Route registration + Mission Control link. | `feat(helm): mount at /helm` |
| 11 | Tests (§9) and the §10 final pass. | `test: helm route + intent fallbacks` |

---

## 9. Execution rules

- **Frozen paths are frozen.** `vendor/**`, `packages/healing/**`, `packages/standard-skills/**`,
  `apps/installer/**`, `scripts/wrappers/*.sh`, `templates/launchd/**`, `examples/*.example.json`.
  If the task appears to require editing one, **stop and surface it**. Do not work around it.
- **No new runtime dependencies.** Everything needed — zod, React Query, react-router, the tier
  router — is already present.
- TypeScript strict. No `any` in the Helm feature.
- One logical change per commit.
- Tests: route-level tests mirroring `packages/wavex-os-server/test`, covering at minimum —
  unauthenticated request is rejected; malformed body → 400; budget exhausted → 429; model returns
  garbage → `clarify` fallback; `propose` naming an uncatalogued path → downgraded to `refuse`;
  commit of an expired proposal → `failed` outcome. `packages/wavex-os-server/test` already has
  seven suites to pattern-match against.
- **Do not write frontend tests as part of this work.** `packages/onboarding-ui` has no test
  infrastructure at all — no vitest, no testing-library, zero `*.test.tsx`. Standing that up is a
  worthwhile separate PR, not a line item inside a feature. All test coverage here is route-level.
- Never log message bodies or credentials. The vault rule in `CLAUDE.md` applies to transcripts.

---

## 10. Final pass

Run these. Each must produce the stated result before the work is called done.

```bash
# 1. No raw hex in the feature — colours must be tokens.
grep -rn "#[0-9a-fA-F]\{3,8\}" packages/onboarding-ui/src/helm/          # → no matches

# 2. No purple in the Helm. (Purple already means "derived" elsewhere — §3.6.
#    Scope this to the feature: the check fails repo-wide by design.)
grep -rin "purple\|violet\|indigo\|magenta" packages/onboarding-ui/src/helm/   # → no matches

# 3. Exactly one route added.
git diff main -- packages/onboarding-ui/src/main.tsx | grep -c "^+.*<Route"   # → 1

# 4. No existing token value was removed or changed.
#    `^-[^-]` skips the `--- a/…` diff header, which `^-` would wrongly match.
git diff main -- packages/onboarding-ui/src/styles.css | grep -c "^-[^-]"     # → 0

# 5. No new dependency. `^+[^+]` skips the `+++ b/…` header.
git diff main -- '**/package.json' | grep "^+[^+]" | grep -c "\"[a-z@]"       # → 0

# 6. Auth on every new handler.
grep -c "assertBoard" packages/wavex-os-server/src/routes/helm.ts        # → 3

# 7. The three global contracts now exist.
grep -c "focus-visible\|prefers-reduced-motion\|@media" packages/onboarding-ui/src/styles.css  # → >= 3

# 8. Builds and passes.
pnpm --filter @wavex-os/* test && pnpm --filter @wavex-os/onboarding-ui build
```

---

## 11. Recommendations

Ranked. **None of these are in scope for the build above** — they are the findings that surfaced
while grounding it.

1. **Land §3.2 + §3.4 as a standalone commit first.** The token split and the focus/motion/responsive
   contracts are prerequisites for this spec *and* independently the highest-value fix in the app:
   buttons currently have no focus style, the 280px sidebar does not collapse, and no surface
   respects reduced-motion. Onboarding and Mission Control benefit immediately.

2. **Two incompatible KPI models are live.** `store.ts:22-30` uses
   `direction: "increase"|"decrease"|"maintain"` with `targetValue`/`ownerSlot`; the wire shape in
   `KpiBoard.tsx:20-28` uses `higher_is_better`/`lower_is_better` with `targetMicros`/`ownerRole`.
   Nothing translates between them. Pick the wire shape and delete the other.

3. **Three auth defects, in ascending order of severity. This is the most important item here.**

   a. *Eight ungated routes.* `billing.ts` (5, including `DELETE /api/billing/subscription`),
   `inference-status.ts` (2, which leak absolute paths and PIDs), and `GET /api/tiers`. Neither
   billing nor inference-status imports the auth shim at all, so gating them means adding the
   import and the `authReq` helper, not just a call.

   b. *Every `assertCompanyAccess` 403 is served as a 500.* In all 45 company-scoped routes the
   `try` closes after `assertBoard`, leaving `assertCompanyAccess` unguarded on the next line.
   Dev never sees it because the `local_implicit` actor never throws there.

   c. *The production auth path cannot work as written.* `authReq()` builds a fresh
   `{ method, headers }` object with no `actor`, so a Better-Auth middleware populating
   `req.actor` would be invisible and `assertBoard` would reject all 48 gated routes. Combined
   with `WAVEX_AUTH_MODE` defaulting to `dev` whenever `NODE_ENV !== "production"`, **no gate in
   this repo has ever executed a real denial.** `CLAUDE.md`'s production swap step 5 assumes
   wiring that does not exist yet. Fixing `authReq` touches all 19 route files and should happen
   before anyone relies on the gates.

4. **`companyId` reaches the filesystem unvalidated.** `getOnboardingDir` and `getInstanceDir`
   interpolate it directly into `join()`; zod is applied only to `req.body`, never to `req.params`
   or `req.query`. `DELETE /api/instance/:companyId/reset` is a recursive wipe reached through that
   value. A slug regex at the route boundary closes it.

5. **Polling is uncoordinated across six different intervals.** Three components hand-roll
   `setInterval` — `HealthStrip` 5s (`:29`), `FleetGraph` 8s (`:41`), `T2ProgressIndicator` 1.5s
   (`:82`) — while five use React Query `refetchInterval` at 5s, 30s, and 60s. The hand-rolled ones
   duplicate fetch and error handling that React Query already provides. Converting those three is a
   contained, high-value cleanup.

6. **`store.ts` is 111 lines of dead code.** Zustand is a declared dependency with zero consumers.
   Either delete both, or make it the real home for client state — but leaving a plausible-looking
   store that nothing imports is a trap for the next contributor, who will wire into it by
   reasonable analogy. It also encodes the *losing* KPI model from #2.

7. **Roughly half of `styles.css` is dead.** `.layout`, `.sidebar`, `.main`, `.step-num`,
   `.text-warning`, `.text-danger`, `.text-accent` have zero `className` hits; only `.card`,
   `.nav-buttons`, and `.text-dim` are live. The dead block is the one that *looks* like the app
   shell, so it reads as load-bearing. Delete it or wire it up.

8. **`--max-width: 920px` is declared but Mission Control hardcodes `maxWidth: 1200`**
   (`MissionControl.tsx:80`). One of the two is wrong; the token should win.

9. **Vite port 5173 collides between the two React apps.** `onboarding-ui` sets
   `strictPort: true` on 5173 and `packages/core/ui` also binds 5173, so onboarding-ui hard-fails to
   boot if core/ui is running. `pnpm dev` starts only onboarding-ui today, which hides it — assign
   core/ui a different port before anyone runs both.

10. **There is no error boundary and no code splitting anywhere in the UI.** One throw white-screens
    the app, and `registry.json` (2613 lines) plus `reactflow` plus `@supabase/supabase-js` all load
    on the root route. A top-level boundary is a few lines and removes a whole class of outage.

11. **The token system is leaky at ~30% of the app.** 139 raw hex values live in the UI package, and
    four files — `HireAgentFlow.tsx`, `SignInWidget.tsx`, `PrivacyPanel.tsx`, `pages/Pricing.tsx` —
    contain **zero** `var(--)` between them, covering the whole `/pricing` route, sign-in, the
    privacy panel, and the hire flow. Worse, they use near-duplicate values (`#8a8a92` vs
    `--text-dim #9a9aa0`; `#e6e6e6` vs `--text #ededef`; `#0a0a0a` vs `--bg #0a0a0b`), so the drift
    is invisible until you diff the hex. Any future "change the brand colour" task silently misses
    all four.

12. **`--accent-dim` has two conflicting truths.** `styles.css:11` says `#3a9484`, but the colour
    users actually see as the dim accent border in `SignInWidget.tsx:59,98`,
    `PrivacyPanel.tsx:225`, and `HireAgentFlow.tsx:237,268` is `#2a6b5e` — which is what
    `docs/wizard.html:19` defines under the same token name. One name, two values. Pick one.

13. **Two small, certain bugs worth a five-minute PR.** `pages/Pricing.tsx:99` sets
    `className="pricing-card"`, a class defined nowhere in the repo, so that styling silently
    no-ops. And `pages/Pricing.tsx:122,130,163,330,371` declare
    `fontFamily: "ui-monospace, JetBrains Mono, Menlo, monospace"` with the two-word family
    **unquoted** — invalid CSS, so the parser drops `JetBrains Mono` and those five sites fall
    through to Menlo.

14. **The API client is bypassed by exactly the surfaces that matter most.** The `/wavex-os` subtree
    (21 files) goes through `wavexOsOnboardingApi`, but Mission Control — `HealthStrip`,
    `FleetGraph`, `KpiBoard`, `MissionControl` — plus `pages/Pricing` and `data/templates` use raw
    `fetch`. `KpiBoard` re-implements two endpoints the client already wraps. Migrating Mission
    Control onto the client would delete duplicated error handling and pairs naturally with #4.

15. **Supabase is a second, parallel backend that bypasses Fastify entirely.** `PrivacyPanel`,
    `HireAgentFlow`, and `pages/Pricing` call `supabase.from().select/insert` and
    `supabase.rpc("wavex_os_list_my_hires")` directly, skipping the route layer, the auth shim, and
    `@wavex-os/db`. It is inert only because `VITE_SUPABASE_URL`/`ANON_KEY` are unset and there is
    no `.env.example` to set them from. Worth an explicit decision about whether that path is
    intended, because the auth model differs from `assertBoard` on every other read.

16. **`packages/onboarding-ui` has no tests and `packages/onboarding-server-client` is an orphan.**
    Zero `*.test.tsx` in the UI package against seven suites on the server side; and the
    `onboarding-server-client` workspace package is a Phase-B stub whose network methods throw and
    which no code imports — its only mention outside itself is a stale comment at
    `vite.config.ts:7`. Standing up vitest is the higher-value of the two.

17. **The `wavex-os` naming is a real, separable refactor.** See §12 — worth doing, but not inside a
    feature commit.

---

## 12. Naming

This document's own vocabulary, surface name, route, component names, symbols, tokens, and prose
contain no "Operator Omega" branding. The surface is **the Helm**; the route is `/helm`; the phase
key is `helm`.

Where the spec cites a path such as `packages/wavex-os-server/src/routes/help-chat.ts`, that is a
**statement of where a file currently sits**, not branding — the implementer has to be able to open
it. Those citations are collected here so the body stays clean:

| Existing identifier | Kind | Renameable? |
|---|---|---|
| `vendor/wavex-os/**` | vendored tree | **No** — frozen, byte-identical to upstream |
| `@wavex-os/plugin-tier-router`, `@wavex-os/plugin-onboarding` | package identity | **No** — vendored package names |
| `packages/wavex-os-server` | wavex-owned package | Yes, with a workspace-wide import update |
| `packages/onboarding-ui/src/wavex-os/` | wavex-owned directory | Yes |
| `/wavex-os/onboarding/*` — 21 endpoints | URL namespace | Yes — requires the Vite proxy rule and all callers to move together |
| `WavexOsOnboarding` component | symbol | Yes |
| `WAVEX_OS_CLAUDE_BIN` | env var | Yes, with docs + launchd templates |

The user-visible surface is far smaller than the file count suggests: outside comments and import
specifiers, "Omega" reaches an operator in essentially one place — the phrase *"the Op-omega
onboarding wizard"* inside the help-chat system prompt (`routes/help-chat.ts`, `buildPrompt`). That
string is model-visible on every help-chat turn and is a one-line fix.

**Recommendation:** do the rename as its own PR, in this order — (1) the help-chat prompt string,
(2) `WavexOsOnboarding` → `OnboardingWizard`, (3) `src/wavex-os/` → `src/onboarding/`, (4) the
`/wavex-os/onboarding/*` URL namespace together with the Vite proxy, (5) `packages/wavex-os-server`
→ `packages/onboarding-server`. Steps 4 and 5 are the only ones with real blast radius. Do **not**
touch `vendor/**` or the `@wavex-os/*` package names at any point.
