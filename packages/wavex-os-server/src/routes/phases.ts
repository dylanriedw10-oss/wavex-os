/** Phase generators (Connector / Swarm / Workflow) + finalize routes. */

import { z } from "zod";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import {
  generateConnectorManifest,
  generateWorkflowManifest,
  loadConnectorManifest, loadSwarmManifest, loadPillarResponses,
  assembleCompanyManifest,
  computeManifestHash,
  isOnboardingHaltError,
  invokeMonteCarlo,
  type WorkflowManifest,
} from "@wavex-os/plugin-onboarding";
import { listConnections } from "@wavex-os/composio-shim";
import { assertBoard, assertCompanyAccess, AuthError } from "@wavex-os/auth-shim";
import { withTokenAccounting } from "../lib/token-accounting.js";
import { BudgetExhaustedError } from "../lib/token-budget.js";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { getOnboardingDir } from "../state-bridge.js";
import {
  generateSwarmWithOverlays, loadFreshWorkflowManifest,
  readScope, writeScope, type ScopeRecord,
} from "../lib/swarm-overlays.js";
import { synthesizeGoal } from "../lib/goal-synthesis.js";
import { placeOperator } from "../lib/placement.js";
import { readStrategy, writeStrategy, type Strategy } from "../lib/strategy.js";
import { canonicalKpiId, CANONICAL_KPI_ORDER } from "../lib/kpi-registry.js";

/* Scope + swarm-overlay helpers moved to ../lib/swarm-overlays.ts so plan
 * assembly runs the identical pipeline. Goal synthesis moved to
 * ../lib/goal-synthesis.ts for the same reason. */

const generateConnectorSchema = z.object({
  companyId: z.string().min(1),
  skipInference: z.boolean().optional(),
});

const generateSwarmSchema = z.object({
  companyId: z.string().min(1),
  skipInference: z.boolean().optional(),
});

const generateWorkflowSchema = z.object({
  companyId: z.string().min(1),
  skipInference: z.boolean().optional(),
  bypassBudgetCheck: z.boolean().optional(),
});

const completeSchema = z.object({
  companyId: z.string().min(1),
  orgId: z.string().min(1).max(80).optional(),
  operatorHandle: z.string().max(120).optional(),
  skipInference: z.boolean().optional(),
  mc: z.object({
    horizon_cycles: z.number().int().positive().max(120).optional(),
    n_runs: z.number().int().positive().max(100).optional(),
    seed: z.number().int().optional(),
  }).optional(),
});

function authReq(req: FastifyRequest) {
  return { method: req.method, headers: req.headers as Record<string, string> };
}

function bodyError(reply: FastifyReply, e: unknown) {
  if (isOnboardingHaltError(e)) {
    return reply.status(409).send({ ok: false, halt: e.toJSON() });
  }
  if (e instanceof BudgetExhaustedError) {
    return reply.status(429).send({
      ok: false, error: e.message,
      budget: { used: e.used, cap: e.cap, companyId: e.companyId },
    });
  }
  // Previously re-threw unknown errors → Fastify default handler emitted a
  // generic { error: "internal" } 500 with no usable detail. Customer saw
  // "Couldn't generate ... HTTP 500" with no path forward. Now return the
  // underlying message + class so the chat can render an inference-grounded
  // recovery suggestion (e.g. "Looks like the hub timed out — retry?").
  reply.log.error({ err: e }, "phase route failed");
  const message = e instanceof Error ? e.message : String(e);
  return reply.status(500).send({
    ok: false,
    error: message,
    error_class: e instanceof Error ? e.constructor.name : "Unknown",
    retryable: /timeout|fetch|network|ECONN|503|429/i.test(message),
  });
}

function gateBoard(req: FastifyRequest, reply: FastifyReply): boolean {
  const ar = authReq(req);
  try { assertBoard(ar); return true; }
  catch (e) {
    if (e instanceof AuthError) { reply.status(e.statusCode).send({ error: e.message }); return false; }
    throw e;
  }
}

