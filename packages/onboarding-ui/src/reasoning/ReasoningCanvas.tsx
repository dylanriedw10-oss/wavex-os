/** The Living Canvas — the organization's understanding of itself, rendered.
 *
 *  Not a dashboard and not a progress indicator. What it shows is the
 *  reasoning model: what this organization can do, what its stated goal
 *  requires, what is in the way, and what would be worth learning next.
 *
 *  ── Four rules it holds, each from a failure already paid for ───────────
 *
 *  UNDERSTANDING, NOT COMPLETION. There is no progress bar and no percentage,
 *  because there is no honest denominator — the set of things worth knowing
 *  about an organization is not fixed, and the unknown-unknowns are by
 *  definition not in the count. Every percentage this architecture has
 *  refused would come back through the UI as a ring. Counts only.
 *
 *  THREE STATES, VISIBLE. `present` is solid, `absent` is struck through,
 *  `unknown` is hollow. A hollow slot is a gap in what the system has been
 *  TOLD, not a gap in the company — and the two produce opposite questions.
 *
 *  SPARSE, NEVER EMPTY. Eighteen hollow slots on the first frame say
 *  something an empty pane cannot: here is the shape of what I need to learn
 *  about you. An empty pane just reads as dead.
 *
 *  IT FITS. The fit law is not negotiable: viewport-locked, no page scroll,
 *  and the only scrolling region is the one marked `.cv-record`. "Every
 *  interaction leaves a visible trace" is true of the MODEL; the canvas
 *  renders the model's current state, not the history of reaching it. */

import { useQuery } from "@tanstack/react-query";
import { useSearchParams } from "react-router-dom";

type Presence = "present" | "absent" | "unknown";

interface Verdict {
  id: string; group: string; presence: Presence; evidence: string;
  because: string; reads: string[];
  absenceUnreachable?: boolean; noSignal?: boolean;
}
interface Graph {
  capabilities: Verdict[];
  tally: { present: number; absent: number; unknown: number; noSignal: number };
  goalProvenance: "stated" | "fallback" | "unknown" | "none";
}
interface Strategy { id: string; label: string; leadTimeDays: number; fragility: string; because: string }
interface GapItem { capability: string; presence: "absent" | "unknown"; blockedBy: string[]; strategies: Strategy[]; revealedBy?: string }
interface Transformation {
  goal: { kpiId: string; days: number; provenance: string } | null;
  required: string[]; have: string[]; gap: GapItem[];
  bindingConstraint: string | null; constraintUnknown: boolean;
  sequence: string[]; notes: string[];
}
interface Contradiction { key: string; question: string; sides: Array<{ value: unknown; source: string; note: string }> }
interface QuestionValue { key: string; question: string; answerer: string; value: number; changes: string[] }

const human = (s: string) => s.replace(/_/g, " ");
const api = async <T,>(path: string): Promise<T> => {
  const r = await fetch(path);
  if (!r.ok) throw new Error(`${r.status}`);
  return r.json() as Promise<T>;
};

/* ── The three states, made visible ───────────────────────────────────── */

function Slot({ v }: { v: Verdict }) {
  const solid = v.presence === "present";
  const struck = v.presence === "absent";
  return (
    <div
      title={`${v.because}${v.reads.length ? `\n\nRead from: ${v.reads.join(", ")}` : ""}`}
      style={{
        display: "flex", alignItems: "center", gap: 8, padding: "3px 0",
        fontSize: "var(--text-xs)", minWidth: 0, cursor: "help",
      }}>
      <span aria-hidden style={{
        width: 9, height: 9, borderRadius: 999, flexShrink: 0,
        // present = filled, absent = a struck marker, unknown = hollow.
        background: solid ? "var(--text)" : "transparent",
        border: `1px solid ${struck ? "var(--warning)" : "var(--border)"}`,
      }} />
      <span style={{
        whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis",
        textDecoration: struck ? "line-through" : "none",
        color: solid ? "var(--text)" : "var(--text-dim)",
        opacity: v.presence === "unknown" ? 0.75 : 1,
      }}>{human(v.id)}</span>
      {/* A permanent unknown is a hole in the ontology, not a fact about the
          company, and it must not read like one. */}
      {v.noSignal && <span className="text-dim" style={{ fontSize: 10, flexShrink: 0, opacity: 0.6 }}>⌀</span>}
      {v.evidence === "system-observed" && (
        <span style={{ fontSize: 10, flexShrink: 0, color: "var(--mind)" }} title="observed from a connected system">◆</span>
      )}
    </div>
  );
}

function Group({ name, items }: { name: string; items: Verdict[] }) {
  return (
    <div style={{ minWidth: 0 }}>
      <div className="text-dim" style={{
        fontSize: 10, textTransform: "uppercase", letterSpacing: ".1em", marginBottom: 2,
      }}>{name}</div>
      {items.map((v) => <Slot key={v.id} v={v} />)}
    </div>
  );
}

