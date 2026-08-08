/** Process-level guard: prove a test stayed OFFLINE.
 *
 *  Why this exists
 *  ───────────────
 *  Suites that walk the onboarding pipeline pass `skipInference: true` and
 *  then *trust* it. Nothing asserted it. If a bypass silently stopped
 *  working, the only symptom was a slow, probabilistic vitest timeout on
 *  whichever machine happened to have a working `claude` CLI — and a green
 *  run everywhere else. A clock is not an assertion.
 *
 *  What this does
 *  ──────────────
 *  Every async child-process launch in Node — `spawn`, `execFile`, `exec`,
 *  `fork` — funnels through one internal method: `ChildProcess.prototype
 *  .spawn(options)`. We patch that single chokepoint. This is deliberately
 *  NOT `vi.mock("node:child_process")`: the T2 call we most need to catch is
 *  made inside the *vendored* tier-router (`vendor/wavex-os/tier-router/src/
 *  runtimes/t2-claude-code.ts`), which resolves its own ESM binding to
 *  `spawn`. Patching the prototype catches it regardless of how, or from
 *  which module graph, the caller imported `spawn`.
 *
 *  Machine independence
 *  ────────────────────
 *  The guard never lets a claude-ish binary actually execute, and it does
 *  not merely block it either — blocking would make every host look like
 *  "claude not installed", which is precisely the state that hides this
 *  class of bug. Instead it SUBSTITUTES a deterministic stub:
 *
 *    - capability probes (`--version` and friends) → succeed with a fixed
 *      version string, so the code under test proceeds down the same branch
 *      it would take on a fully-installed, authenticated operator machine;
 *    - anything else (i.e. an actual prompt) → recorded as an inference
 *      attempt, then failed deterministically.
 *
 *  So a host with no `claude` at all and a host with an authenticated Claude
 *  Max subscription execute the identical code path and reach the identical
 *  verdict — and neither spends a token.
 *
 *  Classification is FAIL-CLOSED: on a claude-ish binary, only an argv made
 *  up entirely of known-harmless probe flags is treated as "not inference".
 *  A bare `claude`, a prompt on stdin, or any unrecognised flag counts as an
 *  inference attempt. A guard that has to recognise every way to ask for a
 *  completion is a guard with holes.
 */

import { spawn } from "node:child_process";
import { basename } from "node:path";

export interface InferenceAttempt {
  /** Binary as the caller named it. */
  bin: string;
  /** Arguments, excluding argv0. */
  argv: string[];
}

/** Version string the stub reports for capability probes. Deliberately not a
 *  plausible real version — if this leaks into an assertion somewhere, the
 *  assertion should say so out loud rather than quietly pass. */
export const STUB_CLAUDE_VERSION = "0.0.0-no-inference-guard (stub)";

/** argv tokens that ask the CLI about itself rather than asking a model
 *  anything. Everything else on a claude-ish binary is inference. */
const PROBE_ONLY_ARGS = new Set(["--version", "-v", "--help", "-h", "doctor"]);

/** Shells that could be carrying a claude invocation in their arguments
 *  (`spawn(bin, args, { shell: true })` rewrites file to the shell). */
const SHELLS = new Set(["sh", "bash", "zsh", "cmd.exe", "cmd"]);

const PATCHED = Symbol.for("wavex.noInferenceGuard.originalSpawn");

const inferenceAttempts: InferenceAttempt[] = [];
const probeCalls: InferenceAttempt[] = [];

interface ProtoWithSpawn {
  spawn: (options: unknown) => unknown;
  [PATCHED]?: (options: unknown) => unknown;
}

let proto: ProtoWithSpawn | undefined;

function looksLikeClaudeBin(file: string): boolean {
  const b = basename(file).toLowerCase();
  if (b === "claude" || b === "claude.cmd" || b === "claude.exe") return true;
  if (b.startsWith("claude-") || b.startsWith("wavex-claude")) return true;
  const configured = process.env.WAVEX_OS_CLAUDE_BIN;
  if (configured && (file === configured || b === basename(configured).toLowerCase())) return true;
  return false;
}

