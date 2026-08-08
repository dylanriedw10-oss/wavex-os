/** The wavex-layer overlays on the vendored swarm generation — extracted
 *  from routes/phases.ts so the plan-assembly route runs THE SAME pipeline
 *  (kernel-slot injection, scope filter, full-org unpark, re-persist) and
 *  produces the same on-disk swarm_manifest.{json,yaml} the rest of the
 *  product consumes. Plan assembly is phase-3 generation with an event log,
 *  not a parallel world — this file is what makes that literally true. */

import { readFile, mkdir, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import yaml from "js-yaml";
import {
  generateSwarmManifest,
  loadPillarResponses,
  type WorkflowManifest,
} from "@wavex-os/plugin-onboarding";
import { getOnboardingDir } from "../state-bridge.js";
import { injectKernelSlots } from "../bridge/kernel-slots.js";

/** Re-persist the swarm manifest after mutation. The vendored generator
 *  writes the file internally; this overrides with the kernel-injected
 *  version so subsequent disk reads (loadSwarmManifest, finalize-bridge)
 *  see the canonical shape. */
export async function persistSwarmManifest(companyId: string, swarm: unknown): Promise<void> {
  const dir = getOnboardingDir(companyId);
  await writeFile(join(dir, "swarm_manifest.json"), JSON.stringify(swarm, null, 2), "utf8");
  await writeFile(join(dir, "swarm_manifest.yaml"), yaml.dump(swarm), "utf8");
}

/** Sub-fleet scope record. When the operator chooses a focused team (e.g.
 *  marketing + sales only), we persist their selected departments and the
 *  swarm overlay parks every chief + L·IV sub-agent that lives outside that
 *  set. CEO + CoS always remain active. */
export interface ScopeRecord {
  /** Canonical departments to keep active. */
  departments: string[];
  /** Free-text divisions the operator entered (used for the parked-reason
   *  message). */
  custom_labels?: string[];
  mode: "full" | "focused";
  set_at: string;
}

export async function readScope(companyId: string): Promise<ScopeRecord | null> {
  const path = join(getOnboardingDir(companyId), "scope.json");
  try {
    const raw = await readFile(path, "utf8");
    return JSON.parse(raw) as ScopeRecord;
  } catch {
    return null;
  }
}

export async function writeScope(companyId: string, scope: ScopeRecord): Promise<void> {
  const dir = getOnboardingDir(companyId);
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, "scope.json"), JSON.stringify(scope, null, 2), "utf8");
}

type SwarmAgents = Record<string, {
  department?: string;
  status?: string;
  unpark_condition?: string | null;
  reason?: string | null;
  reports_to?: string | null;
}>;

/** Apply scope filter to a swarm manifest in-place. Non-scoped chiefs +
 *  their reports become `parked` with an unpark_condition the operator
 *  can flip from Mission Control. CEO + chief-of-staff are sacrosanct.
 *
 *  Custom-only fallback: when scope.mode === "focused" with no canonical
 *  departments selected (operator only typed custom labels like "Legal"
 *  or "HR"), we map the request to Operations — so they get COO + ops
 *  sub-agents active rather than a hollow CEO-only fleet. The custom
 *  labels stay persisted for future template provisioning. */
export function applyScopeFilter(
  swarm: { agents: SwarmAgents },
  scope: ScopeRecord,
): { parked: number; mappedCustomToOps: boolean } {
  if (scope.mode === "full") return { parked: 0, mappedCustomToOps: false };

  const customOnly = scope.departments.length === 0 && (scope.custom_labels?.length ?? 0) > 0;
  const effectiveDepartments = customOnly ? ["ops"] : scope.departments;
  const allowed = new Set([...effectiveDepartments, "ceo"]); // CEO always

  const reasonSuffix = customOnly
    ? `custom-only scope mapped to Operations (custom labels: ${scope.custom_labels?.join(", ") ?? ""})`
    : `outside requested scope (${effectiveDepartments.join(", ") || "focused team"})`;

  let parked = 0;
  for (const [slot, a] of Object.entries(swarm.agents)) {
    if (slot === "ceo.orchestrator" || slot === "ceo.chief-of-staff") continue;
    if (a.department && !allowed.has(a.department)) {
      if (a.status === "active" || a.status === "standby") {
        a.status = "parked";
        a.unpark_condition = "operator_unpark_from_mission_control";
        a.reason = reasonSuffix;
        parked += 1;
      }
    }
  }
  return { parked, mappedCustomToOps: customOnly };
}

