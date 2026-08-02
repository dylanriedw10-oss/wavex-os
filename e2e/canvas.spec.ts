/** Canvas e2e — the full loop on the deterministic stub path:
 *  morning screen → ask → workspace → proposal → commit → ledger. */
import { test, expect } from "@playwright/test";

const CO = `e2e-canvas-${Date.now().toString(36)}`;

test.describe("cognitive canvas", () => {
  test("morning screen shows greeting, attention — and the org at rest", async ({ page }) => {
    await page.goto(`/canvas?companyId=${CO}-fresh`);
    await expect(page.getByText("Good to see you.")).toBeVisible();
    await expect(page.getByText("Needs you", { exact: true })).toBeVisible();
    await expect(page.getByLabel("Message the canvas")).toBeVisible();
    // The workspace pane's resting state IS the organization.
    await expect(page.getByRole("button", { name: /Constitution — identity and law/ })).toBeVisible();
  });

  test("the org is home: workspace takes the pane, Minimize returns to the org", async ({ page, request }) => {
    const co = `${CO}-home`;
    await request.post(`/api/instance/${co}/canvas`, { data: { message: "show me the team", skipInference: true } });

    await page.goto(`/canvas?companyId=${co}`);
    // Hydration lands on the remembered workspace...
    await expect(page.getByRole("heading", { name: "Team" })).toBeVisible();

    // ...Minimize steps it back to the board and the org takes the pane.
    await page.getByRole("button", { name: "Minimize workspace to the board" }).click();
    await expect(page.getByRole("button", { name: /Constitution — identity and law/ })).toBeVisible();
    await expect(page.getByText("On the board", { exact: true })).toBeVisible();

    // The board chip restores the workspace in place.
    await page.getByRole("button", { name: /Team 1 thought/ }).click();
    await expect(page.getByRole("heading", { name: "Team" })).toBeVisible();
  });

  test("ask → workspace composes; proposal → commit → ledger", async ({ page, request }) => {
    // Seed via API on the stub path so the test is deterministic.
    const base = `/api/instance/${CO}/canvas`;
    await request.post(base, { data: { message: "why did spend spike?", skipInference: true } });
    await request.post(base, { data: { message: "set the token budget to 75k", skipInference: true } });

    await page.goto(`/canvas?companyId=${CO}`);
    await expect(page.getByRole("heading", { name: "Token spend" })).toBeVisible();
    await expect(page.getByText("PROPOSAL", { exact: false })).toBeVisible();

    await page.getByRole("button", { name: "Confirm" }).click();
    await expect(page.getByText(/^Done — Set the token budget cap/)).toBeVisible();

    await page.getByRole("button", { name: /Decisions \(1\)/ }).click();
    await expect(page.getByText("committed")).toBeVisible();
  });

  test("every pending proposal renders, and confirming one applies that one", async ({ page, request }) => {
    const co = `${CO}-multi`;
    const base = `/api/instance/${co}/canvas`;
    await request.post(base, { data: { message: "set the token budget to 80k", skipInference: true } });
    await request.post(base, { data: { message: "set the token budget to 90k", skipInference: true } });

    await page.goto(`/canvas?companyId=${co}`);
    // Both cards visible — a new proposal must never hide behind a stale one.
    await expect(page.getByRole("button", { name: "Confirm" })).toHaveCount(2);

    // Confirm the SECOND (newest); the first must stay pending.
    await page.getByRole("button", { name: "Confirm" }).nth(1).click();
    await expect(page.getByText(/^Done — Set the token budget cap to 90,000/)).toBeVisible();
    await expect(page.getByRole("button", { name: "Confirm" })).toHaveCount(1);
  });

  test("keep → the workspace answer lands in org memory, visible in Learned", async ({ page, request }) => {
    const co = `${CO}-keep`;
    await request.post(`/api/instance/${co}/canvas`, { data: { message: "why did spend spike?", skipInference: true } });

    await page.goto(`/canvas?companyId=${co}`);
    await expect(page.getByRole("heading", { name: "Token spend" })).toBeVisible();
    await page.getByRole("button", { name: /Keep this workspace/ }).click();
    // aria-label stays fixed; the visible text flips to Kept ✓.
    await expect(page.getByRole("button", { name: /Keep this workspace/ })).toHaveText(/Kept ✓/);

    // Home → Learned: the promoted claim is there, cited from the canvas.
    await page.getByRole("button", { name: "Organization", exact: true }).click();
    await page.getByRole("button", { name: "Learned", exact: true }).click();
    // The claim shows in the org-wide Learned view AND the node's own list.
    await expect(page.getByText(/Token spend — /).first()).toBeVisible();
    await expect(page.getByText(/1 citation/).first()).toBeVisible();
  });

  test("pin → restore recalls the exact workspace by signature; unpin removes it", async ({ page, request }) => {
    const co = `${CO}-pins`;
    const base = `/api/instance/${co}/canvas`;
    await request.post(base, { data: { message: "show me the team", skipInference: true } });

    await page.goto(`/canvas?companyId=${co}`);
    await expect(page.getByRole("heading", { name: "Team" })).toBeVisible();
    await page.getByRole("button", { name: "Pin", exact: true }).click();
    await expect(page.getByRole("button", { name: "Team", exact: true })).toBeVisible();

    // Restore goes through the conversation path but is signature-addressed.
    await page.getByRole("button", { name: "Team", exact: true }).click();
    await expect(page.getByText(/Here's team again — same view as last time\./)).toBeVisible();
    await expect(page.getByRole("heading", { name: "Team" })).toBeVisible();

    await page.getByRole("button", { name: "Unpin Team" }).click();
    await expect(page.getByRole("button", { name: "Team", exact: true })).toHaveCount(0);
  });
});
