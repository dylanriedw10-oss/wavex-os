/** The runtime read surface — same contract, native truth (spec Rev 6).
 *
 *  These four paths, envelopes, and field names are the wire contract the
 *  old Paperclip adapter served; five consumers (catalog, composer,
 *  snapshot, org/nodes, cells) read them and none changed for the pivot.
 *  The status vocabulary is preserved exactly:
 *
 *    503 — runtime not started (work.json absent): the NORMAL pre-seed
 *          state → catalog emptyStatuses → quiet empty cell, org nodes
 *          stay honestly idle.
 *    200 — the store exists; every number is COUNTED from it. */

import type { FastifyInstance } from "fastify";
import { assertBoard, assertCompanyAccess, AuthError } from "@wavex-os/auth-shim";
import { COMPANY_ID_RE, authReq } from "./ignition.js";
import {
  deriveActivity, deriveApprovals, deriveDashboard, deriveLiveRuns, readWork,
  type WorkFile,
} from "../work/store.js";

const READS: Record<string, (w: WorkFile) => Record<string, unknown>> = {
  dashboard: (w) => ({ dashboard: deriveDashboard(w) }),
  activity: (w) => ({ events: deriveActivity(w) }),
  approvals: (w) => ({ approvals: deriveApprovals(w) }),
  "live-runs": (w) => ({ runs: deriveLiveRuns(w) }),
};

export function registerRuntimeNativeRoutes(app: FastifyInstance): void {
  for (const [name, derive] of Object.entries(READS)) {
    app.get(`/api/instance/:companyId/runtime/${name}`, async (req: any, reply: any) => {
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
      const w = await readWork(companyId);
      if (!w) {
        return reply.status(503).send({ ok: false, error: "runtime not started — activate or seed first" });
      }
      return { ok: true, ...derive(w) };
    });
  }
}
