/** Instance read endpoints for the dashboard. Surface the finalized
 *  company.manifest.json + per-company KPI registry derived from it. */

import { readFile } from "node:fs/promises";
import { join } from "node:path";
import type { FastifyInstance, FastifyRequest } from "fastify";
import { assertBoard, assertCompanyAccess, AuthError } from "@wavex-os/auth-shim";
import { getOnboardingDir, getInstanceDir } from "../state-bridge.js";

function authReq(req: FastifyRequest) {
  return { method: req.method, headers: req.headers as Record<string, string> };
}

interface ManifestShape {
  company?: { id?: string; name?: string };
  goal?: { kpiId?: string; current?: number; target?: number; days?: number };
  swarm_manifest?: {
    agents?: Record<string, {
      status?: string;
      role?: string;
      template_id?: string;
      reports_to_slot?: string | null;
      owned_kpi_ids?: string[];
    }>;
  };
  workflow_manifest?: { workflows?: unknown[]; routines?: unknown[] };
  state?: string;
  pillars?: Record<string, unknown>;
}

async function loadCompanyManifest(companyId: string): Promise<ManifestShape | null> {
  try {
    const path = join(getOnboardingDir(companyId), "company.manifest.json");
    const raw = await readFile(path, "utf8");
    return JSON.parse(raw) as ManifestShape;
  } catch {
    return null;
  }
}

