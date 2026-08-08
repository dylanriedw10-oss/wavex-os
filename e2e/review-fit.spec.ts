/** The Review card must be READABLE, not merely present.
 *
 *  Review is the one screen whose entire purpose is that the operator can
 *  see what they are approving, so it gets a gate of its own beyond the
 *  general fit law. The regression it locks down was real and total: at
 *  1440×900 the card ran 396px past the fold and took the Confirm button
 *  with it — an approval gate the approver could not reach — while the KPI
 *  rows ellipsized their owners mid-word ("owned by cro.expa…").
 *
 *  At all three supported heights:
 *    1. nothing is clipped (the fit law, restated locally)
 *    2. Confirm is FULLY on screen — the specific failure that shipped
 *    3. nothing is ellipsized — a truncated fact under review is a lie
 *    4. enough of the plan is visible WITHOUT drilling to constitute a review
 *
 *  (4) is the one carrying the weight. The card is now `height: 100%` of its
 *  region, so 1–2 are structurally guaranteed and a regression can no longer
 *  express itself as overflow — it expresses itself as a starved card that
 *  clamps nine deliverables down to two and still "fits". Fitting is the
 *  floor, not the goal.
 *
 *  Plus: whatever the card clamps must be reachable. The counted "+N more"
 *  has to descend into a record holding the COMPLETE checklist, or the
 *  clamp is just a prettier silent cap. */

import { test, expect, type Page } from "@playwright/test";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const CO = `pw-review-${Date.now().toString(36)}`;

/** Pre-product SaaS, so the plan carries the 5-step MVP chain on top of the
 *  bundle cadences — 9 deliverables, the volume that broke the layout. */
const PILLARS = {
  schema_version: 1,
  started_at: "2026-08-01T00:00:00.000Z",
  pillar_1: { org_name: CO, company_context: "fixture co", enrichment_status: "manual_capture", has_product: false, industry_hint: "b2b_saas", business_model_hint: "subscription" },
  pillar_2: { claude_plan: "max_20x", verified: true },
  pillar_3: { product_state: "idea_only", stage: "less_than_10k_mrr", kpi_snapshot_initial: { mrr: 0 } },
  pillar_4: { sales_motion: "assisted_demo", lead_sources: ["outbound_cold"], gtm_profile_enum: "OUTBOUND_ASSISTED" },
  pillar_5: { comm_channel: "email", urgency_routing: "daily_digest" },
};
const CONNECTOR = { version: 1, required: [], suggested: [], deferred: [], blocked_on_manual_approval: [] };

/** `minDeliverables` = how much of the 7-item checklist must be readable
 *  WITHOUT drilling, at each height. All of it above the floor; at the floor
 *  a clamp is legitimate, but it may not eat most of the list. */
const SIZES = [
  // 7, not 9. The plan itself got smaller, and legitimately: removing the
  // "full org" override stopped promoting every matrix-parked agent to
  // active, and the two bundle workflows that vanished were owned by agents
  // the matrix had parked — deliverables with nobody to run them.
  { w: 1440, h: 900, name: "desktop", minDeliverables: 7 },
  { w: 1280, h: 800, name: "laptop", minDeliverables: 7 },
  { w: 1024, h: 700, name: "floor", minDeliverables: 4 },
];

async function readable(page: Page, label: string, minDeliverables: number) {
  const report = await page.evaluate(() => {
    const root = document.querySelector(".canvas-root");
    const card = [...document.querySelectorAll(".cv-glass")]
      .find((el) => /Proposal ·/i.test(el.textContent ?? ""));
    const confirm = card && [...card.querySelectorAll("button")]
      .find((b) => /Approve the organization/i.test(b.textContent ?? ""));
    const inst = document.querySelector(".cv-instrument");
    return {
      cardPresent: !!card,
      // How far the card's own bottom falls past the window.
      cardOverhangPx: card ? Math.round(card.getBoundingClientRect().bottom - window.innerHeight) : -1,
      confirmPresent: !!confirm,
      confirmOverhangPx: confirm ? Math.round(confirm.getBoundingClientRect().bottom - window.innerHeight) : -1,
      // A leaf whose content is wider than its box is ellipsized or cut.
      elided: [...(root?.querySelectorAll("*") ?? [])]
        .filter((el) => el.children.length === 0 && el.scrollWidth > el.clientWidth + 1)
        .map((el) => (el.textContent ?? "").slice(0, 60)),
      clippedPx: inst ? inst.scrollHeight - inst.clientHeight : 0,
      deliverablesShown: document.querySelectorAll('[data-rows="deliverables"] > div').length,
      // Overflow INSIDE the card. The window-level check above is blind to
      // it: the card's region is `overflow: hidden`, so a column that spills
      // is clipped there and never grows `.cv-instrument`. This is exactly
      // how the Timeline rows got cut at the floor while every outer
      // measurement read as fitting.
      innerOverflow: card
        ? [...card.querySelectorAll("*")]
            .filter((el) => el.scrollHeight > el.clientHeight + 1 && el.clientHeight > 0)
            .filter((el) => !el.classList.contains("cv-record"))
            .map((el) => `${(el.textContent ?? "").slice(0, 40)} [+${el.scrollHeight - el.clientHeight}px]`)
        : [],
    };
  });

  expect(report.cardPresent, `${label}: the proposal card must render`).toBe(true);
  expect(report.clippedPx, `${label}: content clipped, not clamped`).toBeLessThanOrEqual(1);
  expect(report.cardOverhangPx, `${label}: the card runs past the window`).toBeLessThanOrEqual(1);
  expect(report.confirmPresent, `${label}: Confirm must render`).toBe(true);
  expect(
    report.confirmOverhangPx,
    `${label}: Confirm is below the fold — the operator cannot approve what they cannot reach`,
  ).toBeLessThanOrEqual(1);
  expect(report.elided, `${label}: a fact under review is truncated`).toEqual([]);
  expect(
    report.innerOverflow,
    `${label}: content is clipped INSIDE the card — a silent cap the window-level check cannot see`,
  ).toEqual([]);
  // The assertion with the real teeth. Now that the card is `height: 100%`
  // of its region, overflow is structurally impossible — so a layout that
  // wastes the window no longer FAILS, it just starves the card and clamps
  // harder. That is precisely how the shipped bug would look after the
  // structural fix: technically fitting, showing two deliverables out of
  // nine. Fitting is the floor, not the goal; the review has to show enough
  // of the plan to BE a review.
  expect(
    report.deliverablesShown,
    `${label}: only ${report.deliverablesShown} deliverables visible — the window is being wasted`,
  ).toBeGreaterThanOrEqual(minDeliverables);
}

