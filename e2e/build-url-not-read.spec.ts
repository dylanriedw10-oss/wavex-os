/** A link the server could not read is SAID, not swallowed.
 *
 *  pillar/1 has always returned a verdict when `raw_input` was a URL — the
 *  prefetch reports ok | parked | thin | unreachable | timeout | unsafe_url —
 *  and the UI read `result.response` and dropped the rest. So an operator
 *  pasted their homepage, waited out a real ~20s enrichment call, and got an
 *  organization built from their typed words alone, never told the site
 *  contributed nothing. The plan was not wrong, only narrower than they
 *  believed, and believing otherwise was the failure.
 *
 *  Mocked rather than driven through a live pillar/1: the real call takes
 *  ~20s, needs a reachable model, and cannot be made to return `parked` on
 *  demand. What is under test is the UI's handling of a verdict, so the
 *  verdict is the fixture.
 *
 *  Two-sided. Announcing unconditionally would be as wrong as announcing
 *  never: `url_fetch` is ABSENT when the operator typed prose, and that is
 *  not a failure to report. Arm 2 covers it. */
import { expect, test } from "@playwright/test";

const RESPONSE = {
  org_name: "probe co",
  company_context: "A fixture company used to exercise the url_fetch reporting path.",
  enrichment_status: "manual_capture",
  has_product: true,
  industry_hint: "b2b_saas",
  business_model_hint: "subscription",
};

/** Answers pillar/1 with a chosen verdict, so the ~20s call never runs. */
async function mockPillar1(page: import("@playwright/test").Page, urlFetch: unknown | null) {
  await page.route("**/wavex-os/onboarding/pillar/1", async (route) => {
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({ ok: true, response: RESPONSE, ...(urlFetch ? { url_fetch: urlFetch } : {}) }),
    });
  });
}

test("an unreachable link is reported, and the plan is described as narrower", async ({ page }) => {
  await mockPillar1(page, {
    url: "https://probe-co.example",
    status: "unreachable",
    reason: "fetch failed",
  });

  await page.goto("/build");
  await page.getByPlaceholder(/Describe your company/i).fill("https://probe-co.example");
  await page.keyboard.press("Enter");

  // The verdict, in the operator's terms — not a status code.
  await expect(page.getByText(/didn't answer/i)).toBeVisible({ timeout: 20_000 });
  // And what it means for what they are about to read.
  await expect(page.getByText(/nothing in it came from that address/i)).toBeVisible();
});

test("a parked domain says PARKED — the statuses are not flattened", async ({ page }) => {
  await mockPillar1(page, {
    url: "https://probe-co.example",
    status: "parked",
    reason: "domain appears parked / not a live site",
  });

  await page.goto("/build");
  await page.getByPlaceholder(/Describe your company/i).fill("https://probe-co.example");
  await page.keyboard.press("Enter");

  await expect(page.getByText(/parked domain/i)).toBeVisible({ timeout: 20_000 });
  // "unreachable" copy must NOT appear — a single "couldn't read it" for every
  // status would pass the first test and lose the distinction.
  await expect(page.getByText(/didn't answer/i)).toHaveCount(0);
});

test("prose input reports nothing — there was no link to fail", async ({ page }) => {
  await mockPillar1(page, null);

  await page.goto("/build");
  await page
    .getByPlaceholder(/Describe your company/i)
    .fill("We sell scheduling software to independent clinics.");
  await page.keyboard.press("Enter");

  // The inference lands…
  await expect(page.getByText(/adjust if anything's off/i)).toBeVisible({ timeout: 20_000 });
  // …with no verdict about a link that was never given.
  await expect(page.getByText(/was not read|didn't answer|parked domain/i)).toHaveCount(0);
});
