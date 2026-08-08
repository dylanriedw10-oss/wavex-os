/** Parsing the research response.
 *
 *  Same discipline as the refinement parser: never throw, drop with a
 *  warning, and treat unparseable output as "no findings" rather than as a
 *  failure. A model that returns prose costs the operator their research,
 *  not their plan.
 *
 *  The one thing here that is more than validation is `restatesOperatorInput`
 *  — see below. */

import type { ResearchDelta, ResearchFinding } from "./types.js";

const MAX_FINDINGS = 6;
const MAX_ATTACHMENTS = 3;
const HEADLINE_MAX = 120;
const TEXT_MAX = 400;
const MAX_SIGNALS = 4;

const clamp = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1).trimEnd()}…` : s);
const str = (v: unknown): string => (typeof v === "string" ? v.trim() : "");

/** Pull the first balanced JSON object out of a response that may be wrapped
 *  in prose or a ```json fence. */
function extractJson(raw: string): unknown {
  const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/);
  const body = fenced?.[1] ?? raw;
  const start = body.indexOf("{");
  if (start < 0) return null;
  let depth = 0, inStr = false, esc = false;
  for (let i = start; i < body.length; i++) {
    const ch = body[i]!;
    if (esc) { esc = false; continue; }
    if (ch === "\\") { esc = true; continue; }
    if (ch === '"') { inStr = !inStr; continue; }
    if (inStr) continue;
    if (ch === "{") depth++;
    else if (ch === "}" && --depth === 0) {
      try { return JSON.parse(body.slice(start, i + 1)); } catch { return null; }
    }
  }
  return null;
}

function bigrams(s: string): Set<string> {
  const w = s.toLowerCase().replace(/[^a-z0-9\s]/g, " ").split(/\s+/).filter((x) => x.length > 2);
  const g = new Set<string>();
  for (let i = 0; i < w.length - 1; i++) g.add(`${w[i]} ${w[i + 1]}`);
  return g;
}

/** How much of `headline` already appears in `prose` — the CONTAINMENT
 *  coefficient |A ∩ B| / |A|, not Jaccard.
 *
 *  Jaccard is the wrong instrument here and quietly fails the case that
 *  matters: a headline quoting the operator verbatim inside a longer sentence
 *  scores only ~0.5, because every extra bigram in the prose inflates the
 *  union. The question is not "are these two texts alike" (symmetric) but
 *  "has this headline already been said" (asymmetric), and containment
 *  answers exactly that regardless of how much else the prose contains. */
function containment(headline: string, prose: string): number {
  const ga = bigrams(headline), gb = bigrams(prose);
  if (ga.size === 0 || gb.size === 0) return 0;
  let hit = 0;
  for (const g of ga) if (gb.has(g)) hit++;
  return hit / ga.size;
}

/** THE "not interpolating" GUARD, enforced rather than requested.
 *
 *  The spec asks research to discover "approaches the operator's own answers
 *  didn't already name". Asking a model for that in prose gets compliance
 *  most of the time; measuring it makes the property checkable. A headline
 *  whose bigrams are already 70% present in the operator's own prose is
 *  discarded as a restatement.
 *
 *  The threshold is deliberately PERMISSIVE (high = lenient). A false
 *  negative is invisible — one slightly derivative finding survives. A false
 *  positive silently eats the best finding research produced. Given that
 *  asymmetry, err toward letting things through. */
const RESTATEMENT_THRESHOLD = 0.7;

export interface ParseResult {
  findings: ResearchFinding[];
  warnings: string[];
}

