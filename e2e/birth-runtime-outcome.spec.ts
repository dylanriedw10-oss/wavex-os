/** Birth's closing word must depend on what the ignition poll found.
 *
 *  `onStage("done")` sat OUTSIDE the poll loop, and the loop's break was
 *  `status !== "not_activated"`. So three different outcomes produced the
 *  same ending — the caption "alive", the build session erased, and an
 *  automatic landing on the live canvas:
 *
 *    - ignited      the runtime really did start
 *    - deferred     the runtime answered and said it had NOT fully started
 *    - silent       the cap ran out, or all 20 polls threw
 *
 *  The last two mean the operator is dropped on the canvas of an organization
 *  that never started, told it is alive, with the session that could have
 *  resumed already gone. The file's own header claims "the states it reveals
 *  are REAL… not pretended into existence", and this was the one exit where
 *  that stopped being true.
 *
 *  FOUR-SIDED. The `ignited` case must keep its automatic landing, or the fix
 *  would have traded a false claim for a stalled flow — that case is what
 *  proves the others are a distinction and not a regression.
 *
 *  ABLATION, RUN: restoring `if (s.status !== "not_activated") break;` with an
 *  unconditional `onStage("done")` fails deferred, partial and silent while
 *  ignited keeps passing. */

import { test, expect, type Page } from "@playwright/test";

const IGNITION = "**/api/instance/*/ignition";

const CO = `pw-birth-${Date.now().toString(36)}`;

/** Land straight in the birth motion. Everything before it is covered
 *  elsewhere and driving a real approval here would spend real inference. */
async function seedAtBirth(page: Page) {
  await page.addInitScript(([co]) => {
    localStorage.setItem(`wavex-os-build-v3:${co}`, JSON.stringify({
      phase: { kind: "birth", stage: "motion", motionStage: "fold" },
      thread: [],
      adoptedProductUrl: null,
      connectorsCondensed: true,
      planRun: null,
      draft: {},
    }));
  }, [CO]);
}

async function answerIgnition(page: Page, status: string) {
  await page.route(IGNITION, (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        ok: true, status, agentsWorking: 0, workflowsQueued: 0, goalId: null,
        paperclipUrl: null, paperclipCompanyId: null, steps: {}, errors: [],
        warnings: [], startedAt: new Date().toISOString(), completedAt: null,
      }),
    }));
}

test.describe("Birth reports the runtime outcome it actually observed", () => {
  test.skip(!process.env.WAVEX_E2E_FIXTURE_ENGINE, "needs the fixture engine — run with WAVEX_E2E_FIXTURE_ENGINE=1");

  test("ignited → says alive and lands on the canvas by itself", async ({ page }) => {
    await answerIgnition(page, "ignited");
    await seedAtBirth(page);
    await page.goto(`/build?companyId=${CO}`);

    // The landing IS the observable, and it is the reward for a confirmed
    // start — it must survive, or this fix traded a false claim for a stalled
    // flow. (The "alive" caption itself is not asserted here: it shows for a
    // 400ms dwell and is then replaced by the navigation, so waiting for it
    // is racing a transient. The three other cases assert its ABSENCE, which
    // is not racy — they never navigate at all.)
    await expect(page).toHaveURL(/\/canvas\?companyId=/, { timeout: 15_000 });
    await expect(page.getByText(/runtime started, not fully|runtime hasn't answered/)).toHaveCount(0);
  });

  test("deferred → says the runtime did not fully start, and does not land by itself", async ({ page }) => {
    await answerIgnition(page, "deferred");
    await seedAtBirth(page);
    await page.goto(`/build?companyId=${CO}`);

    await expect(page.getByText("runtime started, not fully")).toBeVisible({ timeout: 15_000 });
    await expect(page.getByText(/nothing is lost/i)).toBeVisible();
    await expect(page.getByRole("button", { name: /Open the canvas anyway/ })).toBeVisible();
    await expect(page.getByText("alive", { exact: true })).toHaveCount(0);
    await expect(page).not.toHaveURL(/\/canvas/);
  });

  test("partial → same honest ending as deferred", async ({ page }) => {
    await answerIgnition(page, "partial");
    await seedAtBirth(page);
    await page.goto(`/build?companyId=${CO}`);

    await expect(page.getByText("runtime started, not fully")).toBeVisible({ timeout: 15_000 });
    await expect(page.getByText("alive", { exact: true })).toHaveCount(0);
  });

  test("every poll fails → says the runtime never answered, and the offer still works", async ({ page }) => {
    await page.route(IGNITION, (route) => route.fulfill({ status: 500, body: "{}" }));
    await seedAtBirth(page);
    await page.goto(`/build?companyId=${CO}`);

    // 20 polls at 600ms, so allow the full cap plus the opening dwells.
    await expect(page.getByText("runtime hasn't answered")).toBeVisible({ timeout: 30_000 });
    await expect(page.getByText("alive", { exact: true })).toHaveCount(0);

    // The exit is a CHOICE, and taking it still works.
    await page.getByRole("button", { name: /Open the canvas anyway/ }).click();
    await expect(page).toHaveURL(/\/canvas\?companyId=/);
  });
});
