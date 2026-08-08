/** Tier (b) of the composition ladder — the T2 composer.
 *
 *  The model COMPOSES; it never computes. It picks cells, bindings, and
 *  arrangement from the catalog; every number on screen is fetched by the
 *  client from the bound endpoint. Its JSON is extracted from free text
 *  (outputFormat "json" is only the CLI envelope — t2-claude-code.ts:65-77),
 *  fence-stripped and validated exactly like recommend-agent.ts does, and
 *  anything invalid degrades to the deterministic stub. The stub is the
 *  floor: budget exhaustion, a missing claude bin, a timeout, or garbage
 *  output all land there — composition never fails, it only gets less
 *  clever. Stub composition is deliberately NOT budget-gated. */

import { route as tierRoute } from "@wavex-os/plugin-tier-router";
import { loadPillarResponses } from "@wavex-os/plugin-onboarding";
import { withTokenAccounting } from "../lib/token-accounting.js";
import { BudgetExhaustedError } from "../lib/token-budget.js";
import { CATALOG_KEYS, CELL_TYPES, READ_BINDINGS, validateLayout } from "./catalog.js";
import {
  composeStub, classify, intentSignature, type Composition,
} from "./composer.js";

export interface SignatureIndexEntry { signature: string; label: string }

/** Conversation + company context so composition is situated, not stateless.
 *  history = last 6 turns; activeLayout = what's on the workspace now, so
 *  "add the trend to that" is answerable. */
export interface ComposeContext { history: string; activeLayout: string }

const WINDOWS = ["today", "7d", "30d", "all"] as const;

/** Every signature a query on `topic` can legitimately carry. Signatures hash
 *  {kind, topic, window}, so the topic can't be read back out of one — but the
 *  four window variants are cheap to enumerate and compare against. An
 *  "unknown" topic (a clarify) matches nothing: there is no workspace to
 *  reuse for a question we failed to classify. */
export function signaturesForTopic(topic: Composition["intent"]["topic"]): Set<string> {
  if (topic === "unknown") return new Set();
  return new Set(WINDOWS.map((window) => intentSignature({ kind: "query", topic, window })));
}

/** Pillar-1 facts, same fields help-chat's summarizePillars surfaces. */
async function companySummary(companyId: string): Promise<string> {
  const r = await loadPillarResponses(companyId).catch(() => null);
  if (!r) return "";
  const p1 = r.pillar_1 as { org_name?: string; industry_hint?: string; business_model_hint?: string } | undefined;
  const lines: string[] = [];
  if (p1?.org_name) lines.push(`Company: ${p1.org_name}`);
  if (p1?.industry_hint) lines.push(`Industry: ${p1.industry_hint}`);
  // "unknown" is the enum's word for absence — a prose line saying it is
  // noise, and a prose line omitting it is silence. Silence is the honest one.
  if (p1?.business_model_hint && p1.business_model_hint !== "unknown") lines.push(`Model: ${p1.business_model_hint}`);
  return lines.join(" · ");
}

export interface T2Composition extends Omit<Composition, "composedBy"> {
  composedBy: "t2" | "stub";
  reuseSignature?: string;
  warnings?: string[];
}

function buildPrompt(message: string, index: SignatureIndexEntry[], company: string, ctx: ComposeContext): string {
  const bindings = CATALOG_KEYS
    .map((k) => `  ${k} → cells: ${READ_BINDINGS[k].cells.join("|")}`)
    .join("\n");
  const known = index.slice(0, 20).map((e) => `  ${e.signature}: ${e.label}`).join("\n");
  // The floor, shown to the model. Without it T2 drifts: asked "what happened
  // so far?" it composed a budget recap, and the route stored that under the
  // timeline signature — so every later timeline question inherited it. The
  // model may still improve on the floor; it may not answer a different
  // question than the one that was classified.
  const stub = composeStub(message);
  const floor = stub.layout
    ? `${stub.layout.title} [${stub.layout.cells
        .map((c) => ("source" in c ? `${c.type}:${c.source.api}` : c.type))
        .join(", ")}]`
    : "(no deterministic layout — clarify)";
  return `You compose a workspace layout for one operator question about their AI agent company. You choose WHICH views to show — you never invent data; every cell binds an endpoint the client fetches itself.

CELL TYPES: ${CELL_TYPES.join(", ")} (text cells carry a "body" string; all others carry a "source").
BINDINGS (catalog key → cell types it supports):
${bindings}
PARAMS (optional source.params.view): token-usage table view="breakdown" renders proportional bars (best for "where did it go"), view="by_phase" renders a numeric table; redundancy table view="groups" shows duplicate-template groups.
ADJECTIVES (optional, choose expression by intent, not habit): "variant" — metric: hero|gauge|delta|goal|live|split; "density" — 1 (headline only) to 4 (full context); a metric answering "how much" wants hero, "against the cap" wants gauge, "what changed" wants delta, "toward the goal" wants goal.

CLASSIFIED TOPIC: ${stub.intent.topic}
DETERMINISTIC FLOOR (what ships if you decline — a correct but plain answer):
  ${floor}
Compose something better than the floor for the SAME topic: add context, order by
what matters, offer drills. Do not answer a different question — if the floor is
about the timeline, yours is too.

KNOWN WORKSPACES (return {"reuse":"<signature>"} ONLY if the question is the same
topic as one of these — never reuse across topics):
${known || "  (none yet)"}

Respond with RAW JSON ONLY, no prose, no code fences:
{"intent":{"kind":"query","topic":"spend|budget|kpis|roster|redundancy|ignition|health|attention|simulation|timeline|runtime","window":"today|7d|30d|all"},"reply":"<plain text, under 300 chars>","layout":{"title":"<under 60 chars>","cells":[{"id":"<slug>","type":"<cell type>","title":"<short>","span":1,"source":{"api":"<catalog key>","params":{}},"drill":[{"label":"<short>","prompt":"<followup question>"}]}]}}
or {"reuse":"<signature>","reply":"<short>"}

Rules: max 8 cells; drill prompts must be plain questions an operator would type; if the question is not about this company's agents, spend, goals, or fleet, return {"intent":{"kind":"clarify","topic":"attention","window":"all"},"reply":"<one-line redirect>"} with no layout.

You may include AT MOST ONE text cell with "thought":"hypothesis" giving your interpretation of the data — it renders as your read, visibly distinct from endpoint truth. Never put numbers you computed in any cell.

MORPH RULE: if the CURRENT WORKSPACE already shows a cell on the same subject (same binding), KEEP that cell's id — the object transforms in place instead of being destroyed and recreated.

COMPANY: ${company || "(unknown)"}
CURRENT WORKSPACE: ${ctx.activeLayout || "(collapsed)"}
RECENT CONVERSATION (oldest first):
${ctx.history || "(none)"}

OPERATOR'S QUESTION:
${message}`;
}

