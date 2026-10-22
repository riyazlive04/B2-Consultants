import "server-only";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { hashAgreementToken, mintAgreementToken } from "@/lib/agreement-token";
import { signerValuesSchema, type DocField, type SignerValues } from "@/lib/agreement-doc";
import { storedDeviceSchema } from "@/lib/device";
import { emailCoSignerLink } from "./agreement-email";
import { recordAgreementEvent } from "./agreement-core";
import { getAgreementWorkflow } from "./founder-config";
import { sendWhatsApp } from "./whatsapp";

/**
 * Additional signers - a parent or guardian co-signing for a student under 18, or a witness.
 *
 * ── THE ORDERING RULE, AND WHY IT IS NOT NEGOTIABLE ─────────────────────────────────────────
 * Co-signers sign BEFORE the student. `signAgreement` renders the PDF and hashes it in the same
 * write that sets `Agreement.signedAt`, and `agreement_seal_immutable` then freezes those bytes
 * forever. A signature collected after the student's could therefore only reach the document by
 * re-rendering a contract somebody had already signed - so instead the student's ceremony waits,
 * and their signature stays the thing that seals.
 *
 * The alternative designs were both worse: loosening the trigger gives up the module's strongest
 * guarantee, and sealing on "whoever is last" makes the seal depend on the order people happen to
 * open their email.
 *
 * ── A CO-SIGNER IS A FULL COUNTERPARTY ──────────────────────────────────────────────────────
 * Their own token (hash only), their own one-time code to their own number, their own device
 * record, their own decline. Nothing is shared with the student's link: a guardian who forwards
 * their email cannot sign as the student, and vice versa.
 *
 * This file has NO "use server" directive on purpose - it is internals. The callable endpoints
 * live in `agreement-cosign.ts` (the counterparty's ceremony) and `agreement-actions.ts` (the
 * founder's management of the list), each behind its own check.
 */

/** Never `signaturePng`, never `device` - the two heavy/sensitive columns. */
export const SIGNER_SELECT = {
  id: true,
  agreementId: true,
  role: true,
  name: true,
  phone: true,
  email: true,
  expiresAt: true,
  signedAt: true,
  declinedAt: true,
  declineReason: true,
  position: true,
  fieldValues: true,
  createdAt: true,
} as const;

export type SignerRow = Prisma.AgreementSignerGetPayload<{ select: typeof SIGNER_SELECT }>;

export async function listAgreementSigners(agreementId: string): Promise<SignerRow[]> {
  return prisma.agreementSigner.findMany({
    where: { agreementId },
    select: SIGNER_SELECT,
    orderBy: [{ position: "asc" }, { createdAt: "asc" }],
  });
}

/**
 * Does this document NEED a co-signer?
 *
 * Answered from the placed fields, not from the presence of signer rows - the fields are the
 * contract's own statement that a guardian has something to sign, and a document that asks for a
 * guardian signature with nobody invited is an unfinished draft rather than a document with no
 * guardian.
 */
export function documentNeedsCoSigner(fields: readonly DocField[]): boolean {
  return fields.some((f) => f.signer === "GUARDIAN");
}

/**
 * Everything standing between this agreement and the student being able to sign.
 *
 * Returns a sentence per obstacle, in the words the student will read. Empty means they may go
 * ahead. Called by their ceremony as it loads AND by `signAgreement` before anything is sealed.
 */
export async function coSignersBlocking(
  agreementId: string,
  fields: readonly DocField[],
): Promise<string[]> {
  if (!documentNeedsCoSigner(fields)) return [];

  const signers = await listAgreementSigners(agreementId);
  const guardians = signers.filter((s) => s.role === "GUARDIAN");

  if (guardians.length === 0) {
    return [
      "This agreement needs a parent or guardian to co-sign, and nobody has been invited yet. Please contact B2 Consultants.",
    ];
  }

  const declined = guardians.find((s) => s.declinedAt);
  if (declined) {
    return [`${declined.name} declined to co-sign this agreement. Please contact B2 Consultants.`];
  }

  const waiting = guardians.filter((s) => !s.signedAt);
  return waiting.map(
    (s) => `${s.name} still has to co-sign this agreement before you can sign it.`,
  );
}

/**
 * The co-signer whose ink goes on the sealed document.
 *
 * One guardian is supported on the document because `DocField.signer` is a role, not a person -
 * two guardians would both own the same boxes and the renderer could not say whose ink belongs in
 * which. The FIRST to have signed is the one that counts, and `issueSignerLinks` refuses to
 * create a second guardian for exactly this reason.
 */
export async function signedGuardianFor(agreementId: string): Promise<{
  name: string;
  signaturePng: Uint8Array | null;
  signedAt: Date | null;
  values: SignerValues | null;
} | null> {
  const row = await prisma.agreementSigner.findFirst({
    where: { agreementId, role: "GUARDIAN", signedAt: { not: null } },
    orderBy: { position: "asc" },
    select: { name: true, signaturePng: true, signedAt: true, fieldValues: true },
  });
  if (!row) return null;
  const values = signerValuesSchema.safeParse(row.fieldValues ?? {});
  return {
    name: row.name,
    signaturePng: row.signaturePng,
    signedAt: row.signedAt,
    values: values.success ? values.data : null,
  };
}

// ───────────────────────────── Issuing their links ─────────────────────────────

export type SignerDelivery = { name: string; sent: boolean; note: string };

/**
 * Mint a link for every co-signer and deliver it. Called from `issueAgreementCore`, inside the
 * same action that countersigns - so a guardian is invited at the moment the contract goes out,
 * never as a separate step somebody can forget.
 *
 * Fail-safe like every other delivery seam here: a guardian whose message fails still has a live
 * token, and the founder is told which one to chase.
 */
