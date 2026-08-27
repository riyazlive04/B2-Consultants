/**
 * Does a prospect's reply actually CONFIRM they will attend?
 *
 * ── Why this is its own file ────────────────────────────────────────────────────
 * The rule lived inside the WATI webhook route, private and untested, at the moment the same
 * question started being asked of email. Two copies of "is this a yes?" is how one channel ends
 * up confirming a prospect the other channel would have left alone - and the consequence of a
 * wrong yes is not cosmetic: it moves a card to Pre-Qualified & Confirmed and stops the
 * cancellation ladder that would otherwise free the slot.
 *
 * ── Fail-closed, and deliberately not clever ────────────────────────────────────
 * An unrecognised reply is NOT a confirmation. It stays a reply for a specialist to read and
 * action by hand, which is a working path (`outreach-actions.setWhatsappConfirmed`) and a cheap
 * failure. A false positive is an expensive one: the prospect keeps a slot they just declined and
 * nobody finds out until they do not turn up.
 *
 * So this accepts a short list of phrasings around the SOP's own instruction - the templates say
 * "Please reply YES to confirm your participation" - and nothing else. It is not sentiment
 * analysis and it must never guess.
 */

/**
 * Markers that begin the QUOTED part of an email reply.
 *
 * Without this, email confirmation would essentially never fire, and would look like a bug rather
 * than a design: a mail client quotes the entire original message underneath the reply, the
 * original is the confirmation request itself, and it contains words like "not" and "cancel". The
 * negation guard below scans the whole text and would reject almost every genuine "Yes" ever sent.
 *
 * Fail-closed here too: an unrecognised quoting style just means more text is scanned, which can
 * only ever cause a confirmation to be MISSED, never invented.
 */
const QUOTE_MARKERS: readonly RegExp[] = [
  /^\s*>/, // the universal quote prefix
  /^\s*-{2,}\s*original message\s*-{2,}/i, // Outlook
  /^\s*_{10,}\s*$/, // Outlook's horizontal rule above a quoted block
  /^\s*on .{0,200}\bwrote:\s*$/i, // Gmail / Apple Mail
  /^\s*(from|sent|to|subject):\s/i, // Outlook's inline header block
  /^\s*sent from my \w+/i, // a signature, but nothing after it is ever the reply
];

/**
 * The part of a reply the person actually typed - everything above the quoted original.
 *
 * Line-based, so it needs real line breaks to work. `htmlToText` in the Resend webhook is written
 * to preserve them for exactly this reason.
 */
export function stripQuotedReply(text: string): string {
  const lines = text.split(/\r?\n/);
  const cut = lines.findIndex((line) => QUOTE_MARKERS.some((m) => m.test(line)));
  return (cut === -1 ? lines : lines.slice(0, cut)).join("\n").trim();
}

/**
 * Explicit negations, checked FIRST and across the whole reply.
 *
 * "Yes, but I can't make it" and "yes... actually no, please reschedule" must not confirm. The
 * cost of scanning the whole reply rather than just its opening is that a long, chatty yes
 * mentioning any of these words is missed - which is the direction to fail in.
 */
const NEGATION = /\b(no|not|can'?t|cannot|won'?t|unable|reschedule|another time|busy)\b/;

/**
 * The accepted affirmatives, anchored to the START of the reply.
 *
 * The words and the emoji are SEPARATE alternations, which is a fix rather than a style choice.
 * They used to be one list ending in a single `\b`, and that silently never matched an emoji: a
 * word boundary needs a word character on one side, and a thumbs-up has none. So an emoji reply,
 * listed as an accepted confirmation since this rule was written, has never once confirmed
 * anything. The words keep their `\b`, so "yesterday" and "okra" still do not count.
 */
const AFFIRMATIVE =
  /^\s*(?:(?:yes|yess+|ya|yeah|yep|yup|sure|ok(?:ay)?|confirmed?|confirming|i'?m in|will join|joining)\b|[\u{1F44D}\u{2705}\u{1F64C}\u{1F197}])/iu;

/**
 * Is this reply a confirmation?
 *
 * `quoted: true` (email) strips the quoted original first; WhatsApp has no such thing, so it
 * passes the text straight through.
 */
export function isConfirmationReply(text: string, opts?: { quoted?: boolean }): boolean {
  const body = opts?.quoted ? stripQuotedReply(text) : text;
  const t = body.trim().toLowerCase();
  if (!t) return false;
  if (NEGATION.test(t)) return false;
  return AFFIRMATIVE.test(t);
}

/**
 * Turn an HTML email body into text that still has line breaks.
 *
 * The previous version collapsed ALL whitespace to single spaces, which is fine for storing a
 * readable copy and useless for `stripQuotedReply` - with no line breaks there are no lines, so
 * every quoted original was scanned as part of the reply.
 *
 * `<blockquote>` goes first and whole: it is what every major client wraps a quoted original in,
 * and dropping it is far more reliable than matching the text marker above it.
 */
export function htmlToText(html: string): string {
  return html
    .replace(/<(style|script)[\s\S]*?<\/\1>/gi, "")
    .replace(/<blockquote[\s\S]*?<\/blockquote>/gi, "\n")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|tr|li|h[1-6])>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    // Entities a quote marker can hide behind. `&gt;` is the big one - a plain-text quote that
    // has been HTML-escaped starts every line with it.
    .replace(/&gt;/g, ">")
    .replace(/&lt;/g, "<")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .split("\n")
    .map((line) => line.replace(/[^\S\n]+/g, " ").trim())
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}
