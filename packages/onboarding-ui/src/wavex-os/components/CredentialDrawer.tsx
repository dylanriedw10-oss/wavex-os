/** Credential drawer — slides up over the chat after the operator confirms
 *  connectors. Each required connector gets a card with vault inputs +
 *  test + skip-with-reason. The operator hits "Done" when every required
 *  connector is either vaulted-or-skipped; the chat then advances to the
 *  swarm phase. */

import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { wavexOsOnboardingApi, ApiError } from "../lib/api";

interface Props {
  companyId: string;
  onDone: () => void;
  onCancel: () => void;
}

/** Skipping used to open a four-option "Why?" follow-up. Nothing read the
 *  answer — it was stored as a string and rendered back to the person who
 *  typed it — so it cost a decision and bought a label. Skip is now one
 *  click, and the reason recorded is exactly what is known: the operator
 *  skipped it. */
const SKIP_REASON = "Skipped by operator";

type ConnectorRow = NonNullable<Awaited<ReturnType<typeof wavexOsOnboardingApi.listCredentials>>>["connectors"][number];

export function CredentialDrawer({ companyId, onDone, onCancel }: Props) {
  const qc = useQueryClient();
  const list = useQuery({
    queryKey: ["concierge", companyId],
    queryFn: () => wavexOsOnboardingApi.listCredentials(companyId),
  });

  const refresh = () => qc.invalidateQueries({ queryKey: ["concierge", companyId] });

  if (list.isLoading) {
    return (
      <DrawerShell onCancel={onCancel}>
        <div style={{ padding: "1rem", color: "var(--text-dim)" }}>Loading credential state…</div>
      </DrawerShell>
    );
  }

  if (list.isError || !list.data) {
    return (
      <DrawerShell onCancel={onCancel}>
        <div style={{ padding: "1rem", color: "var(--warning)" }}>
          ✗ {list.error instanceof Error ? list.error.message : "Failed to load credentials"}
        </div>
      </DrawerShell>
    );
  }

  const required = list.data.connectors.filter((c) => c.bucket === "required");
  const progress = list.data.progress;
  const ready = progress.allRequiredAddressed;
  const pendingRequired = required.filter((c) => c.status === "pending");

  async function skipAllPending(): Promise<void> {
    const reason = "Deferred to post-onboarding (operator skip-all)";
    for (const c of pendingRequired) {
      try { await wavexOsOnboardingApi.skipCredential({ companyId, connectorId: c.connectorId, reason }); }
      catch { /* surface in row card on next refresh */ }
    }
    refresh();
  }

  return (
    <DrawerShell onCancel={onCancel}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "0.75rem", gap: "0.75rem" }}>
        <h3 style={{ fontSize: 14, fontWeight: 700, margin: 0 }}>Credentials</h3>
        <div style={{ display: "flex", alignItems: "center", gap: "0.6rem" }}>
          {pendingRequired.length > 1 && (
            <button
              type="button"
              onClick={() => void skipAllPending()}
              style={{
                fontSize: 11,
                padding: "0.25rem 0.55rem",
                borderRadius: 4,
                background: "transparent",
                color: "var(--text-dim)",
                border: "1px solid var(--border)",
                cursor: "pointer",
              }}
              title={`Skip all ${pendingRequired.length} pending required connectors`}
            >
              Skip all ({pendingRequired.length})
            </button>
          )}
          <span className="text-dim" style={{ fontSize: 12 }}>
            {progress.requiredReady} of {progress.requiredCount} ready
          </span>
        </div>
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: "0.7rem", maxHeight: "65vh", overflowY: "auto", paddingRight: "0.5rem" }}>
        {required.length === 0 && (
          <div className="text-dim" style={{ fontSize: 12 }}>
            No required connectors. You can proceed.
          </div>
        )}
        {required.map((c) => (
          <ConnectorCard key={c.connectorId} companyId={companyId} c={c} refresh={refresh} />
        ))}
      </div>
      <div style={{ display: "flex", justifyContent: "space-between", marginTop: "0.85rem", paddingTop: "0.7rem", borderTop: "1px solid var(--border)" }}>
        <button
          type="button"
          onClick={onCancel}
          style={{
            padding: "0.4rem 0.75rem",
            borderRadius: 6,
            background: "transparent",
            color: "var(--text-dim)",
            border: "1px solid var(--border)",
            fontSize: 12,
            cursor: "pointer",
          }}
        >
          Back to chat
        </button>
        <button
          type="button"
          onClick={onDone}
          disabled={!ready}
          style={{
            padding: "0.45rem 0.85rem",
            borderRadius: 6,
            background: "var(--accent)",
            color: "var(--bg)",
            border: "none",
            fontWeight: 600,
            fontSize: 12,
            cursor: ready ? "pointer" : "not-allowed",
            opacity: ready ? 1 : 0.5,
          }}
        >
          Done — continue to swarm →
        </button>
      </div>
    </DrawerShell>
  );
}

