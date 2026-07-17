"use server";

import { revalidatePath } from "next/cache";
import { headers } from "next/headers";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { capabilityCheck, type AppSession } from "@/lib/rbac";
import { clientIpFrom } from "@/lib/rate-limit";
import { AGREEMENT_TEMPLATE_VERSION } from "@/lib/agreement";
import { contentHash } from "./agreement-render";
import {
  AGREEMENTS_PATH,
  buildSigningDevice,
  decodeSignaturePng,
  firstName,
  isUniqueViolation,
  issueAgreementCore,
  nextDocumentNo,
  parseAgreementData,
  readStoredDevice,
  recordAgreementEvent,
  type ActionResult,
  type SignatureSource,
} from "./agreement-core";
import { logActivity, diffFields } from "./activity-log";
import { getAgreementPrefill } from "./agreement-metrics";
import { clearSavedSignature, getSavedSignature, savedSignatureKey, writeSavedSignature } from "./founder-config";
import type { SavedSignature } from "@/lib/config-schema";
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
  const { allowed, denied, session } = await capabilityCheck("agreements.issue");
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
      await logActivity(session, {
        action: "agreement.create",
        section: "agreements",
        entityType: "Agreement",
        entityId: row.id,
        summary: `Created a draft agreement for ${parsed.data.student.fullName}`,
        meta: { leadId: input.leadId ?? null, studentId: input.studentId ?? null },
      });
      revalidatePath(AGREEMENTS_PATH);
      return { ok: true, data: { id: row.id } };
    } catch (e) {
      if (!isUniqueViolation(e)) throw e; // someone raced us to this document number
    }
  }
  return { ok: false, error: "Could not allocate a document number. Try again." };
}

export async function updateAgreement(id: string, data: unknown): Promise<ActionResult> {
  const { allowed, denied, session } = await capabilityCheck("agreements.issue");
  if (!allowed) return denied;

  const parsed = parseAgreementData(data);
  if (!parsed.ok) return parsed;

  const before = await prisma.agreement.findUnique({ where: { id }, select: { data: true } });

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

  const d = diffFields(
    (before?.data ?? {}) as Record<string, unknown>,
    parsed.data as unknown as Record<string, unknown>,
  );
  if (d.changed.length > 0) {
    await logActivity(session, {
      action: "agreement.update",
      section: "agreements",
      entityType: "Agreement",
      entityId: id,
      summary: `Edited the draft agreement for ${parsed.data.student.fullName}`,
      meta: { changed: d.changed, before: d.before, after: d.after },
    });
  }
  revalidatePath(AGREEMENTS_PATH);
  revalidatePath(`${AGREEMENTS_PATH}/${id}`);
  return { ok: true };
}

/**
 * Countersign and send with a freshly drawn signature. The founder signs first, exactly as the
 * master document reads. The body lives in `issueAgreementCore` — see the note there on why.
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

  const issued = await issueAgreementCore({
    id,
    png,
    founderDevice: await founderDeviceFrom(device),
    session,
    signature: { source: "drawn" },
  });
  if (issued.ok) await logIssued(session, id, "drawn");
  return issued;
}

/** The browser's claims about this session, stapled to the IP + UA our server actually observed. */
async function founderDeviceFrom(device: unknown) {
  const h = await Promise.resolve(headers());
  return buildSigningDevice(device, { ip: clientIpFrom(h), userAgent: h.get("user-agent") });
}

/**
 * The device record for an issue that STAMPED STORED INK rather than drawing it.
 *
 * Each half is taken from the moment it actually happened, because a contract's device record is
 * only worth anything if every field is true:
 *   reported — THIS session's browser (the founder is issuing from here, now)
 *   capture  — how the ink was really drawn, back at `savedAt`. Never synthesised: a `capture`
 *              invented at issue time would be a fabricated claim about a signature's provenance.
 *   observed — the IP/UA our server sees on THIS request (added by founderDeviceFrom).
 */
