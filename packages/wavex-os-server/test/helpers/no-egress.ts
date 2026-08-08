/** Network-level guard: prove a test made no unexpected outbound request.
 *
 *  Why this exists — and why the process guard is not enough
 *  ────────────────────────────────────────────────────────
 *  `./no-inference.ts` patches Node's child-process chokepoint and proves a
 *  deterministic route spawned no model CLI. That covers exactly one boundary.
 *  This package crosses another one constantly: `fetch`. Two independently
 *  verified facts make that boundary the more dangerous of the pair.
 *
 *  1. The suite really does call fixed, non-test-owned local ports today.
 *     Instrumenting `globalThis.fetch` across the 44-file suite recorded 187
 *     outbound calls. 165 go to ephemeral ports a test bound itself — fine,
 *     those are test doubles. The other 22 do not:
 *
 *       17 × POST 127.0.0.1:3102 /api/plugins/…/data/budget-state
 *            (vendor/wavex-os/tier-router/src/budget-client.ts:57)
 *        4 × GET  127.0.0.1:{3100,3000} /api/health
 *            (src/lib/paperclip-detect.ts:25)
 *        1 × POST 127.0.0.1:11434 /api/generate
 *            (vendor/wavex-os/tier-router/src/runtimes/t1-ollama.ts:26)
 *
 *     That last one is a live T1 model call. It leaves no trace at the process
 *     boundary, so no-inference.ts cannot see it. "No inference" was only ever
 *     true of T2.
 *
 *  2. The suite ARMS ITSELF against whatever is running on the machine.
 *     `detectAndConfigurePaperclip()` pings 3100 then 3000 and, on a
 *     Paperclip-shaped reply, WRITES `process.env.PAPERCLIP_HANDOFF_URL`.
 *     Downstream, that env var is the only thing standing between the handoff
 *     bridge and `POST /api/companies`, `/api/agent-hires`, and
 *     `/api/approvals/<id>/approve`. So a developer who happens to have
 *     Paperclip up does not merely get different test output — they get real
 *     companies, real hires and real approvals in their live instance, from a
 *     `pnpm test`. Nothing in the suite asserts this cannot happen.
 *
 *  What this does
 *  ──────────────
 *  Wraps `globalThis.fetch`. Every call is classified against an explicit
 *  allowlist of origins the test has declared it owns:
 *
 *    - allowed   → passes through untouched, so a test's own mock server
 *                  behaves exactly as it does without the guard;
 *    - anything else → recorded as an egress attempt, then failed with an
 *                  ECONNREFUSED-shaped `TypeError("fetch failed")`.
 *
 *  Fail-closed: the allowlist is empty until a test adds to it. A guard that
 *  has to recognise every way to reach a control plane is a guard with holes,
 *  so it recognises none of them and demands they be named.
 *
 *  Machine independence
 *  ────────────────────
 *  Two distinct properties, both deliberate:
 *
 *    - The VERDICT is recorded before any socket is opened, so it never
 *      depends on whether anything answered. A guard that inferred egress
 *      from a connection error would report "clean" on precisely the machine
 *      where the call succeeded — the bug wearing a different hat.
 *    - The BEHAVIOUR of the code under test is also pinned: a blocked call
 *      always fails the same way, whether or not Paperclip or Ollama is
 *      listening. Today `approve-organization.test.ts` passes because nothing
 *      Paperclip-shaped answers on port 3000; that is luck, not a test.
 *
 *  The refusal is shaped like a real connect failure (`TypeError: fetch
 *  failed` with an `ECONNREFUSED` cause) because that is the state callers
 *  already handle — `pingPaperclip` catches it, `handoffToPaperclip` records
 *  a per-slot error. Inventing a novel failure would exercise a branch that
 *  never runs in production.
 *
 *  Pairing
 *  ───────
 *  install/uninstall must be paired: the patch lands on `globalThis`, which
 *  vitest shares across every test in a worker, so a file that installs and
 *  never restores can reach a sibling suite that never opted in.
 */

import { expect } from "vitest";

export interface EgressAttempt {
  /** Scheme + host + port. Never carries a credential. */
  origin: string;
  /** Pathname with credential-bearing segments masked. Never the query. */
  path: string;
  method: string;
}

/** Origins a test has declared it owns. Empty until `allowOrigin` is called. */
const allowed = new Set<string>();
const egressAttempts: EgressAttempt[] = [];

type FetchFn = typeof globalThis.fetch;
let realFetch: FetchFn | undefined;

/** Telegram bot tokens ride in the URL PATH, not a header
 *  (`/bot<token>/sendMessage` — src/routes/partner-events.ts:106). Anything
 *  long or opaque in a path segment is therefore masked by default: this
 *  string ends up in assertion output and CI logs. */
function maskSegment(seg: string): string {
  if (/^bot\d+:/i.test(seg) || /^bot[A-Za-z0-9_-]{15,}$/.test(seg)) return "bot<redacted>";
  if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(seg)) return "<uuid>";
  if (seg.length > 24) return `<redacted:${seg.length}>`;
  return seg;
}

