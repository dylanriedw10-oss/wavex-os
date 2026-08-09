/** A broken backend must not fail silently; an absent one still may.
 *
 *  OnboardingWizard skips itself when /api/users/me rejects. That fallback is
 *  correct — a failed call means we cannot know whether this operator is new,
 *  and showing setup to a returning operator is worse than showing it to
 *  nobody. What was wrong was that it was SILENT: a 500 (migration never
 *  applied) was indistinguishable from "dev without mock-core", so onboarding
 *  was skipped for every new operator with nothing logged and no visible
 *  symptom.
 *
 *  Two-sided on the discriminator itself, which is the part that can rot:
 *  arm 1 proves a broken backend is now loud, arm 2 proves an absent one is
 *  still quiet. Logging on every failure would pass arm 1 and fail arm 2. */
import { expect, test, type ConsoleMessage } from "@playwright/test";

/** Only our own diagnostics — the browser logs its own "Failed to load
 *  resource" line for a 500, and that is not what is under test. */
function onboardingLogs(messages: ConsoleMessage[]): string[] {
  return messages.map((m) => m.text()).filter((t) => t.includes("[onboarding]"));
}

test("a BROKEN backend is loud, and still skips setup", async ({ page }) => {
  const messages: ConsoleMessage[] = [];
  page.on("console", (m) => messages.push(m));

  await page.route("**/api/users/me", async (route) => {
    await route.fulfill({
      status: 500,
      contentType: "application/json",
      body: JSON.stringify({ statusCode: 500, error: "Internal Server Error", message: 'column "wizard_step" does not exist' }),
    });
  });

  await page.goto("/");
  await expect(page.getByRole("heading", { name: /Connect your repo/i })).toHaveCount(0);

  // At-least-one, not exactly-one: StrictMode double-invokes the effect in
  // dev, and the number of times a diagnostic repeats is not the contract.
  await expect
    .poll(() => onboardingLogs(messages).length, { timeout: 5000 })
    .toBeGreaterThan(0);
  const [first] = onboardingLogs(messages);
  expect(first).toContain("HTTP 500");
  expect(first).toContain("skipped for everyone");
});

test("an ABSENT backend stays quiet, and still skips setup", async ({ page }) => {
  const messages: ConsoleMessage[] = [];
  page.on("console", (m) => messages.push(m));

  // No response at all — fetch rejects with no status, the dev-without-
  // mock-core case the original catch was written for.
  await page.route("**/api/users/me", (route) => route.abort("failed"));

  await page.goto("/");
  await expect(page.getByRole("heading", { name: /Connect your repo/i })).toHaveCount(0);

  // Give the rejected fetch the same room arm 1 gets before asserting silence.
  await page.waitForTimeout(1500);
  expect(onboardingLogs(messages)).toEqual([]);
});
