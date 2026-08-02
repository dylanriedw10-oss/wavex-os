/** Refinement routes — Option C "analyze + propose" thought process.
 *
 *    POST /wavex-os/onboarding/analyze-refinement
 *      { companyId, operatorGuidance } → { ok, imprint_only, changes[], rationale_summary }
 *      Sends one T2 call asking claude to analyze the guidance against the
 *      current manifest + propose structural changes (or report imprint-only).
 *
 *    POST /wavex-os/onboarding/apply-refinement
 *      { companyId, operatorGuidance, changes[], regenerateImprint? }
 *      Applies the operator-selected subset of proposed changes surgically,
 *      records refinement in manifest.refinement_history, optionally re-runs
 *      imprint generation with the same guidance, re-signs, writes JSON+YAML.
 *
 *    POST /wavex-os/onboarding/revert-refinement
 *      { companyId } → restores manifest to the most recent
 *      refinement_history snapshot, removes that history entry. */

import { z } from "zod";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import yaml from "js-yaml";
import type { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import {
  generateImprintReview, computeManifestHash,
  type CompanyManifest,
} from "@wavex-os/plugin-onboarding";
import { route as tierRoute } from "@wavex-os/plugin-tier-router";
import { assertBoard, assertCompanyAccess, AuthError } from "@wavex-os/auth-shim";
import { withTokenAccounting } from "../lib/token-accounting.js";
import { BudgetExhaustedError } from "../lib/token-budget.js";
import { getOnboardingDir } from "../state-bridge.js";
import { buildAnalyzeRefinementPrompt } from "../refinement/analyze-prompt.js";
import { parseAnalyzeResponse } from "../refinement/parse.js";
import { applyChanges } from "../refinement/apply.js";
import type { Change, RefinementHistoryEntry } from "../refinement/types.js";

const analyzeSchema = z.object({
  companyId: z.string().min(1),
  operatorGuidance: z.string().min(3).max(2000),
});

const applySchema = z.object({
  companyId: z.string().min(1),
  operatorGuidance: z.string().min(3).max(2000),
  changes: z.array(z.unknown()).max(8),
  regenerateImprint: z.boolean().default(true),
});

const revertSchema = z.object({
  companyId: z.string().min(1),
});

function authReq(req: FastifyRequest) {
  return { method: req.method, headers: req.headers as Record<string, string> };
}

function gateBoard(req: FastifyRequest, reply: FastifyReply): boolean {
  const ar = authReq(req);
  try { assertBoard(ar); return true; }
  catch (e) {
    if (e instanceof AuthError) { reply.status(e.statusCode).send({ error: e.message }); return false; }
    throw e;
  }
}

async function loadManifest(companyId: string): Promise<CompanyManifest | null> {
  try {
    const path = join(getOnboardingDir(companyId), "company.manifest.json");
    return JSON.parse(await readFile(path, "utf8")) as CompanyManifest;
  } catch {
    return null;
  }
}

interface ManifestWithRefinementHistory extends CompanyManifest {
  refinement_history?: RefinementHistoryEntry[];
}

async function writeManifest(companyId: string, m: CompanyManifest): Promise<void> {
  const dir = getOnboardingDir(companyId);
  await writeFile(join(dir, "company.manifest.json"), JSON.stringify(m, null, 2), "utf8");
  await writeFile(join(dir, "company.manifest.yaml"), yaml.dump(m), "utf8");
}

function reSign(m: CompanyManifest): string {
  // computeManifestHash zeros out signatures during compute, so we don't need
  // to clear it ourselves. Just compute + write back.
  const hash = computeManifestHash(m);
  m.signatures = { ...m.signatures, manifest_hash: hash };
  return hash;
}

export function registerRefinementRoutes(app: FastifyInstance): void {
  app.post("/wavex-os/onboarding/analyze-refinement", async (req, reply) => {
    if (!gateBoard(req, reply)) return;
    const parsed = analyzeSchema.safeParse(req.body);
    if (!parsed.success) return reply.status(400).send({ ok: false, error: "validation failed", issues: parsed.error.issues });
    assertCompanyAccess(authReq(req), parsed.data.companyId);

    const manifest = await loadManifest(parsed.data.companyId);
    if (!manifest) return reply.status(404).send({ ok: false, error: "Manifest not found. Finalize first." });

    const prompt = buildAnalyzeRefinementPrompt(manifest, parsed.data.operatorGuidance);
    let raw: string;
    try {
      // Budgeted + attributed like every other T2 call site — this one had
      // slipped through unaccounted (fixed in the pivot pass).
      raw = await withTokenAccounting(parsed.data.companyId, "refinement", async () => {
        const resp = await tierRoute({
          agent_id: "onboarding.refinement.analyze",
          prompt,
          task_metadata: {
            creativity_required: false, customer_facing: false,
            reasoning_depth: "deep", priority: "high",
          },
          companyId: parsed.data.companyId,
          outputFormat: "json",
          timeout_ms: 120_000,
        });
        return resp.output;
      });
    } catch (e) {
      if (e instanceof BudgetExhaustedError) {
        return reply.status(429).send({ ok: false, error: "token budget exhausted — raise the cap to analyze refinements" });
      }
      return reply.status(503).send({
        ok: false,
        error: `T2 analyze failed: ${e instanceof Error ? e.message : String(e)}`,
      });
    }

    const activeSlots = new Set<string>(
      Object.entries(manifest.swarm_manifest.agents)
        .filter(([, a]) => a.status === "active").map(([slot]) => slot),
    );
    const baselineRequired = new Set(manifest.connector_manifest.required.map((e) => e.id));
    const baselineSuggested = new Set(manifest.connector_manifest.suggested.map((e) => e.id));
    const baselineDeferred = new Set(manifest.connector_manifest.deferred.map((e) => e.id));

    const { result, warnings } = parseAnalyzeResponse(raw, {
      activeSlots, baselineRequired, baselineSuggested, baselineDeferred,
    });

    return { ...result, warnings };
  });

  app.post("/wavex-os/onboarding/apply-refinement", async (req, reply) => {
    if (!gateBoard(req, reply)) return;
    const parsed = applySchema.safeParse(req.body);
    if (!parsed.success) return reply.status(400).send({ ok: false, error: "validation failed", issues: parsed.error.issues });
    assertCompanyAccess(authReq(req), parsed.data.companyId);

    const manifest = await loadManifest(parsed.data.companyId) as ManifestWithRefinementHistory | null;
    if (!manifest) return reply.status(404).send({ ok: false, error: "Manifest not found. Finalize first." });

    const beforeSnapshot = JSON.parse(JSON.stringify(manifest)) as ManifestWithRefinementHistory;
    const beforeHash = manifest.signatures.manifest_hash;

    // Trust caller-provided changes — they passed through analyze on the way in
    // and the validation invariants would have rejected anything malformed.
    // Re-validate locally as a safety net.
    const activeSlots = new Set<string>(
      Object.entries(manifest.swarm_manifest.agents)
        .filter(([, a]) => a.status === "active").map(([slot]) => slot),
    );
    const baselineRequired = new Set(manifest.connector_manifest.required.map((e) => e.id));
    const baselineSuggested = new Set(manifest.connector_manifest.suggested.map((e) => e.id));
    const baselineDeferred = new Set(manifest.connector_manifest.deferred.map((e) => e.id));

    const { result: validated } = parseAnalyzeResponse(
      JSON.stringify({ imprint_only: false, rationale_summary: "operator-selected", changes: parsed.data.changes }),
      { activeSlots, baselineRequired, baselineSuggested, baselineDeferred },
    );

    const { applied, warnings: applyWarnings } = applyChanges(manifest, validated.changes);

    // Re-generate imprint with the same guidance (default true)
    let imprintWarnings: string[] = [];
    if (parsed.data.regenerateImprint) {
      try {
        const imprint = await generateImprintReview({
          companyId: parsed.data.companyId,
          responses: manifest.pillar_responses,
          connectors: manifest.connector_manifest,
          swarm: manifest.swarm_manifest,
          workflows: manifest.workflow_manifest,
          mcWinner: manifest.mc_winner,
          operatorGuidance: parsed.data.operatorGuidance,
        });
        manifest.imprint_summary = imprint.summary;
        imprintWarnings = imprint.warnings;
      } catch (e) {
        imprintWarnings.push(`imprint regen failed: ${e instanceof Error ? e.message : String(e)}`);
      }
    }

    manifest.finalized_at = new Date().toISOString();
    const newHash = reSign(manifest);

    // Append to refinement_history
    const historyEntry: RefinementHistoryEntry = {
      ts: new Date().toISOString(),
      guidance: parsed.data.operatorGuidance,
      applied_change_ids: applied.map((c) => c.id),
      regenerated_imprint: parsed.data.regenerateImprint,
      sha256_before: beforeHash,
      sha256_after: newHash,
      manifest_snapshot: beforeSnapshot,
    };
    if (!Array.isArray(manifest.refinement_history)) manifest.refinement_history = [];
    manifest.refinement_history.push(historyEntry);

    await writeManifest(parsed.data.companyId, manifest);

    return {
      ok: true,
      sha256: newHash,
      manifest,
      applied_change_ids: applied.map((c) => c.id),
      warnings: [...applyWarnings, ...imprintWarnings],
    };
  });

  app.post("/wavex-os/onboarding/revert-refinement", async (req, reply) => {
    if (!gateBoard(req, reply)) return;
    const parsed = revertSchema.safeParse(req.body);
    if (!parsed.success) return reply.status(400).send({ ok: false, error: "validation failed", issues: parsed.error.issues });
    assertCompanyAccess(authReq(req), parsed.data.companyId);

    const manifest = await loadManifest(parsed.data.companyId) as ManifestWithRefinementHistory | null;
    if (!manifest) return reply.status(404).send({ ok: false, error: "Manifest not found." });

    const history = manifest.refinement_history;
    if (!Array.isArray(history) || history.length === 0) {
      return reply.status(409).send({ ok: false, error: "No refinements to revert." });
    }

    const last = history[history.length - 1];
    const restored = last.manifest_snapshot as ManifestWithRefinementHistory;
    // Pop the reverted entry from history so we don't re-revert the same change forever
    if (Array.isArray(restored.refinement_history)) {
      restored.refinement_history = history.slice(0, -1);
    }
    await writeManifest(parsed.data.companyId, restored);

    return {
      ok: true,
      sha256: restored.signatures.manifest_hash,
      reverted_guidance: last.guidance,
      reverted_change_ids: last.applied_change_ids,
    };
  });
}
