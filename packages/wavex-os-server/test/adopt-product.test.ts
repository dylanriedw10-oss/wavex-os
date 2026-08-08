/** Path B — adopt an existing product. Network stubbed; tier-router mocked
 *  so the enrichment returns a deterministic pillar payload. Covers the
 *  honesty ladder, the has_product override, and the capability→proposal
 *  bridge end to end through the canvas commit pipeline. */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Fastify, { type FastifyInstance } from "fastify";

vi.mock("@wavex-os/plugin-tier-router", () => ({
  route: vi.fn(async () => ({
    output: JSON.stringify({
      company_context: "Acme Robotics builds industrial robot arms for mid-size manufacturers, sold as an annual subscription with installation services.",
      industry_hint: "b2b_saas",
      business_model_hint: "subscription",
      ideal_customer_profile: "mid-size manufacturers",
      revenue_model: "annual subscription",
      competitive_position: "challenger",
      primary_acquisition_channel: "outbound_sales",
      product_maturity_signal: "ga",
      tone_signal: "technical",
      primary_friction_hypothesis: "long hardware procurement cycles",
      differentiator_hypothesis: "arms that install in a day",
      // Deliberately FALSE — the route must override it: adopting IS the
      // assertion that a product exists.
      has_product: false,
    }),
    total_cost_usd: 0,
    usage: { input_tokens: 0, output_tokens: 0 },
  })),
}));

const REAL_PAGE = `<html><head><meta name="description" content="Acme ships robots"></head><body>
  <h1>Acme Robotics</h1>
  <p>${"We build industrial robot arms for mid-size manufacturers. ".repeat(8)}</p>
</body></html>`;

function htmlResponse(body: string): Response {
  return new Response(body, { status: 200, headers: { "content-type": "text/html" } });
}

let tempDir: string;
let app: FastifyInstance;
const CO = "adopt-co";

function onboardingDir(): string {
  return join(tempDir, "instances/default/companies", CO, "onboarding");
}

beforeEach(async () => {
  tempDir = mkdtempSync(join(tmpdir(), "adopt-product-test-"));
  process.env.WAVEX_OS_STATE_DIR = tempDir;
  process.env.PAPERCLIP_DATA_DIR = tempDir;
  process.env.WAVEX_AUTH_MODE = "dev";
  process.env.WAVEX_COMPOSIO_DISABLED = "1";
  mkdirSync(onboardingDir(), { recursive: true });
  const { registerWavexOsRoutes } = await import("../src/index.js");
  app = Fastify({ logger: false });
  registerWavexOsRoutes(app);
  await app.ready();
});

afterEach(async () => {
  await app.close();
  vi.unstubAllGlobals();
  delete process.env.WAVEX_OS_STATE_DIR;
  delete process.env.PAPERCLIP_DATA_DIR;
  delete process.env.WAVEX_AUTH_MODE;
  delete process.env.WAVEX_COMPOSIO_DISABLED;
  rmSync(tempDir, { recursive: true, force: true });
});

describe("POST /api/instance/:companyId/adopt-product", () => {
  it("parked site → adopted:false + tell_me_more, pillar_1 untouched", async () => {
    vi.stubGlobal("fetch", vi.fn(async () =>
      htmlResponse(`<html><body><h1>buy this domain</h1><p>${"filler ".repeat(40)}</p></body></html>`)));
    const r = await app.inject({
      method: "POST", url: `/api/instance/${CO}/adopt-product`,
      payload: { url: "https://parked.example.com" },
    });
    expect(r.statusCode).toBe(200);
    const body = r.json();
    expect(body.adopted).toBe(false);
    expect(body.fetch.status).toBe("parked");
    expect(body.fallback).toBe("tell_me_more");
    // Nothing persisted — the operator was not silently onboarded.
    expect(() => readFileSync(join(onboardingDir(), "pillar_responses.json"))).toThrow();
  });

  it("real site → adopted:true, has_product FORCED true, pillar_1 persisted", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => htmlResponse(REAL_PAGE)));
    const r = await app.inject({
      method: "POST", url: `/api/instance/${CO}/adopt-product`,
      payload: { url: "acme-robotics.com" },
    });
    expect(r.statusCode).toBe(200);
    const body = r.json();
    expect(body.adopted).toBe(true);
    // The mock said has_product:false — adoption overrides it.
    expect(body.fields.has_product).toBe(true);
    expect(body.fields.org_name).toBe("acme-robotics");

    const persisted = JSON.parse(readFileSync(join(onboardingDir(), "pillar_responses.json"), "utf8"));
    expect(persisted.pillar_1.has_product).toBe(true);
    expect(persisted.pillar_1.industry_hint).toBe("b2b_saas");
  });

  it("the capability→proposal bridge: 'adopt <url>' mints, commit executes", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => htmlResponse(REAL_PAGE)));

    // 1. The canned utterance through the composer (stub path) mints the
    //    adopt-product proposal — T2 stays structurally barred.
    const compose = await app.inject({
      method: "POST", url: `/api/instance/${CO}/canvas`,
      payload: { message: "adopt my existing product at https://acme-robotics.com", skipInference: true },
    });
    expect(compose.statusCode).toBe(200);
    const proposal = compose.json().proposal;
    expect(proposal?.action).toBe("adopt-product");
    expect(proposal?.body?.url).toContain("acme-robotics.com");

    // 2. Commit runs the allowlisted route through the same pipeline.
    const commit = await app.inject({
      method: "POST", url: `/api/instance/${CO}/canvas/commit`,
      payload: { proposalId: proposal.id },
    });
    expect(commit.statusCode).toBe(200);

    const persisted = JSON.parse(readFileSync(join(onboardingDir(), "pillar_responses.json"), "utf8"));
    expect(persisted.pillar_1.has_product).toBe(true);
  });

  it("without a URL the stub clarifies instead of proposing", async () => {
    const compose = await app.inject({
      method: "POST", url: `/api/instance/${CO}/canvas`,
      payload: { message: "I want to adopt my existing product", skipInference: true },
    });
    expect(compose.statusCode).toBe(200);
    const body = compose.json();
    expect(body.proposal).toBeUndefined();
    expect(body.turn.text).toMatch(/paste your product/i);
  });
});
