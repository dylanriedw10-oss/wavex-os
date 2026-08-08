/** End-to-end onboarding harness.
 *
 *  For each fixture company:
 *    1. POST pillar/1..5 (with deterministic_override on Pillar 1 to skip live T2)
 *    2. GET connector-recommendations + assert industry-appropriate connectors
 *    3. POST connector-manifest, swarm-manifest, workflow-manifest
 *    4. Walk Credential Concierge — vault some, skip some
 *    5. POST finalize → assert manifest shape, signed sha256, expected files on disk
 *    6. GET /api/instance/<id>/{manifest,kpis} — assert dashboard hydrates
 *
 *  No live T2 inference (bypass via deterministicOverride / skipInference).
 *  That is not a promise this file makes and hopes you believe — every test
 *  below ends by asserting it, via the process-level guard in
 *  ./helpers/no-inference.ts. See that file for why a timeout is not an
 *  assertion. */

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync, existsSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Fastify, { type FastifyInstance } from "fastify";
import { registerWavexOsRoutes } from "../src/index.js";
import { _resetDbCache } from "@wavex-os/db";
import { _resetMasterKeyCache } from "../src/vault/crypto.js";
import { _resetMigrationLatch } from "../src/vault/service.js";
import {
  installNoInferenceGuard,
  uninstallNoInferenceGuard,
  resetInferenceLog,
  assertNoInference,
} from "./helpers/no-inference.js";
import {
  installNoEgressGuard,
  uninstallNoEgressGuard,
  resetEgressLog,
  assertNoEgress,
} from "./helpers/no-egress.js";

let tempDir: string;
let app: FastifyInstance;

beforeAll(async () => {
  // Install BEFORE the server boots: applyInferenceEnv() resolves the claude
  // bin at registration time, and we want every launch after that to route
  // through the guard.
  installNoInferenceGuard();
  // The process guard covers spawns only. T1 inference and every Paperclip
  // control-plane call go out over fetch, where it cannot see them — and
  // detectAndConfigurePaperclip() will point the handoff bridge at any
  // Paperclip that answers on 3100/3000. No origin is allowlisted here:
  // this file owns no listener, so it should reach nothing.
  installNoEgressGuard();
  tempDir = mkdtempSync(join(tmpdir(), "wavex-e2e-"));
  process.env.WAVEX_OS_STATE_DIR = tempDir;
  process.env.PAPERCLIP_DATA_DIR = tempDir;
  process.env.WAVEX_DB_DATA_DIR = join(tempDir, "db");
  process.env.WAVEX_AUTH_MODE = "dev";
  process.env.WAVEX_COMPOSIO_DISABLED = "1";
  process.env.CREDENTIAL_VAULT_MASTER_KEY = "0".repeat(64);
  _resetDbCache();
  _resetMasterKeyCache();
  _resetMigrationLatch();

  app = Fastify({ logger: false });
  registerWavexOsRoutes(app);
  await app.ready();

  // Assert here too, not only in afterEach: beforeEach calls resetEgressLog(),
  // so anything route registration or boot did would be erased before the
  // first test could report it. Without this line the guard is blind to
  // exactly the code that runs earliest.
  assertNoEgress("e2e onboarding — server boot");
});

beforeEach(() => {
  // Per-test log, so a failure names the phase that went online rather than
  // pointing at whichever test happened to run last.
  resetInferenceLog();
  resetEgressLog();
});

// The blanket net. Deliberately an afterEach and not a line inside each test:
// the file-level claim is that NOTHING here talks to a model or to a control
// plane, so a test added tomorrow inherits both assertions instead of having
// to remember them.
afterEach(() => {
  const where = `e2e onboarding — "${expect.getState().currentTestName ?? "unknown test"}"`;
  assertNoInference(where);
  assertNoEgress(where);
});

afterAll(async () => {
  uninstallNoInferenceGuard();
  uninstallNoEgressGuard();
  await app?.close();
  delete process.env.WAVEX_OS_STATE_DIR;
  delete process.env.PAPERCLIP_DATA_DIR;
  delete process.env.WAVEX_DB_DATA_DIR;
  delete process.env.WAVEX_AUTH_MODE;
  delete process.env.WAVEX_COMPOSIO_DISABLED;
  delete process.env.CREDENTIAL_VAULT_MASTER_KEY;
  rmSync(tempDir, { recursive: true, force: true });
});

interface Fixture {
  companyId: string;
  pillar1: { org_name: string; raw_input: string; manual_context: string };
  pillar2: { claude_plan: "max_20x" | "max_5x" | "api_only" | "other" };
  pillar3: { product_state: string; stage: string };
  pillar4: { lead_sources: string[]; sales_motion: string; close_channel?: string };
  pillar5: { comm_channel: string; urgency_routing?: string };
  expect: {
    industry_hint: string;
    requiredIncludes: string[];
    requiredExcludes?: string[];
    suggestedIncludes?: string[];
  };
}