async function savedSignatureDevice(reported: unknown, saved: SavedSignature) {
  const savedDevice = readStoredDevice(saved.savedDevice);
  return founderDeviceFrom({
    reported: reported ?? savedDevice?.reported,
    capture: savedDevice?.capture,
  });
}

/**
 * Who this agreement is for, for the activity feed's sentence. Read fresh rather than threaded
 * through: the founder reads a name, and the row is the only place one is stored.
 */
async function agreementParty(id: string) {
  const row = await prisma.agreement.findUnique({
    where: { id },
    select: { data: true, documentNo: true },
  });
  const parsed = row ? parseAgreementData(row.data) : null;
  return {
    documentNo: row?.documentNo ?? null,
    name: parsed?.ok ? parsed.data.student.fullName : "a client",
  };
}

/**
 * The feed entry shared by all three issue paths.
 *
 * `issueAgreementCore` hands back a signing URL with the raw token in it — the one place that token
 * ever exists. It stops here: `signature` records which ink was stamped, never the credential.
 */
async function logIssued(session: AppSession, id: string, source: SignatureSource["source"]) {
  const party = await agreementParty(id);
  await logActivity(session, {
    action: "agreement.issue",
    section: "agreements",
    entityType: "Agreement",
    entityId: id,
    summary: `Issued an agreement to ${party.name}`,
    meta: { documentNo: party.documentNo, signature: source },
  });
}

// ───────────────────── Saved countersignature (one-tap issue) ─────────────────────

/**
 * Store the founder's countersignature once so issuing becomes one tap.
 *
 * The data URL is decoded and checked here (magic number + size) before it is stored, so a
 * malformed blob can never sit in the settings row waiting to fail at issue time.
 */
export async function saveFounderSignature(dataUrl: string, device?: unknown): Promise<ActionResult> {
  const { allowed, denied, session } = await capabilityCheck("agreements.issue");
  if (!allowed) return denied;

  if (!decodeSignaturePng(dataUrl)) {
    return { ok: false, error: "Your signature didn't come through. Draw it again." };
  }
  await writeSavedSignature(session.user.id, {
    dataUrl,
    savedAt: new Date().toISOString(),
    savedDevice: (await founderDeviceFrom(device)) ?? null,
  });
  await logActivity(session, {
    action: "agreement.signature.create",
    section: "agreements",
    entityType: "AppSetting",
    entityId: savedSignatureKey(session.user.id),
    summary: `Saved their countersignature for one-tap issuing`,
  });
  revalidatePath(AGREEMENTS_PATH);
  return { ok: true };
}

export async function forgetFounderSignature(): Promise<ActionResult> {
  const { allowed, denied, session } = await capabilityCheck("agreements.issue");
  if (!allowed) return denied;
  await clearSavedSignature(session.user.id);
  await logActivity(session, {
    action: "agreement.signature.delete",
    section: "agreements",
    entityType: "AppSetting",
    entityId: savedSignatureKey(session.user.id),
    summary: `Removed their saved countersignature`,
  });
  revalidatePath(AGREEMENTS_PATH);
  return { ok: true };
}

/** `needsSignature` = nothing stored yet; the caller should offer the draw-once pad. */
export type IssueOutcome =
  | { kind: "sent"; signingUrl: string; delivery: string; sent: boolean }
  | { kind: "needsSignature" };

/**
 * Countersign an existing draft with the stored signature — no modal, no redraw.
 * `reported` is this browser's own account of itself (collectReportedDevice), not the ink.
 */
