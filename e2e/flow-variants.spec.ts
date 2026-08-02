/** Playwright e2e — 10 flow variants covering reset, activate, navigation,
 *  and the freshly-rebuilt dashboard surfaces.
 *
 *  These tests use the API to seed state where a full wizard walk would be
 *  too slow, then exercise the UI for the affordances under test. Each
 *  variant uses a unique companyId so they don't collide. */

import { test, expect, request as pwRequest, type Page, type APIRequestContext } from "@playwright/test";

const API = "http://127.0.0.1:3101";

function uniqueId(prefix: string): string {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
}

/** Seed a finalized company via the HTTP API. Skips T2 inference for speed. */
async function seedFinalized(api: APIRequestContext, companyId: string): Promise<void> {
  async function post(path: string, body: unknown): Promise<void> {
    const resp = await api.post(path, { data: body });
    if (!resp.ok()) throw new Error(`POST ${path} failed: ${resp.status()} ${await resp.text()}`);
  }
  await post("/wavex-os/onboarding/pillar/1", {
    companyId, org_name: companyId,
    raw_input: "no product yet",
    manual_context: "Test fixture company seeded for Playwright end-to-end coverage of the activate + dashboard flow.",
  });
  await post("/wavex-os/onboarding/pillar/2", { companyId, claude_plan: "max_5x" });
  await post("/wavex-os/onboarding/pillar/3", { companyId, product_state: "live_paying_customers", stage: "10k_100k_mrr" });
  await post("/wavex-os/onboarding/pillar/4", { companyId, lead_sources: ["outbound_cold"], sales_motion: "assisted_demo", close_channel: "mostly_phone_video" });
  await post("/wavex-os/onboarding/pillar/5", { companyId, comm_channel: "telegram", urgency_routing: "all_to_one_channel" });
  await post("/wavex-os/onboarding/connector-manifest", { companyId, skipInference: true });
  await post("/wavex-os/onboarding/swarm-manifest", { companyId, skipInference: true });
  await post("/wavex-os/onboarding/workflow-manifest", { companyId, skipInference: true, bypassBudgetCheck: true });
  await post("/wavex-os/onboarding/finalize", {
    companyId, orgId: companyId, skipInference: true,
    mc: { horizon_cycles: 5, n_runs: 5, seed: 42 },
  });
}

/** Seed a *partial* company (pillars 1-3 only) so it shows in resume + auto-routes to pillar 4. */
async function seedPartial(api: APIRequestContext, companyId: string): Promise<void> {
  async function post(path: string, body: unknown): Promise<void> {
    const resp = await api.post(path, { data: body });
    if (!resp.ok()) throw new Error(`POST ${path} failed: ${resp.status()} ${await resp.text()}`);
  }
  await post("/wavex-os/onboarding/pillar/1", {
    companyId, org_name: companyId,
    raw_input: "no product yet",
    manual_context: "Partial fixture seeded for resume + reset Playwright tests; mid-market SaaS shape.",
  });
  await post("/wavex-os/onboarding/pillar/2", { companyId, claude_plan: "max_5x" });
  await post("/wavex-os/onboarding/pillar/3", { companyId, product_state: "live_paying_customers", stage: "10k_100k_mrr" });
}

async function startNewCompanyFromWelcome(page: Page, name: string): Promise<void> {
  await page.goto("/onboarding?t0=1");
  await expect(page.getByRole("heading", { name: /Onboarding/i }).first()).toBeVisible();
  const nameInput = page.locator("input[autofocus], input:not([type='radio']):not([type='checkbox'])").first();
  await nameInput.fill(name);
  await page.getByRole("button", { name: /^Start/i }).click();
  await expect(page.getByRole("heading", { name: /Pillar 1.*who you are/i })).toBeVisible();
}

