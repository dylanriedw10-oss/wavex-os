/** Pillar 1-5 routes. Thin Fastify handlers that:
 *  1. Validate the body via zod (matching upstream Express schemas)
 *  2. Apply auth gates via @wavex-os/auth-shim
 *  3. Delegate to the vendored plugin handler
 *  4. Persist the response via savePillarResponses + updatePillar
 *  5. Return JSON shaped to match upstream contract */

import { z } from "zod";
import type { FastifyInstance, FastifyRequest } from "fastify";
import { spawn } from "node:child_process";
import { platform } from "node:os";
import {
  handlePillar1, handlePillar2, handlePillar3, handlePillar4, handlePillar5,
  loadPillarResponses, savePillarResponses, updatePillar,
  isOnboardingHaltError,
  emptyPillarResponses,
  isPillarResponsesComplete,
  nextIncompletePillar,
  looksLikeNoProduct,
} from "@wavex-os/plugin-onboarding";
import type { Pillar1Response } from "@wavex-os/plugin-onboarding";
import { route as tierRoute } from "@wavex-os/plugin-tier-router";
import { fetchPage } from "../lib/url-prefetch.js";
import { assertBoard, assertCompanyAccess, AuthError } from "@wavex-os/auth-shim";
import { getInferenceMode } from "@wavex-os/inference-adapter";
import { withTokenAccounting, type PhaseKey } from "../lib/token-accounting.js";
import { BudgetExhaustedError } from "../lib/token-budget.js";

// QA P0-2: BYOC always-enrich for Pillar 1. The vendored handlePillar1
// short-circuits to regex heuristics when manual_context >= 40 chars
// (`enrichment_status: "manual_capture"`). The heuristic invents fields
// like `ideal_customer_profile: "enterprise ops teams"` which then leak
// into every downstream agent's CONTEXT.md. This helper detects the
// short-circuit and runs a follow-up BYOC claude call to refine.
const IS_WIN_P1 = platform() === "win32";
const PILLAR1_CLAUDE_TIMEOUT_MS = 25_000;

/** Spawn local claude with a bounded prompt, parse a single-line JSON
 *  envelope from stdout. Returns null on any failure (claude missing,
 *  not authed, parse fail, timeout). Caller falls back to the
 *  heuristic in that case. */
function runClaudeForPillar1Enrichment(prompt: string): Promise<Record<string, unknown> | null> {
  return new Promise((resolve) => {
    const claudeBin = IS_WIN_P1 ? "claude.cmd" : "claude";
    const child = spawn(
      claudeBin,
      [
        "-p", prompt,
        "--output-format", "text",
        "--disallowedTools", "*",
        "--exclude-dynamic-system-prompt-sections",
      ],
      { shell: IS_WIN_P1 },
    );
    let stdout = "";
    child.stdout?.on("data", (d) => { stdout += d.toString(); });
    const timer = setTimeout(() => {
      try { child.kill("SIGTERM"); } catch { /* ignore */ }
      resolve(null);
    }, PILLAR1_CLAUDE_TIMEOUT_MS);
    child.on("error", () => { clearTimeout(timer); resolve(null); });
    child.on("close", (code) => {
      clearTimeout(timer);
      if (code !== 0) { resolve(null); return; }
      try {
        const cleaned = stdout.replace(/^```(?:json)?\s*|\s*```$/gm, "").trim();
        const parsed = JSON.parse(cleaned);
        if (parsed && typeof parsed === "object") {
          resolve(parsed as Record<string, unknown>);
        } else {
          resolve(null);
        }
      } catch {
        resolve(null);
      }
    });
  });
}

