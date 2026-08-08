/** The research prompt.
 *
 *  Two structural choices carry the spec's intent, and both are enforced by
 *  the shape of the prompt rather than by asking politely:
 *
 *  1. FULLEST CONTEXT, NOT A NARROW SPECIALIST. Research is structurally
 *     harder than planning and only has real impact where the whole picture
 *     already lives, so this call gets every pillar, the connector manifest
 *     WITH live statuses, and the scope record — not a slice.
 *
 *  2. RESEARCH BEFORE PLANNING, IN THE OUTPUT ITSELF. The response has two
 *     top-level keys and `findings` comes first, so the model must write
 *     every finding before it reaches the attachment section. The spec's
 *     ordering becomes a property of the token stream instead of a hope.
 *
 *  The build chain is supplied as ADDRESSES ONLY — ids and titles, never
 *  deliverables. Research must not be handed the gap it is supposed to be
 *  discovering around; that is the difference between "what is newly
 *  possible" and "critique this plan". */

import type { ConnectorEntry } from "./types-context.js";

export interface ResearchContext {
  companyId: string;
  pillars: Record<string, unknown>;
  connectors: ConnectorEntry[];
  scope: { mode: string; departments: string[] } | null;
  /** Build-chain anchors: `{ id, title }` only. */
  anchors: Array<{ id: string; title: string }>;
  activeSlots: string[];
  /** The operator's OWN opening words, verbatim.
   *
   *  Previously only the enrichment's distillation reached research — the
   *  sentence the operator actually wrote was persisted and read by nothing.
   *  A distillation is a model's summary of intent; the original is the
   *  intent. Both go, and the restatement guard measures against the
   *  original so research can't win by paraphrasing it back. */
  rawInput: string | null;
  /** The stated goal, its baseline, and the operator's own bottleneck.
   *
   *  Research is the terminal consumer of everything and runs exactly once.
   *  Handing it a goal synthesized from a revenue bracket spent its whole
   *  finding budget discovering things that are plausible for a company of
   *  imagined size. `stated: false` is passed through deliberately: research
   *  should know when the target it is planning toward is a guess. */
  strategy: {
    kpiId: string; current: number; target: number; days: number;
    stated: boolean; bottleneck: string | null;
  } | null;
}

/** The closed vocabulary a finding's `signals[]` may cite. Anything outside
 *  it is dropped at parse time, which is what stops "signals" degrading into
 *  free-text justification. Generated from the context we actually send, so
 *  the two cannot drift. */
export function allowedSignals(ctx: ResearchContext): Set<string> {
  const keys = new Set<string>();
  for (const [pillar, v] of Object.entries(ctx.pillars)) {
    if (!v || typeof v !== "object") continue;
    for (const field of Object.keys(v as Record<string, unknown>)) keys.add(`${pillar}.${field}`);
  }
  for (const c of ctx.connectors) keys.add(`connector.${c.id}`);
  if (ctx.scope) keys.add("scope.mode");
  if (ctx.strategy) {
    keys.add("goal.kpiId");
    keys.add("goal.target");
    if (ctx.strategy.bottleneck) keys.add("strategy.bottleneck");
  }
  return keys;
}

const PILLAR_FIELDS: Record<string, string[]> = {
  pillar_1: [
    "org_name", "company_context", "industry_hint", "business_model_hint",
    "ideal_customer_profile", "revenue_model", "competitive_position",
    "primary_acquisition_channel", "product_maturity_signal", "tone_signal",
    "primary_friction_hypothesis", "differentiator_hypothesis",
    "has_product", "enrichment_status",
  ],
  // Load-bearing, not filler: what is "newly possible" is partly a function
  // of how much inference this operator actually has to spend.
  pillar_2: ["claude_plan", "inference_budget_profile"],
  pillar_3: ["product_state", "stage", "kpi_snapshot_initial"],
  pillar_4: ["gtm_profile_enum", "sales_motion", "lead_sources", "close_channel"],
  pillar_5: ["comm_channel", "urgency_routing"],
};

function pick(src: unknown, fields: string[]): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  if (!src || typeof src !== "object") return out;
  for (const f of fields) {
    const v = (src as Record<string, unknown>)[f];
    if (v !== undefined && v !== null && v !== "") out[f] = v;
  }
  return out;
}

