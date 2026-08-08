/** The canonical KPI id namespace — one vocabulary, aliased at every boundary.
 *
 *  Two id namespaces grew independently and never joined:
 *    - SHORT ids: pillar_3.kpi_snapshot_initial keys and the static
 *      bundle_workflows `kpis_moved` (both vendored, frozen): "mrr", "cac", …
 *    - LONG ids: the DB's company_kpis rows and manifest.goal.kpiId:
 *      "monthly_recurring_revenue".
 *
 *  Canonical = the DB's long ids, because rows already persist under them and
 *  rewriting history is worse than aliasing reads. The vendored short ids are
 *  normalized through `canonicalKpiId` wherever they cross into wavex-layer
 *  code (instance KPI reads, bridgeKpis owner resolution, plan assembly).
 *
 *  The overlap is deliberately narrow — most ids are identical in both
 *  namespaces ("burn_multiple", "cac_payback_months", "win_rate"). Aliases
 *  are added here ONLY when the two vocabularies actually disagree. */

export const KPI_ALIASES: Record<string, string> = {
  mrr: "monthly_recurring_revenue",
};

/** Normalize any KPI id (short or long) to the canonical long form. Unknown
 *  ids pass through unchanged — this is a spelling shim, not a validator. */
export function canonicalKpiId(id: string): string {
  return KPI_ALIASES[id] ?? id;
}

/** Display + owner-resolution priority. When one bundle owner must be chosen
 *  for a KPI that several bundles move, iterate in this order so the pick is
 *  stable across runs (never dependent on object-key enumeration). */
export const CANONICAL_KPI_ORDER: string[] = [
  "monthly_recurring_revenue",
  "nrr",
  "grr",
  "burn_multiple",
  "cac",
  "cac_payback_months",
  "ltv_cac_ratio",
  "activation_rate",
  "win_rate",
  "sales_cycle_days",
  "narrative_strength",
];
