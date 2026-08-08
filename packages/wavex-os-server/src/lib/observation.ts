/** Observations and claims — provenance as a first-class object.
 *
 *  An inferred fact today is a bare value: `industry_hint: "fintech"`. No
 *  source, no alternatives, no disagreement, no timestamp. That single shape
 *  is what blocks contradiction detection, adaptive questioning, and any
 *  honest account of what the system knows versus what it guessed.
 *
 *  This module gives every value back its origin. It stores nothing new — it
 *  is a projection over artifacts already on disk, the same as
 *  `capability-model.ts`. What it adds is the ONE thing those artifacts drop:
 *  who said so.
 *
 *  ── The generalization ──────────────────────────────────────────────────
 *  `stated: boolean` on the goal is a one-bit claim ledger: did the operator
 *  choose this, or did the system? Everything here is that idea widened from
 *  one bit to a list, and applied to every field rather than one.
 *
 *  ── Storage policy ──────────────────────────────────────────────────────
 *  Observations are IMMUTABLE. A homepage read at 3pm is a fact about 3pm; it
 *  never changes, it only gets superseded by a later read. Claims are
 *  versioned. Inferences are never stored at all — they are recomputed, which
 *  is what this module does on every call. */

/** Where a value came from. Ordered weakest to strongest; the ordering is
 *  used, and it is the whole reason contradiction resolution is possible. */
export type ObservationSource =
  | "inferred"        // a model read a website and guessed
  | "operator"        // a human said so
  | "measurement"     // a system returned a number
  | "research";       // a model discovered it, marked as such

export const SOURCE_RANK: Record<ObservationSource, number> = {
  inferred: 1, research: 2, operator: 3, measurement: 4,
};

/** Immutable. A fact about a moment. */
export interface Observation {
  /** The belief this speaks to — the join key for contradiction detection. */
  key: string;
  value: unknown;
  source: ObservationSource;
  /** The field path it was read from, so the claim can be audited back to
   *  disk rather than taken on trust. */
  at: string;
  /** Human-readable, for the canvas. Always present. */
  note: string;
  /** Position within an ORDERED answer from one source. 0 is primary.
   *
   *  `lead_sources` is collected by a card that says "up to 3, primary
   *  first", so the order carries meaning the first version of this file
   *  threw away — it broke ties toward the LAST observation and therefore
   *  reported an operator's third choice as their answer. */
  rank?: number;
  /** True when the raw value had no entry in the vocabulary below.
   *
   *  Recorded rather than dropped. A lookup miss is `unknown`, not `absent`,
   *  and a value that vanishes silently is exactly the failure this whole
   *  module exists to prevent — the first version of this file discarded
   *  anything it could not map, so a site that said "inbound inquiries"
   *  produced no observation at all and no trace that anything was seen. */
  unmapped?: true;
}

/** Versioned. What we believe, and why.
 *
 *  The three buckets below are the whole point. Collapsing them — as the
 *  first version did — means an operator who names three channels appears to
 *  contradict themselves, and a value nobody has a word for disappears. */
export interface Claim {
  key: string;
  /** What the strongest source asserts. Within one source, the PRIMARY
   *  (lowest rank) wins — not the last one seen. */
  value: unknown;
  /** The strongest source backing `value`. */
  source: ObservationSource;
  /** Observations that agree with `value`. */
  evidence: Observation[];
  /** SAME source, different value. A set, not a conflict: an operator who
   *  names outbound, paid and content has given one answer with three parts,
   *  and asking them to pick would be the product misreading its own card. */
  alternates: Observation[];
  /** DIFFERENT source, different value. The real thing — somebody has to
   *  decide, and this is the only case worth spending a question on. */
  disagreement: Observation[];
  /** Seen, recorded, and not comparable. Their presence is itself a finding:
   *  the vocabulary is missing a word the world used. */
  unmapped: Observation[];
}

/* ── Reading observations off the artifacts ───────────────────────────── */

export interface ObservationSources {
  pillars: {
    pillar_1?: {
      has_product?: boolean; industry_hint?: string; business_model_hint?: string;
      primary_acquisition_channel?: string; revenue_model?: string;
      enrichment_status?: string;
    } | null;
    pillar_3?: { product_state?: string } | null;
    pillar_4?: { lead_sources?: string[]; sales_motion?: string } | null;
  } | null;
  strategy: { goal?: { kpiId?: string; current?: number } | null; stated?: boolean; bottleneck?: string | null } | null;
  manifest: { goal?: { kpiId?: string; current?: number; stated?: boolean } | null } | null;
}

