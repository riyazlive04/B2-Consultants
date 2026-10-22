import "server-only";
import { brandEmailHeader, getEmailRuntime, sendResendEmail } from "@/lib/email";
import { AGREEMENT_PROVIDER, formatGermanDateOf } from "@/lib/agreement";

/**
 * The agreement emails: the signing link, the nudge, and the executed copy.
 *
 * ── WHY EMAIL AT ALL, WHEN THIS MODULE WAS BUILT ON WHATSAPP ────────────────────────────────
 * Because WhatsApp is not a channel we control. A send needs an approved WATI template, the
 * number has to be valid and not opted out, and when any of that is missing the only trace is a
 * SKIPPED row and an agreement resting unsent. Email is the second route to the same person, and
 * `issueAgreementCore` reports both outcomes rather than either silently.
 *
 * ── THE LINK, AND WHERE IT CAN AND CANNOT GO ────────────────────────────────────────────────
 * Only the SHA-256 of a signing token is stored, so a link can only be built in the request that
 * minted the token. That is why:
 *   · the ISSUE email carries the signing link (minted a moment earlier);
 *   · the COPY email carries the copy link (the same token, still in hand at signing);
 *   · a REMINDER carries NO LINK, and says so - it points at the message already sent. Minting a
 *     fresh token to make a prettier reminder would silently break the link in their inbox.
 *
 * ── FAIL-SAFE, LIKE EVERY OTHER DELIVERY SEAM HERE ──────────────────────────────────────────
 * Nothing in here throws. A failed email must never cost a signature, a seal, or an issue that
 * has already committed - the caller gets an outcome and shows it to the founder.
 */

const esc = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

const first = (full: string) => (full || "").trim().split(/\s+/)[0] || "there";

export type EmailOutcome = { sent: boolean; skipped: boolean; error?: string | null };

const OFF = (reason: string): EmailOutcome => ({ sent: false, skipped: true, error: reason });

/** The one shell every agreement email shares: the brand lockup, the body, B2's footer. */
function shell(bodyHtml: string): string {
  return `<div style="font-family:Inter,Arial,sans-serif;font-size:14px;color:#16203A;line-height:1.6">
    ${brandEmailHeader()}
    ${bodyHtml}
    <p style="color:#636F85;font-size:12px;margin-top:20px">
      ${esc(AGREEMENT_PROVIDER.entity)} · ${esc(AGREEMENT_PROVIDER.address)}<br>
      ${esc(AGREEMENT_PROVIDER.email)} · ${esc(AGREEMENT_PROVIDER.mobile)}
    </p>
  </div>`;
}

/** A real button, with the URL printed beneath it - some clients strip the anchor styling. */
function cta(url: string, label: string): string {
  return `<p style="margin:20px 0">
    <a href="${esc(url)}" style="background:#003C8C;color:#ffffff;text-decoration:none;padding:11px 20px;border-radius:8px;font-weight:600;display:inline-block">${esc(label)}</a>
  </p>
  <p style="color:#636F85;font-size:12px;word-break:break-all">Or paste this into your browser:<br>${esc(url)}</p>`;
}

async function send(opts: { to: string; subject: string; html: string }): Promise<EmailOutcome> {
  const to = opts.to.trim();
  if (!to) return OFF("no email address on record");

  const rt = await getEmailRuntime();
  if (!rt.enabled) return OFF(rt.configured ? "email is paused" : "email is not configured");

  const from = rt.fromName ? `${rt.fromName} <${rt.fromEmail}>` : rt.fromEmail;
  const res = await sendResendEmail({ apiKey: rt.apiKey!, from, to, subject: opts.subject, html: opts.html }).catch(
    (e: unknown) => ({ ok: false as const, error: e instanceof Error ? e.message : "send failed" }),
  );
  return res.ok ? { sent: true, skipped: false } : { sent: false, skipped: false, error: res.error ?? "send failed" };
}

// ───────────────────────────── The three emails ─────────────────────────────