// WAVAAAA-153: Consolidated Pillar 1 BYOC extraction — 1 call instead of 2.
//
// Prior design (2-step): vendor handlePillar1 ran regex heuristics for the
// manual_context path, then a second BYOC call "refined" those heuristics.
// The heuristic step invented values (ideal_customer_profile: "enterprise ops
// teams") that the refinement step often failed to correct. Two T2 calls,
// fabricated intermediates, and $0.70/run.
//
// New design: a single BYOC call extracts ALL fields directly from the
// founder's text with no heuristic starting point. Used as the fallback when
// the combined tier-router path (WAVAAAA-152) is unavailable (offline, Pool A
// shim broken, etc.).
function buildConsolidatedPillar1Prompt(opts: {
  orgName: string;
  rawInput: string;
  manualContext: string;
}): string {
  return `You are a startup intelligence assistant. A founder described their company below. Extract ALL structured signals from what they actually said — do not invent anything not present in the text.

ORG NAME: ${opts.orgName}

RAW INPUT:
${opts.rawInput}

FOUNDER'S DESCRIPTION:
${opts.manualContext}

Return ONLY a single JSON object (no prose, no backticks, no code fences):
{
  "company_context": "<150-300 word prose summary of what they do, who they serve, and how they make money — drawn only from what the founder said>",
  "industry_hint": "<one of: dev_tools|b2b_saas|consumer_mobile|consumer_ai|consumer_hardware|dtc_ecommerce|fintech|fintech_retail|healthtech|edtech|legal_tech|marketplace|agency_services|services_to_saas|dev_infrastructure|enterprise_saas|b2c|unknown>",
  "business_model_hint": "<one of: subscription|usage_based|one_time|marketplace|open_core|unknown>",
  "ideal_customer_profile": "<≤60 chars — who specifically uses this, in the founder's own words>",
  "revenue_model": "<≤40 chars — how money is made>",
  "competitive_position": "<one of: emerging|challenger|leader|category_leader|vertical_specialist|niche|unvalidated>",
  "primary_acquisition_channel": "<one of: content_seo|outbound_sales|referral|paid_ads|partnerships|waitlist|community_led|creator_led|unspecified>",
  "product_maturity_signal": "<one of: pre_mvp|mvp|ga|mature|legacy>",
  "tone_signal": "<one of: technical|friendly|authoritative|playful|enterprise>",
  "primary_friction_hypothesis": "<≤200 chars — where this company's customers likely hit friction>",
  "differentiator_hypothesis": "<≤200 chars — what makes them distinct, in the founder's own framing>",
  "has_product": <true or false>
}

Hard rules:
- Use ONLY what the founder said. If they name a specific ICP (e.g. "mobile-app QA teams") use that verbatim — never substitute "enterprise ops teams" or similar generic categories.
- If a field genuinely cannot be determined, use "unknown" for enum fields, "unspecified" for open strings, true for has_product.
- If they say "pre-revenue" or "no paying customers", set competitive_position to "emerging" and has_product to false.
- For differentiator_hypothesis, paraphrase the founder's framing — do not invent benefits they didn't claim.`;
}

/** Single consolidated BYOC extraction for the manual_context fallback path.
 *  Replaces the 2-step (vendor heuristics → BYOC refinement) with one call.
 *  Returns null if claude is unavailable or times out; caller falls back to
 *  vendor heuristics in that case. */
async function consolidatedPillar1Enrich(opts: {
  orgName: string;
  rawInput: string;
  manualContext: string;
}): Promise<Pillar1Response | null> {
  const prompt = buildConsolidatedPillar1Prompt(opts);
  const refined = await runClaudeForPillar1Enrichment(prompt);
  if (!refined) return null;

  const s = (v: unknown): string | undefined =>
    typeof v === "string" ? v : undefined;
  const sliced = (v: unknown, max: number): string | undefined =>
    typeof v === "string" ? v.slice(0, max) : undefined;

  return {
    org_name: opts.orgName,
    company_context: sliced(refined.company_context, 1200) ?? opts.manualContext.slice(0, 1200),
    enrichment_status: "enriched",
    has_product: typeof refined.has_product === "boolean" ? refined.has_product : true,
    industry_hint: s(refined.industry_hint) ?? "unknown",
    // "unknown", not "subscription". The enum carries the honest sentinel,
    // the prompt above explicitly instructs the model to use it, and the
    // sibling line does. Defaulting to a real business model turned "the
    // model said nothing" into the extracted claim "they sell subscriptions"
    // — indistinguishable from an answer, and rendered as a fact chip on the
    // operator's own company core.
    business_model_hint: s(refined.business_model_hint) ?? "unknown",
    ideal_customer_profile: s(refined.ideal_customer_profile),
    revenue_model: s(refined.revenue_model),
    competitive_position: s(refined.competitive_position),
    primary_acquisition_channel: s(refined.primary_acquisition_channel),
    product_maturity_signal: s(refined.product_maturity_signal) as
      Pillar1Response["product_maturity_signal"],
    tone_signal: s(refined.tone_signal) as Pillar1Response["tone_signal"],
    primary_friction_hypothesis: sliced(refined.primary_friction_hypothesis, 200),
    differentiator_hypothesis: sliced(refined.differentiator_hypothesis, 200),
    raw_input: opts.rawInput,
    enriched_at: new Date().toISOString(),
    enriched_via: "claude_oauth" as const,
  } as Pillar1Response;
}

// ── Combined Pillar 1 enrichment (WAVAAAA-157) ─────────────────────────────
//
// Replaces up to 2 sequential T2 calls (vendored deep-dive + BYOC refinement)
// with 1 combined T2 call against pre-fetched URL content.
//
// Why: the vendored handlePillar1 instructs Claude to browse multiple pages
// (reasoning_depth: "deep", timeout 180s), costing ~85s P50. By fetching the
// homepage server-side and sending the text directly, Claude only needs to do
// structured extraction (reasoning_depth: "shallow", timeout 45s) → ~20-25s.
//
// Fallback: if URL fetch fails or combined T2 fails, we fall through to the
// original vendored path so onboarding never hard-blocks.

