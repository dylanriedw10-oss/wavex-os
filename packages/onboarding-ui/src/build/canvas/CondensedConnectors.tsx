/** The condensed connector indicator — one line, forever.
 *
 *  Spec: "once every connector this plan needs is checked, the whole list
 *  condenses into a single 'connectors: complete' indicator — it never
 *  expands back out once condensed." It never does. The ONE drill opens the
 *  CredentialDrawer (recorded deviation: without it, wiring a suggested
 *  connector after condensation would be stranded — the LIST never returns,
 *  the drawer remains the escape hatch). */

import { Ic } from "../../canvas/icons";
import { COPY } from "../copy";

export function CondensedConnectors({ wired, deferred, onManage }: {
  wired: number;
  deferred: number;
  onManage: () => void;
}) {
  return (
    <div className="cv-paper" style={{
      display: "inline-flex", alignItems: "center", gap: 10,
      padding: "8px 16px", borderRadius: "var(--radius-lg)",
    }}>
      <Ic name="check" size={14} color="var(--good)" />
      <span style={{ fontSize: "var(--text-sm)", fontWeight: 600 }}>
        {COPY.connectors.condensed(wired, deferred)}
      </span>
      <button onClick={onManage}
        style={{ all: "unset", cursor: "pointer", fontSize: "var(--text-xs)", color: "var(--text-dim)", minHeight: 24, paddingLeft: 6 }}>
        {COPY.connectors.manage} →
      </button>
    </div>
  );
}
