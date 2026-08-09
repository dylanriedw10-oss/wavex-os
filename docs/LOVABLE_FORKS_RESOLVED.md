# §13 Resolved — the open forks, closed from evidence

**This supersedes §13 of the Frontend Constitution.** Each fork below is
resolved against the code that is actually shipped, with the citation inline
so you can re-check rather than take my word. Two of the four were resolved
*by the backend already having decided*; one is resolved in a source comment;
the fourth turns out not to be a fork at all.

---

## Fork 1 — Fixed vs. dynamic departments

**Neither. Departments are a structural position, not a category.**

`packages/wavex-os-server/src/org/nodes.ts:325`:

```ts
return isRootReport && hasKids ? `dept:${slot}` : `agent:${slot}`;
```

A slot is a **department** if it is a direct report of the root *and* has
children. Otherwise the same slot is an **agent**. There is no department
list anywhere — fixed or configurable — because departments cannot be
enumerated in advance by construction. They fall out of whatever shape the
swarm manifest produced for that company.

Verified live: one seeded org returns 6 departments with ids like `dept:cpo`,
derived from a 7-chief slot taxonomy in `bridge/catalog.ts`
(`ceo cdo cfo cmo coo cpo cro`).

**For the build:** render whatever `org/flywheel` returns in `departments[]`.
Never hardcode a set, never assume a count, and do not treat
Ops/Growth/Product as meaningful — that trio appears nowhere in this codebase.

---

## Fork 2 — Is `agent` a first-class node kind?

**Yes — and it is the *same node type* as a department.**

Same line as Fork 1. `department` and `agent` are one object differentiated
only by whether it has children, and `childrenOf` returns them
interchangeably in a single `NodeChildRef[]`.

This is the brief's own §1 definition, implemented literally:

> "A 'living folder' is a node whose children are themselves grouping nodes."

So the fork dissolves. `agent` is first-class in the *model* — addressable,
walkable, same `OrgNodeDto` shape — while §1's separate rule still holds for
the *view*: the visible unit is the workflow phase, and the frontend never
renders a roster. Those were never in tension; the brief was asking whether
the model should carry something the view refuses to show, and the answer is
that it already does, harmlessly.

**For the build:** one `Node` component, differentiated by `kind`, exactly as
§9's spatial primitives specify. Do not build a separate Agent component.

---

## Fork 3 — The Paperclip backend assumption

**Resolved, and the transcript was right.** `routes/activate.ts:23`:

```
/** Paperclip is no longer the runtime (spec Rev 6). The response keeps a
 *  stub handoff record because the Materialize screen reads it
 *  unconditionally — enabled:false renders its existing quiet branch. */
```

The runtime is `igniteNative` (`bridge/ignition-native.js`). The Paperclip
path survives only as a conditional at `activate.ts:303` —
`handoff.paperclipCompanyId ? ignite(...) : igniteNative(companyId)` — and the
stub exists solely so an existing screen that reads the field unconditionally
keeps rendering its quiet branch.

The separate backend spec that "defaults to reusing an existing
agent-hierarchy repo" is **stale**, not authoritative. `pnpm dev:no-paperclip`
is the normal dev path and runs the whole product.

**For the build:** assume no Paperclip. If you encounter a handoff record,
`enabled: false` is the expected value and renders quietly.

---

## Fork 4 — The onboarding-questions audit

**Not a fork — an unbuilt feature with its destination already in place.**
Part of the audit is run here.

Brief §2.1 specifies three forced-choice questions that "write straight into
the Constitution rather than a separate field":

| brief §2.1 question | Constitution category | exists? |
|---|---|---|
| fast-vs-reliable slider | `risk_tolerance` — "Risk tolerance" | **category yes, question no** |
| ranked list of what matters | `success_definitions` — "Success definitions" | **category yes, question no** |
| failure handling (retry / ask / escalate / pause) | `escalation_paths` — "Escalation paths" | **category yes, question no** |

All three categories are real (`org/store.ts:198-220`, and `risk_tolerance`
verified live in `GET /org/constitution`). The full set is 14: identity_mission,
optimization_priorities, pace_rules, never_sacrifice, global_goals,
budgets_constraints, approval_thresholds, risk_tolerance, brand_voice,
compliance_rules, agent_permissions, working_hours, escalation_paths,
success_definitions.

What pillars 3–5 actually ask today: `product_state`, `stage`, `lead_sources`,
`sales_motion`, `close_channel`, `comm_channel`, `urgency_routing`,
`board_endpoint_config`. **None of the three brief questions is among them** —
`failure_handling` appears nowhere in the codebase.

**For the build:** the three questions are yours to add, and the Constitution
slots are waiting. Until they exist, do not render those categories as if an
operator answered them — an unanswered `risk_tolerance` is empty, not
"balanced". That is §10's no-fake-data rule applied to the Constitution.

---

## What remains genuinely open

Nothing from §13. The forks were: two already decided by the data model, one
decided in Rev 6, one that was a build task wearing a fork's clothing.

The real open questions are elsewhere and are named in the API addendum: there
is no `confidence` field on the wire, `momentum` is permanently `null`, and
`health` is frequently `null` on live nodes. Those constrain what §4's
investigation anatomy can honestly render, and no amount of frontend decision
resolves them — they need backend work or a narrower §4.
