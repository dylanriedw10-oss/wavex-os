/** KPI unification — one canonical namespace, and the never-filled owner
 *  columns finally populated from bundle_workflows at bridge time. */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { sql } from "drizzle-orm";
import { canonicalKpiId, KPI_ALIASES } from "../src/lib/kpi-registry.js";

describe("canonicalKpiId", () => {
  it("joins the two namespaces on mrr", () => {
    expect(canonicalKpiId("mrr")).toBe("monthly_recurring_revenue");
    expect(canonicalKpiId("monthly_recurring_revenue")).toBe("monthly_recurring_revenue");
  });
  it("passes ids that never diverged straight through", () => {
    expect(canonicalKpiId("burn_multiple")).toBe("burn_multiple");
    expect(canonicalKpiId("cac_payback_months")).toBe("cac_payback_months");
    expect(canonicalKpiId("not_a_kpi")).toBe("not_a_kpi");
  });
  it("keeps the alias map narrow — only real divergences", () => {
    expect(Object.keys(KPI_ALIASES)).toEqual(["mrr"]);
  });
});

describe("bridgeKpis owner population", () => {
  let tempDir: string;

  const agent = (status: string, reports_to: string | null) => ({
    status, adapter: "claude-code", heartbeat: "1h", budget_monthly_usd: 100,
    skill_overlay: null, department: "x", level: "L·III", reports_to, spawnable: false,
  });

  /** cro active; cpo active but cpo.growth parked; cfo entirely absent.
   *  bundle owners: pipeline_velocity → cro (mrr via short id, win_rate),
   *  insight_activation → cpo.growth (activation_rate → falls back to cpo),
   *  unit_economics → cfo (burn_multiple → no active root, stays null). */
  const MANIFEST = {
    org_id: "kpi-co",
    pillar_responses: { pillar_1: { manual_context: "fixture" } },
    swarm_manifest: {
      agents: {
        ceo: agent("active", null),
        cro: agent("active", "ceo"),
        cpo: agent("active", "ceo"),
        "cpo.growth": agent("parked", "cpo"),
      },
    },
    workflow_manifest: {
      bundle_workflows: {
        insight_activation: { owner: "cpo.growth", cycle_length: "2w", participating_agents: [], kpis_moved: ["activation_rate"] },
        pipeline_velocity: { owner: "cro", cycle_length: "1w", participating_agents: [], kpis_moved: ["cac", "win_rate", "mrr"] },
        unit_economics: { owner: "cfo", cycle_length: "1m", participating_agents: [], kpis_moved: ["burn_multiple", "cac_payback_months"] },
      },
    },
  };

  beforeAll(async () => {
    tempDir = mkdtempSync(join(tmpdir(), "kpi-owners-test-"));
    process.env.WAVEX_OS_STATE_DIR = tempDir;
    process.env.WAVEX_DB_DATA_DIR = join(tempDir, "db");
    const { _resetDbCache, runMigrations } = await import("@wavex-os/db");
    _resetDbCache();
    await runMigrations();
  });

  afterAll(async () => {
    const { _resetDbCache } = await import("@wavex-os/db");
    _resetDbCache();
    delete process.env.WAVEX_OS_STATE_DIR;
    delete process.env.WAVEX_DB_DATA_DIR;
    rmSync(tempDir, { recursive: true, force: true });
  });

  it("fills ownerRole/kpiOwnerAgentId from bundle owners, with fallbacks", async () => {
    const { getDb, companyKpis } = await import("@wavex-os/db");
    const { bridgeKpis } = await import("../src/bridge/finalize-bridge.js");
    const { agentIdForSlot } = await import("../src/bridge/catalog.js");
    const db = await getDb();

    const r = await bridgeKpis(MANIFEST as never, "kpi-co", db);
    expect(r.kpis).toBe(4);

    const rows = await db.select().from(companyKpis).where(sql`${companyKpis.companyId} = ${"kpi-co"}`);
    const byId = new Map(rows.map((row) => [row.kpiId, row]));

    // mrr moved by pipeline_velocity via the SHORT id — the alias joins it.
    const mrr = byId.get("monthly_recurring_revenue");
    expect(mrr?.ownerRole).toBe("cro");
    expect(mrr?.kpiOwnerAgentId).toBe(agentIdForSlot("kpi-co", "cro"));

    // cac: same bundle, same owner.
    expect(byId.get("cac")?.ownerRole).toBe("cro");

    // burn_multiple: owner cfo is absent, no active root → honestly null.
    expect(byId.get("burn_multiple")?.ownerRole).toBeNull();

    // The parked-owner fallback and the null-owner case both warned.
    expect(r.warnings.some((w) => w.includes("cfo"))).toBe(true);
  });

  it("falls back from a parked sub-slot owner to its active root", async () => {
    const { getDb, companyKpis } = await import("@wavex-os/db");
    const { bridgeKpis } = await import("../src/bridge/finalize-bridge.js");
    const db = await getDb();

    // activation_rate is owned by parked cpo.growth in the fixture — but the
    // canonical set doesn't include activation_rate, so exercise the path by
    // adding a bundle that moves a canonical KPI under the parked owner.
    const m = {
      ...structuredClone(MANIFEST),
      workflow_manifest: {
        bundle_workflows: {
          a_first_sorted: { owner: "cpo.growth", cycle_length: "2w", participating_agents: [] as string[], kpis_moved: ["cac_payback_months"] },
        },
      },
    };

    const r = await bridgeKpis(m as never, "kpi-co", db);
    const rows = await db.select().from(companyKpis).where(sql`${companyKpis.companyId} = ${"kpi-co"}`);
    const row = rows.find((x) => x.kpiId === "cac_payback_months");
    expect(row?.ownerRole).toBe("cpo");
    expect(r.warnings.some((w) => w.includes("cpo.growth"))).toBe(true);
  });
});
