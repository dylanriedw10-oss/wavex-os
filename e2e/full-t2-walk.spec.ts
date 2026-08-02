/** Playwright e2e — single full-fidelity walk with real T2 enrichment.
 *
 *  This test exercises the actual operator experience: no ?t0=1 fast mode,
 *  no skipInference shortcuts. Every pillar's enrichment + every phase's
 *  T2 refinement + the imprint generation runs against the real tier-router
 *  → claude CLI path.
 *
 *  Total runtime: 3-8 minutes depending on prompt depth + claude latency.
 *
 *  SKIPPED BY DEFAULT — set WAVEX_E2E_T2=1 to run. Requires:
 *    - claude CLI installed
 *    - either OAuth keychain populated (Max plan) or ANTHROPIC_API_KEY in env */

import { test, expect, type Page } from "@playwright/test";

const RUN_T2 = process.env.WAVEX_E2E_T2 === "1";

const COMPANY_ID = `pw-t2-${Date.now().toString(36)}`;
// Pick a real, scrapable URL so Pillar 1's T2 deep-dive has actual content.
// Anthropic's homepage is stable + on-brand for an AI infrastructure shape.
const RAW_INPUT = "https://www.anthropic.com";

async function fillNameAndStart(page: Page, name: string): Promise<void> {
  await page.goto("/onboarding"); // NO ?t0=1 — we want the real path
  const nameInput = page.locator("input[autofocus], input:not([type='radio']):not([type='checkbox'])").first();
  await nameInput.fill(name);
  await page.getByRole("button", { name: /^Start/i }).click();
  await expect(page.getByRole("heading", { name: /Pillar 1.*who you are/i })).toBeVisible();
}

