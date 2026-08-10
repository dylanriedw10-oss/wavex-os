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
  /** How many agents this run actually put to work — or NULL when the run
   *  that wrote the file did not record such a thing.
   *
   *  Nullable because it genuinely is. Two ignition variants write this file
   *  and only one of them touches agents: `bridge/ignition.ts` stamps a
   *  heartbeat offset per non-muted agent, so its count is real, while
   *  `bridge/ignition-native.ts` seeds a goal and tasks and never looks at
   *  the fleet. This field previously served the SEEDED TASK COUNT under an
   *  agent's name on both paths — a 35-agent company read "7 agents working"
   *  because seven tasks had been created. */
  agentsWorking: number | null;
  /** Pieces of work queued: issues + roadmap items on the Paperclip path,
   *  bootstrap tasks on the native one. Both are genuinely counts of work. */
  workflowsQueued: number;
  /** The coverage gaps the run recorded. Was previously inferred from
   *  `warnings.length`, which is a different thing entirely — a healthy
   *  idempotent re-activate pushes the warning "work store already seeded"
   *  and was therefore rendered as "1 gaps". */
  gaps: string[];
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
    const anySteps = state?.steps as Record<string, {
      created?: string[]; goal_id?: string; gaps?: string[]; offsets?: Record<string, number>;
    } | undefined> | undefined;

    // Each number derived from the thing it is named after, and only when
    // that thing is on disk.
    //
    // AGENTS. `stagger_heartbeats.offsets` carries one entry per non-muted
    // agent (bridge/ignition.ts stamps `offsets[agent.slot]` for each), so
    // subtracting the coverage gaps reproduces exactly what the POST path
    // computes as `nonMuted.length - gaps.length`. The native variant never
    // writes that step, so it has no agent count and gets `null` — the
    // difference between "zero agents are working" and "this run never
    // looked" is the whole point of the field being nullable.
    const gaps = anySteps?.validate_coverage?.gaps ?? [];
    const offsets = anySteps?.stagger_heartbeats?.offsets;
    const agentsWorking = offsets ? Math.max(0, Object.keys(offsets).length - gaps.length) : null;

    // WORK. Two vocabularies for the same fact: the Paperclip path creates
    // issues and roadmap items, the native path creates bootstrap tasks.
    const queued =
      (anySteps?.seed_tasks?.created?.length ?? 0) +
      (anySteps?.seed_issues?.created?.length ?? 0) +
      (anySteps?.seed_roadmap?.created?.length ?? 0);

    const body: IgnitionStatusResponse = {
      ok: true,
      status: deriveStatus(state),
      agentsWorking,
      workflowsQueued: queued,
      gaps,
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