export async function issueSignerLinks(input: {
  agreementId: string;
  documentNo: string;
  studentName: string;
  sentById: string;
  leadId?: string | null;
  studentId?: string | null;
}): Promise<SignerDelivery[]> {
  const workflow = await getAgreementWorkflow();
  const signers = await listAgreementSigners(input.agreementId);
  const out: SignerDelivery[] = [];

  for (const signer of signers) {
    const { token, tokenHash, expiresAt } = mintAgreementToken(workflow.ttlDays);
    await prisma.agreementSigner.update({
      where: { id: signer.id },
      data: { tokenHash, expiresAt, otpHash: null, otpExpiresAt: null, otpAttempts: 0 },
    });

    const url = coSignUrl(token);
    const wantsWhatsApp = workflow.deliverBy !== "EMAIL";
    const wantsEmail = workflow.deliverBy !== "WHATSAPP";

    /**
     * A co-signer's link rides the SAME WATI template as the student's.
     *
     * Binding a second template would mean a second approval to wait on, and the message says the
     * same thing to the same purpose - "here is a document to sign". The name in it is theirs, so
     * nobody is addressed as somebody else.
     */
    const whatsapp = wantsWhatsApp
      ? await sendWhatsApp({
          kind: "AGREEMENT_SEND",
          to: signer.phone,
          vars: {
            name: firstWord(signer.name),
            sign_url: url,
            sign_token: token,
            document_no: input.documentNo,
          },
          sentById: input.sentById,
          bodySummary: `Agreement ${input.documentNo} - co-signer link (${signer.name})`,
          agreementId: input.agreementId,
          leadId: input.leadId,
          studentId: input.studentId,
        })
      : null;

    const email =
      wantsEmail && signer.email
        ? await emailCoSignerLink({
            to: signer.email,
            name: signer.name,
            studentName: input.studentName,
            documentNo: input.documentNo,
            signingUrl: url,
            expiresAt,
          })
        : null;

    const sent = !!whatsapp?.sent || !!email?.sent;
    await recordAgreementEvent(input.agreementId, sent ? "DELIVERY_SENT" : "DELIVERY_SKIPPED", {
      meta: {
        kind: "CO_SIGNER_SEND",
        signer: signer.name,
        role: signer.role,
        whatsapp: whatsapp ? { sent: whatsapp.sent, error: whatsapp.error ?? null } : null,
        email: email ? { sent: email.sent, error: email.error ?? null } : null,
      },
    });

    out.push({
      name: signer.name,
      sent,
      note: sent
        ? `${signer.name}: link ${[whatsapp?.sent && "sent on WhatsApp", email?.sent && "emailed"].filter(Boolean).join(" and ")}`
        : `${signer.name}: link did NOT go out (${whatsapp?.error ?? email?.error ?? "no channel available"}) - the link is ${url}`,
    });
  }

  return out;
}

/** Where a co-signer signs. Same route as the student's; the token says which of them it is. */
export function coSignUrl(token: string): string {
  const origin = (process.env.BETTER_AUTH_URL ?? "").replace(/\/+$/, "");
  return `${origin}/agreement/${token}`;
}

function firstWord(full: string): string {
  return full.trim().split(/\s+/)[0] || full.trim() || "there";
}

// ───────────────────────────── Token lookup ─────────────────────────────

export type SignerFailure = "invalid" | "expired" | "used" | "declined" | "blocked";

/** Only these columns, and never the parent's `pdfBytes`. */
const TOKEN_SELECT = {
  id: true,
  agreementId: true,
  role: true,
  name: true,
  phone: true,
  email: true,
  expiresAt: true,
  signedAt: true,
  declinedAt: true,
  otpHash: true,
  otpExpiresAt: true,
  otpAttempts: true,
  agreement: {
    select: {
      id: true,
      documentNo: true,
      documentKind: true,
      templateVersion: true,
      status: true,
      data: true,
      signedAt: true,
      leadId: true,
      studentId: true,
      founderSignedAt: true,
    },
  },
} as const;

export type SignerTokenRow = Prisma.AgreementSignerGetPayload<{ select: typeof TOKEN_SELECT }>;

/**
 * Resolve a raw co-signer token. Reveals nothing on failure beyond the reason.
 *
 * `blocked` is the state unique to a co-signer: the agreement itself was voided, declined by the
 * student or already sealed, so their part is moot. It is checked against the PARENT, because a
 * co-signer's own row knows nothing about it.
 */
export async function loadSignerByToken(
  token: string,
): Promise<{ ok: true; row: SignerTokenRow } | { ok: false; reason: SignerFailure }> {
  if (!token || token.length < 10 || token.length > 200) return { ok: false, reason: "invalid" };

  const row = await prisma.agreementSigner.findUnique({
    where: { tokenHash: hashAgreementToken(token) },
    select: TOKEN_SELECT,
  });
  if (!row) return { ok: false, reason: "invalid" };
  if (row.signedAt) return { ok: false, reason: "used" };
  if (row.declinedAt) return { ok: false, reason: "declined" };
  if (row.expiresAt && row.expiresAt.getTime() <= Date.now()) return { ok: false, reason: "expired" };

  const parent = row.agreement;
  if (parent.signedAt || parent.status === "VOIDED" || parent.status === "DECLINED") {
    return { ok: false, reason: "blocked" };
  }
  return { ok: true, row };
}

/** Read a signer's stored device record back into a typed object. A Json column is not a type. */
export function readSignerDevice(raw: unknown) {
  const parsed = storedDeviceSchema.safeParse(raw);
  return parsed.success ? parsed.data : null;
}