const FIXTURES: Fixture[] = [
  {
    companyId: "fx-acme-saas",
    pillar1: {
      org_name: "Acme",
      raw_input: "https://acme.example",
      manual_context: "Acme is a B2B SaaS platform for workflow automation. We sell to mid-market ops teams via assisted demo, $1k-5k/mo subscription pricing.",
    },
    pillar2: { claude_plan: "max_5x" },
    pillar3: { product_state: "live_paying_customers", stage: "10k_100k_mrr" },
    pillar4: { lead_sources: ["outbound_cold"], sales_motion: "assisted_demo", close_channel: "mostly_phone_video" },
    pillar5: { comm_channel: "telegram", urgency_routing: "all_to_one_channel" },
    expect: {
      industry_hint: "b2b_saas",
      requiredIncludes: ["claude-code", "supabase", "telegram"],
      requiredExcludes: ["shopify"],  // not consumer hardware
    },
  },
  {
    companyId: "fx-pulse-preprod",
    pillar1: {
      org_name: "Pulse",
      raw_input: "no product yet",
      manual_context: "Pulse is a pre-product idea — exploring AI-driven fitness coaching for solo trainers. No code shipped, no paying customers, validating with interviews.",
    },
    pillar2: { claude_plan: "max_5x" },
    pillar3: { product_state: "idea_only", stage: "pre_product" },
    pillar4: { lead_sources: ["none_yet"], sales_motion: "none_yet" },
    pillar5: { comm_channel: "telegram" },
    expect: {
      industry_hint: "unknown",
      requiredIncludes: ["claude-code", "telegram"],
      requiredExcludes: ["supabase"], // no live customers
    },
  },
  {
    companyId: "fx-ricoma-hardware",
    pillar1: {
      org_name: "Ricoma",
      raw_input: "https://ricoma.com",
      manual_context: "Ricoma manufactures and sells commercial embroidery machines + Chroma SaaS to small custom-apparel businesses. Direct-to-consumer hardware sales with hardware financing. consumer_hardware industry.",
    },
    pillar2: { claude_plan: "max_5x" },
    pillar3: { product_state: "live_paying_customers", stage: "more_than_1m_mrr" },
    pillar4: { lead_sources: ["content_seo", "referral_word_of_mouth"], sales_motion: "self_serve_plg" },
    pillar5: { comm_channel: "telegram", urgency_routing: "all_to_one_channel" },
    expect: {
      industry_hint: "consumer_hardware",
      requiredIncludes: ["claude-code", "supabase", "telegram", "shopify", "stripe"],
      suggestedIncludes: ["klaviyo"],
    },
  },
  {
    companyId: "fx-rho-marketplace",
    pillar1: {
      org_name: "Rho Logistics",
      raw_input: "https://rho.example",
      manual_context: "Rho is a 2-sided marketplace connecting freight shippers with trucking owner-operators. Take-rate model. We handle payments + dispatch. marketplace industry.",
    },
    pillar2: { claude_plan: "max_5x" },
    pillar3: { product_state: "live_paying_customers", stage: "100k_1m_mrr" },
    pillar4: { lead_sources: ["outbound_cold"], sales_motion: "assisted_demo", close_channel: "mostly_phone_video" },
    pillar5: { comm_channel: "slack" },
    expect: {
      industry_hint: "marketplace",
      requiredIncludes: ["claude-code", "supabase", "stripe-connect"],
      suggestedIncludes: ["segment"],
    },
  },
  {
    companyId: "fx-iris-edu",
    pillar1: {
      org_name: "Iris EdTech",
      raw_input: "https://iris.edu.example",
      manual_context: "Iris is an edtech platform — async coding bootcamps for working adults. Subscription tuition $200/mo, video courses + cohort discord. edtech industry.",
    },
    pillar2: { claude_plan: "max_5x" },
    pillar3: { product_state: "live_paying_customers", stage: "10k_100k_mrr" },
    pillar4: { lead_sources: ["content_seo"], sales_motion: "self_serve_plg" },
    pillar5: { comm_channel: "telegram" },
    expect: {
      industry_hint: "edtech",
      requiredIncludes: ["claude-code", "supabase", "stripe", "mixpanel"],
    },
  },
];

async function inject<T = unknown>(method: "GET" | "POST", url: string, body?: unknown): Promise<{ status: number; body: T }> {
  const r = await app.inject({ method, url, payload: body as never });
  return { status: r.statusCode, body: r.json() as T };
}

