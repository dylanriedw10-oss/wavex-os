/** Welcome screen — entry point at /onboarding (no companyId yet).
 *  Either resume an existing draft, reset one to a clean slate, or start
 *  a new company. The wavex-os pipeline auto-creates the company state on
 *  first pillar-1 POST, so no separate "create" call is needed. */

import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { wavexOsOnboardingApi, ApiError } from "../lib/api";
import { slugifyCompanyId } from "../lib/CompanyContext";
import { Card, H2, P, Field, NavRow } from "./primitives";
import { ConfirmResetModal } from "./ConfirmResetModal";
import { preserveDevFlags } from "../lib/dev-flags";

export function WelcomeScreen() {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const { data, isLoading } = useQuery({
    queryKey: ["companies"],
    queryFn: () => wavexOsOnboardingApi.listCompanies(),
  });
  const [name, setName] = useState("");
  const [confirmReset, setConfirmReset] = useState<string | null>(null);
  const [resetting, setResetting] = useState(false);
  const [resetError, setResetError] = useState<string | null>(null);
  const [resetReport, setResetReport] = useState<{ companyId: string; rows: number } | null>(null);

  const [showEmpty, setShowEmpty] = useState(false);

  const proposedSlug = slugifyCompanyId(name);
  const companies = data?.companies ?? [];
  const slugConflict = companies.some((c) => c.id === proposedSlug);

  // Grouped by what each company actually IS — the server reads the state
  // off disk. A company with a spine is LIVE: its home is the canvas, and
  // sending it back to Pillar 1 restarts onboarding on a running company.
  const onboarded = companies.filter((c) => c.state === "live" || c.state === "finalized");
  const drafts = companies.filter((c) => c.state === "draft");
  const empties = companies.filter((c) => c.state === "empty");

  function start(): void {
    if (!proposedSlug) return;
    navigate(`/onboarding?${preserveDevFlags(`companyId=${encodeURIComponent(proposedSlug)}`)}`);
  }

  function resume(id: string): void {
    navigate(`/onboarding?${preserveDevFlags(`companyId=${encodeURIComponent(id)}`)}`);
  }

  async function doReset(companyId: string, restart: boolean): Promise<void> {
    setResetting(true);
    setResetError(null);
    try {
      const r = await wavexOsOnboardingApi.resetCompany(companyId);
      const totalRows = Object.values(r.dbDeletedRows).reduce((a, n) => a + n, 0);
      setResetReport({ companyId, rows: totalRows });
      setConfirmReset(null);
      // Refresh the company list
      await qc.invalidateQueries({ queryKey: ["companies"] });
      if (restart) {
        navigate(`/onboarding?${preserveDevFlags(`companyId=${encodeURIComponent(companyId)}`)}`);
      }
    } catch (e) {
      setResetError(e instanceof ApiError ? e.message : (e as Error).message);
    } finally {
      setResetting(false);
    }
  }

  return (
    <div style={{ maxWidth: 760, margin: "0 auto", padding: "2rem" }}>
      <H2>Onboarding</H2>
      <P>
        Define your company's identity, choose your headline KPI, and materialize the kernel
        fleet — CEO + Chief of Staff at minimum, with C-suite roles activated by your stage
        and GTM motion.
      </P>

      {resetReport && (
        <Card accent>
          <div style={{ fontSize: 13, fontWeight: 600, color: "var(--accent)" }}>
            ✓ Reset <code>{resetReport.companyId}</code> — wiped {resetReport.rows} db row{resetReport.rows === 1 ? "" : "s"} + onboarding artifacts.
          </div>
        </Card>
      )}

      {resetError && (
        <Card>
          <p style={{ color: "var(--warning)", margin: 0 }}>✗ Reset failed: {resetError}</p>
        </Card>
      )}

      <Card>
        <H2>Start a new company</H2>
        <Field label="Company name" required>
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g. Acme Concierge"
            autoFocus
          />
        </Field>
        {name.trim() && (
          <div className="text-dim" style={{ fontSize: 13, marginBottom: "0.75rem" }}>
            slug: <code>{proposedSlug}</code>
            {slugConflict && <span style={{ color: "var(--warning)", marginLeft: "0.5rem" }}>(already exists — resume or reset below)</span>}
          </div>
        )}
        <NavRow
          next={{ onClick: start, label: "Start →" }}
          nextDisabled={!name.trim() || slugConflict}
        />
      </Card>

      {!isLoading && onboarded.length > 0 && (
        <Card>
          <H2>Already onboarded</H2>
          <P>
            These have been through the pipeline — they belong on the canvas, not
            back at Pillar 1. Re-running onboarding is still possible, but it
            edits a company that is already live.
          </P>
          <div style={{ display: "grid", gap: "0.5rem", marginTop: "0.75rem" }}>
            {onboarded.map((c) => (
              <CompanyRow
                key={c.id}
                company={c}
                primary={{ label: "Open canvas →", onClick: () => navigate(`/canvas?companyId=${encodeURIComponent(c.id)}`) }}
                secondary={{ label: "Edit answers", onClick: () => resume(c.id) }}
                onReset={() => { setConfirmReset(c.id); setResetError(null); setResetReport(null); }}
              />
            ))}
          </div>
        </Card>
      )}

      {!isLoading && drafts.length > 0 && (
        <Card>
          <H2>In progress</H2>
          <P>Answers in flight — pick up where the wizard left off.</P>
          <div style={{ display: "grid", gap: "0.5rem", marginTop: "0.75rem" }}>
            {drafts.map((c) => (
              <CompanyRow
                key={c.id}
                company={c}
                primary={{ label: "Resume →", onClick: () => resume(c.id) }}
                onReset={() => { setConfirmReset(c.id); setResetError(null); setResetReport(null); }}
              />
            ))}
          </div>
        </Card>
      )}

      {/* Empty shells — a directory and nothing else, mostly test-run
          residue. Counted, folded, one tap down: they are noise until
          you are looking for them. */}
      {!isLoading && empties.length > 0 && (
        <Card>
          <button
            type="button"
            className="secondary"
            style={{ width: "100%", textAlign: "left", padding: "0.5rem 0.7rem" }}
            onClick={() => setShowEmpty((v) => !v)}
            aria-expanded={showEmpty}
          >
            {empties.length} untouched · no answers recorded {showEmpty ? "▾" : "▸"}
          </button>
          {showEmpty && (
            <div style={{ display: "grid", gap: "0.5rem", marginTop: "0.75rem" }}>
              {empties.map((c) => (
                <CompanyRow
                  key={c.id}
                  company={c}
                  primary={{ label: "Start →", onClick: () => resume(c.id) }}
                  onReset={() => { setConfirmReset(c.id); setResetError(null); setResetReport(null); }}
                />
              ))}
            </div>
          )}
        </Card>
      )}

      {confirmReset && (
        <ConfirmResetModal
          companyId={confirmReset}
          busy={resetting}
          onCancel={() => setConfirmReset(null)}
          onConfirm={(restart) => void doReset(confirmReset, restart)}
        />
      )}
    </div>
  );
}

