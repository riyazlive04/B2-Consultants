"use server";

import { headers } from "next/headers";
import { Prisma } from "@prisma/client";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { clientIpFrom, rateLimitOk } from "@/lib/rate-limit";
import { OTP_MAX_ATTEMPTS, type AgreementData } from "@/lib/agreement";
import { hashAgreementToken, mintOtp, otpMatches } from "@/lib/agreement-token";
import { signerValuesSchema, validateSignerValues } from "@/lib/agreement-doc";
import {
  buildSigningDevice,
  decodeSignaturePng,
  firstName,
  maskPhone,
  otpDevEchoEnabled,
  recordAgreementEvent,
  type ActionResult,
} from "./agreement-core";
import { uploadedBodyFor } from "./agreement-body";
import { attachmentsSatisfied } from "./agreement-attachments";
import { loadSignerByToken, type SignerFailure } from "./agreement-signers";
import { logPublicActivity } from "./activity-log";
import { sendWhatsApp } from "./whatsapp";

/**
 * The CO-SIGNER's ceremony - a parent, guardian or witness signing their part.
 *
 * A deliberate mirror of `agreement-sign.ts` rather than a generalisation of it, and the reason is
 * that the two are not the same transaction:
 *
 *   the STUDENT's signature SEALS the document - it renders the PDF, hashes it, burns the token
 *   and freezes the record, all in one write;
 *
 *   a CO-SIGNER's signature RECORDS ink on their own row. Nothing is rendered and nothing is
 *   sealed, because the document is not finished until the student signs it.
 *
 * Folding both into one function would mean a branch around the single most consequential write
 * in this codebase. Two files, each doing one thing completely, is the safer shape - and the
 * shared parts (OTP minting, device capture, signature decoding, masking) are imported from
 * `agreement-core`, so nothing is duplicated except the sequence itself.
 *
 * PUBLIC by necessity: a guardian has no account. The token is the only credential, the one-time
 * code to their own number is the identity binding, and every failure mode is re-checked on every
 * call.
 */

const FAILURE_MESSAGES: Record<SignerFailure, string> = {
  invalid: "This signing link is not valid.",
  expired: "This signing link has expired. Please ask B2 Consultants for a new one.",
  used: "You have already signed this agreement.",
  declined: "You declined to sign this agreement.",
  blocked: "This agreement is no longer waiting for your signature.",
};

async function requestContext() {
  const h = await Promise.resolve(headers());
  return { ip: clientIpFrom(h), userAgent: h.get("user-agent") ?? null };
}

/** What the co-signer's page shows before it renders anything. Reveals nothing on failure. */
export async function inspectCoSigner(token: string): Promise<
  | {
      ok: true;
      documentNo: string;
      signerName: string;
      studentName: string;
      maskedPhone: string;
      otpPending: boolean;
    }
  | { ok: false; error: string }
> {
  const found = await loadSignerByToken(token);
  if (!found.ok) return { ok: false, error: FAILURE_MESSAGES[found.reason] };

  const data = found.row.agreement.data as unknown as AgreementData;
  return {
    ok: true,
    documentNo: found.row.agreement.documentNo,
    signerName: found.row.name,
    studentName: data.student.fullName,
    maskedPhone: maskPhone(found.row.phone),
    otpPending: !!found.row.otpHash && (found.row.otpExpiresAt?.getTime() ?? 0) > Date.now(),
  };
}