async function walkPillars(fx: Fixture): Promise<void> {
  // Pillar 1 — deterministic. skipInference keeps the wavex-layer enrichment
  // (combined tier-router call + BYOC fallback) offline, so the vendored
  // handlePillar1 answers from manual_context (≥40 chars → manual_capture).
  // Without it this walk spawns real T2 and blows the 30 s budget below.
  const p1 = await inject<{ ok: boolean; response: { industry_hint: string } }>("POST", "/wavex-os/onboarding/pillar/1", {
    companyId: fx.companyId,
    org_name: fx.pillar1.org_name,
    raw_input: fx.pillar1.raw_input,
    manual_context: fx.pillar1.manual_context,
    skipInference: true,
  });
  expect(p1.status, `pillar 1 for ${fx.companyId}`).toBe(200);
  expect(p1.body.ok).toBe(true);
  assertNoInference(`pillar 1 for ${fx.companyId} (skipInference: true)`);

  // Pillar 2 — claude capability probe; in test env we only assert the pillar
  // accepts the post. skipInference keeps it to `--version` (does this machine
  // have the CLI?) instead of the vendored probe's second step, a live
  // `claude -p "Reply with exactly: OK"` with a 60 s budget — which is real T2
  // inference, inside a 30 s vitest ceiling, five times per run.
  const p2 = await inject<{ ok: boolean }>("POST", "/wavex-os/onboarding/pillar/2", {
    companyId: fx.companyId,
    claude_plan: fx.pillar2.claude_plan,
    skipInference: true,
  });
  expect(p2.status, `pillar 2 for ${fx.companyId}`).toBe(200);
  assertNoInference(`pillar 2 for ${fx.companyId} (skipInference: true)`);

  const p3 = await inject<{ ok: boolean }>("POST", "/wavex-os/onboarding/pillar/3", {
    companyId: fx.companyId,
    product_state: fx.pillar3.product_state,
    stage: fx.pillar3.stage,
  });
  expect(p3.status, `pillar 3 for ${fx.companyId}`).toBe(200);
  expect(p3.body.ok).toBe(true);

  const p4 = await inject<{ ok: boolean }>("POST", "/wavex-os/onboarding/pillar/4", {
    companyId: fx.companyId,
    lead_sources: fx.pillar4.lead_sources,
    sales_motion: fx.pillar4.sales_motion,
    close_channel: fx.pillar4.close_channel,
  });
  expect(p4.status, `pillar 4 for ${fx.companyId}`).toBe(200);
  expect(p4.body.ok).toBe(true);

  const p5 = await inject<{ ok: boolean }>("POST", "/wavex-os/onboarding/pillar/5", {
    companyId: fx.companyId,
    comm_channel: fx.pillar5.comm_channel,
    urgency_routing: fx.pillar5.urgency_routing,
  });
  expect(p5.status, `pillar 5 for ${fx.companyId}`).toBe(200);
  expect(p5.body.ok).toBe(true);
}

async function walkPhases(fx: Fixture): Promise<{ requiredIds: string[]; suggestedIds: string[]; deferredIds: string[] }> {
  const conn = await inject<{ ok: boolean; manifest: { required: Array<{ id: string }>; suggested: Array<{ id: string }>; deferred: Array<{ id: string }> } }>(
    "POST", "/wavex-os/onboarding/connector-manifest",
    { companyId: fx.companyId, skipInference: true },
  );
  expect(conn.status).toBe(200);

  const swarm = await inject<{ ok: boolean; manifest: { topology: { active_count: number } } }>(
    "POST", "/wavex-os/onboarding/swarm-manifest",
    { companyId: fx.companyId, skipInference: true },
  );
  expect(swarm.status).toBe(200);
  expect(swarm.body.manifest.topology.active_count).toBeGreaterThan(0);

  const wf = await inject<{ ok: boolean; manifest: { agent_workflows: Record<string, unknown> } }>(
    "POST", "/wavex-os/onboarding/workflow-manifest",
    { companyId: fx.companyId, skipInference: true, bypassBudgetCheck: true },
  );
  expect(wf.status).toBe(200);

  return {
    requiredIds: conn.body.manifest.required.map((e) => e.id),
    suggestedIds: conn.body.manifest.suggested.map((e) => e.id),
    deferredIds: conn.body.manifest.deferred.map((e) => e.id),
  };
}

