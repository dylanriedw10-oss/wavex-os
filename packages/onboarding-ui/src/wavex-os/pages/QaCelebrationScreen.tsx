/** QaCelebrationScreen — shown once after the user's first smoke test result.
 *
 *  On mount it:
 *    1. Calls PATCH /users/:id/complete-wizard to clear is_new_user.
 *    2. Emits a first_test_result wizard event with timestamp (ttv_hours).
 *
 *  Acceptance criteria (WAVAAAA-57):
 *    - Screen shown only once (is_new_user cleared on render; controller
 *      also guards with localStorage key "wavex:qa_celebration_shown").
 *    - Primary CTA navigates to results dashboard.
 *    - Secondary CTA opens integration settings.
 *    - is_new_user flag cleared on render. */

import { useEffect, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { userApi } from "../lib/api";

const CELEBRATION_LS_KEY = "wavex:qa_celebration_shown";

interface Props {
  userId: string;
  testStatus: "pass" | "fail" | "error";
  testsRun?: number;
  testsFailed?: number;
  onDismiss: () => void;
}

export function QaCelebrationScreen({ userId, testStatus, testsRun, testsFailed, onDismiss }: Props) {
  const navigate = useNavigate();
  const sideEffectRan = useRef(false);

  useEffect(() => {
    if (sideEffectRan.current) return;
    sideEffectRan.current = true;

    // 1. Clear is_new_user — idempotent on the server.
    userApi.completeWizard(userId).catch(() => {});

    // 2. Emit first_test_result telemetry for ttv_hours calculation.
    fetch("/api/wizard-events", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        userId,
        eventType: "first_test_result",
        status: testStatus,
        ts: new Date().toISOString(),
      }),
    }).catch(() => {});

    // Belt-and-suspenders: prevent double-show even if is_new_user is slow to propagate.
    localStorage.setItem(CELEBRATION_LS_KEY, "1");
  }, [userId, testStatus]);

  const passed = testStatus === "pass";
  const badgeColor = passed ? "var(--accent)" : "var(--warning)";
  const badgeBg = passed
    ? "color-mix(in srgb, var(--accent) 12%, transparent)"
    : "color-mix(in srgb, var(--warning) 12%, transparent)";

  function handleViewReport(): void {
    onDismiss();
    navigate("/");
  }

  function handleSlackSetup(): void {
    onDismiss();
    navigate("/build?step=notifications");
  }

  return (
    <>
      <style>{`
        @keyframes wavex-celebrate-fade {
          from { opacity: 0; transform: translateY(16px); }
          to   { opacity: 1; transform: translateY(0); }
        }
        .wavex-celebrate-enter {
          animation: wavex-celebrate-fade 400ms ease both;
        }
        .wavex-celebrate-enter-delay {
          animation: wavex-celebrate-fade 400ms ease 120ms both;
        }
        .wavex-celebrate-enter-delay2 {
          animation: wavex-celebrate-fade 400ms ease 240ms both;
        }
      `}</style>

      <div
        role="dialog"
        aria-modal="true"
        aria-label="First QA result ready"
        style={{
          position: "fixed",
          inset: 0,
          zIndex: 1100,
          background: "rgba(10,10,12,0.88)",
          backdropFilter: "blur(6px)",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          padding: "1.5rem",
        }}
      >
        <div
          className="wavex-celebrate-enter"
          style={{
            maxWidth: 480,
            width: "100%",
            background: "var(--surface)",
            border: "1px solid var(--border)",
            borderRadius: 12,
            padding: "2.5rem 2rem",
            textAlign: "center",
            boxShadow: "0 8px 40px rgba(0,0,0,0.6)",
          }}
        >
          {/* Heading */}
          <div style={{ fontSize: 28, marginBottom: "1.25rem", letterSpacing: "-0.02em" }}>
            Your first QA result is ready! 🎉
          </div>

          {/* Pass/fail badge */}
          <div className="wavex-celebrate-enter-delay" style={{ marginBottom: "1rem" }}>
            <span style={{
              display: "inline-block",
              padding: "0.3rem 0.9rem",
              borderRadius: 999,
              background: badgeBg,
              color: badgeColor,
              fontWeight: 700,
              fontSize: 13,
              border: `1px solid ${badgeColor}`,
              letterSpacing: "0.04em",
              textTransform: "uppercase",
            }}>
              {passed ? "✓ Passed" : "✗ Failed"}
            </span>
          </div>

          {/* Top-line summary */}
          <div className="wavex-celebrate-enter-delay" style={{ color: "var(--text-dim)", fontSize: 14, lineHeight: 1.6, marginBottom: "2rem" }}>
            {testsRun !== undefined
              ? `${testsRun} test${testsRun !== 1 ? "s" : ""} run · ${testsFailed ?? 0} failure${(testsFailed ?? 0) !== 1 ? "s" : ""}`
              : passed
                ? "All checks passed."
                : "One or more checks failed. Review the full report for details."}
          </div>

          {/* CTAs */}
          <div className="wavex-celebrate-enter-delay2" style={{ display: "flex", flexDirection: "column", gap: "0.75rem" }}>
            <button
              type="button"
              onClick={handleViewReport}
              style={{
                padding: "0.75rem 1.5rem",
                borderRadius: 8,
                background: "var(--accent)",
                color: "var(--bg)",
                border: "none",
                fontWeight: 700,
                fontSize: 15,
                cursor: "pointer",
                width: "100%",
              }}
            >
              View full report →
            </button>
            <button
              type="button"
              onClick={handleSlackSetup}
              style={{
                padding: "0.65rem 1.5rem",
                borderRadius: 8,
                background: "transparent",
                color: "var(--text-dim)",
                border: "1px solid var(--border)",
                fontSize: 14,
                cursor: "pointer",
                width: "100%",
              }}
            >
              Set up Slack notifications
            </button>
          </div>
        </div>
      </div>
    </>
  );
}
