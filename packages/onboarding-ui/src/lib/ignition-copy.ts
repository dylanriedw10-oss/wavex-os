/** What the ignition status is allowed to say, in one place.
 *
 *  Two surfaces render this fact — the canvas attention cell and Mission
 *  Control's banner — and they must not be able to disagree, because they
 *  answer the same question ("did my fleet actually start?") from the same
 *  endpoint. The table used to live inside `canvas/cells.tsx`, which is why
 *  the banner had nowhere to reuse it from.
 *
 *  ── What it may claim ────────────────────────────────────────────────────
 *
 *  The old table read:
 *
 *    ignited: `Fleet ignited — ${d.agentsWorking} agents working, ${d.workflowsQueued} queued.`
 *    partial: `Fleet ignited (partial) — ${d.agentsWorking} working, ${d.warnings.length} gaps.`
 *
 *  Both numbers in the first line came from ONE value, and it was neither of
 *  the things it was named after: the read served the seeded task count as
 *  both. A 35-agent company read "Fleet ignited — 7 agents working, 7
 *  queued", a sentence that looks like two measurements and is one number
 *  printed twice. And `warnings.length` is not gaps: a healthy idempotent
 *  re-activate pushes the warning "work store already seeded", so a
 *  perfectly good re-run rendered as "1 gaps".
 *
 *  Now each clause is present only when its own fact is. `agentsWorking` is
 *  nullable at the source — the native ignition variant seeds a goal and
 *  tasks and never looks at the fleet — and a null OMITS the clause rather
 *  than printing a zero. "No agents are working" and "nobody counted" are
 *  different sentences, and only one of them is true here.
 *
 *  Every state also ships a WORD beside its colour, per DESIGN_TOKENS: a
 *  status colour never travels alone. */

export type IgnitionStatusName = "not_activated" | "deferred" | "partial" | "ignited";

export interface IgnitionFacts {
  status: IgnitionStatusName;
  /** null = the run that wrote the state file never recorded one. */
  agentsWorking: number | null;
  workflowsQueued: number;
  gaps: string[];
  warnings: string[];
}

export interface IgnitionLine {
  /** A token, never a literal. */
  tone: string;
  /** The printed word that travels with the tone. */
  word: string;
  headline: string;
  /** The measured clauses, already joined — null when nothing is measurable
   *  yet, which is its own honest state rather than a "0" to render. */
  detail: string | null;
  /** Does this state call for the operator to do something? */
  actionable: boolean;
}

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/** Only the clauses whose facts exist. */
function measured(f: IgnitionFacts): string | null {
  const parts: string[] = [];
  if (f.agentsWorking !== null) parts.push(plural(f.agentsWorking, "agent working", "agents working"));
  if (f.workflowsQueued > 0) parts.push(plural(f.workflowsQueued, "piece of work queued", "pieces of work queued"));
  if (f.gaps.length > 0) parts.push(plural(f.gaps.length, "coverage gap", "coverage gaps"));
  return parts.length > 0 ? parts.join(" · ") : null;
}

export function ignitionLine(f: IgnitionFacts): IgnitionLine {
  switch (f.status) {
    case "not_activated":
      return {
        tone: "var(--text-dim)", word: "not activated",
        headline: "No fleet yet.",
        detail: "Finish building an organization and it will be activated here.",
        actionable: false,
      };
    case "deferred":
      return {
        tone: "var(--warning)", word: "idle",
        headline: "Activated, but never ignited.",
        // The distinction the operator needs: the organization exists, the
        // runtime did not start it. Nothing is lost; nothing is running.
        detail: measured(f) ?? "The organization is committed. Its agents have not been started.",
        actionable: true,
      };
    case "partial":
      return {
        tone: "var(--warning)", word: "partial",
        headline: "Ignited, but not completely.",
        detail: measured(f)
          ?? (f.warnings[0] ?? "Some ignition steps did not complete."),
        actionable: true,
      };
    case "ignited":
      return {
        tone: "var(--success)", word: "running",
        headline: "Fleet ignited.",
        detail: measured(f),
        actionable: false,
      };
  }
}