export async function issueAgreementWithSavedSignature(
  id: string,
  reported?: unknown,
): Promise<ActionResult<IssueOutcome>> {
  const { allowed, denied, session } = await capabilityCheck("agreements.issue");
  if (!allowed) return denied;

  const saved = await getSavedSignature(session.user.id);
  if (!saved) return { ok: true, data: { kind: "needsSignature" } };

  const png = decodeSignaturePng(saved.dataUrl);
  if (!png) return { ok: false, error: "Your saved signature is unreadable. Save it again." };

  const issued = await issueAgreementCore({
    id,
    png,
    founderDevice: await savedSignatureDevice(reported, saved),
    session,
    signature: { source: "saved", savedAt: saved.savedAt },
  });
  if (!issued.ok) return issued;
  await logIssued(session, id, "saved");
  return { ok: true, data: { kind: "sent", ...issued.data! } };
}

/** `needsForm` = the CRM cannot answer every field a contract needs; go type them. */
export type GenerateOutcome =
  | { kind: "sent"; id: string; signingUrl: string; delivery: string; sent: boolean }
  | { kind: "needsForm"; href: string; missing: string[] }
  | { kind: "needsSignature" };

/**
 * The one-click path: prefill → draft → countersign → send, in a single call.
 *
 * It refuses to guess. If the CRM has no postal address (nothing in the schema holds one, and no
 * previous agreement exists to lift it from), this returns `needsForm` and the founder types the
 * two fields — rather than issuing a contract with a blank §2 header. An existing draft for the
 * same client is reused instead of stacking a second one.
 */
export async function generateAndSendAgreement(input: {
  leadId?: string | null;
  studentId?: string | null;
  /** This browser's account of itself (collectReportedDevice) — not the signature. */
  reported?: unknown;
}): Promise<ActionResult<GenerateOutcome>> {
  const { allowed, denied, session } = await capabilityCheck("agreements.issue");
  if (!allowed) return denied;
  if (!input.leadId && !input.studentId) return { ok: false, error: "No client selected." };

  const href = `/agreements/new?${input.leadId ? `leadId=${input.leadId}` : `studentId=${input.studentId}`}`;
  const prefill = await getAgreementPrefill({ leadId: input.leadId, studentId: input.studentId });
  if (prefill.missing.length > 0) {
    return { ok: true, data: { kind: "needsForm", href, missing: prefill.missing } };
  }

  const saved = await getSavedSignature(session.user.id);
  if (!saved) return { ok: true, data: { kind: "needsSignature" } };
  const png = decodeSignaturePng(saved.dataUrl);
  if (!png) return { ok: false, error: "Your saved signature is unreadable. Save it again." };

  // Reuse a draft the founder already started rather than stacking a second one on the client.
  const existing = await prisma.agreement.findFirst({
    where: {
      status: "DRAFT",
      ...(input.leadId
        ? { OR: [{ leadId: input.leadId }, { student: { leadId: input.leadId } }] }
        : { studentId: input.studentId! }),
    },
    orderBy: { createdAt: "desc" },
    select: { id: true },
  });

  let id = existing?.id;
  if (!id) {
    const created = await createAgreement({
      data: prefill.data,
      leadId: prefill.leadId,
      studentId: prefill.studentId,
    });
    if (!created.ok) return created;
    id = created.data!.id;
  }

  const issued = await issueAgreementCore({
    id,
    png,
    founderDevice: await savedSignatureDevice(input.reported, saved),
    session,
    signature: { source: "saved", savedAt: saved.savedAt },
  });
  if (!issued.ok) return issued;
  await logIssued(session, id, "saved");
  return { ok: true, data: { kind: "sent", id, ...issued.data! } };
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
  await logActivity(session, {
    action: "agreement.resend",
    section: "agreements",
    entityType: "Agreement",
    entityId: id,
    summary: `Sent a signing reminder to ${parsed.data.student.fullName}`,
    meta: { documentNo: row.documentNo, sent: outcome.sent, error: outcome.error ?? null },
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
  const party = await agreementParty(id);
  await logActivity(session, {
    action: "agreement.void",
    section: "agreements",
    entityType: "Agreement",
    entityId: id,
    summary: `Voided the agreement for ${party.name}`,
    meta: { documentNo: party.documentNo, reason: reason.slice(0, 300) },
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
