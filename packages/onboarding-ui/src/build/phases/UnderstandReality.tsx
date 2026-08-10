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

  // THE DISTINCTION THIS PHASE TURNS ON.
  //
  // `summarize(q.data?.connectors ?? [])` gives a summary for THREE different
  // situations: the vault answered and there is nothing; the vault has not
  // answered yet; the vault request failed. All three produce
  // `requiredTotal === 0`, and that value was the sole condition for offering
  // "Nothing required — continue →" — a button whose single click sets the
  // sticky `connectorsCondensed` bit and moves the flow on to plan assembly.
  //
  // So a slow first fetch, or a 403 from the credentials endpoint, presented
  // itself as a finding about the operator's plan and handed them an
  // irreversible control to act on it. The plan would then be assembled with
  // no connectors, and the indicator afterwards would read
  // "Connectors · complete — 0 wired", which is a sentence about a question
  // nobody ever answered.
  //
  // `isSuccess` is the only state in which a claim about connectors is a
  // claim about connectors.
  const answered = q.isSuccess;

  return (
    <div style={{ height: "100%", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: "var(--space-4)" }}>
      {loading || (!answered && !q.isError) ? (
        <span className="text-dim cv-breathe" style={{ fontSize: "var(--text-sm)" }}>
          {COPY.connectors.reading}
        </span>
      ) : q.isError ? (
        // A failed read is a fact about the READ, and it says out loud that
        // nothing was skipped — because the alternative reading of a dead end
        // here is "the flow silently dropped my connectors". No continue
        // button: this branch knows nothing about what the plan requires, so
        // it has no standing to offer a skip.
        <div role="alert" style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: "var(--space-2)", maxWidth: "44ch", textAlign: "center" }}>
          <span style={{ fontSize: "var(--text-sm)", color: "var(--warning)" }}>
            {COPY.connectors.unreadable}
          </span>
          <span className="text-dim" style={{ fontSize: "var(--text-xs)" }}>
            {COPY.connectors.unreadableTail}
          </span>
          <button className="secondary" onClick={() => void q.refetch()}
            style={{ fontSize: "var(--text-xs)", padding: "5px 14px", minHeight: 32 }}>
            {COPY.connectors.retry}
          </button>
        </div>
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
              {COPY.connectors.skip}
            </button>
          )}
          {summary.requiredTotal > 0 && (
            <span className="text-dim" style={{ fontSize: "var(--text-xs)" }}>
              {COPY.connectors.progress(summary.requiredResolved, summary.requiredTotal)}
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
