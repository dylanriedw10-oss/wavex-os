# Frontend implementation plan — closing the ignition gap

**Status:** plan, awaiting approval. No code written.
**Scope:** `packages/onboarding-ui` (Part 1) plus one small read-only endpoint in
`packages/wavex-os-server`. Does **not** build a management console — see "Explicitly out of scope".

---

## Context

WaveX OS is two products joined by an opt-in handoff ([`ARCHITECTURE.md`](./ARCHITECTURE.md) §0).
Part 1 curates and materializes an agent swarm; Part 2 (Paperclip) runs it. That seam is deliberate
and this plan does not disturb it.

The problem is narrower and more specific than "the frontend needs work":

**The ignition backend is fully built. The frontend shows none of it.**

- `packages/wavex-os-server/src/bridge/ignition.ts` — 14 KB, implemented, all six steps
- `POST /api/instance/:companyId/ignite` — implemented (`routes/activate.ts:120`)
- `activate` already returns `{ ok, inserted, warnings, sha256, paperclipHandoff, ignition }`
  (`activate.ts:101-108`)

And [`IGNITION.md`](./IGNITION.md) already specifies the UI that was never built:

> *"the operator sees a **Mission Control banner** reading 'Fleet ignited — N agents working,
> M workflows queued'."*
> *"Operator hits **'Ignite Fleet' button in Mission Control** to retry."*

So this is unbuilt spec, not new scope. Today an operator finishes onboarding and has no way to know
whether the fleet actually started — which matters because the documented failure mode is precisely
that it *doesn't*: heartbeats are hard-coded off in the handoff and the fleet sits idle until
ignition succeeds.

**One backend gap blocks it.** `ignition-state.json` is written to
`~/.wavex-os/instances/<companyId>/` but **nothing reads it back over HTTP**. `activate` and `ignite`
are both POST and return the result inline, so on a page refresh the status is gone. `activate.ts:139`
carries the acknowledgement: *"in a future commit we'll read it from there."* This plan is that
commit.

**Assumptions I am proceeding under** (unanswered clarifying questions — say if any is wrong):

1. Scope is the **thin live strip**, not a management surface.
2. The **Helm** ([`HELM_SPEC.md`](./HELM_SPEC.md)) is a separate effort, not in this plan.
3. Paperclip may not be running on your machine today, so Phase 1 includes verifying the handoff
   fires before anything is built on top of it.

---

## Phase 0 — Design-system foundation

Prerequisite for everything visual, and independently the highest-value fix in the app.

**File:** `packages/onboarding-ui/src/styles.css` (161 lines today)

Additive only — every existing custom property keeps its current value, so onboarding, Mission
Control, and pricing are unaffected.

- Add `--brand` / `--brand-dim` / `--on-brand` as aliases of the existing accent values, and a **new
  `--success: #3fb98f`**. Today `--accent` carries six meanings at once (brand, link, focus ring,
  primary button, completed step, healthy). The banner needs "healthy" to be distinct from "brand"
  or it cannot say anything.
- Add type / 8px-space / radius / motion scales and `--font-mono`.
- Add the three global contracts the app has **never had** — all three counts are currently zero:
  `:focus-visible` (buttons have no focus style at all), `prefers-reduced-motion`, and a
  `@media (max-width: 900px)` rule.

Detail and exact values: [`HELM_SPEC.md`](./HELM_SPEC.md) §3.2 and §3.4.

⚠️ Do **not** write breakpoints against `.layout`, `.sidebar`, `.main`, or `.step-num` — they are
dead selectors with zero `className` hits. And note 81% of styling is inline, so inline styles beat
new stylesheet rules; §3.4's additions work only because they set properties inline styles don't.

---

## Phase 1 — Make ignition state readable

**New file:** `packages/wavex-os-server/src/routes/ignition.ts`
**Registered in:** `packages/wavex-os-server/src/index.ts` (alongside the other `register*Routes`)

```
GET /api/instance/:companyId/ignition
```

Reads `ignition-state.json` from `getInstanceDir(companyId)` and `paperclip-handoff.json`, and
returns a shape the UI can render directly:

```ts
{
  ok: true,
  status: "not_activated" | "deferred" | "partial" | "ignited",
  agentsWorking: number,
  workflowsQueued: number,
  goalId: string | null,
  paperclipUrl: string | null,       // null ⇒ handoff disabled, render differently
  paperclipCompanyId: string | null,
  steps: IgnitionState["steps"],     // reuse the existing type verbatim
  errors: IgnitionState["errors"],
  warnings: string[],
  startedAt: string, completedAt: string | null,
}
```

Reuse, do not redefine: `IgnitionState`, `IgnitionStepStatus`, and `IgnitionResult` are already
exported from `bridge/ignition.ts:29-56`. `HandoffReport` from `bridge/paperclip-handoff.ts`.

**Missing file is not an error.** Return `200 { ok: true, status: "not_activated" }`. A 404 would be
converted into a thrown `ApiError` by the client's `call()` helper, which treats any non-2xx as a
failure — and "you haven't activated yet" is a normal state, not a failure.