/** Send (or re-send) the code to the CO-SIGNER's own number - never to one the caller supplies. */
export async function requestCoSignOtp(
  token: string,
): Promise<ActionResult<{ maskedPhone: string; devCode?: string }>> {
  const { ip, userAgent } = await requestContext();
  const tokenHash = hashAgreementToken(token);

  if (!rateLimitOk(`agr:cosign:otp:tok:${tokenHash}`, 5, 15 * 60_000)) {
    return { ok: false, error: "Too many codes requested. Wait a few minutes and try again." };
  }
  if (!rateLimitOk(`agr:cosign:otp:ip:${ip}`, 20, 60 * 60_000)) {
    return { ok: false, error: "Too many requests from this network." };
  }

  const found = await loadSignerByToken(token);
  if (!found.ok) return { ok: false, error: FAILURE_MESSAGES[found.reason] };
  const { row } = found;

  const { code, codeHash, expiresAt } = mintOtp();
  // A fresh code resets the attempt counter, or five typos would lock a guardian out of a document
  // only they can unblock.
  await prisma.agreementSigner.update({
    where: { id: row.id },
    data: { otpHash: codeHash, otpExpiresAt: expiresAt, otpAttempts: 0 },
  });

  const data = row.agreement.data as unknown as AgreementData;
  const outcome = await sendWhatsApp({
    kind: "AGREEMENT_OTP",
    to: row.phone,
    vars: { name: firstName(row.name), code },
    bodySummary: `Agreement ${row.agreement.documentNo} - co-signer code (${row.name})`,
    agreementId: row.agreementId,
    leadId: row.agreement.leadId,
    studentId: row.agreement.studentId,
  });
  await recordAgreementEvent(row.agreementId, "OTP_SENT", {
    ip,
    userAgent,
    meta: { signer: row.name, role: row.role, delivered: outcome.sent, error: outcome.error ?? null },
  });

  if (!outcome.sent) {
    if (otpDevEchoEnabled()) {
      console.warn(`[agreement ${row.agreement.documentNo}] DEV OTP ECHO (${row.name}): ${code}`);
      return { ok: true, data: { maskedPhone: maskPhone(row.phone), devCode: code } };
    }
    return {
      ok: false,
      error:
        "We could not send your code on WhatsApp. Please contact B2 Consultants on +49 1522 2311 374.",
    };
  }
  void data;
  return { ok: true, data: { maskedPhone: maskPhone(row.phone) } };
}

const coSignSchema = z.object({
  token: z.string().min(10).max(200),
  code: z.string().trim().regex(/^\d{6}$/, "Enter the 6-digit code"),
  signature: z.string().min(64).max(600_000),
  consent: z.literal(true, { message: "Please confirm you agree to sign electronically." }),
  device: z.unknown().optional(),
  fieldValues: z.unknown().optional(),
});

/**
 * Verify, record, burn.
 *
 * NOTHING IS RENDERED AND NOTHING IS SEALED here - that is the whole difference from the student's
 * path. The ink lands on this signer's row and `signedAt` is its own burn marker; the sealing
 * render reads it later, in the write that sets `Agreement.signedAt`.
 */
export async function signAsCoSigner(input: {
  token: string;
  code: string;
  signature: string;
  consent: boolean;
  device?: unknown;
  fieldValues?: unknown;
}): Promise<ActionResult<{ documentNo: string; studentName: string }>> {
  const { ip, userAgent } = await requestContext();
  if (!rateLimitOk(`agr:cosign:sign:ip:${ip}`, 30, 60 * 60_000)) {
    return { ok: false, error: "Too many attempts from this network." };
  }

  const parsed = coSignSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Check the form and try again." };
  }

  const found = await loadSignerByToken(parsed.data.token);
  if (!found.ok) return { ok: false, error: FAILURE_MESSAGES[found.reason] };
  const { row } = found;

  const png = decodeSignaturePng(parsed.data.signature);
  if (!png) return { ok: false, error: "Your signature didn't come through. Please draw it again." };

  // ── Their own boxes, checked before the code is spent (see the note in agreement-sign) ──
  const body = row.agreement.documentKind === "GUIDED" ? null : await uploadedBodyFor(row.agreementId);
  const values = signerValuesSchema.safeParse(parsed.data.fieldValues ?? {});
  if (!values.success) {
    return { ok: false, error: "We could not read your answers. Please reload the page and try again." };
  }
  if (body) {
    const unfilled = validateSignerValues(body.fields, "GUARDIAN", values.data);
    if (unfilled.length > 0) return { ok: false, error: unfilled[0]!.message };

    const attached = await attachmentsSatisfied(row.agreementId, body.fields, "GUARDIAN");
    if (!attached.ok) return { ok: false, error: attached.error };
  }

  // ── One-time code ──
  if (!row.otpHash || !row.otpExpiresAt || row.otpExpiresAt.getTime() <= Date.now()) {
    return { ok: false, error: "Your code has expired. Request a new one." };
  }
  if (row.otpAttempts >= OTP_MAX_ATTEMPTS) {
    return { ok: false, error: "Too many incorrect codes. Request a new one." };
  }
  if (!otpMatches(parsed.data.code, row.otpHash)) {
    await prisma.agreementSigner.update({
      where: { id: row.id },
      data: { otpAttempts: { increment: 1 } },
    });
    await recordAgreementEvent(row.agreementId, "OTP_FAILED", {
      ip,
      userAgent,
      meta: { signer: row.name, role: row.role },
    });
    const left = OTP_MAX_ATTEMPTS - row.otpAttempts - 1;
    return {
      ok: false,
      error:
        left > 0
          ? `That code is not right. ${left} attempt${left === 1 ? "" : "s"} left.`
          : "Too many incorrect codes. Request a new one.",
    };
  }

  const now = new Date();
  await recordAgreementEvent(row.agreementId, "OTP_VERIFIED", {
    ip,
    userAgent,
    meta: { signer: row.name, role: row.role },
  });

  const device = buildSigningDevice(parsed.data.device, { ip, userAgent });

  // `signedAt: null` is the compare-and-set: two tabs, one signature.
  const burned = await prisma.agreementSigner.updateMany({
    where: { id: row.id, signedAt: null },
    data: {
      signedAt: now,
      signaturePng: png,
      device: device ?? Prisma.JsonNull,
      fieldValues:
        Object.keys(values.data).length > 0 ? (values.data as Prisma.InputJsonValue) : Prisma.JsonNull,
      otpHash: null,
      otpExpiresAt: null,
    },
  });
  if (burned.count === 0) return { ok: false, error: "You have already signed this agreement." };

  await recordAgreementEvent(row.agreementId, "SIGNER_SIGNED", {
    ip,
    userAgent,
    meta: {
      signer: row.name,
      role: row.role,
      consent: true,
      device: device ? { pointerType: device.capture.pointerType, strokes: device.capture.strokeCount } : null,
    },
  });

  const data = row.agreement.data as unknown as AgreementData;
  // The token plus the code just proved who they are, so this is a named action on the founder's
  // feed - the same reasoning as the student's own signature.
  await logPublicActivity(
    { name: row.name, role: "STUDENT" },
    {
      action: "agreement.cosign",
      section: "agreements",
      entityType: "Agreement",
      entityId: row.agreementId,
      summary: `${row.name} co-signed agreement ${row.agreement.documentNo} for ${data.student.fullName}`,
      meta: { documentNo: row.agreement.documentNo, role: row.role },
    },
  );

  return { ok: true, data: { documentNo: row.agreement.documentNo, studentName: data.student.fullName } };
}

