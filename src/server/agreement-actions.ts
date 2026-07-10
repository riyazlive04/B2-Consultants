"use server";

import { revalidatePath } from "next/cache";
import { headers } from "next/headers";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { capabilityCheck } from "@/lib/rbac";
import { clientIpFrom } from "@/lib/rate-limit";
import { AGREEMENT_TEMPLATE_VERSION } from "@/lib/agreement";
import { mintAgreementToken } from "@/lib/agreement-token";
import { contentHash } from "./agreement-render";
import {
  AGREEMENTS_PATH,
  buildSigningDevice,
  decodeSignaturePng,
  firstName,
  isUniqueViolation,
  nextDocumentNo,
  parseAgreementData,
  recordAgreementEvent,
  signingUrl,
  type ActionResult,
} from "./agreement-core";
import { sendWhatsApp } from "./whatsapp";

/**
 * Founder-side agreement lifecycle: draft → countersign → issue → (void / clone).
 *
 * WHAT IS DELIBERATELY MISSING: an edit path for an issued agreement. Once the link is out the
 * student may already be reading the document, and a contract that mutates under the counterparty
 * is not a contract. The founder voids and clones instead, which leaves both rows in the trail.
 *
 * Every export here is a public RPC endpoint (this file is "use server"), so every one of them
 * starts with a capability check. Helpers live in agreement-core.ts.
 */

export async function createAgreement(input: {
  data: unknown;
  leadId?: string | null;
  studentId?: string | null;
}): Promise<ActionResult<{ id: string }>> {
  const { allowed, denied } = await capabilityCheck("agreements.issue");
  if (!allowed) return denied;

  const parsed = parseAgreementData(input.data);
  if (!parsed.ok) return parsed;

  for (let attempt = 0; attempt < 5; attempt++) {
    try {
      const row = await prisma.agreement.create({
        data: {
          documentNo: await nextDocumentNo(),
          templateVersion: AGREEMENT_TEMPLATE_VERSION,
          data: parsed.data as unknown as Prisma.InputJsonValue,
          dataSha256: contentHash(parsed.data),
          leadId: input.leadId || null,
          studentId: input.studentId || null,
        },
        select: { id: true },
      });
      await recordAgreementEvent(row.id, "CREATED");
      revalidatePath(AGREEMENTS_PATH);
      return { ok: true, data: { id: row.id } };
    } catch (e) {
      if (!isUniqueViolation(e)) throw e; // someone raced us to this document number
    }
  }
  return { ok: false, error: "Could not allocate a document number. Try again." };
}

export async function updateAgreement(id: string, data: unknown): Promise<ActionResult> {
  const { allowed, denied } = await capabilityCheck("agreements.issue");
  if (!allowed) return denied;

  const parsed = parseAgreementData(data);
  if (!parsed.ok) return parsed;

  // Compare-and-set on status: an agreement that went out while this form sat open must not
  // silently absorb the founder's edits.
  const updated = await prisma.agreement.updateMany({
    where: { id, status: "DRAFT" },
    data: {
      data: parsed.data as unknown as Prisma.InputJsonValue,
      dataSha256: contentHash(parsed.data),
    },
  });
  if (updated.count === 0) {
    return { ok: false, error: "This agreement has already been issued. Void it and clone instead." };
  }
  revalidatePath(AGREEMENTS_PATH);
  revalidatePath(`${AGREEMENTS_PATH}/${id}`);
  return { ok: true };
}

/**
 * Countersign and send. The founder signs first, exactly as the master document reads.
 *
 * Note what does NOT happen here: no PDF is rendered. The student reads a live render of the same
 * component, and the one authoritative render happens at the moment they sign. Producing an
 * "unsigned PDF" now would only create a second artifact nobody should ever be holding.
 */
