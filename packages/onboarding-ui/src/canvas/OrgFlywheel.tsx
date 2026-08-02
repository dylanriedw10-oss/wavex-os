/** The organization as a living flywheel (docs/RECURSIVE_ORG_SPEC.md §2, §11).
 *
 *  Company view: soft tinted petals orbit the Constitution — the still,
 *  near-opaque center everything runs under. Each petal wears a fixed
 *  identity tint + icon; the name prints in ink; the completeness number
 *  renders ONLY when it is real (R1 departments have no blueprint — no
 *  fake percentages). Activity is one small teal pulse, never a festival.
 *
 *  Walking in replaces the wheel with the node's own view: snapshot,
 *  signals, capability chips (scoped asks), children, cited memory. The
 *  parent never renders as a dead breadcrumb — it steps back into fluid
 *  material, one click from returning. */

import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { useQuery } from "@tanstack/react-query";
import { wavexOsOnboardingApi, ApiError } from "../wavex-os/lib/api";
import { Cell } from "./cells";
import { Ic } from "./icons";
import { WorkPanel } from "./WorkPanel";
import { DeskBody, MiniOrgChart } from "./Desk";
import type { CellSpec, OrgNode, OrgWalkStep } from "./contract";

const REDUCE = typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;

/* Department identity: a small desaturated categorical set, assigned in
 * FIXED display order (never cycled — a 6th+ department folds to neutral).
 * Identity is carried by tint + icon + position, with the name always
 * printed in ink; status tokens stay reserved for status. */
const DEPT_HUES = ["#6E7BA8", "#4E8F6B", "#A5834B", "#8E6E9E", "#517E90"];
const deptHue = (i: number): string => (i < DEPT_HUES.length ? DEPT_HUES[i] : "#8B8B88");

function deptIcon(title: string): string {
  const t = title.toLowerCase();
  if (/growth|market|sales|demand|revenue|cmo/.test(t)) return "trend";
  if (/product|build|eng|dev|qa|cpo|cto/.test(t)) return "box";
  if (/ops|operation|billing|finance|cfo|admin|people|hr/.test(t)) return "people";
  return "orbit";
}

/** Which icon a capability chip wears — by id when specific, else by kind.
 *  Exported: capabilities render in the composer (they are prompts, so they
 *  live where you type — density gradient, spec Rev 7). */
export function capIcon(cap: { id: string; kind: string }): string {
  if (cap.id === "c-goal") return "target";
  if (cap.id === "c-live") return "wave";
  if (cap.id === "c-grav" ) return "orbit";
  return cap.kind === "show_children" ? "people" : cap.kind === "compare" ? "bars" : "chat";
}

const METRIC_ICON: Record<string, string> = {
  "metric:spend": "trend", "metric:budget": "bars", "metric:goal": "target",
};

/* Metrics are one FAMILY — instruments, not teams. They share a single
 * graphite-blue identity hue (contrast-checked against the ground) and
 * differ by glyph, so the class of node reads at a glance. */
const METRIC_HUE = "#66788C";

/** What a metric node shows when you walk in: the same composed evidence
 *  the workspace would build for its topic — every cell a render-only
 *  allowlisted binding, no model-authored numbers. */
const METRIC_EVIDENCE: Record<string, CellSpec[]> = {
  "metric:spend": [
    { id: "org-spend-hero", type: "metric", variant: "live", title: "Total spend", source: { api: "token-usage", params: {} } },
    { id: "org-spend-cap", type: "metric", variant: "gauge", title: "Against cap", source: { api: "token-budget", params: {} } },
  ],
  "metric:budget": [
    { id: "org-budget-gauge", type: "metric", variant: "gauge", title: "Budget", source: { api: "token-budget", params: {} } },
    { id: "org-budget-spend", type: "metric", title: "Total spend", source: { api: "token-usage", params: {} } },
  ],
  "metric:goal": [
    { id: "org-goal-hero", type: "metric", variant: "goal", title: "Headline goal", source: { api: "manifest", params: {} } },
    { id: "org-goal-kpis", type: "table", title: "KPI registry", source: { api: "kpis", params: {} } },
  ],
};

/** Every node kind carries a glyph — the same vocabulary as the wheel. */
export function nodeIcon(n: { id: string; kind: OrgNode["kind"]; title: string }): string {
  switch (n.kind) {
    case "department": return deptIcon(n.title);
    case "agent": return "person";
    case "metric": return METRIC_ICON[n.id] ?? "bars";
    case "constitution": return "law";
    default: return "orbit";
  }
}

/** The icon medallion: identity made material — the node's glyph on a
 *  top-lit tint of its hue. Manufactured, not illustrated: a gradient, an
 *  inner highlight, one hairline of contact — never a flat sticker. */
export function Medallion({ icon, hue, size = 44 }: { icon: string; hue: string; size?: number }) {
  return (
    <span aria-hidden style={{
      width: size, height: size, borderRadius: size / 3.4, flexShrink: 0,
      display: "grid", placeItems: "center",
      background: `linear-gradient(180deg, color-mix(in srgb, ${hue} 7%, #FFFFFF), color-mix(in srgb, ${hue} 15%, #FFFFFF))`,
      border: `1px solid color-mix(in srgb, ${hue} 32%, transparent)`,
      boxShadow: "inset 0 1px 0 rgba(255,255,255,0.65), 0 1px 2px rgba(28,25,18,0.07)",
    }}>
      <Ic name={icon} size={Math.round(size * 0.45)} color={hue} />
    </span>
  );
}