**Auth:** mirror `help-chat.ts`, with the correction from [`HELM_SPEC.md`](./HELM_SPEC.md) §5 — put
`assertBoard` **and** `assertCompanyAccess` inside one `try`. Every existing route leaves the second
one unguarded, so its 403 escapes as a 500. Do not copy that. Also validate `companyId` with a slug
regex before it reaches `join()`.

**Why a new route file rather than extending `activate.ts`:** activate is POST-only and mutation-
heavy; a cheap polled read does not belong beside it.

---

## Phase 2 — Make the two-tab handoff actually work

The design requires Tab A → Tab B, but Tab B currently points at a dead port.

| Change | File |
|---|---|
| Dev port `5173` → `5174` | `packages/core/ui/vite.config.ts:26` |
| De-duplicate `paperclipUiUrl` into one shared helper | `src/wavex-os/lib/` — currently duplicated at `WavexOsOnboarding.tsx:28-34` and `Materialize.tsx:18-20`, and the header comment says so |

`packages/core` is a vendored subtree, so weigh the one-line port change against subtree-pull cost.
The alternative — read the target port from an env var on the wavex side — avoids touching core at
all and is the safer option if you pull upstream often.

**Verify before building further:** start Paperclip (`cd packages/core && pnpm dev:server`), restart
wavex, and confirm the boot log reads `[paperclip-detect] → paperclip auto-detected at
http://127.0.0.1:3100`. If it says "handoff disabled", nothing downstream is testable.

---

## Phase 3 — Client methods

**File:** `packages/onboarding-ui/src/wavex-os/lib/api.ts` — extend the existing
`wavexOsOnboardingApi` object. Do **not** create a parallel client: this one has 21 importers and is
the established convention; Mission Control's raw-`fetch` habit is the anti-pattern.

```ts
getIgnitionStatus(companyId: string): Promise<IgnitionStatusResponse>
igniteFleet(companyId: string): Promise<{ ok: true; ignition: IgnitionResult }>
```

Both go through the existing `call<T>()` helper (`api.ts:27-42`), which already throws a typed
`ApiError` on non-2xx and surfaces `halt.operator_message` in preference to `error`.

---

## Phase 4 — The banner

### 4a. Two placements, not one

`Materialize.tsx` (341 lines) already renders a **"Paperclip handoff"** result panel at
`Materialize.tsx:208-230`, populated from `r.paperclipHandoff` at `:70-75`. But it contains **zero**
references to `ignition`, `agents_working`, or `workflows_queued` — the activate response carries the
ignition report and the UI **discards it**.

That is a free win and it changes the shape of this phase. There are two moments an operator needs
this, and they want different things:

| Where | When | What it answers |
|---|---|---|
| `Materialize.tsx`, beside the existing handoff panel | immediately after activate | "did it start?" |
| `MissionControl.tsx`, persistent banner | every later visit | "is it still running?" |

Build the shared presentational piece once and mount it in both. The Materialize instance reads from
the activate response already in hand — **no fetch at all**. The Mission Control instance fetches via
Phase 1. Same component, different data source.

### 4b. The component

**New files:**
- `src/components/mission/IgnitionBanner.tsx` — presentational, takes a status object as a prop
- `src/components/mission/useIgnitionStatus.ts` — the React Query hook, Mission Control only

**Rendered by:** `MissionControl.tsx` under the header above `KpiBoard`; and `Materialize.tsx`
adjacent to the handoff panel at `:208`.

**Template to copy: `src/wavex-os/components/BudgetChip.tsx`.** It is the closest existing analogue —
the only self-contained `{ companyId }` component that does both a read *and* a write with cache
invalidation. `TokenCounter.tsx` and `T2ProgressIndicator.tsx` are read-only chips; useful for the
polling shape, but BudgetChip is the one with the action button.

There is no generic status-strip primitive in this codebase to extend — all three are bespoke. Match
their structure rather than inventing a new one.

```tsx
useQuery({
  enabled: !!companyId,
  queryKey: ["ignition", companyId],
  queryFn: () => wavexOsOnboardingApi.getIgnitionStatus(companyId!),
  refetchInterval: 15_000,
})
```

Five states, each with a distinct tone from Phase 0:

| Status | Tone | Copy | Action |
|---|---|---|---|
| no company selected | — | render nothing | — |
| `not_activated` | `--text-dim` | "Not activated yet." | `<Link to="/onboarding">` |
| `deferred` | `--warning` | "Fleet activated but not ignited — agents are idle." | **Ignite Fleet** |
| `partial` | `--warning` | "Fleet ignited (partial) — N working, K gaps." | **Ignite Fleet** + expand errors |
| `ignited` | `--success` | "Fleet ignited — N agents working, M workflows queued." | **Open Paperclip ↗** |

The `deferred` copy matters most. That is the documented default outcome — heartbeats hard-coded off
at `paperclip-handoff.ts:219` — and saying "activated" there would tell the operator the opposite of
the truth.

**The Ignite Fleet button.** `POST /ignite`, then invalidate. The house write pattern is not a
description — copy it verbatim from `BudgetChip.tsx:45-53`:

