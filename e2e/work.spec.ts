/** Work e2e — the native runtime through the UI: not-started → seed →
 *  run cycle → review → approve → done, plus the desk queue.
 *
 *  Needs WAVEX_E2E_FIXTURE_ENGINE=1: the playwright config then points
 *  WAVEX_OS_CLAUDE_BIN at the canned fixture bin so run-cycle never
 *  spawns a real model. Without it this file skips itself — a default
 *  `pnpm test:e2e` must never burn operator tokens.
 *
 *  The company is seeded by writing a manifest fixture straight into the
 *  run's state dir (WAVEX_E2E_STATE_DIR, exported by the config) — the
 *  same fixture shape the vitest suites use, no T2 in the path. */

import { test, expect } from "@playwright/test";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const CO = `pw-work-${Date.now().toString(36)}`;

const MANIFEST = {
  org_id: CO,
  pillar_responses: {
    pillar_1: { industry_hint: "saas-b2b", manual_context: "fixture" },
    pillar_3: { stage: "10k_100k_mrr" },
    pillar_4: { sales_motion: "assisted_demo", lead_sources: ["outbound_cold"] },
  },
  goal: { metric: "mrr", current: 1000, target: 9000, days: 30 },
  connector_manifest: { required: [], suggested: [], deferred: [], blocked_on_manual_approval: [] },
  swarm_manifest: {
    agents: {
      ceo: { status: "active", adapter: "claude-code", heartbeat: "15m", budget_monthly_usd: 300, skill_overlay: null, department: "ceo", level: "L·II", reports_to: null, spawnable: false },
      growth: { status: "active", adapter: "claude-code", heartbeat: "1h", budget_monthly_usd: 120, skill_overlay: null, department: "growth", level: "L·III", reports_to: "ceo", spawnable: false },
    },
  },
};

