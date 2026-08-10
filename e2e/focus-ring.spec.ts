/** The focus ring must survive the buttons that dress themselves down.
 *
 *  Nineteen controls turned `<button>` into a row, chip, marker or bare label
 *  with an inline `all: "unset"` — correct, because the thing IS a control and
 *  must stay keyboard-reachable, but `all: unset` also resets `outline-style`
 *  to `none`, and an INLINE declaration outranks every author stylesheet rule.
 *  So `.canvas-root :focus-visible { outline: 2px solid --mind@60%; offset 2px }`
 *  could never paint on any of them. Focus moved across the connector markers,
 *  the canvas sub-dials and every "+N more" clamp with nothing visible at all.
 *
 *  This spec exists because the console CANNOT measure it: `:focus-visible`
 *  does not match programmatic `.focus()`, only a real keyboard-driven focus.
 *  Playwright's Tab is the only instrument that sees the truth here, which is
 *  also why the bug survived so long.
 *
 *  TWO-SIDED via a live probe: the same page gets a control WITH the prelude
 *  and one with a raw `all: unset`, and the raw one must still be ringless.
 *  That is what keeps this test honest if someone later adds a global
 *  `!important` focus rule — it would paper over the defect everywhere and
 *  this spec would go on passing for the wrong reason. The negative control
 *  catches that.
 *
 *  ABLATION, RUN: reverting BARE_CONTROL to a bare `{ all: "unset" }` fails
 *  the SECOND test and leaves the first passing — correctly, and worth being
 *  precise about. The probe writes its inline style as a literal, so it pins
 *  the CASCADE MECHANISM and is deliberately independent of the app constant.
 *  The second test is the one that pins that the shipped tree uses it. Two
 *  different claims; only one of them is about our code.
 */

import { test, expect } from "@playwright/test";

const RING = /solid/;

test.describe("focus is visible on the controls that unset everything", () => {
  test.skip(!process.env.WAVEX_E2E_FIXTURE_ENGINE, "needs the fixture engine — run with WAVEX_E2E_FIXTURE_ENGINE=1");

  test("BARE_CONTROL restores the ring; a raw all:unset still kills it", async ({ page }) => {
    await page.goto("/build");

    // A live probe on the real page, under the real stylesheet, so this
    // measures the cascade rather than a mock of it.
    await page.evaluate(() => {
      const root = document.createElement("div");
      root.className = "canvas-root";
      root.id = "probe";
      root.innerHTML = `
        <button id="anchor">anchor</button>
        <button id="withPrelude" style="all: unset; outline: revert-layer; outline-offset: revert-layer">dressed down, ring kept</button>
        <button id="rawUnset" style="all: unset">dressed down, ring lost</button>`;
      document.body.appendChild(root);
      (document.getElementById("anchor") as HTMLElement).focus();
    });

    const read = async () => page.evaluate(() => {
      const el = document.activeElement as HTMLElement;
      const cs = getComputedStyle(el);
      return { id: el.id, focusVisible: el.matches(":focus-visible"), style: cs.outlineStyle, width: cs.outlineWidth, offset: cs.outlineOffset };
    });

    await page.keyboard.press("Tab");
    const kept = await read();
    expect(kept.id).toBe("withPrelude");
    expect(kept.focusVisible, "Tab must produce :focus-visible or this spec measures nothing").toBe(true);
    expect(kept.style, "the prelude must win the ring back").toMatch(RING);
    expect(kept.width).toBe("2px");
    expect(kept.offset, "the 2px offset is part of the law and all:unset flattens it too").toBe("2px");

    // THE NEGATIVE CONTROL. If this ever starts passing, the ring is being
    // restored by something global and this spec has stopped proving the
    // prelude does anything.
    await page.keyboard.press("Tab");
    const lost = await read();
    expect(lost.id).toBe("rawUnset");
    expect(lost.style, "a raw all:unset must STILL kill the ring — otherwise this test proves nothing").toBe("none");
  });

  test("a real control in the app — the connector marker — has a visible ring", async ({ page }) => {
    await page.route("**/wavex-os/onboarding/credentials/**", (route) =>
      route.fulfill({
        status: 200, contentType: "application/json",
        body: JSON.stringify({ ok: true, companyId: "pw-focus", connectors: [
          { connectorId: "stripe", bucket: "required", status: "pending", rationale: "revenue" },
        ] }),
      }));
    await page.addInitScript(() => {
      localStorage.setItem("wavex-os-build-v3:pw-focus", JSON.stringify({
        phase: { kind: "connectors", stage: "wiring", loading: false },
        thread: [], adoptedProductUrl: null, connectorsCondensed: false, planRun: null, draft: {},
      }));
    });
    await page.goto("/build?companyId=pw-focus");

    const marker = page.getByRole("button", { name: /stripe/ });
    await expect(marker).toBeVisible();

    // Tab until the marker really has focus. Programmatic .focus() will not
    // set :focus-visible, so the ring can only be MEASURED by arriving from
    // the keyboard the way an operator would.
    let landed = false;
    for (let i = 0; i < 25 && !landed; i++) {
      await page.keyboard.press("Tab");
      landed = await marker.evaluate((el) => el === document.activeElement);
    }
    expect(landed, "the connector marker must be reachable by Tab at all").toBe(true);

    const ring = await marker.evaluate((el) => {
      const cs = getComputedStyle(el);
      return { focusVisible: el.matches(":focus-visible"), style: cs.outlineStyle, width: cs.outlineWidth, offset: cs.outlineOffset };
    });
    expect(ring.focusVisible).toBe(true);
    // A real control in the shipped tree, measured — not "the style string
    // contains the right word", which is what an earlier version of this
    // asserted and is a claim about source rather than about pixels.
    expect(ring.style).toMatch(RING);
    expect(ring.width).toBe("2px");
    expect(ring.offset).toBe("2px");
  });
});