const STATE_LABEL: Record<string, string> = {
  live: "live",
  finalized: "finalized",
  draft: "in progress",
  empty: "untouched",
};

/** One company: its id, what state it is in (the word, always printed), and
 *  the actions that state actually permits. */
function CompanyRow({ company, primary, secondary, onReset }: {
  company: { id: string; name: string; state: string; updatedAt: string | null };
  primary: { label: string; onClick: () => void };
  secondary?: { label: string; onClick: () => void };
  onReset: () => void;
}) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: "0.4rem" }}>
      <button
        type="button"
        className="secondary"
        style={{ flex: 1, textAlign: "left", padding: "0.6rem 0.75rem" }}
        onClick={primary.onClick}
      >
        <code>{company.id}</code>
        <span className="text-dim" style={{ fontSize: 12, marginLeft: "0.5rem" }}>
          · {STATE_LABEL[company.state] ?? company.state}
        </span>
        <span style={{ float: "right", fontSize: 12 }}>{primary.label}</span>
      </button>
      {secondary && (
        <button
          type="button"
          className="secondary"
          style={{ padding: "0.4rem 0.7rem", fontSize: 12 }}
          onClick={secondary.onClick}
        >
          {secondary.label}
        </button>
      )}
      <button
        type="button"
        style={{
          padding: "0.4rem 0.7rem",
          background: "transparent",
          color: "var(--warning)",
          border: "1px solid var(--warning)",
          borderRadius: 4,
          fontSize: 12,
          cursor: "pointer",
        }}
        onClick={onReset}
        title="Wipe all state and start over from Pillar 1"
      >
        Reset
      </button>
    </div>
  );
}
