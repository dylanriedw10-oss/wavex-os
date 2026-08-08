/** The canvas composer — deterministic stub tier.
 *
 *  The composition ladder:
 *    (a) memory   — utterance/signature hit, stored layout, no LLM   (canvas routes)
 *    (b) t2       — tierRoute-composed layout, validated             (later commit)
 *    (c) stub     — THIS FILE: keyword intent → layout               (always available)
 *
 *  The stub is not scaffolding: it is the permanent floor. It serves dev
 *  without inference, tests, budget-exhausted companies (stub composition is
 *  NOT budget-gated — a capped company still deserves layouts), and the
 *  fallback when T2 emits garbage. It also answers the common drill verbs so
 *  drill-as-reply is instant instead of costing a T2 call per click.
 *
 *  Intent signatures: computed from classified fields, never raw text, and
 *  prefixed with the catalog version ("cv1:") so breaking catalog changes
 *  orphan stored layouts instead of rendering invalid cells. */

import { createHash } from "node:crypto";
import { CATALOG_VERSION, type LayoutSpec } from "./catalog.js";

export type IntentTopic =
  | "spend" | "budget" | "kpis" | "roster" | "redundancy"
  | "ignition" | "health" | "attention" | "simulation" | "timeline"
  | "runtime" | "adopt" | "approve" | "unknown";

export interface ClassifiedIntent {
  kind: "query" | "propose" | "clarify";
  topic: IntentTopic;
  /** bucketed, never absolute dates */
  window: "today" | "7d" | "30d" | "all";
}

export interface Composition {
  intent: ClassifiedIntent;
  reply: string;
  layout: LayoutSpec | null;
  signature: string;
  composedBy: "stub";
  /** set when kind === "propose": the commit action + body the proposal carries */
  proposal?: { action: string; body: Record<string, unknown>; summary: string };
}

/* ------------------------------------------------------------------ */
/* Normalization + signature                                           */
/* ------------------------------------------------------------------ */

/** Utterance key for the exact-repeat cache (rung 0 of the ladder). */
const PREFIX_RE = /^\s*(show me|what's|what is|whats|how is|hows|give me|can you|why did|why is|tell me about)\s+/;

export function utteranceKey(message: string): string {
  let s = message.toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, " ");
  for (let prev = ""; prev !== s; ) { prev = s; s = s.replace(PREFIX_RE, ""); }
  return s.replace(/\s+/g, " ").trim().slice(0, 120);
}

export function intentSignature(intent: ClassifiedIntent): string {
  const canonical = JSON.stringify({ kind: intent.kind, topic: intent.topic, window: intent.window });
  return `cv${CATALOG_VERSION}:` + createHash("sha256").update(canonical).digest("hex").slice(0, 16);
}

/* ------------------------------------------------------------------ */
/* Classification (keyword floor)                                      */
/* ------------------------------------------------------------------ */

// NOTE: stems use \w* rather than a trailing \b — "simulat" followed by a
// word char is NOT a boundary, so /\bsimulat\b/ can never match "simulate".
const TOPIC_RULES: Array<[IntentTopic, RegExp]> = [
  ["simulation", /\b(simulat\w*|strateg\w*|monte ?carlo|what if|scenario\w*)/],
  ["timeline",   /\b(timeline|histor\w*|what happened|chronolog\w*|so far)/],
  ["spend",      /\b(spend|spent|cost\w*|burn\w*|token\w*|usage|expensive)/],
  ["budget",     /\b(budget\w*|cap|caps|limit\w*)/],
  ["ignition",   /\b(ignit\w*|activat\w*|heartbeat\w*|launch\w*|fleet (status|state))/],
  // Live runtime — what the mirrored fleet is doing right now. Must precede
  // roster: "what are the agents working on" is runtime, not org shape.
  ["runtime",    /\b(live|right now|working on|in progress|activit\w*|running|runs)\b/],
  ["redundancy", /\b(redundan\w*|duplicat\w*|overlap\w*)/],
  ["roster",     /\b(roster|team|agents?|org|swarm|who)\b/],
  ["kpis",       /\b(kpis?|goals?|metrics?|targets?|progress|mrr|pipeline)/],
  ["health",     /\b(health\w*|status|how are we|alive)/],
  ["attention",  /\b(attention|needs? me|waiting|blocked|decisions?)/],
];