```ts
setError(null);
try {
  await wavexOsOnboardingApi.setTokenBudget(companyId, value);      // → igniteFleet(companyId)
  await qc.invalidateQueries({ queryKey: ["token-budget", companyId] });  // → ["ignition", companyId]
} catch (e) {
  setError(e instanceof ApiError ? e.message : (e as Error).message);
} finally {
  setBusy(false);
}
```

There is **zero** `useMutation` in this package; introducing it here would be a new convention, not
conformance.

Disable while in flight and surface `errors[]` inline — ignition is partial-tolerant and step-level
failures are the normal case, not an exception.

**Expandable step detail** (collapsed by default): the six steps from `IgnitionState["steps"]` with
a status glyph each. Ignition is re-entrant and resumes at the first incomplete step, so showing
which step stalled is what makes the retry button meaningful rather than a blind redo.

**Accessibility:** real `<button>` elements so Phase 0's `:focus-visible` applies;
`aria-live="polite"` on the status line; 44px minimum tap targets.

---

## Phase 5 — Optional, decide after Phase 4 ships

Only if the banner proves useful. Each is independent and skippable.

- **Handoff detail panel** — which slots mirrored, which were skipped and why. The data is already in
  `paperclipHandoff.created[] / .skipped[] / .errors[]`; nothing new is needed server-side. Worth it
  because only ~7 of ~35 agents cross the seam and nothing currently says so.
- **Retire the polling inconsistency** — `HealthStrip` (5s) and `FleetGraph` (8s) hand-roll
  `setInterval` while everything else uses React Query. Converting them removes duplicated fetch and
  error handling.
- **Replace `reactflow` with `GET /companies/:id/org.svg`** — Paperclip renders the org chart
  server-side. Drops a heavy dependency and a globally-injected stylesheet. Requires the proxy split
  ([`PAPERCLIP_BACKEND_AND_FRONTEND_PLAN.md`](./PAPERCLIP_BACKEND_AND_FRONTEND_PLAN.md) §1.6).

---

## Explicitly out of scope

- **`/fleet`, `/queue`, `/approvals`, `/spend` as full surfaces.** That is Option C — it duplicates
  the 120 screens `packages/core/ui` already ships against the same 323-route API, and contradicts
  the two-part architecture. Deep-link to Tab B instead.
- **The Helm.** Separate spec, separate effort.
- **Fixing the three repo-wide auth defects.** Real and worth doing
  ([`PAPERCLIP_BACKEND_AND_FRONTEND_PLAN.md`](./PAPERCLIP_BACKEND_AND_FRONTEND_PLAN.md) §7.7), but
  they touch 19 route files and do not belong in a feature commit. The new route in Phase 1 avoids
  the defects rather than propagating them.
- **Frontend test infrastructure.** `packages/onboarding-ui` has no vitest and zero `*.test.tsx`.
  Standing it up is worthwhile and separate.

---

## Verification

**Backend (Phase 1), against the seven suites in `packages/wavex-os-server/test/`:**

```bash
pnpm --filter @wavex-os/* test
```

Cover: unauthenticated → rejected; missing `ignition-state.json` → `200 not_activated`, not 404;
malformed `companyId` → 400 before any path join; a real state file → correct `status` derivation
across `deferred` / `partial` / `ignited`.

**End-to-end, both halves running:**

```bash
cd packages/core && pnpm dev:server     # Part 2 on :3100
pnpm dev                                # Part 1 on :5173 + :3101
```

1. Boot log shows `[paperclip-detect] → paperclip auto-detected at http://127.0.0.1:3100`.
2. Run the wizard to activate (`docs/DEMO_RUNBOOK.md`, or `?t0=1` fast mode for iteration).
3. Mission Control shows the banner. **Refresh the page — it must survive**, which is the whole point
   of Phase 1.
4. Force the failure path: stop Paperclip, activate again → banner reads `deferred`. Restart
   Paperclip, click **Ignite Fleet** → transitions to `ignited` or `partial`.
5. Confirm `~/.wavex-os/instances/<companyId>/ignition-state.json` matches what the banner shows.
6. Tab through the banner — focus ring visible on every control (Phase 0).
7. Narrow to 375px — no horizontal scroll.

**Typecheck:**

```bash
pnpm --filter @wavex-os/onboarding-ui build   # tsc -b && vite build
```

---

## Sequencing

Phases 0–1 are independent and can land in parallel. 2 unblocks manual testing. 3 → 4 are sequential.

| Phase | Deliverable | Size |
|---|---|---|
| 0 | design tokens + three global contracts | ~60 lines CSS |
| 1 | `GET /api/instance/:companyId/ignition` + tests | ~120 lines + tests |
| 2 | port fix + de-duplicated helper | ~10 lines |
| 3 | two client methods | ~20 lines |
| 4 | `IgnitionBanner.tsx` + `useIgnitionStatus.ts`, mounted in both `MissionControl.tsx` and `Materialize.tsx` | ~200 lines |

One commit per phase, conventional-commit prefixes per [`CLAUDE.md`](../CLAUDE.md).
