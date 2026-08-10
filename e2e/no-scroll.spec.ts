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
  // See e2e/work.spec.ts — `metric` is a field the manifest goal does not
  // have; the producer writes `kpiId` with the canonical long id.
  goal: { kpiId: "monthly_recurring_revenue", current: 12000, target: 40000, days: 90, stated: true },
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

/** Every element matching `pattern` must be VISIBLE TO THE OPERATOR — present
 *  in the DOM is not enough, because a header rendered inside a clipped
 *  region is present and unreadable, which is the silent cap the fit law
 *  forbids more strongly than it forbids scrolling.
 *
 *  Two distinct things this checks that the original did not.
 *
 *  ONE `evaluate`, deliberately. It was written as
 *
 *      for (let i = 0; i < await groups.count(); i++)
 *        await expect(groups.nth(i)).toBeVisible();
 *
 *  which reads the count in one round trip and each element in another, while
 *  the panel re-renders on the work-store poll in between — the loop's own
 *  comment named that poll. `nth(2)` could resolve against a list that had
 *  since shrunk and fail with "element(s) not found" under a message claiming
 *  a clip: two faults wearing one label, the flaky one firing only in
 *  full-suite runs. One layout snapshot removes the window entirely.
 *
 *  CONTAINMENT, which `toBeVisible()` never tests — Playwright counts an
 *  element scrolled out of an `overflow: hidden` box as visible, so the Work
 *  ladder clipped its last department headers for as long as this gate has
 *  existed and the gate reported success. That is the assertion below.
 *
 *  Failures carry the MEASUREMENTS. A bare "is clipped" cost three separate
 *  probe scripts to reproduce; the numbers that decide it are right here. */
async function assertAllVisible(page: Page, pattern: string, label: string) {
  const bad = await page.evaluate((src) => {
    const re = new RegExp(src);
    const out: string[] = [];
    for (const el of [...document.querySelectorAll("button")]) {
      const text = (el.textContent ?? "").trim();
      if (!re.test(text)) continue;
      const r = el.getBoundingClientRect();
      const name = text.slice(0, 40);
      if (r.width === 0 || r.height === 0) { out.push(`${name} — zero size`); continue; }
      if (getComputedStyle(el).visibility === "hidden") { out.push(`${name} — visibility:hidden`); continue; }
      let p = el.parentElement;
      while (p) {
        const cs = getComputedStyle(p);
        if (cs.overflow !== "visible" || cs.overflowY !== "visible" || cs.overflowX !== "visible") {
          const c = p.getBoundingClientRect();
          // 1px of slack for sub-pixel layout, the tolerance assertFits uses.
          if (r.bottom > c.bottom + 1 || r.top < c.top - 1) {
            const sibs = [...(p.children as unknown as Element[])].map((n) => Math.round(n.getBoundingClientRect().height));
            out.push(
              `${name} — clipped: box ${Math.round(c.height)}px (client ${p.clientHeight}, scroll ${p.scrollHeight}), ` +
              `content ${sibs.reduce((a, b) => a + b, 0)}px [${sibs.join("+")}], overflow ${Math.round(r.bottom - c.bottom)}px`,
            );
          }
          break;
        }
        p = p.parentElement;
      }
    }
    return out;
  }, pattern);
  expect(bad, `${label}: a department header is clipped or unrendered`).toEqual([]);
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
      await assertAllVisible(page, "\\d+/\\d+ done", `${name} · Work ladder`);

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

  /** The instrument, checked against itself.
   *
   *  `assertAllVisible` replaced a loop that could fail for the wrong reason,
   *  and a replacement that can only ever pass would be worse than the flake
   *  it removed. So: render a header the operator cannot see, and require the
   *  check to catch it. If this test ever starts passing because the check
   *  stopped detecting anything, the assertions above have quietly become
   *  decorative. */
  test("the render check can actually fail", async ({ page }) => {
    await page.goto(`/canvas?companyId=${CO}`);
    await page.evaluate(() => {
      const box = document.createElement("div");
      box.id = "render-probe";
      // Present in the DOM, zero box — exactly what a header collapsed by a
      // starved budget looks like.
      box.style.cssText = "height:20px;overflow:hidden;position:fixed;top:0;left:0;width:300px";
      // Pushed below a 20px window: present in the DOM, unreadable — exactly
      // what a header looks like when a starved budget overruns its panel.
      box.innerHTML = `<div style="height:200px"></div><button>PROBE 9/9 unseen</button>`;
      document.body.appendChild(box);
    });

    let caught: unknown = null;
    try {
      await assertAllVisible(page, "PROBE \\d+/\\d+ unseen", "self-test");
    } catch (e) { caught = e; }
    expect(caught, "assertAllVisible must report an unreadable header").not.toBeNull();
    expect(String(caught)).toContain("PROBE 9/9 unseen");
    // The containment branch specifically — the one that catches the real
    // ladder defect — and the measurements that make it diagnosable.
    expect(String(caught)).toContain("clipped: box");
    expect(String(caught)).toMatch(/overflow \d+px/);

    // And it must pass again once the probe is gone — otherwise it is simply
    // always failing, which is the opposite vacuity.
    await page.evaluate(() => document.getElementById("render-probe")?.remove());
    await assertAllVisible(page, "PROBE \\d+/\\d+ unseen", "self-test cleared");
  });

  /** The floor must still show the ORGANIZATION, not one sentence about it.
   *
   *  The ladder folds to a counted line when nothing fits, which is the right
   *  state — but `REGION_LABEL_PX` reserved 64px for a label that renders at
   *  29, so the fold threshold (64 + 5x34 = 234) fired at 1024x700 against
   *  ~230 of available height while the five CLOSED headers need only 170.
   *  Five departments collapsed into "12 deliverables across 5 departments"
   *  when every one of them fit.
   *
   *  Reached by direct navigation rather than through the lens walk the
   *  viewport tests do: those arrive with a taller ladder and never crossed
   *  the threshold, so they cannot see this. That is why it needs its own
   *  test — I added the assertion to the viewport loop first and it passed
   *  with the bug reinstated, which proves only that the loop is blind to it.
   *
   *  ABLATION, RUN: forcing `labelPx = REGION_LABEL_PX` folds the ladder here
   *  and fails this test. */
  test("floor 1024x700: the ladder shows its departments rather than folding", async ({ page }) => {
    await page.setViewportSize({ width: 1024, height: 700 });
    await page.goto(`/canvas?companyId=${CO}`);
    await page.getByRole("button", { name: "Work", exact: true }).click();

    const headers = page.getByRole("button", { name: /\d+\/\d+ done/ });
    await expect(headers, "every department is present and counted").toHaveCount(5);
    await expect(page.getByText(/open a desk to see them/)).toHaveCount(0);
    // And they are all readable, not clipped into the panel's hidden overflow.
    await assertAllVisible(page, "\\d+/\\d+ done", "floor · direct");
    await assertFits(page, "floor · direct");
  });

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
