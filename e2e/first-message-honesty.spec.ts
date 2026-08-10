/** The first thing the product says must be true of what you typed.
 *
 *  `runPillar1` chose its opening line with `manualContext ? describing :
 *  reading`, and no call site has ever passed a third argument — so
 *  `COPY.phase1.describing` was dead code and every operator got
 *  "reading your site". An operator who typed a sentence about their company
 *  was told the product was reading a site they never gave it, and then
 *  watched a trace whose first pass, "Reading your site", is marked `passed`
 *  as it scrolls by. Nothing was fetched.
 *
 *  TWO-SIDED. The URL side must keep saying "reading your site", because on
 *  that path it is true and it is the more informative sentence. A one-sided
 *  test would pass on a build that simply deleted the claim everywhere,
 *  which would lose real information rather than remove a false one.
 *
 *  Both cases stub pillar/1 so the assertion is about the CLAIM, made before
 *  the response, not about what any model returned. The stub never resolves:
 *  the wait is the thing under test.
 *
 *  ABLATION, RUN: reverting BuildOrgPage to `manualContext ? describing :
 *  reading` fails the prose case on both assertions (the line and the trace)
 *  and leaves the URL case passing. */

import { test, expect, type Page } from "@playwright/test";

const PILLAR1 = "**/wavex-os/onboarding/pillar/1";

/** Hold the call open. What the operator sees while waiting is the subject. */
async function stallPillar1(page: Page) {
  await page.route(PILLAR1, async () => { await new Promise(() => {}); });
}

async function say(page: Page, text: string) {
  await page.goto("/build");
  const box = page.getByRole("textbox", { name: "Message" });
  await box.fill(text);
  await page.getByRole("button", { name: "Send" }).click();
}

test.describe("the opening claim matches the input", () => {
  test.skip(!process.env.WAVEX_E2E_FIXTURE_ENGINE, "needs the fixture engine — run with WAVEX_E2E_FIXTURE_ENGINE=1");

  test("prose in → no claim that a site is being read", async ({ page }) => {
    await stallPillar1(page);
    await say(page, "we are a B2B scheduling tool for independent dental clinics");

    await expect(page.getByText("Got it — working from what you told me.")).toBeVisible();
    // THE ASSERTION: the false claim appears nowhere — not as the message,
    // and not as a pass in the trace that will later be marked `passed`.
    await expect(page.getByText(/reading your site/i)).toHaveCount(0);
    await expect(page.getByText("Reading what you told me")).toBeVisible();
  });

  test("a URL in → it still says it is reading the site", async ({ page }) => {
    await stallPillar1(page);
    await say(page, "https://example.com");

    await expect(page.getByText("Got it — reading your site now.")).toBeVisible();
    await expect(page.getByText("Reading your site")).toBeVisible();
    await expect(page.getByText("Got it — working from what you told me.")).toHaveCount(0);
  });

  test("a bare hostname counts as a URL", async ({ page }) => {
    await stallPillar1(page);
    await say(page, "acme-clinics.com");

    await expect(page.getByText("Got it — reading your site now.")).toBeVisible();
  });

  test("neither branch prints a duration the client did not measure", async ({ page }) => {
    // The trace directly below prints MEASURED elapsed seconds and says in
    // its own note that nothing there is an estimate. A guessed "60–90
    // seconds" one line above was contradicting its own instrument — and the
    // figure was wrong besides (the call measures ~20s).
    await stallPillar1(page);
    await say(page, "we sell scheduling software to clinics");
    await expect(page.getByText(/60–90 seconds/)).toHaveCount(0);
    await expect(page.getByText(/s so far/)).toBeVisible();
  });
});
