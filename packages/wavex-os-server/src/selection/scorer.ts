/** Deterministic matrix scorer. Picks the strongest template per slot
 *  given the company's pillar signals + connector manifest, by tag
 *  overlap with each candidate's affinities.
 *
 *  Scoring per (slot, template):
 *    score = w_industry * (1 if template.industries contains signal_industry else 0)
 *          + w_stage    * (1 if template.stages contains signal_stage       else 0)
 *          + w_gtm      * (1 if template.gtm contains signal_gtm            else 0)
 *          + w_connector* (count of required connectors in template.connectors / 3)
 *
 *  Default weights are equal-ish; tweak in TUNED_WEIGHTS if needed.
 *
 *  Tie-breaker: catalog default wins over a tied alternative — keeps the
 *  selection conservative (only pick alternatives when they SCORE HIGHER,
 *  not equal). */

import type { CompanyManifest } from "@wavex-os/plugin-onboarding";
import { affinitiesFor, type Industry, type Stage, type Gtm } from "./affinities.js";
import { candidatesForSlot, defaultForSlot } from "./candidates.js";

interface SignalContext {
  industries: Industry[];   // multiple to support fuzzy industry hints (e.g. ["regulated", "fintech"])
  stage: Stage | null;
  gtm: Gtm | null;
  requiredConnectors: Set<string>;
}

const TUNED_WEIGHTS = {
  industry: 0.35,
  stage: 0.20,
  gtm: 0.20,
  connector: 0.25,
};

/** Map pillar 1 industry hints + manual_context keywords to our internal
 *  Industry enum. Returns 1+ tags so e.g. a fintech company also gets the
 *  "regulated" tag and matches templates affinity-tagged for either. */
function deriveIndustries(manifest: CompanyManifest): Industry[] {
  const out = new Set<Industry>();
  const p1 = manifest.pillar_responses.pillar_1;
  const hint = (p1 as { industry_hint?: string }).industry_hint?.toLowerCase() ?? "";
  const ctx = ((p1 as { company_context?: string; manual_context?: string }).company_context
    ?? (p1 as { manual_context?: string }).manual_context ?? "").toLowerCase();

  // Direct hint mapping
  if (hint.includes("b2b_saas") || hint.includes("b2b-saas") || /\bsaas\b/.test(ctx) && /b2b|enterprise|teams?\b/.test(ctx)) out.add("saas-b2b");
  if (hint.includes("b2c_saas") || /b2c|consumer/.test(ctx)) out.add("saas-b2c");
  if (/marketplace|two-sided|matching/.test(ctx) || hint.includes("marketplace")) out.add("marketplace");
  if (/dtc|direct-to-consumer|ecommerce|e-commerce|shopify|skincare|brand/.test(ctx) || hint.includes("ecommerce")) out.add("ecommerce-dtc");
  if (/fintech|payments|banking|lending|stripe|plaid|pci|soc2/.test(ctx) || hint.includes("fintech")) {
    out.add("fintech"); out.add("regulated");
  }
  if (/healthtech|hipaa|clinical|patient|health system|medical|baa/.test(ctx) || hint.includes("health")) {
    out.add("healthtech"); out.add("regulated");
  }
  if (/edtech|k-12|district|curriculum|student|learning/.test(ctx) || hint.includes("edu")) out.add("edtech");
  if (/hardware|machine|manufactur|embroidery|device/.test(ctx) || hint.includes("hardware")) out.add("hardware");
  if (/agency|consult|services|retainer/.test(ctx) || hint.includes("agency")) out.add("agency-services");
  if (/open[- ]?source|github|community|contributors/.test(ctx) || hint.includes("oss") || hint.includes("open")) out.add("open-source");

  return [...out];
}

/** Map pillar 4 sales_motion + lead_sources to a GTM tag. */
function deriveGtm(manifest: CompanyManifest): Gtm | null {
  const p4 = manifest.pillar_responses.pillar_4;
  const motion = (p4 as { sales_motion?: string }).sales_motion ?? "";
  const sources: string[] = (p4 as { lead_sources?: string[] }).lead_sources ?? [];
  if (motion === "none_yet") return "none-yet";
  if (motion === "self_serve_plg") {
    // The card collecting lead_sources says "up to 3, PRIMARY FIRST", so the
    // operator's own ranking decides — not `.includes()` over an unordered
    // set, and not a length gate.
    //
    // The previous shape had both defects: it asked "does this appear
    // anywhere" and then refused to answer at all when three were named
    // (`sources.length <= 2`), so any operator who used the full allowance
    // fell through to a generic "self-serve" and got a different agent
    // roster than one who named the same primary and stopped at two.
    switch (sources[0]) {
      case "inbound_ads_meta_google": return "paid-led";
      case "content_seo": return "community-led";
      case "referral_word_of_mouth": return "referral-led";
      default: return "self-serve";
    }
  }
  if (motion === "high_touch_enterprise") return "high-touch-enterprise";
  if (motion === "assisted_demo") return "assisted-demo";
  return null;
}