const COMBINED_T2_TIMEOUT_MS = 45_000;
const COMBINED_URL_CONTENT_MAX = 12_000;

function looksLikeUrl(s: string): boolean {
  const t = s.trim().split(/\s/)[0];
  return /^https?:\/\//i.test(t) || /^(?:[\w-]+\.)+[\w]{2,}(\/|$)/i.test(t);
}

async function fetchUrlContent(rawInput: string): Promise<string | null> {
  if (!looksLikeUrl(rawInput)) return null;
  // The hardened fetcher (lib/url-prefetch.ts): SSRF host filter, one-hop
  // meta-refresh follow, parked-domain + thin-content detection. The old
  // inline fetch here had none of those — a parked domain fed the model
  // "buy this domain" prose and it confidently invented a company from it.
  // The null contract is unchanged: any non-ok outcome degrades to the
  // no-homepage prompt path.
  const page = await fetchPage(rawInput);
  if (page.status !== "ok" || !page.body) return null;
  return page.body.slice(0, COMBINED_URL_CONTENT_MAX);
}

function buildCombinedEnrichmentPrompt(opts: {
  orgName: string;
  rawInput: string;
  urlContent: string | null;
  manualContext: string | undefined;
}): string {
  const parts: string[] = [
    `Org name: ${opts.orgName}`,
    `Raw input: ${opts.rawInput}`,
  ];
  if (opts.urlContent) {
    parts.push(`Homepage content (server-fetched, first 12 K chars):\n${opts.urlContent}`);
  }
  if (opts.manualContext && opts.manualContext.length >= 40) {
    parts.push(`Operator description (overrides homepage where more specific):\n${opts.manualContext}`);
  }
  return `You are extracting structured Pillar 1 onboarding signals for WaveX OS. Use only the provided content — do not browse the web.

${parts.join("\n\n")}

Rules:
1. Be evidence-driven. Name specific products, customer types, and pricing when the content states them.
2. Never hallucinate revenue numbers, customer names, or growth metrics not present in the input.
3. If content is sparse, infer the most plausible values from the company name and domain.
4. primary_friction_hypothesis: one crisp sentence about the single biggest obstacle to 10× growth.
5. differentiator_hypothesis: what makes this company distinctly different from direct peers.

Return ONLY this JSON object — no prose, no markdown fences:
{
  "company_context": "150-300 words describing what the company does, who it serves, how it makes money, and what is distinctive",
  "industry_hint": "enterprise_saas|b2b_saas|b2c|dev_tools|marketplace|dtc_ecommerce|fintech|fintech_retail|healthtech|edtech|legal_tech|consumer_mobile|agency_services|services_to_saas|dev_infrastructure|consumer_hardware|consumer_ai|unknown",
  "business_model_hint": "subscription|usage_based|one_time|marketplace|open_core|unknown",
  "ideal_customer_profile": "≤60 chars — who the product serves",
  "revenue_model": "≤40 chars — how money is made",
  "competitive_position": "category leader|vertical specialist|niche|emerging|unvalidated",
  "primary_acquisition_channel": "content seo|outbound sales|referral|paid ads|partnerships|waitlist|community-led|creator-led",
  "product_maturity_signal": "pre_mvp|mvp|ga|mature|legacy",
  "tone_signal": "technical|friendly|authoritative|playful|enterprise",
  "primary_friction_hypothesis": "≤200 chars",
  "differentiator_hypothesis": "≤200 chars",
  "has_product": true
}`;
}

export async function runCombinedPillar1Enrichment(opts: {
  orgName: string;
  rawInput: string;
  urlContent: string | null;
  manualContext: string | undefined;
  companyId: string;
}): Promise<Omit<Pillar1Response, "enriched_at"> | null> {
  const hasUrlContent = !!opts.urlContent;
  const hasManualContext = !!(opts.manualContext && opts.manualContext.length >= 40);
  if (!hasUrlContent && !hasManualContext) return null;

  const prompt = buildCombinedEnrichmentPrompt(opts);
  const resp = await tierRoute({
    agent_id: "onboarding.pillar-1-combined",
    prompt,
    task_metadata: {
      creativity_required: false,
      customer_facing: false,
      reasoning_depth: "shallow",
      priority: "high",
    },
    companyId: opts.companyId,
    outputFormat: "json",
    timeout_ms: COMBINED_T2_TIMEOUT_MS,
  });

  const raw = resp.output.trim();
  const match = raw.match(/\{[\s\S]*\}/);
  if (!match) return null;
  const p = JSON.parse(match[0]) as Record<string, unknown>;
  if (typeof p.company_context !== "string" || !p.company_context) return null;

  return {
    org_name: opts.orgName,
    company_context: p.company_context.slice(0, 3000),
    enrichment_status: "enriched",
    has_product: typeof p.has_product === "boolean" ? p.has_product : true,
    industry_hint: typeof p.industry_hint === "string" ? p.industry_hint : "unknown",
    // See the manual-context path: absence is "unknown", never a real model.
    business_model_hint: typeof p.business_model_hint === "string" ? p.business_model_hint : "unknown",
    ideal_customer_profile: typeof p.ideal_customer_profile === "string" ? p.ideal_customer_profile : null,
    revenue_model: typeof p.revenue_model === "string" ? p.revenue_model : null,
    competitive_position: typeof p.competitive_position === "string" ? p.competitive_position : null,
    primary_acquisition_channel: typeof p.primary_acquisition_channel === "string" ? p.primary_acquisition_channel : null,
    product_maturity_signal: typeof p.product_maturity_signal === "string"
      ? p.product_maturity_signal as Pillar1Response["product_maturity_signal"] : null,
    tone_signal: typeof p.tone_signal === "string"
      ? p.tone_signal as Pillar1Response["tone_signal"] : null,
    primary_friction_hypothesis: typeof p.primary_friction_hypothesis === "string"
      ? p.primary_friction_hypothesis.slice(0, 200) : null,
    differentiator_hypothesis: typeof p.differentiator_hypothesis === "string"
      ? p.differentiator_hypothesis.slice(0, 200) : null,
    raw_input: opts.rawInput,
  };
}