export function parseResearchResponse(
  raw: string,
  opts: {
    /** Closed vocabulary from the prompt's own context. */
    allowedSignals: Set<string>;
    /** Operator-authored prose to measure restatement against. */
    operatorProse: string[];
  },
): ParseResult {
  const out: ParseResult = { findings: [], warnings: [] };
  const doc = extractJson(raw);
  if (!doc || typeof doc !== "object") {
    out.warnings.push("research returned no usable JSON");
    return out;
  }

  const rawFindings = (doc as { findings?: unknown }).findings;
  const rawAttachments = (doc as { attachments?: unknown }).attachments;
  if (!Array.isArray(rawFindings)) {
    out.warnings.push("research returned no findings array");
    return out;
  }

  // Deltas first, keyed by finding id, so a finding can pick up its own.
  const deltas = new Map<string, ResearchDelta>();
  if (Array.isArray(rawAttachments)) {
    for (const a of rawAttachments.slice(0, MAX_ATTACHMENTS)) {
      if (!a || typeof a !== "object") continue;
      const r = a as Record<string, unknown>;
      const fid = str(r.finding_id);
      if (!fid || deltas.has(fid)) continue;          // at most one per finding
      const kind = str(r.kind);
      if (kind === "mvp_step_insert") {
        const slot = str(r.assignee_slot), title = str(r.title), deliverable = str(r.deliverable);
        if (!slot || !title || !deliverable) { out.warnings.push(`research: incomplete insert for ${fid}`); continue; }
        deltas.set(fid, { kind, after: str(r.after) || null, title, deliverable, assigneeSlot: slot });
      } else if (kind === "mvp_step_refocus") {
        const target = str(r.target), deliverable = str(r.deliverable);
        if (!target || !deliverable) { out.warnings.push(`research: incomplete refocus for ${fid}`); continue; }
        deltas.set(fid, { kind, target, deliverable });
      } else if (kind) {
        out.warnings.push(`research: unknown attachment kind "${kind}"`);
      }
    }
    if (rawAttachments.length > MAX_ATTACHMENTS) {
      out.warnings.push(`research: ${rawAttachments.length} attachments returned; kept ${MAX_ATTACHMENTS}`);
    }
  }

  const seen = new Set<string>();
  for (const f of rawFindings) {
    if (out.findings.length >= MAX_FINDINGS) {
      out.warnings.push(`research: ${rawFindings.length} findings returned; kept ${MAX_FINDINGS}`);
      break;
    }
    if (!f || typeof f !== "object") continue;
    const r = f as Record<string, unknown>;

    const id = str(r.id).toLowerCase().replace(/[^a-z0-9-]+/g, "-").replace(/^-+|-+$/g, "");
    const headline = str(r.headline);
    const claim = str(r.claim);
    if (!id || !headline || !claim) { out.warnings.push("research: dropped a finding missing id/headline/claim"); continue; }
    if (seen.has(id)) continue;

    const restated = opts.operatorProse.find((p) => containment(headline, p) >= RESTATEMENT_THRESHOLD);
    if (restated) {
      out.warnings.push(`research: dropped ${id} — it restates what the operator already told us`);
      continue;
    }

    // Signals are checked against the closed vocabulary. An unrecognized
    // signal is dropped rather than failing the finding: the claim can still
    // be good even when the model mis-cited its own input.
    const signals = (Array.isArray(r.signals) ? r.signals : [])
      .map(str).filter((s) => opts.allowedSignals.has(s)).slice(0, MAX_SIGNALS);

    const confidence = str(r.confidence);
    seen.add(id);
    out.findings.push({
      id,
      headline: clamp(headline, HEADLINE_MAX),
      claim: clamp(claim, TEXT_MAX),
      rationale: clamp(str(r.rationale), TEXT_MAX),
      signals,
      confidence: confidence === "high" || confidence === "low" ? confidence : "medium",
      delta: deltas.get(id) ?? deltas.get(str(r.id)) ?? null,
    });
  }

  // Highest confidence first — the order the panel reveals them in, and the
  // order the seed preamble truncates against.
  const rank = { high: 0, medium: 1, low: 2 } as const;
  out.findings.sort((a, b) => rank[a.confidence] - rank[b.confidence]);
  return out;
}