export function ago(iso: string): string {
  const s = Math.max(0, (Date.now() - Date.parse(iso)) / 1000);
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.round(s / 60)}m ago`;
  if (s < 86_400) return `${Math.round(s / 3600)}h ago`;
  return `${Math.round(s / 86_400)}d ago`;
}

export const KIND_LABEL: Record<OrgNode["kind"], string> = {
  company: "company", department: "dept", agent: "agent", metric: "metric", constitution: "law",
};

/** Group a newest-first step log into walks. Floor hops can share one
 *  timestamp, so ordering comes from LOG ORDER (the reversed response),
 *  never from sorting ts — hops chronological inside each walk, walks
 *  newest-first by their last hop. */
function groupWalks(steps: OrgWalkStep[]): OrgWalkStep[][] {
  const by = new Map<string, OrgWalkStep[]>();
  for (const s of [...steps].reverse()) {
    const arr = by.get(s.walkId) ?? [];
    arr.push(s);
    by.set(s.walkId, arr);
  }
  return [...by.values()]
    .sort((a, b) => b[b.length - 1].ts.localeCompare(a[a.length - 1].ts));
}

/** A collapsed stratum (spec Rev 7): a secondary section renders as one
 *  counted line until asked — expansion is in place, the unfold grammar at
 *  list scale. Accumulated records render NOTHING at zero (their absence
 *  is the default state, not information); operational truths never use
 *  this — they stay expanded even when empty. */
function Stratum({ label, count, open, onToggle, children }: {
  label: string; count: number; open: boolean; onToggle: () => void; children: ReactNode;
}) {
  return (
    <div style={{ marginTop: "var(--space-4)", maxWidth: 720 }}>
      <button onClick={onToggle} aria-expanded={open}
        style={{ all: "unset", cursor: "pointer", display: "flex", alignItems: "center", gap: 8, minHeight: 28 }}>
        <span className="text-dim" style={{ fontSize: "var(--text-xs)", textTransform: "uppercase", letterSpacing: ".1em" }}>{label}</span>
        <span className="text-dim" style={{ fontSize: "var(--text-xs)" }}>{count}</span>
        <span className="text-dim" aria-hidden style={{
          fontSize: "var(--text-xs)", display: "inline-block",
          transform: open ? "rotate(90deg)" : "none", transition: "transform 130ms var(--ease)",
        }}>▸</span>
      </button>
      {open && <div style={{ marginTop: "var(--space-2)" }}>{children}</div>}
    </div>
  );
}

export function ActivityDot({ activity }: { activity: OrgNode["activity"] }) {
  const active = activity === "active";
  return (
    <span aria-label={active ? "active now" : "idle"} title={active ? "active now" : "idle"}
      className={active && !REDUCE ? "cv-breathe" : undefined}
      style={{
        display: "inline-block", width: 8, height: 8, borderRadius: "50%",
        background: active ? "var(--live)" : "rgba(0,0,0,0.18)",
        boxShadow: active ? "0 0 6px color-mix(in srgb, var(--live) 35%, transparent)" : "none",
      }} />
  );
}

function HealthChip({ health }: { health: OrgNode["health"] }) {
  // Exception-based rendering (spec Rev 7): nominal is silence. The chip
  // exists only for deviations — "healthy" printed everywhere is noise;
  // absence IS the honest nominal signal.
  if (health === null || health === "ok") return null;
  const tone = health === "at_risk" ? "var(--attend)" : "var(--crit)";
  const label = health === "at_risk" ? "at risk" : "critical";
  return (
    <span style={{
      fontSize: "var(--text-xs)", color: tone,
      background: `color-mix(in srgb, ${tone} 9%, transparent)`,
      border: `1px solid color-mix(in srgb, ${tone} 30%, transparent)`,
      borderRadius: 999, padding: "2px 10px",
    }}>
      {label}
    </span>
  );
}

/** The objective line with its arrow in trajectory green — one small
 *  note of optimism, everything else stays ink. */
function ObjectiveTitle({ title }: { title: string }) {
  const parts = title.split("→");
  return (
    <>
      {parts.map((part, i) => (
        <span key={i}>
          {i > 0 && <span style={{ color: "var(--good)" }}> → </span>}
          {part.trim()}
        </span>
      ))}
    </>
  );
}

/* ------------------------------------------------------------------ */
/* The wheel — soft petals orbiting the Constitution                   */
/* ------------------------------------------------------------------ */

/** A rounded annular sector: the petal. The gap between petals is a
 *  CONSTANT-WIDTH channel (the angular offset shrinks with radius, so the
 *  petal's radial edges run parallel), and all four corners are eased
 *  with quadratic curves whose control point is the sharp corner itself —
 *  they can only round inward. Soft blades, never pie wedges. */
function petalPath(c: number, r0: number, r1: number, a0: number, a1: number, cr: number, gapPx: number): string {
  const pt = (r: number, a: number): [number, number] => [c + r * Math.cos(a), c + r * Math.sin(a)];
  const s = ([x, y]: [number, number]) => `${x} ${y}`;
  const g = (r: number) => gapPx / 2 / r;    // angular half-gap at radius r

  // Sharp corners of the blade (gap applied, no rounding yet).
  const A = pt(r1, a0 + g(r1)); // outer, start edge
  const B = pt(r1, a1 - g(r1)); // outer, end edge
  const C = pt(r0, a1 - g(r0)); // inner, end edge
  const D = pt(r0, a0 + g(r0)); // inner, start edge
  const along = (from: [number, number], to: [number, number], px: number): [number, number] => {
    const dx = to[0] - from[0], dy = to[1] - from[1];
    const len = Math.hypot(dx, dy) || 1;
    return [from[0] + (dx / len) * px, from[1] + (dy / len) * px];
  };

  const spanOuter = a1 - a0 - 2 * (g(r1) + cr / r1);
  const spanInner = a1 - a0 - 2 * (g(r0) + cr / r0);
  return [
    `M ${s(pt(r1, a0 + g(r1) + cr / r1))}`,
    `A ${r1} ${r1} 0 ${spanOuter > Math.PI ? 1 : 0} 1 ${s(pt(r1, a1 - g(r1) - cr / r1))}`,
    `Q ${s(B)} ${s(along(B, C, cr))}`,     // outer end corner
    `L ${s(along(C, B, cr))}`,             // end edge, inward
    `Q ${s(C)} ${s(pt(r0, a1 - g(r0) - cr / r0))}`, // inner end corner
    `A ${r0} ${r0} 0 ${spanInner > Math.PI ? 1 : 0} 0 ${s(pt(r0, a0 + g(r0) + cr / r0))}`,
    `Q ${s(D)} ${s(along(D, A, cr))}`,     // inner start corner
    `L ${s(along(A, D, cr))}`,             // start edge, outward
    `Q ${s(A)} ${s(pt(r1, a0 + g(r1) + cr / r1))}`, // outer start corner
    "Z",
  ].join(" ");
}

/** Slot names are lowercase identifiers; the wheel prints them as names. */
export const displayName = (t: string): string => t.charAt(0).toUpperCase() + t.slice(1);

export function OrgFlywheel({ departments, onEnter, registerPetal, caption }: {
  departments: OrgNode[];
  /** fromRect = the clicked petal's viewport rect, for the unfold. */
  onEnter: (nodeId: string, fromRect?: DOMRect) => void;
  registerPetal?: (id: string, el: SVGPathElement | null) => void;
  /** The watch face's ONE caption line (L0 budget) — shown when nothing is
   *  hovered. The compass earns the line; nothing else does. */
  caption?: ReactNode;
}) {
  const [hover, setHover] = useState<OrgNode | null>(null);
  // Soft tinted petals around a still white center. Identity is tint +
  // icon; the name prints in ink; the percentage appears ONLY when the
  // completeness number is real (R1 departments honestly have none).
  const size = 520, c = size / 2, r0 = 104, r1 = 242, cr = 34;
  const n = departments.length;
  const gapPx = n > 1 ? 18 : 6;      // constant-width silence between blades
  const rc = (r0 + r1) / 2;          // content radius

  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: "var(--space-3)" }}>
      <div style={{ position: "relative", width: size, height: size }}>
        {/* The face is an OBJECT on the canvas, not a diagram: it casts one
            soft ground shadow, sits in a recessed channel behind a hairline
            bezel, and each petal is top-lit — manufactured, not filled. */}
        <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} role="group" aria-label="Departments"
          style={{ filter: "drop-shadow(0 2px 4px rgba(28,25,18,0.05)) drop-shadow(0 20px 32px rgba(28,25,18,0.10))", overflow: "visible" }}>
          <defs>
            {departments.map((d, i) => (
              <radialGradient key={d.id} id={`petal-g-${i}`} gradientUnits="userSpaceOnUse"
                cx={c} cy={c * 0.3} r={size * 0.85}>
                <stop offset="0%" stopColor={`color-mix(in srgb, ${deptHue(i)} 7%, #FFFFFF)`} />
                <stop offset="100%" stopColor={`color-mix(in srgb, ${deptHue(i)} 16%, #FFFFFF)`} />
              </radialGradient>
            ))}
          </defs>
          {/* The recessed well the petals sit in, and its bezel hairlines. */}
          {n > 0 && (
            <>
              <path fillRule="evenodd" fill="rgba(28,25,18,0.05)"
                d={`M ${c + r1 + 7} ${c} A ${r1 + 7} ${r1 + 7} 0 1 0 ${c - r1 - 7} ${c} A ${r1 + 7} ${r1 + 7} 0 1 0 ${c + r1 + 7} ${c} Z
                    M ${c + r0 - 7} ${c} A ${r0 - 7} ${r0 - 7} 0 1 1 ${c - r0 + 7} ${c} A ${r0 - 7} ${r0 - 7} 0 1 1 ${c + r0 - 7} ${c} Z`} />
              <circle cx={c} cy={c} r={r1 + 7} fill="none" stroke="rgba(0,0,0,0.07)" strokeWidth={1} />
              <circle cx={c} cy={c} r={r0 - 7} fill="none" stroke="rgba(0,0,0,0.06)" strokeWidth={1} />
            </>
          )}
          {departments.map((d, i) => {
            const a0 = -Math.PI / 2 + (i / n) * 2 * Math.PI;
            const a1 = -Math.PI / 2 + ((i + 1) / n) * 2 * Math.PI;
            const hovered = hover?.id === d.id;
            const hue = deptHue(i);
            return (
              <path key={d.id}
                ref={(el) => registerPetal?.(d.id, el)}
                d={petalPath(c, r0, r1, a0, a1, cr, gapPx)}
                fill={`url(#petal-g-${i})`}
                stroke={`color-mix(in srgb, ${hue} ${hovered ? 55 : 34}%, transparent)`}
                strokeWidth={1}
                style={{
                  cursor: "pointer",
                  transition: "stroke 130ms var(--ease), filter 130ms var(--ease)",
                  /* hover LIFTS — brightness + its own shadow — instead of recoloring */
                  filter: hovered ? "brightness(1.02) drop-shadow(0 6px 14px rgba(28,25,18,0.16))" : undefined,
                }}
                onMouseEnter={() => setHover(d)}
                onMouseLeave={() => setHover((h) => (h?.id === d.id ? null : h))}
                onClick={(e) => onEnter(d.id, e.currentTarget.getBoundingClientRect())}
                aria-label={`${d.title} — ${d.snapshot}`}
              />
            );
          })}
        </svg>
        {/* Petal content rides above as HTML — icon in the identity hue,
            name in ink, the number only when it exists. */}
        {departments.map((d, i) => {
          const mid = -Math.PI / 2 + ((i + 0.5) / n) * 2 * Math.PI;
          const active = d.activity === "active";
          return (
            <div key={d.id} aria-hidden style={{
              position: "absolute", left: c + rc * Math.cos(mid) - 65, top: c + rc * Math.sin(mid) - 36,
              width: 130, textAlign: "center", pointerEvents: "none",
              display: "flex", flexDirection: "column", alignItems: "center", gap: 3,
            }}>
              <Ic name={deptIcon(d.title)} size={22} color={deptHue(i)} />
              <div style={{ fontSize: 14, fontWeight: 600, display: "inline-flex", alignItems: "center", gap: 6 }}>
                {active && (
                  <span className={REDUCE ? undefined : "cv-breathe"}
                    style={{ width: 6, height: 6, borderRadius: "50%", background: "var(--live)" }} />
                )}
                {displayName(d.title.length > 14 ? `${d.title.slice(0, 13)}…` : d.title)}
              </div>
              {d.completeness !== null && (
                <div className="text-dim" style={{ fontSize: 13 }}>{d.completeness}%</div>
              )}
            </div>
          );
        })}
        {/* The Constitution: the still center of gravity — near-opaque,
            gently lit, everything else orbits it. Elevation from the
            solid material class; no bespoke shadow. */}
        <button
          onClick={() => onEnter("constitution")}
          className="cv-glass cv-glass--solid"
          aria-label="The Constitution — identity and law"
          style={{
            position: "absolute", left: c - 76, top: c - 76, width: 152, height: 152,
            borderRadius: "50%", display: "grid", placeItems: "center", cursor: "pointer",
            color: "var(--text)", textAlign: "center", padding: "var(--space-2)",
            background: "radial-gradient(120% 120% at 50% 28%, #FFFFFF 40%, #F0EFEA 100%)",
          }}>
          <span>
            <span style={{ display: "block", fontSize: 10, letterSpacing: ".22em", color: "var(--text-dim)", textTransform: "uppercase" }}>The</span>
            <span style={{ display: "block", fontWeight: 600, fontSize: "var(--text-base)", letterSpacing: "-.01em" }}>Constitution</span>
          </span>
        </button>
        {/* The hover snapshot floats as a Popover near its petal (the
            interaction spec's own call) — the ladder's third layer in
            actual use. Pointer-transparent; the petal keeps the events. */}
        {hover && (() => {
          const i = departments.findIndex((d) => d.id === hover.id);
          const mid = -Math.PI / 2 + ((i + 0.5) / n) * 2 * Math.PI;
          const px = c + rc * Math.cos(mid);
          const py = c + (rc - 20) * Math.sin(mid);
          return (
            <div aria-hidden className="cv-pop" style={{
              position: "absolute", left: px, top: py, transform: "translate(-50%, -130%)",
              padding: "8px 14px", pointerEvents: "none", zIndex: 4,
              minWidth: 150, maxWidth: 250, textAlign: "left",
              animation: REDUCE ? undefined : "cv-appear 120ms var(--ease) both",
            }}>
              <div style={{ fontSize: "var(--text-sm)", fontWeight: 600, display: "flex", alignItems: "center", gap: 8 }}>
                <ActivityDot activity={hover.activity} /> {displayName(hover.title)}
              </div>
              <div className="text-dim" style={{ fontSize: "var(--text-xs)", marginTop: 2 }}>{hover.snapshot}</div>
            </div>
          );
        })()}
      </div>
      {/* One reserved line under the face: the caption — the compass. The
          hover snapshot lives in its popover now; this line never swaps. */}
      <div aria-live="polite" style={{ minHeight: 44, textAlign: "center" }}>
        {caption ?? (n > 0 ? (
          <span className="text-dim" style={{ fontSize: "var(--text-xs)" }}>hover a department · click to walk in</span>
        ) : null)}
      </div>
      {n === 0 && (
        <p className="text-dim" style={{ fontSize: "var(--text-sm)", maxWidth: "40ch", textAlign: "center" }}>
          No departments yet — the swarm manifest has no root reports. Finish onboarding to grow the wheel.
        </p>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* The walk trace                                                      */
/* ------------------------------------------------------------------ */

/* Decision tones: a walk in flight is teal-adjacent, but a SETTLED answer
 * is a confirmed fact — it wears good, not live. Refer stays attend
 * (evidence lives elsewhere), precedent stays mind (recalled, authored). */
const DECISION_TONE: Record<OrgWalkStep["decision"], string> = {
  delegated: "var(--text-dim)",
  referred: "var(--attend)",
  precedent: "var(--mind)",
  answered: "var(--good)",
};

/** One walk hop as a pill: the node's glyph, its name in ink, the decision
 *  in its status tone. Shared by the live trace and the Investigations view. */
function HopChip({ step, glyph }: {
  step: OrgWalkStep;
  glyph?: (nodeId: string, nodeTitle: string) => { icon: string; hue: string };
}) {
  const g = glyph?.(step.nodeId, step.nodeTitle);
  return (
    <span style={{
      display: "inline-flex", alignItems: "center", gap: 7,
      background: "var(--panel)", border: "1px solid rgba(0,0,0,0.08)",
      borderRadius: 999, padding: "4px 12px", fontSize: "var(--text-xs)",
    }}>
      {g && <Ic name={g.icon} size={13} color={g.hue} />}
      <span style={{ fontWeight: 600, color: "var(--text)" }}>{displayName(step.nodeTitle)}</span>
      <span style={{ color: DECISION_TONE[step.decision] }}>{step.decision}</span>
    </span>
  );
}

export function WalkTrace({ question, steps, revealed, answer, busy, glyph }: {
  question: string;
  steps: OrgWalkStep[];
  revealed: number;
  answer: string | null;
  busy: boolean;
  /** Resolves a hop's node to the wheel's glyph vocabulary. */
  glyph?: (nodeId: string, nodeTitle: string) => { icon: string; hue: string };
}) {
  const shown = steps.slice(0, revealed);
  const settled = !busy && revealed >= steps.length;
  return (
    <div className="cv-glass" style={{ borderRadius: "var(--radius-lg)", padding: "var(--space-4) var(--space-5)", marginBottom: "var(--space-4)" }}>
      <div style={{ display: "flex", alignItems: "baseline", gap: 10, marginBottom: 8, flexWrap: "wrap" }}>
        <span className="text-dim" style={{ fontSize: "var(--text-xs)", textTransform: "uppercase", letterSpacing: ".1em" }}>Investigating</span>
        <span style={{ fontSize: "var(--text-sm)" }}>{question}</span>
      </div>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 8, alignItems: "center" }}>
        {shown.map((s, i) => (
          <span key={s.id} style={{ display: "inline-flex", alignItems: "center", gap: 8, animation: REDUCE ? undefined : "cv-appear var(--dur-base) var(--ease) both" }}>
            {i > 0 && <span className="text-dim" aria-hidden>→</span>}
            <HopChip step={s} glyph={glyph} />
          </span>
        ))}
        {(busy || revealed < steps.length) && (
          <span className={REDUCE ? undefined : "cv-breathe"} style={{ color: "var(--live)", fontSize: "var(--text-xs)" }}>⟲</span>
        )}
      </div>
      {settled && answer && (
        <div style={{ marginTop: "var(--space-3)", fontSize: "var(--text-sm)", borderLeft: "3px solid var(--good)", paddingLeft: "var(--space-3)" }}>
          {answer}
        </div>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* The walk-in node view                                               */
/* ------------------------------------------------------------------ */

export function OrgView({ companyId, nodeId, onNavigate, onAsk, walk }: {
  companyId: string;
  nodeId: string;
  onNavigate: (nodeId: string) => void;
  /** Ask a question at a node (defaults to the open one). */
  onAsk: (prompt: string, atNodeId?: string) => void;
  walk: { question: string; steps: OrgWalkStep[]; revealed: number; answer: string | null; busy: boolean } | null;
}) {
  const fly = useQuery({
    queryKey: ["org-flywheel", companyId],
    queryFn: () => wavexOsOnboardingApi.getOrgFlywheel(companyId),
    refetchInterval: 60_000,
  });
  const nodeQ = useQuery({
    queryKey: ["org-node", companyId, nodeId],
    queryFn: () => wavexOsOnboardingApi.getOrgNode(companyId, nodeId),
  });
  const constQ = useQuery({
    enabled: nodeId === "constitution",
    queryKey: ["org-constitution", companyId],
    queryFn: () => wavexOsOnboardingApi.getOrgConstitution(companyId),
  });
  // The Views layer (spec Rev 5): organizational concepts, not dashboards —
  // one open view at a time on the company root, all measured, never
  // authored. Gravity keeps its capability-chip entry point too. Work
  // (spec Rev 6) is the native runtime: goals, tasks, the review gate.
  const [view, setView] = useState<"work" | "investigations" | "learned" | "gravity" | null>(null);
  // Secondary strata start folded on every node — density is earned by
  // interaction, and the choice doesn't follow you to the next desk.
  const [openStrata, setOpenStrata] = useState<Set<string>>(new Set());
  const toggleStratum = (k: string) => setOpenStrata((s) => {
    const n = new Set(s);
    if (n.has(k)) n.delete(k); else n.add(k);
    return n;
  });
  useEffect(() => { setView(wantView.current); wantView.current = null; setOpenStrata(new Set()); }, [nodeId]);
  const gravQ = useQuery({
    enabled: nodeId === "company" && view === "gravity",
    queryKey: ["org-gravity", companyId],
    queryFn: () => wavexOsOnboardingApi.getOrgGravity(companyId),
  });
  const invQ = useQuery({
    enabled: nodeId === "company" && view === "investigations",
    queryKey: ["org-investigations", companyId],
    queryFn: () => wavexOsOnboardingApi.getOrgInvestigations(companyId),
  });
  const memQ = useQuery({
    enabled: nodeId === "company" && view === "learned",
    queryKey: ["org-memory", companyId],
    queryFn: () => wavexOsOnboardingApi.getOrgMemory(companyId),
  });
  // Working nodes read the fleet LIVE (same adapter the cells use) and
  // their own slice of the investigation log. Both honest-by-status.
  const isWorkNode = nodeId.startsWith("dept:") || nodeId.startsWith("agent:");
  const isCompany = nodeId === "company";
  const liveQ = useQuery({
    enabled: isWorkNode,
    queryKey: ["org-live", companyId],
    queryFn: () => wavexOsOnboardingApi.getRuntimeLiveRuns(companyId),
    refetchInterval: 30_000,
    retry: false,
  });
  const histQ = useQuery({
    enabled: isWorkNode,
    queryKey: ["org-node-history", companyId, nodeId],
    queryFn: () => wavexOsOnboardingApi.getOrgInvestigations(companyId, { nodeId }),
  });
  // The desk's slice of the native work store (same cache entry as the
  // Work view). 503 = not seeded — the Queue section simply stays away.
  // At the company root it feeds ONE thing: the needs-you count on the
  // rail's Work entry (the L0 attention budget — absent at zero).
  const queueQ = useQuery({
    enabled: isWorkNode || isCompany,
    queryKey: ["org-work", companyId],
    queryFn: () => wavexOsOnboardingApi.getWork(companyId),
    retry: false,
    // A desk must see a cycle that something else started — the store is
    // written between serial steps, so keep the read warm.
    refetchInterval: isWorkNode ? 10_000 : 30_000,
  });
  const needsYou = queueQ.data
    ? queueQ.data.deliverables.filter((d) => d.review === "pending_review").length
      + queueQ.data.tasks.filter((t) => t.status === "failed").length
    : 0;
  // The desk hero's cadence sparkline — the dashboard's counted 12-day
  // run series (real, labeled org-wide in the render).
  const dashQ = useQuery({
    enabled: isWorkNode,
    queryKey: ["org-dash", companyId],
    queryFn: () => wavexOsOnboardingApi.getRuntimeDashboard(companyId),
    retry: false,
  });
  // "View all work →" from a desk exits to a company lens: navigation
  // resets the view, so the intent rides a ref across the reset.
  const wantView = useRef<"work" | "investigations" | "learned" | "gravity" | null>(null);

  // The unfold (spec Rev 5): a petal and its node view are ONE object. A
  // portal proxy — the medallion made free-floating — travels from the
  // clicked petal to the header (and back on fold). The destination header
  // is seeded synchronously from flywheel data already in hand, so the
  // journey never waits on a fetch. Reduced motion → instant swap.
  const medRef = useRef<HTMLSpanElement | null>(null);
  const petalEls = useRef<Map<string, SVGPathElement>>(new Map());
  const proxyRef = useRef<HTMLDivElement | null>(null);
  const morphSeq = useRef(0);
  const [morph, setMorph] = useState<{ node: OrgNode; hue: string; from: DOMRect; target: "medallion" | "petal"; seq: number } | null>(null);
  useLayoutEffect(() => {
    if (!morph) return;
    const el = proxyRef.current;
    const targetRect = morph.target === "medallion"
      ? medRef.current?.getBoundingClientRect()
      : petalEls.current.get(morph.node.id)?.getBoundingClientRect();
    const seq = morph.seq;
    if (!el || !targetRect) { setMorph(null); return; }
    void el.getBoundingClientRect(); // commit the start frame
    el.style.transition = "all 300ms var(--ease), opacity 220ms var(--ease) 120ms";
    el.style.left = `${targetRect.left}px`;
    el.style.top = `${targetRect.top}px`;
    el.style.width = `${targetRect.width}px`;
    el.style.height = `${targetRect.height}px`;
    el.style.opacity = "0";
    const t = setTimeout(() => setMorph((m) => (m?.seq === seq ? null : m)), 400);
    return () => clearTimeout(t);
  }, [morph]);

  const morphProxy = morph ? createPortal(
    <div ref={proxyRef} aria-hidden style={{
      position: "fixed", zIndex: 60, pointerEvents: "none",
      left: morph.from.left, top: morph.from.top, width: morph.from.width, height: morph.from.height,
      borderRadius: morph.target === "medallion" ? 22 : 40,
      background: `color-mix(in srgb, ${morph.hue} 10%, #FFFFFF)`,
      border: `1px solid color-mix(in srgb, ${morph.hue} 30%, transparent)`,
      display: "grid", placeItems: "center", opacity: 0.95,
    }}>
      <Ic name={deptIcon(morph.node.title)} size={22} color={morph.hue} />
    </div>,
    document.body,
  ) : null;

  if (fly.isError || nodeQ.isError) {
    const e = (fly.error ?? nodeQ.error) as Error;
    return (
      <div className="card">
        <strong>Couldn't read the organization.</strong>
        <p className="text-dim" style={{ fontSize: "var(--text-sm)", margin: "var(--space-2) 0" }}>
          {e instanceof ApiError ? e.message : e?.message}
        </p>
        <button onClick={() => { void fly.refetch(); void nodeQ.refetch(); }}>Try again</button>
      </div>
    );
  }
  if (!nodeQ.data) {
    // Mid-unfold the header is seeded from flywheel data already in hand —
    // the destination exists before the fetch answers. All of it is real.
    const seed = morph && morph.target === "medallion" && morph.node.id === nodeId ? morph.node : null;
    return (
      <div>
        {morphProxy}
        {seed ? (
          <>
            <button className="cv-glass cv-glass--fluid" onClick={() => onNavigate("company")}
              style={{ borderRadius: 999, padding: "4px 14px", fontSize: "var(--text-xs)", color: "var(--text-dim)", cursor: "pointer", marginBottom: "var(--space-3)" }}>
              ◂ the company
            </button>
            <div style={{ display: "flex", alignItems: "center", gap: "var(--space-3)" }}>
              <span ref={medRef} style={{ display: "inline-flex" }}>
                <Medallion icon={nodeIcon(seed)} hue={morph!.hue} />
              </span>
              <div style={{ minWidth: 0 }}>
                <div style={{ display: "flex", alignItems: "center", gap: "var(--space-3)", flexWrap: "wrap" }}>
                  <ActivityDot activity={seed.activity} />
                  <h2 style={{ margin: 0, fontSize: "var(--text-2xl)", fontWeight: 650, letterSpacing: "-0.02em", lineHeight: 1.15 }}>{displayName(seed.title)}</h2>
                  <span className="text-dim" style={{ fontSize: "var(--text-xs)", textTransform: "uppercase", letterSpacing: ".1em" }}>{KIND_LABEL[seed.kind]}</span>
                </div>
                <p className="text-dim" style={{ fontSize: "var(--text-sm)", margin: "4px 0 0" }}>{seed.snapshot}</p>
              </div>
            </div>
          </>
        ) : (
          <span className="text-dim" style={{ fontSize: "var(--text-sm)" }}>reading the organization…</span>
        )}
      </div>
    );
  }

  const { node, children, memory } = nodeQ.data;
  const metricEvidence = METRIC_EVIDENCE[node.id];
  // At the root the wheel already shows departments and the center shows the
  // Constitution — the chip row carries what the wheel doesn't: the CEO
  // agent and the metric nodes.
  const shownChildren = isCompany
    ? children.filter((c) => c.kind === "agent" || c.kind === "metric")
    : children;

  // Identity hues are positional in the wheel's department order; a node
  // inside a department inherits its department's hue so the walk-in view
  // still reads as "inside that petal". Law wears the mind hue; everything
  // unplaced stays neutral.
  const deptIndex = new Map((fly.data?.departments ?? []).map((d, i) => [d.id, i]));
  const hueFor = (id: string, kind: OrgNode["kind"], parentId?: string | null): string => {
    if (kind === "constitution") return "#605F96";
    if (kind === "metric") return METRIC_HUE;
    if (kind === "department") return deptHue(deptIndex.get(id) ?? DEPT_HUES.length);
    if (parentId && deptIndex.has(parentId)) return deptHue(deptIndex.get(parentId)!);
    if (deptIndex.has(node.id)) return deptHue(deptIndex.get(node.id)!); // children of the open department
    return "#8B8B88";
  };
  const nodeHue = hueFor(node.id, node.kind, node.parentId);

  /** Petal → node view: remember where we came from, then travel. */
  const enterFromWheel = (id: string, fromRect?: DOMRect) => {
    const dept = fly.data?.departments.find((d) => d.id === id);
    if (dept && fromRect && !REDUCE) {
      setMorph({ node: dept, hue: deptHue(deptIndex.get(id) ?? DEPT_HUES.length), from: fromRect, target: "medallion", seq: ++morphSeq.current });
    }
    onNavigate(id);
  };

  /** Node view → wheel: the medallion folds back into its petal. */
  const goBack = () => {
    const parent = node.parentId ?? "company";
    if (parent === "company" && node.kind === "department" && medRef.current && !REDUCE) {
      setMorph({ node, hue: nodeHue, from: medRef.current.getBoundingClientRect(), target: "petal", seq: ++morphSeq.current });
    }
    onNavigate(parent);
  };

  // The trace and gravity rows speak the wheel's glyph vocabulary; a hop
  // only carries its node id, so kind is derived from the id shape.
  const kindOf = (id: string): OrgNode["kind"] =>
    id === "company" ? "company"
    : id === "constitution" ? "constitution"
    : id.startsWith("dept:") ? "department"
    : id.startsWith("metric:") ? "metric"
    : "agent";
  const glyphFor = (id: string, title: string) => {
    const kind = kindOf(id);
    return { icon: nodeIcon({ id, kind, title }), hue: hueFor(id, kind) };
  };

  /** The desk's name set: this node plus its reports — the one matcher
   *  every desk read (runs, tasks, run log) filters through. */
  const deskNames = new Set<string>();
  if (isWorkNode) {
    for (const t of [node.title, ...children.map((c) => c.title)]) {
      deskNames.add(t.toLowerCase());
      deskNames.add(t.split(".").pop()!.toLowerCase());
    }
  }
  const inDesk = (slot: string) =>
    deskNames.has(slot.toLowerCase()) || deskNames.has(slot.split(".").pop()!.toLowerCase());
  const deskRuns = isWorkNode
    ? (((liveQ.data?.runs as Array<Record<string, any>>) ?? []).filter((r) =>
        inDesk(String(r.agentName ?? r.agent_name_key ?? r.agentId ?? ""))))
    : [];
  const lastDecision = isWorkNode && queueQ.data
    ? queueQ.data.runLog.find((e) =>
        (e.kind === "review_approved" || e.kind === "review_changes") && e.agentSlot && inDesk(e.agentSlot)) ?? null
    : null;

  return (
    <div>
      {walk && <WalkTrace {...walk} glyph={glyphFor} />}

      {morphProxy}

      {/* The parent recedes to fluid glass — never a dead breadcrumb. */}
      {!isCompany && (
        <button className="cv-glass cv-glass--fluid" onClick={goBack}
          style={{ borderRadius: 999, padding: "4px 14px", fontSize: "var(--text-xs)", color: "var(--text-dim)", cursor: "pointer", marginBottom: "var(--space-3)" }}>
          ◂ {node.parentId === "company" || !node.parentId ? "the company" : node.parentId.replace(/^(dept|agent):/, "")}
        </button>
      )}

      {/* The mode rail (spec Rev 7) — chrome, one line, position-stable
          across levels. At rest it's a whisper: plain text, no pill
          material. With a lens open it materializes into a segmented
          control. The Work entry carries the ONE attention signal the
          L0 budget allows — absent at zero. */}
      {isCompany && (
        <div className={view ? "cv-chrome" : undefined} style={{
          display: "flex", alignItems: "center", gap: view ? "var(--space-2)" : "var(--space-3)",
          flexWrap: "wrap", justifyContent: view ? "flex-start" : "center",
          marginBottom: view ? "var(--space-4)" : "var(--space-2)",
          /* with a lens open the rail is sticky chrome: content scrolls
             under real frost — the material proves itself. */
          ...(view ? { padding: "var(--space-3) 0", borderBottom: "1px solid rgba(0,0,0,0.05)" } : {}),
        }}>
          {([
            { key: "work" as const, label: "Work", icon: "target" },
            { key: "investigations" as const, label: "Investigations", icon: "wave" },
            { key: "learned" as const, label: "Learned", icon: "chat" },
            { key: "gravity" as const, label: "Gravity", icon: "orbit" },
          ]).map((v) => {
            const pressed = view === v.key;
            const badge = v.key === "work" && needsYou > 0 ? needsYou : null;
            // Distinct keys per mode: the whisper button carries `all:
            // unset`, and letting React DIFF the same DOM node into the
            // solid pill leaves half the styles unset — remount instead.
            return view === null ? (
              <button key={`w-${v.key}`} aria-label={v.label} aria-pressed={false}
                onClick={() => setView(v.key)}
                style={{
                  all: "unset", cursor: "pointer", minHeight: 32, padding: "4px 6px",
                  fontSize: "var(--text-xs)", color: "var(--text-dim)",
                  display: "inline-flex", alignItems: "center", gap: 6,
                }}>
                {v.label}
                {badge !== null && (
                  <span style={{ color: "var(--attend)", fontWeight: 600 }}>{badge}</span>
                )}
              </button>
            ) : (
              <button key={`s-${v.key}`} className="secondary" aria-label={v.label} aria-pressed={pressed}
                onClick={() => setView((cur) => (cur === v.key ? null : v.key))}
                style={{
                  fontSize: "var(--text-xs)", padding: "5px 12px", minHeight: 32,
                  display: "inline-flex", alignItems: "center", gap: 7, borderRadius: 10,
                  borderColor: pressed ? "color-mix(in srgb, var(--mind) 40%, rgba(0,0,0,0.12))" : undefined,
                  color: pressed ? "var(--mind)" : undefined,
                }}>
                <Ic name={v.icon} size={13} color={pressed ? "var(--mind)" : "var(--text-dim)"} />
                {v.label}
                {badge !== null && (
                  <span style={{ color: "var(--attend)", fontWeight: 600 }}>{badge}</span>
                )}
              </button>
            );
          })}
        </div>
      )}

      {/* The masthead: full identity — earned at L1. The company at rest
          IS the wheel, so it renders no masthead at all (the header chrome
          already names it); walking in or opening a lens grows it. */}
      {(!isCompany || view !== null) && (
        <div style={{ display: "flex", gap: "var(--space-6)", alignItems: "flex-start", justifyContent: "space-between", flexWrap: "wrap" }}>
        <div style={{ minWidth: 280, flex: "1 1 380px" }}>
          <div style={{ display: "flex", alignItems: "center", gap: "var(--space-3)" }}>
            {/* Non-company nodes wear their identity medallion — the same glyph
                and hue as their place on the wheel. The company IS the wheel. */}
            {!isCompany && (
              <span ref={medRef} style={{ display: "inline-flex" }}>
                <Medallion icon={nodeIcon(node)} hue={nodeHue} />
              </span>
            )}
            <div style={{ minWidth: 0 }}>
              <div style={{ display: "flex", alignItems: "center", gap: "var(--space-3)", flexWrap: "wrap" }}>
                <ActivityDot activity={node.activity} />
                <h2 style={{ margin: 0, fontSize: "var(--text-2xl)", fontWeight: 650, letterSpacing: "-0.02em", lineHeight: 1.15 }}>
                  {node.kind === "department" || node.kind === "agent" ? displayName(node.title) : node.title}
                </h2>
                <span style={{
                  fontSize: "var(--text-xs)", color: "var(--mind)",
                  background: "color-mix(in srgb, var(--mind) 9%, transparent)",
                  border: "1px solid color-mix(in srgb, var(--mind) 26%, transparent)",
                  borderRadius: 999, padding: "2px 10px", textTransform: "uppercase", letterSpacing: ".08em",
                }}>{KIND_LABEL[node.kind]}</span>
                <HealthChip health={node.health} />
                {node.gravity !== null && node.gravity > 0 && (
                  <span className="text-dim" style={{ fontSize: "var(--text-xs)" }} title="how often investigations bend toward this node">
                    gravity {node.gravity}
                  </span>
                )}
              </div>
              {node.description && (
                <p style={{ fontSize: "var(--text-sm)", margin: "6px 0 0", maxWidth: "56ch" }}>{node.description}</p>
              )}
              <p className="text-dim" style={{ fontSize: "var(--text-sm)", margin: "4px 0 0" }}>{node.snapshot}</p>
              {/* the status strip: counted facts only, absent at zero */}
              {isWorkNode && (deskRuns.length > 0 || lastDecision) && (
                <div className="text-dim" style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", marginTop: 8, fontSize: "var(--text-xs)" }}>
                  {deskRuns.length > 0 && <span style={{ color: "var(--live)" }}>{deskRuns.length} running</span>}
                  {deskRuns.length > 0 && lastDecision && <span aria-hidden>·</span>}
                  {lastDecision && <span>last decision {ago(lastDecision.ts)}</span>}
                </div>
              )}
            </div>
          </div>

          {/* The objective fuses into the Work lens (its goal meter is the
              same fact) — one address per fact per screen. */}
          {node.objective && !(isCompany && view === "work") && (
            <p style={{ fontSize: "var(--text-sm)", margin: "var(--space-2) 0 0" }}>
              <span className="text-dim">objective · </span><ObjectiveTitle title={node.objective.title} />
            </p>
          )}
          {node.completeness !== null && (
            <div style={{ margin: "var(--space-3) 0 0", maxWidth: 320 }} title={`${node.completeness}% of the blueprint is real`}>
              <div style={{ height: 4, borderRadius: 2, background: "var(--edge)" }}>
                <div style={{ height: 4, borderRadius: 2, width: `${node.completeness}%`, background: "var(--good)", transition: "width var(--dur-base) var(--ease)" }} />
              </div>
              <span className="text-dim" style={{ fontSize: "var(--text-xs)" }}>{node.completeness}% complete</span>
            </div>
          )}
        </div>
        {/* the reporting structure, from children data alone */}
        {isWorkNode && children.length > 0 && (
          <MiniOrgChart node={node} kids={children}
            hueFor={(id, kind) => hueFor(id, kind, node.kind === "department" ? node.id : undefined)}
            glyph={nodeIcon}
            onNavigate={onNavigate}
            onViewOrg={() => onNavigate("company")} />
        )}
        </div>
      )}

      {/* Capability chips left this surface (spec Rev 7): they are prompts,
          so they render in the composer, beside where questions are typed.
          The Constitution chip died too — the wheel's center IS that door. */}

      {/* Work: the native runtime — goals, the task ladder, the review
          gate, the cycle trigger (spec Rev 6). */}
      {isCompany && view === "work" && <WorkPanel companyId={companyId} />}

      {/* Investigations: the walk history, grouped by investigation —
          observed hops only, in the trace's own vocabulary. */}
      {isCompany && view === "investigations" && (
        <div style={{ marginTop: "var(--space-3)", maxWidth: 760 }}>
          {invQ.isLoading && <span className="text-dim" style={{ fontSize: "var(--text-sm)" }}>reading the log…</span>}
          {invQ.data && invQ.data.steps.length === 0 && (
            <div style={{ borderRadius: "var(--radius-lg)", padding: "var(--space-4) var(--space-5)", background: "rgba(255,255,255,0.45)", border: "1px dashed rgba(0,0,0,0.12)" }}>
              <span className="text-dim" style={{ fontSize: "var(--text-sm)" }}>No investigations yet — ask the organization something.</span>
            </div>
          )}
          {invQ.data && invQ.data.steps.length > 0 && (
            <div style={{
              borderRadius: "var(--radius-lg)", padding: "var(--space-5) var(--space-6)",
              background: "var(--panel)", border: "1px solid rgba(0,0,0,0.06)",
              boxShadow: "var(--elev-1)",
              display: "flex", flexDirection: "column", gap: "var(--space-3)",
            }}>
              {groupWalks(invQ.data.steps).map((steps) => (
                <div key={steps[0].walkId}>
                  <div style={{ display: "flex", alignItems: "baseline", gap: 10, marginBottom: 6 }}>
                    <span style={{ fontSize: "var(--text-sm)" }}>{steps[0].question}</span>
                    <span className="text-dim" style={{ fontSize: "var(--text-xs)" }}>{ago(steps[steps.length - 1].ts)}</span>
                  </div>
                  <div style={{ display: "flex", flexWrap: "wrap", gap: 8, alignItems: "center" }}>
                    {steps.map((s, i) => (
                      <span key={s.id} style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
                        {i > 0 && <span className="text-dim" aria-hidden>→</span>}
                        <HopChip step={s} glyph={glyphFor} />
                      </span>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Learned: everything the organization has distilled, org-wide —
          every claim cited, every row re-runnable at its node. */}
      {isCompany && view === "learned" && (
        <div style={{ marginTop: "var(--space-3)", maxWidth: 760 }}>
          {memQ.isLoading && <span className="text-dim" style={{ fontSize: "var(--text-sm)" }}>recalling…</span>}
          {memQ.data && memQ.data.entries.length === 0 && (
            <div style={{ borderRadius: "var(--radius-lg)", padding: "var(--space-4) var(--space-5)", background: "rgba(255,255,255,0.45)", border: "1px dashed rgba(0,0,0,0.12)" }}>
              <span className="text-dim" style={{ fontSize: "var(--text-sm)" }}>Nothing learned yet — walks and kept workspaces land here.</span>
            </div>
          )}
          {memQ.data && memQ.data.entries.length > 0 && (
            <div style={{
              borderRadius: "var(--radius-lg)", padding: "var(--space-3) var(--space-5)",
              background: "var(--panel)", border: "1px solid rgba(0,0,0,0.06)",
              boxShadow: "var(--elev-1)",
              display: "flex", flexDirection: "column",
            }}>
              {memQ.data.entries.map((m) => {
                const g = glyphFor(m.nodeId, m.nodeId.replace(/^(dept|agent):/, ""));
                return (
                  <button key={m.id} onClick={() => onAsk(m.question, m.nodeId)}
                    aria-label={`Ask again at ${m.nodeId}: ${m.question}`}
                    style={{
                      all: "unset", cursor: "pointer", display: "flex", alignItems: "center",
                      gap: "var(--space-3)", padding: "8px 6px", borderRadius: "var(--radius-sm)", minHeight: 0,
                    }}>
                    <Ic name={g.icon} size={14} color={g.hue} />
                    <span style={{ flex: 1, minWidth: 0 }}>
                      <span style={{ display: "block", fontSize: "var(--text-sm)", fontWeight: 400, color: "var(--text)" }}>{m.claim}</span>
                      <span className="text-dim" style={{ display: "block", fontSize: "var(--text-xs)" }}>
                        from “{m.question}” · {ago(m.derivedAt)} · {m.citations.length} citation{m.citations.length === 1 ? "" : "s"}
                      </span>
                    </span>
                    <span aria-hidden className="text-dim" style={{ fontSize: "var(--text-base)" }}>›</span>
                  </button>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* Gravity: where the organization bends — MEASURED from observed
          walks, ranked only when there is enough observation to rank. */}
      {isCompany && view === "gravity" && (
        <div style={{ marginTop: "var(--space-4)", maxWidth: 720 }}>
          <div style={{ display: "flex", alignItems: "baseline", gap: 10, marginBottom: "var(--space-2)" }}>
            <span className="text-dim" style={{ fontSize: "var(--text-xs)", textTransform: "uppercase", letterSpacing: ".1em" }}>Gravity</span>
            <span className="text-dim" style={{ fontSize: "var(--text-xs)" }}>where investigations bend · computed from walk history, never authored</span>
          </div>
          {gravQ.isLoading && <span className="text-dim" style={{ fontSize: "var(--text-sm)" }}>measuring…</span>}
          {gravQ.isError && (
            <span style={{ fontSize: "var(--text-sm)", color: "var(--attend)" }}>
              Couldn't read gravity. <button className="secondary" onClick={() => void gravQ.refetch()} style={{ fontSize: "var(--text-xs)", padding: "2px 10px", minHeight: 26, marginLeft: 6 }}>Retry</button>
            </span>
          )}
          {gravQ.data && !gravQ.data.threshold && (
            <div style={{
              borderRadius: "var(--radius-lg)", padding: "var(--space-5) var(--space-6)",
              background: "rgba(255,255,255,0.45)", border: "1px dashed rgba(0,0,0,0.12)",
            }}>
              <div style={{ fontSize: "var(--text-sm)" }}>Not enough observation yet.</div>
              <div className="text-dim" style={{ fontSize: "var(--text-xs)", marginTop: 4 }}>
                {gravQ.data.observedSteps} of 10 hops recorded — gravity is measured, never invented. Ask the organization things and it will emerge.
              </div>
            </div>
          )}
          {gravQ.data?.threshold && (
            <div style={{
              borderRadius: "var(--radius-lg)", padding: "var(--space-5) var(--space-6)",
              background: "var(--panel)", border: "1px solid rgba(0,0,0,0.06)",
              boxShadow: "var(--elev-1)",
              display: "flex", flexDirection: "column", gap: 10,
            }}>
              {gravQ.data.rows.slice(0, 8).map((r) => {
                const g = glyphFor(r.nodeId, r.title);
                return (
                  <div key={r.nodeId} style={{ display: "grid", gridTemplateColumns: "170px 1fr 44px", gap: "var(--space-3)", alignItems: "center" }}>
                    <button className="secondary" onClick={() => onNavigate(r.nodeId)}
                      style={{ all: "unset", cursor: "pointer", display: "inline-flex", alignItems: "center", gap: 8, minWidth: 0 }}>
                      <Ic name={g.icon} size={14} color={g.hue} />
                      <span style={{ fontSize: "var(--text-sm)", fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                        {displayName(r.title)}
                      </span>
                    </button>
                    <div title={`${r.evidence.inboundAsks} asks · ${r.evidence.landings} landings — from walk history`}>
                      <div style={{ height: 6, borderRadius: 3, background: "var(--edge)" }}>
                        <div style={{ height: 6, borderRadius: 3, width: `${r.gravity}%`, background: "color-mix(in srgb, var(--ink) 70%, transparent)", transition: "width var(--dur-base) var(--ease)" }} />
                      </div>
                      <div className="text-dim" style={{ fontSize: "var(--text-xs)", marginTop: 2 }}>
                        {r.evidence.inboundAsks} ask{r.evidence.inboundAsks === 1 ? "" : "s"} · {r.evidence.landings} landing{r.evidence.landings === 1 ? "" : "s"}
                      </div>
                    </div>
                    <span style={{ textAlign: "right", fontVariantNumeric: "tabular-nums", fontWeight: 600, fontSize: "var(--text-sm)" }}>{r.gravity}</span>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* The desk (spec Rev 8): hero + Working On in the main column,
          the desk's record (activity, memory, artifacts) as counted
          previews in the sidebar. Every number is store state. */}
      {isWorkNode && (
        <DeskBody
          seeded={!!queueQ.data}
          mine={(queueQ.data?.tasks ?? []).filter((t) => inDesk(t.assigneeSlot))}
          allTasks={queueQ.data?.tasks ?? []}
          deliverables={queueQ.data?.deliverables ?? []}
          runLog={(queueQ.data?.runLog ?? []).filter((e) => (e.agentSlot ? inDesk(e.agentSlot) : false))}
          walkSteps={histQ.data?.steps ?? []}
          memory={memory}
          runDays={(dashQ.data?.dashboard?.runActivity as Array<{ date: string; total: number }> | undefined) ?? null}
          hue={nodeHue}
          onOpenLens={(lens) => { wantView.current = lens; onNavigate("company"); }}
        />
      )}

      {/* Relationships (agents): who asks whom — an accumulated record, so
          it is SILENT until the first observed edge exists. */}
      {node.kind === "agent" && (nodeQ.data.edges?.length ?? 0) > 0 && (
        <Stratum label="Relationships" count={nodeQ.data.edges.length}
          open={openStrata.has("relationships")} onToggle={() => toggleStratum("relationships")}>
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            {nodeQ.data.edges.map((e) => {
              const other = e.from === nodeId ? e.to : e.from;
              const g = glyphFor(other, other.replace(/^(dept|agent):/, ""));
              return (
                <button key={`${e.from}-${e.to}`} onClick={() => onNavigate(other)}
                  style={{ all: "unset", cursor: "pointer", display: "flex", alignItems: "center", gap: 8, fontSize: "var(--text-sm)", minHeight: 0 }}>
                  <Ic name={g.icon} size={13} color={g.hue} />
                  <span style={{ fontWeight: 600 }}>{displayName(other.replace(/^(dept|agent|metric):/, ""))}</span>
                  <span className="text-dim" style={{ fontSize: "var(--text-xs)" }}>
                    {e.from === nodeId ? "asks" : "asked by"} ×{e.weight} · {ago(e.lastObservedAt)}
                  </span>
                </button>
              );
            })}
          </div>
        </Stratum>
      )}

      {/* L0 — the watch face (spec Rev 7). The wheel IS the screen: one
          caption line (the compass), one hub row of satellites (the root's
          non-petal children as sub-dials), nothing else. A lens open means
          the wheel yields the pane — one object at a time, never stacked. */}
      {isCompany && view === null && (
        <div style={{ marginTop: "var(--space-2)" }}>
          {fly.data
            ? <OrgFlywheel departments={fly.data.departments} onEnter={enterFromWheel}
                registerPetal={(id, el) => { if (el) petalEls.current.set(id, el); else petalEls.current.delete(id); }}
                caption={node.objective ? (
                  <span style={{ fontSize: "var(--text-sm)" }}>
                    <span className="text-dim">objective · </span>
                    <ObjectiveTitle title={node.objective.title} />
                  </span>
                ) : undefined} />
            : <span className="text-dim" style={{ fontSize: "var(--text-sm)" }}>spinning up the wheel…</span>}
          {/* Sub-dials: the CEO desk and the instruments, tiny and quiet —
              complications under the face, glanceable, one tap in. */}
          {shownChildren.length > 0 && (
            <div style={{ display: "flex", justifyContent: "center", gap: "var(--space-2)", marginTop: "var(--space-2)", flexWrap: "wrap" }}>
              {shownChildren.map((c) => (
                <button key={c.id} onClick={() => onNavigate(c.id)} className="cv-lift"
                  title={`${displayName(c.title)} — ${KIND_LABEL[c.kind]}`}
                  aria-label={`${displayName(c.title)} ${KIND_LABEL[c.kind]}`}
                  style={{ all: "unset", cursor: "pointer", display: "inline-flex", minHeight: 0, borderRadius: 10 }}>
                  <Medallion icon={nodeIcon(c)} hue={hueFor(c.id, c.kind)} size={34} />
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Constitution: written law is load-bearing — solid white with a
          mind-hued mark. Unwritten categories collapse to ONE ghost line
          (N empty slots cost N cards' weight and carry one fact). */}
      {nodeId === "constitution" && (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))", gap: "var(--space-3)", marginTop: "var(--space-4)" }}>
          {constQ.data?.categories.filter((cat) => cat.content).map((cat) => (
            <div key={cat.id} style={{
              borderRadius: "var(--radius-lg)", padding: "var(--space-5) var(--space-6)",
              background: "var(--panel)", border: "1px solid rgba(0,0,0,0.06)",
              boxShadow: "var(--elev-1)",
            }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <span aria-hidden style={{ width: 6, height: 6, borderRadius: "50%", background: "var(--mind)", flexShrink: 0 }} />
                <span style={{ fontSize: "var(--text-xs)", textTransform: "uppercase", letterSpacing: ".1em", fontWeight: 600, color: "var(--text-dim)" }}>{cat.label}</span>
              </div>
              <div style={{ fontSize: "var(--text-base)", lineHeight: 1.6, marginTop: 8, whiteSpace: "pre-wrap", wordBreak: "break-word" }}>{cat.content}</div>
            </div>
          ))}
          {(constQ.data?.categories.some((cat) => !cat.content) ?? false) && (
            <div style={{
              gridColumn: "1 / -1", borderRadius: "var(--radius-lg)", padding: "var(--space-3) var(--space-5)",
              background: "rgba(255,255,255,0.45)", border: "1px dashed rgba(0,0,0,0.12)",
            }}>
              <span className="text-dim" style={{ fontSize: "var(--text-xs)" }}>
                unwritten · {constQ.data!.categories.filter((cat) => !cat.content).map((cat) => cat.label).join(" · ")}
              </span>
            </div>
          )}
          {constQ.isLoading && <span className="text-dim" style={{ fontSize: "var(--text-sm)" }}>reading the law…</span>}
        </div>
      )}

      {/* A metric node shows its composed evidence — the same cells the
          workspace would build for this topic, live-bound. */}
      {metricEvidence && (
        <div style={{
          marginTop: "var(--space-4)", maxWidth: 780,
          display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))", gap: "var(--space-4)",
        }}>
          {metricEvidence.map((spec) => (
            <Cell key={spec.id} cell={spec} companyId={companyId} onDrill={(p) => onAsk(p)} />
          ))}
        </div>
      )}

      {/* Children: the recursion made visible — each report wears the same
          glyph vocabulary as the wheel, tinted by where it lives. Company
          root excluded: its satellites are the hub row under the face. */}
      {!isCompany && !isWorkNode && shownChildren.length > 0 && (
        <Stratum label="Reports" count={shownChildren.length}
          open={openStrata.has("reports")} onToggle={() => toggleStratum("reports")}>
          <div style={{ display: "flex", gap: "var(--space-2)", flexWrap: "wrap" }}>
            {shownChildren.map((c) => {
              const hue = hueFor(c.id, c.kind, node.kind === "department" ? node.id : undefined);
              return (
                <button key={c.id} onClick={() => onNavigate(c.id)}
                  className="secondary cv-lift"
                  style={{
                    display: "inline-flex", alignItems: "center", gap: 10,
                    background: "var(--panel)", borderRadius: 10, textAlign: "left",
                    padding: "8px 14px 8px 8px", minHeight: 48,
                  }}>
                  <Medallion icon={nodeIcon(c)} hue={hue} size={32} />
                  <span>
                    <span style={{ display: "block", fontSize: "var(--text-sm)", fontWeight: 600, color: "var(--text)" }}>
                      {c.kind === "department" || c.kind === "agent" ? displayName(c.title) : c.title}
                    </span>
                    <span className="text-dim" style={{ display: "block", fontSize: "var(--text-xs)", fontWeight: 400 }}>{KIND_LABEL[c.kind]}</span>
                  </span>
                </button>
              );
            })}
          </div>
        </Stratum>
      )}

      {/* Memory: what this node has LEARNED — authored (the dot wears the
          mind hue), cited, and re-runnable: clicking a claim asks its
          question again, which the precedent path answers instantly.
          Company root excluded — the Learned lens is that fact's address. */}
      {!isCompany && !isWorkNode && memory.length > 0 && (
        <Stratum label="Learned" count={memory.length}
          open={openStrata.has("learned")} onToggle={() => toggleStratum("learned")}>
          <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-2)" }}>
            {memory.map((m) => (
              <button key={m.id} onClick={() => onAsk(m.question)}
                aria-label={`Ask again: ${m.question}`}
                className="secondary"
                style={{
                  display: "flex", alignItems: "center", gap: "var(--space-3)",
                  textAlign: "left", width: "100%", border: "none", background: "transparent",
                  padding: "6px 4px", borderRadius: "var(--radius-sm)", cursor: "pointer",
                }}>
                <span aria-hidden style={{ width: 7, height: 7, borderRadius: "50%", background: "var(--mind)", flexShrink: 0 }} />
                <span style={{ flex: 1, minWidth: 0 }}>
                  <span style={{ display: "block", fontSize: "var(--text-sm)", fontWeight: 400, color: "var(--text)" }}>{m.claim}</span>
                  <span className="text-dim" style={{ display: "block", fontSize: "var(--text-xs)" }}>
                    from “{m.question}” · {ago(m.derivedAt)} · {m.citations.length} citation{m.citations.length === 1 ? "" : "s"}
                  </span>
                </span>
                <span aria-hidden className="text-dim" style={{ fontSize: "var(--text-base)" }}>›</span>
              </button>
            ))}
          </div>
        </Stratum>
      )}
    </div>
  );
}
