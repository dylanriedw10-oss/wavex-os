/** Refinement Panel — post-finalize T2 guidance loop.
 *
 *  After the imprint stream completes in Theater Act 3, the operator can
 *  type prose like "emphasize international distribution and add observability
 *  for the dealer channel" and T2 proposes structural changes (new connectors,
 *  workflow patches, swarm overlays). The operator checks the ones they want
 *  and applies — manifest is re-signed in place. Operator can iterate
 *  multiple times before "Let's launch", with revert support.
 *
 *  Closes the only meaningful inference-quality gap vs the legacy wizard.
 *  Backend routes already exist; just plumbing the UI here. */

import { useState } from "react";
import type { CompanyManifest } from "@wavex-os/plugin-onboarding";
import { wavexOsOnboardingApi, ApiError } from "../lib/api";

interface ProposedChange {
  id: string;
  action:
    | "connector_add"
    | "connector_promote"
    | "swarm_overlay"
    | "workflow_task_add"
    | "workflow_escalation_add";
  rationale: string;
  pillar_signal?: string;
  connector_id?: string;
  bucket?: "required" | "suggested" | "deferred";
  priority?: "P-1" | "P0" | "P1" | "P2";
  from_bucket?: "deferred" | "suggested";
  to_bucket?: "suggested" | "required";
  slot?: string;
  new_overlay?: string;
  task?: { task: string; tier?: string; flow_type?: string; connector?: string | null; dry_run_gate?: boolean };
  on?: string;
  to?: string;
}

interface Props {
  companyId: string;
  /** Called when refinement is applied — parent gets the new signed manifest
   *  so it can replace the streaming imprint with the refined version. */
  onApplied: (manifest: CompanyManifest, sha256: string) => void;
  /** Called when operator dismisses the refinement panel without applying. */
  onSkip: () => void;
}

