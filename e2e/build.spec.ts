/** Build Your Organization — the cutover's replacement coverage.
 *
 *  This suite exists because the cutover retired the wizard-era specs
 *  (chat-first-*, qa-422-*, screenshot-walkthrough, _demo-handoff): they
 *  walked `/onboarding-chat`, which no longer exists. Deleting them without
 *  replacing what they proved would be a silent loss of coverage, so the
 *  assertions that still matter live here, against the surface that replaced
 *  them.
 *
 *  What is deliberately NOT here: a full five-phase click-through. Phase 1
 *  needs real pillar inference and Phase 3 opens with a real research call —
 *  both are covered server-side (plan-assembly, plan-research, pillars), and
 *  re-driving them through the DOM would buy flakiness rather than truth.
 *  What is here is the part only the browser can prove: that the routes land,
 *  that the ONE Confirm produces a real runtime, and that the surface obeys
 *  the fit law while doing it. */

import { test, expect, type Page } from "@playwright/test";
import { mkdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";

const CO = `pw-build-${Date.now().toString(36)}`;

const PILLARS = {
  schema_version: 1,
  started_at: "2026-08-01T00:00:00.000Z",
  pillar_1: { org_name: CO, company_context: "fixture co", enrichment_status: "manual_capture", has_product: false, industry_hint: "b2b_saas", business_model_hint: "subscription" },
  pillar_2: { claude_plan: "max_20x", verified: true },
  pillar_3: { product_state: "idea_only", stage: "pre_product", kpi_snapshot_initial: { mrr: 0 } },
  pillar_4: { sales_motion: "assisted_demo", lead_sources: ["outbound_cold"], gtm_profile_enum: "OUTBOUND_ASSISTED" },
  pillar_5: { comm_channel: "email", urgency_routing: "daily_digest" },
};
const CONNECTOR = { version: 1, required: [], suggested: [], deferred: [], blocked_on_manual_approval: [] };

const stateDir = () => {
  const d = process.env.WAVEX_E2E_STATE_DIR;
  if (!d) throw new Error("WAVEX_E2E_STATE_DIR not exported by playwright.config.ts");
  return d;
};
const onboardingDir = () => join(stateDir(), "instances/default/companies", CO, "onboarding");

test.describe("Build Your Organization", () => {
  test.skip(!process.env.WAVEX_E2E_FIXTURE_ENGINE, "needs the fixture engine — run with WAVEX_E2E_FIXTURE_ENGINE=1");

  test.beforeAll(() => {
    mkdirSync(onboardingDir(), { recursive: true });
    writeFileSync(join(onboardingDir(), "pillar_responses.json"), JSON.stringify(PILLARS));
    writeFileSync(join(onboardingDir(), "connector_manifest.json"), JSON.stringify(CONNECTOR));
  });

  /* ---- the cutover itself ---- */

  test("both legacy onboarding routes land on /build, keeping the query", async ({ page }) => {
    // The query is the whole point: every inbound link carries ?companyId=,
    // and a bare <Navigate> would drop it and strand the operator on a fresh
    // build for no company at all.
    for (const from of ["/onboarding", "/onboarding-chat"]) {
      await page.goto(`${from}?companyId=${CO}`);
      await expect(page).toHaveURL(new RegExp(`/build\\?companyId=${CO}$`));
    }
  });

  test("the surface names itself for what the operator is doing", async ({ page }) => {
    await page.goto(`/build?companyId=${CO}`);
    // The naming rule: "onboarding", "setup", and "configuration" never
    // appear in the product's own voice (copy.ts's stated audit point).
    await expect(page.getByText("Build Your Organization").first()).toBeVisible();
    const body = (await page.locator("body").innerText()).toLowerCase();
    expect(body).not.toContain("onboarding");
    expect(body).not.toContain("configuration wizard");
  });

  /* ---- the ONE Confirm ---- */

  async function enterReview(page: Page) {
    const res = await page.request.post("/wavex-os/onboarding/plan-assembly/start", {
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
        thread: [], adoptedProductUrl: null, connectorsCondensed: true, planRun: r,
        draft: { pillar1: { rawInput: id, orgName: id } },
      }));
    }, [CO, run] as const);
    await page.goto(`/build?companyId=${CO}`);
    await expect(page.getByText(/The proposed organization/)).toBeVisible();
  }

  test("Review → pricing → commit: one Confirm produces a real runtime", async ({ page }) => {
    test.setTimeout(120_000);
    await enterReview(page);

    // The card presents DELIVERABLES, not a headcount — agents are an
    // implementation detail (EXECUTION_MODEL.md).
    await expect(page.getByText(/\d+ deliverables across \d+ departments/)).toBeVisible();
    await expect(page.getByText(/\d+ agents,/)).toHaveCount(0);

    await page.getByRole("button", { name: "Approve the organization" }).click();

    // Pricing is a PHASE in the instrument zone, not a modal over the shell.
    await expect(page.getByText(/System Optimizer subscription/i)).toBeVisible();
    await page.getByRole("button", { name: /Skip/ }).click();

    // The commit ran: activation + the native seed. `work.json` existing is
    // the proof the plan became executable work, which is the single most
    // important thing this whole flow does.
    await expect
      .poll(() => existsSync(join(onboardingDir(), "work.json")), { timeout: 90_000 })
      .toBe(true);

    const work = JSON.parse(readFileSync(join(onboardingDir(), "work.json"), "utf8"));
    expect(work.goals.length, "the manifest goal plus the plan's build goal").toBeGreaterThanOrEqual(1);
    expect(work.tasks.length).toBeGreaterThan(0);
    // Deliverables reached the tasks — the artifact is the object, so it must
    // survive seeding rather than being reconstructed in the renderer.
    expect(work.tasks.some((t: { deliverable?: string }) => !!t.deliverable)).toBe(true);
  });

  /* ---- the fit law, on the surface that replaced the wizard ---- */

  for (const { w, h, name } of [
    { w: 1440, h: 900, name: "desktop" },
    { w: 1024, h: 700, name: "floor" },
  ]) {
    test(`${name} ${w}×${h}: /build fits the window`, async ({ page }) => {
      await page.setViewportSize({ width: w, height: h });
      await enterReview(page);
      const report = await page.evaluate(() => {
        const de = document.documentElement;
        const inst = document.querySelector(".cv-instrument");
        const rogue = [...document.querySelectorAll(".canvas-root *")]
          .filter((el) => /auto|scroll/.test(getComputedStyle(el).overflowY))
          .filter((el) => el.scrollHeight > el.clientHeight + 1)
          .filter((el) => !el.classList.contains("cv-thread") && !el.classList.contains("cv-record"))
          .map((el) => `${el.tagName.toLowerCase()}.${el.className}`.slice(0, 60));
        return {
          docOverflow: de.scrollHeight - window.innerHeight,
          clippedPx: inst ? inst.scrollHeight - inst.clientHeight : 0,
          rogue,
        };
      });
      expect(report.docOverflow, `${name}: the page itself must never scroll`).toBeLessThanOrEqual(1);
      expect(report.clippedPx, `${name}: content clipped, not clamped`).toBeLessThanOrEqual(1);
      expect(report.rogue, `${name}: only the named records may scroll`).toEqual([]);
    });
  }
});
