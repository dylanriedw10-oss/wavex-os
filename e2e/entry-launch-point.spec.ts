/** `/` is a front door, not a dashboard you have to find your way out of.
 *
 *  A first-run operator has no companies, so Mission Control has nothing to
 *  show them — an empty KPI scoreboard, "Loading fleet…", a Claude Max
 *  allocation slider, and a "Start onboarding" button somewhere inside it.
 *  Entry sends that operator to /build instead. Anyone with companies keeps
 *  Mission Control.
 *
 *  Two-sided because both degenerate implementations are plausible: always
 *  redirecting would strand an operator who HAS companies in onboarding, and
 *  never redirecting is the behaviour this replaced. Arm 1 catches the
 *  second, arm 2 catches the first.
 *
 *  `/api/companies` is mocked so the arms do not depend on what other specs
 *  have seeded into the shared state dir. */
import { expect, test } from "@playwright/test";

const A_COMPANY = {
  companyId: "entry-existing-co",
  state: "live",
  updatedAt: Date.now(),
};

test("a first-run operator lands in the build flow, not the dashboard", async ({ page }) => {
  await page.route("**/api/companies", async (route) => {
    await route.fulfill({ contentType: "application/json", body: JSON.stringify({ companies: [] }) });
  });

  await page.goto("/");

  await expect(page).toHaveURL(/\/build$/);
  await expect(page.getByText("Build your organization.", { exact: true })).toBeVisible();
  // And not the empty dashboard it used to land on.
  await expect(page.getByText(/No company selected/i)).toHaveCount(0);
});

test("an operator who already has companies still gets Mission Control", async ({ page }) => {
  await page.route("**/api/companies", async (route) => {
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({ companies: [A_COMPANY] }),
    });
  });

  await page.goto("/");

  await expect(page).not.toHaveURL(/\/build$/);
  // The no-company-SELECTED card is a different state from having no
  // companies at all, and it stays reachable.
  await expect(page.locator("strong", { hasText: /No company selected/i })).toBeVisible();
});
