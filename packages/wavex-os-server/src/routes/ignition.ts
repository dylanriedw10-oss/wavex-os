/** Ignition status — the read side of activate's ignition step.
 *
 *  Activate and /ignite are POST and return their reports inline, but the
 *  persisted ignition-state.json was never served back, so the status was
 *  lost on every page refresh (the standing TODO at activate.ts:139). This
 *  route closes that gap, and also surfaces the persisted Paperclip handoff
 *  mapping so a client can render "mirrored to Paperclip at <url>" durably.
 *
 *    GET /api/instance/:companyId/ignition
 *      → 200 { ok: true, status: "not_activated" }            (nothing on disk — a NORMAL state, not 404)
 *      → 200 { ok: true, status: "deferred"|"partial"|"ignited", ... }
 *
 *  Auth note: unlike the older routes, BOTH assertions run inside one
 *  try/catch (an assertCompanyAccess 403 must not surface as a 500), the
 *  auth request forwards req.actor so production middleware is visible,
 *  and companyId is slug-validated before any path join. */

import { readFile } from "node:fs/promises";
import { join } from "node:path";
import type { FastifyInstance, FastifyRequest } from "fastify";
import { assertBoard, assertCompanyAccess, AuthError, type AuthRequest } from "@wavex-os/auth-shim";
import { getInstanceDir, getWavexDataRoot } from "../state-bridge.js";
import type { IgnitionState } from "../bridge/ignition.js";

export const COMPANY_ID_RE = /^[a-z0-9][a-z0-9_-]{0,63}$/;

export function authReq(req: FastifyRequest): AuthRequest {
  return {
    method: req.method,
    headers: req.headers as Record<string, string>,
    actor: (req as FastifyRequest & AuthRequest).actor,
  };
}

interface HandoffMapping {
  paperclipUrl?: string | null;
  paperclipCompanyId?: string | null;
}

export type IgnitionStatus = "not_activated" | "deferred" | "partial" | "ignited";

export interface IgnitionStatusResponse {
  ok: true;
  status: IgnitionStatus;
  agentsWorking: number;
  workflowsQueued: number;
  goalId: string | null;
  paperclipUrl: string | null;
  paperclipCompanyId: string | null;
  steps: IgnitionState["steps"] | null;
  errors: IgnitionState["errors"];
  warnings: string[];
  startedAt: string | null;
  completedAt: string | null;
}

async function readJson<T>(path: string): Promise<T | null> {
  try {
    return JSON.parse(await readFile(path, "utf8")) as T;
  } catch {
    return null;
  }
}

export function deriveStatus(state: IgnitionState | null): IgnitionStatus {
  if (!state) return "not_activated";
  if (!state.completed_at) return "deferred";
  if ((state.warnings?.length ?? 0) > 0 || (state.errors?.length ?? 0) > 0) return "partial";
  return "ignited";
}

export function registerIgnitionRoutes(app: FastifyInstance): void {
  app.get("/api/instance/:companyId/ignition", async (req, reply) => {
    const { companyId } = req.params as { companyId: string };
    if (!COMPANY_ID_RE.test(companyId)) {
      return reply.status(400).send({ ok: false, error: "invalid companyId" });
    }
    const ar = authReq(req);
    try {
      assertBoard(ar);
      assertCompanyAccess(ar, companyId);
    } catch (e) {
      if (e instanceof AuthError) return reply.status(e.statusCode).send({ error: e.message });
      throw e;
    }

    // The two files live in DIFFERENT dirs (ignition.ts:78 vs
    // paperclip-handoff.ts:135-138) despite IGNITION.md saying "next to".
    const state = await readJson<IgnitionState>(
      join(getInstanceDir(companyId), "ignition-state.json"),
    );
    const handoff = await readJson<HandoffMapping>(
      join(getWavexDataRoot(), "instances", "default", "companies", companyId, "paperclip-handoff.json"),
    );

    // Chain every hop: an ignition-state.json from an older version (or a
    // partially written one) must degrade to zeros, never 500 the read.
    // Two vocabularies on disk: this base's ignition bridge writes
    // goal_create/seed_issues; a state file written by the native seeding
    // variant carries seed_goal/seed_tasks. Read both through one loose
    // accessor so either shape answers, and neither 500s the read.
    const anySteps = state?.steps as Record<string, { created?: string[]; goal_id?: string } | undefined> | undefined;
    const seeded = anySteps?.seed_tasks?.created?.length
      ?? anySteps?.seed_issues?.created?.length ?? 0;
    const body: IgnitionStatusResponse = {
      ok: true,
      status: deriveStatus(state),
      agentsWorking: seeded,
      workflowsQueued: seeded,
      goalId: anySteps?.seed_goal?.goal_id ?? anySteps?.goal_create?.goal_id ?? null,
      paperclipUrl: handoff?.paperclipUrl ?? null,
      paperclipCompanyId: handoff?.paperclipCompanyId ?? null,
      steps: state?.steps ?? null,
      errors: state?.errors ?? [],
      warnings: state?.warnings ?? [],
      startedAt: state?.started_at ?? null,
      completedAt: state?.completed_at ?? null,
    };
    return body;
  });
}