/** The `Stage` axis carries 0.20 of the template score, and it has been very
 *  nearly dead.
 *
 *  `Stage` is an ARR ladder — `0_10k_arr`, `100k_500k_arr`, `1m_5m_arr` … —
 *  with one member spelled `10k_100k_mrr`. That is a typo for
 *  `10k_100k_arr`, and the fact that it coincidentally matches a shipped MRR
 *  chip is the only reason ANY company ever scored on this axis. Every
 *  producer of `pillar_3.stage` emits MRR-denominated ids
 *  (`less_than_10k_mrr`, `100k_1m_mrr`, …), and the old body cast the string
 *  straight into the union, so an unrecognised value matched no affinity and
 *  silently scored zero forever.
 *
 *  Renaming the union member would touch ten affinity entries and change
 *  scoring in a way this change cannot validate, so the repair happens at the
 *  BOUNDARY instead: convert to ARR and pick the band.
 *
 *  Preferring the goal's real number over the band string is not an
 *  optimisation — it is the only exact route. A band like
 *  `less_than_10k_mrr` spans 0–120k ARR, which crosses three ARR bands, so
 *  from the string alone the honest answer is `null`. */
const ARR_BANDS: Array<{ maxExclusive: number; stage: Stage }> = [
  { maxExclusive: 10_000, stage: "0_10k_arr" },
  { maxExclusive: 100_000, stage: "10k_100k_mrr" },   // the typo'd 10k-100k ARR member
  { maxExclusive: 500_000, stage: "100k_500k_arr" },
  { maxExclusive: 1_000_000, stage: "500k_1m_arr" },
  { maxExclusive: 5_000_000, stage: "1m_5m_arr" },
  { maxExclusive: 10_000_000, stage: "5m_10m_arr" },
  { maxExclusive: Infinity, stage: "10m_plus_arr" },
];

const PRE_REVENUE = new Set(["pre_product", "pre_launch", "soft_launched"]);

function deriveStage(manifest: CompanyManifest): Stage | null {
  const stage = (manifest.pillar_responses.pillar_3 as { stage?: string }).stage;
  if (stage && PRE_REVENUE.has(stage)) return "pre_product";

  // Exact route: the goal's own baseline, annualised. Only when the goal is
  // revenue-denominated — an activation-rate baseline of 22 is not $22/mo.
  const goal = (manifest as unknown as { goal?: { kpiId?: string; current?: number } }).goal;
  if (goal?.kpiId === "monthly_recurring_revenue" && typeof goal.current === "number") {
    return ARR_BANDS.find((b) => goal.current! * 12 < b.maxExclusive)!.stage;
  }

  // Band-only route. Almost everything is ambiguous across ARR bands, and
  // `null` skips the axis honestly rather than matching nothing while
  // pretending to have an opinion.
  if (stage === "more_than_1m_mrr") return "10m_plus_arr";   // >$12M ARR — unambiguous
  return null;
}

function buildContext(manifest: CompanyManifest): SignalContext {
  const reqIds = new Set(manifest.connector_manifest.required.map((e) => e.id));
  return {
    industries: deriveIndustries(manifest),
    stage: deriveStage(manifest),
    gtm: deriveGtm(manifest),
    requiredConnectors: reqIds,
  };
}

interface ScoredCandidate {
  templateId: string;
  score: number;
  matched: { industries: string[]; stages: string[]; gtm: string[]; connectors: string[] };
}

