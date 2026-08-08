/** The connector constellation — Phase 2's canvas: what already exists
 *  around the company, as markers orbiting the core.
 *
 *  Each required/suggested connector appears the moment it's suggested as a
 *  HOLLOW marker; wiring (vault or skip — the drawer's own contract) fills
 *  it with a check. Deferred entries are ONE counted footnote, never
 *  markers — they were deferred for a reason. Truth is the credentials
 *  poll (vault state), never mirrored into client state.
 *
 *  When every REQUIRED connector resolves, the constellation condenses —
 *  and never expands again. */

import { useQuery } from "@tanstack/react-query";
import { wavexOsOnboardingApi } from "../../wavex-os/lib/api";
import { Ic } from "../../canvas/icons";

const REDUCE = typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;

export interface ConstellationSummary {
  requiredTotal: number;
  requiredResolved: number;
  wired: number;
  deferred: number;
  allRequiredResolved: boolean;
}

export function useConnectorCredentials(companyId: string | null, active: boolean) {
  return useQuery({
    enabled: !!companyId && active,
    queryKey: ["concierge", companyId],
    queryFn: () => wavexOsOnboardingApi.listCredentials(companyId!),
    refetchInterval: active ? 4_000 : false,
  });
}

export function summarize(connectors: Array<{ bucket: string; status: string }>): ConstellationSummary {
  const resolved = (s: string) => s === "vaulted_valid" || s === "vaulted_unvalidated" || s === "skipped";
  const required = connectors.filter((c) => c.bucket === "required");
  const markers = connectors.filter((c) => c.bucket !== "deferred");
  return {
    requiredTotal: required.length,
    requiredResolved: required.filter((c) => resolved(c.status)).length,
    wired: markers.filter((c) => resolved(c.status)).length,
    deferred: connectors.filter((c) => c.bucket === "deferred").length,
    allRequiredResolved: required.every((c) => resolved(c.status)),
  };
}

export function ConnectorConstellation({ companyId, companyTitle, onOpenDrawer, condensing }: {
  companyId: string;
  companyTitle: string;
  /** Opens the CredentialDrawer, optionally scoped by the clicked marker. */
  onOpenDrawer: () => void;
  /** True while the condensation motion plays — markers glide home. */
  condensing: boolean;
}) {
  const q = useConnectorCredentials(companyId, true);
  const connectors = q.data?.connectors ?? [];
  const markers = connectors.filter((c) => c.bucket !== "deferred");
  const deferredCount = connectors.filter((c) => c.bucket === "deferred").length;
  const resolved = (s: string) => s === "vaulted_valid" || s === "vaulted_unvalidated" || s === "skipped";

  // Orbital geometry: markers on a ring around a small core. The ring is
  // sized to the marker count; labels sit under each marker.
  const R = 170;
  const size = 2 * (R + 70);
  const c = size / 2;

  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: "var(--space-3)" }}>
      <div style={{ position: "relative", width: size, height: size, flexShrink: 0 }}>
        {/* the orbit hairline */}
        <svg width={size} height={size} aria-hidden style={{ position: "absolute", inset: 0 }}>
          <circle cx={c} cy={c} r={R} fill="none" stroke="rgba(0,0,0,0.07)" strokeWidth={1} strokeDasharray="2 6" />
        </svg>
        {/* the core */}
        <div className="cv-glass cv-glass--solid" style={{
          position: "absolute", left: c - 56, top: c - 56, width: 112, height: 112,
          borderRadius: "50%", display: "grid", placeItems: "center", textAlign: "center",
          background: "radial-gradient(120% 120% at 50% 28%, #FFFFFF 40%, #F0EFEA 100%)",
        }}>
          <span style={{ fontWeight: 600, fontSize: "var(--text-sm)", maxWidth: 96, overflow: "hidden", textOverflow: "ellipsis" }}>
            {companyTitle}
          </span>
        </div>
        {/* markers */}
        {markers.map((m, i) => {
          const angle = -Math.PI / 2 + (i / Math.max(markers.length, 1)) * 2 * Math.PI;
          const x = c + R * Math.cos(angle);
          const y = c + R * Math.sin(angle);
          const done = resolved(m.status);
          return (
            <button key={m.connectorId} onClick={onOpenDrawer}
              aria-label={`${m.connectorId} — ${done ? "wired" : "not wired yet"}`}
              title={m.rationale}
              style={{
                all: "unset", cursor: "pointer", position: "absolute",
                left: x - 34, top: y - 26, width: 68, textAlign: "center",
                display: "flex", flexDirection: "column", alignItems: "center", gap: 4,
                // Condensation: everything glides to the core and fades —
                // the list is about to become one line, forever.
                transition: REDUCE ? undefined : "transform 420ms var(--ease), opacity 320ms var(--ease)",
                transform: condensing ? `translate(${c - x}px, ${c - y}px) scale(0.4)` : undefined,
                opacity: condensing ? 0 : 1,
              }}>
              <span style={{
                width: 34, height: 34, borderRadius: "50%", display: "grid", placeItems: "center",
                background: done ? "color-mix(in srgb, var(--good) 10%, #FFFFFF)" : "var(--panel)",
                border: done ? "1.5px solid color-mix(in srgb, var(--good) 45%, transparent)" : "1.5px dashed rgba(0,0,0,0.22)",
                transition: "border 200ms var(--ease), background 200ms var(--ease)",
              }}>
                {done
                  ? <Ic name="check" size={15} color="var(--good)" />
                  : <Ic name="plug" size={14} color="var(--text-dim)" />}
              </span>
              <span style={{
                fontSize: "var(--text-xs)", fontWeight: 600,
                color: done ? "var(--text)" : "var(--text-dim)",
                overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", maxWidth: 68,
              }}>
                {m.connectorId}
              </span>
              {m.bucket === "required" && !done && (
                <span style={{ fontSize: 9, letterSpacing: ".08em", textTransform: "uppercase", color: "var(--attend)" }}>required</span>
              )}
            </button>
          );
        })}
      </div>
      {/* Operational truths render even when empty; the deferred tail is a
          counted footnote — accumulated, silent at zero. */}
      {markers.length === 0 && !q.isLoading && (
        <span className="text-dim" style={{ fontSize: "var(--text-sm)" }}>
          Nothing to wire — this plan reads no external systems yet.
        </span>
      )}
      {deferredCount > 0 && (
        <span className="text-dim" style={{ fontSize: "var(--text-xs)" }}>
          {deferredCount} deferred — not needed for this plan
        </span>
      )}
    </div>
  );
}