test.describe("full T2-enriched walk", () => {
  test.skip(!RUN_T2, "Set WAVEX_E2E_T2=1 to run (requires claude CLI + auth)");

  test("welcome → 5 pillars (real T2) → 3 phases (real T2) → finalize (real T2 imprint) → activate", async ({ page }) => {
    test.setTimeout(15 * 60 * 1000); // 15 min ceiling

    await fillNameAndStart(page, COMPANY_ID);

    // ---- Pillar 1: real deep-dive enrichment via T2 ------------------
    const pillar1Inputs = page.locator("input[type='text'], input:not([type='radio']):not([type='checkbox']):not([type='password'])");
    await pillar1Inputs.nth(0).fill(COMPANY_ID);
    await pillar1Inputs.nth(1).fill(RAW_INPUT);
    await page.getByRole("button", { name: /^Next/i }).click();

    // T2 enrichment can take 90-180s for a real URL fetch + multi-page synthesis
    await expect(page.getByRole("heading", { name: /confirm what we inferred/i }))
      .toBeVisible({ timeout: 180_000 });
    // The enriched company_context should be substantial (>200 chars), not the
    // boilerplate "no product yet" short-circuit.
    const enrichedText = await page.getByText(/.{200,}/).first().textContent().catch(() => "");
    expect(enrichedText?.length ?? 0).toBeGreaterThan(200);
    await page.getByRole("button", { name: /Confirm \+ continue/i }).click();

    // ---- Pillar 2: claude probe ----------------------------------------
    await expect(page.getByRole("heading", { name: /Verifying your setup/i })).toBeVisible();
    await page.getByRole("button", { name: /Verify.*Continue/i }).click();
    await expect(page.getByRole("heading", { name: /Pillar 3/i })).toBeVisible({ timeout: 60_000 });

    // ---- Pillar 3: defaults are fine; just advance ---------------------
    await page.getByRole("button", { name: /^Next/i }).click();
    await expect(page.getByRole("heading", { name: /Pillar 4/i })).toBeVisible();

    // ---- Pillar 4: defaults are fine; just advance ---------------------
    await page.getByRole("button", { name: /^Next/i }).click();
    await expect(page.getByRole("heading", { name: /Pillar 5/i })).toBeVisible();

    // ---- Pillar 5: skip credentials, finish phase 1 --------------------
    await page.getByRole("button", { name: /Finish Phase 1/i }).click();
    await expect(page.getByRole("heading", { name: /Phase 2.*Connectors/i }))
      .toBeVisible({ timeout: 30_000 });

    // ---- Phase 2: real T2 connector refinement (auto-runs on mount) ----
    // Continue button stays disabled until T2 returns + manifest hydrates.
    const phase2Continue = page.getByRole("button", { name: /Continue.*swarm/i });
    await expect(phase2Continue).toBeEnabled({ timeout: 240_000 });
    // Source label confirms real T2 enrichment (not fallback)
    await expect(page.getByText(/source:\s*t2/i)).toBeVisible({ timeout: 5_000 });
    await phase2Continue.click();
    await expect(page.getByRole("heading", { name: /Credential Concierge/i })).toBeVisible({ timeout: 15_000 });

    // ---- Concierge: skip every required --------------------------------
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

    // ---- Phase 3: real T2 swarm overlay --------------------------------
    const phase3Continue = page.getByRole("button", { name: /Continue.*workflows/i });
    await expect(phase3Continue).toBeEnabled({ timeout: 240_000 });
    await expect(page.getByText(/source:\s*t2/i)).toBeVisible({ timeout: 5_000 });
    await phase3Continue.click();
    await expect(page.getByRole("heading", { name: /Phase 4.*Workflows/i })).toBeVisible({ timeout: 15_000 });

    // ---- Phase 4: real T2 workflow patches -----------------------------
    const phase4Continue = page.getByRole("button", { name: /Continue.*finalize/i });
    await expect(phase4Continue).toBeEnabled({ timeout: 240_000 });
    await expect(page.getByText(/source:\s*t2/i)).toBeVisible({ timeout: 5_000 });
    await phase4Continue.click();
    await expect(page.getByRole("heading", { name: /^Finalize$/i })).toBeVisible({ timeout: 15_000 });

    // ---- Finalize: with real T2 imprint generation ---------------------
    // (do NOT check "Skip T2 inference" — we want the real imprint path)
    await page.getByRole("button", { name: /Finalize.*sign/i }).click();
    await expect(page.getByText(/MATERIALIZED/i)).toBeVisible({ timeout: 240_000 });
    // The MATERIALIZED card should report source=t2 (not fallback)
    await expect(page.getByText(/source:\s*t2/i).first()).toBeVisible();
    // Imprint summary should be present (real T2 prose)
    await expect(page.getByText(/^Imprint:/i)).toBeVisible();

    // ---- Activate: writes the spawned manifest into runtime DB ---------
    await page.getByRole("button", { name: /Activate fleet/i }).click();
    await expect(page.getByText(/Activated.*agents written to db/i)).toBeVisible({ timeout: 30_000 });

    // ---- Activation status visible in the sticky footer ----------------
    // The fleet lands in wavex's own DB — there is no second backend to
    // mirror into since the pivot, so the footer states one fact.
    await expect(page.getByText(/Fleet activated/i)).toBeVisible({ timeout: 5_000 });

    // ---- Pricing step (new) ------------------------------------------
    // Activate now advances to the pricing screen instead of opening Mission
    // Control directly. Click "Choose plan →" → land on pricing → Skip.
    await page.getByRole("button", { name: /Choose plan/i }).click();
    await expect(page.getByRole("heading", { name: /System Optimizer subscription/i }))
      .toBeVisible({ timeout: 10_000 });
    await page.getByRole("button", { name: /Skip.*continue without subscription/i }).click();

    // ---- Mission Control ---------------------------------------------
    await expect(page.getByRole("heading", { name: /KPI scoreboard/i })).toBeVisible({ timeout: 15_000 });
    await expect(page.getByText(/Fleet · \d+ agents/)).toBeVisible({ timeout: 15_000 });
  });
});