async function walkConcierge(fx: Fixture): Promise<void> {
  // List
  const list = await inject<{ ok: boolean; connectors: Array<{ connectorId: string; bucket: string; expectedKeys: string[] }>; progress: { allRequiredAddressed: boolean } }>(
    "GET", `/wavex-os/onboarding/credentials/${encodeURIComponent(fx.companyId)}`,
  );
  expect(list.status).toBe(200);
  expect(list.body.connectors.length).toBeGreaterThan(0);

  // Vault a fake credential for any required connector that takes paste keys
  for (const c of list.body.connectors) {
    if (c.bucket !== "required" || c.expectedKeys.length === 0) continue;
    for (const k of c.expectedKeys) {
      const paste = await inject<{ ok: boolean }>("POST", "/wavex-os/onboarding/credentials/paste", {
        companyId: fx.companyId,
        connectorId: c.connectorId,
        key: k,
        plaintext: `test-${c.connectorId}-${k}-fake`,
      });
      expect(paste.status, `paste ${c.connectorId}.${k} for ${fx.companyId}`).toBe(200);
    }
  }

  // Skip any required connector still pending (e.g. composio-managed where we have no real OAuth in test)
  const list2 = await inject<{ connectors: Array<{ connectorId: string; bucket: string; status: string; composioManaged: boolean }> }>(
    "GET", `/wavex-os/onboarding/credentials/${encodeURIComponent(fx.companyId)}`,
  );
  for (const c of list2.body.connectors) {
    if (c.bucket !== "required") continue;
    if (c.status === "pending") {
      const skip = await inject<{ ok: boolean }>("POST", "/wavex-os/onboarding/credentials/skip", {
        companyId: fx.companyId,
        connectorId: c.connectorId,
        reason: "test e2e — no real credentials available",
      });
      expect(skip.status).toBe(200);
    }
  }

  const list3 = await inject<{ progress: { allRequiredAddressed: boolean } }>(
    "GET", `/wavex-os/onboarding/credentials/${encodeURIComponent(fx.companyId)}`,
  );
  expect(list3.body.progress.allRequiredAddressed).toBe(true);
}

async function walkFinalize(fx: Fixture): Promise<{ sha256: string }> {
  const fin = await inject<{ ok: boolean; sha256: string; manifest: { org_id: string; mc_winner?: { strategy_id: string } } }>(
    "POST", "/wavex-os/onboarding/finalize",
    { companyId: fx.companyId, orgId: fx.companyId, skipInference: true, mc: { horizon_cycles: 5, n_runs: 5, seed: 42 } },
  );
  expect(fin.status, `finalize ${fx.companyId}`).toBe(200);
  expect(fin.body.sha256).toMatch(/^(sha256:)?[0-9a-f]{64}$/);
  expect(fin.body.manifest.org_id).toBe(fx.companyId);

  // Filesystem contract
  const dir = join(tempDir, "instances", "default", "companies", fx.companyId, "onboarding");
  for (const f of [
    "pillar_responses.json", "connector_manifest.json", "swarm_manifest.json",
    "workflow_manifest.json", "company.manifest.json",
  ]) {
    expect(existsSync(join(dir, f)), `expected ${f} on disk for ${fx.companyId}`).toBe(true);
  }

  // Dashboard reads
  const m = await inject<{ ok: boolean; manifest: { org_id: string } }>(
    "GET", `/api/instance/${encodeURIComponent(fx.companyId)}/manifest`,
  );
  expect(m.status).toBe(200);
  expect(m.body.manifest.org_id).toBe(fx.companyId);

  const kpis = await inject<{ ok: boolean; kpis: Array<{ kpiId: string }> }>(
    "GET", `/api/instance/${encodeURIComponent(fx.companyId)}/kpis`,
  );
  expect(kpis.status).toBe(200);
  expect(kpis.body.kpis.length).toBeGreaterThan(0);

  return { sha256: fin.body.sha256 };
}

describe("e2e onboarding pipeline", () => {
  for (const fx of FIXTURES) {
    describe(fx.companyId, () => {
      it("walks pillars 1-5", async () => {
        await walkPillars(fx);
      });

      it("generates phase manifests with industry-appropriate connectors", async () => {
        const buckets = await walkPhases(fx);

        for (const id of fx.expect.requiredIncludes) {
          expect(buckets.requiredIds, `${fx.companyId}: required must include ${id}`).toContain(id);
        }
        for (const id of fx.expect.requiredExcludes ?? []) {
          expect(buckets.requiredIds, `${fx.companyId}: required must NOT include ${id}`).not.toContain(id);
        }
        for (const id of fx.expect.suggestedIncludes ?? []) {
          const all = [...buckets.requiredIds, ...buckets.suggestedIds];
          expect(all, `${fx.companyId}: ${id} should be required or suggested`).toContain(id);
        }
      });

      it("walks credential concierge (vault + skip)", async () => {
        await walkConcierge(fx);
      });

      it("finalizes with signed manifest + dashboard hydration", async () => {
        const { sha256 } = await walkFinalize(fx);
        expect(sha256).toMatch(/^(sha256:)?[0-9a-f]{64}$/);
      });
    });
  }
});
