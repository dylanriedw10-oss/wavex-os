/** Resolves the bin path tier-router should spawn for T2 invocations and
 *  returns a TierRouterOptions-shaped config that callers can spread into
 *  the route() options. */
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { existsSync } from "node:fs";
import { getInferenceMode } from "./mode.js";

const here = dirname(fileURLToPath(import.meta.url));

/** Walk up from this file to the wavex-os repo root by locating the
 *  workspace marker (pnpm-workspace.yaml). */
function findRepoRoot(): string {
  let dir = here;
  for (let i = 0; i < 12; i++) {
    if (existsSync(resolve(dir, "pnpm-workspace.yaml"))) return dir;
    const parent = resolve(dir, "..");
    if (parent === dir) break;
    dir = parent;
  }
  throw new Error("inference-adapter: failed to locate wavex-os repo root from " + here);
}

let cachedRoot: string | undefined;
function repoRoot(): string {
  if (!cachedRoot) cachedRoot = findRepoRoot();
  return cachedRoot;
}

export function getClaudeBin(): string {
  const mode = getInferenceMode();
  if (mode === "oauth") {
    return resolve(repoRoot(), "scripts/wavex-claude-spawn.sh");
  }
  if (mode === "apikey") {
    return process.env.WAVEX_OS_CLAUDE_BIN ?? "claude";
  }
  // Hosted mode: tier-router's `claude -p` subprocess contract is satisfied
  // by a Node shim that proxies to the Mac mini's inference-server Pool A
  // endpoint via WAVEX_INFERENCE_HUB_URL. This is the path customers who
  // don't have their own Claude Max take — flat-rate inference via the
  // operator's subscription, no local credentials required.
  return resolve(repoRoot(), "scripts/wrappers/claude-hosted-shim.mjs");
}

export interface InferenceConfig {
  mode: ReturnType<typeof getInferenceMode>;
  claudeBin: string;
}

export function getInferenceConfig(): InferenceConfig {
  return {
    mode: getInferenceMode(),
    claudeBin: getClaudeBin(),
  };
}

/** Apply the inference config to process.env so any code-path that consults
 *  WAVEX_OS_CLAUDE_BIN (notably the vendored tier-router worker entry) picks
 *  up the right bin without explicit option-passing. Idempotent.
 *
 *  Also enables WAVEX_INFERENCE_TRACK by default so the wrapper writes
 *  start/heartbeat/complete events the UI can poll for real T2 progress.
 *  Disable explicitly with WAVEX_INFERENCE_TRACK=0. */
export function applyInferenceEnv(): InferenceConfig {
  const cfg = getInferenceConfig();
  process.env.WAVEX_OS_CLAUDE_BIN = cfg.claudeBin;
  if (process.env.WAVEX_INFERENCE_TRACK === undefined && cfg.mode === "oauth") {
    process.env.WAVEX_INFERENCE_TRACK = "1";
  }
  warnOnCredentialScope(cfg.mode);
  return cfg;
}

let scopeWarned = false;

/** Say out loud which credential is about to serve inference.
 *
 *  The mode is otherwise invisible: it resolves from an env var with a
 *  fallback, picks a bin, and nothing in the logs distinguishes "this
 *  operator's own subscription" from "a subscription answering other
 *  people's requests." Only the second one is a policy problem, and it is
 *  the one you cannot see. So print it once at boot.
 *
 *  The rule (Anthropic, Legal and compliance): a Free/Pro/Max credential
 *  serves ordinary use by its own purchaser. It may not be used to route
 *  requests "on behalf of their users." See docs/INFERENCE_COMPLIANCE.md. */
function warnOnCredentialScope(mode: InferenceConfig["mode"]): void {
  if (scopeWarned || process.env.WAVEX_INFERENCE_SCOPE_QUIET === "1") return;
  scopeWarned = true;

  if (mode === "hosted") {
    console.warn(
      "[inference] hosted mode: requests will be served by the operator's Claude\n" +
      "[inference] subscription via the inference hub. If any of those requests\n" +
      "[inference] originate from someone who is not that subscription's purchaser,\n" +
      "[inference] this is the pattern Anthropic prohibits — routing through Free/Pro/\n" +
      "[inference] Max credentials on behalf of users. Serve customers from an API key\n" +
      "[inference] (WAVEX_INFERENCE_MODE=apikey). See docs/INFERENCE_COMPLIANCE.md.",
    );
    return;
  }
  if (mode === "oauth") {
    console.warn(
      "[inference] oauth mode: inference runs on the local operator's own Claude\n" +
      "[inference] subscription. Correct for a single operator on their own machine.\n" +
      "[inference] Do not serve another party's requests from this process, and prefer\n" +
      "[inference] apikey mode for unattended or scheduled runs — subscription limits\n" +
      "[inference] describe ordinary individual use. See docs/INFERENCE_COMPLIANCE.md.",
    );
  }
}