const pillar1Schema = z.object({
  companyId: z.string().min(1),
  org_name: z.string().min(1).max(120),
  raw_input: z.string().min(1).max(2048),
  manual_context: z.string().min(40).max(2048).optional(),
  // Deterministic path. Every OTHER inference-calling route in this pipeline
  // already takes this flag (connector/swarm/workflow manifests, finalize,
  // avatar) — pillar 1 was the only one that could not be told to stay
  // offline, which is why the e2e harness could not walk the pillars without
  // spawning live T2 and blowing its own 30 s budget.
  //
  // Scope, stated honestly: this suppresses the WAVEX-LAYER enrichment (the
  // combined tier-router call and the BYOC fallback). The vendored
  // handlePillar1 then answers from `manual_context` — upstream documents
  // that input as "skips the T2 enrichment call entirely" — or from the
  // pre-product branch. A BARE URL with no manual_context still reaches the
  // vendored deep-dive T2, because the only alternative would be to invent a
  // company_context we have no evidence for.
  skipInference: z.boolean().optional(),
});

/** Operator-edit overrides for pillar_1 fields after T2 enrichment.
 *  Used when the operator picks "Other — type your own" in the confirm
 *  view's industry/business_model dropdowns, or just disagrees with
 *  what T2 inferred. Patches the existing pillar_1 in place. */
const pillar1EditSchema = z.object({
  companyId: z.string().min(1),
  industry_hint: z.string().min(1).max(80).optional(),
  business_model_hint: z.string().min(1).max(80).optional(),
  has_product: z.boolean().optional(),
});

const pillar2Schema = z.object({
  companyId: z.string().min(1),
  claude_plan: z.enum(["max_20x", "max_5x", "api_only", "other"]),
  claude_plan_other_note: z.string().optional(),
});

const pillar3Schema = z.object({
  companyId: z.string().min(1),
  product_state: z.enum(["live_paying_customers", "built_not_selling", "prototype_mvp", "idea_only", "other"]),
  product_state_other: z.string().optional(),
  stage: z.string().min(1),
  stage_other: z.string().optional(),
});

const leadSourceEnum = z.enum([
  "inbound_ads_meta_google", "outbound_cold", "referral_word_of_mouth",
  "content_seo", "product_led_viral", "partnerships", "events", "none_yet", "other",
]);

const pillar4Schema = z.object({
  companyId: z.string().min(1),
  lead_sources: z.array(leadSourceEnum).min(1).max(3),
  lead_source_other: z.string().min(40).max(500).optional(),
  sales_motion: z.enum(["self_serve_plg", "assisted_demo", "high_touch_enterprise", "none_yet", "other"]),
  sales_motion_other: z.string().min(40).max(500).optional(),
  close_channel: z.enum(["mostly_phone_video", "mostly_email_text", "mixed", "other"]).optional(),
  close_channel_other: z.string().min(40).max(500).optional(),
});

const pillar5Schema = z.object({
  companyId: z.string().min(1),
  comm_channel: z.enum(["telegram", "slack", "sms", "email_only", "other"]),
  comm_channel_other: z.string().optional(),
  urgency_routing: z.enum(["all_to_one_channel", "digest_plus_urgent_phone", "other"]).optional(),
  urgency_routing_other: z.string().optional(),
  board_endpoint_config: z.record(z.string()).optional(),
});

function authReq(req: FastifyRequest) {
  return { method: req.method, headers: req.headers as Record<string, string> };
}