export function RefinementPanel({ companyId, onApplied, onSkip }: Props) {
  const [guidance, setGuidance] = useState("");
  const [analyzing, setAnalyzing] = useState(false);
  const [analysis, setAnalysis] = useState<{
    changes: ProposedChange[];
    rationale_summary: string;
    imprint_only: boolean;
  } | null>(null);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [applying, setApplying] = useState(false);
  const [reverting, setReverting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [appliedHistory, setAppliedHistory] = useState<string[]>([]); // sha256 hashes of prior signed manifests

  const tooShort = guidance.trim().length < 3;

  async function handleAnalyze(): Promise<void> {
    if (tooShort) return;
    setAnalyzing(true);
    setError(null);
    setAnalysis(null);
    setSelectedIds(new Set());
    try {
      const r = await wavexOsOnboardingApi.analyzeRefinement({ companyId, operatorGuidance: guidance });
      setAnalysis({
        changes: r.changes as ProposedChange[],
        rationale_summary: r.rationale_summary,
        imprint_only: r.imprint_only,
      });
      // Pre-select every proposed change — operator can uncheck what they
      // don't want.
      setSelectedIds(new Set(r.changes.map((c) => c.id)));
    } catch (e) {
      setError(e instanceof ApiError ? e.message : (e as Error).message);
    } finally {
      setAnalyzing(false);
    }
  }

  async function handleApply(regenerateImprint: boolean): Promise<void> {
    if (!analysis) return;
    setApplying(true);
    setError(null);
    try {
      const picked = analysis.changes.filter((c) => selectedIds.has(c.id));
      const r = await wavexOsOnboardingApi.applyRefinement({
        companyId,
        operatorGuidance: guidance,
        changes: picked,
        regenerateImprint,
      });
      setAppliedHistory((prev) => [...prev, r.sha256]);
      setGuidance("");
      setAnalysis(null);
      setSelectedIds(new Set());
      onApplied(r.manifest, r.sha256);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : (e as Error).message);
    } finally {
      setApplying(false);
    }
  }

  async function handleRevert(): Promise<void> {
    setReverting(true);
    setError(null);
    try {
      await wavexOsOnboardingApi.revertRefinement({ companyId });
      setAppliedHistory((prev) => prev.slice(0, -1));
      setGuidance("");
      setAnalysis(null);
      setSelectedIds(new Set());
    } catch (e) {
      setError(e instanceof ApiError ? e.message : (e as Error).message);
    } finally {
      setReverting(false);
    }
  }

  return (
    <div style={{
      maxWidth: 720,
      width: "100%",
      padding: "1rem",
      background: "var(--surface)",
      border: "1px solid var(--border)",
      borderRadius: 8,
      display: "flex",
      flexDirection: "column",
      gap: "0.75rem",
    }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
        <div style={{ fontSize: 13, fontWeight: 700 }}>Refine before launch</div>
        {appliedHistory.length > 0 && (
          <button
            type="button"
            onClick={() => void handleRevert()}
            disabled={reverting}
            style={{
              fontSize: 10,
              padding: "0.2rem 0.5rem",
              borderRadius: 4,
              background: "transparent",
              color: "var(--text-dim)",
              border: "1px solid var(--border)",
              cursor: reverting ? "wait" : "pointer",
            }}
          >
            {reverting ? "Reverting…" : `↶ Revert last (${appliedHistory.length} applied)`}
          </button>
        )}
      </div>

      <textarea
        value={guidance}
        onChange={(e) => setGuidance(e.target.value)}
        rows={3}
        disabled={analyzing || applying}
        placeholder="What would you tune? e.g. 'emphasize international distribution and add observability for our dealer channel'"
        style={{
          width: "100%",
          padding: "0.55rem 0.7rem",
          borderRadius: 6,
          border: "1px solid var(--border)",
          background: "var(--bg)",
          color: "var(--text)",
          fontSize: 13,
          fontFamily: "inherit",
          resize: "vertical",
          outline: "none",
        }}
      />

      {!analysis && (
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <button
            type="button"
            onClick={onSkip}
            style={{
              fontSize: 11,
              padding: "0.3rem 0.7rem",
              borderRadius: 4,
              background: "transparent",
              color: "var(--text-dim)",
              border: "1px solid var(--border)",
              cursor: "pointer",
            }}
          >
            Skip — looks good as-is
          </button>
          <button
            type="button"
            onClick={() => void handleAnalyze()}
            disabled={tooShort || analyzing}
            style={{
              padding: "0.4rem 0.85rem",
              borderRadius: 6,
              background: "var(--accent)",
              color: "var(--bg)",
              border: "none",
              fontWeight: 600,
              fontSize: 12,
              cursor: tooShort || analyzing ? "not-allowed" : "pointer",
              opacity: tooShort || analyzing ? 0.6 : 1,
            }}
          >
            {analyzing ? "Analyzing…" : "Analyze impact →"}
          </button>
        </div>
      )}

      {analysis && (
        <>
          <div className="text-dim" style={{ fontSize: 11, padding: "0.4rem 0.6rem", borderLeft: "2px solid var(--accent)", background: "var(--bg)", borderRadius: 4 }}>
            {analysis.rationale_summary}
          </div>

          {analysis.imprint_only && (
            <div className="text-dim" style={{ fontSize: 11 }}>
              Imprint-only refinement — no structural changes proposed.
            </div>
          )}

          {analysis.changes.length === 0 && (
            <div className="text-dim" style={{ fontSize: 11 }}>
              No actionable changes detected.
            </div>
          )}

          {analysis.changes.length > 0 && (
            <div style={{ display: "flex", flexDirection: "column", gap: "0.4rem", maxHeight: "30vh", overflowY: "auto" }}>
              {analysis.changes.map((c) => (
                <label
                  key={c.id}
                  style={{
                    padding: "0.5rem 0.65rem",
                    borderRadius: 4,
                    background: selectedIds.has(c.id) ? "var(--bg)" : "transparent",
                    border: `1px solid ${selectedIds.has(c.id) ? "var(--accent)" : "var(--border)"}`,
                    display: "flex",
                    gap: "0.55rem",
                    alignItems: "flex-start",
                    cursor: "pointer",
                    fontSize: 11,
                  }}
                >
                  <input
                    type="checkbox"
                    checked={selectedIds.has(c.id)}
                    onChange={(e) => {
                      setSelectedIds((prev) => {
                        const next = new Set(prev);
                        if (e.target.checked) next.add(c.id);
                        else next.delete(c.id);
                        return next;
                      });
                    }}
                    style={{ marginTop: 2 }}
                  />
                  <div style={{ flex: 1 }}>
                    <div style={{ fontWeight: 600, color: "var(--text)" }}>
                      {describeChange(c)}
                    </div>
                    <div className="text-dim" style={{ fontSize: 10, marginTop: 2, lineHeight: 1.45 }}>
                      {c.rationale}
                      {c.pillar_signal && <> · <span style={{ color: "var(--accent)" }}>{c.pillar_signal}</span></>}
                    </div>
                  </div>
                </label>
              ))}
            </div>
          )}

          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: "0.25rem" }}>
            <button
              type="button"
              onClick={() => { setAnalysis(null); setSelectedIds(new Set()); }}
              style={{
                fontSize: 11,
                padding: "0.3rem 0.7rem",
                borderRadius: 4,
                background: "transparent",
                color: "var(--text-dim)",
                border: "1px solid var(--border)",
                cursor: "pointer",
              }}
            >
              ← Try different guidance
            </button>
            <div style={{ display: "flex", gap: "0.4rem" }}>
              <button
                type="button"
                onClick={() => void handleApply(false)}
                disabled={applying || (analysis.changes.length > 0 && selectedIds.size === 0)}
                style={{
                  padding: "0.4rem 0.75rem",
                  borderRadius: 4,
                  background: "transparent",
                  color: "var(--text-dim)",
                  border: "1px solid var(--border)",
                  fontSize: 11,
                  cursor: applying ? "wait" : "pointer",
                }}
              >
                Apply only
              </button>
              <button
                type="button"
                onClick={() => void handleApply(true)}
                disabled={applying || (analysis.changes.length > 0 && selectedIds.size === 0)}
                style={{
                  padding: "0.4rem 0.85rem",
                  borderRadius: 6,
                  background: "var(--accent)",
                  color: "var(--bg)",
                  border: "none",
                  fontWeight: 600,
                  fontSize: 12,
                  cursor: applying ? "wait" : "pointer",
                  opacity: applying || (analysis.changes.length > 0 && selectedIds.size === 0) ? 0.6 : 1,
                }}
              >
                {applying ? "Applying…" : "Apply + regenerate imprint →"}
              </button>
            </div>
          </div>
        </>
      )}

      {error && (
        <div style={{ color: "var(--warning)", fontSize: 11 }}>✗ {error}</div>
      )}
    </div>
  );
}

function describeChange(c: ProposedChange): string {
  switch (c.action) {
    case "connector_add":
      return `+ Add connector: ${c.connector_id} (${c.bucket}, ${c.priority})`;
    case "connector_promote":
      return `↑ Promote ${c.connector_id}: ${c.from_bucket} → ${c.to_bucket}`;
    case "swarm_overlay":
      return `⌥ Swarm overlay on ${c.slot}: ${c.new_overlay}`;
    case "workflow_task_add":
      return `+ Workflow task on ${c.slot}: ${c.task?.task ?? "(unnamed)"}`;
    case "workflow_escalation_add":
      return `+ Escalation: ${c.on} → ${c.to}`;
    default:
      return c.action;
  }
}
