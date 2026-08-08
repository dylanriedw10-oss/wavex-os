/** Token accounting for T2 calls.
 *
 *  The vendored wavex-os phase modules call tier-router internally and
 *  discard the cost data at the route boundary, so we cannot read tokens
 *  from the wavex-side response. Instead, the spawn shim
 *  (scripts/wavex-claude-spawn.sh) parses claude CLI's JSON output and
 *  appends one event per call to ~/.wavex-os/state/t2-events.jsonl.
 *
 *  `withTokenAccounting(companyId, phase, fn)` records the wall-clock
 *  window of the route handler, awaits it, then sweeps the events file for
 *  any events that fired within that window and attributes them to
 *  (companyId, phase) in the per-company token-usage.json aggregate.
 *
 *  Limitation: attribution is by time window, not request id. For the
 *  single-operator dev flow this is exact. For concurrent onboardings of
 *  different companies in the same node process, events that overlap two
 *  windows could get mis-attributed. Acceptable for V1; real fix is an
 *  AsyncLocalStorage tag passed through to the spawn (deferred). */

import { readFile, writeFile, mkdir, readdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import { homedir } from "node:os";
import { getOnboardingDir, getWavexDataRoot } from "../state-bridge.js";

export type PhaseKey =
  | "pillar_1" | "pillar_2" | "pillar_3" | "pillar_4" | "pillar_5"
  | "connector_manifest" | "swarm_manifest" | "workflow_manifest"
  | "finalize" | "recommend_agent" | "help_chat" | "board_chat"
  | "avatar_voice" | "avatar_intro" | "avatar_memory_distill"
  | "avatar_mail_triage" | "avatar_calendar_triage" | "avatar_slack_digest"
  | "canvas" | "task_exec" | "refinement" | "research";

interface T2Event {
  ts_iso: string;
  pid: number;
  started_ms: number;
  ended_ms: number;
  duration_ms: number;
  input_tokens: number;
  output_tokens: number;
  cached_input_tokens: number;
  cost_usd: number;
  exit_code: number;
}

interface PhaseAggregate {
  input_tokens: number;
  output_tokens: number;
  cached_input_tokens: number;
  cost_usd: number;
  duration_ms: number;
  calls: number;
  last_call_at?: string;
}

export interface TokenUsageFile {
  companyId: string;
  started_at: string;
  updated_at: string;
  total: PhaseAggregate;
  by_phase: Partial<Record<PhaseKey, PhaseAggregate>>;
  /** Last N call records, newest last. Capped to keep file size bounded. */
  recent_calls: Array<{
    phase: PhaseKey;
    ts_iso: string;
    input_tokens: number;
    output_tokens: number;
    cached_input_tokens: number;
    cost_usd: number;
    duration_ms: number;
  }>;
}

const RECENT_CALLS_CAP = 100;

function eventsFilePath(): string {
  const root = process.env.WAVEX_OS_STATE_DIR ?? join(homedir(), ".wavex-os");
  return join(root, "state", "t2-events.jsonl");
}

function tokenUsagePath(companyId: string): string {
  return join(getOnboardingDir(companyId), "token-usage.json");
}

function emptyAggregate(): PhaseAggregate {
  return {
    input_tokens: 0, output_tokens: 0, cached_input_tokens: 0,
    cost_usd: 0, duration_ms: 0, calls: 0,
  };
}

function emptyFile(companyId: string): TokenUsageFile {
  const now = new Date().toISOString();
  return {
    companyId,
    started_at: now,
    updated_at: now,
    total: emptyAggregate(),
    by_phase: {},
    recent_calls: [],
  };
}

/** Read events file once. Returns events whose started_ms falls in
 *  [fromMs, toMs]. We don't constrain ended_ms because the shim only
 *  appends after the claude process exits, so every event in the file
 *  is by definition complete — its real-world duration is already baked
 *  into duration_ms regardless of when readback happens. The 100ms slack
 *  on toMs handles cross-process clock skew between the shim's perl-time
 *  call and node's Date.now(). */
async function readEventsInWindow(fromMs: number, toMs: number): Promise<T2Event[]> {
  const path = eventsFilePath();
  let raw: string;
  try {
    raw = await readFile(path, "utf8");
  } catch {
    return []; // file may not exist yet
  }
  const events: T2Event[] = [];
  for (const line of raw.split("\n")) {
    if (!line.trim()) continue;
    try {
      const ev = JSON.parse(line) as T2Event;
      if (ev.started_ms >= fromMs && ev.started_ms <= toMs + 100) {
        events.push(ev);
      }
    } catch {
      // skip malformed lines
    }
  }
  return events;
}

export async function readTokenUsage(companyId: string): Promise<TokenUsageFile | null> {
  try {
    const raw = await readFile(tokenUsagePath(companyId), "utf8");
    return JSON.parse(raw) as TokenUsageFile;
  } catch {
    return null;
  }
}

async function writeTokenUsage(companyId: string, file: TokenUsageFile): Promise<void> {
  const path = tokenUsagePath(companyId);
  await mkdir(dirname(path), { recursive: true });
  const tmp = `${path}.tmp`;
  await writeFile(tmp, JSON.stringify(file, null, 2), "utf8");
  // Atomic rename to avoid partial reads.
  const { rename } = await import("node:fs/promises");
  await rename(tmp, path);
}

function mergeInto(agg: PhaseAggregate, ev: T2Event): void {
  agg.input_tokens += ev.input_tokens;
  agg.output_tokens += ev.output_tokens;
  agg.cached_input_tokens += ev.cached_input_tokens;
  agg.cost_usd += ev.cost_usd;
  agg.duration_ms += ev.duration_ms;
  agg.calls += 1;
  agg.last_call_at = ev.ts_iso;
}

/** Wraps a route handler. Sweeps the events file after the await for any
 *  T2 calls that completed during the handler's execution and attributes
 *  them to (companyId, phase). Also enforces the per-company token budget
 *  BEFORE running fn — throws BudgetExhaustedError when the cap has been
 *  reached, which routes translate to HTTP 429. Calls already in flight
 *  are not aborted. */
export async function withTokenAccounting<T>(
  companyId: string,
  phase: PhaseKey,
  fn: () => Promise<T>,
): Promise<T> {
  // Lazy import to avoid a cycle (token-budget imports readTokenUsage).
  const { assertWithinBudget } = await import("./token-budget.js");
  await assertWithinBudget(companyId);

  const startMs = Date.now();
  const result = await fn();
  const endMs = Date.now();

  const events = await readEventsInWindow(startMs, endMs);
  if (events.length === 0) return result;

  const file = (await readTokenUsage(companyId)) ?? emptyFile(companyId);
  for (const ev of events) {
    mergeInto(file.total, ev);
    const phaseAgg = (file.by_phase[phase] ??= emptyAggregate());
    mergeInto(phaseAgg, ev);
    file.recent_calls.push({
      phase,
      ts_iso: ev.ts_iso,
      input_tokens: ev.input_tokens,
      output_tokens: ev.output_tokens,
      cached_input_tokens: ev.cached_input_tokens,
      cost_usd: ev.cost_usd,
      duration_ms: ev.duration_ms,
    });
  }
  if (file.recent_calls.length > RECENT_CALLS_CAP) {
    file.recent_calls = file.recent_calls.slice(-RECENT_CALLS_CAP);
  }
  file.updated_at = new Date().toISOString();
  await writeTokenUsage(companyId, file);
  return result;
}

/** Reset the aggregate file when an operator resets a company. */
export async function clearTokenUsage(companyId: string): Promise<void> {
  try {
    const { unlink } = await import("node:fs/promises");
    await unlink(tokenUsagePath(companyId));
  } catch {
    // ignore — file may not exist
  }
}

/** Soft default ETAs in ms — used as a fallback when no history exists. */
const DEFAULT_ETAS_MS: Partial<Record<PhaseKey, number>> = {
  pillar_1: 60_000,
  pillar_2: 5_000,
  pillar_3: 5_000,
  pillar_4: 5_000,
  pillar_5: 5_000,
  connector_manifest: 45_000,
  swarm_manifest: 60_000,
  workflow_manifest: 75_000,
  finalize: 90_000,
  recommend_agent: 30_000,
  help_chat: 15_000,
  canvas: 15_000,
  task_exec: 120_000,
  refinement: 60_000,
  // The most expensive single call in onboarding: fullest context, deepest
  // reasoning, and the operator is watching an empty canvas while it runs.
  research: 120_000,
};

export interface PhaseEta {
  phase: PhaseKey;
  median_ms: number;
  p90_ms: number;
  samples: number;
  /** True when median_ms came from DEFAULT_ETAS_MS (no real history yet). */
  is_default: boolean;
}

function quantile(sorted: number[], q: number): number {
  if (sorted.length === 0) return 0;
  const idx = Math.min(sorted.length - 1, Math.floor(sorted.length * q));
  return sorted[idx];
}

/** Scan all per-company token-usage.json files and group durations by phase.
 *  Returns ETAs for all phases found in history, falling back to defaults
 *  for phases with zero samples. */
export async function getAllPhaseEtas(): Promise<Record<string, PhaseEta>> {
  const companiesDir = join(getWavexDataRoot(), "instances", "default", "companies");
  const byPhase: Map<string, number[]> = new Map();
  let companyIds: string[] = [];
  try {
    companyIds = await readdir(companiesDir);
  } catch {
    // No companies dir yet — return defaults
  }
  for (const id of companyIds) {
    const usage = await readTokenUsage(id);
    if (!usage) continue;
    for (const call of usage.recent_calls) {
      if (!byPhase.has(call.phase)) byPhase.set(call.phase, []);
      byPhase.get(call.phase)!.push(call.duration_ms);
    }
  }
  const result: Record<string, PhaseEta> = {};
  // Emit a row for every phase we have a default for, plus any extras seen
  const phases = new Set<string>([...Object.keys(DEFAULT_ETAS_MS), ...byPhase.keys()]);
  for (const phase of phases) {
    const samples = (byPhase.get(phase) ?? []).slice().sort((a, b) => a - b);
    if (samples.length > 0) {
      result[phase] = {
        phase: phase as PhaseKey,
        median_ms: quantile(samples, 0.5),
        p90_ms: quantile(samples, 0.9),
        samples: samples.length,
        is_default: false,
      };
    } else {
      const def = DEFAULT_ETAS_MS[phase as PhaseKey] ?? 60_000;
      result[phase] = {
        phase: phase as PhaseKey,
        median_ms: def,
        p90_ms: Math.round(def * 1.5),
        samples: 0,
        is_default: true,
      };
    }
  }
  return result;
}

export async function getPhaseEta(phase: PhaseKey): Promise<PhaseEta> {
  const all = await getAllPhaseEtas();
  return all[phase] ?? {
    phase, median_ms: 60_000, p90_ms: 90_000, samples: 0, is_default: true,
  };
}
