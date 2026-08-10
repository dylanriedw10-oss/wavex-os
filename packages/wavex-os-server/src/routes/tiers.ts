/** GET /api/tiers — returns the TIERS array (server-controlled copy).
 *  POST /api/tier-subscriptions — stub. Records the operator's chosen
 *  tier for the demo (logged + returned). No charge fires; no DB row is
 *  written. When real billing ships (post-demo backlog §7.1), this
 *  becomes the Stripe Checkout entry point and writes to a
 *  tier_subscriptions table. */

import { z } from "zod";
import type { FastifyInstance, FastifyRequest } from "fastify";
import { assertBoard, assertCompanyAccess, AuthError } from "@wavex-os/auth-shim";
import { BILLING_LIVE, TIERS, type TierId } from "../config/pricing.js";

const subscribeBody = z.object({
  orgId: z.string().min(1),
  tierId: z.enum(["trial", "founder", "growth", "custom"]),
  origin: z.enum(["subscribe", "skip"]),
});

function authReq(req: FastifyRequest) {
  return { method: req.method, headers: req.headers as Record<string, string> };
}

export function registerTiersRoutes(app: FastifyInstance): void {
  app.get("/api/tiers", async () => {
    // `billingLive` travels WITH the prices, so no surface can render a
    // priced card without also receiving the fact that nothing will be
    // charged. Shipping the flag separately (or not at all) is how the
    // cards came to assert a purchase the stub below never makes.
    return { ok: true, tiers: TIERS, billingLive: BILLING_LIVE };
  });

  app.post("/api/tier-subscriptions", async (req, reply) => {
    const ar = authReq(req);
    try { assertBoard(ar); } catch (e) {
      if (e instanceof AuthError) return reply.status(e.statusCode).send({ error: e.message });
      throw e;
    }
    const parsed = subscribeBody.safeParse(req.body);
    if (!parsed.success) {
      return reply.status(400).send({ ok: false, error: "validation failed", issues: parsed.error.issues });
    }
    const { orgId, tierId, origin } = parsed.data;
    assertCompanyAccess(ar, orgId);

    // Stub: record the intent so the wizard can advance. No DB write, no
    // charge. When real billing ships, this is where Stripe Checkout
    // session creation lives + a tier_subscriptions row gets written.
    // eslint-disable-next-line no-console
    console.log(`[tier-subscriptions] ${orgId} → ${tierId} (origin=${origin})`);

    const effectiveTier: TierId = origin === "skip" ? "trial" : tierId;
    return { ok: true, orgId, tierId: effectiveTier, origin };
  });
}