function classifyWindow(text: string): ClassifiedIntent["window"] {
  if (/\b(today|24 ?h)\b/.test(text)) return "today";
  if (/\b(week|7 ?d)\b/.test(text)) return "7d";
  if (/\b(month|30 ?d)\b/.test(text)) return "30d";
  return "all";
}

/** Verb + budget noun marks a propose intent even with no amount (the
 *  amountless case degrades to clarify rather than guessing). */
const BUDGET_SET_RE = /\b(raise|set|change|lower|increase|decrease)\b.*\b(budget|cap|limit)\b/;
const BUDGET_AMOUNT_RE = /\b(budget|cap|limit)\b\D*?(\d[\d,_.]*)\s*(k|thousand|m|million)?\b/;

export function classify(message: string): ClassifiedIntent {
  const text = message.toLowerCase();
  if (BUDGET_SET_RE.test(text)) return { kind: "propose", topic: "budget", window: "all" };
  if (/\bignite\b/.test(text) && /\b(fleet|now|again|retry)\b/.test(text)) {
    return { kind: "propose", topic: "ignition", window: "all" };
  }
  // Path B: "adopt <product/url>". With a URL present the stub can mint the
  // adopt-product proposal; without one it clarifies (asks for the URL).
  if (/\badopt\b/.test(text) && /\b(product|site|website|company|existing)\b|https?:\/\/|\.[a-z]{2,}\//.test(text)) {
    return { kind: "propose", topic: "adopt", window: "all" };
  }
  // Build Your Organization's one Confirm: the Review phase sends this
  // canned utterance; the route enriches the body from the signed manifest
  // (the stub is sync and never reads disk).
  if (/\bapprove\b/.test(text) && /\b(organization|org|plan)\b/.test(text)) {
    return { kind: "propose", topic: "approve", window: "all" };
  }
  for (const [topic, re] of TOPIC_RULES) {
    if (re.test(text)) return { kind: "query", topic, window: classifyWindow(text) };
  }
  return { kind: "clarify", topic: "unknown", window: "all" };
}

/* ------------------------------------------------------------------ */
/* Deterministic layouts per topic                                     */
/* ------------------------------------------------------------------ */

