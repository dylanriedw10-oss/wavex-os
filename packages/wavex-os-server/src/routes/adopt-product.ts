/** POST /api/instance/:companyId/adopt-product — Path B's front door.
 *
 *  "Adopt an existing product": paste a URL, the system reads it and wires
 *  it into pillar_1 (`has_product: true` + the enriched product fields), so
 *  Build Your Organization resumes at Phase 2 with reality already loaded.
 *
 *  Two callers, one implementation:
 *    - the build surface's Path B form, directly
 *    - the canvas commit pipeline (allowlist action "adopt-product") — the
 *      capability→proposal bridge, so a URL from conversation still passes
 *      the confirm gate before we make an outbound fetch + a T2 spend
 *
 *  Honesty is first-class: a parked / thin / unreachable site returns
 *  `adopted: false` with the fetch status and a `tell_me_more` fallback —
 *  never a hallucinated company read off a parking page. */

import { z } from "zod";
import type { FastifyInstance, FastifyRequest } from "fastify";
import { handlePillar1, updatePillar, type Pillar1Response } from "@wavex-os/plugin-onboarding";
import { assertBoard, assertCompanyAccess, AuthError } from "@wavex-os/auth-shim";
import { fetchPage } from "../lib/url-prefetch.js";
import { runCombinedPillar1Enrichment } from "./pillars.js";
import { withTokenAccounting } from "../lib/token-accounting.js";

const bodySchema = z.object({
  url: z.string().min(4).max(2048),
  orgName: z.string().min(1).max(120).optional(),
}).strict();

function authReq(req: FastifyRequest) {
  return { method: req.method, headers: req.headers as Record<string, string> };
}

/** "https://acme-robotics.com/x" → "acme-robotics". Good enough for a
 *  default org name the operator can rename in conversation. */
function orgNameFromUrl(url: string): string {
  try {
    const host = new URL(/^https?:\/\//i.test(url) ? url : `https://${url}`).hostname;
    return host.replace(/^www\./i, "").split(".")[0] || host;
  } catch {
    return "your-company";
  }
}

export function registerAdoptProductRoute(app: FastifyInstance): void {
  app.post("/api/instance/:companyId/adopt-product", async (req, reply) => {
    const ar = authReq(req);
    try { assertBoard(ar); } catch (e) {
      if (e instanceof AuthError) return reply.status(e.statusCode).send({ error: e.message });
      throw e;
    }
    const { companyId } = req.params as { companyId: string };
    assertCompanyAccess(ar, companyId);
    const parsed = bodySchema.safeParse(req.body);
    if (!parsed.success) return reply.status(400).send({ error: "validation failed", issues: parsed.error.issues });
    const { url, orgName } = parsed.data;

    const page = await fetchPage(url);
    if (page.status !== "ok" || !page.body) {
      return {
        ok: true,
        adopted: false,
        fetch: { status: page.status, reason: page.reason },
        fallback: "tell_me_more" as const,
      };
    }

    const name = orgName ?? orgNameFromUrl(url);
    const enriched = await withTokenAccounting(companyId, "pillar_1", () =>
      runCombinedPillar1Enrichment({
        orgName: name,
        rawInput: page.url,
        urlContent: page.body!.slice(0, 12_000),
        manualContext: undefined,
        companyId,
      })).catch(() => null);

    if (!enriched) {
      // The fetch succeeded but enrichment didn't — still honest: the
      // operator can describe the product instead.
      return {
        ok: true,
        adopted: false,
        fetch: { status: "ok" as const, reason: "read the site, but couldn't extract product signals" },
        fallback: "tell_me_more" as const,
      };
    }

    // ADOPTING means a product exists — that is the definition of Path B.
    // The enrichment's has_product guess yields to the operator's own act.
    const final: Pillar1Response = await handlePillar1({
      org_name: name,
      raw_input: page.url,
      companyId,
      deterministicOverride: { ...enriched, has_product: true },
    });
    if (final.has_product !== true) (final as { has_product: boolean }).has_product = true;
    await updatePillar(companyId, "pillar_1", final);

    return {
      ok: true,
      adopted: true,
      fetch: { status: "ok" as const, reason: null },
      fields: final,
    };
  });
}