/** "Please sign your agreement" - carries the signing link and when it expires. */
export async function emailSigningLink(o: {
  to: string;
  name: string;
  documentNo: string;
  signingUrl: string;
  expiresAt: Date | null;
}): Promise<EmailOutcome> {
  const expiry = o.expiresAt
    ? `<p>The link stays live until <strong>${esc(formatGermanDateOf(o.expiresAt))}</strong>.</p>`
    : "";
  return send({
    to: o.to,
    subject: `Your coaching agreement ${o.documentNo} is ready to sign`,
    html: shell(`
      <p>Hi ${esc(first(o.name))},</p>
      <p>Your agreement with ${esc(AGREEMENT_PROVIDER.entity)} (<strong>${esc(o.documentNo)}</strong>) is ready.
         ${esc(AGREEMENT_PROVIDER.name)} has already countersigned it.</p>
      <p>Open the link below to read it in full and sign. We will send a 6-digit code to your WhatsApp
         number to confirm it is you.</p>
      ${cta(o.signingUrl, "Read and sign the agreement")}
      ${expiry}
      <p style="color:#636F85;font-size:12px">This link is personal to you - please do not forward it.</p>
    `),
  });
}

/**
 * The nudge. Deliberately has no link, and says why - see the note at the top of this file.
 */
export async function emailSigningReminder(o: {
  to: string;
  name: string;
  documentNo: string;
  issuedAt: Date | null;
  expiresAt: Date | null;
}): Promise<EmailOutcome> {
  const sent = o.issuedAt ? ` on ${esc(formatGermanDateOf(o.issuedAt))}` : "";
  const expiry = o.expiresAt
    ? `<p>The link expires on <strong>${esc(formatGermanDateOf(o.expiresAt))}</strong>. After that we have to issue a new one.</p>`
    : "";
  return send({
    to: o.to,
    subject: `Reminder: agreement ${o.documentNo} is waiting for your signature`,
    html: shell(`
      <p>Hi ${esc(first(o.name))},</p>
      <p>Your agreement <strong>${esc(o.documentNo)}</strong> is still waiting for your signature.</p>
      <p>Please open the signing link we sent you${sent} - it is in your WhatsApp messages, and in your
         email if we sent it there too.</p>
      ${expiry}
      <p>If you cannot find it, reply to this email or message us on ${esc(AGREEMENT_PROVIDER.mobile)} and we
         will send it again.</p>
    `),
  });
}

/** The executed copy. The one email that matters most to the student, so it carries the link. */
export async function emailSignedCopy(o: {
  to: string;
  name: string;
  documentNo: string;
  copyUrl: string;
  signedAt: Date;
}): Promise<EmailOutcome> {
  return send({
    to: o.to,
    subject: `Your signed agreement ${o.documentNo}`,
    html: shell(`
      <p>Hi ${esc(first(o.name))},</p>
      <p>Thank you - agreement <strong>${esc(o.documentNo)}</strong> was signed on
         <strong>${esc(formatGermanDateOf(o.signedAt))}</strong> and is now executed.</p>
      <p>Your countersigned copy, with the signature certificate attached to it, is here:</p>
      ${cta(o.copyUrl, "Download the signed agreement")}
      <p>Please keep it somewhere safe. The link stays live - it is not time-limited like the signing
         link was.</p>
    `),
  });
}

/** A co-signer's own link: a parent or guardian asked to sign before the student can. */
export async function emailCoSignerLink(o: {
  to: string;
  name: string;
  studentName: string;
  documentNo: string;
  signingUrl: string;
  expiresAt: Date | null;
}): Promise<EmailOutcome> {
  const expiry = o.expiresAt
    ? `<p>The link stays live until <strong>${esc(formatGermanDateOf(o.expiresAt))}</strong>.</p>`
    : "";
  return send({
    to: o.to,
    subject: `Please co-sign ${esc(o.studentName)}'s agreement (${o.documentNo})`,
    html: shell(`
      <p>Hi ${esc(first(o.name))},</p>
      <p>${esc(AGREEMENT_PROVIDER.entity)} needs your signature on
         <strong>${esc(o.studentName)}</strong>'s coaching agreement
         (<strong>${esc(o.documentNo)}</strong>) before they can sign it themselves.</p>
      <p>Open the link below to read the agreement and sign your part. We will send a 6-digit code to
         your WhatsApp number to confirm it is you.</p>
      ${cta(o.signingUrl, "Read and co-sign the agreement")}
      ${expiry}
      <p style="color:#636F85;font-size:12px">This link is personal to you - please do not forward it.</p>
    `),
  });
}
