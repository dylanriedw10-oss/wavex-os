/** Onboarding is /build — chat on the left, canvas on the right — always.
 *
 *  A brand-new operator must never be met by a different wizard first. The
 *  3-step operator overlay (OnboardingWizard: "Connect your repo" / "Connect
 *  your workspace" / "Run your first smoke test") is orphaned as of this
 *  commit: it predates the cutover, was never unmounted, and rendered above
 *  <Routes> on every surface while is_new_user=true, so a new operator's
 *  first screen was "Connect your repo".
 *
 *  Every assertion here uses is_new_user=true, which is the only state in
 *  which the overlay ever rendered — a returning operator would pass these
 *  vacuously.
 *
 *  Positive assertions sit next to the negative ones on purpose: "no overlay"
 *  alone would also pass against a blank page or a crashed bundle. */
import { expect, test } from "@playwright/test";

const NEW_USER = {
  ok: true,
  user: {
    id: "user-onboarding-is-build",
    email: "new@example.com",
    isNewUser: true,
    wizardStep: 1,
    wizardRepo: null,
    wizardCompletedAt: null,
  },
};

const OVERLAY_HEADINGS = /Connect your repo|Connect your workspace|Run your first smoke test/i;

test.beforeEach(async ({ page }) => {
  await page.route("**/api/users/me", async (route) => {
    await route.fulfill({ contentType: "application/json", body: JSON.stringify(NEW_USER) });
  });
});

test("a brand-new operator gets the chat + canvas build flow", async ({ page }) => {
  await page.goto("/build");

  // Chat on the left…
  await expect(page.getByText("Build your organization.", { exact: true })).toBeVisible();
  await expect(page.getByPlaceholder(/Describe your company/i)).toBeVisible();
  // …canvas on the right.
  await expect(page.getByText("organization", { exact: true })).toBeVisible();

  await expect(page.getByRole("heading", { name: OVERLAY_HEADINGS })).toHaveCount(0);
  await expect(page).not.toHaveTitle(/Connect your repo/);
});

test("no surface fronts the build flow with another wizard", async ({ page }) => {
  // `/` is Mission Control, the surface the overlay used to cover. It is the
  // default landing, so it is where a new operator would have met it.
  await page.goto("/");

  await expect(page.getByRole("heading", { name: OVERLAY_HEADINGS })).toHaveCount(0);
  await expect(page).not.toHaveTitle(/Connect your repo/);
  // Mission Control itself still renders — proves the page loaded at all.
  await expect(page.getByText(/company/i).first()).toBeVisible();
});
