"use server";

import { headers } from "next/headers";
import { Prisma } from "@prisma/client";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { clientIpFrom, rateLimitOk } from "@/lib/rate-limit";
import { AGREEMENT_EVENT_LABELS, OTP_MAX_ATTEMPTS, type AgreementData } from "@/lib/agreement";
import { hashAgreementToken, mintOtp, otpMatches } from "@/lib/agreement-token";
import {
  buildSigningDevice,
  decodeSignaturePng,
  firstName,
  loadAgreementByToken,
  maskPhone,
  otpDevEchoEnabled,
  recordAgreementEvent,
  signedCopyUrl,
  type ActionResult,
  type TokenFailure,
} from "./agreement-core";
import { sealAgreementPdf } from "./agreement-render";
import { sendWhatsApp } from "./whatsapp";
import { logPublicActivity } from "./activity-log";

/**
 * The public signing surface. PUBLIC by necessity — the student has no session — so the token is
 * the only credential and every failure mode is re-checked on every call.
 *
 * The identity binding is a one-time code delivered to the same WhatsApp number the link went to.
 * Six digits is only ~20 bits, so the entropy does no work: the defence is a 10-minute window, a
 * five-attempt cap stored on the row, per-IP and per-token rate limits, and a constant-time
 * compare. Without this, "someone had the link" is all the audit trail could ever say.
 */

const FAILURE_MESSAGES: Record<TokenFailure, string> = {
  invalid: "This signing link is not valid.",
  expired: "This signing link has expired. Please ask B2 Consultants for a new one.",
  used: "This agreement has already been signed.",
  declined: "This agreement was declined.",
  voided: "This agreement was withdrawn by B2 Consultants.",
};

async function requestContext() {
  const h = await Promise.resolve(headers());
  return { ip: clientIpFrom(h), userAgent: h.get("user-agent") ?? null };
}

/** What the signing page shows before it renders anything. Reveals nothing on failure. */
export async function inspectAgreement(token: string): Promise<
  | { ok: true; documentNo: string; studentName: string; maskedPhone: string; otpPending: boolean }
  | { ok: false; error: string }
> {
  const found = await loadAgreementByToken(token);
  if (!found.ok) return { ok: false, error: FAILURE_MESSAGES[found.reason] };

  const data = found.row.data as unknown as AgreementData;
  return {
    ok: true,
    documentNo: found.row.documentNo,
    studentName: data.student.fullName,
    maskedPhone: maskPhone(data.student.phone),
    otpPending: !!found.row.otpHash && (found.row.otpExpiresAt?.getTime() ?? 0) > Date.now(),
  };
}

/** Send (or re-send) the one-time code to the number on the agreement — never to a number the caller supplies. */
export async function requestSignOtp(
  token: string,
): Promise<ActionResult<{ maskedPhone: string; devCode?: string }>> {
  const { ip, userAgent } = await requestContext();
  const tokenHash = hashAgreementToken(token);

  if (!rateLimitOk(`agr:otp:tok:${tokenHash}`, 5, 15 * 60_000)) {
    return { ok: false, error: "Too many codes requested. Wait a few minutes and try again." };
  }
  if (!rateLimitOk(`agr:otp:ip:${ip}`, 20, 60 * 60_000)) {
    return { ok: false, error: "Too many requests from this network." };
  }

  const found = await loadAgreementByToken(token);
  if (!found.ok) return { ok: false, error: FAILURE_MESSAGES[found.reason] };
  const { row } = found;
  const data = row.data as unknown as AgreementData;

  const { code, codeHash, expiresAt } = mintOtp();
  // A fresh code resets the attempt counter — otherwise five typos would lock the student out
  // of their own contract permanently.
  await prisma.agreement.update({
    where: { id: row.id },
    data: { otpHash: codeHash, otpExpiresAt: expiresAt, otpAttempts: 0 },
  });

  const outcome = await sendWhatsApp({
    kind: "AGREEMENT_OTP",
    to: data.student.phone,
    vars: { name: firstName(data.student.fullName), code },
    bodySummary: `Agreement ${row.documentNo} — signing code`,
    agreementId: row.id,
    leadId: row.leadId,
    studentId: row.studentId,
  });
  await recordAgreementEvent(row.id, "OTP_SENT", {
    ip,
    userAgent,
    meta: { delivered: outcome.sent, error: outcome.error ?? null },
  });

  if (!outcome.sent) {
    // Localhost + explicit opt-in only (see otpDevEchoEnabled). Lets the ceremony be exercised
    // before the WATI templates are approved, without weakening a real deployment.
    if (otpDevEchoEnabled()) {
      console.warn(`[agreement ${row.documentNo}] DEV OTP ECHO: ${code}`);
      return { ok: true, data: { maskedPhone: maskPhone(data.student.phone), devCode: code } };
    }
    // The code exists but nobody can read it. Say so plainly rather than leaving the student
    // staring at an input box waiting for a message that is never coming.
    return {
      ok: false,
      error:
        "We could not send your code on WhatsApp. Please contact B2 Consultants on +49 1522 2311 374.",
    };
  }
  return { ok: true, data: { maskedPhone: maskPhone(data.student.phone) } };
}

