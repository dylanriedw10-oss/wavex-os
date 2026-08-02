# WaveX OS — Architecture

> Status: Phase H. Sections 0–4 describe the **shipped** architecture. Sections 5–9 retain
> forward-looking Phase E/F design. See [ROADMAP.md](./ROADMAP.md) for delivery cadence.

---

## 0. Core principle: two parts, one seam

**WaveX OS is deliberately two products joined by an opt-in handoff.**

| | **Part 1 — creation** | **Part 2 — management** |
|---|---|---|
| Question it answers | *what company should exist?* | *is the company working?* |
| Owner | wavex-os, vendored at `vendor/wavex-os/` | Paperclip, vendored at `packages/core/` |
| Does | 5 pillars → 4 phases → Monte Carlo → sign → activate | heartbeats, issues, budgets, approvals, board |
| API | Fastify — `packages/wavex-os-server` on `:3101` | Express 5 — `packages/core/server` on `:3100` |
| UI | `packages/onboarding-ui` on `:5173` | `packages/core/ui` on `:5174` |
| Lifetime | runs once per company, then ends | runs forever |

Part 1 is a **curated construction pipeline**. It interviews the operator, picks a roster from 165
templates, generates workflows, simulates the plan, signs a manifest, and materializes a fleet. Then
it is done — it does not manage anything.

Part 2 is the **runtime**. It owns everything that happens after the fleet exists.

### Why they are separate

- **Different lifetimes.** Onboarding is a one-shot wizard; the runtime is a daemon. Coupling them
  would force the wizard to stay resident and the runtime to understand pillar state.
- **Different owners.** Both halves are vendored from upstream projects on independent release
  cadences. The seam is where wavex code lives, and keeping it thin keeps both subtrees pullable.
- **Part 1 must work alone.** You can complete onboarding with no runtime installed. This is a
  product requirement, not a fallback — see the contract in §2.

### The seam

```
POST /api/instance/:companyId/activate
   │
   ├─ bridgeAgents()          ~35 agents → wavex DB              ALWAYS
   ├─ handoffToPaperclip()    C-Suite → live Paperclip company   OPT-IN
   └─ ignition()              seed tasks, create Goal,
                              wake CEO + CoS, enable heartbeats
   │
   ▼
window.open(paperclipUiUrl(...), "_blank")     ← Part 1 ends here
```

The last line is literal (`WavexOsOnboarding.tsx:178`). The wizard opens Paperclip's UI in a new tab
and stops. `docs/DEMO_RUNBOOK.md` scripts the demo as two tabs for exactly this reason: Tab A is the
wizard, Tab B is "the receiving side."

---

## 1. Three-axis design

