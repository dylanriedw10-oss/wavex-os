# Mission Control — what to carry forward

**Status:** reference. Mission Control (`/`, `pages/MissionControl.tsx` +
`components/mission/*`, ~1,200 lines) is **excluded from the frontend
standardization** by operator decision. It stays on the legacy dark theme and
is not restyled.

This document exists so that exclusion doesn't lose anything. It records what
each view actually tells the operator, which of those facts the canvas
**cannot currently express**, and what should be rebuilt in the canvas language
later.

---

## Why it reads as outdated

Not the styling — the **information architecture**. Mission Control puts three
different audiences on one screen:

| Audience | Views | Belongs |
|---|---|---|
| **The operator**, asking about their company | KPI scoreboard, fleet graph, inception CTA | the canvas |
| **The process**, asking "is the runtime alive" | health strip, allocation slider | the canvas's Pulse + Runtime tray |
| **The business**, asking about customers in aggregate | wizard metrics, partner checklist | an admin surface — not the operator's home |

That mixture is precisely what `FRONTEND_CONSTITUTION.md` forbids
(*"WaveX is not a dashboard… Never build traditional SaaS dashboards"*). The
screen isn't wrong because it's dark; it's wrong because it answers three
unrelated questions at one altitude with no descent.

A second reason: **parts of it are factually stale after Rev 6.** `HealthStrip`
polls `/api/paperclip/health` and `InceptionCTA` links to the Paperclip
dashboard, but Paperclip is no longer the runtime. Those two read the wrong
system.

---

## View-by-view: the information, and whether the canvas already has it

### 1. KPI scoreboard (`KpiBoard.tsx`) — **the most valuable thing here**

Reads `/api/instance/<id>/manifest` + `/api/instance/<id>/kpis` (30s poll). Per KPI:

- `label`, `kpiId`
- `direction: higher_is_better | lower_is_better`
- `ownerRole` — **which agent slot owns this number**
- `currentValue`, `targetMicros`, `windowDays`

**The canvas cannot express this.** Its Work lens has *goals with done/total
task meters* — a count of tasks, not a business metric. There is no notion of a
KPI with a direction, a target window, or an owning role anywhere in the org
spine. `OrgNode.objective` carries a title and a status enum, nothing numeric.

**Carry forward:** KPIs are the strongest candidate for a **metric node kind**
that already exists in the taxonomy (`metric:*` nodes are in `org/nodes.ts` and
render as hub sub-dials). A KPI is a metric node with a target and an owner —
the wheel's sub-dial row is the natural home, and `ownerRole` is a real edge
from a metric to an agent that the influence graph could carry.

### 2. Fleet graph (`FleetGraph.tsx`)

Reads `/api/agents` → `OrgGraph`. Per agent: `agentId`, `slot`, `templateId`,
`reportsToSlot`, `ownedKpiIds`, `status: pending | spawning | ready | failed`.

Two facts the canvas lacks:

- **Spawn lifecycle.** `pending → spawning → ready → failed` is an agent's
  *provisioning* state. The canvas's `OrgNode` has `activity` (active/idle) and
  `health` — neither says "this agent was never successfully created." An
  operator whose CFO silently failed to spawn currently has no surface that
  says so.
- **`ownedKpiIds`** — the agent↔KPI ownership edge, same gap as above.

The reporting tree itself is already covered (the wheel + the desk's
`MiniOrgChart` render it better).

**Carry forward:** spawn status as an `OrgNode` field, and the KPI ownership
edge. Not the graph visualization.

### 3. Inception CTA (`InceptionCTA.tsx`)

Answers "the fleet is live but nothing is visibly happening — is that normal?"
Surfaces the heartbeat cadence and a **force-first-cycle** affordance.

**Mostly covered.** The canvas's 503 seed gate, `Run cycle`, and the Runtime
tray answer this better and more honestly. The one uncovered fact is
**heartbeat cadence** — when the next unattended tick will fire. The canvas
only shows what a cycle *would* pick, never *when* it would run on its own.

**Carry forward:** scheduled-cycle timing, which is already a named P2 in
`RECURSIVE_ORG_SPEC.md`. Drop the Paperclip link.

### 4. Health strip (`HealthStrip.tsx`)

5s poll of `/api/paperclip/health` → service, version, agent count, reachable.

**Superseded and stale.** The canvas's `Pulse` bar carries the same liveness
signal against the correct (native) runtime. The agent count is on the company
node's snapshot.

**Carry forward:** nothing. Delete when Mission Control is retired.

### 5. Allocation slider (`AllocationSlider.tsx`)

`/api/inference-allocation` — splits the operator's Claude Max between the
swarm and Pool A.

**Note the compliance overlap:** `docs/INFERENCE_COMPLIANCE.md` (2026-08-02)
established that a subscription may only serve its own purchaser, and Pool A
routes the free tier to the operator's subscription. **Do not rebuild this
control until that routing question is settled** — re-surfacing it would make
the prohibited pattern easier to use.

### 6. Onboarding checklist + wizard metrics (`OnboardingChecklist.tsx`, `WizardMetricsPanel.tsx`)

Partner activation milestones (5s poll, fires `partner_activation_complete`),
and TTV median/p75, the `start → step1 → step2 → step3 → first_result` funnel,
and weekly cohort completion rates.

**These are not org state.** They are product analytics about *customers*,
rendered on the *customer's own* screen. They answer WaveX's questions, not the
operator's.

**Carry forward:** move to an admin/ops surface. They should never appear in
the canvas.

---

## Summary — the three things worth rebuilding

1. **KPIs as metric nodes** — label, direction, current/target, window, and an
   owning slot. The single biggest information gap between Mission Control and
   the canvas.
2. **Agent spawn lifecycle** (`pending/spawning/ready/failed`) as an `OrgNode`
   field, so a failed hire is visible.
3. **Scheduled-cycle cadence** — when the runtime will next act unattended.

Everything else is either already better in the canvas, stale after Rev 6, or
belongs to a different audience.

## Endpoints Mission Control owns

`/api/agents` · `/api/companies` · `/api/companies/<id>/agents` ·
`/api/inference-allocation` · `/api/instance/<id>/manifest` ·
`/api/instance/<id>/kpis` · `/api/instance/<id>/handoff` ·
`/api/paperclip/health` · `/api/paperclip-reachable` · `/api/paperclip/spawn` ·
`/api/partner-checklist/<id>` · `/api/partner-signals/emit` ·
`/api/wizard-events` · `/api/wizard-metrics`

Kept here so that retiring the page later is a bounded change rather than a
search.