/** Load workflow_manifest.json if it exists AND was written within
 *  freshnessMs ago. Used by finalize to consume a prefetched T2 workflow
 *  instead of regenerating deterministically. */
export async function loadFreshWorkflowManifest(companyId: string, freshnessMs: number): Promise<WorkflowManifest | null> {
  const path = join(getOnboardingDir(companyId), "workflow_manifest.json");
  try {
    const s = await stat(path);
    if (Date.now() - s.mtimeMs > freshnessMs) return null;
    const raw = await readFile(path, "utf8");
    return JSON.parse(raw) as WorkflowManifest;
  } catch {
    return null;
  }
}

export interface SwarmWithOverlaysResult {
  manifest: Awaited<ReturnType<typeof generateSwarmManifest>>["manifest"];
  source: string;
  warnings: string[];
}

/** The full swarm pipeline as one call: vendored generation → kernel slots →
 *  department parking → re-persist → warnings. Exactly the POST
 *  /swarm-manifest route body, shared with plan assembly. The caller owns
 *  token accounting (phase keys differ per surface).
 *
 *  A "full org" branch used to sit beside the parking one, promoting EVERY
 *  matrix-parked agent to active whenever the operator answered "the whole
 *  organization" — or answered nothing at all, since a missing record took
 *  the same path. That single override cancelled the entire activation
 *  verdict the pillar answers had just produced: the matrix parks an agent
 *  because the operator's own stage and motion say it has nothing to do yet,
 *  and unparking it makes the roster a number the operator picked rather
 *  than a consequence of what they said. It is gone. Parking is now purely
 *  subtractive, applied at Review where the departments are visible, and no
 *  answer anywhere can promote an agent the matrix parked. */
export async function generateSwarmWithOverlays(
  companyId: string,
  opts: { skipInference?: boolean; connectorManifest: Parameters<typeof generateSwarmManifest>[0]["connectorManifest"] },
): Promise<SwarmWithOverlaysResult> {
  const responses = await loadPillarResponses(companyId);
  const result = await generateSwarmManifest({
    companyId,
    responses,
    connectorManifest: opts.connectorManifest,
    skipInference: opts.skipInference,
  });
  // Inject kernel slots (Chief of Staff, etc.) so they appear in the org
  // chart AND get bridged to DB on activate.
  let mutated = injectKernelSlots(result.manifest);

  const scope = await readScope(companyId);
  let parked = 0;
  let mappedCustomToOps = false;
  if (scope && scope.mode === "focused") {
    ({ parked, mappedCustomToOps } = applyScopeFilter(
      result.manifest as unknown as Parameters<typeof applyScopeFilter>[0],
      scope,
    ));
    if (parked > 0) mutated = true;
  }
  // No record, or `mode: "full"`, means nothing was subtracted — the
  // matrix's own verdict stands untouched. There is no branch here.

  if (mutated) {
    await persistSwarmManifest(companyId, result.manifest);
  }
  const warnings = [...result.warnings];
  if (mappedCustomToOps) {
    warnings.push(`scope=focused with only custom labels [${scope?.custom_labels?.join(", ") ?? ""}] — mapped to Operations (COO + sub-agents active). ${parked} non-ops agents parked.`);
  } else if (parked > 0) {
    warnings.push(`parked ${parked} agents outside the departments kept at review [${scope?.departments.join(", ")}]`);
  }
  return { manifest: result.manifest, source: result.source, warnings };
}
