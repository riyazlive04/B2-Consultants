import "server-only";
import { Prisma, type AgreementEventType } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { agreementDataSchema, type AgreementData } from "@/lib/agreement";
import { hashAgreementToken, toOwnedBytes } from "@/lib/agreement-token";
import { displayWhatsappNumber, normalizeWhatsappNumber } from "@/lib/phone";

/**
 * Shared internals for the agreement modules.
 *
 * These live OUTSIDE `agreement-actions.ts` and `agreement-sign.ts` on purpose: those files carry
 * a "use server" directive, which turns every export into a callable RPC endpoint. An exported
 * `recordAgreementEvent` would let anyone on the internet forge entries in the audit trail that
 * the certificate reproduces — and the trail is the only thing making an in-house signature worth
 * anything. Keep this file free of "use server".
 */

export type ActionResult<T = undefined> = { ok: true; data?: T } | { ok: false; error: string };

export const AGREEMENTS_PATH = "/agreements";

// ───────────────────────────── Signature intake ─────────────────────────────

const MAX_SIGNATURE_BYTES = 250_000;
const PNG_MAGIC = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

/**
 * A canvas signature arrives as a data URL from a browser we do not control, and its bytes get
 * embedded into a PDF we may one day hand to a court. Check the prefix, the magic number and the
 * size; never trust the MIME type asserted in the string itself.
 */
export function decodeSignaturePng(dataUrl: string) {
  const prefix = "data:image/png;base64,";
  if (!dataUrl.startsWith(prefix)) return null;
  const b64 = dataUrl.slice(prefix.length);
  if (b64.length > MAX_SIGNATURE_BYTES * 1.4) return null; // base64 inflates by ~4/3
  let buf: Buffer;
  try {
    buf = Buffer.from(b64, "base64");
  } catch {
    return null;
  }
  if (buf.length === 0 || buf.length > MAX_SIGNATURE_BYTES) return null;
  if (!buf.subarray(0, 8).equals(PNG_MAGIC)) return null;
  return toOwnedBytes(buf); // copy out of Buffer's shared pool; see toOwnedBytes
}

// ───────────────────────────── Audit trail ─────────────────────────────

export async function recordAgreementEvent(
  agreementId: string,
  type: AgreementEventType,
  extra?: { ip?: string | null; userAgent?: string | null; meta?: Prisma.InputJsonValue },
): Promise<void> {
  await prisma.agreementEvent.create({
    data: {
      agreementId,
      type,
      ip: extra?.ip ?? null,
      userAgent: extra?.userAgent?.slice(0, 400) ?? null,
      meta: extra?.meta,
    },
  });
}

// ───────────────────────────── Misc ─────────────────────────────

/**
 * B2-GM-2026-0001. Sequential because a human reads it aloud on a call.
 *
 * Two creates in the same tick derive the same number; the unique index turns that into a P2002
 * rather than a duplicate, and the caller retries.
 */
export async function nextDocumentNo(): Promise<string> {
  const year = new Intl.DateTimeFormat("en-GB", { year: "numeric", timeZone: "Asia/Kolkata" }).format(
    new Date(),
  );
  const prefix = `B2-GM-${year}-`;
  const last = await prisma.agreement.findFirst({
    where: { documentNo: { startsWith: prefix } },
    orderBy: { documentNo: "desc" },
    select: { documentNo: true },
  });
  const n = last ? Number(last.documentNo.slice(prefix.length)) + 1 : 1;
  return `${prefix}${String(n).padStart(4, "0")}`;
}

export function isUniqueViolation(e: unknown): boolean {
  return e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002";
}

export function parseAgreementData(
  raw: unknown,
): { ok: true; data: AgreementData } | { ok: false; error: string } {
  const parsed = agreementDataSchema.safeParse(raw);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Check the agreement fields." };
  }
  return { ok: true, data: parsed.data };
}

export function signingUrl(token: string): string {
  const origin = (process.env.BETTER_AUTH_URL ?? "").replace(/\/+$/, "");
  return `${origin}/agreement/${token}`;
}

export function firstName(full: string): string {
  return full.trim().split(/\s+/)[0] || full.trim() || "there";
}

