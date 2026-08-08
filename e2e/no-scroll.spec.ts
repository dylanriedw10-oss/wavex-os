/** The fit law's enforcement (spec Rev 10) — every view fits the window.
 *
 *  This is the gate that keeps the density budgets honest. A view that
 *  overflows the viewport is a bug here, not a judgment call: the law says
 *  a list renders what fits, states its true total, and sends the rest one
 *  level deeper.
 *
 *  Runs at three heights, including the supported floor (700px). Needs
 *  WAVEX_E2E_FIXTURE_ENGINE=1 so the seeded company has real work in it
 *  without spawning a model — an empty runtime would make the lists trivially
 *  fit and prove nothing. */

import { test, expect, type Page } from "@playwright/test";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const CO = `pw-fit-${Date.now().toString(36)}`;

const agent = (department: string, reports_to: string | null) => ({
  status: "active", adapter: "claude-code", heartbeat: "1h",
  budget_monthly_usd: 120, skill_overlay: null,
  department, level: "L·III", reports_to, spawnable: false,
});

/** Deliberately WIDE: 12 slots means 12 bootstrap tasks, so the ladder and
 *  the desk have more rows than any window can show. A 2-agent fixture would
 *  pass this suite without exercising a single clamp. */
const MANIFEST = {
  org_id: CO,
  pillar_responses: {
    pillar_1: { industry_hint: "saas-b2b", manual_context: "fit fixture" },
    pillar_3: { stage: "10k_100k_mrr" },
    pillar_4: { sales_motion: "assisted_demo", lead_sources: ["outbound_cold"] },
  },
  goal: { metric: "mrr", current: 12000, target: 40000, days: 90 },
  connector_manifest: { required: [], suggested: [], deferred: [], blocked_on_manual_approval: [] },
  swarm_manifest: {
    agents: {
      "ceo.orchestrator": agent("ceo", null),
      cpo: agent("product", "ceo.orchestrator"),
      cmo: agent("marketing", "ceo.orchestrator"),
      cro: agent("sales", "ceo.orchestrator"),
      cfo: agent("finance", "ceo.orchestrator"),
      "cpo.build": agent("product", "cpo"),
      "cpo.roadmap": agent("product", "cpo"),
      "cmo.demand": agent("marketing", "cmo"),
      "cmo.content": agent("marketing", "cmo"),
      "cro.outbound": agent("sales", "cro"),
      "cro.close": agent("sales", "cro"),
      "cfo.forecast": agent("finance", "cfo"),
    },
  },
};

const SIZES = [
  { w: 1440, h: 900, name: "desktop" },
  { w: 1280, h: 800, name: "laptop" },
  { w: 1024, h: 700, name: "floor" },
];

/** The two named exceptions (spec Rev 10): the transcript and the verbatim
 *  deliverable at L3 are append-only records that cannot be clamped without
 *  lying. Everything else must fit. */
const ALLOWED_SCROLLERS = ["cv-thread", "cv-record"];

async function assertFits(page: Page, label: string) {
  const report = await page.evaluate((allowed) => {
    const de = document.documentElement;
    const rogue = [...document.querySelectorAll(".canvas-root *")]
      .filter((el) => {
        const cs = getComputedStyle(el);
        if (!/auto|scroll/.test(cs.overflowY)) return false;
        if (el.scrollHeight <= el.clientHeight + 1) return false;
        return !allowed.some((c) => el.classList.contains(c));
      })
      .map((el) => `${el.tagName.toLowerCase()}.${el.className}`.slice(0, 60));
    // Not scrolling is only half the law. `overflow: hidden` can make a view
    // "fit" by CLIPPING content away — a silent cap, which Rev 10 forbids
    // more strongly than it forbids scrolling. The instrument must actually
    // CONTAIN its content, not merely hide the excess.
    const inst = document.querySelector(".cv-instrument");
    const clippedPx = inst ? inst.scrollHeight - inst.clientHeight : 0;
    return { docOverflow: de.scrollHeight - window.innerHeight, rogue, clippedPx };
  }, ALLOWED_SCROLLERS);

  expect(report.docOverflow, `${label}: the page itself must never scroll`).toBeLessThanOrEqual(1);
  expect(report.rogue, `${label}: only the record may scroll`).toEqual([]);
  expect(report.clippedPx, `${label}: content is clipped, not clamped — a silent cap`).toBeLessThanOrEqual(1);
}