/**
 * A co-signer refusing.
 *
 * This kills the agreement for everybody: the student's ceremony reads it as a blocker and will
 * not let them sign (see `coSignersBlocking`), which is the correct outcome - a contract that
 * needed a guardian's consent and did not get it is not one the student can rescue by signing
 * harder. The founder voids and clones.
 */
export async function declineAsCoSigner(token: string, reason: string): Promise<ActionResult> {
  const { ip, userAgent } = await requestContext();
  if (!rateLimitOk(`agr:cosign:decline:ip:${ip}`, 10, 60 * 60_000)) {
    return { ok: false, error: "Too many attempts from this network." };
  }

  const found = await loadSignerByToken(token);
  if (!found.ok) return { ok: false, error: FAILURE_MESSAGES[found.reason] };
  const { row } = found;

  const updated = await prisma.agreementSigner.updateMany({
    where: { id: row.id, signedAt: null },
    data: {
      declinedAt: new Date(),
      declineReason: reason.slice(0, 500) || null,
      tokenHash: null,
      otpHash: null,
    },
  });
  if (updated.count === 0) return { ok: false, error: "You have already signed this agreement." };

  await recordAgreementEvent(row.agreementId, "SIGNER_DECLINED", {
    ip,
    userAgent,
    meta: { signer: row.name, role: row.role, reason: reason.slice(0, 500) },
  });

  const data = row.agreement.data as unknown as AgreementData;
  await logPublicActivity(
    { name: row.name, role: "STUDENT" },
    {
      action: "agreement.cosign.decline",
      section: "agreements",
      entityType: "Agreement",
      entityId: row.agreementId,
      // The reason in the summary itself: the feed shows summaries, not meta, and a refusal the
      // founder cannot see the reason for is a deal that goes quiet for no visible cause.
      summary: `${row.name} declined to co-sign agreement ${row.agreement.documentNo} for ${data.student.fullName}${
        reason.trim() ? ` - "${reason.trim().slice(0, 200)}"` : " - no reason given"
      }`,
      meta: { documentNo: row.agreement.documentNo, reason: reason.slice(0, 200) || null },
    },
  );

  return { ok: true };
}
