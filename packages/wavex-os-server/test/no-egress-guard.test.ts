/** Tests for the no-egress guard itself.
 *
 *  A guard nobody has ever seen fire is not a guard — it is a comment with a
 *  function call in front of it. These cases pin BOTH sides:
 *    - it stays silent when nothing reaches for the network;
 *    - it fires, immediately and with the offending target, when something does.
 *
 *  The case that matters most is "records a blocked call to a REACHABLE
 *  origin". The failure mode this guard exists to prevent is a check that
 *  passes on the machine where the thing it checks is broken — so the guard is
 *  pointed at a server that IS listening and must still refuse and record it.
 */

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import {
  installNoEgressGuard,
  uninstallNoEgressGuard,
  resetEgressLog,
  getEgressAttempts,
  getAllowedOrigins,
  allowOrigin,
  assertNoEgress,
} from "./helpers/no-egress.js";

/** A real listener on an ephemeral port, so "passed through" and "refused"
 *  are distinguishable by observation rather than by assumption. */
let server: Server;
let baseUrl: string;
let hits = 0;

beforeEach(async () => {
  hits = 0;
  server = createServer((_req, res) => {
    hits += 1;
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ ok: true }));
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const addr = server.address() as AddressInfo;
  baseUrl = `http://127.0.0.1:${addr.port}`;
  installNoEgressGuard();
  resetEgressLog();
});

afterEach(async () => {
  uninstallNoEgressGuard();
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

describe("no-egress guard", () => {
  it("stays silent when nothing reaches for the network", () => {
    expect(getEgressAttempts()).toHaveLength(0);
    expect(() => assertNoEgress("quiet path")).not.toThrow();
  });

  it("FIRES on an outbound request, and nothing leaves the process", async () => {
    await expect(fetch("https://api.telegram.org/x")).rejects.toThrow("fetch failed");

    const attempts = getEgressAttempts();
    expect(attempts).toHaveLength(1);
    expect(attempts[0]).toMatchObject({
      origin: "https://api.telegram.org",
      method: "GET",
    });
    expect(() => assertNoEgress("outbound path")).toThrow(/no-egress guard/);
    expect(() => assertNoEgress("outbound path")).toThrow(/api\.telegram\.org/);
  });

  it("records a blocked call to a REACHABLE origin — the verdict does not depend on whether anything answered", async () => {
    // baseUrl IS listening. Not allowlisted, so it must still be refused, and
    // the real server must never see the request. This is the whole point: a
    // guard that inferred egress from a connection error would call this run
    // clean on exactly the machine where the call went through.
    await expect(fetch(`${baseUrl}/api/agent-hires`, { method: "POST" })).rejects.toThrow(
      "fetch failed",
    );

    expect(hits).toBe(0); // the live server was never reached
    expect(getEgressAttempts()).toHaveLength(1);
    expect(getEgressAttempts()[0]).toMatchObject({
      origin: baseUrl,
      path: "/api/agent-hires",
      method: "POST",
    });
  });

  it("fails the same way whether or not a server is listening", async () => {
    const err1 = await fetch(`${baseUrl}/probe`).catch((e: unknown) => e);
    await new Promise<void>((resolve) => server.close(() => resolve()));
    const err2 = await fetch(`${baseUrl}/probe`).catch((e: unknown) => e);

    // Same constructor, same message, same cause code — up and down alike.
    expect((err1 as Error).constructor).toBe((err2 as Error).constructor);
    expect((err1 as Error).message).toBe((err2 as Error).message);
    expect(((err1 as Error).cause as { code: string }).code).toBe("ECONNREFUSED");
    expect(((err2 as Error).cause as { code: string }).code).toBe("ECONNREFUSED");

    // Re-listen so afterEach's close() has something to close.
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  });

  it("lets an allowlisted origin through, really — the test's own double still works", async () => {
    allowOrigin(baseUrl);
    expect(getAllowedOrigins()).toContain(baseUrl);

    const r = await fetch(`${baseUrl}/api/companies`);
    expect(r.status).toBe(200);
    expect(await r.json()).toEqual({ ok: true });
    expect(hits).toBe(1); // it reached the real listener
    expect(getEgressAttempts()).toHaveLength(0);
    expect(() => assertNoEgress("allowlisted path")).not.toThrow();
  });

  it("allowlists an ORIGIN, not a host — a different port on 127.0.0.1 is still blocked", async () => {
    allowOrigin(baseUrl);
    const otherPort = new URL(baseUrl).port === "3100" ? "3101" : "3100";
    await expect(fetch(`http://127.0.0.1:${otherPort}/api/health`)).rejects.toThrow("fetch failed");
    expect(getEgressAttempts()).toHaveLength(1);
    expect(getEgressAttempts()[0].origin).toBe(`http://127.0.0.1:${otherPort}`);
  });

  it("redacts a credential that rides in the path, so assertion output is safe to paste", async () => {
    const token = "123456789:AAHfaketokenfaketokenfaketoken1234";
    await fetch(`https://api.telegram.org/bot${token}/sendMessage`, { method: "POST" }).catch(
      () => null,
    );

    const [attempt] = getEgressAttempts();
    expect(attempt.path).toBe("/bot<redacted>/sendMessage");
    expect(attempt.path).not.toContain(token);
    expect(() => assertNoEgress("telegram")).toThrow(/bot<redacted>/);

    let message = "";
    try {
      assertNoEgress("telegram");
    } catch (e) {
      message = (e as Error).message;
    }
    expect(message).not.toContain(token);
    expect(message).not.toContain("AAHfaketoken");
  });

  it("counts a Request object and a URL object, not just a string", async () => {
    await fetch(new URL("https://example.test/a")).catch(() => null);
    await fetch(new Request("https://example.test/b", { method: "DELETE" })).catch(() => null);

    const attempts = getEgressAttempts();
    expect(attempts.map((a) => `${a.method} ${a.origin}${a.path}`)).toEqual([
      "GET https://example.test/a",
      "DELETE https://example.test/b",
    ]);
  });

  it("restores the real fetch on uninstall, so a sibling suite is untouched", async () => {
    const patched = globalThis.fetch;
    uninstallNoEgressGuard();
    expect(globalThis.fetch).not.toBe(patched);

    // Really unguarded again: the live server answers.
    const r = await fetch(`${baseUrl}/after-uninstall`);
    expect(r.status).toBe(200);
    expect(hits).toBe(1);

    installNoEgressGuard(); // afterEach expects to uninstall something
  });

  it("clears the allowlist on uninstall — no leakage into the next file", async () => {
    allowOrigin(baseUrl);
    uninstallNoEgressGuard();
    installNoEgressGuard();
    expect(getAllowedOrigins()).toEqual([]);
    await expect(fetch(`${baseUrl}/x`)).rejects.toThrow("fetch failed");
  });
});