function redactPath(pathname: string): string {
  return pathname.split("/").map(maskSegment).join("/");
}

/** Read the target off whatever overload of fetch() the caller used. */
function describe(input: Parameters<FetchFn>[0], init?: Parameters<FetchFn>[1]): EgressAttempt {
  let raw = "";
  try {
    raw =
      typeof input === "string"
        ? input
        : input instanceof URL
          ? input.toString()
          : String((input as Request).url ?? "");
  } catch {
    raw = "";
  }

  let method = "GET";
  try {
    method = String(
      init?.method ??
        (typeof input === "object" && input !== null && "method" in input
          ? (input as Request).method
          : "GET"),
    );
  } catch {
    /* keep GET */
  }

  try {
    const u = new URL(raw);
    return { origin: u.origin, path: redactPath(u.pathname), method };
  } catch {
    // An unparseable target is still an attempt. Never echo the raw string:
    // it is attacker- or operator-controlled and may not be a URL at all.
    return { origin: "<unparseable>", path: "<unparseable>", method };
  }
}

function refused(origin: string): TypeError {
  const cause = Object.assign(new Error(`connect ECONNREFUSED ${origin}`), {
    code: "ECONNREFUSED",
    errno: -61,
    syscall: "connect",
  });
  return new TypeError("fetch failed", { cause });
}

/** Declare an origin this test owns — typically the ephemeral mock server it
 *  just bound. Accepts a full URL or a bare origin; only the origin is kept.
 *
 *  Every entry needs a justification, and there is exactly one that holds:
 *  "this process is the thing listening on that port". An allowlist entry for
 *  a fixed port you did not bind is an allowlist entry for whatever the
 *  developer happens to be running. */
export function allowOrigin(url: string): void {
  try {
    allowed.add(new URL(url).origin);
  } catch {
    throw new Error(`[no-egress guard] allowOrigin needs an absolute URL, got: ${url}`);
  }
}

/** Patch the chokepoint. Idempotent. Call before the server under test boots.
 *
 *  `globalThis.fetch` is the complete chokepoint for this package: nothing in
 *  src/ imports node:http/node:https directly, and nothing destructures
 *  `fetch` into a module-local binding, so every call resolves the global at
 *  call time. That includes the vendored tier-router, which is why the T1
 *  Ollama call is caught here despite living outside this package. */
export function installNoEgressGuard(): void {
  if (realFetch) return;
  const original = globalThis.fetch;
  realFetch = original;

  globalThis.fetch = async function guardedFetch(
    input: Parameters<FetchFn>[0],
    init?: Parameters<FetchFn>[1],
  ): Promise<Response> {
    const attempt = describe(input, init);
    if (allowed.has(attempt.origin)) return original(input, init);
    // Record BEFORE failing, so the verdict does not depend on the outcome.
    egressAttempts.push(attempt);
    throw refused(attempt.origin);
  } as FetchFn;
}

/** Restore the real fetch. Safe to call when not installed. */
export function uninstallNoEgressGuard(): void {
  if (!realFetch) return;
  globalThis.fetch = realFetch;
  realFetch = undefined;
  resetEgressLog();
  allowed.clear();
}

export function resetEgressLog(): void {
  egressAttempts.length = 0;
}

/** Outbound requests blocked since the last reset. */
export function getEgressAttempts(): readonly EgressAttempt[] {
  return egressAttempts;
}

/** Origins currently allowlisted. Lets a test assert its own wiring rather
 *  than trust it — an allowlist typo otherwise reads as a clean run. */
export function getAllowedOrigins(): readonly string[] {
  return [...allowed];
}

/** Throw, with the offending targets, if any unexpected egress was attempted.
 *
 *  Fails on the FIRST assertion after the offending call rather than at the
 *  suite's 30 s ceiling — a route that quietly phones a control plane should
 *  be legible immediately, not inferred from a stopwatch. */
export function assertNoEgress(context: string): void {
  if (egressAttempts.length === 0) return;
  const detail = egressAttempts.map((a) => `    ${a.method} ${a.origin}${a.path}`).join("\n");
  const n = egressAttempts.length;
  throw new Error(
    `[no-egress guard] ${context}\n` +
      `  This path is supposed to be self-contained, but ${n} outbound ` +
      `request${n === 1 ? "" : "s"} ${n === 1 ? "was" : "were"} attempted:\n` +
      `${detail}\n` +
      `  The guard refused ${n === 1 ? "it" : "them"}, so nothing left this process — but on a\n` +
      `  machine running Paperclip or Ollama on those ports this is real traffic to a\n` +
      `  live control plane, and /api/agent-hires and /api/approvals/<id>/approve are\n` +
      `  side-effectful. Either allowlist the origin with allowOrigin() because THIS\n` +
      `  test bound it, or stop the call.`,
  );
}

/** Test-only escape hatch for the guard's own suite: hand back the real fetch
 *  so a case can prove the guard passes an allowlisted call through unchanged
 *  rather than fabricating a response. */
export function _realFetchForTests(): FetchFn | undefined {
  return realFetch;
}
