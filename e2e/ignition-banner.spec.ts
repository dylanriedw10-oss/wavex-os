/** Mission Control can now answer "did my fleet actually start?"
 *
 *  Before this, the page had NO read of ignition state. The card in the slot
 *  asserted "Inception · your fleet is live" from a fetch whose failure it
 *  swallowed, and `wavexOsOnboardingApi.igniteFleet` had shipped with zero
 *  call sites — the only retry in the product was typing "ignite the fleet"
 *  into the canvas chat.
 *
 *  ── The honesty assertions ───────────────────────────────────────────────
 *
 *  `agentsWorking` is NULLABLE at the source: two ignition variants write the
 *  state file and only one of them touches agents. The banner must therefore
 *  OMIT the agent clause rather than print "0 agents working", because those
 *  are different sentences and only one is true. That is the case the old
 *  code could not express — it served the seeded task count as the agent
 *  count AND as the queued count, so "7 agents working, 7 queued" was one
 *  number printed twice for a 35-agent company.
 *
 *  Gaps come from `validate_coverage.gaps`, not `warnings.length`: a healthy
 *  idempotent re-activate pushes a warning and used to render "1 gaps".
 *
 *  ── SCOPE, stated because I got it wrong first ───────────────────────────
 *
 *  This spec stubs `/ignition` with page.route, so it exercises the BANNER
 *  and nothing behind it. Reverting the server's derivation leaves all of
 *  these passing — I ran that ablation expecting failures and got none,
 *  which is the correct result and means the header's claim had to change,
 *  not the test. The route's own derivation is pinned by
 *  packages/wavex-os-server/test/ignition-route.test.ts, where reverting it
 *  fails 5 tests.
 *
 *  ABLATION, RUN: making `measured()` in lib/ignition-copy.ts print the
 *  agent clause unconditionally (`?? 0`) fails the null-agents case here
 *  while the rest pass. That is the client-side half of the same defect.
 */

import { test, expect, type Page } from "@playwright/test";

const IGNITION = "**/api/instance/*/ignition";
const CO = "pw-ign";

type Partial = Record<string, unknown>;

async function serveIgnition(page: Page, body: Partial) {
  await page.route(IGNITION, (route) =>
    route.fulfill({
      status: 200, contentType: "application/json",
      body: JSON.stringify({
        ok: true, status: "ignited", agentsWorking: null, workflowsQueued: 0,
        gaps: [], goalId: null, paperclipUrl: null, paperclipCompanyId: null,
        steps: null, errors: [], warnings: [],
        startedAt: new Date().toISOString(), completedAt: new Date().toISOString(),
        ...body,
      }),
    }));
}

/** `/` is gated by Entry: with zero companies it redirects to /build, so
 *  Mission Control is only reachable once one exists. CompanyContext itself
 *  reads the selection from `?companyId` and nothing else. */
async function openMissionControl(page: Page, opts: { withCompany?: boolean } = {}) {
  const withCompany = opts.withCompany ?? true;
  // Dismiss the first-run tour. Its overlay covers the page and intercepts
  // pointer events, so without this the Ignite click lands on a backdrop —
  // which is real behaviour for a first-time operator, just not what this
  // spec is measuring.
  await page.addInitScript(() => localStorage.setItem("coachmark-mission-v1", "1"));
  await page.route("**/api/companies", (route) =>
    route.fulfill({
      status: 200, contentType: "application/json",
      body: JSON.stringify({ ok: true, companies: withCompany ? [{ id: CO, name: "Ignition Co", state: "live", updatedAt: Date.now() }] : [] }),
    }));
  await page.goto(withCompany ? `/?companyId=${CO}` : "/");
}

const banner = (page: Page) => page.getByTestId("ignition-banner");

