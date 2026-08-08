# Retired specs — the onboarding cutover

These suites drove `/onboarding-chat` (the legacy wizard shell), which the
cutover deleted. They could not be "fixed": the surface they asserted against
does not exist.

Removed:


| Spec | What it proved | Where that lives now |
|---|---|---|
| `chat-first-fast.spec.ts` | a fast walk of the chat-first wizard | `build.spec.ts` (routes + the ONE Confirm) |
| `chat-first-resume.spec.ts` | resume hydration from seeded pillar state | `build/state/hydrate.ts` + its server-authority rule |
| `wavex-qa-422.spec.ts` | wizard flow → activate fleet | `build.spec.ts` "one Confirm produces a real runtime" |
| `qa-422-activate.spec.ts` | seeded company → activate | server `ignition-native.test.ts`, `approve-organization.test.ts` |
| `screenshot-walkthrough.spec.ts` | named screenshots of every wizard step | — (a capture harness, not coverage) |
| `screenshot-mission-control.spec.ts` | Mission Control capture | — (same) |
| `_demo-handoff.spec.ts` | headed demo driving the wizard | — (a demo driver, not coverage) |

**Honest note on what was lost.** The two screenshot harnesses and the demo
driver produced artifacts for `docs/images/`, not assertions; nothing that
gated a change went with them. The three real suites were replaced as tabled
above. `build.spec.ts` deliberately does not re-drive Phases 1–3 through the
DOM — pillar inference and plan research are covered server-side, and clicking
through them would buy flakiness rather than truth.

## Second pass — `/onboarding` (the 5-pillar wizard)

The table above retired the `/onboarding-chat` specs. It missed the specs
driving the OTHER deleted entrance, `/onboarding`, because they fail loudly
rather than silently and were read as breakage rather than as retirement.

Removed (tests, not whole files, except where noted):

| Spec | What it proved | Where that lives now |
|---|---|---|
| `onboarding.spec.ts` (whole file) | the full welcome → 5 pillars → 3 phases → concierge → finalize DOM walk | `build.spec.ts` "one Confirm produces a real runtime" |
| `flow-variants.spec.ts` v1 | the same happy path, plus activate → Mission Control | same |
| `flow-variants.spec.ts` v2 | welcome screen lists an existing draft | — (no company picker on `/build`) |
| `flow-variants.spec.ts` v3, v4 | Reset-only and Reset+restart from the welcome picker | — (no picker; reset is not a `/build` affordance) |
| `flow-variants.spec.ts` v5 | the in-wizard `↺ Reset` button | — (same) |
| `flow-variants.spec.ts` v6 | slug-conflict warning disables Start | — (`/build` derives the slug; there is no Start gate) |
| `flow-variants.spec.ts` v7 | resume a partial draft, auto-route to Pillar 4 | `build/state/hydrate.ts` + its server-authority rule |
| `bug-hunt.spec.ts` B14a | page refresh after add-agent, via the Swarm phase button | — (no phase nav on `/build`) |
| `bug-hunt.spec.ts` B15a | the rename hint when the typed name differs from `?companyId=` | — **see the note below** |
| `bug-hunt.spec.ts` B16b | the token chip in the wizard header | — (chip lives in `TokenCounter.tsx`, mounted only by the orphaned shell) |

**The trap, recorded so the next reader doesn't fall into it.** The wizard was
**orphaned, not deleted**. `WelcomeScreen.tsx`, `pillars/Pillar1.tsx`,
`WavexOsOnboarding.tsx` and the rest still sit on disk, and every string these
specs asserted — `Onboarding`, `In progress`, `↺ Reset`, `Pillar 1 — who you
are` — still greps green. What makes them stale is the *reachability* chain:
`index.html` loads only `main.tsx`; `main.tsx:61-62` redirects `/onboarding`
and `/onboarding-chat` to `/build`; and `WavexOsOnboarding` — the host that
mounts all of it — has **zero import sites** in source. Unrouted and unmounted
is the same as deleted. A grep alone will tell you the opposite.

Beware one name collision: `main.tsx:47` mounts a component *called*
`OnboardingWizard` outside `<Routes>`. That is a different thing — a 3-step
new-user overlay ("Connect your repo" / "Connect your workspace" / "Run your
first smoke test"). `wizard-title.spec.ts` covers it and is **live**.

**Honest note on what was lost.** v2–v6 covered welcome-screen affordances
that have no successor because the screen has no successor — that coverage did
not move, it ended. Two losses are worth naming rather than tabling away:

- **B15a's rename hint.** `/build` cannot rename a supplied `companyId` at all
  (`BuildOrgPage.tsx` only calls `setCompanyId` when one is absent), so the
  behaviour is gone rather than relocated. Nothing regressed; there is simply
  less to test.
- **The 5-pillar DOM walk.** Deliberately not reproduced. Pillar inference and
  plan assembly are covered server-side, and `build.spec.ts` asserts the
  redirect and the commit instead.

Still present and still stale, left in place on purpose: `bug-hunt.spec.ts`
B14b and B15b drive `/onboarding` exactly as B14a and B15a did, but sit behind
`WAVEX_E2E_T2=1` and so never report. They are retirement candidates on the
same evidence, not live coverage.
