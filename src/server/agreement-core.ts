import "server-only";
import { revalidatePath } from "next/cache";
import { Prisma, type AgreementEventType } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { agreementDataSchema, type AgreementData } from "@/lib/agreement";
import { hashAgreementToken, mintAgreementToken, toOwnedBytes } from "@/lib/agreement-token";
import { signingDeviceSchema, storedDeviceSchema, type StoredDevice } from "@/lib/device";
import { displayWhatsappNumber, normalizeWhatsappNumber } from "@/lib/phone";
import { sendWhatsApp } from "./whatsapp";

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

// The pad now exports a crop redrawn at 1200px across the full width, so a dense signature can
// run to a couple of hundred KB. Generous, but still far below anything that could bloat the
// sealed PDF or the `bytea` column.
const MAX_SIGNATURE_BYTES = 400_000;
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

// ───────────────────────────── Issue (countersign + send) ─────────────────────────────

export type SignatureSource = { source: "drawn" } | { source: "saved"; savedAt: string | null };

/**
 * Countersign and send — the body shared by BOTH issue paths (draw-now and reuse-saved).
 *
 * It lives here, without "use server", precisely so it is NOT an RPC endpoint: the two exported
 * actions in agreement-actions.ts each run their own capability check and then call this. If this
 * were exported from a "use server" file, anyone could issue an agreement by posting an id.
 *
 * THE HONESTY RULE for a reused signature: only the *ink* is reused. `founderDevice.observed` (the
 * IP and User-Agent our server saw) is captured fresh on every issue, and the ISSUED event records
 * which source was used — so the certificate can never imply a live draw that didn't happen.
 *
 * No PDF is rendered here. The student reads a live render, and the one authoritative render
 * happens at the moment they sign.
 */
export async function issueAgreementCore(input: {
  id: string;
  png: NonNullable<ReturnType<typeof decodeSignaturePng>>;
  founderDevice: StoredDevice | null;
  session: { user: { id: string; email: string } };
  signature: SignatureSource;
}): Promise<ActionResult<{ signingUrl: string; delivery: string; sent: boolean }>> {
  const { id, png, founderDevice, session, signature } = input;

  const row = await prisma.agreement.findUnique({
    where: { id },
    select: { id: true, status: true, data: true, documentNo: true, leadId: true, studentId: true },
  });
  if (!row) return { ok: false, error: "Agreement not found." };
  if (row.status !== "DRAFT") return { ok: false, error: "Only a draft can be issued." };

  const parsed = parseAgreementData(row.data);
  if (!parsed.ok) return { ok: false, error: `Stored fields are invalid: ${parsed.error}` };

  const { token, tokenHash, expiresAt } = mintAgreementToken();
  const now = new Date();

  const issued = await prisma.agreement.updateMany({
    where: { id, status: "DRAFT" },
    data: {
      status: "SENT",
      tokenHash,
      expiresAt,
      issuedAt: now,
      issuedById: session.user.id,
      founderSignedAt: now,
      founderSignaturePng: png,
      founderDevice: founderDevice ?? Prisma.JsonNull,
    },
  });
  if (issued.count === 0) return { ok: false, error: "This agreement was issued by someone else." };

  await recordAgreementEvent(id, "ISSUED", {
    meta: {
      by: session.user.email,
      // Never let the trail imply a live draw when stored ink was stamped.
      signature: signature.source,
      savedAt: signature.source === "saved" ? signature.savedAt : null,
    },
  });

  const url = signingUrl(token);
  const outcome = await sendWhatsApp({
    kind: "AGREEMENT_SEND",
    to: parsed.data.student.phone,
    vars: {
      name: firstName(parsed.data.student.fullName),
      sign_url: url,
      sign_token: token,
      document_no: row.documentNo,
    },
    sentById: session.user.id,
    bodySummary: `Agreement ${row.documentNo} — signing link`,
    agreementId: id,
    leadId: row.leadId,
    studentId: row.studentId,
  });

  await recordAgreementEvent(id, outcome.sent ? "DELIVERY_SENT" : "DELIVERY_SKIPPED", {
    meta: { status: outcome.status, error: outcome.error ?? null },
  });

  revalidatePath(AGREEMENTS_PATH);
  revalidatePath(`${AGREEMENTS_PATH}/${id}`);

  // The link comes back WHATEVER happened to the WhatsApp send. With WATI off, the number opted
  // out, or the template unmapped, this response is the only place this token will ever exist —
  // the database holds nothing but its hash.
  return {
    ok: true,
    data: {
      signingUrl: url,
      sent: outcome.sent,
      delivery: outcome.sent
        ? "Signing link sent on WhatsApp."
        : `WhatsApp did not send: ${outcome.error ?? "unknown reason"}. Copy the link below and share it yourself.`,
    },
  };
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

/**
 * Where the student fetches their executed copy. Same token as the signing link — signing burns the
 * OTP and the ceremony, but never `tokenHash`, so the link already in their chat keeps working for
 * the one thing they still need it for.
 */
export function signedCopyUrl(token: string): string {
  return `${signingUrl(token)}/copy`;
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

// ───────────────────────────── Signing device ─────────────────────────────

/**
 * Take the browser's account of itself, and staple our own observation to it.
 *
 * The client half is a CLAIM and is treated as one: parsed through a clamped schema, and stored
 * under `reported` so nothing downstream can mistake it for fact. `observed` is filled in here,
 * from the request — never from the payload — because the IP and the User-Agent header are the
 * only parts of this record a signer cannot choose.
 *
 * Returns null when the payload is unusable. A signature must never fail because a browser
 * withheld its screen size, so callers proceed with a null device rather than rejecting.
 */
export function buildSigningDevice(
  raw: unknown,
  observed: { ip: string | null; userAgent: string | null },
): StoredDevice | null {
  const parsed = signingDeviceSchema.safeParse(raw);
  if (!parsed.success) return null;
  return {
    ...parsed.data,
    observed: {
      ip: observed.ip,
      userAgent: observed.userAgent?.slice(0, 400) ?? null,
      at: new Date().toISOString(),
    },
  };
}

/** Read a `Json` column back into a typed record. A Json column is not a type. */
export function readStoredDevice(raw: unknown): StoredDevice | null {
  const parsed = storedDeviceSchema.safeParse(raw);
  return parsed.success ? parsed.data : null;
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

/**
 * Resolve a token for SIGNED-COPY DOWNLOAD ONLY — the mirror image of `loadAgreementByToken`.
 *
 * That one refuses a signed row ("used"), and must: its job is to guard the signing ceremony, and a
 * burnt token can never re-open it. But the student still has to be able to fetch the contract they
 * signed, and `signAgreement` clears only `otpHash` — `tokenHash` survives — so the link already in
 * their chat is the natural credential for it.
 *
 * The checks are inverted on purpose: signedAt + sealed bytes are REQUIRED, and `expiresAt` is
 * ignored, because a contract you have executed does not stop being yours after fourteen days.
 * Voided/declined rows can never reach here — both paths null out `tokenHash`.
 *
 * This is one of the two places `pdfBytes` may be selected. Never widen it to a list query.
 */
export async function loadSignedAgreementByToken(token: string) {
  if (!token || token.length < 10 || token.length > 200) return null;
  const row = await prisma.agreement.findUnique({
    where: { tokenHash: hashAgreementToken(token) },
    select: {
      id: true,
      documentNo: true,
      status: true,
      signedAt: true,
      pdfBytes: true,
      pdfSize: true,
      pdfSha256: true,
    },
  });
  if (!row?.signedAt || row.status !== "SIGNED" || !row.pdfBytes) return null;
  return row;
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
