/** Connector reads — the interface, and an honest account of the gap.
 *
 *  ── What is actually true today ─────────────────────────────────────────
 *  No wired connector can read anything. `readCredential` has seven call
 *  sites and every one is a liveness probe; probe results become
 *  `credential_audit_log` rows rendered as UI badges. No probe result gates
 *  work, seeds a KPI, or unlocks a data read. The fleet's MCP config is
 *  `{"mcpServers":{}}` for every tenant because `KNOWN_MCP_SERVERS` maps all
 *  seventeen connector ids to `null`.
 *
 *  So "wired" means the vendor's auth endpoint answered. Nothing more.
 *
 *  ── Why this file exists anyway ─────────────────────────────────────────
 *  Because the gap should live in the type system rather than in a paragraph
 *  someone has to remember. Every capability that depends on reading a
 *  connected system routes through here and gets back an explicit
 *  `unavailable` with a reason. When a real read is implemented, ONE entry in
 *  the registry changes and every consumer picks it up — no capability rule
 *  is rewritten, no route changes, no schema moves.
 *
 *  This is the difference between "we haven't built it" and "we have no place
 *  to put it". */

import type { VaultConnectorState } from "./capability-model.js";

/** What a read attempt produced. There is no third state where a value is
 *  returned without provenance — a number with no source is precisely the
 *  thing this architecture refuses. */
export type ReadResult =
  | { ok: true; value: number; at: string; connectorId: string }
  | { ok: false; reason: "not_wired" | "no_reader_implemented" | "probe_failed"; detail: string };

/** A reader knows how to turn one connector into one canonical KPI value.
 *
 *  `implemented: false` is the honest default and the whole point of the
 *  shape: the registry enumerates what COULD be read, so the system can say
 *  "connecting Stripe would make MRR measurable" without pretending it
 *  already does. */
export interface ConnectorReader {
  connectorId: string;
  /** Canonical KPI ids from `kpi-registry.ts`. Never short aliases. */
  provides: string[];
  implemented: boolean;
  /** Present only when `implemented`. Absent is not an oversight — it is the
   *  current state of every entry in this file. */
  read?: (companyId: string, kpiId: string) => Promise<ReadResult>;
  /** What an operator is told this connector would buy them. */
  wouldProvide: string;
}

/** Every connector that could serve a goal KPI, and whether it does.
 *
 *  Spelled with ids that exist in the credential schema, so this table and
 *  the vault cannot drift apart the way three stage vocabularies did. */
export const READERS: ConnectorReader[] = [
  {
    connectorId: "stripe", implemented: false,
    provides: ["monthly_recurring_revenue", "nrr", "grr", "cac_payback_months"],
    wouldProvide: "Real revenue, renewals and churn — replacing a typed baseline with a measured one.",
  },
  {
    connectorId: "hubspot", implemented: false,
    provides: ["win_rate", "sales_cycle_days", "cac"],
    wouldProvide: "The pipeline: what is open, what closed, and how long it took.",
  },
  {
    connectorId: "mixpanel", implemented: false,
    provides: ["activation_rate"],
    wouldProvide: "Whether new users reach value, and where they stop.",
  },
  {
    connectorId: "google-analytics", implemented: false,
    provides: ["cac", "ltv_cac_ratio"],
    wouldProvide: "Which channel produced which customer.",
  },
];

/** Can the goal's KPI be read from anything this company has wired?
 *
 *  Today this returns `no_reader_implemented` for every company that has
 *  wired the right connector, and `not_wired` for everyone else. Both are
 *  honest, and they are DIFFERENT — one is a gap in the product, the other is
 *  a gap in the setup, and telling an operator to connect Stripe when Stripe
 *  is already connected would be the worse failure. */
export async function readKpi(
  companyId: string, kpiId: string, vault: VaultConnectorState[] | null,
): Promise<ReadResult> {
  const candidates = READERS.filter((r) => r.provides.includes(kpiId));
  if (candidates.length === 0) {
    return { ok: false, reason: "no_reader_implemented", detail: `No connector in the registry provides ${kpiId.replace(/_/g, " ")}.` };
  }
  const wiredIds = new Set((vault ?? []).filter((v) => v.status === "vaulted_valid").map((v) => v.connectorId));
  const wired = candidates.filter((r) => wiredIds.has(r.connectorId));

  if (wired.length === 0) {
    return {
      ok: false, reason: "not_wired",
      detail: `Connect ${candidates.map((c) => c.connectorId).join(" or ")} and ${kpiId.replace(/_/g, " ")} becomes measurable.`,
    };
  }
  const live = wired.find((r) => r.implemented && r.read);
  if (!live) {
    return {
      ok: false, reason: "no_reader_implemented",
      detail: `${wired.map((w) => w.connectorId).join(", ")} ${wired.length === 1 ? "is" : "are"} connected, but WaveX cannot read from ${wired.length === 1 ? "it" : "them"} yet — every credential read in the product today is a liveness probe.`,
    };
  }
  return live.read!(companyId, kpiId);
}

/** Which connectors would make this KPI measurable. Used to route a question
 *  to a CONNECTOR rather than to the operator — the discipline that keeps
 *  organizational curiosity from becoming a backlog for the founder. */
export function whatWouldMeasure(kpiId: string): ConnectorReader[] {
  return READERS.filter((r) => r.provides.includes(kpiId));
}
