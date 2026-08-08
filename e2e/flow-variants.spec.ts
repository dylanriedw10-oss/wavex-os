/** Playwright e2e — activate → DB → FleetGraph, plus Mission Control's
 *  empty state.
 *
 *  These tests seed over the HTTP API and then exercise the UI for the
 *  affordance under test. Each uses a unique companyId so they don't collide.
 *
 *  Variants 1-7 lived here and are gone. They drove the 5-pillar wizard at
 *  /onboarding — the welcome screen, the company picker, the ↺ Reset button,
 *  the slug-conflict warning, the resume auto-route. That surface is not
 *  merely restyled: main.tsx:61-62 redirects /onboarding and /onboarding-chat
 *  to /build, and `WavexOsOnboarding` — the host that mounted every one of
 *  those affordances — is imported by nothing. The components still sit on
 *  disk, which is the trap: grepping for "Pillar 1" or "↺ Reset" still finds
 *  them. Unrouted AND unmounted is the same as deleted, so those seven could
 *  never pass again without being rewritten against /build.
 *
 *  What survives here is route-independent of that cutover: v8-v11 seed over
 *  HTTP and assert against Mission Control at "/", and they are the only
 *  end-to-end proof that a template overlay survives finalize → activate →
 *  DB → /api/agents → FleetGraph. See e2e/RETIRED.md. */

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
test.describe("activate → fleet", () => {
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
