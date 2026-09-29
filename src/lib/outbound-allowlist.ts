/**
 * Recipient allowlist for outbound channels (WhatsApp, email, SMS).
 *
 * ── Why this exists ─────────────────────────────────────────────────────────────
 * Local development and production share ONE Supabase database. That is a deliberate
 * choice (testing from local against real state), but it means a developer running the app
 * locally is holding the same contact rows the production cron is holding. Arming a channel
 * to test a sequence would message whoever happens to be in the pipeline - a real prospect
 * who never asked to be part of a test. A message cannot be unsent.
 *
 * So: set OUTBOUND_ALLOWLIST locally, leave it UNSET in production.
 *
 *   OUTBOUND_ALLOWLIST="+919000015961,support@sirahdigital.in"
 *
 * Unset or empty  → no restriction. Production behaves exactly as it always has.
 * Set             → ONLY these recipients can be reached. Everything else is skipped and
 *                   logged, not failed, so a sequence under test still advances its state
 *                   machine and you can watch the whole ladder run without spamming anyone.
 *
 * ── Why presence of the var, and not NODE_ENV ───────────────────────────────────
 * The obvious gate is `NODE_ENV !== "production"`. It is wrong here. This project is
 * routinely run locally as a PRODUCTION build (`next build && next start`) because dev mode
 * is slow - so NODE_ENV is "production" on the developer's own machine, and a NODE_ENV gate
 * would silently disarm itself in exactly the case it exists to protect. Presence of the
 * variable is explicit, survives any build mode, and fails safe.
 */

export type AllowDecision =
  | { allowed: true }
  | { allowed: false; reason: string };

/** Last 10 digits, which is what makes +91 98404 20666, 919840420666 and 9840420666 equal. */
function phoneKey(raw: string): string {
  const digits = raw.replace(/\D/g, "");
  return digits.length > 10 ? digits.slice(-10) : digits;
}

function parseAllowlist(): { emails: Set<string>; phones: Set<string>; raw: string } | null {
  const raw = process.env.OUTBOUND_ALLOWLIST?.trim();
  if (!raw) return null;
  const emails = new Set<string>();
  const phones = new Set<string>();
  // Split on separators ONLY, never on whitespace: "+91 90000 15961" is one number written
  // the way a human writes it, and splitting it on spaces would register three useless
  // fragments and silently fail to match the person you meant to allow.
  for (const entry of raw.split(/[,;\n]+/)) {
    const e = entry.trim();
    if (!e) continue;
    if (e.includes("@")) emails.add(e.toLowerCase());
    else phones.add(phoneKey(e));
  }
  // A variable set to something unparseable (e.g. just commas) must not read as "no
  // restriction" - that would be the failure mode this guard exists to prevent.
  if (emails.size === 0 && phones.size === 0) return { emails, phones, raw };
  return { emails, phones, raw };
}

/** True when an allowlist is in force, for callers that want to label a run as restricted. */
export function allowlistActive(): boolean {
  return Boolean(process.env.OUTBOUND_ALLOWLIST?.trim());
}

/**
 * Decide whether `recipient` (an email address or any phone format) may be contacted.
 * Callers treat a false decision as a SKIP, never as a send failure.
 */
export function checkRecipient(recipient: string, channel: "whatsapp" | "email" | "sms"): AllowDecision {
  const list = parseAllowlist();
  if (!list) return { allowed: true };

  const isEmail = recipient.includes("@");
  const ok = isEmail
    ? list.emails.has(recipient.trim().toLowerCase())
    : list.phones.has(phoneKey(recipient));

  if (ok) return { allowed: true };
  return {
    allowed: false,
    reason: `OUTBOUND_ALLOWLIST is set, and this ${channel} recipient is not on it - skipped, not sent`,
  };
}
