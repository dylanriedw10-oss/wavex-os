/** Referral Email B — T+24h nudge cron job (WAVAAAA-106)
 *
 *  Runs hourly. Finds users who:
 *    - dismissed the referral modal ≥24h ago
 *    - have never received Email B
 *  Renders Email B template (copy from WAVAAAA-105), sends via Resend API,
 *  then marks referral_email_b_sent_at to prevent re-sends.
 *
 *  Required env vars:
 *    WAVEX_EMAIL_API_KEY   — Resend API key (re:...) — if absent, logs only
 *    WAVEX_EMAIL_FROM      — sender address, e.g. "Tony Apple QA <noreply@tonyappleqa.com>"
 *    WAVEX_APP_URL         — base URL for referral links, e.g. "https://app.tonyappleqa.com" */

import { and, isNotNull, isNull, lt } from "drizzle-orm";
import { eq } from "drizzle-orm";
import { getDb, runMigrations, users } from "@wavex-os/db";

// ─── template (Email B copy from WAVAAAA-105) ──────────────────────────────

const PRODUCT_NAME = "Tony Apple QA";

const EMAIL_B_SUBJECT = `Your ${PRODUCT_NAME} referral link is still waiting`;

function emailBTextBody(referralLink: string): string {
  return `Hi,

You closed the referral panel earlier — no worries. Your personal link is still here whenever you're ready:

  ${referralLink}

Each person who signs up through your link strengthens your team's presence on ${PRODUCT_NAME}. Takes 10 seconds to share.

— The ${PRODUCT_NAME} team

---
You're receiving this because you're a ${PRODUCT_NAME} user.
Manage your notification preferences in your account settings.`;
}

function emailBHtmlBody(referralLink: string): string {
  return `<p>Hi,</p>
<p>You closed the referral panel earlier — no worries. Your personal link is still here whenever you're ready:</p>
<p style="text-align:center;margin:24px 0">
  <a href="${referralLink}" style="background:#000;color:#fff;padding:12px 24px;border-radius:6px;text-decoration:none;font-weight:600">Share my link</a>
</p>
<p>Each person who signs up through your link strengthens your team's presence on ${PRODUCT_NAME}. Takes 10 seconds to share.</p>
<p>— The ${PRODUCT_NAME} team</p>
<hr>
<p style="font-size:12px;color:#666">You're receiving this because you're a ${PRODUCT_NAME} user. Manage your notification preferences in your account settings.</p>`;
}

// ─── Resend email provider ─────────────────────────────────────────────────

interface EligibleUser {
  id: string;
  email: string | null;
  referralCode: string | null;
}

async function sendReferralEmailB(user: EligibleUser): Promise<{ sent: boolean }> {
  const apiKey = process.env.WAVEX_EMAIL_API_KEY;
  const fromAddress = process.env.WAVEX_EMAIL_FROM ?? `${PRODUCT_NAME} <noreply@tonyappleqa.com>`;
  const appUrl = (process.env.WAVEX_APP_URL ?? "https://app.tonyappleqa.com").replace(/\/$/, "");

  if (!user.email) {
    console.warn(`[referral-email-b] skipping user=${user.id}: no email on record`);
    return { sent: false };
  }

  const referralLink = user.referralCode
    ? `${appUrl}/signup?ref=${encodeURIComponent(user.referralCode)}`
    : appUrl;

  if (!apiKey) {
    console.warn(
      `[referral-email-b] WAVEX_EMAIL_API_KEY not set — would send Email B to ${user.email}; skipping`
    );
    return { sent: false };
  }

  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from: fromAddress,
      to: [user.email],
      subject: EMAIL_B_SUBJECT,
      text: emailBTextBody(referralLink),
      html: emailBHtmlBody(referralLink),
    }),
  });

  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    console.error(`[referral-email-b] Resend error for user=${user.id}: ${res.status} ${detail}`);
    return { sent: false };
  }

  console.log(`[referral-email-b] sent Email B to user=${user.id} (${user.email})`);
  return { sent: true };
}

// ─── migrations guard ──────────────────────────────────────────────────────

let migrationsRun = false;
async function ensureMigrations(): Promise<void> {
  if (migrationsRun) return;
  await runMigrations();
  migrationsRun = true;
}

// ─── job ───────────────────────────────────────────────────────────────────

const BATCH_LIMIT = 100;
const WINDOW_HOURS = 24;

export async function runReferralEmailBJob(): Promise<{
  checked: number;
  sent: number;
  skipped: number;
}> {
  await ensureMigrations();
  const db = await getDb();

  const cutoff = new Date(Date.now() - WINDOW_HOURS * 3_600_000);

  const eligible = await db
    .select({
      id: users.id,
      email: users.email,
      referralCode: users.referralCode,
    })
    .from(users)
    .where(
      and(
        isNotNull(users.referralModalDismissedAt),
        isNull(users.referralEmailBSentAt),
        lt(users.referralModalDismissedAt, cutoff),
      )
    )
    .limit(BATCH_LIMIT);

  let sent = 0;
  let skipped = 0;

  for (const user of eligible) {
    try {
      const result = await sendReferralEmailB(user);
      if (result.sent) {
        await db
          .update(users)
          .set({ referralEmailBSentAt: new Date(), updatedAt: new Date() })
          .where(eq(users.id, user.id));
        sent++;
      } else {
        skipped++;
      }
    } catch (err) {
      console.error(`[referral-email-b] error sending to user=${user.id}:`, err);
      skipped++;
    }
  }

  console.log(
    `[referral-email-b] checked=${eligible.length} sent=${sent} skipped=${skipped}`
  );
  return { checked: eligible.length, sent, skipped };
}

// ─── scheduler ─────────────────────────────────────────────────────────────

const HOUR_MS = 60 * 60 * 1000;
let schedulerHandle: ReturnType<typeof setInterval> | null = null;
let startupRun: Promise<void> = Promise.resolve();

/** Starts the hourly scheduler and returns its startup run so the caller can
 *  drain it on shutdown. The startup run opens the database and migrates it;
 *  left un-awaited it outlives the server that started it. */
export function startReferralEmailBScheduler(): Promise<void> {
  if (schedulerHandle) return startupRun;

  // Run once at startup (catches any backlog from the last hour window)
  startupRun = runReferralEmailBJob().then(
    () => undefined,
    (err) => console.error("[referral-email-b] initial run failed:", err),
  );

  schedulerHandle = setInterval(() => {
    void runReferralEmailBJob().catch((err) =>
      console.error("[referral-email-b] scheduled run failed:", err)
    );
  }, HOUR_MS);

  // Don't hold the process open just for this timer
  schedulerHandle.unref?.();

  console.log("[referral-email-b] hourly scheduler started");
  return startupRun;
}

export function stopReferralEmailBScheduler(): void {
  if (schedulerHandle) {
    clearInterval(schedulerHandle);
    schedulerHandle = null;
  }
}
