/** A URL the prefetch could not read must SAY SO.
 *
 *  fetchUrlContent used to collapse every non-ok outcome — unreachable,
 *  parked, thin, timeout, unsafe_url — into a bare `null`, identical to the
 *  value returned when the operator typed prose and there was no URL at all.
 *  The status was discarded at that line and reached nothing downstream; the
 *  UI has no copy for any of those states.
 *
 *  So an operator pasted their homepage, waited for a real enrichment call,
 *  and got an organization built entirely from whatever else they had typed —
 *  never told the site was not read. The content contract is unchanged (a
 *  non-ok page still degrades to the no-homepage prompt path, which is
 *  correct); what is new is that the outcome survives onto the envelope.
 *
 *  Two-sided: reporting unconditionally would be as wrong as reporting
 *  nothing, because "no URL was given" and "the URL failed" are different
 *  facts and only one of them is worth telling the operator about. */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Fastify from "fastify";
import { registerWavexOsRoutes } from "../src/index.js";

let tempDir: string;

const MANUAL_CONTEXT =
  "Fixture company for url_fetch reporting: B2B software sold to operations teams, monthly subscription.";

beforeEach(() => {
  tempDir = mkdtempSync(join(tmpdir(), "wavex-os-url-report-"));
  process.env.WAVEX_OS_STATE_DIR = tempDir;
  process.env.PAPERCLIP_DATA_DIR = tempDir;
  process.env.WAVEX_AUTH_MODE = "dev";
  process.env.WAVEX_COMPOSIO_DISABLED = "1";
});

afterEach(() => {
  delete process.env.WAVEX_OS_STATE_DIR;
  delete process.env.PAPERCLIP_DATA_DIR;
  delete process.env.WAVEX_AUTH_MODE;
  delete process.env.WAVEX_COMPOSIO_DISABLED;
  rmSync(tempDir, { recursive: true, force: true });
});

async function pillar1(body: Record<string, unknown>): Promise<Record<string, unknown>> {
  const app = Fastify({ logger: false });
  registerWavexOsRoutes(app);
  await app.ready();
  try {
    const r = await app.inject({
      method: "POST",
      url: "/wavex-os/onboarding/pillar/1",
      payload: body,
    });
    expect(r.statusCode, r.body).toBe(200);
    return r.json() as Record<string, unknown>;
  } finally {
    await app.close();
  }
}

describe("pillar/1 reports what the URL prefetch actually did", () => {
  it("an unreachable homepage is REPORTED, not silently dropped", async () => {
    // .example is reserved and never resolves, so this is deterministic and
    // costs no network round trip worth waiting for.
    const j = await pillar1({
      companyId: "url-report-dead",
      org_name: "Dead Co",
      raw_input: "https://url-report-dead.example",
      manual_context: MANUAL_CONTEXT,
    });

    const report = j.url_fetch as { url: string; status: string; reason: string | null } | undefined;
    expect(report, "url_fetch missing — the operator is not told the site was unread").toBeDefined();
    expect(report!.status).toBe("unreachable");
    expect(report!.url).toContain("url-report-dead.example");
    // The reason is free text from the fetcher; it must at least be present,
    // because "unreachable with no reason" is the shrug this replaced.
    expect(report!.reason).toBeTruthy();

    // The content contract is unchanged: onboarding still proceeds.
    expect(j.ok).toBe(true);
    expect(j.response).toBeDefined();
  }, 60_000);

  it("prose input reports NOTHING — there was no URL to fail", async () => {
    const j = await pillar1({
      companyId: "url-report-prose",
      org_name: "Prose Co",
      raw_input: "we sell B2B software to operations teams",
      manual_context: MANUAL_CONTEXT,
    });

    expect(j.url_fetch, "reported a URL outcome when no URL was given").toBeUndefined();
    expect(j.ok).toBe(true);
  }, 60_000);
});
