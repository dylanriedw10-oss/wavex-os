/** Pillar 4 · GTM Motion. Mirrors upstream pillar-4.tsx:
 *  - ChipMultiSelect for lead_sources (1-3, primary first; max=3)
 *  - RadioGroup for sales_motion
 *  - close_channel ONLY shown when sales_motion ∈ {assisted_demo, high_touch_enterprise}
 *  - Live GTM profile preview card (purple) showing the derived
 *    gtm_profile_enum and which agents will activate */

import { useMemo, useState } from "react";
import { wavexOsOnboardingApi, ApiError } from "../lib/api";
import type { Pillar4Response, LeadSource, SalesMotion, CloseChannel } from "@wavex-os/plugin-onboarding";
import { Card, Field, H2, P } from "../components/primitives";
import { LEAD_SOURCES, SALES_MOTIONS, CLOSE_CHANNELS } from "../lib/options";
import { deriveGtmProfile, displayGtmProfile } from "../lib/gtm-profile";

interface Props {
  companyId: string;
  initial: Pillar4Response | undefined;
  onComplete: () => void;
}

export function Pillar4({ companyId, initial, onComplete }: Props) {
  const [leadSources, setLeadSources] = useState<string[]>(
    initial?.lead_sources?.length ? initial.lead_sources : ["outbound_cold"],
  );
  const [lsOther, setLsOther] = useState(initial?.lead_source_other ?? "");
  const [sm, setSm] = useState<string>(initial?.sales_motion ?? "high_touch_enterprise");
  const [smOther, setSmOther] = useState(initial?.sales_motion_other ?? "");
  const [cc, setCc] = useState<string>(initial?.close_channel ?? "mostly_phone_video");
  const [ccOther, setCcOther] = useState(initial?.close_channel_other ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const needsClose = sm === "assisted_demo" || sm === "high_touch_enterprise";
  const lsIncludesOther = leadSources.includes("other");
  const lsOtherMissing = lsIncludesOther && lsOther.trim().length < 40;
  const smOtherMissing = sm === "other" && smOther.trim().length < 40;
  const ccOtherMissing = needsClose && cc === "other" && ccOther.trim().length < 40;
  const lsCountInvalid = leadSources.length < 1 || leadSources.length > 3;

  const profile = useMemo(
    () => (leadSources.length > 0 && sm !== "other"
      ? deriveGtmProfile({ lead_sources: leadSources, sales_motion: sm })
      : null),
    [leadSources, sm],
  );
  const profileDisplay = profile ? displayGtmProfile(profile) : null;

  function toggleLead(v: string): void {
    setLeadSources((cur) => {
      if (cur.includes(v)) return cur.filter((x) => x !== v);
      if (cur.length >= 3) return cur;
      return [...cur, v];
    });
  }

  async function submit(): Promise<void> {
    setBusy(true);
    setError(null);
    try {
      await wavexOsOnboardingApi.pillar4({
        companyId,
        lead_sources: leadSources as LeadSource[],
        lead_source_other: lsIncludesOther ? lsOther : undefined,
        sales_motion: sm as SalesMotion,
        sales_motion_other: sm === "other" ? smOther : undefined,
        close_channel: needsClose ? (cc as CloseChannel) : undefined,
        close_channel_other: needsClose && cc === "other" ? ccOther : undefined,
      });
      onComplete();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : (e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div style={{ maxWidth: 760, margin: "0 auto", padding: "2rem" }}>
      <H2>Pillar 4 · Go-To-Market Motion</H2>
      <P>Drives connector selection, swarm topology, and workflow sequencing.</P>

      {error && <Card><p style={{ color: "var(--warning)", margin: 0 }}>✗ {error}</p></Card>}

      <Card>
        <div style={{ marginBottom: "1rem" }}>
          <div style={{ marginBottom: "0.5rem", fontSize: 13, fontWeight: 500 }}>
            How customers find you (pick 1–3, primary first) — {leadSources.length}/3 selected
          </div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
            {LEAD_SOURCES.map((o) => {
              const active = leadSources.includes(o.v);
              const disabled = !active && leadSources.length >= 3;
              return (
                <button
                  key={o.v}
                  type="button"
                  onClick={() => toggleLead(o.v)}
                  disabled={disabled}
                  style={{
                    padding: "0.4rem 0.75rem",
                    fontSize: 12,
                    borderRadius: 999,
                    border: `1px solid ${active ? "var(--accent)" : "var(--border)"}`,
                    background: active ? "var(--surface-2)" : "transparent",
                    color: disabled ? "var(--text-dim)" : "var(--text)",
                    opacity: disabled ? 0.4 : 1,
                    cursor: disabled ? "not-allowed" : "pointer",
                  }}
                >
                  {active ? "✓ " : ""}{o.l}
                </button>
              );
            })}
          </div>
        </div>

        {lsIncludesOther && (
          <Field label="Describe your lead source (≥40 chars)">
            <textarea value={lsOther} onChange={(e) => setLsOther(e.target.value)} rows={2}
              placeholder="What specifically is working today?" />
            <span className="text-dim" style={{ fontSize: 11 }}>{lsOther.trim().length} / 40 minimum</span>
          </Field>
        )}

        <RadioRow title="Sales motion" value={sm} onChange={setSm} options={SALES_MOTIONS.map((o) => ({ v: o.v, l: o.l }))} />
        {sm === "other" && (
          <Field label="Describe your sales motion (≥40 chars)">
            <textarea value={smOther} onChange={(e) => setSmOther(e.target.value)} rows={2}
              placeholder="Who's involved, how long to close, what's the hand-off." />
            <span className="text-dim" style={{ fontSize: 11 }}>{smOther.trim().length} / 40 minimum</span>
          </Field>
        )}

        {needsClose && (
          <>
            <RadioRow title="Close channel" value={cc} onChange={setCc} options={CLOSE_CHANNELS.map((o) => ({ v: o.v, l: o.l }))} />
            {cc === "other" && (
              <Field label="Describe how deals close (≥40 chars)">
                <textarea value={ccOther} onChange={(e) => setCcOther(e.target.value)} rows={2}
                  placeholder="Meeting format, decision-making dynamics." />
                <span className="text-dim" style={{ fontSize: 11 }}>{ccOther.trim().length} / 40 minimum</span>
              </Field>
            )}
          </>
        )}

        {profileDisplay && (
          <div style={{
            marginTop: "0.75rem",
            padding: "0.75rem",
            border: "1px solid var(--mind)",
            background: "var(--bg)",
            borderRadius: 4,
            fontSize: 12,
          }}>
            <div style={{ color: "var(--mind)", fontWeight: 600, marginBottom: 4 }}>
              ✦ Looks like you're {profileDisplay.name}
            </div>
            <div className="text-dim">{profileDisplay.primary_agents}</div>
            <div className="text-dim" style={{ fontSize: 10, marginTop: 4 }}>
              gtm_profile_enum: <code>{profile}</code>
            </div>
          </div>
        )}
      </Card>

      <div className="nav-buttons">
        <span />
        <button
          type="button"
          onClick={() => void submit()}
          disabled={busy || lsCountInvalid || lsOtherMissing || smOtherMissing || ccOtherMissing}
        >
          {busy ? "Saving…" : "Next →"}
        </button>
      </div>
    </div>
  );
}

function RadioRow({
  title, value, onChange, options,
}: {
  title: string;
  value: string;
  onChange: (v: string) => void;
  options: ReadonlyArray<{ v: string; l: string }>;
}) {
  return (
    <div style={{ marginBottom: "1rem" }}>
      <div style={{ marginBottom: "0.5rem", fontSize: 13, fontWeight: 500 }}>{title}</div>
      <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
        {options.map((o) => (
          <label key={o.v} style={{
            display: "flex", alignItems: "center", gap: 10,
            padding: "0.5rem 0.75rem",
            border: `1px solid ${value === o.v ? "var(--accent)" : "var(--border)"}`,
            background: value === o.v ? "var(--surface-2)" : "transparent",
            borderRadius: 6,
            cursor: "pointer",
            fontSize: 13,
          }}>
            <input type="radio" checked={value === o.v} onChange={() => onChange(o.v)} />
            <span>{o.l}</span>
          </label>
        ))}
      </div>
    </div>
  );
}
