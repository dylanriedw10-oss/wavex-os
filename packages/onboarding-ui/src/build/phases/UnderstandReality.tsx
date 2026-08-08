/** Phase 2 — Understand Reality. Connectors appear on the canvas as hollow
 *  markers, check off as the vault confirms them, and condense — once,
 *  forever — when everything the plan requires is wired.
 *
 *  The CredentialDrawer is reused WHOLE (it owns vault/test/skip/OAuth);
 *  this phase only decides when it's open and watches the poll for the
 *  condensation moment. */

import { useEffect, useRef, useState } from "react";
import { CredentialDrawer } from "../../wavex-os/components/CredentialDrawer";
import { COPY } from "../copy";
import { ConnectorConstellation, summarize, useConnectorCredentials } from "../canvas/ConnectorConstellation";
import { CondensedConnectors } from "../canvas/CondensedConnectors";

const REDUCE = typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;

export function UnderstandReality({ companyId, loading, condensed, onCondensed }: {
  companyId: string;
  /** True while the connector manifest is being generated server-side. */
  loading: boolean;
  /** The sticky bit — once true, only the one-line indicator ever renders. */
  condensed: boolean;
  onCondensed: () => void;
}) {
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [condensing, setCondensing] = useState(false);
  const q = useConnectorCredentials(companyId, !condensed);
  const summary = summarize(q.data?.connectors ?? []);
  const firedRef = useRef(false);

  // The condensation moment: every required connector resolved. With zero
  // required, condensation waits for the explicit continue — the operator
  // should still SEE what was suggested before it folds.
  useEffect(() => {
    if (condensed || firedRef.current || drawerOpen) return;
    if (summary.requiredTotal > 0 && summary.allRequiredResolved) {
      firedRef.current = true;
      setCondensing(true);
      window.setTimeout(() => onCondensed(), REDUCE ? 0 : 460);
    }
  }, [condensed, drawerOpen, summary.requiredTotal, summary.allRequiredResolved, onCondensed]);

  if (condensed) {
    return (
      <div style={{ height: "100%", display: "grid", placeItems: "center" }}>
        <CondensedConnectors wired={summary.wired} deferred={summary.deferred} onManage={() => setDrawerOpen(true)} />
        {drawerOpen && (
          <CredentialDrawer companyId={companyId} onDone={() => setDrawerOpen(false)} onCancel={() => setDrawerOpen(false)} />
        )}
      </div>
    );
  }

  return (
    <div style={{ height: "100%", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: "var(--space-4)" }}>
      {loading ? (
        <span className="text-dim cv-breathe" style={{ fontSize: "var(--text-sm)" }}>
          reading what already exists around the company…
        </span>
      ) : (
        <>
          <ConnectorConstellation
            companyId={companyId}
            companyTitle={companyId}
            onOpenDrawer={() => setDrawerOpen(true)}
            condensing={condensing}
          />
          {summary.requiredTotal === 0 && (
            <button className="secondary" onClick={() => { setCondensing(true); window.setTimeout(() => onCondensed(), REDUCE ? 0 : 460); }}
              style={{ fontSize: "var(--text-xs)", padding: "5px 14px", minHeight: 32 }}>
              Nothing required — continue →
            </button>
          )}
          {summary.requiredTotal > 0 && (
            <span className="text-dim" style={{ fontSize: "var(--text-xs)" }}>
              {summary.requiredResolved} of {summary.requiredTotal} required wired — click a marker to wire it
            </span>
          )}
        </>
      )}
      {drawerOpen && (
        <CredentialDrawer companyId={companyId} onDone={() => setDrawerOpen(false)} onCancel={() => setDrawerOpen(false)} />
      )}
    </div>
  );
}
