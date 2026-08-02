/** Canvas capability catalog — validate-and-drop semantics. */
import { describe, expect, it } from "vitest";
import { INTENTS, PRIMITIVE_INTENT, THOUGHT_PRIMITIVES, validateLayout } from "../src/canvas/catalog.js";

describe("canvas catalog validateLayout", () => {
  it("passes a well-formed layout through unchanged", () => {
    const { layout, warnings } = validateLayout({
      title: "Spend",
      cells: [
        { id: "m1", type: "metric", source: { api: "token-usage", params: {} } },
        { id: "t1", type: "text", body: "Spend is concentrated in phase 4." },
      ],
    });
    expect(warnings).toEqual([]);
    expect(layout?.cells).toHaveLength(2);
  });

  it("drops a cell bound to an unknown catalog key, keeps the rest", () => {
    const { layout, warnings } = validateLayout({
      title: "X",
      cells: [
        { id: "bad", type: "metric", source: { api: "crm-pipeline", params: {} } },
        { id: "ok", type: "metric", source: { api: "token-budget", params: {} } },
      ],
    });
    expect(layout?.cells.map((c) => c.id)).toEqual(["ok"]);
    expect(warnings.length).toBe(1);
  });

  it("drops a cell whose binding does not support its type", () => {
    const { layout, warnings } = validateLayout({
      title: "X",
      cells: [{ id: "bad", type: "trend", source: { api: "token-budget", params: {} } }],
    });
    expect(layout).toBeNull();
    expect(warnings[0]).toMatch(/does not support/);
  });

  it("caps at 8 cells and records the trim", () => {
    const cells = Array.from({ length: 10 }, (_, i) => ({
      id: `c${i}`, type: "text", body: "x",
    }));
    const { layout, warnings } = validateLayout({ title: "X", cells });
    expect(layout?.cells).toHaveLength(8);
    expect(warnings.join(" ")).toMatch(/trimmed 2/);
  });

  it("nulls the layout when nothing survives, without throwing", () => {
    expect(validateLayout(null).layout).toBeNull();
    expect(validateLayout({ title: "X", cells: [{ nonsense: true }] }).layout).toBeNull();
  });
});

describe("the grammar's adjectives (variant / density / group)", () => {
  const cell = (extra: Record<string, unknown>) => ({
    title: "W",
    cells: [{ id: "m", type: "metric", source: { api: "token-budget", params: {} }, ...extra }],
  });

  it("passes a known variant through", () => {
    const { layout, warnings } = validateLayout(cell({ variant: "gauge", density: 2 }));
    expect(warnings).toEqual([]);
    expect((layout!.cells[0] as any).variant).toBe("gauge");
    expect((layout!.cells[0] as any).density).toBe(2);
  });

  it("STRIPS an unknown variant to the default — the cell survives (degrade ladder)", () => {
    const { layout, warnings } = validateLayout(cell({ variant: "holographic" }));
    expect(layout!.cells).toHaveLength(1);
    expect((layout!.cells[0] as any).variant).toBeUndefined();
    expect(warnings.join(" ")).toMatch(/stripped unknown variant "holographic"/);
  });

  it("rejects an out-of-range density at parse (cell dropped, layout survives)", () => {
    const { layout, warnings } = validateLayout({
      title: "W",
      cells: [
        { id: "bad", type: "metric", density: 9, source: { api: "token-budget", params: {} } },
        { id: "ok", type: "metric", source: { api: "token-budget", params: {} } },
      ],
    });
    expect(layout!.cells.map((c) => c.id)).toEqual(["ok"]);
    expect(warnings.length).toBe(1);
  });

  it("accepts group keys and unfold drill mode", () => {
    const { layout, warnings } = validateLayout({
      title: "W",
      cells: [{
        id: "m", type: "metric", group: "revenue", source: { api: "token-budget", params: {} },
        drill: [{ label: "Why?", prompt: "why did spend spike", mode: "unfold" }],
      }],
    });
    expect(warnings).toEqual([]);
    expect((layout!.cells[0] as any).group).toBe("revenue");
    expect((layout!.cells[0] as any).drill[0].mode).toBe("unfold");
  });

  it("every primitive maps to an intent", () => {
    for (const p of THOUGHT_PRIMITIVES) expect(INTENTS).toContain(PRIMITIVE_INTENT[p]);
  });
});