function extractJson(raw: string): Record<string, unknown> | null {
  const cleaned = raw.replace(/```(?:json)?/g, "");
  const match = cleaned.match(/\{[\s\S]*\}/);
  if (!match) return null;
  try {
    return JSON.parse(match[0]) as Record<string, unknown>;
  } catch {
    return null;
  }
}

/** Try T2 once; on any failure return the stub composition with a warning.
 *  Never throws. */
export async function composeT2OrStub(
  message: string,
  companyId: string,
  index: SignatureIndexEntry[],
  ctx: ComposeContext = { history: "", activeLayout: "" },
): Promise<T2Composition> {
  let raw: string;
  try {
    const company = await companySummary(companyId);
    raw = await withTokenAccounting(companyId, "canvas", async () => {
      const resp = await tierRoute({
        agent_id: "onboarding.canvas-composer",
        prompt: buildPrompt(message, index, company, ctx),
        task_metadata: {
          creativity_required: false, customer_facing: false,
          reasoning_depth: "shallow", priority: "batch",
        },
        companyId,
        outputFormat: "json",
        timeout_ms: 45_000,
      });
      return resp.output.trim();
    });
  } catch (e) {
    const why = e instanceof BudgetExhaustedError
      ? "token budget exhausted — composed deterministically instead"
      : `T2 unavailable (${e instanceof Error ? e.message.slice(0, 80) : "error"}) — composed deterministically`;
    return { ...composeStub(message), warnings: [why] };
  }

  const parsed = extractJson(raw);
  if (!parsed) {
    return { ...composeStub(message), warnings: ["T2 returned no JSON — composed deterministically"] };
  }

  // Reuse path: the model matched a known workspace. Guarded by topic — the
  // model is eager to reuse and will map "what happened so far?" onto a spend
  // workspace it already knows. A reuse that crosses topics is worse than a
  // fresh compose: it answers a question nobody asked and, because the route
  // aliases the utterance to the reused signature, freezes the mistake.
  if (typeof parsed.reuse === "string" && index.some((e) => e.signature === parsed.reuse)) {
    const stub = composeStub(message);
    if (signaturesForTopic(stub.intent.topic).has(parsed.reuse)) {
      return {
        ...stub,
        composedBy: "t2",
        reuseSignature: parsed.reuse,
        reply: typeof parsed.reply === "string" ? parsed.reply.slice(0, 300) : stub.reply,
      };
    }
    // Off-topic reuse: fall through to the stub floor, which answers the
    // question that was actually asked.
    return { ...stub, warnings: ["T2 proposed an off-topic reuse — composed deterministically"] };
  }

  const rawIntent = (parsed.intent ?? {}) as Record<string, unknown>;
  const intent = classify(message); // classification floor
  if (rawIntent.kind === "clarify") intent.kind = "clarify";
  const reply = typeof parsed.reply === "string" && parsed.reply.trim()
    ? parsed.reply.slice(0, 300)
    : composeStub(message).reply;

  const { layout, warnings } = validateLayout(parsed.layout);
  if (!layout && intent.kind !== "clarify") {
    return { ...composeStub(message), warnings: [...warnings, "T2 layout invalid — composed deterministically"] };
  }
  return {
    intent, reply, layout,
    signature: intentSignature(intent),
    composedBy: "t2",
    ...(warnings.length ? { warnings } : {}),
  };
}