/** TWO AXES, not one.
 *
 *  The first version of this file had a single `acquisition_channel` bucket
 *  and no concept of `inbound` at all, so `inbound_ads_meta_google` became
 *  `"paid"` and the inbound half was thrown away. That is not a naming
 *  quibble: mode and channel answer different questions and drive different
 *  capabilities.
 *
 *    MODE     — did they come to you, or did you go to them?
 *               Decides demand CAPTURE vs demand GENERATION.
 *    CHANNEL  — how did they find you?
 *               Decides which tool and which workflow.
 *
 *  The shipped chip list mixes the axes (`inbound_ads_meta_google` is
 *  mode+channel, `outbound_cold` is mode+tactic, `content_seo` is channel
 *  only), which is why "inbound via referral" and "outbound via events" are
 *  both real and both unsayable in it. Splitting them here is the smallest
 *  honest repair that does not require changing the card.
 *
 *  `null` means the chip genuinely does not determine that axis — a booth at
 *  a trade show is inbound, prospecting the attendee list is outbound, and
 *  `events` cannot tell you which. Saying so beats guessing. */
type Axes = { mode: string | null; channel: string | null };

const AXES_OF_LEAD_SOURCE: Record<string, Axes> = {
  inbound_ads_meta_google: { mode: "inbound", channel: "paid" },
  outbound_cold:           { mode: "outbound", channel: "direct" },
  referral_word_of_mouth:  { mode: "inbound", channel: "referral" },
  content_seo:             { mode: "inbound", channel: "content" },
  product_led_viral:       { mode: "inbound", channel: "product" },
  partnerships:            { mode: null, channel: "partnerships" },
  events:                  { mode: null, channel: "events" },
  none_yet:                { mode: null, channel: null },
};

/** The enrichment side is free-ish text, so this is a best-effort read whose
 *  MISSES ARE RECORDED rather than dropped. */
const AXES_OF_INFERENCE: Record<string, Axes> = {
  inbound: { mode: "inbound", channel: null },
  "inbound inquiries": { mode: "inbound", channel: null },
  inquiries: { mode: "inbound", channel: null },
  outbound: { mode: "outbound", channel: null },
  "outbound sales": { mode: "outbound", channel: "direct" },
  "cold outreach": { mode: "outbound", channel: "direct" },
  "paid ads": { mode: "inbound", channel: "paid" },
  "paid acquisition": { mode: "inbound", channel: "paid" },
  ads: { mode: "inbound", channel: "paid" },
  referral: { mode: "inbound", channel: "referral" },
  "word of mouth": { mode: "inbound", channel: "referral" },
  "content seo": { mode: "inbound", channel: "content" },
  content: { mode: "inbound", channel: "content" },
  seo: { mode: "inbound", channel: "content" },
  "product led": { mode: "inbound", channel: "product" },
  plg: { mode: "inbound", channel: "product" },
  waitlist: { mode: "inbound", channel: "product" },
  partnerships: { mode: null, channel: "partnerships" },
  events: { mode: null, channel: "events" },
};

const norm = (s: string) => s.toLowerCase().trim().replace(/[_-]+/g, " ");

