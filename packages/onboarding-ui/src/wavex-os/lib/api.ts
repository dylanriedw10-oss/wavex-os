/** Wavex-os onboarding API client. Wraps fetch to /wavex-os/* and
 *  /api/instance/* routes registered by @wavex-os/wavex-os-server.
 *
 *  Payload shapes match the vendored upstream contract verbatim
 *  (snake_case fields like org_name, company_context, etc.).
 *
 *  Production: swap fetch base URL via vite proxy override; function
 *  signatures stay identical. */

import type {
  CompanyManifest, ConnectorManifest, PillarResponses,
  Pillar1Response, Pillar2Outcome, Pillar3Response, Pillar4Response, Pillar5Response,
  SwarmManifest, WorkflowManifest, OnboardingHaltPayload,
  ProductState, GtmProfileEnum, CommChannel, UrgencyRouting, LeadSource, SalesMotion, CloseChannel,
} from "@wavex-os/plugin-onboarding";

const BASE = ""; // vite proxies /wavex-os and /api directly

export class ApiError extends Error {
  constructor(message: string, public status?: number, public halt?: OnboardingHaltPayload) {
    super(message);
    this.name = "ApiError";
  }
}

async function call<T>(method: string, path: string, body?: unknown, opts?: { timeoutMs?: number }): Promise<T> {
  const init: RequestInit = { method };
  if (body !== undefined) {
    init.headers = { "Content-Type": "application/json" };
    init.body = JSON.stringify(body);
  }
  // Opt-in timeout: without one, a hung connection leaves the caller's busy
  // state stuck forever (the canvas composer locks after one dead request).
  let timer: ReturnType<typeof setTimeout> | undefined;
  if (opts?.timeoutMs) {
    const ctrl = new AbortController();
    timer = setTimeout(() => ctrl.abort(), opts.timeoutMs);
    init.signal = ctrl.signal;
  }
  let resp: Response;
  try {
    resp = await fetch(`${BASE}${path}`, init);
  } catch (e) {
    if ((e as Error).name === "AbortError") {
      throw new ApiError(`No response after ${Math.round((opts!.timeoutMs!) / 1000)}s — the server may still be working; try again in a moment.`);
    }
    throw e;
  } finally {
    if (timer) clearTimeout(timer);
  }
  const json = await resp.json().catch(() => ({})) as Record<string, unknown>;
  if (!resp.ok || json.ok === false) {
    const halt = (json as { halt?: OnboardingHaltPayload }).halt;
    const message = halt?.operator_message
      ?? (json.error as string | undefined)
      ?? `HTTP ${resp.status}`;
    throw new ApiError(message, resp.status, halt);
  }
  return json as T;
}

/** Cached check of /api/inference-status. Pool-B-aware surfaces (today:
 *  Pillar 3 suggest) call this before deciding whether to route through
 *  the customer's cloud-client path or fall back to the operator's Pool A
 *  hub. Cached for 30 s so a burst of card mounts doesn't fan out into
 *  N status fetches. */
let poolBCache: { value: boolean; expiresAt: number } | null = null;
async function isPoolBReachable(): Promise<boolean> {
  const now = Date.now();
  if (poolBCache && now < poolBCache.expiresAt) return poolBCache.value;
  try {
    const r = await fetch("/api/inference-status");
    const j = (await r.json()) as { online?: boolean; mode?: string };
    const value = Boolean(j.online && j.mode === "pool_b");
    poolBCache = { value, expiresAt: now + 30_000 };
    return value;
  } catch {
    poolBCache = { value: false, expiresAt: now + 30_000 };
    return false;
  }
}

export interface StatusResponse {
  ok: boolean;
  companyId: string;
  responses: PillarResponses;
  complete: boolean;
  next_pillar: 1 | 2 | 3 | 4 | 5 | null;
}

export interface ProbeResponse {
  ok: boolean;
  probe?: {
    installed: boolean;
    authenticated: boolean;
    version?: string;
    test_output?: string;
    error?: string;
    /** Set by the hosted-mode probe to "wavex_pool_a" when the customer's
     *  inference is served by the operator's hub. The UI uses this to skip
     *  the Claude-plan picker on Pillar 2 (the customer has no local CLI). */
    billing_type?: string;
  };
  error?: string;
}

export interface InstanceManifestResponse {
  ok: boolean;
  manifest?: CompanyManifest;
  error?: string;
}

export interface InstanceKpisResponse {
  ok: boolean;
  companyId: string;
  kpis: Array<{
    kpiId: string;
    label: string;
    direction: "higher_is_better" | "lower_is_better";
    ownerRole?: string;
    currentValue?: number;
    targetMicros?: number;
    windowDays?: number;
  }>;
}

/** `state` is read off the filesystem by the server — how far this company
 *  actually got. `live` means it has an org spine and belongs on the canvas,
 *  NOT back at pillar 1. */
export type CompanyState = "live" | "finalized" | "draft" | "empty";
export interface CompaniesResponse {
  ok: boolean;
  companies: Array<{ id: string; name: string; state: CompanyState; updatedAt: string | null }>;
}