const signSchema = z.object({
  token: z.string().min(10).max(200),
  code: z.string().trim().regex(/^\d{6}$/, "Enter the 6-digit code"),
  signature: z.string().min(64).max(600_000),
  consent: z.literal(true, { message: "Please confirm you agree to sign electronically." }),
  // Validated separately by buildSigningDevice: a browser that withholds its details must still
  // be able to sign, so a bad device payload degrades to null rather than blocking the signature.
  device: z.unknown().optional(),
});

/**
 * Verify, seal, burn — in that order, and in ONE write.
 *
 * The render happens BEFORE the compare-and-set, which looks backwards until you remember the
 * `agreement_seal_immutable` trigger: once `signedAt` is set, `pdfBytes` can never be written.
 * So `signedAt` and the sealed bytes must land in the same UPDATE. The cost is that a losing
 * racer renders a PDF it then throws away. Correctness beats the wasted CPU.
 */
export async function signAgreement(input: {
  token: string;
  code: string;
  signature: string;
  consent: boolean;
  device?: unknown;
}): Promise<ActionResult<{ documentNo: string }>> {
  const { ip, userAgent } = await requestContext();
  if (!rateLimitOk(`agr:sign:ip:${ip}`, 30, 60 * 60_000)) {
    return { ok: false, error: "Too many attempts from this network." };
  }

  const parsed = signSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Check the form and try again." };
  }
  const { token, code, signature } = parsed.data;

  const found = await loadAgreementByToken(token);
  if (!found.ok) return { ok: false, error: FAILURE_MESSAGES[found.reason] };
  const { row } = found;

  const png = decodeSignaturePng(signature);
  if (!png) return { ok: false, error: "Your signature didn't come through. Please draw it again." };

  // ── One-time code ──
  if (!row.otpHash || !row.otpExpiresAt || row.otpExpiresAt.getTime() <= Date.now()) {
    return { ok: false, error: "Your code has expired. Request a new one." };
  }
  if (row.otpAttempts >= OTP_MAX_ATTEMPTS) {
    return { ok: false, error: "Too many incorrect codes. Request a new one." };
  }
  if (!otpMatches(code, row.otpHash)) {
    await prisma.agreement.update({
      where: { id: row.id },
      data: { otpAttempts: { increment: 1 } },
    });
    await recordAgreementEvent(row.id, "OTP_FAILED", { ip, userAgent });
    const left = OTP_MAX_ATTEMPTS - row.otpAttempts - 1;
    return {
      ok: false,
      error: left > 0 ? `That code is not right. ${left} attempt${left === 1 ? "" : "s"} left.` : "Too many incorrect codes. Request a new one.",
    };
  }

  const now = new Date();
  const otpVerifiedAt = now;
  await recordAgreementEvent(row.id, "OTP_VERIFIED", { ip, userAgent });

  // The browser's claims about itself, plus the IP and header WE saw. Never the other way round.
  const device = buildSigningDevice(parsed.data.device, { ip, userAgent });

  // ── Certificate trail: everything on record, plus the two lines this request is about to write ──
  const priorEvents = await prisma.agreementEvent.findMany({
    where: { agreementId: row.id },
    orderBy: { createdAt: "asc" },
    select: { type: true, createdAt: true, ip: true },
  });
  const data = row.data as unknown as AgreementData;
  const certificate = {
    events: [
      ...priorEvents.map((e) => ({
        label: AGREEMENT_EVENT_LABELS[e.type],
        at: e.createdAt,
        detail: e.ip,
      })),
      { label: AGREEMENT_EVENT_LABELS.SIGNED, at: now, detail: ip },
    ],
    signerIp: ip,
    signerUserAgent: userAgent,
    otpVerifiedAt,
    deliveredTo: maskPhone(data.student.phone),
    device,
  };

  // ── Render once. These exact bytes are what gets hashed and stored. ──
  const sealed = await sealAgreementPdf({
    documentNo: row.documentNo,
    data,
    templateVersion: row.templateVersion,
    founderSignaturePng: row.founderSignaturePng,
    studentSignaturePng: png,
    founderSignedAt: row.founderSignedAt,
    signedAt: now,
    certificate,
  });

  // ── Burn + seal, atomically. `signedAt: null` is the compare-and-set: two tabs, one signature. ──
  const burned = await prisma.agreement.updateMany({
    where: { id: row.id, signedAt: null },
    data: {
      status: "SIGNED",
      signedAt: now,
      studentSignaturePng: png,
      signerDevice: device ?? Prisma.JsonNull,
      pdfBytes: sealed.bytes,
      pdfSha256: sealed.sha256,
      pdfSize: sealed.size,
      otpHash: null,
      otpExpiresAt: null,
    },
  });
  if (burned.count === 0) return { ok: false, error: "This agreement has already been signed." };

  await recordAgreementEvent(row.id, "SIGNED", {
    ip,
    userAgent,
    meta: {
      consent: true,
      pdfSha256: sealed.sha256,
      dataSha256: row.dataSha256,
      device: device ? { pointerType: device.capture.pointerType, strokes: device.capture.strokeCount } : null,
    },
  });

  // The student has no session, but the token plus the one-time code just proved who they
  // are — so this is a named action, not an anonymous one, and it belongs on the founder's
  // feed next to the staff action that issued it. The AgreementEvent trail above stays the
  // legal record; this is the human-readable line.
  await logPublicActivity(
    { name: data.student.fullName, role: "STUDENT" },
    {
      action: "agreement.sign",
      section: "agreements",
      entityType: "Agreement",
      entityId: row.id,
      summary: `${data.student.fullName} signed agreement ${row.documentNo}`,
      meta: { documentNo: row.documentNo, pdfSha256: sealed.sha256 },
    },
  );

  /**
   * Send the countersigned copy back.
   *
   * This runs AFTER the burn, never before: a failed WhatsApp send must not cost the student a
   * signature they already made. The row is fail-safe (it resolves an outcome, never throws), so
   * the worst case is a SKIPPED row and the agreement resting at "Signed — deliver copy" on the
   * founder's dashboard until it goes out. That's also the line between SIGNED and COMPLETED:
   * `deriveAgreementState` only reads a SUCCESSFUL send as delivered.
   *
   * The link carries the same token: signing clears `otpHash`, never `tokenHash`.
   */
  const copy = await sendWhatsApp({
    kind: "AGREEMENT_COPY",
    to: data.student.phone,
    vars: {
      name: firstName(data.student.fullName),
      copy_url: signedCopyUrl(token),
      document_no: row.documentNo,
    },
    bodySummary: `Agreement ${row.documentNo} — countersigned copy`,
    agreementId: row.id,
    leadId: row.leadId,
    studentId: row.studentId,
  });
  await recordAgreementEvent(row.id, copy.sent ? "DELIVERY_SENT" : "DELIVERY_SKIPPED", {
    meta: { kind: "AGREEMENT_COPY", status: copy.status, error: copy.error ?? null },
  });

  return { ok: true, data: { documentNo: row.documentNo } };
}