function ConnectorCard({ companyId, c, refresh }: { companyId: string; c: ConnectorRow; refresh: () => void }) {
  const [values, setValues] = useState<Record<string, string>>({});
  const [testing, setTesting] = useState(false);
  const [vaulting, setVaulting] = useState(false);
  const [skipping, setSkipping] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const isVaulted = c.status === "vaulted_valid" || c.status === "vaulted_unvalidated";
  const isSkipped = c.status === "skipped";
  const composio = c.composioManaged;
  const mcpManaged = c.mcpManaged;
  const mcpSourcedFrom = c.mcpSourcedFrom;

  async function handleVaultAll(): Promise<void> {
    setVaulting(true);
    setError(null);
    try {
      for (const k of c.expectedKeys) {
        const v = values[k];
        if (!v) continue;
        await wavexOsOnboardingApi.pasteCredential({ companyId, connectorId: c.connectorId, key: k, plaintext: v });
      }
      if (c.hasProbe) {
        setTesting(true);
        try { await wavexOsOnboardingApi.testCredential({ companyId, connectorId: c.connectorId }); }
        finally { setTesting(false); }
      }
      refresh();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : (e as Error).message);
    } finally {
      setVaulting(false);
    }
  }

  async function handleSkip(): Promise<void> {
    setSkipping(true);
    setError(null);
    try {
      await wavexOsOnboardingApi.skipCredential({ companyId, connectorId: c.connectorId, reason: SKIP_REASON });
      refresh();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : (e as Error).message);
    } finally {
      setSkipping(false);
    }
  }

  return (
    <div style={{
      padding: "0.65rem 0.75rem",
      background: "var(--bg)",
      border: `1px solid ${isVaulted ? "var(--accent)" : isSkipped ? "var(--border)" : "var(--border)"}`,
      borderRadius: 6,
    }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "0.35rem" }}>
        <div style={{ display: "flex", alignItems: "baseline", gap: "0.4rem" }}>
          <code style={{ fontWeight: 700, fontSize: 12 }}>{c.connectorId}</code>
          {isVaulted && <span style={{ fontSize: 10, color: "var(--accent)" }}>✓ vaulted</span>}
          {isSkipped && <span style={{ fontSize: 10, color: "var(--text-dim)" }}>↷ skipped</span>}
          {composio && <span style={{ fontSize: 10, color: "var(--text-dim)" }}>Composio</span>}
        </div>
        {c.keysUrl && !isVaulted && !isSkipped && (
          <a href={c.keysUrl} target="_blank" rel="noopener noreferrer" style={{ fontSize: 11, color: "var(--accent)" }}>
            Get key ↗
          </a>
        )}
      </div>
      <div className="text-dim" style={{ fontSize: 11, marginBottom: "0.4rem", lineHeight: 1.4 }}>
        {c.rationale}
      </div>

      {/* MCP-first: highest priority. Customer already has an MCP server
          installed for this connector — skip every other surface, just
          confirm they're set. No paste, no popup. */}
      {!isVaulted && !isSkipped && mcpManaged && (
        <div style={{
          padding: "0.5rem 0.6rem",
          background: "var(--surface)",
          border: "1px solid var(--accent)",
          borderRadius: 4,
          fontSize: 11,
          marginTop: "0.25rem",
        }}>
          <div style={{ color: "var(--accent)", fontWeight: 600, marginBottom: 3 }}>
            ✓ Connected via your existing {mcpSourcedFrom} MCP
          </div>
          <div className="text-dim">
            We detected the <code>{c.connectorId}</code> MCP server on your machine — no keys to paste.
          </div>
        </div>
      )}

      {/* Pre-vaulted: connector has no expected keys (e.g. claude-code in
          hosted mode, telegram from Pillar 5). Skip the paste form entirely
          — the connector is already configured upstream. */}
      {!isVaulted && !isSkipped && !mcpManaged && !composio && c.expectedKeys.length === 0 && (
        <div style={{ fontSize: 11, color: "var(--text-dim)", marginTop: "0.2rem" }}>
          ✓ Configured upstream — no additional credentials needed.
        </div>
      )}

      {!isVaulted && !isSkipped && !mcpManaged && !composio && c.expectedKeys.length > 0 && (
        <>
          {c.expectedKeys.map((k) => (
            <input
              key={k}
              type="password"
              placeholder={k}
              value={values[k] ?? ""}
              onChange={(e) => setValues((s) => ({ ...s, [k]: e.target.value }))}
              disabled={vaulting || testing}
              style={{
                width: "100%",
                padding: "0.4rem 0.55rem",
                borderRadius: 4,
                border: "1px solid var(--border)",
                background: "var(--surface)",
                color: "var(--text)",
                fontSize: 12,
                fontFamily: "inherit",
                outline: "none",
                marginBottom: "0.3rem",
              }}
            />
          ))}
          <div style={{ display: "flex", gap: "0.35rem", marginTop: "0.25rem" }}>
            <button
              type="button"
              onClick={() => void handleVaultAll()}
              disabled={vaulting || testing || c.expectedKeys.every((k) => !values[k])}
              style={miniBtn(true)}
            >
              {vaulting || testing ? (testing ? "Testing…" : "Vaulting…") : c.hasProbe ? "Vault & test" : "Vault"}
            </button>
            <button type="button" onClick={() => void handleSkip()} disabled={skipping} style={miniBtn(false)}>
              Skip
            </button>
          </div>
        </>
      )}

      {!isVaulted && !isSkipped && composio && !mcpManaged && (
        <DrawerComposioConnect
          connectorId={c.connectorId}
          companyId={companyId}
          onSkip={() => void handleSkip()}
          onConnected={refresh}
        />
      )}

      {/* MCP-install hint — third option below MCP-detected / OAuth / paste.
          Surfaces when the connector has a known MCP server available but
          the customer hasn't installed it. Gives them a path to skip
          credentials entirely by installing the official MCP. */}
      {!isVaulted && !isSkipped && !mcpManaged && c.mcpAvailable && c.mcpInstallHint && (
        <div style={{
          marginTop: "0.4rem",
          padding: "0.35rem 0.55rem",
          fontSize: 10,
          color: "var(--text-dim)",
          background: "var(--surface-2)",
          border: "1px dashed var(--border)",
          borderRadius: 4,
          lineHeight: 1.45,
        }}>
          <span style={{ color: "var(--accent)" }}>◇</span>
          {" "}{c.mcpInstallHint.install_hint}
          {" "}
          <a
            href={c.mcpInstallHint.docs}
            target="_blank"
            rel="noopener noreferrer"
            style={{ color: "var(--accent)" }}
          >
            Install MCP ↗
          </a>
        </div>
      )}


      {error && (
        <div style={{ color: "var(--warning)", fontSize: 11, marginTop: "0.3rem" }}>✗ {error}</div>
      )}
      {isSkipped && c.skipReason && (
        <div className="text-dim" style={{ fontSize: 11, marginTop: "0.2rem" }}>↷ {c.skipReason}</div>
      )}
    </div>
  );
}

