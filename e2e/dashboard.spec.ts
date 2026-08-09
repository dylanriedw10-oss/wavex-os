/** Playwright e2e — Mission Control dashboard hydration after a finalize.
 *
 *  Depends on a finalized company existing on disk. We seed one via the
 *  HTTP API in beforeAll (faster than re-running the wizard) so this spec
 *  can run independently. */

import { test, expect, request as pwRequest } from "@playwright/test";
import { join } from "node:path";

const COMPANY_ID = `pw-dash-${Date.now().toString(36)}`;

test.describe("Mission Control dashboard", () => {
  // Seed a finalized company via direct API calls before the UI test runs.
  test.beforeAll(async () => {
    const r = await pwRequest.newContext({ baseURL: "http://127.0.0.1:3101" });
    async function post(path: string, body: unknown): Promise<void> {
      const resp = await r.post(path, { data: body });
      if (!resp.ok()) {
        throw new Error(`POST ${path} failed: ${resp.status()} ${await resp.text()}`);
      }
    }
    // skipInference matters here and its absence was costing this spec.
    // `raw_input` is a URL, so pillar/1 took the enrichment path: a real
    // URL prefetch against a domain that does not resolve, then a BYOC
    // claude call (PILLAR1_CLAUDE_TIMEOUT_MS = 25s). Measured end to end at
    // 20.3s against Playwright's 15s request timeout, so the FIRST test of
    // the run failed in beforeAll while every later test passed — and the
    // seed was spending a real model call to build a fixture.
    // pillars.ts:468 short-circuits on `skipInference || looksLikeNoProduct`,
    // which is why every other seed in this repo ("no product yet") is fast.
    // Same fixture, 3.7ms, no network, no inference.
    await post("/wavex-os/onboarding/pillar/1", {
      companyId: COMPANY_ID,
      org_name: "PW Dash",
      raw_input: "https://pw-dash.example",
      manual_context: "PW Dash is a B2B SaaS dashboard test company. Mid-market, monthly subscription, assisted demo.",
      skipInference: true,
    });
    // See the pillar/1 note: pillar/2 spawns the real claude CLI without this.
    await post("/wavex-os/onboarding/pillar/2", { companyId: COMPANY_ID, claude_plan: "max_5x", skipInference: true });
    await post("/wavex-os/onboarding/pillar/3", { companyId: COMPANY_ID, product_state: "live_paying_customers", stage: "10k_100k_mrr" });
    await post("/wavex-os/onboarding/pillar/4", { companyId: COMPANY_ID, lead_sources: ["outbound_cold"], sales_motion: "assisted_demo", close_channel: "mostly_phone_video" });
    await post("/wavex-os/onboarding/pillar/5", { companyId: COMPANY_ID, comm_channel: "telegram", urgency_routing: "all_to_one_channel" });
    await post("/wavex-os/onboarding/connector-manifest", { companyId: COMPANY_ID, skipInference: true });
    await post("/wavex-os/onboarding/swarm-manifest", { companyId: COMPANY_ID, skipInference: true });
    await post("/wavex-os/onboarding/workflow-manifest", { companyId: COMPANY_ID, skipInference: true, bypassBudgetCheck: true });
    await post("/wavex-os/onboarding/finalize", {
      companyId: COMPANY_ID, orgId: COMPANY_ID, skipInference: true,
      mc: { horizon_cycles: 5, n_runs: 5, seed: 42 },
    });
    await r.dispose();
  });

  test("renders 'no company' state when no companyId in URL", async ({ page }) => {
    await page.goto("/");
    await expect(page.locator("strong", { hasText: /No company selected/i })).toBeVisible();
    await expect(page.getByRole("link", { name: /Start onboarding/i })).toBeVisible();
  });

  test("CompanyPicker enumerates companies + selects one writes ?companyId param", async ({ page }) => {
    await page.goto("/");
    // Picker shows the seeded company in the dropdown.
    const select = page.locator("select").first();
    await expect(select).toBeVisible();
    // Wait for the companies list to load — try selecting our company.
    await expect(async () => {
      const options = await select.locator("option").allInnerTexts();
      expect(options.some((o) => o.includes(COMPANY_ID))).toBe(true);
    }).toPass({ timeout: 10_000 });
    await select.selectOption(COMPANY_ID);
    await expect(page).toHaveURL(new RegExp(`companyId=${COMPANY_ID}`));
  });

  test("KpiBoard renders headline + supporting KPIs for the finalized company", async ({ page }) => {
    await page.goto(`/?companyId=${COMPANY_ID}`);
    await expect(page.getByRole("heading", { name: /KPI scoreboard/i })).toBeVisible({ timeout: 15_000 });
    // Headline KPI block — currentValue might be 0 but the structure renders.
    await expect(page.getByText(/HEADLINE GOAL/i)).toBeVisible();
    // Supporting KPIs section appears (we have ~10 KPIs derived from kpi_snapshot_initial).
    await expect(page.getByText(/SUPPORTING KPIs/i)).toBeVisible();
  });

  test("FleetGraph mounts (no error overlay)", async ({ page }) => {
    await page.goto(`/?companyId=${COMPANY_ID}`);
    // Fleet graph is a ReactFlow surface — we can't assert nodes/edges without the runtime
    // wiring agents to the dashboard, but we CAN assert the component header renders + no
    // unhandled-error overlay is visible.
    await page.waitForLoadState("networkidle");
    const errorOverlay = page.getByText(/Uncaught.*Error|TypeError|ReferenceError/i);
    await expect(errorOverlay).toHaveCount(0);
  });
});
