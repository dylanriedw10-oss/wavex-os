/** /signup?ref=blog-smoke-guide&utm_campaign=smoke-test-guide-may2026
 *
 *  Entry page linked from blog posts and campaigns. Renders the magic-link
 *  sign-in widget and, on successful auth, fires a signup_confirmed event to
 *  /api/auth-events which writes to wavex_os.auth_events and syncs the
 *  contact into the configured Resend audience for attribution tracking.
 *
 *  UTM params survive the magic-link redirect because emailRedirectTo is set
 *  to the current URL (including query string), so Supabase bounces the user
 *  back to the same /signup?... page after they click the link. */

import { useRef } from "react";
import { useSearchParams, useNavigate } from "react-router-dom";
import type { Session } from "@supabase/supabase-js";
import { SignInWidget } from "../components/SignInWidget";

const API_BASE = import.meta.env.VITE_API_URL ?? "";

async function fireAuthEvent(params: {
  userId: string;
  email: string | undefined;
  utmCampaign: string;
  utmSource: string;
  ref: string;
}): Promise<void> {
  try {
    await fetch(`${API_BASE}/api/auth-events`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        userId: params.userId,
        email: params.email,
        eventType: "signup_confirmed",
        utmCampaign: params.utmCampaign || undefined,
        utmSource: params.utmSource || undefined,
        ref: params.ref || undefined,
      }),
    });
  } catch {
    // Best-effort; don't block the user flow.
  }
}

export function Signup(): JSX.Element {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const eventFired = useRef(false);

  const utmCampaign = searchParams.get("utm_campaign") ?? "";
  const utmSource = searchParams.get("utm_source") ?? "";
  const ref = searchParams.get("ref") ?? "";

  // The magic-link email will redirect back to this exact URL so UTM params
  // survive the round-trip without needing localStorage.
  const redirectTo = `${window.location.origin}${window.location.pathname}${window.location.search}`;

  function handleSession(session: Session | null): void {
    if (!session || eventFired.current) return;
    eventFired.current = true;

    void fireAuthEvent({
      userId: session.user.id,
      email: session.user.email,
      utmCampaign,
      utmSource,
      ref,
    });

    // After attribution is captured, send the user to the onboarding flow.
    navigate("/build", { replace: true });
  }

  return (
    <div style={page}>
      <div style={container}>
        <div style={{ marginBottom: 32 }}>
          <h1 style={heading}>Get started with WaveX OS</h1>
          <p style={subheading}>
            Run your AI agent company on localhost — free, open-source, no account required to self-host.
          </p>
        </div>
        <SignInWidget onSessionChange={handleSession} redirectTo={redirectTo} />
        {ref && (
          <p style={refNote}>
            Arriving from: <code style={refCode}>{ref}</code>
          </p>
        )}
      </div>
    </div>
  );
}

// ─── styles ────────────────────────────────────────────────────────────────

const page: React.CSSProperties = {
  minHeight: "100vh",
  background: "#0a0a0a",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  padding: "40px 16px",
};

const container: React.CSSProperties = {
  width: "100%",
  maxWidth: 480,
};

const heading: React.CSSProperties = {
  color: "#e6e6e6",
  fontSize: 28,
  fontWeight: 700,
  fontFamily: "ui-sans-serif, system-ui",
  margin: 0,
  lineHeight: 1.2,
};

const subheading: React.CSSProperties = {
  color: "#8a8a92",
  fontSize: 16,
  fontFamily: "ui-sans-serif, system-ui",
  margin: "12px 0 0",
  lineHeight: 1.5,
};

const refNote: React.CSSProperties = {
  color: "#555",
  fontSize: 12,
  fontFamily: "ui-monospace, monospace",
  marginTop: 16,
};

const refCode: React.CSSProperties = {
  color: "#4ec9b0",
  background: "#0e1f1a",
  padding: "1px 6px",
  borderRadius: 4,
};
