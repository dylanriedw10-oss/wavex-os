/** Avatar dashboard — landed on after the 5-step Avatar onboarding
 *  finishes. Tabbed surface (Phase 2):
 *
 *  • Overview — profile, tools, voice, suggested + enabled automations
 *  • Inbox    — approval queue from gmail-triage runner
 *  • Audit    — Paperclip activity_log scoped to the avatar's mirror
 *
 *  The Avatar overlay is parallel to the Paperclip company dashboard at
 *  /<COMPANY>/dashboard — they share visual language but live on separate
 *  routes since the underlying data shapes are different. */

import { useEffect, useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { wavexOsOnboardingApi, ApiError } from "../wavex-os/lib/api";
import { humanizeBadge, humanizeAction, humanizeRunResult } from "../wavex-os/lib/humanize";
import { CoachmarkOverlay, type CoachmarkStep } from "../wavex-os/components/Coachmark";
import { useCoachmark } from "../wavex-os/lib/coachmarks";

interface Avatar {
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
}

const PROVIDER_LABELS: Record<string, string> = {
  gmail: "Gmail",
  google_calendar: "Google Calendar",
  slack: "Slack",
  notion: "Notion",
  linear: "Linear",
  github: "GitHub",
  twilio_sms: "Twilio SMS",
  hubspot: "HubSpot",
  outlook: "Outlook",
  microsoft_calendar: "Microsoft Calendar",
};

type Tab = "overview" | "inbox" | "memory" | "audit";

export function AvatarDashboard() {
  const { id } = useParams<{ id: string }>();
  const [avatar, setAvatar] = useState<Avatar | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>("overview");
  // Phase 7-B — first-run coachmark walkthrough. Dismissed via a
  // localStorage flag; once set, never shown again on this device.
  const tour = useCoachmark("coachmark-avatar-v1");
  const tourSteps: CoachmarkStep[] = useMemo(() => [
    {
      target: () => document.querySelector<HTMLElement>("[data-tour='avatar-inbox-tab']"),
      title: "Your approval inbox",
      body: "This is where I leave drafts for you. Approve, edit, or reject — every choice teaches me your style.",
      onEnter: () => setTab("inbox"),
    },
    {
      target: () => document.querySelector<HTMLElement>("[data-tour='avatar-run-menu']"),
      title: "Bring me up to date anytime",
      body: "Click 'Process now' to read fresh mail, review pending invites, or sweep Slack mentions. By default I run every 15 minutes on my own.",
      onEnter: () => setTab("inbox"),
    },
    {
      target: () => document.querySelector<HTMLElement>("[data-tour='avatar-autonomy-chip']"),
      title: "Trust me with more over time",
      body: "Right now I wait for your approval on every draft. When you're comfortable with the quality, click here to graduate me one level.",
      onEnter: () => setTab("inbox"),
    },
    {
      target: () => document.querySelector<HTMLElement>("[data-tour='avatar-memory-tab']"),
      title: "Patterns I learn from you",
      body: "When you approve and tweak drafts, I notice patterns and turn them into rules I apply to every future draft. Check this tab to see what I've picked up.",
      onEnter: () => setTab("memory"),
    },
    {
      target: () => document.querySelector<HTMLElement>("[data-tour='avatar-kill-switch']"),
      title: "Stop me anytime",
      body: "Pause any skill — Gmail, Slack, Calendar — with a single click. Nothing irreversible. Flip it back on when you're ready.",
      onEnter: () => setTab("inbox"),
    },
  ], []);

  useEffect(() => {
    if (!id) return;
    let alive = true;
    void (async () => {
      try {
        const r = await wavexOsOnboardingApi.getAvatar(id);
        if (alive) setAvatar(r);
      } catch (e) {
        if (alive) setError(e instanceof ApiError ? e.message : (e as Error).message);
      }
    })();
    return () => { alive = false; };
  }, [id]);

  if (error) {
    return (
      <Shell>
        <div style={{ padding: "2rem", maxWidth: 720, margin: "0 auto" }}>
          <h2 style={{ marginTop: 0 }}>Couldn't load avatar</h2>
          <p style={{ color: "var(--warning)" }}>{error}</p>
          <Link to="/build">← Back to onboarding</Link>
        </div>
      </Shell>
    );
  }

  if (!avatar || !avatar.profile) {
    return (
      <Shell>
        <div style={{ padding: "2rem", maxWidth: 720, margin: "0 auto", color: "var(--text-dim)" }}>
          Loading avatar…
        </div>
      </Shell>
    );
  }

  return (
    <Shell>
      <div style={{ maxWidth: 1080, margin: "0 auto", padding: "2rem 1.5rem", display: "flex", flexDirection: "column", gap: "1.25rem" }}>
        <Header avatar={avatar} />
        <Tabs tab={tab} setTab={setTab} />
        {tab === "overview" && <OverviewTab avatar={avatar} />}
        {tab === "inbox" && id && <InboxTab avatarId={id} />}
        {tab === "memory" && id && <MemoryTab avatarId={id} />}
        {tab === "audit" && id && <AuditTab avatarId={id} />}
        <div className="text-dim" style={{ fontSize: 11, textAlign: "center", marginTop: "1rem" }}>
          avatar <code>{avatar.avatarId}</code>
        </div>
      </div>
      {!tour.dismissed && (
        <CoachmarkOverlay steps={tourSteps} onDone={tour.dismiss} />
      )}
    </Shell>
  );
}

// ── Header ──────────────────────────────────────────────────────────────

function Header({ avatar }: { avatar: Avatar }) {
  return (
    <header style={{
      padding: "1rem 1.25rem",
      background: "var(--surface)",
      border: "1px solid var(--border)",
      borderRadius: 10,
      display: "flex", alignItems: "center", justifyContent: "space-between", gap: "1rem",
    }}>
      <div>
        <div style={{ fontSize: 11, textTransform: "uppercase", letterSpacing: "0.1em", color: "var(--text-dim)", marginBottom: 4 }}>
          Your avatar
        </div>
        <div style={{ fontSize: 22, fontWeight: 700, color: "var(--text)" }}>
          {avatar.profile!.name}
        </div>
        <div className="text-dim" style={{ fontSize: 13, marginTop: 2 }}>
          {avatar.profile!.role}
          {" · "}
          <code>{avatar.profile!.working_hours[0]}–{avatar.profile!.working_hours[1]}</code>
          {" · "}
          {avatar.profile!.tz}
        </div>
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
        <Link
          to={`/avatar/${avatar.avatarId}/settings`}
          title="Settings"
          aria-label="Avatar settings"
          style={{
            padding: "0.4rem 0.6rem", borderRadius: 6, border: "1px solid var(--border)",
            color: "var(--text-dim)", textDecoration: "none", fontSize: 14,
            display: "inline-flex", alignItems: "center", justifyContent: "center",
          }}
        >
          ⚙
        </Link>
        <Link to="/" style={{
          padding: "0.4rem 0.8rem", borderRadius: 6, border: "1px solid var(--border)",
          color: "var(--text-dim)", textDecoration: "none", fontSize: 12,
        }}>
          Mission Control →
        </Link>
      </div>
    </header>
  );
}

// ── Tabs ────────────────────────────────────────────────────────────────

function Tabs({ tab, setTab }: { tab: Tab; setTab: (t: Tab) => void }) {
  const TABS: Array<{ id: Tab; label: string }> = [
    { id: "overview", label: "Overview" },
    { id: "inbox", label: "Approval inbox" },
    { id: "memory", label: "What it's learned" },
    { id: "audit", label: "Audit log" },
  ];
  return (
    <div style={{ display: "flex", gap: "0.25rem", borderBottom: "1px solid var(--border)" }}>
      {TABS.map((t) => (
        <button
          key={t.id}
          type="button"
          onClick={() => setTab(t.id)}
          data-tour={t.id === "inbox" ? "avatar-inbox-tab" : t.id === "memory" ? "avatar-memory-tab" : undefined}
          style={{
            padding: "0.55rem 0.9rem",
            background: "transparent",
            border: "none",
            borderBottom: tab === t.id ? "2px solid var(--accent)" : "2px solid transparent",
            color: tab === t.id ? "var(--text)" : "var(--text-dim)",
            fontSize: 13,
            fontWeight: tab === t.id ? 600 : 400,
            cursor: "pointer",
            marginBottom: -1,
          }}
        >
          {t.label}
        </button>
      ))}
    </div>
  );
}

// ── Overview ────────────────────────────────────────────────────────────

function OverviewTab({ avatar }: { avatar: Avatar }) {
  const enabled = (avatar.automations?.enabled ?? []);
  const suggested = (avatar.automations?.suggested ?? []);
  const enabledAutomations = suggested.filter((s) => enabled.includes(s.id));
  const remainingSuggestions = suggested.filter((s) => !enabled.includes(s.id));

  return (
    <>
      <div style={{ display: "grid", gap: "1rem", gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))" }}>
        <section style={card}>
          <SectionTitle>Connected tools ({avatar.tools.length})</SectionTitle>
          {avatar.tools.length === 0 && (
            <p className="text-dim" style={{ margin: 0, fontSize: 12 }}>
              No tools connected yet. <Link to="/build">Wire some.</Link>
            </p>
          )}
          <ul style={{ listStyle: "none", padding: 0, margin: 0, display: "grid", gap: 6 }}>
            {avatar.tools.map((t) => (
              <li key={t.provider} style={toolRow}>
                <span>{PROVIDER_LABELS[t.provider] ?? t.provider}</span>
                <span style={statusBadge(t.status === "stub" ? "warning" : "accent")}>
                  {t.status}
                </span>
              </li>
            ))}
          </ul>
        </section>

        <section style={card}>
          <SectionTitle>Voice profile</SectionTitle>
          {avatar.voice?.profile ? (
            <div style={{ display: "grid", gridTemplateColumns: "auto 1fr", columnGap: "0.85rem", rowGap: "0.35rem", fontSize: 12 }}>
              <Label>Tone</Label><Value>{avatar.voice.profile.tone}</Value>
              <Label>Formality</Label><Value>{avatar.voice.profile.formality}</Value>
              <Label>Structure</Label><Value>{avatar.voice.profile.structure}</Value>
              <Label>Delegates</Label><Value>{avatar.voice.profile.delegates.join(", ")}</Value>
              {avatar.voice.source === "stub" && (
                <>
                  <span></span>
                  <span style={{ fontSize: 10, color: "var(--warning)", marginTop: 4 }}>
                    Stub profile — re-run with real T2 to personalize.
                  </span>
                </>
              )}
            </div>
          ) : (
            <p className="text-dim" style={{ margin: 0, fontSize: 12 }}>Voice profile not yet built.</p>
          )}
        </section>

        <section style={card}>
          <SectionTitle>Active automations ({enabledAutomations.length})</SectionTitle>
          {enabledAutomations.length === 0 && (
            <p className="text-dim" style={{ margin: 0, fontSize: 12 }}>
              No automations enabled. Add some from the suggestions below.
            </p>
          )}
          <ul style={{ listStyle: "none", padding: 0, margin: 0, display: "grid", gap: 6 }}>
            {enabledAutomations.map((a) => (
              <li key={a.id} style={{
                padding: "0.5rem 0.65rem",
                background: "var(--bg)",
                border: "1px solid color-mix(in srgb, var(--accent) 35%, transparent)",
                borderRadius: 6, fontSize: 12,
              }}>
                <div style={{ fontWeight: 700 }}>{a.title}</div>
                <div className="text-dim" style={{ fontSize: 11, marginTop: 2 }}>{a.body}</div>
              </li>
            ))}
          </ul>
        </section>
      </div>

      {remainingSuggestions.length > 0 && (
        <section style={card}>
          <SectionTitle>More you can enable</SectionTitle>
          <ul style={{ listStyle: "none", padding: 0, margin: 0, display: "grid", gap: 6 }}>
            {remainingSuggestions.map((s) => (
              <li key={s.id} style={{
                padding: "0.5rem 0.65rem",
                background: "var(--bg)", border: "1px solid var(--border)", borderRadius: 6, fontSize: 12,
              }}>
                <div style={{ fontWeight: 700 }}>{s.title}</div>
                <div className="text-dim" style={{ fontSize: 11, marginTop: 2 }}>{s.body}</div>
              </li>
            ))}
          </ul>
        </section>
      )}
    </>
  );
}

// ── Approval inbox ─────────────────────────────────────────────────────

function InboxTab({ avatarId }: { avatarId: string }) {
  const [filter, setFilter] = useState<"pending" | "approved" | "rejected">("pending");
  const [approvals, setApprovals] = useState<Awaited<ReturnType<typeof wavexOsOnboardingApi.listAvatarApprovals>>["approvals"]>([]);
  const [loading, setLoading] = useState(true);
  const [running, setRunning] = useState(false);
  const [runMessage, setRunMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [skills, setSkills] = useState<Awaited<ReturnType<typeof wavexOsOnboardingApi.listAvatarSkills>>["skills"]>([]);
  const [skillBusy, setSkillBusy] = useState<string | null>(null);
  // Phase 3 — autonomy preset + graduate button
  const [preset, setPreset] = useState<"cautious" | "balanced" | "aggressive" | null>(null);
  const [graduating, setGraduating] = useState(false);

  const refresh = async () => {
    try {
      const r = await wavexOsOnboardingApi.listAvatarApprovals(avatarId, filter);
      setApprovals(r.approvals);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : (e as Error).message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    setLoading(true);
    void refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [avatarId, filter]);

  const refreshSkills = async () => {
    try {
      const r = await wavexOsOnboardingApi.listAvatarSkills(avatarId);
      setSkills(r.skills);
    } catch { /* non-fatal: avatar may not be bridged yet */ }
  };

  useEffect(() => { void refreshSkills(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [avatarId]);

  const refreshTrust = async () => {
    try {
      const r = await wavexOsOnboardingApi.getAvatarTrust(avatarId);
      setPreset(r.trust?.autonomy_preset ?? null);
    } catch { /* non-fatal */ }
  };

  useEffect(() => { void refreshTrust(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [avatarId]);

  async function graduate() {
    setGraduating(true);
    try {
      const r = await wavexOsOnboardingApi.graduateAvatar(avatarId);
      setPreset(r.trust.autonomy_preset);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : (e as Error).message);
    } finally {
      setGraduating(false);
    }
  }

  async function toggleSkill(skill: string, currentStatus: string | null) {
    setSkillBusy(skill);
    try {
      const action = currentStatus === "paused" ? "resume" : "pause";
      await wavexOsOnboardingApi.controlAvatarSkill(avatarId, skill, action);
      await refreshSkills();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : (e as Error).message);
    } finally {
      setSkillBusy(null);
    }
  }

  // Daily-style metrics (lightweight derivation from current set)
  const metrics = useMemo(() => {
    const drafts = approvals.length;
    const approved = approvals.filter((a) => a.status === "approved").length;
    const decided = approvals.filter((a) => a.status !== "pending").length;
    return {
      drafts,
      approved,
      approveRate: decided > 0 ? Math.round((approved / decided) * 100) : null,
      timeSavedMin: Math.round((approved * 90) / 60), // ~90 sec / approved email
    };
  }, [approvals]);

  /** Phase 6 — per-runner trigger. Skill id matches the paperclip-handoff
   *  agent key: gmail / outlook → mail-triage, google_calendar /
   *  microsoft_calendar → calendar-triage, slack → slack-digest. */
  async function triggerRun(skill: string) {
    setRunning(true);
    setRunMessage(null);
    setError(null);
    try {
      if (skill === "gmail" || skill === "outlook") {
        const r = await wavexOsOnboardingApi.runAvatarMailTriage(avatarId, skill);
        setRunMessage(humanizeRunResult(skill, r.result));
      } else if (skill === "google_calendar" || skill === "microsoft_calendar") {
        const r = await wavexOsOnboardingApi.runAvatarCalendarTriage(avatarId, skill);
        setRunMessage(humanizeRunResult(skill, r.result));
      } else if (skill === "slack") {
        const r = await wavexOsOnboardingApi.runAvatarSlackDigest(avatarId);
        setRunMessage(humanizeRunResult(skill, r.result));
      } else {
        setRunMessage(`I haven't been taught to run "${skill}" yet.`);
      }
      await refresh();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : (e as Error).message);
    } finally {
      setRunning(false);
    }
  }

  return (
    <>
      <section style={{ ...card, padding: "0.85rem 1rem" }}>
        <div style={{ display: "flex", alignItems: "center", gap: "1rem", flexWrap: "wrap" }}>
          <MetricChip label="Drafts" value={metrics.drafts.toString()} />
          <MetricChip label="Approved" value={metrics.approved.toString()} />
          <MetricChip label="Approve rate" value={metrics.approveRate != null ? `${metrics.approveRate}%` : "—"} />
          <MetricChip label="~Time saved" value={`${metrics.timeSavedMin}m`} />
          <div style={{ flex: 1 }} />
          {preset && (
            <button
              type="button"
              data-tour="avatar-autonomy-chip"
              onClick={() => void graduate()}
              disabled={graduating || preset === "aggressive"}
              title={
                preset === "cautious"
                  ? "Right now I wait for your approval on every draft. Click to let me handle obvious FYI mail on my own."
                  : preset === "balanced"
                    ? "Right now I clear obvious FYI on my own. Click to let me send confident replies on your behalf too."
                    : "Maxed out — I send confident replies on my own; you still review anything I'm unsure about."
              }
              style={{
                padding: "0.35rem 0.7rem",
                borderRadius: 999,
                border: `1px solid ${preset === "aggressive" ? "var(--accent)" : "var(--border)"}`,
                background: preset === "aggressive" ? "color-mix(in srgb, var(--accent) 14%, transparent)" : "transparent",
                color: preset === "aggressive" ? "var(--accent)" : "var(--text-dim)",
                fontSize: 11, fontWeight: 600, cursor: graduating || preset === "aggressive" ? "default" : "pointer",
              }}
            >
              {graduating
                ? "Trusting more…"
                : preset === "cautious"
                  ? "I wait for your approval — trust me with more?"
                  : preset === "balanced"
                    ? "I clear FYI on my own — trust me with more?"
                    : "I send confident replies — fully trusted"}
            </button>
          )}
          <div data-tour="avatar-run-menu">
            <RunMenu skills={skills} disabled={running} onRun={(skill) => void triggerRun(skill)} />
          </div>
          {running && <span style={{ fontSize: 11, color: "var(--text-dim)" }}>Running…</span>}
        </div>
        {runMessage && <div style={{ fontSize: 11, color: "var(--text-dim)", marginTop: "0.6rem" }}>{runMessage}</div>}
      </section>

      {skills.length > 0 && (
        <section data-tour="avatar-kill-switch" style={{ ...card, padding: "0.7rem 1rem" }}>
          <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", flexWrap: "wrap" }}>
            <span style={{ fontSize: 10, textTransform: "uppercase", letterSpacing: "0.08em", color: "var(--text-dim)", marginRight: "0.5rem" }}>
              Skills
            </span>
            {skills.map((s) => {
              const paused = s.status === "paused";
              return (
                <button
                  key={s.skill}
                  type="button"
                  onClick={() => void toggleSkill(s.skill, s.status)}
                  disabled={skillBusy === s.skill}
                  title={`agent ${s.agentId} · status ${s.status ?? "unknown"}`}
                  style={{
                    padding: "0.25rem 0.65rem",
                    borderRadius: 999, fontSize: 11,
                    border: `1px solid ${paused ? "var(--warning)" : "var(--border)"}`,
                    background: paused ? "color-mix(in srgb, var(--warning) 14%, transparent)" : "transparent",
                    color: paused ? "var(--warning)" : "var(--text-dim)",
                    cursor: skillBusy === s.skill ? "wait" : "pointer",
                    fontWeight: paused ? 600 : 400,
                  }}
                >
                  {paused ? "▶ resume" : "■ pause"} {PROVIDER_LABELS[s.skill] ?? s.skill}
                </button>
              );
            })}
          </div>
        </section>
      )}

      <div style={{ display: "flex", gap: "0.4rem" }}>
        {(["pending", "approved", "rejected"] as const).map((f) => (
          <button
            key={f}
            type="button"
            onClick={() => setFilter(f)}
            style={{
              padding: "0.3rem 0.7rem",
              borderRadius: 999, fontSize: 11,
              border: `1px solid ${filter === f ? "var(--accent)" : "var(--border)"}`,
              background: filter === f ? "var(--accent)" : "transparent",
              color: filter === f ? "var(--bg)" : "var(--text-dim)",
              cursor: "pointer", fontWeight: filter === f ? 600 : 400,
            }}
          >
            {f}
          </button>
        ))}
      </div>

      {error && <div style={{ color: "var(--warning)", fontSize: 12 }}>✗ {error}</div>}
      {loading && <div className="text-dim" style={{ fontSize: 12 }}>Loading…</div>}
      {!loading && approvals.length === 0 && (
        <div style={{ ...card, color: "var(--text-dim)", fontSize: 13, textAlign: "center", padding: "2rem" }}>
          {filter === "pending"
            ? "Nothing in the inbox. Click \"Run triage now\" to generate sample drafts."
            : `No ${filter} approvals yet.`}
        </div>
      )}
      {approvals.map((apv) => (
        <ApprovalCard
          key={apv.id}
          avatarId={avatarId}
          approval={apv}
          onDecided={() => void refresh()}
        />
      ))}
    </>
  );
}

function ApprovalCard({
  avatarId, approval, onDecided,
}: {
  avatarId: string;
  approval: Awaited<ReturnType<typeof wavexOsOnboardingApi.listAvatarApprovals>>["approvals"][number];
  onDecided: () => void;
}) {
  const [draft, setDraft] = useState(approval.payload.draftText ?? "");
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function decide(decision: "approve" | "reject") {
    setBusy(true);
    setError(null);
    try {
      const dirty = editing && draft !== (approval.payload.draftText ?? "");
      await wavexOsOnboardingApi.decideAvatarApproval(avatarId, approval.id, {
        decision,
        editedPayload: dirty ? { draftText: draft } : undefined,
      });
      onDecided();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : (e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  // Phase 6 — derive the provider from the namespaced approval type
  // (avatar.<provider>.<kind>). Drives the provider chip + the variant
  // rendering (mail draft / calendar invite / slack mention).
  const parts = approval.type.split(".");
  const provider = parts[1] ?? "unknown";
  const kind = parts[2] ?? "";
  const providerLabel = PROVIDER_LABELS[provider] ?? provider;

  const cls = approval.payload.classification;
  const importance = approval.payload.importance;
  const suggested = approval.payload.suggested;
  // Tag chip color: mail uses classification (now/soon/fyi); calendar uses
  // suggested response; slack uses importance.
  const tag = (cls ?? importance ?? suggested ?? "").toString();
  const tagColor =
    tag === "now" || tag === "urgent" || tag === "accept" ? "var(--accent)"
    : tag === "soon" || tag === "info" || tag === "propose-time" ? "var(--warning)"
    : tag === "decline" ? "var(--warning)"
    : "var(--text-dim)";

  return (
    <div style={{
      ...card,
      borderLeft: `3px solid ${tagColor}`,
      opacity: approval.status !== "pending" ? 0.65 : 1,
    }}>
      <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", marginBottom: "0.5rem", flexWrap: "wrap" }}>
        {tag && (
          <span style={{
            padding: "0.1rem 0.5rem", fontSize: 10, fontWeight: 700, letterSpacing: "0.04em",
            color: tagColor, border: `1px solid ${tagColor}`, borderRadius: 999,
          }}>
            {humanizeBadge(kind, tag)}
          </span>
        )}
        <span style={{
          padding: "0.1rem 0.45rem", fontSize: 10, fontWeight: 600,
          color: "var(--text-dim)", border: "1px solid var(--border)", borderRadius: 999,
        }}>
          {providerLabel}
        </span>
        <span style={{ fontSize: 13, fontWeight: 700 }}>
          {approval.payload.subject ?? approval.payload.summary ?? approval.payload.channel ?? "(no subject)"}
        </span>
        <span className="text-dim" style={{ fontSize: 11 }}>
          {kind === "invite_response"
            ? `${approval.payload.organizer?.name ?? "?"} · ${new Date(approval.payload.start ?? Date.now()).toLocaleString()}`
            : kind === "mention_digest"
              ? `${approval.payload.author?.name ?? "?"} in ${approval.payload.channel ?? "?"}`
              : `from ${approval.payload.from?.name ?? "?"}`}
          {typeof approval.payload.confidence === "number" && ` · conf ${(approval.payload.confidence * 100).toFixed(0)}%`}
        </span>
        {approval.status !== "pending" && (
          <span style={statusBadge(approval.status === "approved" ? "accent" : "warning")}>
            {approval.status}
          </span>
        )}
      </div>
      {/* Body preview: mail uses preview, slack uses text, calendar uses body */}
      {(approval.payload.preview || approval.payload.text || approval.payload.body) && (
        <div className="text-dim" style={{ fontSize: 11, marginBottom: "0.5rem", fontStyle: "italic" }}>
          "{(approval.payload.preview ?? approval.payload.text ?? approval.payload.body ?? "").slice(0, 200)}…"
        </div>
      )}
      {/* Calendar invite: show the suggested response details */}
      {kind === "invite_response" && approval.payload.draft_message && (
        <div style={{
          padding: "0.6rem 0.8rem", background: "var(--bg)",
          border: "1px solid var(--border)", borderRadius: 6,
          fontSize: 13, color: "var(--text)", whiteSpace: "pre-wrap",
          lineHeight: 1.55, marginBottom: "0.5rem",
        }}>
          {approval.payload.draft_message}
        </div>
      )}
      {/* Slack mention: deep-link CTA instead of an editable draft */}
      {kind === "mention_digest" && approval.payload.permalink && (
        <a
          href={approval.payload.permalink}
          target="_blank"
          rel="noopener noreferrer"
          style={{
            display: "inline-block", marginBottom: "0.5rem",
            padding: "0.35rem 0.7rem", borderRadius: 6,
            background: "transparent", border: "1px solid var(--border)",
            color: "var(--accent)", fontSize: 12, fontWeight: 600,
            textDecoration: "none",
          }}
        >
          View in Slack →
        </a>
      )}
      {/* Mail draft (existing behavior) */}
      {kind === "draft_reply" && approval.payload.draftText ? (
        editing ? (
          <textarea
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            rows={Math.min(10, Math.max(4, draft.split("\n").length))}
            style={{
              width: "100%", padding: "0.55rem 0.65rem",
              background: "var(--bg)", border: "1px solid var(--border)", borderRadius: 6,
              color: "var(--text)", fontSize: 13, fontFamily: "inherit", lineHeight: 1.55,
              outline: "none", resize: "vertical", marginBottom: "0.5rem",
            }}
          />
        ) : (
          <div style={{
            padding: "0.6rem 0.8rem", background: "var(--bg)",
            border: "1px solid var(--border)", borderRadius: 6,
            fontSize: 13, color: "var(--text)", whiteSpace: "pre-wrap",
            lineHeight: 1.55, marginBottom: "0.5rem",
          }}>
            {approval.editedPayload?.draftText ?? approval.payload.draftText}
          </div>
        )
      ) : (
        kind === "draft_reply" && (
          <div className="text-dim" style={{ fontSize: 11, fontStyle: "italic", marginBottom: "0.5rem" }}>
            No draft (FYI).
          </div>
        )
      )}
      <div className="text-dim" style={{ fontSize: 10, marginBottom: "0.6rem" }}>
        {approval.payload.reasoning}
      </div>
      {error && <div style={{ color: "var(--warning)", fontSize: 11, marginBottom: "0.4rem" }}>✗ {error}</div>}
      {approval.status === "pending" && (
        <div style={{ display: "flex", gap: "0.4rem", justifyContent: "flex-end" }}>
          {kind === "draft_reply" && approval.payload.draftText && !editing && (
            <button type="button" onClick={() => setEditing(true)} style={ghostBtn}>Edit</button>
          )}
          {editing && (
            <button type="button" onClick={() => { setDraft(approval.payload.draftText ?? ""); setEditing(false); }} style={ghostBtn}>Cancel edit</button>
          )}
          <button type="button" onClick={() => void decide("reject")} disabled={busy} style={ghostBtn}>Reject</button>
          <button
            type="button"
            onClick={() => void decide("approve")}
            disabled={busy}
            style={{
              padding: "0.35rem 0.85rem", borderRadius: 6, background: "var(--accent)",
              color: "var(--bg)", border: "none", fontWeight: 600, fontSize: 12,
              cursor: busy ? "wait" : "pointer", opacity: busy ? 0.6 : 1,
            }}
          >
            {editing ? "Approve edit" : "Approve"}
          </button>
        </div>
      )}
    </div>
  );
}

// ── Audit log ──────────────────────────────────────────────────────────

function AuditTab({ avatarId }: { avatarId: string }) {
  const [entries, setEntries] = useState<Awaited<ReturnType<typeof wavexOsOnboardingApi.getAvatarAudit>>["entries"]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    void (async () => {
      try {
        const r = await wavexOsOnboardingApi.getAvatarAudit(avatarId);
        if (alive) setEntries(r.entries);
      } catch (e) {
        if (alive) setError(e instanceof ApiError ? e.message : (e as Error).message);
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => { alive = false; };
  }, [avatarId]);

  if (loading) return <div className="text-dim" style={{ fontSize: 12 }}>Loading audit log…</div>;
  if (error) return <div style={{ color: "var(--warning)", fontSize: 12 }}>✗ {error}</div>;
  if (entries.length === 0) {
    return (
      <div style={{ ...card, color: "var(--text-dim)", fontSize: 13, textAlign: "center", padding: "2rem" }}>
        No activity yet. As the avatar runs, every action gets logged here.
      </div>
    );
  }

  return (
    <section style={{ ...card, padding: 0 }}>
      <ul style={{ listStyle: "none", padding: 0, margin: 0 }}>
        {entries.map((e) => (
          <li key={e.id} style={{
            padding: "0.6rem 1rem", borderBottom: "1px solid var(--border)",
            display: "grid", gridTemplateColumns: "auto 1fr auto", gap: "0.85rem", alignItems: "center",
            fontSize: 12,
          }}>
            <span style={{ color: "var(--text-dim)", fontFamily: "ui-monospace, SF Mono, monospace", fontSize: 10 }}>
              {new Date(e.createdAt).toLocaleString()}
            </span>
            <span style={{ color: "var(--text)" }} title={e.action}>
              {humanizeAction(e.action, e.details)}
              <span className="text-dim" style={{ fontSize: 10, marginLeft: "0.5rem" }}>
                {e.entityType}
              </span>
            </span>
            <span style={{ color: "var(--text-dim)", fontSize: 10, textTransform: "uppercase", letterSpacing: "0.05em" }}>
              {e.actorType === "user" ? "you" : e.actorType}
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}

// ── Memory tab ─────────────────────────────────────────────────────────

function MemoryTab({ avatarId }: { avatarId: string }) {
  const [preferences, setPreferences] = useState<Awaited<ReturnType<typeof wavexOsOnboardingApi.getAvatarMemory>>["preferences"]>([]);
  const [episodic, setEpisodic] = useState<Awaited<ReturnType<typeof wavexOsOnboardingApi.getAvatarMemory>>["episodic"]>([]);
  const [loading, setLoading] = useState(true);
  const [distilling, setDistilling] = useState(false);
  const [distillMsg, setDistillMsg] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = async () => {
    try {
      const r = await wavexOsOnboardingApi.getAvatarMemory(avatarId, 30);
      setPreferences(r.preferences);
      setEpisodic(r.episodic);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : (e as Error).message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { void load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [avatarId]);

  async function distill() {
    setDistilling(true);
    setDistillMsg(null);
    try {
      const r = await wavexOsOnboardingApi.distillAvatarMemory(avatarId);
      setDistillMsg(r.count > 0
        ? `Picked up ${r.count} new pattern${r.count === 1 ? "" : "s"}.`
        : "Nothing new yet — keep approving and tweaking; patterns will appear here.");
      await load();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : (e as Error).message);
    } finally {
      setDistilling(false);
    }
  }

  if (loading) return <div className="text-dim" style={{ fontSize: 12 }}>Loading memory…</div>;

  return (
    <>
      <section style={{ ...card, padding: "0.85rem 1rem" }}>
        <div style={{ display: "flex", alignItems: "center", gap: "0.85rem", flexWrap: "wrap" }}>
          <div style={{ fontSize: 13, fontWeight: 700, color: "var(--text)" }}>
            Patterns from your decisions
          </div>
          <span className="text-dim" style={{ fontSize: 11 }}>
            {preferences.length} rule{preferences.length === 1 ? "" : "s"} from you · {episodic.length} recent decision{episodic.length === 1 ? "" : "s"}
          </span>
          <div style={{ flex: 1 }} />
          <button
            type="button"
            onClick={() => void distill()}
            disabled={distilling}
            style={{
              padding: "0.4rem 0.85rem",
              borderRadius: 6, border: "1px solid var(--border)",
              background: "transparent", color: "var(--text)",
              fontSize: 12, cursor: distilling ? "wait" : "pointer",
            }}
          >
            {distilling ? "Looking…" : "Find new patterns"}
          </button>
        </div>
        {distillMsg && <div style={{ fontSize: 11, color: "var(--text-dim)", marginTop: "0.5rem" }}>{distillMsg}</div>}
        {error && <div style={{ color: "var(--warning)", fontSize: 11, marginTop: "0.4rem" }}>✗ {error}</div>}
      </section>

      <section style={card}>
        <SectionTitle>Rules from you</SectionTitle>
        {preferences.length === 0 ? (
          <p className="text-dim" style={{ margin: 0, fontSize: 12 }}>
            Once you approve and tweak a few drafts, your avatar starts noticing patterns. Click
            <em> Find new patterns</em> to scan recent activity and surface rules it will then
            apply to every future draft.
          </p>
        ) : (
          <ul style={{ listStyle: "none", padding: 0, margin: 0, display: "grid", gap: 6 }}>
            {preferences.map((p) => (
              <li key={p.id} style={{
                padding: "0.55rem 0.7rem", background: "var(--bg)",
                border: "1px solid color-mix(in srgb, var(--accent) 25%, transparent)",
                borderRadius: 6, fontSize: 12,
              }}>
                <div style={{ display: "flex", alignItems: "baseline", gap: "0.5rem", flexWrap: "wrap" }}>
                  <span style={{ fontWeight: 600, color: "var(--text)" }}>{p.rule}</span>
                  <span style={statusBadge("accent")}>{p.category}</span>
                  <span className="text-dim" style={{ fontSize: 10 }}>
                    conf {(p.confidence * 100).toFixed(0)}% · learned {new Date(p.learnedAt).toLocaleDateString()}
                  </span>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section style={{ ...card, padding: 0 }}>
        <div style={{ padding: "0.7rem 1rem", borderBottom: "1px solid var(--border)" }}>
          <SectionTitle>Your recent decisions</SectionTitle>
        </div>
        {episodic.length === 0 ? (
          <p className="text-dim" style={{ margin: 0, padding: "0.85rem 1rem", fontSize: 12 }}>
            Nothing yet — events appear as you approve, reject, or edit drafts.
          </p>
        ) : (
          <ul style={{ listStyle: "none", padding: 0, margin: 0 }}>
            {episodic.map((e) => (
              <li key={e.id} style={{
                padding: "0.55rem 1rem", borderBottom: "1px solid var(--border)",
                display: "grid", gridTemplateColumns: "auto 1fr auto", gap: "0.85rem", alignItems: "center",
                fontSize: 12,
              }}>
                <span style={{ color: "var(--text-dim)", fontFamily: "ui-monospace, SF Mono, monospace", fontSize: 10 }}>
                  {new Date(e.ts).toLocaleString()}
                </span>
                <span style={{ color: "var(--text)" }}>
                  <code style={{ color: "var(--accent)", marginRight: "0.5rem" }}>{e.kind}</code>
                  {e.kind === "edit" && e.edited?.after ? (
                    <span className="text-dim">
                      rewrote draft to <em style={{ color: "var(--text)" }}>"{e.edited.after.slice(0, 80)}{e.edited.after.length > 80 ? "…" : ""}"</em>
                    </span>
                  ) : (
                    <span className="text-dim">
                      {e.decision ?? "?"}{e.classification ? ` · ${e.classification}` : ""}{e.confidence != null ? ` · conf ${(e.confidence * 100).toFixed(0)}%` : ""}
                    </span>
                  )}
                </span>
                <span style={{ color: "var(--text-dim)", fontSize: 10 }}>
                  {e.approvalType ? e.approvalType.replace(/^avatar\./, "") : ""}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </>
  );
}

// ── Run menu (per-skill triage) ───────────────────────────────────────

function RunMenu({
  skills, disabled, onRun,
}: {
  skills: Array<{ skill: string; status: string | null }>;
  disabled: boolean;
  onRun: (skill: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const runnable = skills.filter((s) =>
    s.skill === "gmail" || s.skill === "outlook"
    || s.skill === "google_calendar" || s.skill === "microsoft_calendar"
    || s.skill === "slack",
  );
  if (runnable.length === 0) {
    return (
      <span className="text-dim" style={{ fontSize: 11 }}>
        No connected runners — wire a tool from onboarding.
      </span>
    );
  }
  return (
    <div style={{ position: "relative" }}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        disabled={disabled}
        style={{
          padding: "0.4rem 0.85rem",
          borderRadius: 6, border: "1px solid var(--border)",
          background: "transparent", color: "var(--text)",
          fontSize: 12, cursor: disabled ? "wait" : "pointer",
        }}
      >
        Process now ▾
      </button>
      {open && (
        <div
          style={{
            position: "absolute", top: "calc(100% + 4px)", right: 0,
            background: "var(--surface)", border: "1px solid var(--border)",
            borderRadius: 8, minWidth: 200, padding: "0.3rem", zIndex: 10,
            boxShadow: "0 8px 24px rgba(0,0,0,0.25)",
          }}
          onMouseLeave={() => setOpen(false)}
        >
          {runnable.map((s) => (
            <button
              key={s.skill}
              type="button"
              onClick={() => { setOpen(false); onRun(s.skill); }}
              style={{
                display: "block", width: "100%", textAlign: "left",
                padding: "0.4rem 0.6rem", background: "transparent",
                border: "none", color: "var(--text)", fontSize: 12,
                cursor: "pointer", borderRadius: 4,
              }}
              onMouseEnter={(e) => { e.currentTarget.style.background = "var(--bg)"; }}
              onMouseLeave={(e) => { e.currentTarget.style.background = "transparent"; }}
            >
              {PROVIDER_LABELS[s.skill] ?? s.skill}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Shared atoms ───────────────────────────────────────────────────────

function MetricChip({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-dim" style={{ fontSize: 10, textTransform: "uppercase", letterSpacing: "0.08em" }}>{label}</div>
      <div style={{ fontSize: 18, fontWeight: 700, color: "var(--text)" }}>{value}</div>
    </div>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ minHeight: "100vh", background: "var(--bg)" }}>
      {children}
    </div>
  );
}

function SectionTitle({ children }: { children: React.ReactNode }) {
  return (
    <h3 style={{
      margin: 0, marginBottom: "0.75rem", fontSize: 11, fontWeight: 700,
      textTransform: "uppercase", letterSpacing: "0.1em", color: "var(--text-dim)",
    }}>{children}</h3>
  );
}

function Label({ children }: { children: React.ReactNode }) {
  return <span style={{ fontWeight: 600, color: "var(--text-dim)" }}>{children}</span>;
}

function Value({ children }: { children: React.ReactNode }) {
  return <span style={{ color: "var(--text)" }}>{children}</span>;
}

function statusBadge(tone: "accent" | "warning"): React.CSSProperties {
  const color = tone === "accent" ? "var(--accent)" : "var(--warning)";
  return {
    fontSize: 10, padding: "0.1rem 0.45rem", borderRadius: 999,
    background: `color-mix(in srgb, ${color} 15%, transparent)`,
    color, fontWeight: 600, letterSpacing: "0.04em", textTransform: "uppercase",
  };
}

const card: React.CSSProperties = {
  padding: "1rem 1.25rem", background: "var(--surface)",
  border: "1px solid var(--border)", borderRadius: 10,
};

const toolRow: React.CSSProperties = {
  display: "flex", alignItems: "center", justifyContent: "space-between",
  padding: "0.45rem 0.6rem", background: "var(--bg)",
  border: "1px solid var(--border)", borderRadius: 6, fontSize: 12,
};

const ghostBtn: React.CSSProperties = {
  padding: "0.35rem 0.7rem", borderRadius: 6, background: "transparent",
  color: "var(--text-dim)", border: "1px solid var(--border)",
  fontSize: 12, cursor: "pointer",
};