const LAYOUTS: Partial<Record<IntentTopic, { reply: string; layout: LayoutSpec }>> = {
  spend: {
    reply: "Here's where the tokens went — total, per phase, and over time. Numbers come straight from the usage ledger.",
    layout: {
      title: "Token spend",
      cells: [
        { id: "spend-total", type: "metric", variant: "live", title: "Total spend", source: { api: "token-usage", params: {} }, span: 1 },
        { id: "spend-cap", type: "metric", variant: "gauge", title: "Against cap", source: { api: "token-budget", params: {} }, span: 1 },
        { id: "spend-by-phase", type: "table", title: "By phase", source: { api: "token-usage", params: { view: "breakdown" } }, span: 2,
          drill: [{ label: "Over time", prompt: "show spend over time" }, { label: "Set a cap", prompt: "set the token budget" }] },
        { id: "spend-trend", type: "trend", title: "Recent calls", source: { api: "token-usage", params: { view: "recent" } }, span: 2 },
      ],
    },
  },
  budget: {
    reply: "Current cap and how much of it is used.",
    layout: {
      title: "Token budget",
      cells: [
        { id: "budget-gauge", type: "metric", variant: "gauge", title: "Budget", source: { api: "token-budget", params: {} }, span: 2,
          drill: [{ label: "Spend detail", prompt: "why did spend spike" }] },
      ],
    },
  },
  kpis: {
    reply: "Goal and KPI positions from the manifest and registry.",
    layout: {
      title: "Goals & KPIs",
      cells: [
        { id: "goal", type: "comparison", title: "Headline goal", source: { api: "manifest", params: {} }, span: 2 },
        { id: "kpi-table", type: "table", title: "KPI registry", source: { api: "kpis", params: {} }, span: 2,
          drill: [{ label: "Bottlenecks", prompt: "show kpi bottlenecks" }] },
      ],
    },
  },
  roster: {
    reply: "The resolved team — every slot, its template, and where it reports.",
    layout: {
      title: "Team",
      cells: [
        { id: "roster", type: "agent-roster", title: "Resolved roster", source: { api: "redundancy", params: {} }, span: 2,
          drill: [{ label: "Redundancy", prompt: "show redundant slots" }] },
      ],
    },
  },
  redundancy: {
    reply: "Slots that resolved to the same template, loudest first.",
    layout: {
      title: "Redundancy",
      cells: [
        { id: "redundancy", type: "table", title: "Duplicate templates", source: { api: "redundancy", params: { view: "groups" } }, span: 2 },
      ],
    },
  },
  ignition: {
    reply: "Fleet state after activate — whether ignition ran and what it seeded.",
    layout: {
      title: "Ignition",
      cells: [
        { id: "ignition", type: "attention", title: "Fleet state", source: { api: "ignition", params: {} }, span: 2 },
        { id: "ign-plan", type: "table", thought: "plan", title: "Ignition plan", source: { api: "ignition", params: {} }, span: 2,
          drill: [{ label: "Live runtime", prompt: "what are the agents working on right now" }] },
      ],
    },
  },
  health: {
    reply: "The short version: spend against cap, fleet state, and anything waiting on you.",
    layout: {
      title: "How things stand",
      cells: [
        { id: "h-budget", type: "metric", variant: "gauge", title: "Spend", source: { api: "token-budget", params: {} }, span: 1 },
        { id: "h-ignition", type: "attention", title: "Fleet", source: { api: "ignition", params: {} }, span: 1 },
        { id: "h-goal", type: "comparison", title: "Goal", source: { api: "manifest", params: {} }, span: 2 },
      ],
    },
  },
  simulation: {
    reply: "The Monte Carlo run from finalize — five strategies, the winner highlighted. Bars are mean MRR growth over the horizon.",
    layout: {
      title: "Strategy simulation",
      cells: [
        { id: "sim", type: "simulation", thought: "simulation", salience: 2, title: "Monte Carlo strategies", source: { api: "mc-report", params: {} }, span: 2,
          drill: [{ label: "The goal", prompt: "show goals" }] },
      ],
    },
  },
  timeline: {
    reply: "What has happened, in order — decisions, inference calls, and ignition steps interleaved.",
    layout: {
      title: "Timeline",
      cells: [
        { id: "tl", type: "timeline", thought: "timeline", salience: 1, title: "Recent history", source: { api: "ignition", params: {} }, span: 2,
          drill: [{ label: "Live runtime", prompt: "what are the agents working on right now" }] },
      ],
    },
  },
  runtime: {
    reply: "The mirrored fleet, live — who's working, what's in flight, what's waiting on you. Empty cells mean the fleet hasn't been mirrored yet.",
    layout: {
      title: "Live runtime",
      cells: [
        { id: "rt-now", type: "metric", thought: "observation", variant: "live", title: "Fleet now", source: { api: "runtime-dashboard", params: {} }, span: 1 },
        { id: "rt-approvals", type: "attention", thought: "decision", salience: 2, title: "Waiting on you", source: { api: "runtime-approvals", params: {} }, span: 1 },
        { id: "rt-runs", type: "table", thought: "investigation", title: "In flight", source: { api: "runtime-live-runs", params: {} }, span: 2 },
        { id: "rt-cadence", type: "trend", thought: "progress", title: "Run cadence, 12 days", source: { api: "runtime-dashboard", params: {} }, span: 2 },
        { id: "rt-activity", type: "timeline", thought: "memory", title: "Recent activity", source: { api: "runtime-activity", params: {} }, span: 2,
          drill: [{ label: "Decisions so far", prompt: "what happened so far" }] },
      ],
    },
  },
  attention: {
    reply: "Only the things that need a decision from you.",
    layout: {
      title: "Needs you",
      cells: [
        { id: "queue", type: "attention", source: { api: "ignition", params: {} }, span: 2 },
        { id: "queue-pc", type: "attention", thought: "decision", title: "From the fleet", source: { api: "runtime-approvals", params: {} }, span: 2 },
      ],
    },
  },
};