function scoreCandidate(templateId: string, ctx: SignalContext): ScoredCandidate {
  const aff = affinitiesFor(templateId);

  const matchedIndustries = ctx.industries.filter((i) => aff.industries.includes(i));
  const matchedStages = ctx.stage && aff.stages.includes(ctx.stage) ? [ctx.stage] : [];
  const matchedGtm = ctx.gtm && aff.gtm.includes(ctx.gtm) ? [ctx.gtm] : [];
  const matchedConnectors = aff.connectors.filter((c) => ctx.requiredConnectors.has(c));

  // Per-axis 0..1 normalized
  const industryScore = matchedIndustries.length > 0 ? Math.min(1, matchedIndustries.length / 2) : 0;
  const stageScore = matchedStages.length > 0 ? 1 : 0;
  const gtmScore = matchedGtm.length > 0 ? 1 : 0;
  const connectorScore = Math.min(1, matchedConnectors.length / 3);

  const score =
    TUNED_WEIGHTS.industry * industryScore +
    TUNED_WEIGHTS.stage * stageScore +
    TUNED_WEIGHTS.gtm * gtmScore +
    TUNED_WEIGHTS.connector * connectorScore;

  return {
    templateId, score,
    matched: {
      industries: matchedIndustries,
      stages: matchedStages,
      gtm: matchedGtm,
      connectors: matchedConnectors,
    },
  };
}

export interface SlotSelection {
  slot: string;
  chosenTemplateId: string;
  defaultTemplateId: string;
  /** True when the matrix picked something OTHER than the catalog default. */
  diverged: boolean;
  /** Score for the chosen pick (0..1). When 0, we fell back to default for lack of signal. */
  score: number;
  /** Human-readable reason. Designed to land in the manifest + show up in the swap UI. */
  rationale: string;
  /** Top 3 candidates with scores for transparency. */
  topCandidates: Array<{ templateId: string; score: number }>;
}

function rationaleFor(picked: ScoredCandidate, ctx: SignalContext, isDefault: boolean): string {
  if (isDefault && picked.score === 0) return "no signal — catalog default";
  const parts: string[] = [];
  if (picked.matched.industries.length > 0) parts.push(`industry fit (${picked.matched.industries.join(", ")})`);
  if (picked.matched.stages.length > 0) parts.push(`stage fit (${picked.matched.stages[0]})`);
  if (picked.matched.gtm.length > 0) parts.push(`GTM fit (${picked.matched.gtm[0]})`);
  if (picked.matched.connectors.length > 0) parts.push(`connector fit (${picked.matched.connectors.join(", ")})`);
  if (parts.length === 0) return isDefault ? "catalog default" : `chosen with score ${picked.score.toFixed(2)}`;
  // ctx unused in current message but reserved for future "vs alternatives" expansion
  void ctx;
  return parts.join(" + ");
}

/** Score every candidate for every slot in the swarm; return the chosen
 *  templateId + rationale per slot. Slots without explicit candidates just
 *  return the catalog default with no divergence. */
export function selectTemplatesForManifest(
  manifest: CompanyManifest,
): Map<string, SlotSelection> {
  const ctx = buildContext(manifest);
  const out = new Map<string, SlotSelection>();

  for (const slot of Object.keys(manifest.swarm_manifest.agents)) {
    const candidates = candidatesForSlot(slot);
    const def = defaultForSlot(slot);

    // No alternatives → trivial selection
    if (candidates.length === 1) {
      out.set(slot, {
        slot,
        chosenTemplateId: def,
        defaultTemplateId: def,
        diverged: false,
        score: 0,
        rationale: "no per-company variation defined for this slot",
        topCandidates: [{ templateId: def, score: 0 }],
      });
      continue;
    }

    const scored = candidates.map((c) => scoreCandidate(c, ctx));
    scored.sort((a, b) => b.score - a.score);

    // Tiebreaker: if top candidate's score equals catalog default's score,
    // prefer the catalog default (conservative — only pick alternative when
    // it strictly outscores).
    const top = scored[0]!;
    const defaultScored = scored.find((s) => s.templateId === def)!;
    let picked: ScoredCandidate;
    if (top.score > defaultScored.score) {
      picked = top;
    } else {
      picked = defaultScored;
    }

    const isDefault = picked.templateId === def;
    out.set(slot, {
      slot,
      chosenTemplateId: picked.templateId,
      defaultTemplateId: def,
      diverged: !isDefault,
      score: Math.round(picked.score * 100) / 100,
      rationale: rationaleFor(picked, ctx, isDefault),
      topCandidates: scored.slice(0, 3).map((s) => ({ templateId: s.templateId, score: Math.round(s.score * 100) / 100 })),
    });
  }

  return out;
}

/** Test seam. `deriveGtm` decides which agent templates a company gets, and
 *  its ordering contract is the kind that regresses silently. */
export const __testDeriveGtm = deriveGtm;
/** Test seam. The stage axis is 0.20 of the template score and its ARR/MRR
 *  mismatch was invisible for the same reason every bug in this file was:
 *  a mismatch scores zero, and zero looks exactly like "no signal". */
export const __testDeriveStage = deriveStage;