export const wavexOsOnboardingApi = {
  // Status
  status: (companyId: string) =>
    call<StatusResponse>("GET", `/wavex-os/onboarding/status?companyId=${encodeURIComponent(companyId)}`),

  // Pillars — upstream snake_case payload shapes
  pillar1: (input: {
    companyId: string;
    org_name: string;
    raw_input: string;
    manual_context?: string;
  }) => call<{ ok: true; response: Pillar1Response }>(
    "POST", "/wavex-os/onboarding/pillar/1", input,
  ),

  pillar1Edit: (input: {
    companyId: string;
    industry_hint?: string;
    business_model_hint?: string;
    has_product?: boolean;
  }) => call<{ ok: true; response: Pillar1Response }>(
    "POST", "/wavex-os/onboarding/pillar/1/edit", input,
  ),

  pillar2: (input: {
    companyId: string;
    claude_plan: "max_20x" | "max_5x" | "api_only" | "other";
    claude_plan_other_note?: string;
  }) => call<Pillar2Outcome>("POST", "/wavex-os/onboarding/pillar/2", input),

  pillar3: (input: {
    companyId: string;
    product_state: ProductState;
    product_state_other?: string;
    stage: string;
    stage_other?: string;
  }) => call<{ ok: true; response: Pillar3Response }>(
    "POST", "/wavex-os/onboarding/pillar/3", input,
  ),

  pillar4: (input: {
    companyId: string;
    lead_sources: LeadSource[];
    lead_source_other?: string;
    sales_motion: SalesMotion;
    sales_motion_other?: string;
    close_channel?: CloseChannel;
    close_channel_other?: string;
  }) => call<{ ok: true; response: Pillar4Response }>(
    "POST", "/wavex-os/onboarding/pillar/4", input,
  ),

  pillar5: (input: {
    companyId: string;
    comm_channel: CommChannel;
    comm_channel_other?: string;
    urgency_routing?: UrgencyRouting;
    urgency_routing_other?: string;
    board_endpoint_config?: Record<string, string>;
  }) => call<{ ok: true; response: Pillar5Response }>(
    "POST", "/wavex-os/onboarding/pillar/5", input,
  ),

  /** The operator's STATED goal — the loop's fixed half.
   *
   *  Not a pillar: the pillar schema is vendored and frozen, and this is a
   *  wavex-layer concern. The server rejects a KPI it cannot name rather
   *  than coercing it, so a 400 here means the id is wrong, not the value. */
  strategy: (input: {
    companyId: string;
    goal: { kpiId: string; current: number; target: number; days: number };
    secondaryKpis?: string[];
    bottleneck?: string | null;
    stated?: boolean;
  }) => call<{ ok: true; strategy: { goal: { kpiId: string; current: number; target: number; days: number }; bottleneck: string | null; stated: boolean } }>(
    "POST", "/wavex-os/onboarding/strategy", input,
  ),

  /** Inference-driven suggestion for the next pillar's field values, based
   *  on prior pillar context. The inline cards call this on mount so the
   *  customer sees pre-highlighted chips ("Suggested: assisted demo —
   *  matches your $50K MRR B2B SaaS signal") instead of a static form.
   *
   *  Supported for pillars 3, 4, 5. recommended is a partial object keyed
   *  by the pillar's fields; reasoning is a short why-this-pick string.
   *
   *  ALL pillars route through Pool B (Supabase Realtime → operator's Mac
   *  → Anthropic) when the customer has a valid device-token. Pillar 3
   *  was the canary in Subagent C's first pass; extending to 4 + 5 here
   *  closes the loop so a paying customer's onboarding wizard fires all
   *  five pillars through the same Realtime path their fleet will use.
   *
   *  The Pool B server-side route (`pillar-suggest-pool-b.ts`) already
   *  handles all pillar numbers — it dispatches the same prompt the
   *  Pool A route builds, just over Realtime instead of HTTP. Pool B
   *  falls back to Pool A on any failure — never blocks the wizard. */
  pillarSuggest: async (pillar: 3 | 4 | 5, companyId: string) => {
    const usePoolB = await isPoolBReachable();
    if (usePoolB) {
      try {
        return await call<{
          ok: boolean;
          pillar: number;
          recommended: Record<string, unknown>;
          reasoning: string | null;
          error?: string;
        }>("POST", `/wavex-os/onboarding/pillar/${pillar}/suggest-pool-b`, { companyId });
      } catch {
        // fall through to Pool A — Pool B is best-effort
      }
    }
    return call<{
      ok: boolean;
      pillar: number;
      recommended: Record<string, unknown>;
      reasoning: string | null;
      error?: string;
    }>("POST", `/wavex-os/onboarding/pillar/${pillar}/suggest`, { companyId });
  },

  /** One-shot phase-transition narration grounded in pillar context. The
   *  shell calls this between phases (e.g., "Got the picture" → "let me
   *  figure out the connectors you need") so the chat doesn't feel like a
   *  paper form. Falls back to hardcoded copy on failure. */
  narrate: (input: { companyId: string; from: string; to: string }) =>
    call<{ ok: boolean; sentence?: string; error?: string }>(
      "POST", "/wavex-os/onboarding/narrate", input,
    ),

  pillar5TestSend: (input: {
    companyId: string;
    channel: "telegram" | "slack" | "sms" | "email_only";
    config: Record<string, string>;
  }) => call<{ ok: boolean; detail: string }>(
    "POST", "/wavex-os/onboarding/pillar/5/test-send", input,
  ),

  // Credential Concierge
  listCredentials: (companyId: string) =>
    call<{
      ok: true;
      companyId: string;
      connectors: Array<{
        connectorId: string;
        bucket: "required" | "suggested" | "deferred";
        priority: string;
        rationale: string;
        status: "vaulted_valid" | "vaulted_unvalidated" | "skipped" | "pending";
        vaultedKeys: string[];
        expectedKeys: string[];
        hasProbe: boolean;
        lastTestedAt: string | null;
        lastTestResult: { ok: boolean; detail?: string } | null;
        skipReason: string | null;
        composioManaged: boolean;
        keysUrl: string | null;
        /** True when the customer already has an MCP server installed for this
         *  connector (detected from Claude Desktop / Claude Code / Cursor).
         *  The UI renders these as "✓ Connected via your existing MCP" — no
         *  paste form. Detection is read-only; we never extract MCP secrets. */
        mcpManaged: boolean;
        /** Label of the MCP source ("Claude Desktop", "Claude Code", "Cursor")
         *  shown when mcpManaged is true. Null otherwise. */
        mcpSourcedFrom: string | null;
        /** True when an official MCP server exists for this connector
         *  whether or not the customer has installed it. UI uses this to
         *  surface "Install MCP" as a third option below OAuth/paste. */
        mcpAvailable: boolean;
        /** One-liner + docs link for installing the MCP. Null if no
         *  documented install path exists for this connector. */
        mcpInstallHint: { docs: string; install_hint: string } | null;
      }>;
      progress: { requiredCount: number; requiredReady: number; allRequiredAddressed: boolean };
    }>("GET", `/wavex-os/onboarding/credentials/${encodeURIComponent(companyId)}`),

  pasteCredential: (input: {
    companyId: string; connectorId: string; key: string; plaintext: string;
  }) => call<{ ok: true; vaultedAt: string }>(
    "POST", "/wavex-os/onboarding/credentials/paste", input,
  ),

  testCredential: (input: { companyId: string; connectorId: string }) =>
    call<{ ok: boolean; detail: string }>(
      "POST", "/wavex-os/onboarding/credentials/test", input,
    ),

  skipCredential: (input: { companyId: string; connectorId: string; reason: string }) =>
    call<{ ok: true }>(
      "POST", "/wavex-os/onboarding/credentials/skip", input,
    ),

  /** Mint a Composio-hosted OAuth URL for `toolkitSlug`. In hosted-inference
   *  mode the customer's mock-core proxies this to the operator's hub, which
   *  uses the operator's COMPOSIO_API_KEY — the customer never holds it.
   *  The wizard opens `url` in a popup; `pendingConnectionId` becomes the
   *  watch-key for /connectors/list polling. */
  initiateConnectorOAuth: (input: {
    companyId: string;
    userId?: string;
    avatarId?: string;
    toolkitSlug: string;
  }) =>
    call<{ url: string | null; pendingConnectionId: string | null; needsLiveWiring?: boolean }>(
      "POST",
      "/wavex-os/onboarding/connectors/oauth/initiate",
      input,
    ),

  /** Hub-tracked connections for the current installId+email (hosted mode).
   *  Wizard polls this every ~2s after opening the OAuth popup to detect
   *  when the toolkit flips to `active`. Returns [] in non-hosted mode. */
  listHostedConnections: (email?: string) =>
    call<{
      connections: Array<{
        id: string | null;
        toolkit_slug: string | undefined;
        display_name: string | null;
        status: string;
        connected_at: string | null;
      }>;
    }>(
      "GET",
      `/wavex-os/onboarding/connectors/list${email ? `?email=${encodeURIComponent(email)}` : ""}`,
    ),

  // Probes
  claudeCodeCheck: () => call<ProbeResponse>("GET", "/wavex-os/onboarding/claude-code-check"),

  // Phases
  generateConnector: (companyId: string, skipInference = false) =>
    call<{ ok: true; manifest: ConnectorManifest; source: "t2" | "fallback"; warnings: string[] }>(
      "POST", "/wavex-os/onboarding/connector-manifest", { companyId, skipInference }),

  generateSwarm: (companyId: string, skipInference = false) =>
    call<{ ok: true; manifest: SwarmManifest; source: "t2" | "fallback"; warnings: string[] }>(
      "POST", "/wavex-os/onboarding/swarm-manifest", { companyId, skipInference }),

  generateWorkflow: (companyId: string, opts: { skipInference?: boolean; bypassBudgetCheck?: boolean } = {}) =>
    call<{ ok: true; manifest: WorkflowManifest; source: "t2" | "fallback"; warnings: string[] }>(
      "POST", "/wavex-os/onboarding/workflow-manifest", { companyId, ...opts }),

  // Load existing phase manifests from disk — no T2 cost. Returns
  // { exists: false, manifest: null } if the phase hasn't been generated yet.
  loadConnector: (companyId: string) =>
    call<{ ok: true; exists: boolean; manifest: ConnectorManifest | null; source?: "loaded" }>(
      "GET", `/wavex-os/onboarding/connector-manifest?companyId=${encodeURIComponent(companyId)}`),

  loadSwarm: (companyId: string) =>
    call<{ ok: true; exists: boolean; manifest: SwarmManifest | null; source?: "loaded" }>(
      "GET", `/wavex-os/onboarding/swarm-manifest?companyId=${encodeURIComponent(companyId)}`),

  loadWorkflow: (companyId: string) =>
    call<{ ok: true; exists: boolean; manifest: WorkflowManifest | null; source?: "loaded" }>(
      "GET", `/wavex-os/onboarding/workflow-manifest?companyId=${encodeURIComponent(companyId)}`),

  connectorRecommendations: (companyId: string) =>
    call<{ ok: true; manifest: ConnectorManifest; source: "t2" | "fallback"; warnings: string[] }>(
      "GET", `/wavex-os/onboarding/connector-recommendations?companyId=${encodeURIComponent(companyId)}`),

  // Department parking — written before the swarm is regenerated so the
  // overlay can park everything outside the kept set.
  //
  // `mode` is `"focused"` only. The route still accepts `"full"`, but no
  // caller sends it: full used to mean "promote every matrix-parked agent
  // to active", which cancelled the activation verdict the pillar answers
  // had just produced. Parking is subtractive now, and typing it that way
  // is what keeps a future caller from reintroducing the override.
  setScope: (input: {
    companyId: string;
    mode: "focused";
    departments: string[];
    custom_labels?: string[];
  }) => call<{ ok: true; scope: { mode: string; departments: string[]; custom_labels?: string[]; set_at: string } }>(
    "POST", "/wavex-os/onboarding/scope", input,
  ),

  getScope: (companyId: string) =>
    call<{ ok: true; scope: { mode: "full" | "focused"; departments: string[]; custom_labels?: string[]; set_at: string } | null }>(
      "GET", `/wavex-os/onboarding/scope?companyId=${encodeURIComponent(companyId)}`),

  // Avatar onboarding (parallel track to the company pillars)
  createAvatar: (input: { name: string; role: string; workingHours: [string, string]; tz: string }) =>
    call<{ ok: true; avatarId: string }>("POST", "/wavex-os/onboarding/avatar", input),

  connectAvatarTool: (avatarId: string, provider: string) =>
    call<{
      ok: true;
      connected: Array<{ provider: string; ref: string; status: "stub" | "connected"; connected_at: string }>;
      total: number;
    }>("POST", `/wavex-os/onboarding/avatar/${encodeURIComponent(avatarId)}/tools`, { provider }),

  // Phase 3 — per-provider personalization (VIPs / privacy zones / signoff)
  setAvatarToolMeta: (
    avatarId: string, provider: string,
    meta: { vips?: string[]; privacy_zones?: string[]; signoff?: string },
  ) =>
    call<{
      ok: true; provider: string;
      meta: { vips?: string[]; privacy_zones?: string[]; signoff?: string };
    }>(
      "POST",
      `/wavex-os/onboarding/avatar/${encodeURIComponent(avatarId)}/tools/${encodeURIComponent(provider)}/meta`,
      meta,
    ),

  // Phase 5 — welcome-hero free-text intro parse (T2 → profile prefill)
  parseAvatarIntro: (rawIntro: string, skipInference?: boolean) =>
    call<{
      ok: true;
      profile: { name?: string; role?: string; working_hours?: [string, string]; tz?: string };
      source: "t2" | "stub";
    }>(
      "POST",
      `/wavex-os/onboarding/avatar/parse`,
      { raw_intro: rawIntro, skipInference },
    ),

  analyzeAvatarVoice: (
    avatarId: string,
    samples: [string, string, string],
    skipInference?: boolean,
    extras?: { signoff?: string; guardrails?: string[] },
  ) =>
    call<{
      ok: true;
      profile: { tone: string; formality: string; structure: string; delegates: string[] };
      source: "t2" | "stub";
      signoff?: string;
      guardrails?: string[];
    }>(
      "POST",
      `/wavex-os/onboarding/avatar/${encodeURIComponent(avatarId)}/voice`,
      { samples, skipInference, ...extras },
    ),

  // Phase 3 — Trust & boundaries step
  setAvatarTrust: (avatarId: string, trust: {
    autonomy_preset: "cautious" | "balanced" | "aggressive";
    vips: Array<{ email: string; label?: string }>;
    privacy_zones: string[];
    notify: string[];
  }) =>
    call<{
      ok: true;
      trust: typeof trust & { set_at: string };
    }>("POST", `/wavex-os/onboarding/avatar/${encodeURIComponent(avatarId)}/trust`, trust),

  getAvatarTrust: (avatarId: string) =>
    call<{
      ok: true;
      trust: {
        autonomy_preset: "cautious" | "balanced" | "aggressive";
        vips: Array<{ email: string; label?: string }>;
        privacy_zones: string[];
        notify: string[];
        set_at: string;
      } | null;
    }>("GET", `/api/avatar/${encodeURIComponent(avatarId)}/trust`),

  // Phase 7-C — edit profile fields after onboarding. All optional.
  updateAvatarProfile: (
    avatarId: string,
    fields: { name?: string; role?: string; workingHours?: [string, string]; tz?: string },
  ) =>
    call<{
      ok: true;
      profile: { name: string; role: string; working_hours: [string, string]; tz: string; created_at: string };
    }>("PATCH", `/api/avatar/${encodeURIComponent(avatarId)}/profile`, fields),

  // Phase 7-C — delete the entire avatar record on disk.
  deleteAvatar: (avatarId: string) =>
    call<{ ok: true; removed: string }>("DELETE", `/api/avatar/${encodeURIComponent(avatarId)}`),

  graduateAvatar: (avatarId: string) =>
    call<{
      ok: true;
      trust: {
        autonomy_preset: "cautious" | "balanced" | "aggressive";
        vips: Array<{ email: string; label?: string }>;
        privacy_zones: string[];
        notify: string[];
        set_at: string;
      };
    }>("POST", `/api/avatar/${encodeURIComponent(avatarId)}/graduate`),

  getAvatarSuggestions: (avatarId: string) =>
    call<{
      ok: true;
      suggestions: Array<{ id: string; title: string; body: string; needs: string[] }>;
    }>("GET", `/wavex-os/onboarding/avatar/${encodeURIComponent(avatarId)}/suggestions`),

  finalizeAvatar: (avatarId: string, enabledAutomationIds: string[]) =>
    call<{
      ok: true;
      avatarId: string;
      url: string;
      paperclipHandoff: {
        enabled: boolean;
        paperclipUrl: string | null;
        paperclipCompanyId: string | null;
        conductorAgentId: string | null;
        created: Array<{ provider: string; agentId: string; status: string }>;
        skipped: Array<{ provider: string; reason: string }>;
        errors: Array<{ provider: string; message: string }>;
      } | null;
    }>(
      "POST", `/wavex-os/onboarding/avatar/${encodeURIComponent(avatarId)}/finalize`,
      { enabledAutomationIds },
    ),

  // Phase 2 — manual triage trigger (dev surface; scheduler fires this
  // automatically in prod). Returns the runner's report.
  runAvatarGmailTriage: (avatarId: string, opts?: { dryRun?: boolean; skipInference?: boolean }) => {
    const params = new URLSearchParams();
    if (opts?.dryRun === false) params.set("dryRun", "false");
    if (opts?.skipInference === false) params.set("skipInference", "false");
    const qs = params.toString();
    return call<{
      ok: true;
      result: {
        avatarId: string; paperclipCompanyId: string; gmailAgentId: string | null;
        processed: number; drafted: number; approvalsCreated: number;
        errors: Array<{ threadId: string; message: string }>;
      };
    }>("POST", `/api/avatar/${encodeURIComponent(avatarId)}/run/gmail-triage${qs ? "?" + qs : ""}`);
  },

  // Phase 6 — provider-agnostic runners
  runAvatarMailTriage: (avatarId: string, provider: "gmail" | "outlook", opts?: { dryRun?: boolean; skipInference?: boolean }) => {
    const params = new URLSearchParams();
    if (opts?.dryRun === false) params.set("dryRun", "false");
    if (opts?.skipInference === false) params.set("skipInference", "false");
    const qs = params.toString();
    return call<{
      ok: true;
      result: {
        avatarId: string; providerId: string; paperclipCompanyId: string; agentId: string | null;
        processed: number; drafted: number; approvalsCreated: number;
        errors: Array<{ threadId: string; message: string }>;
      };
    }>("POST", `/api/avatar/${encodeURIComponent(avatarId)}/run/mail-triage/${provider}${qs ? "?" + qs : ""}`);
  },

  runAvatarCalendarTriage: (avatarId: string, provider: "google_calendar" | "microsoft_calendar", opts?: { dryRun?: boolean; skipInference?: boolean }) => {
    const params = new URLSearchParams();
    if (opts?.dryRun === false) params.set("dryRun", "false");
    if (opts?.skipInference === false) params.set("skipInference", "false");
    const qs = params.toString();
    return call<{
      ok: true;
      result: {
        avatarId: string; providerId: string; paperclipCompanyId: string; agentId: string | null;
        processed: number; approvalsCreated: number;
        errors: Array<{ eventId: string; message: string }>;
      };
    }>("POST", `/api/avatar/${encodeURIComponent(avatarId)}/run/calendar-triage/${provider}${qs ? "?" + qs : ""}`);
  },

  runAvatarSlackDigest: (avatarId: string, opts?: { dryRun?: boolean; skipInference?: boolean }) => {
    const params = new URLSearchParams();
    if (opts?.dryRun === false) params.set("dryRun", "false");
    if (opts?.skipInference === false) params.set("skipInference", "false");
    const qs = params.toString();
    return call<{
      ok: true;
      result: {
        avatarId: string; paperclipCompanyId: string; agentId: string | null;
        processed: number; approvalsCreated: number;
        errors: Array<{ ts: string; message: string }>;
      };
    }>("POST", `/api/avatar/${encodeURIComponent(avatarId)}/run/slack-digest${qs ? "?" + qs : ""}`);
  },

  getAvatarMemory: (avatarId: string, limit = 50) =>
    call<{
      ok: true;
      preferences: Array<{
        id: string; rule: string; category: string; confidence: number;
        learnedAt: string; supportingEventIds: string[]; applyCount: number;
      }>;
      episodic: Array<{
        id: string; ts: string; kind: string; approvalId?: string;
        approvalType?: string; classification?: string; confidence?: number;
        decision?: string; edited?: { before?: string; after?: string }; note?: string;
      }>;
    }>("GET", `/api/avatar/${encodeURIComponent(avatarId)}/memory?limit=${limit}`),

  distillAvatarMemory: (avatarId: string, opts?: { skipInference?: boolean; lookbackHours?: number }) => {
    const params = new URLSearchParams();
    if (opts?.skipInference) params.set("skipInference", "true");
    if (opts?.lookbackHours) params.set("lookbackHours", String(opts.lookbackHours));
    const qs = params.toString();
    return call<{
      ok: true;
      count: number;
      added: Array<{ id: string; rule: string; category: string; confidence: number }>;
    }>("POST", `/api/avatar/${encodeURIComponent(avatarId)}/memory/distill${qs ? "?" + qs : ""}`);
  },

  // Phase 2 — approval inbox
  listAvatarApprovals: (avatarId: string, status: "pending" | "approved" | "rejected" | "all" = "pending") =>
    call<{
      ok: true;
      approvals: Array<{
        id: string;
        avatarId: string;
        type: string;
        status: "pending" | "approved" | "rejected";
        createdAt: string;
        decidedAt?: string;
        decisionNote?: string;
        requestedByAgentId: string;
        // Phase 6 — payload widens across approval kinds (mail draft /
        // calendar invite_response / slack mention_digest). All fields
        // optional so the dashboard can render each variant by reading
        // `type` and picking the right ones. Server enforces the per-
        // kind shape; this is the union view.
        payload: {
          provider?: string;
          // Mail draft_reply
          threadId?: string;
          subject?: string;
          from?: { name: string; email: string };
          preview?: string;
          receivedAt?: string;
          draftText?: string | null;
          classification?: "now" | "soon" | "fyi";
          openQuestion?: string | null;
          // Calendar invite_response
          eventId?: string;
          summary?: string;
          organizer?: { name: string; email: string };
          start?: string;
          end?: string;
          inside_working_hours?: boolean;
          suggested?: "accept" | "decline" | "propose-time";
          proposed_times?: string[] | null;
          draft_message?: string | null;
          // Slack mention_digest
          channel?: string;
          channelId?: string;
          author?: { name: string; email?: string };
          ts?: string;
          text?: string;
          permalink?: string;
          importance?: "urgent" | "info" | "fyi";
          // Shared
          confidence?: number;
          reasoning?: string;
          body?: string;
        };
        editedPayload?: { draftText?: string } | null;
      }>;
    }>("GET", `/api/avatar/${encodeURIComponent(avatarId)}/approvals?status=${status}`),

  decideAvatarApproval: (
    avatarId: string,
    approvalId: string,
    body: { decision: "approve" | "reject"; decisionNote?: string; editedPayload?: { draftText?: string } },
  ) =>
    call<{ ok: true; approval: { id: string; status: string; decidedAt: string } }>(
      "POST",
      `/api/avatar/${encodeURIComponent(avatarId)}/approvals/${encodeURIComponent(approvalId)}/decide`,
      body,
    ),

  // Phase 2 — audit log
  getAvatarAudit: (avatarId: string, limit = 50) =>
    call<{
      ok: true;
      entries: Array<{
        id: string;
        actorType: string;
        actorId: string;
        action: string;
        entityType: string;
        entityId: string;
        agentId: string | null;
        details: Record<string, unknown> | null;
        createdAt: string;
      }>;
      error?: string;
    }>("GET", `/api/avatar/${encodeURIComponent(avatarId)}/audit?limit=${limit}`),

  // Phase 2 — per-skill kill switch (pause/resume one sub-agent on the
  // mirrored Paperclip company without touching the rest of the fleet)
  listAvatarSkills: (avatarId: string) =>
    call<{
      ok: true;
      skills: Array<{ skill: string; agentId: string; status: string | null }>;
    }>("GET", `/api/avatar/${encodeURIComponent(avatarId)}/skills`),

  controlAvatarSkill: (avatarId: string, skill: string, action: "pause" | "resume") =>
    call<{ ok: true; skill: string; agentId: string; status: string | null }>(
      "POST",
      `/api/avatar/${encodeURIComponent(avatarId)}/skills/${encodeURIComponent(skill)}/control`,
      { action },
    ),

  getAvatar: (avatarId: string) =>
    call<{
      ok: true;
      avatarId: string;
      profile: { name: string; role: string; working_hours: [string, string]; tz: string; created_at: string } | null;
      tools: Array<{ provider: string; ref: string; status: "stub" | "connected"; connected_at: string }>;
      tools_skipped: boolean;
      voice: {
        samples: string[];
        profile?: { tone: string; formality: string; structure: string; delegates: string[] };
        source?: "t2" | "stub";
      } | null;
      automations: { enabled: string[]; suggested: Array<{ id: string; title: string; body: string; needs: string[] }> } | null;
    }>("GET", `/api/avatar/${encodeURIComponent(avatarId)}`),

  // Monte Carlo report (full per-strategy breakdown, written by finalize)
  getMcReport: (companyId: string) =>
    call<{
      ok: boolean;
      report?: {
        horizon_cycles: number;
        n_runs_per_strategy: number;
        strategies: Array<{ strategy_id: string; mean_mrr_growth: number; p_ruin: number; sharpe: number }>;
        winner: { strategy_id: string; rationale: string };
      };
      error?: string;
    }>("GET", `/wavex-os/onboarding/mc-report?companyId=${encodeURIComponent(companyId)}`),

  // BYOC narration of the MC report. Spawns the customer's local
  // claude with pillar context + the report's per-strategy stats so
  // the customer reads a 2-3 paragraph reasoning of the winner
  // instead of just a deterministic "BALANCED won" line. Falls back
  // to a deterministic narrative if claude isn't installed/authed.
  mcNarrate: (input: { companyId: string }) =>
    call<{
      ok: boolean;
      narrative?: string;
      model_attribution?: "byoc-claude" | "fallback-deterministic";
      warning?: string;
      error?: string;
    }>("POST", "/wavex-os/onboarding/mc-narrate", input),

  // Finalize
  finalize: (input: {
    companyId: string;
    orgId?: string;
    operatorHandle?: string;
    skipInference?: boolean;
    mc?: { horizon_cycles?: number; n_runs?: number; seed?: number };
  }) => call<{
    ok: true;
    manifest: CompanyManifest;
    sha256: string;
    source: "t2" | "fallback";
    warnings: string[];
  }>("POST", "/wavex-os/onboarding/finalize", input),

  // Re-generate imprint with optional operator guidance (prose only)
  regenerateImprint: (input: { companyId: string; operatorGuidance?: string }) =>
    call<{
      ok: true;
      manifest: CompanyManifest;
      sha256: string;
      source: "t2" | "fallback";
      warnings: string[];
    }>("POST", "/wavex-os/onboarding/regenerate-imprint", input),

  // Refinement (Option C): analyze guidance, propose structural changes,
  // operator approves a subset, apply surgically + re-sign.
  analyzeRefinement: (input: { companyId: string; operatorGuidance: string }) =>
    call<{
      ok: true;
      imprint_only: boolean;
      changes: Array<{
        id: string;
        action: "connector_add" | "connector_promote" | "swarm_overlay" | "workflow_task_add" | "workflow_escalation_add";
        rationale: string;
        pillar_signal?: string;
        // action-specific fields (kept loose — UI renders generically)
        connector_id?: string;
        bucket?: "required" | "suggested" | "deferred";
        priority?: "P-1" | "P0" | "P1" | "P2";
        from_bucket?: "deferred" | "suggested";
        to_bucket?: "suggested" | "required";
        slot?: string;
        new_overlay?: string;
        task?: { task: string; tier?: string; flow_type?: string; connector?: string | null; dry_run_gate?: boolean };
        on?: string;
        to?: string;
      }>;
      rationale_summary: string;
      warnings: string[];
    }>("POST", "/wavex-os/onboarding/analyze-refinement", input),

  applyRefinement: (input: {
    companyId: string;
    operatorGuidance: string;
    changes: unknown[];
    regenerateImprint?: boolean;
  }) => call<{
    ok: true;
    sha256: string;
    manifest: CompanyManifest;
    applied_change_ids: string[];
    warnings: string[];
  }>("POST", "/wavex-os/onboarding/apply-refinement", input),

  revertRefinement: (input: { companyId: string }) =>
    call<{
      ok: true;
      sha256: string;
      reverted_guidance: string;
      reverted_change_ids: string[];
    }>("POST", "/wavex-os/onboarding/revert-refinement", input),

  // Instance reads (dashboard)
  getInstanceManifest: (companyId: string) =>
    call<InstanceManifestResponse>("GET", `/api/instance/${encodeURIComponent(companyId)}/manifest`),

  getInstanceKpis: (companyId: string) =>
    call<InstanceKpisResponse>("GET", `/api/instance/${encodeURIComponent(companyId)}/kpis`),

  listCompanies: () =>
    call<CompaniesResponse>("GET", "/api/companies"),

  // Real-time Paperclip handoff progress — polled by ActivateProgress
  // while /activate is in flight so the UI can paint per-slot hires
  // as the bridge actually fires them, not just at the final response.
  getHandoffStatus: (companyId: string) =>
    call<{
      ok: true;
      progress: null | {
        paperclipUrl: string;
        paperclipCompanyId: string;
        total: number;
        completed: number;
        inFlight: string | null;
        slots: Array<{ slot: string; status: "pending" | "hiring" | "hired" | "skipped" | "failed"; agentId?: string }>;
      };
    }>("GET", `/api/instance/${encodeURIComponent(companyId)}/handoff-status`),

  // Activate — bridge the signed manifest into runtime DB state. Idempotent.
  activate: (companyId: string) =>
    call<{
      ok: true;
      inserted: { companies: number; agents: number };
      warnings: string[];
      sha256: string;
      paperclipHandoff: {
        enabled: boolean;
        paperclipUrl: string | null;
        paperclipCompanyId: string | null;
        created: Array<{ slot: string; agentId: string; status: string }>;
        skipped: Array<{ slot: string; reason: string }>;
        errors: Array<{ slot: string; message: string }>;
      };
    }>("POST", `/api/instance/${encodeURIComponent(companyId)}/activate`),

  // Swap — record an operator-chosen template substitution for one slot.
  // Pass templateId=null to clear (revert to catalog default).
  swapTemplate: (input: { companyId: string; slot: string; templateId: string | null }) =>
    call<{
      ok: true;
      slot: string;
      templateId: string | null;
      overlays: Record<string, string>;
      sha256: string;
    }>("POST", `/api/instance/${encodeURIComponent(input.companyId)}/swap-template`, {
      slot: input.slot, templateId: input.templateId,
    }),

  // Natural-language recommendation for the Add-agent flow. T2 reads the
  // 165-template registry + company pillar context + parent + operator's
  // prompt and returns 3-5 ranked candidates.
  recommendAgent: (input: {
    companyId: string;
    parent_slot: string;
    prompt: string;
    available_parents?: Array<{ slot: string; role_hint?: string }>;
  }) =>
    call<{
      ok: true;
      recommendations: Array<{ templateId: string; parent_slot: string; rationale: string; score: number }>;
    }>("POST", "/wavex-os/onboarding/recommend-agent", input),

  // Add agent — creates a new agent slot under an existing parent.
  // Persists to manifest.template_additions; bridge merges on activate.
  addAgent: (input: { companyId: string; parent_slot: string; template_id: string; slot_suffix?: string }) =>
    call<{
      ok: true;
      added: { slot: string; parent_slot: string; template_id: string; added_at: string };
      additions: Array<{ slot: string; parent_slot: string; template_id: string; added_at: string }>;
      sha256: string;
    }>("POST", `/api/instance/${encodeURIComponent(input.companyId)}/add-agent`, {
      parent_slot: input.parent_slot, template_id: input.template_id, slot_suffix: input.slot_suffix,
    }),

  // Remove an operator-added agent (no-op if it's a base-roster slot).
  removeAddedAgent: (input: { companyId: string; slot: string }) =>
    call<{ ok: true; removed_slot: string; sha256: string }>(
      "DELETE", `/api/instance/${encodeURIComponent(input.companyId)}/add-agent`, { slot: input.slot },
    ),

  // Reset — wipe ALL state for a company (filesystem onboarding artifacts +
  // every DB row keyed by company_id). Destructive. UI must confirm.
  resetCompany: (companyId: string) =>
    call<{
      ok: true;
      companyId: string;
      filesystemRemoved: boolean;
      dbDeletedRows: {
        companies: number;
        agents: number;
        credentials: number;
        credentialAuditLog: number;
        companyKpis: number;
        kpiSnapshots: number;
        costEvents: number;
        issues: number;
        issueComments: number;
        taskOutcomeAttributions: number;
        heartbeatRuns: number;
      };
    }>("DELETE", `/api/instance/${encodeURIComponent(companyId)}/reset`),

  // Help chat (per-company conversational sidebar)
  getHelpChat: (companyId: string) =>
    call<{
      ok: true;
      messages: Array<{ role: "user" | "assistant"; ts_iso: string; text: string; phase?: string; field?: string }>;
    }>("GET", `/api/instance/${encodeURIComponent(companyId)}/help-chat`),

  postHelpChat: (companyId: string, body: { message: string; phase?: string; field?: string }) =>
    call<{
      ok: true;
      messages: Array<{ role: "user" | "assistant"; ts_iso: string; text: string; phase?: string; field?: string }>;
      latest_assistant: { role: "assistant"; ts_iso: string; text: string; phase?: string; field?: string };
    }>("POST", `/api/instance/${encodeURIComponent(companyId)}/help-chat`, body),

  // Redundancy review (exact templateId duplicate groups)
  getRedundancy: (companyId: string) =>
    call<{
      ok: true;
      groups: Array<{
        template_id: string;
        slots: Array<{ slot: string; parent_slot: string; template_id: string; origin: string; muted: boolean }>;
        by_parent: Record<string, number>;
        weight: number;
      }>;
      all_slots: Array<{ slot: string; parent_slot: string; template_id: string; origin: string; muted: boolean }>;
      mutes: string[];
    }>("GET", `/api/instance/${encodeURIComponent(companyId)}/redundancy`),

  muteSlot: (companyId: string, slot: string) =>
    call<{ ok: true; mutes: string[]; sha256: string }>(
      "POST", `/api/instance/${encodeURIComponent(companyId)}/mute-slot`, { slot },
    ),

  unmuteSlot: (companyId: string, slot: string) =>
    call<{ ok: true; mutes: string[]; sha256: string }>(
      "DELETE", `/api/instance/${encodeURIComponent(companyId)}/mute-slot`, { slot },
    ),

  // Token budget (project-level cap, opt-in)
  getTokenBudget: (companyId: string) =>
    call<{
      ok: true;
      budget: { cap_tokens: number | null; set_at: string | null };
      used: number;
    }>("GET", `/api/instance/${encodeURIComponent(companyId)}/token-budget`),

  setTokenBudget: (companyId: string, cap_tokens: number | null) =>
    call<{
      ok: true;
      budget: { cap_tokens: number | null; set_at: string | null };
    }>("POST", `/api/instance/${encodeURIComponent(companyId)}/token-budget`, { cap_tokens }),

  // Token usage (T2 cost tracking, per-company aggregate)
  tokenUsage: (companyId: string) =>
    call<{
      ok: true;
      usage: {
        companyId: string;
        started_at: string;
        updated_at: string;
        total: { input_tokens: number; output_tokens: number; cached_input_tokens: number; cost_usd: number; duration_ms: number; calls: number };
        by_phase: Record<string, { input_tokens: number; output_tokens: number; cached_input_tokens: number; cost_usd: number; duration_ms: number; calls: number; last_call_at?: string }>;
        recent_calls: Array<{ phase: string; ts_iso: string; input_tokens: number; output_tokens: number; cached_input_tokens: number; cost_usd: number; duration_ms: number }>;
      };
    }>("GET", `/api/instance/${encodeURIComponent(companyId)}/token-usage`),

  // Pricing tiers (System Optimizer subscription screen)
  // ---- observability (previously only reachable via raw fetch) ----

  obsMissionControl: (companyId: string) =>
    call<{ ok: true; data: Record<string, unknown> }>(
      "GET", `/api/observability/${encodeURIComponent(companyId)}/mission-control`),

  obsBudget: (companyId: string) =>
    call<{ ok: true; data: Record<string, unknown> }>(
      "GET", `/api/observability/${encodeURIComponent(companyId)}/budget`),

  obsBottlenecks: (companyId: string) =>
    call<{ ok: true; data: Array<Record<string, unknown>> }>(
      "GET", `/api/observability/${encodeURIComponent(companyId)}/bottlenecks`),

  // ---- ignition (read side of activate) ----

  getIgnitionStatus: (companyId: string) =>
    call<import("../../canvas/contract").IgnitionStatusResponse>(
      "GET", `/api/instance/${encodeURIComponent(companyId)}/ignition`),

  igniteFleet: (companyId: string) =>
    call<{ ok: true; ignition: Record<string, unknown> }>(
      "POST", `/api/instance/${encodeURIComponent(companyId)}/ignite`),

  // ---- runtime reads (Part 2 via the server-side adapter) ----

  getRuntimeDashboard: (companyId: string) =>
    call<{ ok: true; dashboard: Record<string, any> }>(
      "GET", `/api/instance/${encodeURIComponent(companyId)}/runtime/dashboard`, undefined, { timeoutMs: 15_000 }),

  getRuntimeActivity: (companyId: string) =>
    call<{ ok: true; events: Array<Record<string, any>> }>(
      "GET", `/api/instance/${encodeURIComponent(companyId)}/runtime/activity`, undefined, { timeoutMs: 15_000 }),

  getRuntimeApprovals: (companyId: string) =>
    call<{ ok: true; approvals: Array<Record<string, any>> }>(
      "GET", `/api/instance/${encodeURIComponent(companyId)}/runtime/approvals`, undefined, { timeoutMs: 15_000 }),

  getRuntimeLiveRuns: (companyId: string) =>
    call<{ ok: true; runs: Array<Record<string, any>> }>(
      "GET", `/api/instance/${encodeURIComponent(companyId)}/runtime/live-runs`, undefined, { timeoutMs: 15_000 }),

  // ---- cognitive canvas ----

  getCanvas: (companyId: string) =>
    call<import("../../canvas/contract").CanvasStateResponse>(
      "GET", `/api/instance/${encodeURIComponent(companyId)}/canvas`, undefined, { timeoutMs: 20_000 }),

  // 75s: the T2 composer runs up to 45s server-side, plus accounting margin.
  sendCanvasMessage: (companyId: string, message: string, extra?: { restoreSignature?: string }) =>
    call<import("../../canvas/contract").CanvasPostResponse>(
      "POST", `/api/instance/${encodeURIComponent(companyId)}/canvas`, { message, ...extra }, { timeoutMs: 75_000 }),

  commitCanvasProposal: (companyId: string, proposalId: string) =>
    call<{ ok: true; proposal: import("../../canvas/contract").CanvasProposal; turn?: import("../../canvas/contract").CanvasTurn; replayed?: boolean }>(
      "POST", `/api/instance/${encodeURIComponent(companyId)}/canvas/commit`, { proposalId }, { timeoutMs: 75_000 }),

  pinWorkspace: (companyId: string, signature: string, title?: string) =>
    call<{ ok: true; desk: import("../../canvas/contract").DeskState; layout: import("../../canvas/contract").LayoutSpec }>(
      "POST", `/api/instance/${encodeURIComponent(companyId)}/canvas/pin`, { signature, title }, { timeoutMs: 15_000 }),

  unpinWorkspace: (companyId: string, signature: string) =>
    call<{ ok: true; desk: import("../../canvas/contract").DeskState }>(
      "DELETE", `/api/instance/${encodeURIComponent(companyId)}/canvas/pin`, { signature }, { timeoutMs: 15_000 }),

  // ---- recursive org (docs/RECURSIVE_ORG_SPEC.md, R1) ----

  getOrgFlywheel: (companyId: string) =>
    call<import("../../canvas/contract").OrgFlywheelResponse>(
      "GET", `/api/instance/${encodeURIComponent(companyId)}/org/flywheel`, undefined, { timeoutMs: 20_000 }),

  getOrgNode: (companyId: string, nodeId: string) =>
    call<import("../../canvas/contract").OrgNodeResponse>(
      "GET", `/api/instance/${encodeURIComponent(companyId)}/org/nodes/${encodeURIComponent(nodeId)}`, undefined, { timeoutMs: 20_000 }),

  askOrgNode: (companyId: string, nodeId: string, question: string) =>
    call<{ ok: true; walkId: string }>(
      "POST", `/api/instance/${encodeURIComponent(companyId)}/org/nodes/${encodeURIComponent(nodeId)}/ask`, { question }, { timeoutMs: 75_000 }),

  getOrgWalk: (companyId: string, walkId: string) =>
    call<import("../../canvas/contract").OrgWalkResponse>(
      "GET", `/api/instance/${encodeURIComponent(companyId)}/org/walks/${encodeURIComponent(walkId)}`, undefined, { timeoutMs: 20_000 }),

  getOrgConstitution: (companyId: string) =>
    call<import("../../canvas/contract").OrgConstitutionResponse>(
      "GET", `/api/instance/${encodeURIComponent(companyId)}/org/constitution`, undefined, { timeoutMs: 20_000 }),

  getOrgGravity: (companyId: string) =>
    call<import("../../canvas/contract").OrgGravityResponse>(
      "GET", `/api/instance/${encodeURIComponent(companyId)}/org/gravity`, undefined, { timeoutMs: 20_000 }),

  getOrgInvestigations: (companyId: string, opts?: { nodeId?: string }) =>
    call<import("../../canvas/contract").OrgInvestigationsResponse>(
      "GET", `/api/instance/${encodeURIComponent(companyId)}/org/investigations/recent${opts?.nodeId ? `?nodeId=${encodeURIComponent(opts.nodeId)}` : ""}`,
      undefined, { timeoutMs: 20_000 }),

  getOrgMemory: (companyId: string) =>
    call<import("../../canvas/contract").OrgMemoryListResponse>(
      "GET", `/api/instance/${encodeURIComponent(companyId)}/org/memory`, undefined, { timeoutMs: 20_000 }),

  keepToOrgMemory: (companyId: string, body: { nodeId: string; signature: string; question?: string }) =>
    call<import("../../canvas/contract").OrgKeepResponse>(
      "POST", `/api/instance/${encodeURIComponent(companyId)}/org/memory`, body, { timeoutMs: 15_000 }),

  // ---- the native work runtime (spec Rev 6) ----

  getWork: (companyId: string) =>
    call<import("../../canvas/contract").WorkStateResponse>(
      "GET", `/api/instance/${encodeURIComponent(companyId)}/work`, undefined, { timeoutMs: 15_000 }),

  seedWork: (companyId: string) =>
    call<import("../../canvas/contract").WorkSeedResponse>(
      "POST", `/api/instance/${encodeURIComponent(companyId)}/work/seed`, {}, { timeoutMs: 20_000 }),

  // A cycle executes briefs SERIALLY on the operator's own subscription —
  // up to 3 tasks × 120s engine ceiling each, plus margin.
  runWorkCycle: (companyId: string, opts?: { maxTasks?: number }) =>
    call<import("../../canvas/contract").WorkCycleSummary>(
      "POST", `/api/instance/${encodeURIComponent(companyId)}/work/run-cycle`, opts ?? {}, { timeoutMs: 400_000 }),

  reviewWorkDeliverable: (companyId: string, deliverableId: string, body: { verdict: "approved" | "changes_requested"; note?: string }) =>
    call<import("../../canvas/contract").WorkReviewResponse>(
      "POST", `/api/instance/${encodeURIComponent(companyId)}/work/deliverables/${encodeURIComponent(deliverableId)}/review`, body, { timeoutMs: 15_000 }),

  // ---- Build Your Organization (plan assembly · adopt · approve) ----

  startPlanAssembly: (companyId: string, opts?: { skipInference?: boolean; resume?: boolean }) =>
    call<import("../../canvas/plan-contract").PlanAssemblyStartResponse>(
      // The deterministic pipeline answers in ms; the generous ceiling
      // covers a slow disk, not a model.
      "POST", "/wavex-os/onboarding/plan-assembly/start", { companyId, ...opts }, { timeoutMs: 60_000 }),

  getPlanAssembly: (companyId: string) =>
    call<import("../../canvas/plan-contract").PlanAssemblyGetResponse>(
      "GET", `/wavex-os/onboarding/plan-assembly?companyId=${encodeURIComponent(companyId)}`, undefined, { timeoutMs: 15_000 }),

  adoptProduct: (companyId: string, body: { url: string; orgName?: string }) =>
    call<import("../../canvas/plan-contract").AdoptProductResult>(
      // fetch (≤5s + one meta-refresh hop) + one shallow T2 call (≤45s).
      "POST", `/api/instance/${encodeURIComponent(companyId)}/adopt-product`, body, { timeoutMs: 60_000 }),

  listTiers: () =>
    call<{
      ok: true;
      tiers: Array<{
        id: "trial" | "founder" | "growth" | "custom";
        displayName: string;
        priceLabel: string;
        priceCents: number;
        features: string[];
        recommended: boolean;
        ctaLabel: string;
      }>;
    }>("GET", "/api/tiers"),

  subscribeTier: (input: {
    orgId: string;
    tierId: "trial" | "founder" | "growth" | "custom";
    origin: "subscribe" | "skip";
  }) =>
    call<{ ok: true; orgId: string; tierId: string; origin: string }>(
      "POST", "/api/tier-subscriptions", input,
    ),
};