function DrawerShell({ children, onCancel }: { children: React.ReactNode; onCancel: () => void }) {
  return (
    <div
      onClick={onCancel}
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 50,
        background: "color-mix(in srgb, var(--bg) 65%, transparent)",
        display: "flex",
        alignItems: "flex-end",
        justifyContent: "center",
        animation: "fadeIn 200ms",
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          width: "min(720px, 100%)",
          background: "var(--surface)",
          borderTop: "1px solid var(--border)",
          borderTopLeftRadius: 12,
          borderTopRightRadius: 12,
          padding: "1.1rem 1.25rem 1.25rem",
          maxHeight: "85vh",
          display: "flex",
          flexDirection: "column",
        }}
      >
        {children}
      </div>
    </div>
  );
}

function miniBtn(primary: boolean): React.CSSProperties {
  return {
    padding: "0.3rem 0.65rem",
    fontSize: 11,
    borderRadius: 4,
    background: primary ? "var(--accent)" : "transparent",
    color: primary ? "var(--bg)" : "var(--text-dim)",
    border: primary ? "none" : "1px solid var(--border)",
    fontWeight: primary ? 600 : 400,
    cursor: "pointer",
  };
}

/** Composio popup OAuth — same state machine as the Concierge page's
 *  ComposioConnectBlock, sized for the drawer's tighter layout.
 *  Click Connect → initiate → popup at backend.composio.dev → bounces
 *  to provider native OAuth → /list polled every 2s for ACTIVE → mark
 *  vaulted_unvalidated + refresh. */