/* ── The canvas ───────────────────────────────────────────────────────── */

export function ReasoningCanvas() {
  const [params] = useSearchParams();
  const companyId = params.get("companyId") ?? "";

  const graph = useQuery({
    queryKey: ["capabilities", companyId], enabled: !!companyId,
    queryFn: () => api<{ ok: true } & Graph>(`/api/instance/${companyId}/capabilities`),
  });
  const tx = useQuery({
    queryKey: ["transformation", companyId], enabled: !!companyId,
    queryFn: () => api<{ transformation: Transformation }>(`/api/instance/${companyId}/reasoning/transformation`),
  });
  const contra = useQuery({
    queryKey: ["contradictions", companyId], enabled: !!companyId,
    queryFn: () => api<{ contradictions: Contradiction[] }>(`/api/instance/${companyId}/reasoning/contradictions`),
  });
  const questions = useQuery({
    queryKey: ["questions", companyId], enabled: !!companyId,
    queryFn: () => api<{ questions: QuestionValue[]; settled: boolean }>(`/api/instance/${companyId}/reasoning/questions`),
  });

  if (!companyId) {
    return <Shell><p className="text-dim">Add <code>?companyId=…</code> to see an organization.</p></Shell>;
  }

  const g = graph.data;
  const t = tx.data?.transformation;
  const groups = new Map<string, Verdict[]>();
  for (const c of g?.capabilities ?? []) {
    groups.set(c.group, [...(groups.get(c.group) ?? []), c]);
  }
  // Only questions the counterfactual proved matter. Zero-value questions are
  // never shown — that is the whole point of computing rather than scoring.
  const worthAsking = (questions.data?.questions ?? []).filter((q) => q.value > 0);

  return (
    <Shell>
      <header style={{
        display: "flex", alignItems: "baseline", gap: "var(--space-3)",
        paddingBottom: "var(--space-3)", borderBottom: "1px solid var(--border)", flexShrink: 0,
      }}>
        <span style={{ fontWeight: 700 }}>What we understand about <span className="text-dim">{companyId}</span></span>
        {g && (
          // Counts, never a percentage. There is no honest denominator.
          <span className="text-dim" style={{ marginLeft: "auto", fontSize: "var(--text-xs)" }}>
            {g.tally.present} in place · {g.tally.absent} missing · {g.tally.unknown} not yet known
          </span>
        )}
      </header>

      <div style={{
        flex: 1, minHeight: 0, display: "grid",
        gridTemplateColumns: "minmax(280px, 1fr) minmax(320px, 1.15fr)",
        gap: "var(--space-5)", paddingTop: "var(--space-4)", overflow: "hidden",
      }}>
        {/* LEFT — the capability graph. Sparse from the first frame, never
            empty: the hollow slots ARE the message. */}
        <section style={{ display: "flex", flexDirection: "column", gap: "var(--space-3)", minHeight: 0, overflow: "hidden" }}>
          {graph.isLoading && <span className="text-dim cv-breathe" style={{ fontSize: "var(--text-sm)" }}>reading what already exists…</span>}
          {[...groups.entries()].map(([name, items]) => <Group key={name} name={name} items={items} />)}
          {g && (
            <div className="text-dim" style={{ fontSize: 10, marginTop: "auto", paddingTop: "var(--space-2)", lineHeight: 1.6 }}>
              ⌀ nothing on disk speaks to this &nbsp;·&nbsp; ◆ observed from a connected system
              <br />hover any line for its evidence
            </div>
          )}
        </section>

        {/* RIGHT — the transformation, and the questions worth asking. The
            ONE scrolling region, per the fit law's named exception. */}
        <section className="cv-record" style={{ minHeight: 0, overflowY: "auto", display: "flex", flexDirection: "column", gap: "var(--space-4)" }}>
          {t?.goal ? (
            <div>
              <Eyebrow>the goal</Eyebrow>
              <div style={{ fontSize: "var(--text-lg)", fontWeight: 600 }}>
                {human(t.goal.kpiId)} <span className="text-dim" style={{ fontWeight: 400 }}>in {t.goal.days} days</span>
              </div>
              {/* An unconfirmed target must say so BEFORE anything is executed
                  against it — the loop measures its own work against this. */}
              {t.goal.provenance !== "stated" && (
                <div style={{ fontSize: "var(--text-xs)", color: "var(--warning)", marginTop: 2 }}>
                  {t.goal.provenance === "fallback"
                    ? "Estimated — a stage band stood in for a goal nobody stated."
                    : "No record of who chose this. Treat it as unconfirmed."}
                </div>
              )}
            </div>
          ) : t && <div><Eyebrow>the goal</Eyebrow><span className="text-dim">Not stated yet.</span></div>}

          {t && t.gap.length > 0 && (
            <div>
              <Eyebrow>what's in the way</Eyebrow>
              {t.constraintUnknown && (
                <div style={{ fontSize: "var(--text-xs)", color: "var(--warning)", marginBottom: 6 }}>
                  Most of the gap is unobserved rather than known-missing — the real constraint may be something nothing has told us about yet.
                </div>
              )}
              {t.sequence.map((cap) => {
                const item = t.gap.find((x) => x.capability === cap);
                if (!item) return null;
                const binding = t.bindingConstraint === cap;
                return (
                  <div key={cap} style={{
                    padding: "8px 0", borderTop: "1px solid var(--border)",
                  }}>
                    <div style={{ display: "flex", alignItems: "baseline", gap: 8, fontSize: "var(--text-sm)" }}>
                      <span style={{ fontWeight: binding ? 650 : 400 }}>{human(cap)}</span>
                      {binding && <span style={{ fontSize: 10, color: "var(--mind)" }}>MOST IN THE WAY</span>}
                      <span className="text-dim" style={{ fontSize: 10, marginLeft: "auto" }}>
                        {item.presence === "unknown" ? "not yet known" : "missing"}
                      </span>
                    </div>
                    {item.blockedBy.length > 0 && (
                      <div className="text-dim" style={{ fontSize: "var(--text-xs)" }}>
                        waits on {item.blockedBy.map(human).join(", ")}
                      </div>
                    )}
                    {/* Strategies are PROPOSED. The operator decides — this is
                        where their authority lives in the graph. */}
                    {item.strategies.map((s) => (
                      <div key={s.id} style={{ display: "flex", gap: 8, fontSize: "var(--text-xs)", paddingLeft: 10, marginTop: 3 }}>
                        <span style={{ color: "var(--mind)" }}>▸</span>
                        <span style={{ minWidth: 0 }}>
                          <span style={{ color: "var(--text)" }}>{s.label}</span>
                          <span className="text-dim"> · {s.leadTimeDays}d · {s.fragility}</span>
                        </span>
                      </div>
                    ))}
                    {item.strategies.length === 0 && item.presence === "absent" && (
                      <div className="text-dim" style={{ fontSize: "var(--text-xs)", paddingLeft: 10 }}>
                        No approach fits inside {t.goal?.days} days from here.
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}

          {(contra.data?.contradictions.length ?? 0) > 0 && (
            <div>
              <Eyebrow>two sources disagree</Eyebrow>
              {contra.data!.contradictions.map((c) => (
                <div key={c.key} style={{ fontSize: "var(--text-sm)", padding: "6px 0", borderTop: "1px solid var(--border)" }}>
                  {c.question}
                  <div className="text-dim" style={{ fontSize: "var(--text-xs)", marginTop: 2 }}>
                    {c.sides.map((s) => `${s.source}: ${String(s.value)}`).join("  ·  ")}
                  </div>
                </div>
              ))}
            </div>
          )}

          <div>
            <Eyebrow>worth asking next</Eyebrow>
            {questions.data?.settled && (
              <div className="text-dim" style={{ fontSize: "var(--text-sm)" }}>
                Nothing left to ask would change the organization.
              </div>
            )}
            {worthAsking.map((q) => (
              <div key={q.key} style={{ fontSize: "var(--text-sm)", padding: "6px 0", borderTop: "1px solid var(--border)" }}>
                <div style={{ display: "flex", gap: 8, alignItems: "baseline" }}>
                  <span style={{ minWidth: 0 }}>{q.question}</span>
                  <span className="text-dim" style={{ fontSize: 10, marginLeft: "auto", flexShrink: 0 }}>{q.answerer}</span>
                </div>
                {/* The question justifies itself by naming what it moves,
                    rather than asserting that it matters. */}
                <div className="text-dim" style={{ fontSize: "var(--text-xs)" }}>
                  decides {q.changes.map(human).join(", ")}
                </div>
              </div>
            ))}
          </div>

          {t && t.notes.length > 0 && (
            <div>
              <Eyebrow>notes</Eyebrow>
              {t.notes.map((n) => (
                <p key={n} className="text-dim" style={{ fontSize: "var(--text-xs)", margin: "0 0 6px", lineHeight: 1.6 }}>{n}</p>
              ))}
            </div>
          )}
        </section>
      </div>
    </Shell>
  );
}

const Eyebrow = ({ children }: { children: React.ReactNode }) => (
  <div className="text-dim" style={{
    fontSize: 10, textTransform: "uppercase", letterSpacing: ".1em", marginBottom: 4,
  }}>{children}</div>
);

/** Viewport-locked. The page never scrolls; exactly one region inside does. */
function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div className="canvas-root" style={{
      height: "100dvh", overflow: "hidden", display: "flex", flexDirection: "column",
      padding: "var(--space-5) var(--space-6)",
    }}>
      {children}
    </div>
  );
}