export function registerPhaseRoutes(app: FastifyInstance): void {
  app.get("/wavex-os/onboarding/connector-recommendations", async (req, reply) => {
    if (!gateBoard(req, reply)) return;
    const { companyId } = (req.query ?? {}) as { companyId?: string };
    if (!companyId) return reply.status(400).send({ error: "companyId required" });
    assertCompanyAccess(authReq(req), companyId);
    const responses = await loadPillarResponses(companyId).catch(() => null);
    if (!responses) return reply.status(404).send({ error: "no pillar responses yet" });
    const live = await listConnections(companyId);
    try {
      const result = await generateConnectorManifest({
        companyId, responses, skipInference: true, liveConnections: live,
      });
      return { ok: true, manifest: result.manifest, source: result.source, warnings: result.warnings };
    } catch (e) {
      return bodyError(reply, e);
    }
  });

  // GET load endpoints — return the existing manifest from disk if present.
  // Lets the wizard hydrate phase pages on back-navigation without re-running
  // T2 (which costs 60-180s + tokens). UI policy: try GET first; only POST
  // (generate) if no manifest exists. Operator can force a fresh run via the
  // existing "↻ Re-refine with T2" button on each phase page.
  app.get("/wavex-os/onboarding/connector-manifest", async (req, reply) => {
    if (!gateBoard(req, reply)) return;
    const { companyId } = (req.query ?? {}) as { companyId?: string };
    if (!companyId) return reply.status(400).send({ error: "companyId required" });
    assertCompanyAccess(authReq(req), companyId);
    const manifest = await loadConnectorManifest(companyId).catch(() => null);
    if (!manifest) return { ok: true, exists: false, manifest: null };
    return { ok: true, exists: true, manifest, source: "loaded" as const };
  });

  app.get("/wavex-os/onboarding/swarm-manifest", async (req, reply) => {
    if (!gateBoard(req, reply)) return;
    const { companyId } = (req.query ?? {}) as { companyId?: string };
    if (!companyId) return reply.status(400).send({ error: "companyId required" });
    assertCompanyAccess(authReq(req), companyId);
    const manifest = await loadSwarmManifest(companyId).catch(() => null);
    if (!manifest) return { ok: true, exists: false, manifest: null };
    return { ok: true, exists: true, manifest, source: "loaded" as const };
  });

  app.get("/wavex-os/onboarding/workflow-manifest", async (req, reply) => {
    if (!gateBoard(req, reply)) return;
    const { companyId } = (req.query ?? {}) as { companyId?: string };
    if (!companyId) return reply.status(400).send({ error: "companyId required" });
    assertCompanyAccess(authReq(req), companyId);
    // wavex-os doesn't export a loadWorkflowManifest; read the file directly.
    const { readFile } = await import("node:fs/promises");
    const { join } = await import("node:path");
    const { getOnboardingDir } = await import("../state-bridge.js");
    try {
      const path = join(getOnboardingDir(companyId), "workflow_manifest.json");
      const raw = await readFile(path, "utf8");
      const manifest = JSON.parse(raw) as WorkflowManifest;
      return { ok: true, exists: true, manifest, source: "loaded" as const };
    } catch {
      return { ok: true, exists: false, manifest: null };
    }
  });

  app.post("/wavex-os/onboarding/connector-manifest", async (req, reply) => {
    if (!gateBoard(req, reply)) return;
    const parsed = generateConnectorSchema.safeParse(req.body);
    if (!parsed.success) return reply.status(400).send({ error: "validation failed", issues: parsed.error.issues });
    assertCompanyAccess(authReq(req), parsed.data.companyId);
    const responses = await loadPillarResponses(parsed.data.companyId).catch(() => null);
    if (!responses) return reply.status(404).send({ error: "no pillar responses" });
    const live = await listConnections(parsed.data.companyId);
    try {
      return await withTokenAccounting(parsed.data.companyId, "connector_manifest", async () => {
        const result = await generateConnectorManifest({
          companyId: parsed.data.companyId,
          responses,
          // Default to T0 (deterministic matrix) — T2 only when caller explicitly
          // passes skipInference: false (e.g., the "Re-refine with T2" button).
          skipInference: parsed.data.skipInference ?? true,
          liveConnections: live,
        });
        return { ok: true, manifest: result.manifest, source: result.source, warnings: result.warnings };
      });
    } catch (e) {
      return bodyError(reply, e);
    }
  });

  /* ---- Department parking ----
   *
   * Body: { companyId, mode, departments: string[], custom_labels? }, where
   * `departments` is what the operator KEPT. Everything outside the set is
   * parked with an unpark condition they can flip later from Mission
   * Control; nothing here promotes an agent the selection matrix parked.
   *
   * The record used to be written and nothing else, because it was answered
   * in the interview — long before the swarm existed — so the generator read
   * it on the way past. Parking now happens at REVIEW, over a plan the
   * operator can see, and by then the swarm is already on disk: writing the
   * record alone would leave the operator looking at departments struck out
   * on screen and a fleet that never heard about it.
   *
   * So the swarm is REGENERATED here rather than patched. Regeneration is
   * deterministic (`skipInference`) and idempotent, and it means the parked
   * set is recomputed from the current answer every time — patching in place
   * could only ever add parks, so an operator who confirmed, hit a failure,
   * and retried with fewer departments struck out would carry the earlier
   * ones forever. */
  const scopeSchema = z.object({
    companyId: z.string().min(1),
    mode: z.enum(["full", "focused"]),
    departments: z.array(z.string()),
    custom_labels: z.array(z.string()).optional(),
  });
  app.post("/wavex-os/onboarding/scope", async (req, reply) => {
    if (!gateBoard(req, reply)) return;
    const parsed = scopeSchema.safeParse(req.body);
    if (!parsed.success) return reply.status(400).send({ error: "validation failed", issues: parsed.error.issues });
    assertCompanyAccess(authReq(req), parsed.data.companyId);
    const scope: ScopeRecord = {
      mode: parsed.data.mode,
      departments: parsed.data.departments,
      custom_labels: parsed.data.custom_labels,
      set_at: new Date().toISOString(),
    };
    await writeScope(parsed.data.companyId, scope);

    // Re-apply against the fleet that exists. No connector manifest means the
    // swarm has not been generated yet — the record is enough, and the
    // generator will read it when it runs.
    const connector = await loadConnectorManifest(parsed.data.companyId).catch(() => null);
    if (!connector) return { ok: true, scope, applied: false, warnings: [] };
    try {
      const result = await generateSwarmWithOverlays(parsed.data.companyId, {
        skipInference: true, connectorManifest: connector,
      });
      return { ok: true, scope, applied: true, warnings: result.warnings };
    } catch (e) {
      // The record IS written; say plainly that the fleet has not caught up
      // rather than reporting a success the manifest does not show.
      return reply.status(500).send({
        ok: false, scope, applied: false,
        error: `scope recorded but the fleet could not be regenerated: ${e instanceof Error ? e.message : String(e)}`,
      });
    }
  });
  app.get("/wavex-os/onboarding/scope", async (req, reply) => {
    if (!gateBoard(req, reply)) return;
    const { companyId } = (req.query ?? {}) as { companyId?: string };
    if (!companyId) return reply.status(400).send({ error: "companyId required" });
    assertCompanyAccess(authReq(req), companyId);
    const scope = await readScope(companyId);
    return { ok: true, scope };
  });

  /* ---- Strategy: the operator's STATED goal ----
   *
   * The only source of the self-prompting loop's fixed half. Before this
   * route existed the goal came from a revenue BRACKET mapped to hardcoded
   * numbers, and that guess became the approved plan, the seeded work goal,
   * and the fleet's founding directive — identical for two companies eight
   * times apart in size. A goal is intent; it is stated or it is absent.
   *
   * `kpiId` is validated against the canonical vocabulary so operator copy
   * and system identifiers cannot drift the way the stage and sales-motion
   * enums did. */
  const strategySchema = z.object({
    companyId: z.string().min(1),
    goal: z.object({
      kpiId: z.string().min(1),
      current: z.number().finite().min(0),
      target: z.number().finite().min(0),
      days: z.number().int().min(1).max(3650),
    }),
    secondaryKpis: z.array(z.string()).max(2).optional(),
    bottleneck: z.string().max(200).nullable().optional(),
    /** False only where the operator explicitly declined and a band stood in. */
    stated: z.boolean().optional(),
  }).strict();

  app.post("/wavex-os/onboarding/strategy", async (req, reply) => {
    if (!gateBoard(req, reply)) return;
    const parsed = strategySchema.safeParse(req.body);
    if (!parsed.success) return reply.status(400).send({ error: "validation failed", issues: parsed.error.issues });
    assertCompanyAccess(authReq(req), parsed.data.companyId);

    const kpiId = canonicalKpiId(parsed.data.goal.kpiId);
    if (!CANONICAL_KPI_ORDER.includes(kpiId)) {
      // Reject rather than coerce: a goal measured by a KPI the runtime
      // cannot name is a goal nothing will ever measure against.
      return reply.status(400).send({
        error: `unknown kpiId "${parsed.data.goal.kpiId}"`,
        allowed: CANONICAL_KPI_ORDER,
      });
    }

    const strategy: Strategy = {
      v: 1,
      goal: { ...parsed.data.goal, kpiId },
      secondaryKpis: (parsed.data.secondaryKpis ?? []).map(canonicalKpiId),
      bottleneck: parsed.data.bottleneck?.trim() || null,
      stated: parsed.data.stated ?? true,
      setAt: new Date().toISOString(),
    };
    await writeStrategy(parsed.data.companyId, strategy);
    return { ok: true, strategy };
  });

  app.get("/wavex-os/onboarding/strategy", async (req, reply) => {
    if (!gateBoard(req, reply)) return;
    const { companyId } = (req.query ?? {}) as { companyId?: string };
    if (!companyId) return reply.status(400).send({ error: "companyId required" });
    assertCompanyAccess(authReq(req), companyId);
    return { ok: true, strategy: await readStrategy(companyId) };
  });

  app.post("/wavex-os/onboarding/swarm-manifest", async (req, reply) => {
    if (!gateBoard(req, reply)) return;
    const parsed = generateSwarmSchema.safeParse(req.body);
    if (!parsed.success) return reply.status(400).send({ error: "validation failed", issues: parsed.error.issues });
    assertCompanyAccess(authReq(req), parsed.data.companyId);
    const connector = await loadConnectorManifest(parsed.data.companyId).catch(() => null);
    if (!connector) return reply.status(409).send({ error: "connector manifest not generated" });
    try {
      // The whole pipeline (vendored generation → kernel slots → scope
      // filter / full-org unpark → re-persist) lives in lib/swarm-overlays
      // so plan assembly runs the identical code path.
      return await withTokenAccounting(parsed.data.companyId, "swarm_manifest", async () => {
        const result = await generateSwarmWithOverlays(parsed.data.companyId, {
          skipInference: parsed.data.skipInference,
          connectorManifest: connector,
        });
        return { ok: true, manifest: result.manifest, source: result.source, warnings: result.warnings };
      });
    } catch (e) {
      return bodyError(reply, e);
    }
  });

  app.post("/wavex-os/onboarding/workflow-manifest", async (req, reply) => {
    if (!gateBoard(req, reply)) return;
    const parsed = generateWorkflowSchema.safeParse(req.body);
    if (!parsed.success) return reply.status(400).send({ error: "validation failed", issues: parsed.error.issues });
    assertCompanyAccess(authReq(req), parsed.data.companyId);
    const connector = await loadConnectorManifest(parsed.data.companyId).catch(() => null);
    if (!connector) return reply.status(409).send({ error: "connector manifest not generated" });
    const swarm = await loadSwarmManifest(parsed.data.companyId).catch(() => null);
    if (!swarm) return reply.status(409).send({ error: "swarm manifest not generated" });
    const responses = await loadPillarResponses(parsed.data.companyId);
    try {
      return await withTokenAccounting(parsed.data.companyId, "workflow_manifest", async () => {
        const result = await generateWorkflowManifest({
          companyId: parsed.data.companyId,
          responses,
          connectorManifest: connector,
          swarmManifest: swarm,
          skipInference: parsed.data.skipInference,
          bypassBudgetCheck: parsed.data.bypassBudgetCheck,
        });
        return { ok: true, manifest: result.manifest, source: result.source, warnings: result.warnings };
      });
    } catch (e) {
      return bodyError(reply, e);
    }
  });

  // GET monte_carlo_report.json — used by the chat-first ImprintTheater
  // to drive the 5-strategy race animation. The report is written to disk
  // by finalize (see vendor/wavex-os/.../finalize/assemble.ts) so this is
  // a cheap file read, no T2 cost.
  app.get("/wavex-os/onboarding/mc-report", async (req, reply) => {
    if (!gateBoard(req, reply)) return;
    const { companyId } = (req.query ?? {}) as { companyId?: string };
    if (!companyId) return reply.status(400).send({ error: "companyId required" });
    assertCompanyAccess(authReq(req), companyId);
    const { readFile } = await import("node:fs/promises");
    try {
      const path = join(getOnboardingDir(companyId), "monte_carlo_report.json");
      const raw = await readFile(path, "utf8");
      return { ok: true, report: JSON.parse(raw) };
    } catch {
      return { ok: false, error: "monte_carlo_report.json not found — run finalize first" };
    }
  });

  app.post("/wavex-os/onboarding/finalize", async (req, reply) => {
    if (!gateBoard(req, reply)) return;
    const parsed = completeSchema.safeParse(req.body);
    if (!parsed.success) return reply.status(400).send({ error: "validation failed", issues: parsed.error.issues });
    assertCompanyAccess(authReq(req), parsed.data.companyId);

    const responses = await loadPillarResponses(parsed.data.companyId);
    const connector = await loadConnectorManifest(parsed.data.companyId).catch(() => null);
    const swarm = await loadSwarmManifest(parsed.data.companyId).catch(() => null);
    if (!connector || !swarm) {
      return reply.status(409).send({ error: "connector and swarm manifests required before finalize" });
    }

    // Workflow manifest is required by assembleCompanyManifest. If the chat-
    // first shell prefetched a T2-enriched workflow during the Swarm Studio
    // interaction window, reuse it instead of running the deterministic
    // regen — saves the operator 1-3 min of waiting during the Imprint
    // Theater. Freshness window: 10 minutes. Stale or missing → fall through
    // to the existing deterministic regeneration path.
    let workflow: WorkflowManifest;
    try {
      const fresh = await loadFreshWorkflowManifest(parsed.data.companyId, 10 * 60 * 1000);
      if (fresh) {
        workflow = fresh;
      } else {
        const wf = await generateWorkflowManifest({
          companyId: parsed.data.companyId,
          responses, connectorManifest: connector, swarmManifest: swarm,
          skipInference: true, bypassBudgetCheck: true,
        });
        workflow = wf.manifest;
      }
    } catch (e) {
      return bodyError(reply, e);
    }

    try {
      return await withTokenAccounting(parsed.data.companyId, "finalize", async () => {
      const result = await assembleCompanyManifest({
        companyId: parsed.data.companyId,
        orgId: parsed.data.orgId ?? parsed.data.companyId,
        responses,
        connectorManifest: connector,
        swarmManifest: swarm,
        workflowManifest: workflow,
        skipInference: parsed.data.skipInference,
        mc: parsed.data.mc,
      });

      // Merge pre-finalize add-agent sidecar additions into the manifest
      // and re-persist. add-agent.ts wrote these to template_additions.json
      // because company.manifest.json didn't exist yet during Swarm Studio.
      // Without this merge they'd be lost when finalize runs.
      let manifestMutated = false;
      try {
        const { readFile: rf } = await import("node:fs/promises");
        const sidecarPath = join(getOnboardingDir(parsed.data.companyId), "template_additions.json");
        const sidecarRaw = await rf(sidecarPath, "utf8").catch(() => null);
        if (sidecarRaw) {
          const sidecar = JSON.parse(sidecarRaw) as { template_additions?: Array<unknown> };
          if (Array.isArray(sidecar.template_additions) && sidecar.template_additions.length > 0) {
            (result.manifest as { template_additions?: Array<unknown> }).template_additions =
              sidecar.template_additions;
            manifestMutated = true;
          }
        }
      } catch { /* sidecar merge is best-effort; finalize must not fail because of it */ }

      // Populate goal + signed_at so Mission Control's KPI scoreboard stops
      // saying "No baseline captured yet". The vendored assemble does not
      // set these because the upstream contract doesn't include a goal
      // shape — wavex-os layers them on top via stage-based baselines.
      try {
        const m = result.manifest as {
          finalized_at?: string;
          signed_at?: string;
          goal?: { kpiId: string; current: number; target: number; days: number; stated?: boolean };
          pillar_responses?: {
            pillar_1?: { has_product?: boolean };
            pillar_3?: { product_state?: string; stage?: string };
          };
        };
        // Mirror finalized_at as signed_at — same moment in v1. Full Ed25519
        // signing is T2.2 in PHASE_H_PLAN.md.
        if (!m.signed_at && m.finalized_at) {
          m.signed_at = m.finalized_at;
          manifestMutated = true;
        }
        // Compute a sensible goal from Pillar 3's stage — the shared
        // synthesizeGoal (lib/goal-synthesis.ts), so the roadmap step plan
        // assembly showed the operator is the goal finalize stamps here.
        if (!m.goal) {
          // Placement must come from the SAME authority plan assembly used,
          // or the goal stamped into the signed manifest silently diverges
          // from the roadmap the operator actually reviewed — which is the
          // exact bug class lib/placement.ts exists to close.
          // The operator's OWN goal if they stated one; the band only if
          // they didn't. Same authority the roadmap step used, so the signed
          // manifest cannot stamp a different goal than the one reviewed.
          // The whole record. `stated` is a sibling of `goal`, and passing
          // `.goal` alone stamped the SIGNED manifest with `stated: true` for
          // an operator who explicitly declined — the one place that lie is
          // permanent.
          m.goal = synthesizeGoal(
            m.pillar_responses?.pillar_3,
            placeOperator(m.pillar_responses ?? {}).rung,
            await readStrategy(parsed.data.companyId),
          );
          manifestMutated = true;
        }
      } catch { /* goal/signed_at injection is best-effort */ }

      // Persist mutations (sidecar additions OR goal/signed_at).
      if (manifestMutated) {
        try {
          const { writeFile: wf } = await import("node:fs/promises");
          const manifestPath = join(getOnboardingDir(parsed.data.companyId), "company.manifest.json");
          await wf(manifestPath, JSON.stringify(result.manifest, null, 2), "utf8");
        } catch { /* persistence is best-effort; response still carries the augmented manifest */ }
      }

      return {
        ok: true,
        manifest: result.manifest,
        sha256: computeManifestHash(result.manifest),
        source: result.source,
        warnings: result.warnings,
      };
      });
    } catch (e) {
      return bodyError(reply, e);
    }
  });
}
