/** The native work routes — WaveX's own runtime surface (spec Rev 6).
 *
 *    GET  /api/instance/:companyId/work                     the L2/L5 read
 *    POST /api/instance/:companyId/work/seed                idempotent fleet start
 *    POST /api/instance/:companyId/work/goals               create-goal (gated)
 *    POST /api/instance/:companyId/work/tasks               create-task (gated)
 *    POST /api/instance/:companyId/work/run-cycle           run-cycle (gated)
 *    POST /api/instance/:companyId/work/deliverables/:id/review   the QA gate
 *
 *  Every mutation runs the constitution gate inline (these routes are also
 *  the executors behind the commit allowlist — the gate fires either way)
 *  and lands in the run log. Review is replay-idempotent like commit. */

import { z } from "zod";
import type { FastifyInstance } from "fastify";
import { assertBoard, assertCompanyAccess, AuthError } from "@wavex-os/auth-shim";
import { COMPANY_ID_RE, authReq } from "./ignition.js";
import { checkConstitution, readOrg } from "../org/store.js";
import {
  DEFAULT_MAX_ATTEMPTS, logEvent, newId, readWork, writeWork,
} from "../work/store.js";
import { seedWork } from "../work/seed.js";
import { runCycle } from "../work/cycle.js";

const goalSchema = z.object({
  title: z.string().min(1).max(200),
  description: z.string().max(2000).optional(),
});

const taskSchema = z.object({
  goalId: z.string().min(1).max(60),
  title: z.string().min(1).max(200),
  brief: z.string().min(1).max(8000),
  assigneeSlot: z.string().min(1).max(80),
  dependsOn: z.array(z.string().max(60)).max(20).optional(),
  maxAttempts: z.number().int().min(1).max(10).optional(),
});

const cycleSchema = z.object({
  maxTasks: z.number().int().min(1).max(10).optional(),
});

const reviewSchema = z.object({
  verdict: z.enum(["approved", "changes_requested"]),
  note: z.string().max(2000).optional(),
});

type Reply = { status: (n: number) => { send: (b: unknown) => unknown } };

function guard(app: FastifyInstance, handler: (companyId: string, req: any, reply: any) => Promise<unknown>) {
  return async (req: any, reply: Reply) => {
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
    return handler(companyId, req, reply);
  };
}

/** The constitution gate, inline: a 409 with the reason, never silent. */
async function gate(companyId: string, action: string, body: Record<string, unknown>, reply: Reply): Promise<boolean> {
  const org = await readOrg(companyId);
  const verdict = checkConstitution(org, action, body);
  if (!verdict.allowed) {
    reply.status(409).send({ ok: false, error: `constitution: ${verdict.reason}` });
    return false;
  }
  return true;
}