export function buildResearchPrompt(ctx: ResearchContext): string {
  // The goal comes FIRST, before the context dump, because it is the frame
  // everything else should be read against: "what is newly possible" is a
  // different question for a company trying to reach its first $5k than for
  // one trying to double $400k. When the goal is a fallback we say so — a
  // model told a target was guessed will hedge differently than one told it
  // was chosen, and that hedging is correct.
  const goalBlock = ctx.strategy
    ? `\nWHAT THE OPERATOR IS TRYING TO DO\n` +
      `  Move ${ctx.strategy.kpiId} from ${ctx.strategy.current.toLocaleString()} to ` +
      `${ctx.strategy.target.toLocaleString()} within ${ctx.strategy.days} days.` +
      (ctx.strategy.stated
        ? ` (Stated by the operator.)`
        : ` (NOT stated by the operator — a stage-band fallback stood in. Treat the target as indicative, and prefer findings that hold regardless of its exact value.)`) +
      (ctx.strategy.bottleneck
        ? `\n  Their own account of what is slowing them down: "${ctx.strategy.bottleneck}"`
        : ``) + `\n`
    : `\nWHAT THE OPERATOR IS TRYING TO DO\n  Not captured. Prefer findings that hold across plausible goals.\n`;

  // The operator's own sentence, unabridged. The enriched distillation is in
  // CONTEXT below; this is what they actually wrote.
  const rawBlock = ctx.rawInput
    ? `\nIN THEIR OWN WORDS\n  "${ctx.rawInput.slice(0, 600)}"\n`
    : ``;

  const context: Record<string, unknown> = {};
  for (const [pillar, fields] of Object.entries(PILLAR_FIELDS)) {
    const picked = pick(ctx.pillars[pillar], fields);
    if (Object.keys(picked).length > 0) context[pillar] = picked;
  }
  // Status matters as much as presence: "Stripe is suggested" and "Stripe is
  // wired" are the difference between a fantasy and a capability.
  context.connectors = ctx.connectors.map((c) => ({ id: c.id, bucket: c.bucket, status: c.status }));
  if (ctx.scope) context.scope = ctx.scope;

  return `You are researching what is newly possible for ONE specific company, before any plan exists.

Your job is DISCOVERY, not planning and not critique. Find approaches this operator's own answers did not already name — capabilities, tactics, or leverage that their specific combination of industry, stage, motion, and wired systems makes available NOW. If a finding merely restates something they told us, it is worthless and will be discarded.
${goalBlock}${rawBlock}
CONTEXT
${JSON.stringify(context, null, 2)}

BUILD-CHAIN ANCHORS (addresses only — these are NOT a gap to fill, and you have not been told what they produce. Use them solely to say where a change would attach.)
${ctx.anchors.length > 0 ? ctx.anchors.map((a) => `  ${a.id} — ${a.title}`).join("\n") : "  (none — this company has no build chain)"}

ACTIVE SLOTS (the only valid assignee_slot values)
${ctx.activeSlots.join(", ")}

Return ONLY JSON, no prose, in exactly this shape:

{
  "findings": [
    {
      "id": "kebab-case-stable-id",
      "headline": "one line, under 120 chars, as the operator would say it",
      "claim": "what is newly possible, under 400 chars",
      "rationale": "why it is possible NOW for THIS company, under 400 chars",
      "signals": ["pillar_1.industry_hint", "connector.stripe"],
      "confidence": "high" | "medium" | "low"
    }
  ],
  "attachments": [
    {
      "finding_id": "the id of a finding above",
      "kind": "mvp_step_insert",
      "after": "an anchor id, or null for the head of the chain",
      "title": "imperative, under 80 chars",
      "deliverable": "what done produces, under 240 chars",
      "assignee_slot": "one of the ACTIVE SLOTS"
    }
  ]
}

Rules:
- Write every finding BEFORE you write any attachment.
- At most 6 findings. Fewer, sharper findings beat more, vaguer ones.
- At most 3 attachments. Attach one only when a finding genuinely changes what should be built; most findings are advisory and that is correct.
- "signals" must name only keys present in CONTEXT above.
- For "kind" you may also use "mvp_step_refocus", which takes "target" (an anchor id) and "deliverable" instead of "after"/"title"/"assignee_slot". It re-aims what an existing step produces; it never renames it.
- If this company has no build chain, return findings with no attachments.`;
}