export function registerInstanceRoutes(app: FastifyInstance): void {
  app.get("/api/instance/:companyId/manifest", async (req, reply) => {
    const ar = authReq(req);
    try { assertBoard(ar); } catch (e) {
      if (e instanceof AuthError) return reply.status(e.statusCode).send({ error: e.message });
      throw e;
    }
    const { companyId } = req.params as { companyId: string };
    assertCompanyAccess(ar, companyId);
    const manifest = await loadCompanyManifest(companyId);
    if (!manifest) return reply.status(404).send({ error: "manifest not found", companyId });
    return { ok: true, manifest };
  });

  app.get("/api/instance/:companyId/kpis", async (req, reply) => {
    const ar = authReq(req);
    try { assertBoard(ar); } catch (e) {
      if (e instanceof AuthError) return reply.status(e.statusCode).send({ error: e.message });
      throw e;
    }
    const { companyId } = req.params as { companyId: string };
    assertCompanyAccess(ar, companyId);
    const manifest = await loadCompanyManifest(companyId);
    if (!manifest) return reply.status(404).send({ error: "manifest not found", companyId });

    // Build wavex KPI registry from upstream sources:
    //   1. kpi_snapshot_initial — 12 baseline measurements from Pillar 3
    //   2. mc_winner.mean_mrr_growth — MC projection (when present)
    //   3. swarm topology — agent counts as system KPIs
    type KpiRow = {
      kpiId: string;
      label: string;
      direction: "higher_is_better" | "lower_is_better";
      ownerRole?: string;
      currentValue?: number;
      targetMicros?: number;
      windowDays?: number;
    };
    const kpis: KpiRow[] = [];

    // Headline KPI: MRR (from kpi_snapshot_initial)
    const snap = (manifest as { pillar_responses?: { pillar_3?: { kpi_snapshot_initial?: Record<string, number> } } })
      .pillar_responses?.pillar_3?.kpi_snapshot_initial;
    if (snap) {
      const KPI_DEFS: Array<{ id: keyof typeof snap; label: string; dir: "higher_is_better" | "lower_is_better"; owner: string }> = [
        { id: "mrr", label: "Monthly Recurring Revenue", dir: "higher_is_better", owner: "ceo" },
        { id: "nrr", label: "Net Revenue Retention", dir: "higher_is_better", owner: "cro" },
        { id: "grr", label: "Gross Revenue Retention", dir: "higher_is_better", owner: "cro" },
        { id: "burn_multiple", label: "Burn Multiple", dir: "lower_is_better", owner: "cfo" },
        { id: "cac_payback_months", label: "CAC Payback (months)", dir: "lower_is_better", owner: "cfo" },
        { id: "ltv_cac_ratio", label: "LTV / CAC Ratio", dir: "higher_is_better", owner: "cfo" },
        { id: "activation_rate", label: "Activation Rate", dir: "higher_is_better", owner: "cpo" },
        { id: "win_rate", label: "Win Rate", dir: "higher_is_better", owner: "cro" },
        { id: "sales_cycle_days", label: "Sales Cycle (days)", dir: "lower_is_better", owner: "cro" },
        { id: "narrative_strength", label: "Narrative Strength", dir: "higher_is_better", owner: "cmo" },
      ];
      for (const k of KPI_DEFS) {
        const v = snap[k.id];
        if (v == null) continue;
        kpis.push({
          kpiId: String(k.id),
          label: k.label,
          direction: k.dir,
          ownerRole: k.owner,
          currentValue: v,
        });
      }
    }

    // System KPI: MC projected mean MRR growth (when finalize ran with MC)
    const mc = (manifest as { mc_winner?: { mean_mrr_growth?: number; strategy_id?: string } }).mc_winner;
    if (mc?.mean_mrr_growth != null) {
      kpis.push({
        kpiId: "mc_projected_mrr_growth",
        label: `Projected MRR growth (${mc.strategy_id ?? "MC winner"})`,
        direction: "higher_is_better",
        ownerRole: "ceo",
        currentValue: mc.mean_mrr_growth,
      });
    }

    return { ok: true, companyId, kpis };
  });

  app.get("/api/companies", async (req, reply) => {
    const ar = authReq(req);
    try { assertBoard(ar); } catch (e) {
      if (e instanceof AuthError) return reply.status(e.statusCode).send({ error: e.message });
      throw e;
    }
    // Enumerate companies from the plugin's session layout:
    //   ~/.wavex-os/instances/default/companies/<companyId>/onboarding/
    //
    // Each entry carries its REAL state, read off the filesystem — the
    // entry screen has to tell a live company from an abandoned test
    // shell, and a directory name alone can't. The ladder is ordered by
    // how far a company got; the first file that exists wins:
    //
    //   org.json                 → live      (activated: it has a spine)
    //   company.manifest.json    → finalized (signed, not yet activated)
    //   pillar_responses.json    → draft     (answers in flight)
    //   (nothing)                → empty     (a directory and no more)
    try {
      const fs = await import("node:fs/promises");
      const companiesRoot = join(getInstanceDir(""), "default", "companies");
      const entries = await fs.readdir(companiesRoot, { withFileTypes: true }).catch(() => []);
      const companies = await Promise.all(entries
        .filter((e) => e.isDirectory())
        .map(async (e) => {
          const dir = getOnboardingDir(e.name);
          const stat = async (f: string) => await fs.stat(join(dir, f)).then((s) => s, () => null);
          const [org, manifest, pillars] = await Promise.all([
            stat("org.json"), stat("company.manifest.json"), stat("pillar_responses.json"),
          ]);
          const state = org ? "live" : manifest ? "finalized" : pillars ? "draft" : "empty";
          // Last touch across whatever exists — sorts the list by recency
          // so the company you were just in is at the top.
          const touched = [org, manifest, pillars]
            .filter((s): s is NonNullable<typeof s> => s !== null)
            .map((s) => s.mtimeMs);
          return {
            id: e.name,
            name: e.name,
            state,
            updatedAt: touched.length ? new Date(Math.max(...touched)).toISOString() : null,
          };
        }));
      companies.sort((a, b) => (b.updatedAt ?? "").localeCompare(a.updatedAt ?? ""));
      return { ok: true, companies };
    } catch (e) {
      return reply.status(500).send({ error: "failed to enumerate companies" });
    }
  });

  // Fleet listing (mock-core stand-in for Paperclip's /api/companies/:id/
  // agents). Reads swarm_manifest.json (pre-finalize) or company.manifest.
  // json's swarm_manifest section (post-finalize) and projects each agent
  // into a flat list with status. Used by InceptionCTA's "agents ready"
  // probe and any future fleet-summary surface.
  app.get("/api/companies/:companyId/agents", async (req, reply) => {
    const ar = authReq(req);
    try { assertBoard(ar); } catch (e) {
      if (e instanceof AuthError) return reply.status(e.statusCode).send({ error: e.message });
      throw e;
    }
    const { companyId } = req.params as { companyId: string };
    assertCompanyAccess(ar, companyId);
    const manifest = await loadCompanyManifest(companyId);
    // Try the full company manifest first (post-finalize) then fall back to
    // swarm_manifest.json which exists earlier in the wizard.
    let agents: Record<string, { status?: string }> = {};
    if (manifest?.swarm_manifest?.agents) {
      agents = manifest.swarm_manifest.agents;
    } else {
      try {
        const raw = await readFile(join(getOnboardingDir(companyId), "swarm_manifest.json"), "utf8");
        const swarm = JSON.parse(raw) as { agents?: Record<string, { status?: string }> };
        agents = swarm.agents ?? {};
      } catch { /* no swarm yet — return [] */ }
    }
    const list = Object.entries(agents).map(([slot, info]) => ({
      slot,
      status: info?.status ?? "unknown",
    }));
    return reply.send(list);
  });

  // "Force first cycle now" handler — fires a synthetic heartbeat event
  // per agent. Mock-core doesn't actually run agents (Paperclip does), so
  // this is a recorded acknowledgement rather than a real trigger.
  //
  // Persists to ~/.wavex-os/instances/.../triggered-heartbeats.jsonl so
  // a future fleet status surface can show "last manually triggered: <ts>".
  // When Paperclip is configured (paperclip-handoff.json present) we ALSO
  // forward to Paperclip's real trigger endpoint so the heartbeats fire
  // there too.
  app.post("/api/companies/:companyId/trigger-heartbeats", async (req, reply) => {
    const ar = authReq(req);
    try { assertBoard(ar); } catch (e) {
      if (e instanceof AuthError) return reply.status(e.statusCode).send({ error: e.message });
      throw e;
    }
    const { companyId } = req.params as { companyId: string };
    assertCompanyAccess(ar, companyId);
    const manifest = await loadCompanyManifest(companyId);
    let slots: string[] = manifest?.swarm_manifest?.agents
      ? Object.keys(manifest.swarm_manifest.agents)
      : [];
    if (slots.length === 0) {
      try {
        const raw = await readFile(join(getOnboardingDir(companyId), "swarm_manifest.json"), "utf8");
        const swarm = JSON.parse(raw) as { agents?: Record<string, unknown> };
        slots = Object.keys(swarm.agents ?? {});
      } catch { /* no swarm */ }
    }

    // Record the trigger event locally (every operator/customer audit
    // would want to know when manual triggers happened).
    let recorded = 0;
    try {
      const { appendFile, mkdir } = await import("node:fs/promises");
      const dir = join(getOnboardingDir(companyId), "..");
      await mkdir(dir, { recursive: true });
      const line = JSON.stringify({
        triggered_at: new Date().toISOString(),
        slots,
        source: "mission-control:force-first-cycle",
      }) + "\n";
      await appendFile(join(dir, "triggered-heartbeats.jsonl"), line, "utf8");
      recorded = slots.length;
    } catch { /* best-effort */ }

    // Forward to Paperclip if configured. Mock-core can't actually fire
    // agent heartbeats; only Paperclip can.
    let forwarded = 0;
    let forwardError: string | null = null;
    try {
      const handoffRaw = await readFile(
        join(getOnboardingDir(companyId), "..", "paperclip-handoff.json"),
        "utf8",
      ).catch(() => null);
      if (handoffRaw) {
        const handoff = JSON.parse(handoffRaw) as { paperclipUrl?: string; paperclipCompanyId?: string };
        if (handoff.paperclipUrl && handoff.paperclipCompanyId) {
          const r = await fetch(
            `${handoff.paperclipUrl}/api/companies/${handoff.paperclipCompanyId}/trigger-heartbeats`,
            { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({}) },
          );
          if (r.ok) {
            const body = await r.json().catch(() => ({})) as { triggered?: number };
            forwarded = body.triggered ?? slots.length;
          } else {
            forwardError = `paperclip returned HTTP ${r.status}`;
          }
        }
      }
    } catch (e) {
      forwardError = e instanceof Error ? e.message : String(e);
    }

    return reply.send({
      ok: true,
      triggered: forwarded > 0 ? forwarded : recorded,
      source: forwarded > 0 ? "paperclip" : "mock-recorded",
      ...(forwardError ? { paperclip_forward_error: forwardError } : {}),
    });
  });

  // Post-activate handoff state — read by InceptionCTA on Mission Control to
  // decide whether to show "Open Paperclip Dashboard" with a real link vs
  // the generic "fleet is live, defaults to localhost:5174" fallback.
  // The handoff JSON is written by bridge/paperclip-handoff.ts when activate
  // successfully posts the manifest to a Paperclip backend; absent it,
  // either Paperclip wasn't configured (PAPERCLIP_HANDOFF_URL empty) or the
  // customer ran with mock-core only.
  app.get("/api/instance/:companyId/handoff", async (req, reply) => {
    const ar = authReq(req);
    try { assertBoard(ar); } catch (e) {
      if (e instanceof AuthError) return reply.status(e.statusCode).send({ error: e.message });
      throw e;
    }
    const { companyId } = req.params as { companyId: string };
    assertCompanyAccess(ar, companyId);
    try {
      const path = join(getOnboardingDir(companyId), "..", "paperclip-handoff.json");
      const raw = await readFile(path, "utf8");
      const j = JSON.parse(raw) as {
        paperclipUrl?: string;
        paperclipCompanyId?: string;
        handedOffAt?: string;
      };
      return {
        ok: true,
        handoff: {
          paperclipUrl: j.paperclipUrl ?? null,
          paperclipCompanyId: j.paperclipCompanyId ?? null,
          handedOff: Boolean(j.paperclipUrl && j.paperclipCompanyId),
        },
      };
    } catch {
      // No handoff file → fleet is local-only (mock-core / unconfigured
      // Paperclip). CTA degrades to the generic "live on localhost" message.
      return { ok: true, handoff: { paperclipUrl: null, paperclipCompanyId: null, handedOff: false } };
    }
  });

  // Server-side probe for Paperclip on localhost:3100. The browser used to
  // do this directly, but Chrome logs `net::ERR_CONNECTION_REFUSED` to the
  // DevTools console for every failed cross-origin fetch even when JS
  // catches the rejection — turning the InceptionCTA's 2 s poll loop into
  // a noisy DevTools spammer for users on `pnpm dev:no-paperclip`.
  //
  // Probing server-side avoids the cross-origin shape entirely, returns
  // structured JSON the client can consume cleanly, and lets us swap the
  // probe target later (different host, different port, health endpoint)
  // without touching the UI.
  //
  // Cheap: 800 ms timeout, no body parsing, treats any HTTP response as
  // "reachable" since Paperclip's root may legitimately return 302/404.
  app.get("/api/paperclip-reachable", async (_req, reply) => {
    const target = process.env.PAPERCLIP_PROBE_URL ?? "http://127.0.0.1:3100/";
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 800);
    try {
      const r = await fetch(target, { signal: controller.signal, redirect: "manual" });
      clearTimeout(timer);
      return reply.send({
        ok: true,
        reachable: true,
        target,
        status: r.status,
      });
    } catch (err) {
      clearTimeout(timer);
      // Node 18+ fetch wraps the real reason in `err.cause` (TypeError:
      // fetch failed + cause.code='ECONNREFUSED'). Check both layers.
      const errAny = err as { message?: string; name?: string; cause?: { code?: string; message?: string } };
      const code = errAny?.cause?.code ?? "";
      const msg = errAny?.message ?? "";
      const causeMsg = errAny?.cause?.message ?? "";
      const blob = `${code} ${msg} ${causeMsg}`;
      return reply.send({
        ok: true,
        reachable: false,
        target,
        reason: blob.includes("ECONNREFUSED")
          ? "not_listening"
          : errAny?.name === "AbortError" || blob.includes("aborted") || blob.includes("timeout")
            ? "timeout"
            : "other",
      });
    }
  });
}
