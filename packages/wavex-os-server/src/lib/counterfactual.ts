/** Counterfactual question value — the replacement for confidence scoring.
 *
 *  The question this answers is "which question is worth asking next", and the
 *  tempting way to answer it is a score: rank the fields by how sure the model
 *  feels, ask about the shakiest. That is the bug this whole architecture
 *  exists to avoid. A self-reported 87% is an invented number, and this
 *  codebase has now shipped that invention in four costumes — a revenue
 *  bracket mapped to hardcoded goals, an `ai_estimated` flag that is hardcoded
 *  true and read by nothing, a stage vocabulary with three incompatible
 *  spellings, and a `low_confidence` flag the schema promises and no code
 *  implements.
 *
 *  So don't score it. **Run it.**
 *
 *      value(q) = the number of decisions that come out DIFFERENTLY
 *                 across the plausible answers to q
 *
 *  Fork the belief state, set each candidate answer, recompile, diff. If every
 *  answer produces the same organization, the question is worth nothing and is
 *  never asked. If two answers produce different capabilities, that is the
 *  question — and the operator can be shown both outcomes instead of being
 *  told the question is important.
 *
 *  This is affordable for exactly one reason: the compiler is pure and
 *  deterministic, so a recompile is microseconds and involves no model call.
 *  Research is deliberately held FIXED across the fork — we are testing the
 *  deterministic half, and re-running a model per candidate answer would be
 *  both slow and non-reproducible. */

import {
  buildCapabilityGraph, CAPABILITY_IDS,
  type CapabilityGraph, type CapabilityId, type CapabilitySources, type Presence,
} from "./capability-model.js";
import type { BeliefKey } from "./read-tracker.js";

/** A field the operator could answer, with the answers it could take.
 *
 *  Candidates come from the shipped enums, never from a model — a generated
 *  candidate set would put an invented value back into the loop through the
 *  side door. Free-text fields have no candidate set and therefore no
 *  computable value, which is correct: prose feeds narrative, and decisions
 *  branch on enums and thresholds. */
export interface Candidate {
  key: BeliefKey;
  values: unknown[];
  /** How to write the value into a forked belief state. */
  apply: (s: CapabilitySources, value: unknown) => CapabilitySources;
  /** What to ask, if it turns out to be worth asking. */
  question: string;
  /** Who can answer. Most questions are NOT for the operator — a question
   *  routed to a human that a connector could settle is a tax, not a
   *  conversation. */
  answerer: "operator" | "connector";
  /** What the belief state already says, if anything. A question whose answer
   *  is already known is worth ZERO no matter how much it would have moved —
   *  value measures what asking BUYS, and asking twice buys nothing. */
  current: (s: CapabilitySources) => unknown;
}

const clone = (s: CapabilitySources): CapabilitySources => JSON.parse(JSON.stringify(s)) as CapabilitySources;

const withPillar3 = (s: CapabilitySources, v: unknown): CapabilitySources => {
  const n = clone(s);
  n.pillars = { ...(n.pillars ?? {}), pillar_3: { ...(n.pillars?.pillar_3 ?? {}), product_state: v as string } };
  return n;
};
const withSalesMotion = (s: CapabilitySources, v: unknown): CapabilitySources => {
  const n = clone(s);
  n.pillars = { ...(n.pillars ?? {}), pillar_4: { ...(n.pillars?.pillar_4 ?? {}), sales_motion: v as string } };
  return n;
};
const withLeadSources = (s: CapabilitySources, v: unknown): CapabilitySources => {
  const n = clone(s);
  n.pillars = { ...(n.pillars ?? {}), pillar_4: { ...(n.pillars?.pillar_4 ?? {}), lead_sources: v as string[] } };
  return n;
};
const withVault = (s: CapabilitySources, v: unknown): CapabilitySources => {
  const n = clone(s);
  n.vault = v as CapabilitySources["vault"];
  return n;
};

