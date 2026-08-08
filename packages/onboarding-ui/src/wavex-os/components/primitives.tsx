/** The onboarding vocabulary, built on the architectural design system.
 *
 *  Every pillar and phase composes from these six, so they are the highest-
 *  leverage file in the standardization: getting them right moves most of the
 *  57-file surface without touching it.
 *
 *  Rules they encode (docs/design/COMPONENT_RULES.md):
 *    - paper is `.cv-paper` — panel fill, hairline, radius-lg, elev-1
 *    - selection wears `--mind`; color is state, never "clickable"
 *    - controls never cast a shadow; surfaces do
 *    - 44px minimum tap targets */

import { useState, type ReactNode } from "react";
import { Ic } from "../../canvas/icons";

export function H2({ children }: { children: ReactNode }) {
  // The canvas masthead voice: one confident title, tight tracking.
  return (
    <h2 style={{
      fontSize: "var(--text-xl)", fontWeight: 650, letterSpacing: "-0.02em",
      lineHeight: 1.15, marginTop: 0, marginBottom: "var(--space-2)",
    }}>
      {children}
    </h2>
  );
}

export function P({ children }: { children: ReactNode }) {
  return (
    <p className="text-dim" style={{ fontSize: "var(--text-base)", marginBottom: "var(--space-6)" }}>
      {children}
    </p>
  );
}

export function Card({ children, accent }: { children: ReactNode; accent?: boolean }) {
  // `.cv-paper`, not the legacy `.card`: paper has to DETACH from the ground,
  // and that is the elevation ladder's job, not a border's.
  return (
    <div className="cv-paper" style={{
      padding: "var(--space-5) var(--space-6)", marginBottom: "var(--space-4)",
      ...(accent ? { borderColor: "color-mix(in srgb, var(--mind) 40%, transparent)" } : null),
    }}>
      {children}
    </div>
  );
}

export function Field({ label, hint, required, children }: {
  label: ReactNode; hint?: string; required?: boolean; children: ReactNode;
}) {
  return (
    <label style={{ display: "block", marginBottom: "1.25rem" }}>
      <div style={{ marginBottom: "0.5rem" }}>
        {label}
        {required && <span style={{ color: "var(--warning)", marginLeft: "0.4rem", fontSize: 12 }}>*</span>}
        {hint && <span className="text-dim" style={{ fontSize: 12, marginLeft: "0.4rem" }}>{hint}</span>}
      </div>
      {children}
    </label>
  );
}

export function RadioGroup<T extends string>({ value, onChange, options }: {
  value: T;
  onChange: (v: T) => void;
  options: Array<{ value: T; label: string; description?: string }>;
}) {
  return (
    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(220px, 1fr))", gap: "0.5rem" }}>
      {options.map((o) => {
        const active = value === o.value;
        return (
          <button
            key={o.value}
            onClick={() => onChange(o.value)}
            type="button"
            className="secondary"
            style={{
              textAlign: "left",
              padding: "var(--space-3) var(--space-4)",
              fontSize: "var(--text-sm)",
              cursor: "pointer",
              minHeight: 44,
              // Selection is a STATE, so it wears the mind hue — the same
              // treatment the canvas rail uses for an open lens.
              borderColor: active ? "color-mix(in srgb, var(--mind) 40%, transparent)" : undefined,
              background: active ? "color-mix(in srgb, var(--mind) 6%, transparent)" : undefined,
              color: active ? "var(--mind)" : "var(--text)",
              borderRadius: 10,
              display: "flex",
              flexDirection: "column",
              gap: "var(--space-1)",
            }}
          >
            <span style={{ fontWeight: 600 }}>{o.label}</span>
            {o.description && <span className="text-dim" style={{ fontSize: "var(--text-xs)" }}>{o.description}</span>}
          </button>
        );
      })}
    </div>
  );
}