test.describe("the ignition banner", () => {
  test.skip(!process.env.WAVEX_E2E_FIXTURE_ENGINE, "needs the fixture engine — run with WAVEX_E2E_FIXTURE_ENGINE=1");

  test("ignited, with a real agent count → both clauses, each measured", async ({ page }) => {
    await serveIgnition(page, { status: "ignited", agentsWorking: 12, workflowsQueued: 4 });
    await openMissionControl(page);

    await expect(banner(page)).toContainText("Fleet ignited.");
    await expect(banner(page)).toContainText("12 agents working");
    await expect(banner(page)).toContainText("4 pieces of work queued");
    // The colour ships a word — DESIGN_TOKENS, and the banner is useless in
    // grayscale without it.
    await expect(banner(page)).toContainText("running");
  });

  test("ignited, but the run never counted agents → NO agent clause at all", async ({ page }) => {
    await serveIgnition(page, { status: "ignited", agentsWorking: null, workflowsQueued: 7 });
    await openMissionControl(page);

    await expect(banner(page)).toContainText("Fleet ignited.");
    await expect(banner(page)).toContainText("7 pieces of work queued");
    // THE ASSERTION. A null must not become a zero, and must not become the
    // queued count wearing an agent's name.
    await expect(banner(page)).not.toContainText("agents working");
    await expect(banner(page)).not.toContainText("0 agents");
    await expect(banner(page)).not.toContainText("7 agents");
  });

  test("deferred → says it never ignited, and offers the control that fixes it", async ({ page }) => {
    await serveIgnition(page, { status: "deferred", agentsWorking: null, workflowsQueued: 0, completedAt: null });
    await openMissionControl(page);

    await expect(banner(page)).toContainText("Activated, but never ignited.");
    await expect(banner(page)).toContainText("idle");
    await expect(banner(page).getByRole("button", { name: "Ignite fleet" })).toBeVisible();
  });

  test("partial → gaps come from coverage, not from the warning count", async ({ page }) => {
    await serveIgnition(page, {
      status: "partial", agentsWorking: 30, workflowsQueued: 5,
      gaps: ["cro.outbound", "cfo.forecast"],
      // A healthy idempotent re-activate pushes exactly this, and it used to
      // be counted as a gap.
      warnings: ["work store already seeded — steps re-recorded from the existing store"],
    });
    await openMissionControl(page);

    await expect(banner(page)).toContainText("Ignited, but not completely.");
    await expect(banner(page)).toContainText("2 coverage gaps");
    await expect(banner(page)).not.toContainText("1 coverage gap ");
  });

  test("not_activated → no fleet claim, no ignite button, a way forward", async ({ page }) => {
    await serveIgnition(page, { status: "not_activated", agentsWorking: null, workflowsQueued: 0, completedAt: null });
    await openMissionControl(page);

    await expect(banner(page)).toContainText("No fleet yet.");
    await expect(banner(page).getByRole("button", { name: /Ignite/ })).toHaveCount(0);
    await expect(banner(page).getByRole("link", { name: /Build an organization/ })).toBeVisible();
  });

  test("the read fails → says it cannot tell, rather than going quiet", async ({ page }) => {
    await page.route(IGNITION, (route) => route.fulfill({ status: 500, body: "{}" }));
    await openMissionControl(page);

    // A banner whose job is to report whether something runs must not vanish
    // when it cannot find out — that silence is the original defect.
    await expect(banner(page)).toContainText("Can’t tell whether the fleet is running.");
    await expect(banner(page)).toContainText("only that this panel could not read it");
    await expect(banner(page).getByRole("button", { name: "Check again" })).toBeVisible();
  });

  test("Ignite fleet → POSTs, then re-reads, and reports the NEW state", async ({ page }) => {
    let ignited = false;
    await page.route(IGNITION, (route) =>
      route.fulfill({
        status: 200, contentType: "application/json",
        body: JSON.stringify({
          ok: true,
          status: ignited ? "ignited" : "deferred",
          agentsWorking: ignited ? 9 : null,
          workflowsQueued: ignited ? 3 : 0,
          gaps: [], goalId: null, paperclipUrl: null, paperclipCompanyId: null,
          steps: null, errors: [], warnings: [],
          startedAt: new Date().toISOString(),
          completedAt: ignited ? new Date().toISOString() : null,
        }),
      }));
    let posted = 0;
    await page.route("**/api/instance/*/ignite", (route) => {
      posted += 1;
      ignited = true;
      return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ ok: true, ignition: {} }) });
    });

    await openMissionControl(page);
    await expect(banner(page)).toContainText("Activated, but never ignited.");

    await banner(page).getByRole("button", { name: "Ignite fleet" }).click();

    // The banner's new sentence comes from a fresh READ, not from the POST's
    // own report — ignition is partial-tolerant, so a resolved POST is not
    // evidence the fleet came up.
    await expect(banner(page)).toContainText("Fleet ignited.");
    await expect(banner(page)).toContainText("9 agents working");
    expect(posted).toBe(1);
  });

  test("no company selected → the banner renders nothing", async ({ page }) => {
    await serveIgnition(page, {});
    // A company must exist or Entry redirects to /build and this proves
    // nothing about the banner; what is absent here is the SELECTION.
    await page.route("**/api/companies", (route) =>
      route.fulfill({ status: 200, contentType: "application/json",
        body: JSON.stringify({ ok: true, companies: [{ id: CO, name: "Ignition Co", state: "live", updatedAt: Date.now() }] }) }));
    await page.goto("/");
    // Several panels say this; one is enough to prove we are on Mission
    // Control with nothing selected rather than redirected to /build.
    await expect(page.getByText(/No company selected/).first()).toBeVisible();
    await expect(banner(page)).toHaveCount(0);
  });
});