function parseBudgetTokens(text: string): number | null {
  const m = text.toLowerCase().match(BUDGET_AMOUNT_RE);
  if (!m) return null;
  const n = Number(m[2].replace(/[,_]/g, ""));
  if (!Number.isFinite(n) || n <= 0) return null;
  const mult = m[3]?.startsWith("k") || m[3] === "thousand" ? 1_000
    : m[3]?.startsWith("m") || m[3] === "million" ? 1_000_000 : 1;
  return Math.round(n * mult);
}

/** The deterministic floor. Always returns a Composition; never throws. */
export function composeStub(message: string): Composition {
  const intent = classify(message);
  const signature = intentSignature(intent);

  if (intent.kind === "propose" && intent.topic === "budget") {
    const cap = parseBudgetTokens(message);
    if (cap === null) {
      return {
        intent: { ...intent, kind: "clarify" }, signature, composedBy: "stub", layout: null,
        reply: "What should the cap be? Say a number — for example \"set the budget to 60k\".",
      };
    }
    return {
      intent, signature, composedBy: "stub", layout: null,
      reply: `I can set the token cap to ${cap.toLocaleString()}. Confirm below and I'll apply it.`,
      proposal: {
        action: "set-token-budget",
        body: { cap_tokens: cap },
        summary: `Set the token budget cap to ${cap.toLocaleString()} tokens.`,
      },
    };
  }

  if (intent.kind === "propose" && intent.topic === "adopt") {
    // The URL must be IN the message — the stub never invents one.
    const m = message.match(/\bhttps?:\/\/[^\s<>)\]"']+|\b(?:[\w-]+\.)+[a-z]{2,}(?:\/[^\s<>)\]"']*)?/i);
    if (!m) {
      return {
        intent: { ...intent, kind: "clarify" }, signature, composedBy: "stub", layout: null,
        reply: "Paste your product's URL and I'll read it in — for example \"adopt https://acme.com\".",
      };
    }
    const url = m[0];
    return {
      intent, signature, composedBy: "stub", layout: null,
      reply: `I'll read ${url} and wire the product into your organization. Confirm below — reading it is an outbound fetch plus one inference call.`,
      proposal: {
        action: "adopt-product",
        body: { url },
        summary: `Adopt the existing product at ${url}.`,
      },
    };
  }

  if (intent.kind === "propose" && intent.topic === "approve") {
    return {
      intent, signature, composedBy: "stub", layout: null,
      reply: "Approving activates the organization: agents are hired, the goal and KPIs lock, and the work store seeds. Confirm below.",
      proposal: {
        action: "approve-organization",
        // The route fills manifestSha256 + path from the signed manifest on
        // disk before persisting — the stub stays pure and synchronous.
        body: {},
        summary: "Approve the organization: activate agents, lock the goal and KPIs, seed the work store.",
      },
    };
  }

  if (intent.kind === "propose" && intent.topic === "ignition") {
    return {
      intent, signature, composedBy: "stub", layout: null,
      reply: "Igniting seeds first tasks and turns heartbeats on. It's safe to re-run — it resumes at the first incomplete step. Confirm below.",
      proposal: { action: "ignite-fleet", body: {}, summary: "Ignite the fleet: seed first tasks, wake CEO + CoS, enable heartbeats." },
    };
  }

  const entry = LAYOUTS[intent.topic];
  if (!entry) {
    return {
      intent, signature, composedBy: "stub", layout: null,
      reply: "I can show spend, budget, goals, the team, redundancy, or fleet state — or make a change like \"set the budget to 60k\". What are you after?",
    };
  }
  return { intent, signature, composedBy: "stub", reply: entry.reply, layout: entry.layout };
}