WaveX OS is the open-source product layer on top of [Paperclip](https://github.com/paperclipai/paperclip) (the agent runtime engine). Three axes were considered up front because they each have different cost / control / privacy tradeoffs:

| Axis | Options | WaveX OS choice |
|------|---------|-----------------|
| **Inference origin** | Hosted-only · Local-only · **Hybrid** | **Hybrid**. Onboarding agent uses hosted inference (free trial, capped at 30K tokens). Spawned fleet uses **your** Claude Max subscription via local OAuth handoff. |
| **Control surface** | CLI · MCP bridge · **Localhost browser UI** | **Localhost browser UI**. The user clones the repo, runs `npx wavex-os init`, the installer opens `http://localhost:5173` for the onboarding wizard (Part 1). The wizard talks to the wavex Fastify server on `:3101`; at activate it hands the fleet to Paperclip on `:3100` and opens Part 2's UI on `:5174`. |
| **Personalization** | Vendored static · Curated mix · Dynamic AI-tuned | **Curated + AI-tuned.** 165 templates ship in-repo (vendored from `agency-agents` plus WaveX-authored — §6). Part 1's phase-3 and phase-4 steps apply per-slot template variations and workflow patches via T2, under a per-company token budget. |

The result: **your data, your inference, your agents** — once you finish onboarding, nothing about your fleet has to leave your machine. The hosted System Optimizer (paid, optional) is a *prompt-injection* layer on top, not a dependency.

---

## 2. High-level component graph

```
┌───────────────────────────────────────────────────────────────────────────────┐
│  USER MACHINE (localhost-only by default)                                     │
│                                                                               │
│   PART 1 — CREATION                    ┊        PART 2 — MANAGEMENT           │
│                                        ┊                                      │
│  ┌─────────────────────┐               ┊       ┌─────────────────────┐        │
│  │ Tab A               │               ┊       │ Tab B               │        │
│  │ onboarding-ui :5173 │               ┊       │ core/ui      :5174  │        │
│  │  wizard + Mission   │               ┊       │  fleet · issues ·   │        │
│  │  Control            │               ┊       │  approvals · costs  │        │
│  └──────────┬──────────┘               ┊       └──────────┬──────────┘        │
│             │ /api  /wavex-os          ┊                  │ /api              │
│             ▼                          ┊                  ▼                   │
│  ┌─────────────────────┐               ┊       ┌─────────────────────┐        │
│  │ wavex-os-server     │   handoff     ┊       │ Paperclip server    │        │
│  │ Fastify      :3101  │───────────────┊──────►│ Express 5    :3100  │        │
│  │  pillars · phases · │   (opt-in,    ┊       │  Drizzle/Postgres   │        │
│  │  activate · bridge  │    detected)  ┊       │  heartbeat sched.   │        │
│  └──────────┬──────────┘               ┊       │  issues · agents    │        │
│             │ writes                   ┊       └──────────┬──────────┘        │
│             ▼                          ┊                  │ spawn()           │
│  ┌─────────────────────┐               ┊                  ▼                   │
│  │ manifests on disk   │               ┊       ┌─────────────────────┐        │
│  │ + @wavex-os/db      │               ┊       │ Spawned agents      │        │
│  └─────────────────────┘               ┊       │  (Claude CLI, one   │        │
│                                        ┊       │   wrapper per agent)│        │
│  ┌─────────────────────┐               ┊       └──────────▲──────────┘        │
│  │ macOS Keychain /    │               ┊                  │ read              │
│  │ secret store        │───────────────┊──────────────────┘                   │
│  │  (Claude Max OAuth) │               ┊                                      │
│  └─────────────────────┘               ┊                                      │
│                                    the seam                                   │
└───────────────────────────────────────────────────────────────────────────────┘
                                  │
                                  │  optional, paid (Phase F)
                                  ▼
┌─────────────────────────────────────────────────────────────────┐
│  WAVEX HOSTED — System Optimizer (api.wavex-os.com)             │
│                                                                 │
│  - daily/hourly cron: pulls fleet KPI digest                    │
│  - injects board-level prompts → CEO/CoS via Paperclip API      │
│  - billing (Stripe, future)                                     │
│                                                                 │
│  Tokens never travel here. Only KPI metadata + the              │
│  injection body do.                                             │
└─────────────────────────────────────────────────────────────────┘
```

### 2.1 How the seam is wired

**Opt-in by contract.** `packages/wavex-os-server/src/bridge/paperclip-handoff.ts`:

> *"Opt-in via `PAPERCLIP_HANDOFF_URL` env var; when unset, this is a no-op and bridgeAgents-only is
> the contract."*

**Auto-detected.** `lib/paperclip-detect.ts` pings `127.0.0.1:3100` then `:3000` at wavex boot with a
1.5s timeout and sets `PAPERCLIP_HANDOFF_URL` if one answers. It fingerprints the health response on
`serverVersion` / `deploymentMode` so it cannot false-match wavex's own mock-core, which also serves
`/api/health`. When nothing answers it logs *"paperclip not running locally; handoff disabled"* and
onboarding proceeds normally.

**Idempotent.** The wavex→Paperclip company and agent id mapping persists to
`~/.wavex-os/instances/<companyId>/paperclip-handoff.json`, so re-running activate reuses ids rather
than duplicating hires.

**Partial by design (v1).** The handoff mirrors the C-Suite — `ceo`, `cpo`, `cmo`, `cro`, `cfo`,
`cdo`, `coo` — and skips L·IV specialists, because mapping sub-roles onto Paperclip's constrained
role enum is lossy. The wavex DB therefore holds the full ~35-agent roster while the Paperclip
company holds ~7. Any count shown to an operator must say which side it came from.

### 2.2 mock-core

`packages/mock-core` is an in-memory **stand-in for Paperclip** on `:3101`, and it exists precisely
because of the opt-in contract: Part 1 has to be developable and demoable with Part 2 absent. It
serves six fake Paperclip endpoints (`/api/health`, `/api/agents`, `/api/probe/claude-max`,
`/api/spawn`, `/api/runs/:runId`, and an SSE `/api/spawn/:runId/events`).

It also hosts the **real** wavex-os routes via `registerWavexOsRoutes(app)`. So `:3101` serves two
different kinds of thing — six mocks, and ~56 genuine onboarding endpoints. Only the six are fake.

Consequence worth knowing: with default config, Mission Control's health strip and agent count read
mock-core, not the live runtime, even when Paperclip is running and the handoff succeeded. Surfacing
live Part-2 state inside Part 1 is a deliberate product decision, scoped in
[`PAPERCLIP_BACKEND_AND_FRONTEND_PLAN.md`](./PAPERCLIP_BACKEND_AND_FRONTEND_PLAN.md) §7.1.

### 2.3 Known gaps in the seam

| Gap | Detail |
|---|---|
| **The fleet lands switched off** | Activate mirrors agents and stops. `runtimeConfig.heartbeat.enabled = false` is hard-coded at `paperclip-handoff.ts:219`, and `workflow_manifest.on_fire` never becomes Paperclip issues. [`IGNITION.md`](./IGNITION.md) is the designed fix — seed tasks, create the Goal, wake CEO + CoS, stagger and enable heartbeats. |
| **`:5174` is a convention, not config** | The wavex side derives Paperclip's UI URL by `apiUrl.replace(/:3100\b/, ":5174")`, but `packages/core/ui/vite.config.ts:26` sets `5173` — colliding with `onboarding-ui`'s `strictPort: true`. The documented Tab B currently needs a manual port override. |
| **L·IV agents do not cross** | See §2.1. A v2 role-mapping problem. |

---

## 3. Repo layout

Grouped by which part each package belongs to. Full map in
[`CLAUDE.md`](../CLAUDE.md#repo-map).

```
wavex-os/
│
│  ── PART 1: creation ───────────────────────────────────────────────
├── apps/installer/                 `npx wavex-os init` CLI
├── vendor/wavex-os/                the onboarding pipeline, vendored
│   ├── onboarding/                 @wavex-os/plugin-onboarding (50 src files)
│   ├── tier-router/                T1/T2 inference routing
│   ├── flywheel-kernel/            @wavex-os/plugin-flywheel-kernel
│   ├── plugin-sdk/  shared/        @paperclipai/{plugin-sdk,shared}
│   └── VENDOR.md                   source SHA + patch exceptions
├── packages/
│   ├── core/                   # Paperclip, vendored via git subtree
│   │                           # (origin: github.com/paperclipai/paperclip)
│   ├── onboarding-ui/          # Vite + React 18 + TypeScript
│   │   ├── src/
│   │   │   ├── pages/onboarding/   # 11 wizard steps
│   │   │   ├── components/
│   │   │   ├── store.ts            # zustand + persist
│   │   │   └── main.tsx
│   │   ├── vite.config.ts
│   │   └── package.json
│   ├── agent-templates/        # 30 curated templates
│   │   ├── _registry.json
│   │   ├── _CREDITS.md
│   │   └── <division>/<role>.md
│   └── onboarding-server-client/
│       └── src/index.ts        # typed stub for hosted backend (Phase D+)
│
│  ── THE SEAM ────────────────────────────────────────────────────────
├── packages/wavex-os-server/src/bridge/
│   ├── finalize-bridge.ts          manifest → @wavex-os/db  (always)
│   ├── paperclip-handoff.ts        C-Suite → Paperclip      (opt-in)
│   ├── ignition.ts                 seed tasks + enable heartbeats
│   └── catalog.ts                  SLOT_TO_TEMPLATE (33 slots)
│
│  ── PART 2: management ─────────────────────────────────────────────
├── packages/core/                  Paperclip, vendored via git subtree
│   ├── server/                     Express 5 (:3100) — 323 routes, 38 services
│   ├── ui/                         React 19 + Tailwind v4 — 120 routes (:5174)
│   └── packages/{db,shared}/       Drizzle schema + shared types/validators
│
│  ── BOUNDARY SERVICES (used by both) ───────────────────────────────
├── packages/
│   ├── db/                         PGlite (dev) / Postgres (prod) + Drizzle
│   ├── auth-shim/                  assertBoard / assertCompanyAccess
│   ├── composio-shim/  inference-adapter/  plugin-sdk-shim/
│   ├── healing/  observability/    runtime recovery + metrics
│   └── standard-skills/            cross-cutting agent skills
│
├── scripts/  templates/launchd/  examples/  baseline/  supabase/  e2e/
└── docs/
```

The reason `core/` is a **subtree** and not a submodule:
- One-clone install (subtrees ship with the parent repo's history).
- We can patch core for WaveX-specific needs without forking upstream.
- Pulling new Paperclip releases is `git subtree pull --prefix=packages/core paperclip-local master --squash`.

---

## 4. The two parts in detail

### 4.1 Part 1 — the creation pipeline

The wizard is **not** router-driven. `/onboarding` is a single route; the step is a `Phase` state
machine inside `WavexOsOnboarding.tsx`, mirrored to a `?phase=` query param so deep links and refreshes
survive. The active company is `?companyId=` — the URL is the source of truth, not a store.

> Historical note: this replaced an earlier 11-route `/onboarding/:slug` design backed by a zustand
> `persist` store. That store still exists at `packages/onboarding-ui/src/store.ts` but has **zero
> importers** — it is dead code.

| Stage | Phase key | What happens | T2 inference |
|---|---|---|---|
| 0 | `welcome` | Company name → slugified into `companyId` | — |
| 1 | `pillar-1` | Paste a URL; infers industry, business model, ICP, positioning, tone | ✅ heavy (2–4 min) |
| 2 | `pillar-2` | Claude CLI auth + plan-tier probe | — |
| 3 | `pillar-3` | Product state + company stage | — |
| 4 | `pillar-4` | Lead sources + sales motion | — |
| 5 | `pillar-5` | Comms channel | — |
| 6 | `phase-2-connectors` | Picks required / suggested / deferred connectors | ✅ |
| 7 | `credentials` | Vault or skip each connector, with reason | — |
| 8 | `phase-3-swarm` | Picks per-slot template variations; renders the org chart | ✅ |
| 9 | `phase-4-workflows` | Generates per-agent workflow patches (slowest phase) | ✅ 2 calls/agent |
| 10 | `finalize` | Monte Carlo (30 cycles × 30 runs × 5 strategies) + imprint + sign | ✅ |
| 11 | `materialize` | **Activate** → bridge → handoff → ignition → open Tab B | — |

Roster shape is chosen by Pillar 3 stage, not fixed: `minimal_kernel` (pre-product) → `collapsed_6`
→ `hybrid` → `formal_9`, with solo founders collapsed further to a 5-agent kernel regardless of
stage.

All T2 calls route through the tier-router and are wrapped in `withTokenAccounting`, so every phase
rolls into a per-company token budget. Budget exhaustion returns HTTP 429 rather than failing open.

State lands on disk under `~/.wavex-os/instances/default/companies/<companyId>/onboarding/` —
`pillar_responses.json`, the four manifests, `company.manifest.{yaml,json}`, `manifest.sig`, and
`mc-report.json`. **That directory is the durable output of Part 1**; the wizard hydrates from it on
refresh, and `activate` reads from it.

### 4.2 Part 2 — the runtime

Owned entirely by Paperclip. WaveX adds nothing here except the handoff that populates it.

- **323 routes** under `/api`, **38 service factories**, Drizzle + Postgres
- Agents heartbeat on a launchd timer, spawn `claude` under the per-agent wrapper, post comments and
  KPI snapshots back to issues, and are observed by the fleet-observer
- Issues carry a checkout lock (`checkoutRunId`), so only one run mutates an issue at a time
- Two human-in-the-loop gates: **approvals** (`hire_agent`, `budget_override_required`, …) and
  **thread interactions**, which block an agent mid-task until accepted, rejected, or answered
- Budgets are per-agent and per-company, in integer cents, with incidents and auto-pause

Full surface, I/O shapes, and auth model:
[`PAPERCLIP_BACKEND_AND_FRONTEND_PLAN.md`](./PAPERCLIP_BACKEND_AND_FRONTEND_PLAN.md).

---

## 5. The OAuth handoff (the load-bearing piece)

The hardest design problem was: **how does the spawned fleet inherit the user's Claude Max subscription without the token ever touching our servers?** Three options were considered:

- **A: pass the token through hosted backend** — rejected, security/privacy nightmare.
- **B: user copies token manually** — rejected, terrible UX.
- **C: wrapper script reads keychain on every heartbeat** — **chosen**. Token never leaves the user's machine. The Paperclip-spawned agent invokes `claude-anthropic-direct.sh`, which reads from the macOS Keychain (or platform-equivalent), refreshes on 401, falls back to Sonnet on rate-limit. This is the same wrapper pattern proven out in the WaveX OS prototype.

Phase E will productionize the wrapper:
- macOS: `security find-generic-password -s 'Claude Code-credentials' -w`
- Linux: `secret-tool lookup application 'Claude Code'`
- Windows: `cmdkey`-based equivalent

---

## 6. Templates: vendored vs. WaveX-authored

**165 curated templates** (up from 30 at Phase B), vendored from
[`msitarzewski/agency-agents`](https://github.com/msitarzewski/agency-agents) (MIT, 207 upstream,
credited per-file) plus WaveX-authored packs for roles missing or materially different upstream —
CEO, Chief of Staff, CMO, CRO, CTO, COO, CFO, CDO, CPO, Recovery Engineer, Concierge Ops, Composio
Integration, System Reliability.

Part 1 selects from these; the handoff assembles each hire's `instructionsBundle["AGENTS.md"]` by
concatenating the role's `SKILL.md` with its `SKILL_*.md` files, so **templates are the payload that
crosses the seam**. Shared kernel skills live in `_shared/` and are appended to every role.

`scripts/ingest-agency-agents.mjs` is the single source of truth for the import — re-run it after the
upstream repo updates. Note `packages/onboarding-ui/public/agent-templates/**` is a **frozen path**
per [`CLAUDE.md`](../CLAUDE.md); it is also fetched at runtime by `data/templates.ts`, so its layout
is a contract, not an implementation detail.

All templates are scrubbed for PII before being committed. See [CREDITS.md](../CREDITS.md) for the full attribution chain and license summary.

---

## 7. Subscription tiers (Phase F design)

| Tier | Price | Daily injections | Monthly tokens | Audience |
|------|-------|------------------|----------------|----------|
| Trial | $0 (14 days) | 1 | 200K | First-touch evaluation |
| Founder | $29/mo | 1 | 500K | Solo founder running 5–10 agents |
| Growth | $99/mo | 8 (hourly biz hours) | 2M | Small team, mid-velocity fleet |
| Custom | $299/mo | Unlimited | 10M+ | High-velocity, white-glove |

**Self-host path (always free):** the System Optimizer is a small cron job. We will publish it as a separate Docker image (`wavex-os-optimizer`) so anyone can run their own with their own API key. See `docs/SELF_HOSTING.md` (Phase F).

---

## 8. Security posture

- **No telemetry** — the localhost UI calls only local servers: the wavex Fastify server on `:3101`
  and, once handed off, Paperclip on `:3100`. Two exceptions to know about: components that use
  Supabase (`PrivacyPanel`, `HireAgentFlow`, `pages/Pricing`) call it directly when
  `VITE_SUPABASE_URL` is set, and T2 inference reaches Anthropic through the tier-router.
- **No secrets in repo** — `.gitignore` blocks `.env*`, `*.pem`, `*.key`, `secrets.json`, `~/.paperclip/`, `.claude/projects/`.
- **OAuth handoff is local-only** — see Section 5.
- **Templates are PII-scrubbed** at ingest time (see `scripts/ingest-agency-agents.mjs`).
- **Workflows that touch external services** (Composio, Stripe, GitHub) require explicit board approval before the spawned agents are allowed to call them.

---

## 9. Open architectural questions

### Resolved since Phase B

- ~~*How do we keep `packages/core/` synced with upstream without conflicts?*~~ — **Treat both
  vendored trees as read-only.** Import their types, call their APIs, never patch. wavex-os tracks
  its source SHA and documents every exception in [`VENDOR.md`](../../vendor/wavex-os/VENDOR.md);
  `packages/core` stays subtree-pullable because the wavex code lives at the seam, not inside it.
- ~~*Does the customize-chat talk to hosted or local?*~~ — **Local.** The help-chat runs through the
  tier-router on the operator's own machine, wrapped in `withTokenAccounting` against a per-company
  budget. Nothing about the wizard's content leaves the machine.

### Still open

- **How much of Part 2 should be visible from Part 1?** The seam is clean, but it leaves the
  operator without one place to answer "is my company working?" `IGNITION.md` already specifies a
  Mission Control banner and an Ignite Fleet button, which implies *some* Part-2 state belongs in
  Part 1. Scoped in
  [`PAPERCLIP_BACKEND_AND_FRONTEND_PLAN.md`](./PAPERCLIP_BACKEND_AND_FRONTEND_PLAN.md) §7.1; the
  recommendation there is a narrow read-only strip, not a second management UI.
- **How do L·IV specialists cross the seam?** Paperclip's role enum is coarser than the 33-slot
  roster, so only the C-Suite mirrors today (§2.1). Options: widen the enum upstream, carry the
  sub-role in `metadata`, or accept two rosters permanently and always label which one a count came
  from.
- **Should the two UIs converge?** They are different stacks — React 18 + inline styles versus React
  19 + Tailwind v4 + shadcn. Two tabs is a coherent product story; two design systems is a cost. If
  they should feel like one product, that decision is cheaper to make before more surfaces get built.
- **BYO-key for the System Optimizer?** Likely yes, leaning open-core. Decide before Phase F.
