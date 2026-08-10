/** The connector phase must not act on what it has not read.
 *
 *  `summarize(q.data?.connectors ?? [])` collapses three situations into one
 *  number: the vault answered zero, the vault has not answered yet, and the
 *  vault request failed. `requiredTotal === 0` was the sole condition for
 *  offering "Nothing required — continue →" — a button whose one click sets
 *  the sticky `connectorsCondensed` bit and moves the flow to plan assembly.
 *
 *  So a 500 from the credentials endpoint presented itself to the operator as
 *  a finding about their plan, with an irreversible control attached.
 *
 *  TWO-SIDED ON PURPOSE. A test that only checks the error case would pass on
 *  a build that never renders the button at all, which would be a different
 *  bug of the same size. The success-with-zero case proves the skip still
 *  works when the system genuinely knows there is nothing to wire. Both sides
 *  drive the SAME surface with the same seed; the only variable is what the
 *  credentials endpoint answers.
 *
 *  ABLATION, RUN: restoring the old two-branch render (`loading ? spinner :
 *  surface`, no `answered` gate, no error branch) fails A AND C while B still
 *  passes. A and C are the two ways the surface can be asked about data it
 *  does not have — failed and not-yet — and the old code answered both the
 *  same way it answers "zero". B passing throughout is the point: it proves
 *  the fix removed a false claim rather than removing the feature. */

import { test, expect, type Page } from "@playwright/test";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const CO = `pw-conn-${Date.now().toString(36)}`;
const CREDS = "**/wavex-os/onboarding/credentials/**";

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

/** Land directly in the wiring stage. The phases before it are covered
 *  elsewhere and driving them here would only add flake. */
async function seedAtWiring(page: Page) {
  await page.addInitScript(([co]) => {
    localStorage.setItem(`wavex-os-build-v3:${co}`, JSON.stringify({
      phase: { kind: "connectors", stage: "wiring", loading: false },
      thread: [],
      adoptedProductUrl: null,
      connectorsCondensed: false,
      planRun: null,
      draft: {},
    }));
  }, [CO]);
}

test.describe("the connector phase and the three states of a vault read", () => {
  test.skip(!process.env.WAVEX_E2E_FIXTURE_ENGINE, "needs the fixture engine — run with WAVEX_E2E_FIXTURE_ENGINE=1");

  test.beforeAll(() => {
    const dir = join(stateDir(), "instances/default/companies", CO, "onboarding");
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "pillar_responses.json"), JSON.stringify(PILLARS));
    writeFileSync(join(dir, "connector_manifest.json"), JSON.stringify(CONNECTOR));
  });

  test("A · a failed credentials read offers no skip, and says nothing was lost", async ({ page }) => {
    await page.route(CREDS, (route) =>
      route.fulfill({ status: 500, contentType: "application/json", body: JSON.stringify({ error: "vault unreachable" }) }));
    await seedAtWiring(page);
    await page.goto(`/build?companyId=${CO}`);

    // The failure is stated as a fact about the READ.
    await expect(page.getByText("I couldn't read which systems this plan needs.")).toBeVisible();
    // And it says the thing an operator most needs to hear at a dead end.
    await expect(page.getByText(/Nothing has been skipped and nothing is lost/)).toBeVisible();
    await expect(page.getByRole("button", { name: "Try again" })).toBeVisible();

    // THE ASSERTION THAT MATTERS: no irreversible control over unread data.
    await expect(page.getByRole("button", { name: /Nothing required/ })).toHaveCount(0);
    // And no claim about the plan's connectors either.
    await expect(page.getByText(/reads no external systems/)).toHaveCount(0);
  });

  test("B · a successful read of zero connectors still offers the skip", async ({ page }) => {
    await page.route(CREDS, (route) =>
      route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ ok: true, companyId: CO, connectors: [] }) }));
    await seedAtWiring(page);
    await page.goto(`/build?companyId=${CO}`);

    // Now the emptiness is a measurement, so it may be spoken and acted on.
    await expect(page.getByText("Nothing to wire — this plan reads no external systems yet.")).toBeVisible();
    await expect(page.getByRole("button", { name: /Nothing required/ })).toBeVisible();
    await expect(page.getByText("I couldn't read which systems this plan needs.")).toHaveCount(0);
  });

  test("C · while the read is in flight, neither the claim nor the skip appears", async ({ page }) => {
    // Held open, never resolved — the state the old code could not express.
    await page.route(CREDS, async () => { await new Promise(() => {}); });
    await seedAtWiring(page);
    await page.goto(`/build?companyId=${CO}`);

    await expect(page.getByText(/Reading what this plan needs to connect to/)).toBeVisible();
    await expect(page.getByRole("button", { name: /Nothing required/ })).toHaveCount(0);
    await expect(page.getByText(/reads no external systems/)).toHaveCount(0);
  });
});