export async function issueAgreement(
  id: string,
  founderSignatureDataUrl: string,
  device?: unknown,
): Promise<ActionResult<{ signingUrl: string; delivery: string; sent: boolean }>> {
  const { allowed, denied, session } = await capabilityCheck("agreements.issue");
  if (!allowed) return denied;

  const png = decodeSignaturePng(founderSignatureDataUrl);
  if (!png) return { ok: false, error: "Your signature didn't come through. Draw it again." };

  const h = await Promise.resolve(headers());
  const founderDevice = buildSigningDevice(device, {
    ip: clientIpFrom(h),
    userAgent: h.get("user-agent"),
  });

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
  await recordAgreementEvent(id, "ISSUED", { meta: { by: session.user.email } });

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

/**
 * Nudge an unsigned agreement.
 *
 * The reminder carries no link, because it cannot: only the token's hash was stored, and the raw
 * token was shown to the founder exactly once at issue. The student opens the link they already
 * have. (Minting a fresh token here would silently break the one in their chat.)
 */
export async function resendAgreementLink(id: string): Promise<ActionResult<{ delivery: string }>> {
  const { allowed, denied, session } = await capabilityCheck("agreements.issue");
  if (!allowed) return denied;

  const row = await prisma.agreement.findUnique({
    where: { id },
    select: {
      id: true,
      status: true,
      data: true,
      documentNo: true,
      expiresAt: true,
      leadId: true,
      studentId: true,
    },
  });
  if (!row) return { ok: false, error: "Agreement not found." };
  if (row.status !== "SENT" && row.status !== "VIEWED") {
    return { ok: false, error: "Only an issued, unsigned agreement can be reminded." };
  }
  if (row.expiresAt && row.expiresAt.getTime() <= Date.now()) {
    return { ok: false, error: "The signing link has expired. Void this agreement and clone it." };
  }

  const parsed = parseAgreementData(row.data);
  if (!parsed.ok) return { ok: false, error: parsed.error };

  const outcome = await sendWhatsApp({
    kind: "AGREEMENT_REMINDER",
    to: parsed.data.student.phone,
    vars: { name: firstName(parsed.data.student.fullName), document_no: row.documentNo },
    sentById: session.user.id,
    bodySummary: `Agreement ${row.documentNo} — reminder`,
    agreementId: id,
    leadId: row.leadId,
    studentId: row.studentId,
  });
  await recordAgreementEvent(id, outcome.sent ? "DELIVERY_SENT" : "DELIVERY_SKIPPED", {
    meta: { kind: "AGREEMENT_REMINDER", error: outcome.error ?? null },
  });

  revalidatePath(`${AGREEMENTS_PATH}/${id}`);
  return {
    ok: true,
    data: {
      delivery: outcome.sent
        ? "Reminder sent on WhatsApp."
        : `WhatsApp did not send: ${outcome.error ?? "unknown reason"}.`,
    },
  };
}

export async function voidAgreement(id: string, reason: string): Promise<ActionResult> {
  const { allowed, denied, session } = await capabilityCheck("agreements.issue");
  if (!allowed) return denied;

  // Clearing the token hash kills the outstanding link the instant this commits.
  const updated = await prisma.agreement.updateMany({
    where: { id, signedAt: null },
    data: { status: "VOIDED", voidedAt: new Date(), tokenHash: null, otpHash: null },
  });
  if (updated.count === 0) return { ok: false, error: "A signed agreement cannot be voided." };
  await recordAgreementEvent(id, "VOIDED", {
    meta: { reason: reason.slice(0, 300), by: session.user.email },
  });
  revalidatePath(AGREEMENTS_PATH);
  revalidatePath(`${AGREEMENTS_PATH}/${id}`);
  return { ok: true };
}

/** Void this one and open a fresh draft carrying the same fields — the "edit after send" path. */
export async function cloneAgreement(id: string): Promise<ActionResult<{ id: string }>> {
  const { allowed, denied } = await capabilityCheck("agreements.issue");
  if (!allowed) return denied;

  const row = await prisma.agreement.findUnique({
    where: { id },
    select: { data: true, leadId: true, studentId: true, status: true },
  });
  if (!row) return { ok: false, error: "Agreement not found." };

  // A signed agreement is never voided — it is superseded by the new draft, and both survive.
  if (row.status !== "SIGNED" && row.status !== "VOIDED") {
    const voided = await voidAgreement(id, "Superseded by a revised agreement");
    if (!voided.ok) return voided;
  }
  return createAgreement({ data: row.data, leadId: row.leadId, studentId: row.studentId });
}
