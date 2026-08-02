/** Headline snapshots — delta-since-you-last-looked.
 *
 *  When a layout is served, the route snapshots one headline number per
 *  bound cell (via app.inject against the same endpoints the client will
 *  fetch — the server never invents a value, it caches truth). On the next
 *  serve of the same signature, the PRIOR snapshot rides along on the turn,
 *  and cells render "▲ 40.1k since 07-29 14:02".
 *
 *  Deliberately one number per binding: the headline, not the payload.
 *  Bindings with no meaningful scalar (activity feeds, MC reports — static
 *  after finalize) take no snapshot. Extraction failures skip the cell;
 *  snapshots degrade, they never block a compose. */

import type { CatalogKey } from "./catalog.js";

type Extract = (json: any) => number | null;

const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);

export const HEADLINES: Partial<Record<CatalogKey, Extract>> = {
  "token-usage": (j) => num((j?.usage?.total?.input_tokens ?? NaN) + (j?.usage?.total?.output_tokens ?? NaN)),
  "token-budget": (j) => num(j?.used),
  "manifest": (j) => num(j?.manifest?.goal?.current),
  "kpis": (j) => num(j?.kpis?.[0]?.currentValue),
  "ignition": (j) => num(j?.agentsWorking),
  "redundancy": (j) => (Array.isArray(j?.all_slots) ? j.all_slots.filter((s: any) => !s.muted).length : null),
  "runtime-dashboard": (j) => num(j?.dashboard?.agents?.running),
  "runtime-live-runs": (j) => (Array.isArray(j?.runs) ? j.runs.length : null),
  "runtime-approvals": (j) => (Array.isArray(j?.approvals) ? j.approvals.length : null),
};

export interface Snapshot {
  taken_at: string;
  /** cellId → headline value at taken_at */
  values: Record<string, number>;
}
