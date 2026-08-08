/** Tests for the no-inference guard itself.
 *
 *  A guard nobody has ever seen fire is not a guard — it is a comment with a
 *  function call in front of it. These cases pin BOTH sides:
 *    - it stays silent when nothing asks a model anything;
 *    - it fires, immediately and with the offending argv, when something does.
 *
 *  They also pin the two properties that make it worth having: it does not
 *  execute the real binary (so it costs nothing and behaves the same on a
 *  machine with an authenticated Claude Max CLI as on one with no CLI at
 *  all), and it distinguishes a capability probe from an actual prompt.
 */

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { spawn, execFile } from "node:child_process";
import {
  installNoInferenceGuard,
  uninstallNoInferenceGuard,
  resetInferenceLog,
  getInferenceAttempts,
  getProbeCalls,
  assertNoInference,
  STUB_CLAUDE_VERSION,
} from "./helpers/no-inference.js";

/** Run a child to completion, collecting stdout and exit code. */
function run(bin: string, args: string[]): Promise<{ code: number | null; stdout: string }> {
  return new Promise((resolve) => {
    const child = spawn(bin, args, { stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    child.stdout?.on("data", (d) => { stdout += String(d); });
    child.on("error", () => resolve({ code: -1, stdout }));
    child.on("close", (code) => resolve({ code, stdout }));
  });
}

describe("no-inference guard", () => {
  beforeEach(() => {
    installNoInferenceGuard();
    resetInferenceLog();
  });

  afterEach(() => {
    uninstallNoInferenceGuard();
  });

  it("stays silent when nothing spawns a model", () => {
    expect(getInferenceAttempts()).toHaveLength(0);
    expect(() => assertNoInference("quiet path")).not.toThrow();
  });

  it("stays silent for unrelated subprocesses, and lets them really run", async () => {
    const { code, stdout } = await run(process.execPath, ["-e", "process.stdout.write('untouched')"]);
    expect(code).toBe(0);
    expect(stdout).toBe("untouched");
    expect(getInferenceAttempts()).toHaveLength(0);
  });

  it("FIRES on a live `claude -p` prompt, without executing the real binary", async () => {
    const { code } = await run("claude", ["-p", "what is 2+2", "--output-format", "json"]);

    // Deterministic stub outcome, identical on every host.
    expect(code).toBe(1);

    const attempts = getInferenceAttempts();
    expect(attempts).toHaveLength(1);
    expect(attempts[0].bin).toBe("claude");
    expect(attempts[0].argv).toContain("-p");

    expect(() => assertNoInference("pillar walk")).toThrowError(/no-inference guard/);
    // The message must name what was spawned — a guard that fires without
    // saying why just relocates the mystery.
    expect(() => assertNoInference("pillar walk")).toThrowError(/live model invocation/);
  });

  it("redacts the prompt text out of the failure message", () => {
    const secret = "acme internal roadmap, do not log";
    return run("claude", ["-p", secret]).then(() => {
      let message = "";
      try { assertNoInference("redaction"); } catch (e) { message = (e as Error).message; }
      expect(message).not.toContain(secret);
      expect(message).toMatch(/<prompt:\d+ chars>/);
    });
  });

  it("treats a bare `claude` with no args as inference (fail-closed)", async () => {
    await run("claude", []);
    expect(getInferenceAttempts()).toHaveLength(1);
  });

  it("does NOT count `--version` as inference, and stubs it deterministically", async () => {
    const { code, stdout } = await run("claude", ["--version"]);
    expect(code).toBe(0);
    expect(stdout).toBe(STUB_CLAUDE_VERSION);
    expect(getInferenceAttempts()).toHaveLength(0);
    expect(getProbeCalls()).toHaveLength(1);
  });

  it("catches the configured WAVEX_OS_CLAUDE_BIN wrapper, not just bare `claude`", async () => {
    const prev = process.env.WAVEX_OS_CLAUDE_BIN;
    process.env.WAVEX_OS_CLAUDE_BIN = "/opt/wavex/scripts/wavex-claude-spawn.sh";
    try {
      await run("/opt/wavex/scripts/wavex-claude-spawn.sh", ["-p", "hello"]);
      expect(getInferenceAttempts()).toHaveLength(1);
    } finally {
      if (prev === undefined) delete process.env.WAVEX_OS_CLAUDE_BIN;
      else process.env.WAVEX_OS_CLAUDE_BIN = prev;
    }
  });

  it("catches inference launched via execFile, not only spawn", async () => {
    await new Promise<void>((resolve) => {
      execFile("claude", ["-p", "hi"], () => resolve());
    });
    expect(getInferenceAttempts()).toHaveLength(1);
  });

  it("restores the real spawn on uninstall", async () => {
    uninstallNoInferenceGuard();
    const { code, stdout } = await run(process.execPath, ["-e", "process.stdout.write('real')"]);
    expect(code).toBe(0);
    expect(stdout).toBe("real");
  });
});