export function readObservations(s: ObservationSources): Observation[] {
  const out: Observation[] = [];
  const p1 = s.pillars?.pillar_1 ?? null;
  const p3 = s.pillars?.pillar_3 ?? null;
  const p4 = s.pillars?.pillar_4 ?? null;

  // Pillar 1 is enrichment output. `manual_capture` means the site could not
  // be read and the operator's own prose was used instead — still their
  // words, run through a model, so it stays `inferred` rather than being
  // promoted. Only a value the operator explicitly set is `operator`.
  const p1Source: ObservationSource = "inferred";

  if (p1) {
    if (typeof p1.industry_hint === "string" && p1.industry_hint && p1.industry_hint !== "unknown") {
      out.push({ key: "industry", value: p1.industry_hint, source: p1Source,
        at: "pillar_1.industry_hint", note: `The site reads as ${p1.industry_hint.replace(/_/g, " ")}.` });
    }
    // has_product DEFAULTS to true in every producer, so a `true` is not an
    // observation at all — it is the absence of one. Only `false` was written
    // on purpose.
    if (p1.has_product === false) {
      out.push({ key: "has_product", value: false, source: p1Source,
        at: "pillar_1.has_product", note: "Nothing on the site indicated a live product." });
    }
    const raw = p1.primary_acquisition_channel;
    if (typeof raw === "string" && raw && raw !== "unspecified") {
      const axes = AXES_OF_INFERENCE[norm(raw)];
      const at = "pillar_1.primary_acquisition_channel";
      const note = `The site suggests ${raw} is the main way customers arrive.`;
      if (!axes) {
        // A word the vocabulary does not have. Recorded on BOTH axes so the
        // gap shows up wherever someone looks, and marked so nothing tries to
        // compare it — the previous behaviour was to drop it entirely, which
        // is how "inbound inquiries" could vanish without trace.
        out.push({ key: "acquisition_mode", value: raw, source: p1Source, at, unmapped: true,
          note: `${note} Nothing in the vocabulary maps "${raw}" to inbound or outbound.` });
        out.push({ key: "acquisition_channel", value: raw, source: p1Source, at, unmapped: true,
          note: `${note} Nothing in the vocabulary maps "${raw}" to a channel.` });
      } else {
        if (axes.mode) out.push({ key: "acquisition_mode", value: axes.mode, source: p1Source, at, note });
        if (axes.channel) out.push({ key: "acquisition_channel", value: axes.channel, source: p1Source, at, note });
      }
    }
  }

  // Pillars 3 and 4 are chips the operator clicked — with the caveat that the
  // cards auto-preselect the model's suggestion, so an untouched confirm is
  // indistinguishable from a choice. `operator` is the honest ceiling here,
  // not a guarantee.
  if (p3?.product_state && p3.product_state !== "other") {
    out.push({ key: "product_state", value: p3.product_state, source: "operator",
      at: "pillar_3.product_state", note: `You said the product is ${p3.product_state.replace(/_/g, " ")}.` });
    // The same answer speaks to has_product, which is what makes the
    // disagreement with pillar_1 detectable at all.
    out.push({ key: "has_product", value: p3.product_state !== "idea_only", source: "operator",
      at: "pillar_3.product_state",
      note: p3.product_state === "idea_only" ? "You said nothing is built yet." : "You said something exists." });
  }

  // The card collecting this says "up to 3, PRIMARY FIRST", so index IS the
  // operator's own ranking and must survive into the claim. Reading the last
  // element — as the first version did — reported a third choice as the
  // answer, and then compared the site's guess against it.
  (p4?.lead_sources ?? []).forEach((ls, rank) => {
    const axes = AXES_OF_LEAD_SOURCE[ls];
    const at = "pillar_4.lead_sources";
    const which = rank === 0 ? "Your primary channel is" : "You also named";
    const label = ls.replace(/_/g, " ");
    if (!axes) {
      out.push({ key: "acquisition_channel", value: ls, source: "operator", at, rank, unmapped: true,
        note: `${which} ${label}, which the vocabulary has no entry for.` });
      return;
    }
    if (axes.mode) {
      out.push({ key: "acquisition_mode", value: axes.mode, source: "operator", at, rank,
        note: `${which} ${label} — customers ${axes.mode === "inbound" ? "come to you" : "are approached by you"}.` });
    }
    if (axes.channel) {
      out.push({ key: "acquisition_channel", value: axes.channel, source: "operator", at, rank,
        note: `${which} ${label}.` });
    }
  });

  // The goal. `stated === true` strictly — a missing flag is not a claim that
  // the operator chose it, and manifests predating the flag carry numbers
  // copied verbatim from the synthesis table.
  // `stated` is a sibling of `goal` on the persisted Strategy — see
  // lib/strategy.ts. Reading it from inside `goal` marked every operator's
  // own target as "assumed, not chosen".
  const goal = s.strategy?.goal ?? s.manifest?.goal ?? null;
  if (goal?.kpiId) {
    const stated = (s.strategy?.goal ? s.strategy.stated : s.manifest?.goal?.stated) === true;
    out.push({ key: "goal_kpi", value: goal.kpiId, source: stated ? "operator" : "inferred",
      at: s.strategy?.goal ? "strategy.goal.kpiId" : "manifest.goal.kpiId",
      note: stated ? `You chose ${goal.kpiId.replace(/_/g, " ")}.` : `${goal.kpiId.replace(/_/g, " ")} was assumed, not chosen.` });
    if (typeof goal.current === "number") {
      out.push({ key: "goal_baseline", value: goal.current, source: stated ? "operator" : "inferred",
        at: "goal.current",
        note: stated ? `You said it is ${goal.current.toLocaleString()} today.` : `${goal.current.toLocaleString()} came from a stage band, not from you.` });
    }
  }
  if (s.strategy?.bottleneck) {
    out.push({ key: "bottleneck", value: s.strategy.bottleneck, source: "operator",
      at: "strategy.bottleneck", note: "Your own read on what's in the way." });
  }

  return out;
}

/* ── Claims and contradictions ────────────────────────────────────────── */

