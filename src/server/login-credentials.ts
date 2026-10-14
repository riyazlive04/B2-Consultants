import "server-only";
import { brandEmailHeader, getEmailRuntime, sendResendEmail } from "@/lib/email";
import { sendWhatsApp } from "./whatsapp";

/**
 * Telling someone their login exists - by email AND on WhatsApp.
 *
 * Until this, creating a student's portal login (or resetting anyone's password) ended in a toast
 * saying "share the password securely", and the sharing was left to whoever clicked: a personal
 * WhatsApp, a screenshot, or nothing. The person was never told where to sign in, or that the
 * portal is now where their updates live.
 *
 * ── THE PASSWORD IS SENT, NEVER STORED ───────────────────────────────────────────
 * It goes out in the email and the WhatsApp message and nowhere else: the WhatsApp row logs it
 * redacted (`secretVars`), the email is a direct Resend call with no stored body, and the
 * activity log records only which channels were used. It is temporary twice over - the account is
 * flagged `mustChangePassword`, so the first sign-in replaces it.
 *
 * ── BOTH CHANNELS ARE BEST-EFFORT, AND SAY SO ────────────────────────────────────
 * The login is already created when this runs; a failed email must not undo it. Each channel
 * reports what actually happened, and the caller shows that sentence to the admin - so "email
 * sent, WhatsApp skipped: no template bound yet" is visible, not discovered a week later.
 */

export type LoginAudience = "student" | "team";

const esc = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

function first(full: string): string {
  return (full || "").trim().split(/\s+/)[0] || "there";
}

/** What the portal is FOR, in one line - the "use it for all updates" the message exists to say. */
const PORTAL_PURPOSE: Record<LoginAudience, string> = {
  student:
    "From now on, all your updates are in the portal - your classes and progress, payments and receipts, " +
    "and your documents. Please sign in there to stay up to date.",
  team: "Use it for all your work in the B2 Consultants app from now on.",
};

function credentialsEmailHtml(o: {
  name: string;
  loginUrl: string;
  email: string;
  password: string;
  audience: LoginAudience;
  reset: boolean;
}): string {
  const opening = o.reset
    ? "Your password for the B2 Consultants portal has been reset."
    : "Your login for the B2 Consultants portal is ready.";
  return `<div style="font-family:Inter,Arial,sans-serif;font-size:14px;color:#16203A;line-height:1.6">
    ${brandEmailHeader()}
    <p>Hi ${esc(first(o.name))},</p>
    <p>${opening}</p>
    <table style="border-collapse:collapse;margin:12px 0">
      <tr><td style="padding:4px 16px 4px 0;color:#636F85">Sign in at</td><td><a href="${esc(o.loginUrl)}" style="color:#003C8C">${esc(o.loginUrl)}</a></td></tr>
      <tr><td style="padding:4px 16px 4px 0;color:#636F85">Login email</td><td><strong>${esc(o.email)}</strong></td></tr>
      <tr><td style="padding:4px 16px 4px 0;color:#636F85">Temporary password</td><td><strong style="font-family:monospace;font-size:15px">${esc(o.password)}</strong></td></tr>
    </table>
    <p>You will be asked to choose your own password the first time you sign in.</p>
    <p>${PORTAL_PURPOSE[o.audience]}</p>
    <p style="color:#636F85;font-size:12px">If you weren't expecting this, reply to this email and let us know.</p>
    <p>B2 Consultants</p>
  </div>`;
}

export async function sendLoginCredentials(o: {
  name: string;
  email: string;
  password: string;
  /** WhatsApp number. Team accounts have none, so they are told by email only. */
  phone?: string | null;
  studentId?: string | null;
  sentById: string;
  audience: LoginAudience;
  /** A reset of an existing login rather than a new one - changes the opening line only. */
  reset?: boolean;
}): Promise<{ emailed: boolean; whatsapped: boolean; summary: string }> {
  const base = (process.env.BETTER_AUTH_URL ?? "").replace(/\/+$/, "");
  const loginUrl = `${base}/login`;

  // ── Email ──
  let emailNote: string;
  let emailed = false;
  const rt = await getEmailRuntime();
  if (!rt.enabled) {
    emailNote = rt.configured ? "email is paused" : "email isn't configured";
  } else {
    const from = rt.fromName ? `${rt.fromName} <${rt.fromEmail}>` : rt.fromEmail;
    const res = await sendResendEmail({
      apiKey: rt.apiKey!,
      from,
      to: o.email,
      subject: o.reset ? "Your B2 Consultants password has been reset" : "Your B2 Consultants login is ready",
      html: credentialsEmailHtml({ ...o, loginUrl, reset: !!o.reset }),
    }).catch((e: unknown) => ({ ok: false as const, error: e instanceof Error ? e.message : "send failed" }));
    emailed = res.ok;
    emailNote = res.ok ? `emailed to ${o.email}` : `email failed (${res.error})`;
  }

  // ── WhatsApp ──
  let whatsappNote = "no WhatsApp number";
  let whatsapped = false;
  if (o.phone?.trim()) {
    const out = await sendWhatsApp({
      kind: "LOGIN_CREDENTIALS",
      to: o.phone,
      studentId: o.studentId ?? undefined,
      sentById: o.sentById,
      bodySummary: o.reset ? "Login details - password reset" : "Login details - portal login created",
      vars: { name: first(o.name), login_url: loginUrl, login_email: o.email, temp_password: o.password },
      secretVars: ["temp_password"],
    });
    whatsapped = out.sent;
    whatsappNote = out.sent ? "sent on WhatsApp" : `WhatsApp ${out.skipped ? "skipped" : "failed"}: ${out.error ?? out.status}`;
  }

  return { emailed, whatsapped, summary: `Login details ${emailNote}; ${whatsappNote}.` };
}