export function registerPillarRoutes(app: FastifyInstance): void {
  app.get("/wavex-os/onboarding/status", async (req, reply) => {
    const ar = authReq(req);
    try { assertBoard(ar); } catch (e) {
      if (e instanceof AuthError) return reply.status(e.statusCode).send({ error: e.message });
      throw e;
    }
    const { companyId } = (req.query ?? {}) as { companyId?: string };
    if (!companyId) return reply.status(400).send({ error: "companyId required" });
    assertCompanyAccess(ar, companyId);
    const responses = await loadPillarResponses(companyId).catch(() => emptyPillarResponses());
    return {
      ok: true,
      companyId,
      responses,
      complete: isPillarResponsesComplete(responses),
      next_pillar: nextIncompletePillar(responses),
    };
  });

  const pillarRoute = <S extends z.ZodTypeAny>(
    pillar: 1 | 2 | 3 | 4 | 5,
    schema: S,
    fn: (body: z.infer<S>) => Promise<unknown>,
  ) => {
    app.post(`/wavex-os/onboarding/pillar/${pillar}`, async (req, reply) => {
      const ar = authReq(req);
      try { assertBoard(ar); } catch (e) {
        if (e instanceof AuthError) return reply.status(e.statusCode).send({ error: e.message });
        throw e;
      }
      const parsed = schema.safeParse(req.body);
      if (!parsed.success) return reply.status(400).send({ error: "validation failed", issues: parsed.error.issues });
      const body = parsed.data as { companyId: string };
      assertCompanyAccess(ar, body.companyId);
      try {
        const result = await fn(parsed.data);
        return result;
      } catch (e) {
        if (isOnboardingHaltError(e)) {
          return reply.status(409).send({ ok: false, halt: e.toJSON() });
        }
        if (e instanceof BudgetExhaustedError) {
          return reply.status(429).send({
            ok: false, error: e.message,
            budget: { used: e.used, cap: e.cap, companyId: e.companyId },
          });
        }
        throw e;
      }
    });
  };

  pillarRoute(1, pillar1Schema, async (body) => {
    return withTokenAccounting(body.companyId, "pillar_1", async () => {
      // Deterministic / pre-product fast path — no T2 needed.
      if (body.skipInference || looksLikeNoProduct(body.raw_input.trim())) {
        const result = await handlePillar1({
          org_name: body.org_name,
          raw_input: body.raw_input,
          companyId: body.companyId,
          manual_context: body.manual_context,
        });
        await updatePillar(body.companyId, "pillar_1", result);
        return { ok: true, response: result };
      }

      // Combined path (WAVAAAA-157): server-side URL fetch + single T2 call.
      // Reduces up to 2 sequential T2 calls (vendored deep-dive + BYOC) to 1,
      // cutting latency from ~85s P50 to ~25s by sending pre-fetched content
      // instead of asking Claude to browse the web (reasoning_depth: shallow
      // vs. deep, timeout 45s vs. 180s).
      const urlContent = await fetchUrlContent(body.raw_input).catch(() => null);
      const combined = await runCombinedPillar1Enrichment({
        orgName: body.org_name,
        rawInput: body.raw_input,
        urlContent,
        manualContext: body.manual_context,
        companyId: body.companyId,
      }).catch(() => null);

      let final: Pillar1Response;
      if (combined) {
        // Inject the combined result via deterministicOverride to skip the
        // vendored T2 call. handlePillar1 will still apply heuristic fallbacks
        // for any optional field our call left null, keeping the output shape
        // identical to the original enrichment path.
        final = await handlePillar1({
          org_name: body.org_name,
          raw_input: body.raw_input,
          companyId: body.companyId,
          manual_context: body.manual_context,
          deterministicOverride: combined,
        });
      } else {
        // Fallback: combined tier-router unavailable. For manual_context, use a
        // single consolidated BYOC call (WAVAAAA-153) instead of the prior
        // 2-step heuristic + refinement. For URL inputs, fall through to the
        // vendored deep-dive T2.
        if (body.manual_context && body.manual_context.trim().length >= 40) {
          const byoc = await consolidatedPillar1Enrich({
            orgName: body.org_name,
            rawInput: body.raw_input,
            manualContext: body.manual_context,
          }).catch(() => null);
          if (byoc) {
            await updatePillar(body.companyId, "pillar_1", byoc);
            return { ok: true, response: byoc };
          }
          // BYOC also unavailable: fall through to vendor heuristics below.
        }
        // URL path or double-fallback: vendored deep-dive T2 (no BYOC refinement).
        final = await handlePillar1({
          org_name: body.org_name,
          raw_input: body.raw_input,
          companyId: body.companyId,
          manual_context: body.manual_context,
        });
      }

      await updatePillar(body.companyId, "pillar_1", final);
      return { ok: true, response: final };
    });
  });

  pillarRoute(2, pillar2Schema, async (body) => {
    return withTokenAccounting(body.companyId, "pillar_2", async () => {
      // Hosted mode: the customer has no local claude CLI — inference is
      // served by the operator's hub. The vendored handlePillar2 always
      // spawns the configured claudeBin (the hosted-shim) and checks its
      // exit code, which is brittle and surfaces as a "verify failed"
      // fix_hint to the user. Short-circuit here with a synthetic-pass
      // outcome so the wizard advances without a Claude-plan picker UI.
      if (getInferenceMode() === "hosted") {
        const response = {
          claude_code_verified: true,
          claude_plan: body.claude_plan,
          claude_plan_other_note: body.claude_plan_other_note,
          claude_version: "wavex-os hosted (Pool A)",
          inference_budget_profile: "conservative" as const,
          verified_at: new Date().toISOString(),
        };
        await updatePillar(body.companyId, "pillar_2", response);
        return { ok: true, response } as Awaited<ReturnType<typeof handlePillar2>>;
      }
      const outcome = await handlePillar2({
        claude_plan: body.claude_plan,
        claude_plan_other_note: body.claude_plan_other_note,
      });
      await updatePillar(body.companyId, "pillar_2", outcome.response);
      return outcome;
    });
  });

  pillarRoute(3, pillar3Schema, async (body) => {
    return withTokenAccounting(body.companyId, "pillar_3", async () => {
      const result = await handlePillar3({
        product_state: body.product_state,
        product_state_other: body.product_state_other,
        stage: body.stage,
        stage_other: body.stage_other,
      });
      await updatePillar(body.companyId, "pillar_3", result);
      return { ok: true, response: result };
    });
  });

  pillarRoute(4, pillar4Schema, async (body) => {
    return withTokenAccounting(body.companyId, "pillar_4", async () => {
      const result = await handlePillar4({
        lead_sources: body.lead_sources,
        lead_source_other: body.lead_source_other,
        sales_motion: body.sales_motion,
        sales_motion_other: body.sales_motion_other,
        close_channel: body.close_channel,
        close_channel_other: body.close_channel_other,
      });
      await updatePillar(body.companyId, "pillar_4", result);
      return { ok: true, response: result };
    });
  });

  pillarRoute(5, pillar5Schema, async (body) => {
    return withTokenAccounting(body.companyId, "pillar_5", async () => {
      const result = await handlePillar5({
        comm_channel: body.comm_channel,
        comm_channel_other: body.comm_channel_other,
        urgency_routing: body.urgency_routing,
        urgency_routing_other: body.urgency_routing_other,
        board_endpoint_config: body.board_endpoint_config,
      });
      await updatePillar(body.companyId, "pillar_5", result);
      return { ok: true, response: result };
    });
  });

  // ── Narrator endpoint ───────────────────────────────────────────────
  //
  // OnboardingShell's chat thread used to contain hardcoded transition
  // sentences ("Got it. Reading your site…", "Where are you in the product
  // journey?", "How do leads come in?"). They felt programmatic because
  // they were the same for every customer regardless of context.
  //
  // This endpoint returns ONE tailored transition sentence grounded in
  // what we already know about the customer + which phase they're
  // entering. The shell calls it at each transition and falls back to
  // the hardcoded copy if the call fails or is slow.
  //
  // Cost-bounded: ~30-60 output tokens per call. The handful of
  // transition points across a full walk add maybe 200-300 tokens total
  // — trivial relative to the wizard's other T2 spend.
  const narrateSchema = z.object({
    companyId: z.string().min(1),
    from: z.string().max(40),
    to: z.string().max(40),
  });

  app.post("/wavex-os/onboarding/narrate", async (req, reply) => {
    const ar = authReq(req);
    try { assertBoard(ar); } catch (e) {
      if (e instanceof AuthError) return reply.status(e.statusCode).send({ error: e.message });
      throw e;
    }
    const parsed = narrateSchema.safeParse(req.body);
    if (!parsed.success) return reply.status(400).send({ error: "validation failed" });
    const { companyId, from, to } = parsed.data;
    assertCompanyAccess(ar, companyId);

    const responses = await loadPillarResponses(companyId).catch(() => null);
    const ctx: string[] = [];
    const p1 = responses?.pillar_1 as
      | { org_name?: string; industry_hint?: string; business_model_hint?: string; company_context?: string }
      | undefined;
    if (p1?.org_name) ctx.push(`Company: ${p1.org_name}`);
    if (p1?.industry_hint) ctx.push(`Industry: ${p1.industry_hint}`);
    if (p1?.business_model_hint) ctx.push(`Business model: ${p1.business_model_hint}`);
    if (p1?.company_context) ctx.push(`Context: ${p1.company_context.slice(0, 300)}`);
    const p3 = responses?.pillar_3 as { product_state?: string; stage?: string } | undefined;
    if (p3?.stage) ctx.push(`Stage: ${p3.stage}`);
    const p4 = responses?.pillar_4 as { sales_motion?: string } | undefined;
    if (p4?.sales_motion) ctx.push(`Motion: ${p4.sales_motion}`);

    const prompt = `You are the narrator of a chat-first onboarding wizard. The customer is moving from one phase to the next. Write ONE short sentence (≤140 chars) that:
- Acknowledges what just happened with a sentence-specific reference to what they told us (e.g., "Got the 40-customer $50K MRR picture") rather than generic "Got it".
- Introduces what's next without re-explaining the wizard.

CUSTOMER CONTEXT:
${ctx.join("\n") || "(very little so far — only an org name)"}

PHASE TRANSITION: ${from} → ${to}

Output ONLY the sentence — no quotes, no markdown, no preamble.`;

    try {
      const out = await withTokenAccounting(companyId, "narrator" as PhaseKey, async () => {
        const resp = await tierRoute({
          agent_id: "onboarding.narrator",
          prompt,
          task_metadata: { creativity_required: true, customer_facing: true, reasoning_depth: "shallow", priority: "batch" },
          companyId,
          outputFormat: "text",
          timeout_ms: 20_000,
        });
        return resp.output.trim();
      });
      // Strip quotes if Claude wrapped its answer.
      const sentence = out.replace(/^["'`]|["'`]$/g, "").replace(/\n.*$/s, "").slice(0, 200);
      return reply.send({ ok: true, sentence });
    } catch (e) {
      if (e instanceof BudgetExhaustedError) {
        return reply.send({ ok: false, error: e.message });
      }
      return reply.send({ ok: false, error: e instanceof Error ? e.message : String(e) });
    }
  });

  // ── Pillar suggestion endpoint ──────────────────────────────────────
  //
  // Why this exists: Pillar 3/4/5 cards on main currently render hardcoded
  // chip groups with no awareness of what the customer told us in Pillar 1.
  // That makes the wizard feel like a paper form. This endpoint lets the
  // inline cards ASK the hub for inference-grounded suggestions before
  // rendering, so the chips can be pre-highlighted ("Suggested: assisted
  // demo — your inferred industry is B2B SaaS at $50K MRR").
  //
  // Generic by design: each pillar has its own field list, and the route
  // builds a tailored prompt by pulling whatever pillar responses exist
  // so far. The Claude reply is a small JSON envelope { recommended: {...
  // pillar-specific fields...}, reasoning } — the client uses that to
  // mark chips as suggested. Customer is always free to pick anything.
  //
  // This is Pool A inference. The hub's daily $/cap + per-install caps
  // bound abuse; the per-pillar suggestion is one cheap call (<200 tokens
  // out) that materially de-programmatizes the wizard.
  const suggestSchema = z.object({ companyId: z.string().min(1) });

  app.post<{ Body: { companyId: string }; Params: { n: string } }>(
    "/wavex-os/onboarding/pillar/:n/suggest",
    async (req, reply) => {
      const ar = authReq(req);
      try { assertBoard(ar); } catch (e) {
        if (e instanceof AuthError) return reply.status(e.statusCode).send({ error: e.message });
        throw e;
      }
      const parsed = suggestSchema.safeParse(req.body);
      if (!parsed.success) return reply.status(400).send({ error: "validation failed" });
      const { companyId } = parsed.data;
      assertCompanyAccess(ar, companyId);
      const n = parseInt(req.params.n, 10);
      if (![3, 4, 5].includes(n)) {
        return reply.status(400).send({ error: "suggest is only supported for pillars 3, 4, 5" });
      }

      const responses = await loadPillarResponses(companyId).catch(() => null);
      if (!responses?.pillar_1) {
        return reply.status(409).send({ ok: false, error: "no pillar_1 context yet — submit pillar/1 first" });
      }

      // Compact summary of what we know already — feeds the system prompt.
      const p1 = responses.pillar_1 as {
        org_name?: string; company_context?: string;
        industry_hint?: string; business_model_hint?: string;
        inferred_signals?: Record<string, unknown>; has_product?: boolean;
      };
      const ctx: string[] = [];
      if (p1.org_name) ctx.push(`Company: ${p1.org_name}`);
      if (p1.industry_hint) ctx.push(`Industry: ${p1.industry_hint}`);
      if (p1.business_model_hint) ctx.push(`Business model: ${p1.business_model_hint}`);
      if (p1.company_context) ctx.push(`Context: ${p1.company_context.slice(0, 400)}`);
      if (p1.inferred_signals) {
        const keys = Object.entries(p1.inferred_signals).slice(0, 6)
          .map(([k, v]) => `${k}=${typeof v === "string" ? v : JSON.stringify(v)}`);
        if (keys.length) ctx.push(`Signals: ${keys.join(", ")}`);
      }
      if (responses.pillar_3) {
        const p3 = responses.pillar_3 as { product_state?: string; stage?: string };
        ctx.push(`Pillar 3 picked: product_state=${p3.product_state}, stage=${p3.stage}`);
      }
      if (responses.pillar_4) {
        const p4 = responses.pillar_4 as { lead_sources?: string[]; sales_motion?: string };
        ctx.push(`Pillar 4 picked: lead_sources=${(p4.lead_sources ?? []).join(",")}, sales_motion=${p4.sales_motion}`);
      }

      // Per-pillar field schema + valid values. Kept here so we can give
      // Claude a constrained answer space and validate the output.
      const fieldSpecs: Record<number, { fields: string; valid: Record<string, string[]> }> = {
        3: {
          // `stage` is no longer ASKED — it derives from the number Strategy
          // collects. Requesting it spent tokens on a field the card cannot
          // apply, in a vocabulary sharing ZERO values with the shipped chips.
          fields: "product_state",
          valid: {
            product_state: ["live_paying_customers", "built_not_selling", "prototype_mvp", "idea_only"],
          },
        },
        4: {
          fields: "lead_sources (array, 1-3), sales_motion",
          valid: {
            lead_sources: ["inbound_ads_meta_google", "outbound_cold", "referral_word_of_mouth",
                           "content_seo", "product_led_viral", "partnerships", "events", "none_yet"],
            sales_motion: ["self_serve_plg", "assisted_demo", "high_touch_enterprise",
                           "services_to_saas", "marketplace", "transactional", "no_motion_yet"],
          },
        },
        5: {
          fields: "comm_channel, urgency_routing (optional)",
          valid: {
            comm_channel: ["telegram", "slack", "sms", "email_only", "other"],
            urgency_routing: ["telegram_or_slack_only", "phone_or_sms_only", "email_only", "no_routing"],
          },
        },
      };

      const spec = fieldSpecs[n];
      const prompt = `You are predicting the most likely answers a customer will pick on Pillar ${n} of an onboarding wizard, based on what they've already told us.

WHAT WE KNOW ABOUT THIS CUSTOMER:
${ctx.join("\n") || "(very little — only an org_name)"}

FIELDS TO PREDICT (Pillar ${n}): ${spec.fields}

VALID VALUES PER FIELD:
${Object.entries(spec.valid).map(([k, vs]) => `  ${k}: ${vs.join(" | ")}`).join("\n")}

Output ONLY a single-line JSON object with this shape:
{"recommended":{"<field>":"<value>", ...}, "reasoning":"<one-sentence why>"}

For array fields (e.g. lead_sources), put up to 3 ranked values in an array. For optional fields, omit them when uncertain. No backticks, no prose outside the JSON. Keep the reasoning under 140 chars.`;

      try {
        const out = await withTokenAccounting(companyId, `pillar_${n}_suggest` as PhaseKey, async () => {
          const resp = await tierRoute({
            agent_id: `onboarding.pillar-${n}-suggest`,
            prompt,
            task_metadata: {
              creativity_required: false, customer_facing: false,
              reasoning_depth: "shallow", priority: "batch",
            },
            companyId,
            outputFormat: "text",
            timeout_ms: 30_000,
          });
          return resp.output.trim();
        });

        // Parse the JSON envelope. Be forgiving — strip code fences if Claude
        // returns them, fall back to a null recommended on parse failure.
        interface SuggestEnvelope { recommended: Record<string, unknown>; reasoning?: string }
        let parsedOut: SuggestEnvelope | null = null;
        try {
          const cleaned = out.replace(/^```(?:json)?\s*|\s*```$/gm, "").trim();
          parsedOut = JSON.parse(cleaned) as SuggestEnvelope;
        } catch { /* fall through with null */ }

        return reply.send({
          ok: true,
          pillar: n,
          recommended: parsedOut?.recommended ?? {},
          reasoning: parsedOut?.reasoning ?? null,
          raw: parsedOut ? undefined : out.slice(0, 400),
        });
      } catch (e) {
        if (e instanceof BudgetExhaustedError) {
          return reply.status(429).send({ ok: false, error: e.message });
        }
        return reply.send({
          ok: false,
          pillar: n,
          recommended: {},
          reasoning: null,
          error: e instanceof Error ? e.message : String(e),
        });
      }
    },
  );

  app.post("/wavex-os/onboarding/pillar/1/edit", async (req, reply) => {
    const ar = authReq(req);
    try { assertBoard(ar); } catch (e) {
      if (e instanceof AuthError) return reply.status(e.statusCode).send({ error: e.message });
      throw e;
    }
    const parsed = pillar1EditSchema.safeParse(req.body);
    if (!parsed.success) return reply.status(400).send({ error: "validation failed", issues: parsed.error.issues });
    const { companyId, ...overrides } = parsed.data;
    assertCompanyAccess(ar, companyId);

    const responses = await loadPillarResponses(companyId).catch(() => null);
    if (!responses?.pillar_1) {
      return reply.status(409).send({ ok: false, error: "no pillar_1 to edit — submit pillar/1 first" });
    }
    const updated = { ...responses.pillar_1, ...overrides };
    await updatePillar(companyId, "pillar_1", updated);
    return { ok: true, response: updated };
  });
}
