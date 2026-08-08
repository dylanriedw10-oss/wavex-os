/** The planning stage, with a goal the operator did NOT state.
 *
 *  Two gaps met here. The fit law was only ever exercised at the `review`
 *  stage, so the plan feed's own cells — which render one stage earlier —
 *  had no size coverage at all. And the roadmap cell used to print the
 *  hardest claim in the flow ("the goal and KPIs are fixed at approval")
 *  over a stage-band guess, breaking the promise COPY.strategy.skipped makes
 *  by name. The honest replacement is 40 characters longer, which is exactly
 *  the kind of change the fit law exists to catch.
 *
 *  The fixture writes NO strategy.json on purpose: that is what a company
 *  that declined the goal question looks like on disk, and it is the branch
 *  the assertion below pins. */
import { test, expect, type Page } from "@playwright/test";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const CO = "planfit";
const PILLARS = {
  pillar_1: { org_name: CO, has_product: true, industry_hint: "b2b_saas", company_context: "x".repeat(200) },
  pillar_2: { claude_plan: "max_20x", inference_budget_profile: "balanced" },
  pillar_3: { product_state: "live_paying_customers", stage: "more_than_1m_mrr" },
  pillar_4: { lead_sources: ["outbound_cold"], sales_motion: "assisted_demo" },
  pillar_5: { comms_stack: ["slack"] },
};

test.describe("planning-stage fit", () => {
  test.skip(!process.env.WAVEX_E2E_FIXTURE_ENGINE, "needs the fixture engine");
  test.beforeAll(() => {
    const dir = join(process.env.WAVEX_E2E_STATE_DIR!, "instances/default/companies", CO, "onboarding");
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "pillar_responses.json"), JSON.stringify(PILLARS));
    writeFileSync(join(dir, "connector_manifest.json"), JSON.stringify(
      { version: 1, required: [], suggested: [], deferred: [], blocked_on_manual_approval: [] }));
    // NO strategy.json -> the goal is a band -> stated:false -> the LONG line.
  });

  async function enterPlanning(page: Page) {
    const res = await page.request.post("/wavex-os/onboarding/plan-assembly/start", {
      data: { companyId: CO, skipInference: true, research: false },
    });
    expect(res.ok()).toBeTruthy();
    const { run } = await res.json();
    const goal = run.steps.find((s: any) => s.id === "roadmap")?.payload?.goal;
    expect(goal.stated, "fixture must exercise the UNSTATED branch").toBe(false);
    await page.addInitScript(([id, r]) => {
      localStorage.setItem(`wavex-os-build-v3:${id}`, JSON.stringify({
        phase: { kind: "build_plan", stage: "planning", revealed: 99, researchSettled: true,
                 review: { manifestSha256: null, finalizing: false, committing: false } },
        thread: [{ id: "m1", role: "assistant", text: "Planning." }],
        adoptedProductUrl: null, connectorsCondensed: true, planRun: r,
        draft: { pillar1: { rawInput: id, orgName: id } },
      }));
    }, [CO, run] as const);
    await page.goto(`/build?companyId=${CO}`);
  }

  for (const { w, h, name } of [{ w: 1440, h: 900, name: "desktop" }, { w: 1024, h: 700, name: "floor" }]) {
    test(`${name} ${w}×${h}`, async ({ page }) => {
      await page.setViewportSize({ width: w, height: h });
      await enterPlanning(page);
      await expect(page.getByText(/Estimated — a stage band stood in/)).toBeVisible();
      const report = await page.evaluate(() => {
        const de = document.documentElement;
        const inst = document.querySelector(".cv-instrument");
        const rogue = [...document.querySelectorAll(".canvas-root *")]
          .filter((el) => /auto|scroll/.test(getComputedStyle(el).overflowY))
          .filter((el) => el.scrollHeight > el.clientHeight + 1)
          .filter((el) => !el.classList.contains("cv-thread") && !el.classList.contains("cv-record"))
          .map((el) => `${el.tagName.toLowerCase()}.${el.className}`.slice(0, 60));
        return { docOverflow: de.scrollHeight - window.innerHeight, clippedPx: inst ? inst.scrollHeight - inst.clientHeight : 0, rogue };
      });
      expect(report.docOverflow).toBeLessThanOrEqual(1);
      expect(report.clippedPx).toBeLessThanOrEqual(1);
      expect(report.rogue).toEqual([]);
    });
  }
});