/**
 * Reveal the signing OTP in the UI instead of sending it — so the ceremony can be exercised on a
 * developer's machine without an approved WATI template, and without firing a real WhatsApp
 * message at a real student.
 *
 * FAIL-CLOSED, and deliberately requires TWO independent signals:
 *   1. AGREEMENT_OTP_DEV_ECHO="true" — an explicit opt-in, absent from .env.example's live block.
 *   2. BETTER_AUTH_URL points at localhost — a real deployment has a public https origin, so a
 *      leaked env var alone can never arm this in production.
 *
 * If you are tempted to relax either condition: the OTP is the ONLY thing binding a signature to
 * the person who holds the phone. Echoing it to the browser reduces the guarantee to "someone had
 * the link", which is exactly the objection this whole module exists to answer.
 */
export function otpDevEchoEnabled(): boolean {
  const optedIn = process.env.AGREEMENT_OTP_DEV_ECHO === "true";
  const local = /^https?:\/\/(localhost|127\.0\.0\.1)(:|\/|$)/.test(process.env.BETTER_AUTH_URL ?? "");
  return optedIn && local;
}

/**
 * "+91 ••••• 3210" — enough for the student to recognise their own number, useless to anyone else.
 *
 * The last FOUR digits are shown, and callers rely on that: the signing page says "ending
 * {maskedPhone.slice(-4)}". Don't shorten it to three.
 */
export function maskPhone(raw: string | null | undefined): string {
  const normalized = normalizeWhatsappNumber(raw);
  if (!normalized) return "—";
  const cc = displayWhatsappNumber(normalized).split(" ")[0] ?? "";
  return `${cc} ••••• ${normalized.slice(-4)}`;
}

// ───────────────────────────── Token lookup ─────────────────────────────

export type TokenFailure = "invalid" | "expired" | "used" | "declined" | "voided";

/** Only these columns. `pdfBytes` is a bytea and must never ride along on a lookup. */
const TOKEN_SELECT = {
  id: true,
  documentNo: true,
  templateVersion: true,
  status: true,
  data: true,
  dataSha256: true,
  expiresAt: true,
  signedAt: true,
  otpHash: true,
  otpExpiresAt: true,
  otpAttempts: true,
  founderSignedAt: true,
  founderSignaturePng: true,
  leadId: true,
  studentId: true,
} as const;

export type TokenRow = Prisma.AgreementGetPayload<{ select: typeof TOKEN_SELECT }>;

/**
 * Resolve a raw signing token. Never reveals anything on failure beyond the reason — an
 * enumeration oracle on document numbers or student names would be a gift to a scraper.
 *
 * Order matters: `signedAt` is checked before `expiresAt`, so someone who signed on the last day
 * and comes back a week later sees "already signed", not "expired".
 */
export async function loadAgreementByToken(
  token: string,
): Promise<{ ok: true; row: TokenRow } | { ok: false; reason: TokenFailure }> {
  if (!token || token.length < 10 || token.length > 200) return { ok: false, reason: "invalid" };

  const row = await prisma.agreement.findUnique({
    where: { tokenHash: hashAgreementToken(token) },
    select: TOKEN_SELECT,
  });
  if (!row) return { ok: false, reason: "invalid" };
  if (row.signedAt) return { ok: false, reason: "used" };
  if (row.status === "DECLINED") return { ok: false, reason: "declined" };
  if (row.status === "VOIDED") return { ok: false, reason: "voided" };
  if (row.expiresAt && row.expiresAt.getTime() <= Date.now()) return { ok: false, reason: "expired" };
  return { ok: true, row };
}

/** First open flips SENT → VIEWED. Idempotent: the compare-and-set means one VIEWED event, not one per refresh. */
export async function markAgreementViewed(
  id: string,
  extra: { ip?: string | null; userAgent?: string | null },
): Promise<void> {
  const updated = await prisma.agreement.updateMany({
    where: { id, status: "SENT" },
    data: { status: "VIEWED" },
  });
  if (updated.count > 0) await recordAgreementEvent(id, "VIEWED", extra);
}