export async function declineAgreement(token: string, reason: string): Promise<ActionResult> {
  const { ip, userAgent } = await requestContext();
  if (!rateLimitOk(`agr:decline:ip:${ip}`, 10, 60 * 60_000)) {
    return { ok: false, error: "Too many attempts from this network." };
  }

  const found = await loadAgreementByToken(token);
  if (!found.ok) return { ok: false, error: FAILURE_MESSAGES[found.reason] };

  const updated = await prisma.agreement.updateMany({
    where: { id: found.row.id, signedAt: null },
    data: {
      status: "DECLINED",
      declinedAt: new Date(),
      declineReason: reason.slice(0, 500) || null,
      tokenHash: null,
      otpHash: null,
    },
  });
  if (updated.count === 0) return { ok: false, error: "This agreement has already been signed." };
  await recordAgreementEvent(found.row.id, "DECLINED", {
    ip,
    userAgent,
    meta: { reason: reason.slice(0, 500) },
  });

  // Only the token backs this one — declining asks for no code — but the link went to their
  // number, and a decline the founder never sees is a deal that goes quiet for no visible
  // reason. The name comes from the agreement row, never from the request.
  const declinedBy = (found.row.data as unknown as AgreementData).student.fullName;
  await logPublicActivity(
    { name: declinedBy, role: "STUDENT" },
    {
      action: "agreement.decline",
      section: "agreements",
      entityType: "Agreement",
      entityId: found.row.id,
      summary: `${declinedBy} declined agreement ${found.row.documentNo}`,
      meta: { documentNo: found.row.documentNo, reason: reason.slice(0, 200) || null },
    },
  );
  return { ok: true };
}