/** The questions the flow could ask, with their real shipped vocabularies. */
export const CANDIDATES: Candidate[] = [
  {
    key: "pillar_3.product_state",
    values: ["live_paying_customers", "built_not_selling", "prototype_mvp", "idea_only"],
    apply: withPillar3, answerer: "operator",
    current: (s) => s.pillars?.pillar_3?.product_state,
    question: "Where does the product stand?",
  },
  {
    key: "pillar_4.sales_motion",
    values: ["self_serve_plg", "assisted_demo", "high_touch_enterprise", "none_yet"],
    apply: withSalesMotion, answerer: "operator",
    current: (s) => s.pillars?.pillar_4?.sales_motion,
    question: "How do deals close?",
  },
  {
    key: "pillar_4.lead_sources",
    values: [["none_yet"], ["content_seo"], ["outbound_cold"], ["product_led_viral"]],
    apply: withLeadSources, answerer: "operator",
    current: (s) => s.pillars?.pillar_4?.lead_sources,
    question: "How do customers find you?",
  },
  {
    key: "vault.analytics",
    values: [null, [{ connectorId: "mixpanel", status: "vaulted_valid" }]],
    apply: withVault, answerer: "connector",
    current: (s) => s.vault?.find((v) => v.connectorId === "mixpanel" && v.status === "vaulted_valid"),
    question: "Connect an analytics tool so channel attribution becomes observable.",
  },
  {
    key: "vault.crm",
    values: [null, [{ connectorId: "hubspot", status: "vaulted_valid" }]],
    apply: withVault, answerer: "connector",
    current: (s) => s.vault?.find((v) => v.connectorId === "hubspot" && v.status === "vaulted_valid"),
    question: "Connect a CRM so the pipeline and the system of record become observable.",
  },
];

export interface QuestionValue {
  key: BeliefKey;
  question: string;
  answerer: "operator" | "connector";
  /** How many capabilities resolve differently across the candidate answers.
   *  ZERO means never ask — no answer changes the organization. */
  value: number;
  /** Which capabilities move. This is what lets the question justify itself
   *  to the operator: not "this is important" but "answering this decides
   *  whether you get X". */
  changes: CapabilityId[];
  /** The distinct outcomes, so both plans can be SHOWN rather than described. */
  outcomes: Array<{ answer: unknown; presence: Record<string, Presence> }>;
}

/** Compute what each candidate question is worth against a belief state. */
export function valueOfQuestions(base: CapabilitySources, candidates = CANDIDATES): QuestionValue[] {
  return candidates
    .map((c) => {
      // Already answered → value zero. Not "low priority": zero, because the
      // question cannot buy anything that is already owned.
      const known = c.current(base);
      if (known !== undefined && known !== null) {
        return { key: c.key, question: c.question, answerer: c.answerer, value: 0, changes: [], outcomes: [] };
      }
      const outcomes = c.values.map((answer) => {
        const g = buildCapabilityGraph("counterfactual", c.apply(base, answer));
        const presence: Record<string, Presence> = {};
        for (const cap of g.capabilities) presence[cap.id] = cap.presence;
        return { answer, presence };
      });
      // A capability "changes" iff two answers disagree about it. Not "is
      // unknown" — unknown under every answer is not something this question
      // can fix, and counting it would inflate the value of every question.
      const changes = CAPABILITY_IDS.filter((id) =>
        new Set(outcomes.map((o) => o.presence[id])).size > 1);
      return { key: c.key, question: c.question, answerer: c.answerer, value: changes.length, changes: [...changes], outcomes };
    })
    .sort((a, b) => b.value - a.value);
}

/** The next question worth asking, or null.
 *
 *  Null is a real and important answer: it means nothing the system could ask
 *  would change the organization it is proposing, which is the honest
 *  stopping condition for onboarding. "We have asked our list" is not. */
export function nextQuestion(
  base: CapabilitySources,
  opts: { answerer?: "operator" | "connector"; asked?: BeliefKey[] } = {},
): QuestionValue | null {
  const asked = new Set(opts.asked ?? []);
  const ranked = valueOfQuestions(base)
    .filter((q) => q.value > 0 && !asked.has(q.key))
    .filter((q) => (opts.answerer ? q.answerer === opts.answerer : true));
  return ranked[0] ?? null;
}

/** What actually changed between two belief states, at the capability level.
 *  The diff a recompile shows the operator. */
export interface CapabilityDiff {
  id: CapabilityId;
  from: Presence;
  to: Presence;
  because: string;
}

export function diffGraphs(before: CapabilityGraph, after: CapabilityGraph): CapabilityDiff[] {
  const prev = new Map(before.capabilities.map((c) => [c.id, c]));
  return after.capabilities
    .filter((c) => prev.get(c.id)?.presence !== c.presence)
    .map((c) => ({ id: c.id, from: prev.get(c.id)?.presence ?? "unknown", to: c.presence, because: c.because }));
}
