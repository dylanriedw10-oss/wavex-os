/** Inline prompt card for Pillar 5 — where the organization reports to you,
 *  plus the credentials that channel needs.
 *
 *  Asked here because it decides a REQUIRED connector; the question and the
 *  marker it lights up belong in the same phase.
 *
 *  The urgency-routing follow-up is gone. Its two options ("immediately" vs
 *  "daily digest") set a field the runtime never reads when deciding when to
 *  message anyone — the routing is the board's, not the operator's — so the
 *  ask implied a control that did not exist. */

import { useState } from "react";
import { usePillarSuggestion } from "../../lib/use-pillar-suggestion";
import type { Pillar5Response, CommChannel } from "@wavex-os/plugin-onboarding";
import { wavexOsOnboardingApi, ApiError } from "../../lib/api";
import { ResponseChips } from "../ResponseChips";
import { COMM_CHANNELS } from "../../lib/options";

const COMM_OPTS = COMM_CHANNELS.filter((o) => o.v !== "other").map((o) => ({ value: o.v, label: o.l }));

interface Props {
  companyId: string;
  onDone: (response: Pillar5Response) => void;
}

export function Pillar5PromptCard({ companyId, onDone }: Props) {
  const [commCanon, setCommCanon] = useState<string[]>([]);
  const [commCustom, setCommCustom] = useState<string[]>([]);
  const [tgBotToken, setTgBotToken] = useState("");
  const [tgChatId, setTgChatId] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<{ ok: boolean; detail: string } | null>(null);

  // Inference-grounded suggestion for comm_channel,
  // based on Pillar 1/3/4 context. Auto-preselects when Claude has a
  // confident pick; operator can override freely.
  // NO AUTO-SELECT. The suggestion is SHOWN — sparkle outline, reasoning line —
  // and the operator clicks it.
  //
  // Preselecting made `ready` true with zero interaction, so one click on
  // Continue persisted a model's guess as the operator's stated answer, and
  // nothing recorded whether a chip was ever touched. Every downstream
  // consumer then read it as `operator-claimed`: the placement rung, the
  // capability graph, the claim ledger, the contradiction detector. One click
  // is the entire difference between a claim and a guess, and it is worth it.
  const suggestion = usePillarSuggestion(5, companyId);
  const suggestedComm = typeof suggestion.recommended.comm_channel === "string"
    ? (suggestion.recommended.comm_channel as string)
    : null;

  async function handleTestSend(): Promise<void> {
    if (!tgBotToken || !tgChatId) return;
    setTesting(true);
    setTestResult(null);
    try {
      const r = await wavexOsOnboardingApi.pillar5TestSend({
        companyId,
        channel: "telegram",
        config: { telegram_bot_token: tgBotToken, telegram_chat_id: tgChatId },
      });
      setTestResult({ ok: r.ok, detail: r.detail });
    } catch (e) {
      setTestResult({ ok: false, detail: e instanceof Error ? e.message : String(e) });
    } finally {
      setTesting(false);
    }
  }

  const commValue = commCustom[0] ?? commCanon[0] ?? "";
  const commIsCustom = commCustom.length > 0;
  const isTelegram = commValue === "telegram";

  const telegramReady = !isTelegram || (!!tgBotToken && !!tgChatId);
  const ready = !!commValue && telegramReady;

  async function handleSubmit(): Promise<void> {
    if (!ready) return;
    setSubmitting(true);
    setError(null);
    try {
      const board_endpoint_config: Record<string, string> = isTelegram
        ? { telegram_bot_token: tgBotToken, telegram_chat_id: tgChatId }
        : {};

      const result = await wavexOsOnboardingApi.pillar5({
        companyId,
        comm_channel: (commIsCustom ? "other" : commValue) as CommChannel,
        comm_channel_other: commIsCustom ? commValue : undefined,
        board_endpoint_config: Object.keys(board_endpoint_config).length > 0 ? board_endpoint_config : undefined,
      });
      onDone(result.response);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : (e as Error).message);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div style={{ marginTop: "0.5rem", display: "flex", flexDirection: "column", gap: "0.8rem" }}>
      {suggestion.loaded && suggestion.reasoning && (
        <div style={{
          padding: "0.4rem 0.6rem",
          background: "var(--bg)",
          border: "1px dashed var(--accent)",
          borderRadius: 6,
          fontSize: 11,
          color: "var(--text-dim)",
          lineHeight: 1.45,
        }}>
          <span style={{ color: "var(--accent)", fontWeight: 600 }}>✨ Suggested for you</span>
          {" — "}{suggestion.reasoning}
        </div>
      )}

      <div>
        <div style={{ fontSize: 11, fontWeight: 600, marginBottom: "0.35rem", color: "var(--text-dim)" }}>
          Where should your board talk to you?
        </div>
        <ResponseChips
          mode="single"
          options={COMM_OPTS}
          values={commCanon}
          customValues={commCustom}
          allowCustom
          customLabel="Other channel"
          onChange={setCommCanon}
          onCustomChange={setCommCustom}
          disabled={submitting}
          suggestedValues={suggestedComm ? [suggestedComm as typeof COMM_OPTS[number]["value"]] : []}
        />
      </div>

      {isTelegram && (
        <div style={{ display: "flex", flexDirection: "column", gap: "0.4rem" }}>
          <div style={{ fontSize: 11, fontWeight: 600, color: "var(--text-dim)" }}>
            Telegram credentials
          </div>
          <input
            type="password"
            placeholder="Bot token"
            value={tgBotToken}
            onChange={(e) => setTgBotToken(e.target.value)}
            disabled={submitting}
            style={inputStyle}
          />
          <input
            type="text"
            placeholder="Chat ID"
            value={tgChatId}
            onChange={(e) => setTgChatId(e.target.value)}
            disabled={submitting}
            style={inputStyle}
          />
          <div style={{ display: "flex", gap: "0.4rem", alignItems: "center" }}>
            <button
              type="button"
              onClick={() => void handleTestSend()}
              disabled={submitting || testing || !tgBotToken || !tgChatId}
              style={{
                padding: "0.3rem 0.65rem",
                borderRadius: 4,
                background: "transparent",
                color: "var(--text-dim)",
                border: "1px solid var(--border)",
                fontSize: 11,
                cursor: testing || !tgBotToken || !tgChatId ? "not-allowed" : "pointer",
              }}
            >
              {testing ? "Sending…" : "Send test message"}
            </button>
            {testResult && (
              <span style={{ fontSize: 11, color: testResult.ok ? "var(--accent)" : "var(--warning)" }}>
                {testResult.ok ? "✓" : "✗"} {testResult.detail}
              </span>
            )}
          </div>
          <div className="text-dim" style={{ fontSize: 10 }}>
            Vaulted locally — never sent off your machine in dev.
          </div>
        </div>
      )}


      {error && (
        <div style={{ color: "var(--warning)", fontSize: 12 }}>✗ {error}</div>
      )}

      <div style={{ display: "flex", justifyContent: "flex-end" }}>
        <button
          type="button"
          data-testid="pillar5-submit"
          onClick={() => void handleSubmit()}
          disabled={submitting || !ready}
          style={{
            padding: "0.4rem 0.85rem",
            borderRadius: 6,
            background: "var(--accent)",
            color: "var(--bg)",
            border: "none",
            fontWeight: 600,
            fontSize: 12,
            cursor: submitting || !ready ? "not-allowed" : "pointer",
            opacity: submitting || !ready ? 0.6 : 1,
          }}
        >
          {submitting ? "Saving…" : "Continue →"}
        </button>
      </div>
    </div>
  );
}

const inputStyle = {
  padding: "0.5rem 0.7rem",
  borderRadius: 6,
  border: "1px solid var(--border)",
  background: "var(--bg)",
  color: "var(--text)",
  fontSize: 13,
  fontFamily: "inherit",
  outline: "none",
};
