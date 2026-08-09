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

Beware one name collision: `main.tsx` used to mount a component *called*
`OnboardingWizard` outside `<Routes>`. That is a different thing — a 3-step
new-user overlay ("Connect your repo" / "Connect your workspace" / "Run your
first smoke test").

**Update — that overlay is now orphaned too, by the same rule.** It is
unmounted from `main.tsx`; the component and its server routes are intact on
disk. Reason: mounted outside `<Routes>` and gated on `is_new_user`, it
rendered above every surface, so a brand-new operator's FIRST screen was
"Connect your repo" rather than the build flow. Onboarding is `/build` —
chat left, canvas right — always, and two "STEP 1 OF n" wizards in front of
each other is what this cutover existed to remove.

It stayed invisible for a long time for a reason worth keeping: `/api/users/me`
was returning 500 (four migrations were missing from the drizzle journal) and
the component's `.catch()` read that as "no backend, skip wizard". The overlay
never rendered for anyone, so the collision only appeared once the backend was
repaired. A silent fallback hid it, not a subtle interaction.

**What that cost, named rather than tabled away.** `OnboardingWizard` was the
only UI that wrote `users.wizard_repo` and the only thing that triggered a
smoke-test run (`QaCelebrationController` only *reads* status and is still
mounted). `PATCH /api/users/:id/wizard-repo` and `POST /api/smoke-test/trigger`
still exist and still work — the capability lost its entry point, not its
implementation. Repo connection and the first smoke test are worth having;
they belong inside the build flow rather than in front of it.

Retired with it:

| spec | covered | why it went |
|---|---|---|
| `wizard-title.spec.ts` | the overlay retitling the browser tab per step | asserts the overlay renders on `/`; it no longer mounts |
| `wizard-backend-failure.spec.ts` | that a *broken* backend logs while an *absent* one stays quiet | exercised the overlay's `users/me` handling — with it unmounted the spec could not fail, and a test that cannot fail is worse than none |
| `wizard-does-not-gate-build.spec.ts` | the overlay not covering `/build` | superseded by `onboarding-is-build.spec.ts`, which asserts the stronger thing |

The fail-open fix `wizard-backend-failure.spec.ts` guarded is still in
`OnboardingWizard.tsx` — a 5xx logs, a rejected fetch does not. It is
uncovered while the component is unmounted; re-cover it if the component
returns.

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
