/** The 3-step operator overlay must never cover /build.
 *
 *  main.tsx mounts <OnboardingWizard /> OUTSIDE <Routes>, so it renders on
 *  top of every surface while is_new_user=true. /build is the product's
 *  onboarding surface — main.tsx calls it "THE onboarding surface" and both
 *  legacy entrances redirect there — so covering it locks new operators out
 *  of the exact flow they arrived to complete.
 *
 *  This was invisible until the migration journal was repaired: /api/users/me
 *  returned 500, OnboardingWizard's .catch() swallowed it, and the overlay
 *  never rendered for anyone. Fixing the backend made the collision real, so
 *  it is pinned here rather than left to be rediscovered.
 *
 *  Two-sided on purpose. Suppressing the overlay everywhere would also make
 *  arm 1 pass, so arm 2 asserts it still appears on /. */
import { expect, test } from "@playwright/test";

const NEW_USER = {
  ok: true,
  user: {
    id: "user-build-gate",
    email: "build-gate@example.com",
    isNewUser: true,
    wizardStep: 1,
    wizardRepo: null,
    wizardCompletedAt: null,
  },
};

test.beforeEach(async ({ page }) => {
  await page.route("**/api/users/me", async (route) => {
    await route.fulfill({ contentType: "application/json", body: JSON.stringify(NEW_USER) });
  });
  await page.route("**/api/github/repos?**", async (route) => {
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({ repos: [], total: 0, page: 1, per_page: 30, mock: true }),
    });
  });
});

test("a brand-new operator reaches /build with the overlay suppressed", async ({ page }) => {
  await page.goto("/build");

  // The welcome copy is a styled div, not a heading role, so match its text.
  // `exact` keeps it off the banner's "WaveX Build Your Organization".
  await expect(page.getByText("Build your organization.", { exact: true })).toBeVisible();
  await expect(page.getByPlaceholder(/Describe your company/i)).toBeVisible();
  await expect(page.getByRole("heading", { name: /Connect your repo/i })).toHaveCount(0);
  // The overlay also owns document.title; /build must keep its own.
  await expect(page).not.toHaveTitle(/Connect your repo/);
});

test("the same operator still gets the overlay off /build", async ({ page }) => {
  await page.goto("/");

  await expect(page.getByRole("heading", { name: /Connect your repo/i })).toBeVisible();
});