export type SmokeTestPhase =
  | "queued"
  | "provisioning"
  | "running"
  | "analyzing"
  | "done"
  | "timed_out"
  | "cancelled";

export interface SmokeTestRunResponse {
  ok: boolean;
  runId: string;
  companyId: string;
  phase: SmokeTestPhase;
  result?: "pass" | "fail";
  startedAt: string;
  elapsed_ms: number;
}

export const smokeTestApi = {
  trigger: (companyId: string, userId?: string) =>
    call<{ ok: true; runId: string; companyId: string }>(
      "POST", "/api/smoke-test/trigger", { companyId, userId },
    ),

  getStatus: (runId: string) =>
    call<SmokeTestRunResponse>("GET", `/api/smoke-test/run/${encodeURIComponent(runId)}`),

  abort: (runId: string) =>
    call<{ ok: true; cancelled: boolean; runId: string }>(
      "DELETE", `/api/smoke-test/run/${encodeURIComponent(runId)}`,
    ),
};

export interface UserRecord {
  id: string;
  email: string | null;
  isNewUser: boolean;
  wizardStep: number;
  wizardRepo: string | null;
  wizardCompletedAt: string | null;
}

export interface GitHubRepo {
  id: string;
  full_name: string;
  description: string | null;
  private: boolean;
  updated_at: string;
  html_url: string;
}

export const userApi = {
  me: () => call<{ ok: true; user: UserRecord }>("GET", "/api/users/me"),

  setWizardStep: (id: string, step: number) =>
    call<{ ok: true; user: UserRecord }>("PATCH", `/api/users/${id}/wizard-step`, { step }),

  setWizardRepo: (id: string, repo: string) =>
    call<{ ok: true; user: UserRecord }>("PATCH", `/api/users/${id}/wizard-repo`, { repo }),

  completeWizard: (id: string) =>
    call<{ ok: true; user: UserRecord }>("PATCH", `/api/users/${id}/complete-wizard`, {}),

  getGitHubRepos: (page = 1, perPage = 30) =>
    call<{ repos: GitHubRepo[]; total: number | null; page: number; per_page: number; mock: boolean }>(
      "GET", `/api/github/repos?page=${page}&per_page=${perPage}`,
    ),
};
