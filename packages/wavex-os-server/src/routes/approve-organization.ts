/** POST /api/instance/:companyId/approve-organization — the ONE Confirm.
 *
 *  Executed through the canvas commit pipeline (allowlist action), which
 *  supplies idempotent replay, TTL, body re-validation, the constitution
 *  gate, and the ledger. This route is the transaction they gate:
 *
 *    1. staleness check — the sha the operator approved must match the
 *       signed manifest ON DISK right now (409 = the org changed under
 *       them; re-review, don't guess)
 *    2. activate — agents to DB, KPI owners populated, native ignition
 *       seeds the work store (Path A gets the MVP goal + chain)
 *    3. plan lock — `plan_locked_at` stamped into the re-signed manifest,
 *       LAST, so a failed activate leaves no lock
 *
 *  Soft-ordered, not atomic: every step is retry-safe, so a partial run
 *  re-converges on the next commit (activate is idempotent, seeding is
 *  idempotent, the lock is a timestamp). */

import { z } from "zod";
import type { FastifyInstance, FastifyRequest } from "fastify";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import yaml from "js-yaml";
import { computeManifestHash, type CompanyManifest } from "@wavex-os/plugin-onboarding";
import { assertBoard, assertCompanyAccess, AuthError } from "@wavex-os/auth-shim";
import { getOnboardingDir } from "../state-bridge.js";

const bodySchema = z.object({
  manifestSha256: z.string().regex(/^sha256:[0-9a-f]{64}$/),
  path: z.enum(["mvp_build", "adopted_product"]),
}).strict();

function authReq(req: FastifyRequest) {
  return { method: req.method, headers: req.headers as Record<string, string> };
}

export function registerApproveOrganizationRoute(app: FastifyInstance): void {
  app.post("/api/instance/:companyId/approve-organization", async (req, reply) => {
    const ar = authReq(req);
    try { assertBoard(ar); } catch (e) {
      if (e instanceof AuthError) return reply.status(e.statusCode).send({ error: e.message });
      throw e;
    }
    const { companyId } = req.params as { companyId: string };
    assertCompanyAccess(ar, companyId);
    const parsed = bodySchema.safeParse(req.body);
    if (!parsed.success) return reply.status(400).send({ error: "validation failed", issues: parsed.error.issues });

    const manifestPath = join(getOnboardingDir(companyId), "company.manifest.json");
    let manifest: CompanyManifest;
    try {
      manifest = JSON.parse(await readFile(manifestPath, "utf8")) as CompanyManifest;
    } catch {
      return reply.status(404).send({ ok: false, error: "no finalized organization to approve" });
    }

    // 1 — staleness gate.
    const currentSha = computeManifestHash(manifest);
    if (currentSha !== parsed.data.manifestSha256) {
      return reply.status(409).send({
        ok: false,
        error: "the organization changed since it was reviewed — re-open Review and approve the current plan",
        expected: parsed.data.manifestSha256,
        actual: currentSha,
      });
    }

    // 2 — activate, through the same HTTP surface (identical auth + the
    // native-ignition branch that seeds the work store).
    const fwd: Record<string, string | string[] | undefined> = { ...req.headers };
    delete fwd["content-length"];
    delete fwd["transfer-encoding"];
    fwd["content-type"] = "application/json";
    const res = await app.inject({
      method: "POST",
      url: `/api/instance/${companyId}/activate`,
      headers: fwd,
      payload: {},
    });
    if (res.statusCode < 200 || res.statusCode >= 300) {
      return reply.status(502).send({
        ok: false,
        error: `activation failed: HTTP ${res.statusCode} ${res.body.slice(0, 200)}`,
      });
    }
    const activation = res.json() as { ignition?: unknown; ignition_orphaned?: boolean; warnings?: string[] };

    // 3 — the plan lock, LAST. Activate re-signed the manifest (it mutates
    // template_selections), so re-read before stamping.
    try {
      const fresh = JSON.parse(await readFile(manifestPath, "utf8")) as CompanyManifest & {
        plan_locked_at?: string;
        signatures?: { manifest_hash?: string };
      };
      if (!fresh.plan_locked_at) {
        fresh.plan_locked_at = new Date().toISOString();
        const rehash = computeManifestHash(fresh);
        fresh.signatures = { ...(fresh.signatures ?? {}), manifest_hash: rehash };
        await writeFile(manifestPath, JSON.stringify(fresh, null, 2), "utf8");
        await writeFile(manifestPath.replace(/\.json$/, ".yaml"), yaml.dump(fresh), "utf8");
      }
    } catch (e) {
      // The org is live; the lock failing is a warning, not a rollback.
      return {
        ok: true,
        approved: true,
        path: parsed.data.path,
        activation,
        warnings: [`plan lock could not be written: ${e instanceof Error ? e.message : String(e)}`],
      };
    }

    return { ok: true, approved: true, path: parsed.data.path, activation, warnings: [] };
  });
}