export function registerWorkRoutes(app: FastifyInstance): void {
  app.get("/api/instance/:companyId/work", guard(app, async (companyId, _req, reply) => {
    const w = await readWork(companyId);
    if (!w) return reply.status(503).send({ ok: false, error: "runtime not started — activate or seed first" });
    return {
      ok: true,
      goals: w.goals,
      tasks: w.tasks,
      deliverables: w.deliverables.slice(-20).reverse(),
      runLog: w.runLog.slice(-40).reverse(),
    };
  }));

  app.post("/api/instance/:companyId/work/seed", guard(app, async (companyId, _req, reply) => {
    const r = await seedWork(companyId);
    if (!r.ok) return reply.status(409).send(r);
    return r;
  }));

  app.post("/api/instance/:companyId/work/goals", guard(app, async (companyId, req, reply) => {
    const parsed = goalSchema.safeParse(req.body);
    if (!parsed.success) return reply.status(400).send({ ok: false, error: "validation failed", issues: parsed.error.issues });
    if (!(await gate(companyId, "create-goal", parsed.data, reply))) return;
    const w = await readWork(companyId);
    if (!w) return reply.status(503).send({ ok: false, error: "runtime not started — seed first" });
    const goal = {
      id: newId("goal"), title: parsed.data.title, description: parsed.data.description ?? "",
      status: "active" as const, source: "operator" as const, createdAt: new Date().toISOString(),
    };
    w.goals.push(goal);
    logEvent(w, "goal_created", goal.title);
    await writeWork(companyId, w);
    return { ok: true, goal };
  }));

  app.post("/api/instance/:companyId/work/tasks", guard(app, async (companyId, req, reply) => {
    const parsed = taskSchema.safeParse(req.body);
    if (!parsed.success) return reply.status(400).send({ ok: false, error: "validation failed", issues: parsed.error.issues });
    if (!(await gate(companyId, "create-task", parsed.data, reply))) return;
    const w = await readWork(companyId);
    if (!w) return reply.status(503).send({ ok: false, error: "runtime not started — seed first" });
    if (!w.goals.some((g) => g.id === parsed.data.goalId)) {
      return reply.status(404).send({ ok: false, error: "no such goal" });
    }
    const badDep = (parsed.data.dependsOn ?? []).find((id) => !w.tasks.some((t) => t.id === id));
    if (badDep) return reply.status(404).send({ ok: false, error: `unknown dependency: ${badDep}` });
    const now = new Date().toISOString();
    const task = {
      id: newId("task"), goalId: parsed.data.goalId, title: parsed.data.title,
      brief: parsed.data.brief, assigneeSlot: parsed.data.assigneeSlot,
      status: "todo" as const, dependsOn: parsed.data.dependsOn ?? [],
      attempts: 0, maxAttempts: parsed.data.maxAttempts ?? DEFAULT_MAX_ATTEMPTS,
      feedback: [], createdAt: now, updatedAt: now, startedAt: null, completedAt: null,
    };
    w.tasks.push(task);
    logEvent(w, "task_created", task.title, task.id, task.assigneeSlot);
    await writeWork(companyId, w);
    return { ok: true, task };
  }));

  app.post("/api/instance/:companyId/work/run-cycle", guard(app, async (companyId, req, reply) => {
    const parsed = cycleSchema.safeParse(req.body ?? {});
    if (!parsed.success) return reply.status(400).send({ ok: false, error: "validation failed", issues: parsed.error.issues });
    if (!(await gate(companyId, "run-cycle", parsed.data, reply))) return;
    const summary = await runCycle(companyId, parsed.data);
    if (!summary.ok) {
      const status = summary.error.includes("not started") ? 503 : 409;
      return reply.status(status).send(summary);
    }
    return summary;
  }));

  app.post("/api/instance/:companyId/work/deliverables/:deliverableId/review", guard(app, async (companyId, req, reply) => {
    const { deliverableId } = req.params as { deliverableId: string };
    const parsed = reviewSchema.safeParse(req.body);
    if (!parsed.success) return reply.status(400).send({ ok: false, error: "validation failed", issues: parsed.error.issues });
    if (!(await gate(companyId, "review-deliverable", parsed.data, reply))) return;
    const w = await readWork(companyId);
    if (!w) return reply.status(503).send({ ok: false, error: "runtime not started — seed first" });
    const d = w.deliverables.find((x) => x.id === deliverableId);
    if (!d) return reply.status(404).send({ ok: false, error: "no such deliverable" });
    // Replay-idempotent: a decided review returns the recorded outcome.
    if (d.review !== "pending_review") {
      return { ok: true, deliverable: d, replayed: true };
    }
    const task = w.tasks.find((t) => t.id === d.taskId);
    if (!task) return reply.status(404).send({ ok: false, error: "deliverable's task is gone" });

    const now = new Date().toISOString();
    d.reviewedAt = now;
    d.reviewNote = parsed.data.note ?? null;

    if (parsed.data.verdict === "approved") {
      d.review = "approved";
      task.status = "done";
      task.completedAt = now;
      task.updatedAt = now;
      logEvent(w, "review_approved", parsed.data.note ?? "approved", task.id, task.assigneeSlot);
      logEvent(w, "task_done", task.title, task.id, task.assigneeSlot);
    } else {
      d.review = "changes_requested";
      task.feedback.push(parsed.data.note ?? "changes requested");
      const atCeiling = task.attempts >= task.maxAttempts;
      task.status = atCeiling ? "failed" : "todo";
      task.updatedAt = now;
      logEvent(w, "review_changes", parsed.data.note ?? "changes requested", task.id, task.assigneeSlot);
      logEvent(w, atCeiling ? "task_failed" : "task_requeued",
        atCeiling ? "attempt ceiling reached — escalated to operator" : "requeued with review feedback",
        task.id, task.assigneeSlot);
    }
    await writeWork(companyId, w);
    return { ok: true, deliverable: d, task };
  }));
}