test.describe("flow variants — 10x", () => {
  /** ---------------------------------------------------------------- */
  /** Variant 1: full happy path through the wizard from welcome screen */
  test("v1: welcome → 5 pillars → 3 phases → concierge → finalize → activate → mission control", async ({ page }) => {
    test.slow();
    const id = uniqueId("v1-happy");

    await startNewCompanyFromWelcome(page, id);

    // Pillar 1 (no-product short-circuit)
    const pillar1Inputs = page.locator("input[type='text'], input:not([type='radio']):not([type='checkbox']):not([type='password'])");
    await pillar1Inputs.nth(0).fill(id);
    await pillar1Inputs.nth(1).fill("no product yet");
    await page.getByRole("button", { name: /^Next/i }).click();
    await expect(page.getByRole("heading", { name: /confirm what we inferred/i })).toBeVisible({ timeout: 60_000 });
    await page.getByRole("button", { name: /Confirm \+ continue/i }).click();

    // Pillar 2
    await expect(page.getByRole("heading", { name: /Verifying your setup/i })).toBeVisible();
    await page.getByRole("button", { name: /Verify.*Continue/i }).click();
    await expect(page.getByRole("heading", { name: /Pillar 3/i })).toBeVisible({ timeout: 60_000 });

    // Pillar 3
    await page.getByRole("button", { name: /^Next/i }).click();
    await expect(page.getByRole("heading", { name: /Pillar 4/i })).toBeVisible();

    // Pillar 4
    await page.getByRole("button", { name: /^Next/i }).click();
    await expect(page.getByRole("heading", { name: /Pillar 5/i })).toBeVisible();

    // Pillar 5
    await page.getByRole("button", { name: /Finish Phase 1/i }).click();
    await expect(page.getByRole("heading", { name: /Phase 2.*Connectors/i })).toBeVisible({ timeout: 30_000 });

    // Phase 2
    await expect(page.getByRole("heading", { name: /^Required$/i })).toBeVisible({ timeout: 15_000 });
    await page.getByRole("button", { name: /Continue.*swarm/i }).click();
    await expect(page.getByRole("heading", { name: /Credential Concierge/i })).toBeVisible({ timeout: 15_000 });

    // Concierge — skip every required
    let safety = 25;
    while (safety-- > 0) {
      const skipBtn = page.getByRole("button", { name: /^Skip$/ }).first();
      if (!(await skipBtn.isVisible().catch(() => false))) break;
      await skipBtn.click();
      await page.getByRole("button", { name: /Confirm skip/i }).first().click();
      await page.waitForTimeout(300);
    }
    await page.getByRole("button", { name: /Continue.*swarm/i }).click();
    await expect(page.getByRole("heading", { name: /Phase 3.*Swarm/i })).toBeVisible({ timeout: 15_000 });

    // Phase 3
    await page.getByRole("button", { name: /Continue.*workflows/i }).click();
    await expect(page.getByRole("heading", { name: /Phase 4.*Workflows/i })).toBeVisible({ timeout: 15_000 });

    // Phase 4
    await page.getByRole("button", { name: /Continue.*finalize/i }).click();
    await expect(page.getByRole("heading", { name: /^Finalize$/i })).toBeVisible({ timeout: 15_000 });

    // Finalize (skip T2)
    await page.getByRole("checkbox", { name: /Skip T2 inference/i }).check();
    await page.getByRole("button", { name: /Finalize.*sign/i }).click();
    await expect(page.getByText(/MATERIALIZED/i)).toBeVisible({ timeout: 60_000 });

    // Activate
    await page.getByRole("button", { name: /Activate fleet/i }).click();
    await expect(page.getByText(/Activated.*agents written to db/i)).toBeVisible({ timeout: 15_000 });
    await expect(page).toHaveURL(new RegExp(`companyId=${id}`), { timeout: 10_000 });

    // Pricing sits between Activate and Mission Control — choose plan, skip.
    await page.getByRole("button", { name: /Choose plan/i }).click();
    await expect(page.getByRole("heading", { name: /System Optimizer subscription/i }))
      .toBeVisible({ timeout: 10_000 });
    await page.getByRole("button", { name: /Skip.*continue without subscription/i }).click();

    // Mission Control loaded
    await expect(page.getByRole("heading", { name: /KPI scoreboard/i })).toBeVisible({ timeout: 15_000 });
  });

  /** ---------------------------------------------------------------- */
  /** Variant 2: welcome screen lists existing draft companies in the resume section */
  test("v2: welcome screen lists existing draft after seed", async ({ page }) => {
    const api = await pwRequest.newContext({ baseURL: API });
    const id = uniqueId("v2-list");
    await seedPartial(api, id);
    await api.dispose();

    await page.goto("/onboarding");
    // A company with answers in flight is a DRAFT — it lands in "In
    // progress", not among the already-onboarded (those go to the canvas).
    await expect(page.getByRole("heading", { name: /^In progress$/i })).toBeVisible({ timeout: 10_000 });
    await expect(page.locator("code", { hasText: id })).toBeVisible();
  });

  /** ---------------------------------------------------------------- */
  /** Variant 3: Reset (only) from welcome — company removed from picker */
  test("v3: Reset only on welcome wipes the company from the picker", async ({ page }) => {
    const api = await pwRequest.newContext({ baseURL: API });
    const id = uniqueId("v3-reset-only");
    await seedFinalized(api, id);
    await api.dispose();

    await page.goto("/onboarding");
    const codeEl = page.locator("code", { hasText: id });
    await expect(codeEl).toBeVisible({ timeout: 10_000 });

    // Scope to THIS row so we don't accidentally Reset a leftover company from
    // a prior test in the same Playwright run. The DOM is:
    //   <div row>          ← codeEl/../..
    //     <button resume><code>{id}</code></button>
    //     <button>Reset</button>
    //   </div>
    const row = codeEl.locator("xpath=../..");
    await row.getByRole("button", { name: /^Reset$/ }).click();
    await expect(page.getByRole("heading", { name: /Reset.*\?/i })).toBeVisible();
    await page.getByRole("button", { name: /Reset only/i }).click();

    // Banner appears + companyId disappears from picker. Scope to "code inside
    // a button" so we don't accidentally match the banner's own <code>{id}</code>.
    await expect(page.getByText(/Reset.*wiped/i)).toBeVisible({ timeout: 10_000 });
    await expect(page.locator("button code", { hasText: id })).toHaveCount(0, { timeout: 10_000 });
  });

  /** ---------------------------------------------------------------- */
  /** Variant 4: Reset + restart drops at empty Pillar 1 with same companyId */
  test("v4: Reset + restart returns to Pillar 1 with empty form", async ({ page }) => {
    const api = await pwRequest.newContext({ baseURL: API });
    const id = uniqueId("v4-reset-restart");
    await seedFinalized(api, id);
    await api.dispose();

    await page.goto("/onboarding");
    const codeEl = page.locator("code", { hasText: id });
    await expect(codeEl).toBeVisible({ timeout: 10_000 });

    const row = codeEl.locator("xpath=../..");
    await row.getByRole("button", { name: /^Reset$/ }).click();
    await page.getByRole("button", { name: /Reset \+ restart/i }).click();

    // Lands on Pillar 1 with same companyId in URL
    await expect(page).toHaveURL(new RegExp(`companyId=${id}`), { timeout: 10_000 });
    await expect(page.getByRole("heading", { name: /Pillar 1.*who you are/i })).toBeVisible({ timeout: 10_000 });

    // Pillar 1 form should be empty (not pre-populated with old data)
    const pillar1Inputs = page.locator("input[type='text'], input:not([type='radio']):not([type='checkbox']):not([type='password'])");
    await expect(pillar1Inputs.first()).toHaveValue("");
  });

  /** ---------------------------------------------------------------- */
  /** Variant 5: in-wizard ↺ Reset button returns to welcome screen */
  test("v5: in-wizard Reset button returns to welcome screen", async ({ page }) => {
    const api = await pwRequest.newContext({ baseURL: API });
    const id = uniqueId("v5-in-wizard");
    await seedPartial(api, id);
    await api.dispose();

    await page.goto(`/onboarding?companyId=${id}`);
    // Wizard shows ↺ Reset in header
    const resetBtn = page.getByRole("button", { name: /↺ Reset/ });
    await expect(resetBtn).toBeVisible({ timeout: 10_000 });

    await resetBtn.click();
    await expect(page.getByRole("heading", { name: /Reset.*\?/i })).toBeVisible();
    await page.getByRole("button", { name: /Reset only/i }).click();

    // Returns to welcome (no companyId in URL)
    await expect(page).not.toHaveURL(new RegExp(`companyId=${id}`), { timeout: 10_000 });
    await expect(page.getByRole("heading", { name: /Onboarding/i }).first()).toBeVisible();
  });

  /** ---------------------------------------------------------------- */
  /** Variant 6: slug conflict warning prevents Start button from advancing */
  test("v6: slug conflict warning + disables Start", async ({ page }) => {
    const api = await pwRequest.newContext({ baseURL: API });
    const id = uniqueId("v6-conflict");
    await seedPartial(api, id);
    await api.dispose();

    await page.goto("/onboarding");
    const nameInput = page.locator("input[autofocus], input:not([type='radio']):not([type='checkbox'])").first();
    await nameInput.fill(id);

    await expect(page.getByText(/already exists/i)).toBeVisible({ timeout: 10_000 });
    const startBtn = page.getByRole("button", { name: /^Start/i });
    await expect(startBtn).toBeDisabled();
  });

  /** ---------------------------------------------------------------- */
  /** Variant 7: resume existing partial draft auto-routes to next pillar */
  test("v7: resume partial draft auto-routes to next pillar (Pillar 4)", async ({ page }) => {
    const api = await pwRequest.newContext({ baseURL: API });
    const id = uniqueId("v7-resume");
    await seedPartial(api, id);
    await api.dispose();

    await page.goto("/onboarding");
    await expect(page.locator("code", { hasText: id })).toBeVisible({ timeout: 10_000 });

    // Click the resume button (the company row's main button, NOT the Reset)
    await page.locator("code", { hasText: id }).first().click();

    // Auto-route on hydration: with pillars 1-3 complete, lands on Pillar 4
    await expect(page.getByRole("heading", { name: /Pillar 4/i })).toBeVisible({ timeout: 15_000 });
  });

  /** ---------------------------------------------------------------- */
  /** Variant 8: Activate writes to DB; FleetGraph populates with agents */
  test("v8: Activate hydrates the FleetGraph with real agents", async ({ page }) => {
    const api = await pwRequest.newContext({ baseURL: API });
    const id = uniqueId("v8-activate-fleet");
    await seedFinalized(api, id);
    await api.dispose();

    // Activate via the API directly (faster than navigating Materialize UI)
    const activateApi = await pwRequest.newContext({ baseURL: API });
    const r = await activateApi.post(`/api/instance/${id}/activate`);
    expect(r.ok()).toBe(true);
    const json = await r.json();
    expect(json.inserted.companies).toBe(1);
    expect(json.inserted.agents).toBeGreaterThan(0);
    await activateApi.dispose();

    await page.goto(`/?companyId=${id}`);
    // Fleet header shows agent count
    await expect(page.getByText(/Fleet · \d+ agents/)).toBeVisible({ timeout: 15_000 });
    // No empty-state placeholder
    await expect(page.getByText(/No agents yet/i)).toHaveCount(0);
  });

  /** ---------------------------------------------------------------- */
  /** Variant 9: FleetGraph nodes show display name + templateId + origin badge */
  test("v9: FleetGraph nodes show display name + templateId + origin", async ({ page }) => {
    const api = await pwRequest.newContext({ baseURL: API });
    const id = uniqueId("v9-fleet-style");
    await seedFinalized(api, id);
    const r = await api.post(`/api/instance/${id}/activate`);
    expect(r.ok()).toBe(true);
    await api.dispose();

    await page.goto(`/?companyId=${id}`);
    await page.waitForLoadState("networkidle");
    await expect(page.getByText(/Fleet · \d+ agents/)).toBeVisible({ timeout: 15_000 });

    // Display name "CEO" rendered exactly (the uppercase abbreviation rule
    // converts templateId "ceo" → "CEO" for the title line).
    await expect(page.getByText("CEO", { exact: true }).first()).toBeVisible({ timeout: 15_000 });
    // The WaveX origin badge (CEO template origin = wavex)
    await expect(page.getByText("WaveX", { exact: true }).first()).toBeVisible();
    // The raw templateId "ceo" rendered in dim text on the CEO node
    await expect(page.getByText("ceo", { exact: true }).first()).toBeVisible();
  });

  /** ---------------------------------------------------------------- */
  /** Variant 10: Mission Control shows "no company selected" with no companyId param */
  test("v10: Mission Control bare URL shows 'No company selected' state", async ({ page }) => {
    await page.goto("/");
    await expect(page.locator("strong", { hasText: /No company selected/i })).toBeVisible({ timeout: 10_000 });
    await expect(page.getByRole("link", { name: /Start onboarding/i })).toBeVisible();
  });

  /** ---------------------------------------------------------------- */
  /** Variant 11: template swap survives finalize → activate → DB write */
  test("v11: swap template on Phase 3 → survives activate → bridge writes overlay templateId to DB", async ({ page }) => {
    test.slow();
    const api = await pwRequest.newContext({ baseURL: API });
    const id = uniqueId("v11-swap");
    await seedFinalized(api, id);

    // Pick a non-default template that's a valid alternative for cpo.build.
    // Default for cpo.build is "backend-architect"; "frontend-developer" is in
    // the same engineering division — should be in the alternatives list.
    const SLOT = "cpo.build";
    const NEW_TEMPLATE = "frontend-developer";

    // Swap via API — same call the UI's AgentSwapPanel makes
    const swapResp = await api.post(`/api/instance/${id}/swap-template`, {
      data: { slot: SLOT, templateId: NEW_TEMPLATE },
    });
    expect(swapResp.ok()).toBe(true);
    const swap = await swapResp.json();
    expect(swap.overlays[SLOT]).toBe(NEW_TEMPLATE);

    // Activate — bridge should pick up the overlay
    const actResp = await api.post(`/api/instance/${id}/activate`);
    expect(actResp.ok()).toBe(true);
    const act = await actResp.json();
    expect(act.warnings.some((w: string) => w.includes(SLOT) && w.includes(NEW_TEMPLATE))).toBe(true);

    // /api/agents should now report the swapped templateId for that slot
    const agentsResp = await api.get(`/api/agents?companyId=${id}`);
    const agentsJson = await agentsResp.json();
    const swapped = agentsJson.agents.find((a: { slot: string; templateId: string }) => a.slot === SLOT);
    expect(swapped).toBeDefined();
    expect(swapped.templateId).toBe(NEW_TEMPLATE);
    await api.dispose();

    // UI sanity: Mission Control's FleetGraph should render Frontend Developer
    // (the displayName for "frontend-developer") for the cpo.build node.
    await page.goto(`/?companyId=${id}`);
    await expect(page.getByText(/Fleet · \d+ agents/)).toBeVisible({ timeout: 15_000 });
    await expect(page.getByText("Frontend Developer", { exact: true }).first()).toBeVisible({ timeout: 15_000 });
  });
});