function DrawerComposioConnect({
  connectorId, companyId, onSkip, onConnected,
}: {
  connectorId: string;
  companyId: string;
  onSkip: () => void;
  onConnected: () => void;
}) {
  const [state, setState] = useState<"idle" | "opening" | "pending" | "needsManual" | "connected" | "error">("idle");
  const [popupRef, setPopupRef] = useState<Window | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  useEffect(() => {
    if (state !== "pending") return;
    const id = setInterval(() => { void checkStatus(); }, 2000);
    return () => clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state]);

  async function handleConnect(): Promise<void> {
    setState("opening");
    setErrorMsg(null);
    try {
      const r = await wavexOsOnboardingApi.initiateConnectorOAuth({
        companyId, toolkitSlug: connectorId,
      });
      if (r.needsLiveWiring || !r.url) {
        setState("needsManual");
        return;
      }
      const popup = window.open(r.url, `wavex-oauth-${connectorId}`, "width=520,height=720,menubar=no,toolbar=no");
      if (!popup) {
        setErrorMsg("Popup blocked. Allow popups + retry.");
        setState("error");
        return;
      }
      setPopupRef(popup);
      setState("pending");
    } catch (e) {
      setErrorMsg(e instanceof ApiError ? e.message : (e as Error).message);
      setState("error");
    }
  }

  async function checkStatus(): Promise<void> {
    try {
      const r = await wavexOsOnboardingApi.listHostedConnections();
      const match = r.connections.find(
        (c) => c.toolkit_slug === connectorId && c.status?.toLowerCase() === "active",
      );
      if (match) {
        setState("connected");
        try { popupRef?.close(); } catch { /* cross-origin tolerance */ }
        try {
          await wavexOsOnboardingApi.pasteCredential({
            companyId, connectorId,
            key: "composio_connection_id",
            plaintext: `composio:${match.id ?? "unknown"}`,
          });
        } catch { /* server may reject if no expectedKeys; the refresh below still shows progress */ }
        onConnected();
      }
    } catch { /* transient — next tick retries */ }
  }

  if (state === "needsManual") {
    return (
      <div style={{ padding: "0.4rem 0.55rem", fontSize: 11, color: "var(--text-dim)", marginTop: "0.25rem" }}>
        Composio not configured on the hub right now —{" "}
        <button type="button" onClick={onSkip} style={miniBtn(false)}>Skip</button>{" "}
        and wire it from Mission Control later.
      </div>
    );
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "0.3rem", marginTop: "0.25rem" }}>
      <div style={{ fontSize: 11, color: "var(--text-dim)" }}>
        Connect via OAuth — opens {connectorId}'s sign-in in a popup. No keys to paste.
      </div>
      <div style={{ display: "flex", gap: "0.35rem" }}>
        <button
          type="button"
          onClick={() => void handleConnect()}
          disabled={state === "opening" || state === "pending" || state === "connected"}
          style={miniBtn(true)}
        >
          {state === "connected" ? "✓ Connected" :
           state === "pending" ? "Connecting…" :
           state === "opening" ? "Opening…" :
           "Connect"}
        </button>
        {state !== "connected" && state !== "pending" && (
          <button type="button" onClick={onSkip} style={miniBtn(false)}>Skip</button>
        )}
      </div>
      {state === "pending" && (
        <span style={{ fontSize: 10, color: "var(--text-dim)" }}>Waiting for OAuth completion…</span>
      )}
      {state === "error" && errorMsg && (
        <span style={{ fontSize: 11, color: "var(--warning)" }}>✗ {errorMsg}</span>
      )}
    </div>
  );
}