/** Collapse observations into claims.
 *
 *  Two rules that the first version got wrong, both visible in real data:
 *
 *  1. WITHIN one source, the PRIMARY wins — the lowest `rank`, not the last
 *     one seen. Ties break toward first-seen, which is stable.
 *  2. Same-source alternates are a SET, cross-source difference is a
 *     CONFLICT, and an unmapped value is neither. Separating them here means
 *     `findContradictions` cannot accidentally include the first two — the
 *     filtering lives in the shape rather than in a step someone can skip. */
export function toClaims(obs: Observation[]): Claim[] {
  const byKey = new Map<string, Observation[]>();
  for (const o of obs) {
    const arr = byKey.get(o.key) ?? [];
    arr.push(o);
    byKey.set(o.key, arr);
  }
  const out: Claim[] = [];
  for (const [key, list] of byKey) {
    const unmapped = list.filter((o) => o.unmapped);
    const comparable = list.filter((o) => !o.unmapped);
    if (comparable.length === 0) {
      // Everything seen for this key was a word we don't have. That is a real
      // state and it must be visible, not an empty result.
      const first = unmapped[0]!;
      out.push({ key, value: first.value, source: first.source, evidence: [], alternates: [], disagreement: [], unmapped });
      continue;
    }
    const best = comparable.reduce((a, b) => {
      const ra = SOURCE_RANK[a.source], rb = SOURCE_RANK[b.source];
      if (rb !== ra) return rb > ra ? b : a;
      // Same source: the operator's own ordering decides. Unranked sorts last
      // so a ranked answer always beats an unranked one from the same source.
      return (b.rank ?? Number.MAX_SAFE_INTEGER) < (a.rank ?? Number.MAX_SAFE_INTEGER) ? b : a;
    });
    const same = (v: unknown) => JSON.stringify(v) === JSON.stringify(best.value);
    out.push({
      key, value: best.value, source: best.source,
      evidence: comparable.filter((o) => same(o.value)),
      alternates: comparable.filter((o) => !same(o.value) && o.source === best.source),
      disagreement: comparable.filter((o) => !same(o.value) && o.source !== best.source),
      unmapped,
    });
  }
  return out;
}

export interface Contradiction {
  key: string;
  /** What each side says, with its provenance. */
  sides: Array<{ value: unknown; source: ObservationSource; at: string; note: string }>;
  /** The question to put to the operator. This is the highest-value question
   *  in onboarding and it costs nothing to generate — it falls out of having
   *  kept both answers instead of overwriting one. */
  question: string;
}

/** A key claimed differently by two DIFFERENT KINDS of source.
 *
 *  Now a one-line filter, because `toClaims` already separated a set from a
 *  conflict. That is deliberate: the rule lives in the data shape where it
 *  cannot be forgotten, rather than in a guard every caller must remember. */
export function findContradictions(claims: Claim[]): Contradiction[] {
  return claims
    .filter((c) => c.disagreement.length > 0)
    .map((c) => ({
      key: c.key,
      sides: [
        { value: c.value, source: c.source, at: c.evidence[0]!.at, note: c.evidence[0]!.note },
        ...c.disagreement.map((o) => ({ value: o.value, source: o.source, at: o.at, note: o.note })),
      ],
      question: questionFor(c, c.disagreement[0]!),
    }));
}

/** Values the world used that the vocabulary has no word for.
 *
 *  Surfaced separately from contradictions because they are a different kind
 *  of problem: a contradiction needs the OPERATOR to decide, an unmapped
 *  value needs the PRODUCT to grow a word. Routing the second to a human
 *  would be asking them to fix our schema. */
export function findUnmapped(claims: Claim[]): Array<{ key: string; raw: unknown; at: string; note: string }> {
  return claims.flatMap((c) => c.unmapped.map((o) => ({ key: c.key, raw: o.value, at: o.at, note: o.note })));
}

function questionFor(c: Claim, other: Observation): string {
  switch (c.key) {
    case "has_product":
      return c.value === true
        ? "Your site didn't show a live product, but you said something exists. Which should the plan build against?"
        : "Your site looks like it has a live product, but you said nothing is built yet. Which is right?";
    case "acquisition_mode":
      return c.value === "inbound"
        ? "Your site reads as outbound, but your own answers describe customers coming to you. Which should the plan optimize for — capturing demand, or generating it?"
        : "Your site reads as inbound, but you described going out to find customers. Which should the plan optimize for — generating demand, or capturing it?";
    case "acquisition_channel":
      return `Your site points at ${String(other.value)} as the main way customers arrive; your primary is ${String(c.value)}. Which should the plan optimize for?`;
    case "industry":
      return `Your site reads as ${String(other.value)}; you said ${String(c.value)}. Which decides the tools you need?`;
    default:
      return `Two sources disagree about ${c.key.replace(/_/g, " ")}: ${String(c.value)} versus ${String(other.value)}. Which is right?`;
  }
}