/** True when this launch is a claude invocation, directly or via a shell. */
function targetsClaude(file: string, argv: string[]): boolean {
  if (looksLikeClaudeBin(file)) return true;
  if (SHELLS.has(basename(file).toLowerCase())) {
    return argv.some((a) => a.split(/[\s"']+/).some((tok) => tok && looksLikeClaudeBin(tok)));
  }
  return false;
}

/** Fail-closed: only an argv consisting *entirely* of self-describing flags
 *  is exempt. Empty argv (a bare interactive `claude`) is NOT exempt. */
function isProbeOnly(argv: string[]): boolean {
  return argv.length > 0 && argv.every((a) => PROBE_ONLY_ARGS.has(a));
}

/** Rewrite the launch to run a short node script instead of the real binary,
 *  keeping the caller's stdio/cwd wiring so streams and `close` events behave
 *  exactly as they would for a real child. */
function substitute(options: Record<string, unknown>, script: string): Record<string, unknown> {
  return {
    ...options,
    file: process.execPath,
    args: [process.execPath, "-e", script],
  };
}

const PROBE_SCRIPT = `process.stdout.write(${JSON.stringify(STUB_CLAUDE_VERSION)});`;
const INFERENCE_SCRIPT =
  `process.stderr.write("no-inference guard: refused to run a live model call");` +
  `process.exit(1);`;

/** Patch the chokepoint. Idempotent. Call before the server under test boots. */
export function installNoInferenceGuard(): void {
  if (proto) return;
  // Touch a real ChildProcess to reach the internal prototype. Nothing of
  // consequence runs: `node -e 0` with stdio ignored, killed immediately.
  const seed = spawn(process.execPath, ["-e", "0"], { stdio: "ignore" });
  seed.on("error", () => { /* nothing to do — we only wanted the prototype */ });
  const p = Object.getPrototypeOf(seed) as ProtoWithSpawn;
  seed.kill();

  if (p[PATCHED]) { proto = p; return; }
  const original = p.spawn;
  p[PATCHED] = original;

  p.spawn = function patchedSpawn(this: unknown, options: unknown) {
    const opts = (options ?? {}) as Record<string, unknown>;
    const file = typeof opts.file === "string" ? opts.file : "";
    const argv = Array.isArray(opts.args) ? (opts.args as string[]).slice(1) : [];

    if (targetsClaude(file, argv)) {
      const record: InferenceAttempt = { bin: file, argv };
      if (isProbeOnly(argv)) {
        probeCalls.push(record);
        return original.call(this, substitute(opts, PROBE_SCRIPT));
      }
      inferenceAttempts.push(record);
      return original.call(this, substitute(opts, INFERENCE_SCRIPT));
    }
    return original.call(this, options);
  };
  proto = p;
}

/** Restore the real spawn. Safe to call when not installed. */
export function uninstallNoInferenceGuard(): void {
  if (!proto) return;
  const original = proto[PATCHED];
  if (original) {
    proto.spawn = original;
    delete proto[PATCHED];
  }
  proto = undefined;
  resetInferenceLog();
}

export function resetInferenceLog(): void {
  inferenceAttempts.length = 0;
  probeCalls.length = 0;
}

/** Inference invocations attempted since the last reset. */
export function getInferenceAttempts(): readonly InferenceAttempt[] {
  return inferenceAttempts;
}

/** Capability probes (e.g. `claude --version`) seen since the last reset.
 *  These are not inference — no prompt, no tokens — but they are recorded so
 *  a test can tell "the guard was wired up and saw traffic" apart from "the
 *  guard was never reached at all". */
export function getProbeCalls(): readonly InferenceAttempt[] {
  return probeCalls;
}

/** Throw with the offending argv if any live model call was attempted.
 *
 *  Fails on the FIRST assertion after the offending call rather than at the
 *  suite's 30 s ceiling, and reports what was spawned — the whole point being
 *  that a broken bypass should be legible immediately, not inferred from a
 *  stopwatch. */
export function assertNoInference(context: string): void {
  if (inferenceAttempts.length === 0) return;
  const detail = inferenceAttempts
    .map((a) => {
      // Never echo the prompt back: it can carry operator content, and the
      // flag is what identifies the call anyway.
      const redacted = a.argv.map((v, i) =>
        a.argv[i - 1] === "-p" || a.argv[i - 1] === "--print"
          ? `<prompt:${v.length} chars>`
          : v,
      );
      return `    ${a.bin} ${redacted.join(" ")}`;
    })
    .join("\n");
  const n = inferenceAttempts.length;
  throw new Error(
    `[no-inference guard] ${context}\n` +
      `  This path is supposed to be deterministic and offline, but ${n} live ` +
      `model invocation${n === 1 ? "" : "s"} ${n === 1 ? "was" : "were"} attempted:\n` +
      `${detail}\n` +
      `  The guard substituted a stub, so no tokens were spent and no wall-clock\n` +
      `  budget was burned — but on a real machine this is live T2 inference.\n` +
      `  Either a skipInference bypass regressed, or a new inference call was\n` +
      `  added to a path documented as offline.`,
  );
}