test.describe("the review card is readable", () => {
  test.skip(!process.env.WAVEX_E2E_FIXTURE_ENGINE, "needs the fixture engine — run with WAVEX_E2E_FIXTURE_ENGINE=1");

  test.beforeAll(() => {
    const stateDir = process.env.WAVEX_E2E_STATE_DIR;
    if (!stateDir) throw new Error("WAVEX_E2E_STATE_DIR not exported by playwright.config.ts");
    const dir = join(stateDir, "instances/default/companies", CO, "onboarding");
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "pillar_responses.json"), JSON.stringify(PILLARS));
    writeFileSync(join(dir, "connector_manifest.json"), JSON.stringify(CONNECTOR));
  });

  /** Drop the surface straight into Review: run the (deterministic, model-
   *  free) assembly server-side, then seed the client session the same way a
   *  resumed build would restore it. */
  async function enterReview(page: Page) {
    const res = await page.request.post("/wavex-os/onboarding/plan-assembly/start", {
      // research off: this suite is about the card's layout, and a real
      // T2 call would make it slow and non-deterministic.
      data: { companyId: CO, skipInference: true, research: false },
    });
    expect(res.ok(), "plan assembly must produce a run").toBeTruthy();
    const { run } = await res.json();
    await page.addInitScript(([id, r]) => {
      // v3, and the review beat is a STAGE of build_plan now — seeding the
      // retired `kind: "review"` would migrate rather than land where the
      // test means to start.
      localStorage.setItem(`wavex-os-build-v3:${id}`, JSON.stringify({
        phase: {
          kind: "build_plan", stage: "review", revealed: 0, researchSettled: true,
          review: { manifestSha256: null, finalizing: false, committing: false },
        },
        thread: [{ id: "m1", role: "assistant", text: "The plan is built." }],
        adoptedProductUrl: null, connectorsCondensed: true, planRun: r,
        draft: { pillar1: { rawInput: id, orgName: id } },
      }));
    }, [CO, run] as const);
    await page.goto(`/build?companyId=${CO}`);
    await expect(page.getByText(/The proposed organization/)).toBeVisible();
  }

  for (const { w, h, name, minDeliverables } of SIZES) {
    test(`${name} ${w}×${h}`, async ({ page }) => {
      await page.setViewportSize({ width: w, height: h });
      await enterReview(page);
      await readable(page, `${name} · review`, minDeliverables);
    });
  }

  test("every total is stated, and what clamps stays reachable", async ({ page }) => {
    // The floor is where the clamp actually bites.
    await page.setViewportSize({ width: 1024, height: 700 });
    await enterReview(page);

    // The summary names each total up front, so a clamp deeper in the card
    // can never read as "that was all of it".
    await expect(page.getByText(/7 deliverables/)).toBeVisible();

    const more = page.getByRole("button", { name: /\+\d+ more/ });
    if (await more.count() === 0) {
      // Nothing clamped at this size: then everything must be on screen,
      // which `readable` already proved. Still a pass — but say so.
      test.info().annotations.push({ type: "note", description: "no clamp at the floor; full list rendered" });
      return;
    }
    await more.first().click();

    // The descend target holds the COMPLETE checklist — a clamp must never
    // descend into another clamp.
    await expect(page.getByText("Every deliverable in the plan")).toBeVisible();
    await expect(page.getByText("9 in total")).toBeVisible();
    const items = page.locator(".cv-record li");
    await expect(items).toHaveCount(9);
    // The record is the fit law's named exception: it may scroll, and it is
    // the only thing here that may.
    
    await page.getByRole("button", { name: "Back to the proposal" }).click();
    await expect(page.getByText(/The proposed organization/)).toBeVisible();
  });
});
