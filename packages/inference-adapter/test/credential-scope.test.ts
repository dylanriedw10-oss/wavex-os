/** The credential-scope warning.
 *
 *  A Free/Pro/Max credential may serve ordinary use by its own purchaser and
 *  nothing else — it may not route requests "on behalf of their users"
 *  (Anthropic, Legal and compliance; see docs/INFERENCE_COMPLIANCE.md).
 *
 *  Modes are resolved from env with a fallback, so which credential is about
 *  to answer is invisible unless something says it. These tests hold that
 *  announcement in place: hosted mode — where the operator's subscription
 *  answers other people's requests — must always name the problem. */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const ENV_KEYS = [
  "WAVEX_INFERENCE_MODE",
  "NODE_ENV",
  "WAVEX_INFERENCE_SCOPE_QUIET",
  "WAVEX_OS_CLAUDE_BIN",
  "WAVEX_INFERENCE_TRACK",
];
let saved: Record<string, string | undefined>;

beforeEach(() => {
  saved = Object.fromEntries(ENV_KEYS.map((k) => [k, process.env[k]]));
  for (const k of ENV_KEYS) delete process.env[k];
  vi.resetModules();
});

afterEach(() => {
  for (const [k, v] of Object.entries(saved)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  vi.restoreAllMocks();
});

/** Fresh module per call — the warning is once-per-process by design. */
async function applyWith(mode: string): Promise<string> {
  process.env.WAVEX_INFERENCE_MODE = mode;
  const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.resetModules();
  const { applyInferenceEnv } = await import("../src/config.js");
  applyInferenceEnv();
  return warn.mock.calls.map((c) => String(c[0])).join("\n");
}

describe("credential scope is announced, not assumed", () => {
  it("hosted mode names the prohibited pattern and the fix", async () => {
    const out = await applyWith("hosted");
    expect(out).toMatch(/hosted mode/);
    expect(out).toMatch(/on behalf of users/);
    expect(out).toMatch(/apikey/);
    expect(out).toMatch(/INFERENCE_COMPLIANCE/);
  });

  it("oauth mode says it is the local operator's own subscription", async () => {
    const out = await applyWith("oauth");
    expect(out).toMatch(/local operator's own Claude/);
    expect(out).toMatch(/INFERENCE_COMPLIANCE/);
  });

  it("apikey mode is the sanctioned path — nothing to warn about", async () => {
    expect(await applyWith("apikey")).toBe("");
  });

  it("warns once per process, so a hot path cannot spam the log", async () => {
    process.env.WAVEX_INFERENCE_MODE = "hosted";
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.resetModules();
    const { applyInferenceEnv } = await import("../src/config.js");
    applyInferenceEnv();
    applyInferenceEnv();
    applyInferenceEnv();
    expect(warn.mock.calls.length).toBe(1);
  });

  it("can be silenced deliberately, never by accident", async () => {
    process.env.WAVEX_INFERENCE_SCOPE_QUIET = "1";
    expect(await applyWith("hosted")).toBe("");
  });
});
