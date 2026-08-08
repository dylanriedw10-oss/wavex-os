/** The company node at genesis — the wheel's still center before any petal
 *  exists, plus the context chips that appear as facts confirm.
 *
 *  Spec deviation, recorded: Phase 1 "produces no canvas content", but the
 *  spec also places Path B's entry ON the company node — so the node must
 *  render. Resolution: context, not content. The core and the confirmed
 *  facts render; no plan artifacts do. */

import type { Pillar1Response } from "@wavex-os/plugin-onboarding";
import { OrgFlywheel } from "../../canvas/OrgFlywheel";
import { Ic } from "../../canvas/icons";
import { COPY } from "../copy";

const CHIP: React.CSSProperties = {
  display: "inline-flex", alignItems: "center", gap: 6,
  borderRadius: 9, padding: "4px 12px", minHeight: 28,
  fontSize: "var(--text-xs)", color: "var(--text-dim)",
  border: "1px solid rgba(0,0,0,0.08)", background: "var(--panel)",
};

export function CompanyCore({ companyId, pillar1, stageLabel, facePx, onAdopt, showAdopt }: {
  companyId: string | null;
  pillar1: Pillar1Response | null;
  /** Confirmed stage line (pillar 3), when it exists. */
  stageLabel: string | null;
  facePx: number;
  /** Opens the paste-URL moment in the thread. */
  onAdopt: () => void;
  showAdopt: boolean;
}) {
  const facts: Array<{ icon: string; label: string }> = [];
  if (pillar1?.industry_hint && pillar1.industry_hint !== "unknown") {
    facts.push({ icon: "layers", label: pillar1.industry_hint.replace(/_/g, " ") });
  }
  if (pillar1?.business_model_hint && pillar1.business_model_hint !== "unknown") {
    facts.push({ icon: "trend", label: pillar1.business_model_hint.replace(/_/g, " ") });
  }
  if (pillar1) {
    facts.push({ icon: "box", label: pillar1.has_product ? "existing product" : "pre-product" });
  }
  if (stageLabel) facts.push({ icon: "bars", label: stageLabel });

  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: "var(--space-3)" }}>
      <OrgFlywheel
        departments={[]}
        total={0}
        onEnter={() => {}}
        facePx={facePx}
        center={{
          eyebrow: companyId ? "Building" : "Your",
          title: companyId ?? "organization",
        }}
        // One address per fact: pre-company, the welcome copy lives in the
        // thread pane alone — the caption stays silent until there is a
        // company to caption.
        caption={
          companyId ? (
            <span className="text-dim" style={{ fontSize: "var(--text-xs)" }}>
              the wheel grows as the plan determines each department
            </span>
          ) : <span />
        }
        emptyNote={null}
      />
      {facts.length > 0 && (
        <div style={{ display: "flex", gap: "var(--space-2)", flexWrap: "wrap", justifyContent: "center", maxWidth: 480 }}>
          {facts.map((f) => (
            <span key={f.label} style={CHIP}>
              <Ic name={f.icon} size={12} color="var(--text-dim)" />
              {f.label}
            </span>
          ))}
        </div>
      )}
      {showAdopt && (
        <button className="secondary" onClick={onAdopt}
          style={{ display: "inline-flex", alignItems: "center", gap: 7, fontSize: "var(--text-xs)", padding: "5px 14px", minHeight: 32, borderRadius: 9 }}>
          <Ic name="plug" size={13} color="var(--mind)" />
          {COPY.adopt.chip}
        </button>
      )}
    </div>
  );
}