test.describe("native work runtime", () => {
  test.skip(!process.env.WAVEX_E2E_FIXTURE_ENGINE, "needs the fixture engine — run with WAVEX_E2E_FIXTURE_ENGINE=1");

  test.beforeAll(() => {
    const stateDir = process.env.WAVEX_E2E_STATE_DIR;
    if (!stateDir) throw new Error("WAVEX_E2E_STATE_DIR not exported by playwright.config.ts");
    const dir = join(stateDir, "instances/default/companies", CO, "onboarding");
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "company.manifest.json"), JSON.stringify(MANIFEST));
  });

  test("Work view: not started → Seed from manifest → real goals and tasks", async ({ page }) => {
    await page.goto(`/canvas?companyId=${CO}`);
    await page.getByRole("button", { name: "Work", exact: true }).click();

    // The 503 gate is a first-class state with its own affordance.
    await expect(page.getByText("The runtime hasn't started.")).toBeVisible();
    await page.getByRole("button", { name: "Seed from manifest" }).click();

    // Goal derived from the manifest; one bootstrap task per active slot.
    await expect(page.getByText(/mrr: 1,000 → 9,000/).first()).toBeVisible();
    await expect(page.getByText("0/2 done")).toBeVisible();
    await expect(page.getByText("Nothing awaiting review.")).toBeVisible();

    // Deliverables grouped by DEPARTMENT, not by status (EXECUTION_MODEL.md).
    // The header carries counted progress; the agent slot appears nowhere.
    await expect(page.getByRole("button", { name: /0\/1 done/ }).first()).toBeVisible();
    // The bootstrap tasks are present as their own rows.
    // The row prints the ARTIFACT — deliverables are the UI. The imperative
    // title survives as the row's accessible name, not as its visible text.
    await expect(page.getByText("The ceo function's operating baseline").first()).toBeVisible();
    await expect(page.getByText("The growth function's operating baseline").first()).toBeVisible();
    // …and the agent slot appears nowhere the operator can read it.
    await expect(page.getByText("Ceo.orchestrator", { exact: true })).toHaveCount(0);
    await expect(page.getByText("ceo.orchestrator", { exact: true })).toHaveCount(0);
  });

  test("the desk: hero, working-on rows, and the reporting structure", async ({ page }) => {
    await page.goto(`/canvas?companyId=${CO}`);
    await page.getByRole("button", { name: "Ceo agent" }).click();

    // The hero is honest: nothing running yet, the next task named.
    await expect(page.getByText("Currently working", { exact: true })).toBeVisible();
    await expect(page.getByText("Idle right now.")).toBeVisible();
    // The CEO desk sweeps its reports too — both bootstrap tasks appear.
    // (.first(): the ceo title also shows in the hero's next-in-queue line.)
    await expect(page.getByText("Working on", { exact: true })).toBeVisible();
    await expect(page.getByText("Establish the ceo operating baseline").first()).toBeVisible();
    await expect(page.getByText("Establish the growth operating baseline").first()).toBeVisible();
    // The reporting structure renders from children data alone.
    await expect(page.getByText(/Reporting structure/)).toBeVisible();
    await expect(page.getByRole("button", { name: "View Org" })).toBeVisible();
  });

  test("run cycle → fixture deliverables await review; approve → done", async ({ page }) => {
    test.setTimeout(150_000); // serial cycle: up to 2 × engine ceiling on a bad day
    await page.goto(`/canvas?companyId=${CO}`);
    await page.getByRole("button", { name: "Work", exact: true }).click();
    await expect(page.getByText("0/2 done")).toBeVisible();

    await page.getByRole("button", { name: "Run cycle", exact: true }).click();
    // Serial execution through the fixture engine — generous ceiling anyway.
    await expect(page.getByText("Ran 2 tasks — 2 awaiting review")).toBeVisible({ timeout: 120_000 });

    // The deliverable renders VERBATIM, clamped to its first lines — the
    // fixture's self-declaration IS line one. L3 unrolls the rest.
    await expect(page.getByText(/Fixture engine output \(canned\)/).first()).toBeVisible();
    await expect(page.getByText("structural checks passed").first()).toBeVisible();
    await page.getByRole("button", { name: "Show full output" }).first().click();
    await expect(page.getByText(/requesting changes requeues it with feedback/).first()).toBeVisible();

    // Approve one: its task closes and the goal meter counts it. There is no
    // "done" GROUP any more — groups are departments, and progress is the
    // counted `n/m done` on the group's own header (EXECUTION_MODEL.md).
    await page.getByRole("button", { name: "Approve" }).first().click();
    await expect(page.getByText("1/2 done")).toBeVisible();
    // The ladder states its counts in one of two forms depending on the
    // density it was given: per-department headers when there is room, and a
    // single counted line when the review queue has taken the space. Both are
    // the gradient working; asserting either would be asserting a viewport.
    await expect(
      page.getByRole("button", { name: /\d+\/\d+ done/ }).first()
        .or(page.getByText(/\d+ deliverables? across \d+ department/)),
    ).toBeVisible();
  });

  test("request changes → the task requeues with the feedback and a burned attempt", async ({ page }) => {
    await page.goto(`/canvas?companyId=${CO}`);
    await page.getByRole("button", { name: "Work", exact: true }).click();

    // One deliverable still pending from the cycle above.
    await page.getByRole("button", { name: "Request changes" }).click();
    await page.getByLabel("Change request feedback").fill("tighten the plan");
    await page.getByRole("button", { name: "Send feedback" }).click();

    // The loop that never gives up: the deliverable is back in its department
    // with the attempt burned. With the queue emptied the ladder has room
    // again, so the rows are there — and the row states its own stage rather
    // than sitting under a status header.
    await expect(page.getByText("Nothing awaiting review.")).toBeVisible();
    await expect(page.getByText("todo", { exact: true }).first()).toBeVisible();
    await expect(page.getByText("1/3", { exact: true }).first()).toBeVisible();
    // …and the agent slot is nowhere in the operator's view.
    await expect(page.getByText("Ceo.orchestrator", { exact: true })).toHaveCount(0);
  });

  test("the runtime tray: now, up next, just finished — one overlay, esc closes", async ({ page }) => {
    await page.goto(`/canvas?companyId=${CO}`);
    await page.getByRole("button", { name: "Runtime", exact: true }).click();

    // Operational truths render even at rest; the pick order is the cycle's.
    await expect(page.getByText("Nothing running.")).toBeVisible();
    await expect(page.getByText("Up next", { exact: true })).toBeVisible();
    // The requeued ceo task (attempt burned, under ceiling) is ready again.
    await expect(page.getByText("Establish the ceo operating baseline").first()).toBeVisible();
    // The accumulated record: the growth approval from the earlier test.
    await expect(page.getByText("Just finished", { exact: true })).toBeVisible();
    await expect(page.getByText(/Approved · /).first()).toBeVisible();

    await page.keyboard.press("Escape");
    await expect(page.getByText("Up next", { exact: true })).toHaveCount(0);
  });
});