test.describe("the fit law — every view fits the window", () => {
  test.skip(!process.env.WAVEX_E2E_FIXTURE_ENGINE, "needs the fixture engine — run with WAVEX_E2E_FIXTURE_ENGINE=1");

  test.beforeAll(() => {
    const stateDir = process.env.WAVEX_E2E_STATE_DIR;
    if (!stateDir) throw new Error("WAVEX_E2E_STATE_DIR not exported by playwright.config.ts");
    const dir = join(stateDir, "instances/default/companies", CO, "onboarding");
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "company.manifest.json"), JSON.stringify(MANIFEST));
  });

  test("seed the runtime so the lists have real depth", async ({ page }) => {
    await page.goto(`/canvas?companyId=${CO}`);
    await page.getByRole("button", { name: "Work", exact: true }).click();
    await page.getByRole("button", { name: "Seed from manifest" }).click();
    await expect(page.getByText("0/12 done")).toBeVisible();
  });

  for (const { w, h, name } of SIZES) {
    test(`${name} ${w}×${h}`, async ({ page }) => {
      await page.setViewportSize({ width: w, height: h });

      // The Living Canvas — the reasoning model, rendered. Its content is
      // unbounded in principle (eighteen capabilities, a gap of any length,
      // any number of contradictions), so it is exactly the surface where a
      // page-level scroll would creep in. One region may scroll; the page
      // may not.
      await page.goto(`/reasoning?companyId=${CO}`);
      await expect(page.getByText(/What we understand about/)).toBeVisible();
      await assertFits(page, `${name} · reasoning canvas`);

      // L0 — the watch face. The tightest budget in the product.
      await page.goto(`/canvas?companyId=${CO}`);
      await expect(page.getByRole("button", { name: /Constitution/ })).toBeVisible();
      await assertFits(page, `${name} · L0`);

      // Each company lens in turn — one object at a time, all measured.
      for (const lens of ["Work", "Investigations", "Learned", "Gravity"]) {
        await page.getByRole("button", { name: lens, exact: true }).click();
        await assertFits(page, `${name} · ${lens} lens`);
        await page.getByRole("button", { name: lens, exact: true }).click();
      }

      // The Work ladder EXPANDED — the case that was previously uncapped.
      // Groups are DEPARTMENTS now, not statuses (see EXECUTION_MODEL.md), and
      // they arrive open, so the expanded case is the default. The header
      // carries counted progress, which is the stable thing to match on.
      await page.getByRole("button", { name: "Work", exact: true }).click();
      await assertFits(page, `${name} · Work ladder expanded`);
      // Every department header that EXISTS must be visible. This is the
      // assertion that matters: a header rendered into a clipped region is
      // present in the DOM and invisible to the operator — the silent cap the
      // fit law forbids, and one the instrument-level check cannot see
      // because the clipping happens inside the ladder's own hidden box.
      // (Asserting visibility rather than clicking: the panel re-renders on
      // the work-store poll, so a click races the refetch for no added
      // coverage.)
      const groups = page.getByRole("button", { name: /\d+\/\d+ done/ });
      for (let i = 0; i < await groups.count(); i++) {
        await expect(groups.nth(i), `${name}: a department header is clipped`).toBeVisible();
      }

      // A desk at L1 — masthead, hero, rows, and the sidebar previews.
      await page.goto(`/canvas?companyId=${CO}`);
      await page.getByRole("button", { name: "Ceo.orchestrator agent" }).click();
      await expect(page.getByText("Currently working", { exact: true })).toBeVisible();
      await assertFits(page, `${name} · desk`);

      // The tray — the one sanctioned overlay, over the desk.
      await page.getByRole("button", { name: "Runtime", exact: true }).click();
      await expect(page.getByText("Up next", { exact: true })).toBeVisible();
      await assertFits(page, `${name} · runtime tray`);
      await page.keyboard.press("Escape");
    });
  }

  test("an ephemeral workspace fits at the floor", async ({ page }) => {
    await page.setViewportSize({ width: 1024, height: 700 });
    const base = `/api/instance/${CO}/canvas`;
    // Compose several workspaces so the grid has more cells than fit.
    for (const m of ["why did spend spike?", "show me the team", "how are we tracking to goal?"]) {
      await page.request.post(base, { data: { message: m, skipInference: true } });
    }
    await page.goto(`/canvas?companyId=${CO}`);
    await assertFits(page, "floor · ephemeral workspace");
  });
});