export function ChipMultiSelect<T extends string>({ values, onChange, options }: {
  values: T[];
  onChange: (next: T[]) => void;
  options: Array<{ value: T; label: string }>;
}) {
  const toggle = (v: T) => {
    onChange(values.includes(v) ? values.filter((x) => x !== v) : [...values, v]);
  };
  return (
    <div style={{ display: "flex", flexWrap: "wrap", gap: "0.5rem" }}>
      {options.map((o) => {
        const active = values.includes(o.value);
        return (
          <button
            key={o.value}
            onClick={() => toggle(o.value)}
            type="button"
            className="secondary"
            aria-pressed={active}
            style={{
              display: "inline-flex", alignItems: "center", gap: 6,
              padding: "var(--space-2) var(--space-4)",
              fontSize: "var(--text-xs)",
              borderRadius: 9, minHeight: 32,
              cursor: "pointer",
              borderColor: active ? "color-mix(in srgb, var(--mind) 40%, transparent)" : undefined,
              background: active ? "color-mix(in srgb, var(--mind) 6%, transparent)" : undefined,
              color: active ? "var(--mind)" : "var(--text)",
            }}
          >
            {active && <Ic name="check" size={12} color="var(--mind)" />}
            {o.label}
          </button>
        );
      })}
    </div>
  );
}

/** Free-form chip input — operator types a value, hits Enter/comma to add
 *  a chip, clicks × to remove. Distinct from ChipMultiSelect which is for
 *  fixed option sets. Used by the per-tool drawer (VIPs, privacy zones)
 *  and the Voice step (guardrails). */
export function ChipInput({
  values, onChange, placeholder, max = 20, ariaLabel,
}: {
  values: string[];
  onChange: (next: string[]) => void;
  placeholder?: string;
  max?: number;
  ariaLabel?: string;
}) {
  const [draft, setDraft] = useState<string>("");
  function add(raw: string): void {
    const v = raw.trim().replace(/,$/, "").trim();
    if (!v) return;
    if (values.includes(v)) { setDraft(""); return; }
    if (values.length >= max) return;
    onChange([...values, v]);
    setDraft("");
  }
  function remove(idx: number): void {
    onChange(values.filter((_, i) => i !== idx));
  }
  return (
    <div
      style={{
        display: "flex", flexWrap: "wrap", gap: "0.35rem",
        padding: "0.4rem 0.5rem",
        // Matches the canvas input material: paper fill, hairline edge.
        background: "var(--panel)",
        border: "1px solid rgba(0, 0, 0, 0.10)",
        borderRadius: 10,
        minHeight: 44,
      }}
      onClick={(e) => {
        const tgt = e.currentTarget.querySelector("input");
        if (tgt instanceof HTMLInputElement) tgt.focus();
      }}
    >
      {values.map((v, i) => (
        <span
          key={`${v}-${i}`}
          style={{
            display: "inline-flex", alignItems: "center", gap: "0.25rem",
            padding: "0.15rem 0.5rem",
            background: "color-mix(in srgb, var(--mind) 8%, transparent)",
            color: "var(--mind)",
            border: "1px solid color-mix(in srgb, var(--mind) 30%, transparent)",
            borderRadius: 9, fontSize: "var(--text-xs)", fontWeight: 600,
          }}
        >
          {v}
          <button
            type="button"
            onClick={(e) => { e.stopPropagation(); remove(i); }}
            aria-label={`Remove ${v}`}
            style={{
              background: "transparent", border: "none", color: "var(--mind)",
              cursor: "pointer", padding: 0, marginLeft: 2, fontSize: 13, lineHeight: 1,
              boxShadow: "none",
            }}
          >×</button>
        </span>
      ))}
      <input
        type="text"
        value={draft}
        placeholder={values.length === 0 ? placeholder : ""}
        aria-label={ariaLabel}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === ",") {
            e.preventDefault();
            add(draft);
          } else if (e.key === "Backspace" && draft === "" && values.length > 0) {
            remove(values.length - 1);
          }
        }}
        onBlur={() => { if (draft.trim()) add(draft); }}
        style={{
          flex: 1, minWidth: 80,
          background: "transparent", border: "none", outline: "none",
          color: "var(--text)", fontSize: 12, fontFamily: "inherit",
        }}
      />
    </div>
  );
}

export function NavRow({ back, next, nextLabel, nextDisabled, onNext }: {
  back?: { onClick?: () => void; label?: string };
  next?: { onClick?: () => void; label?: string };
  nextLabel?: string;
  nextDisabled?: boolean;
  onNext?: () => void;
}) {
  return (
    <div className="nav-buttons">
      {back ? (
        <button className="secondary" onClick={back.onClick} type="button">{back.label ?? "← Back"}</button>
      ) : <span />}
      {next || onNext ? (
        <button onClick={next?.onClick ?? onNext} disabled={nextDisabled} type="button">
          {next?.label ?? nextLabel ?? "Next →"}
        </button>
      ) : <span />}
    </div>
  );
}
