"use server";

import { revalidatePath } from "next/cache";
import { headers } from "next/headers";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { capabilityCheck, type AppSession } from "@/lib/rbac";
import { clientIpFrom } from "@/lib/rate-limit";
import { AGREEMENT_TEMPLATE_VERSION } from "@/lib/agreement";
import {
  docBlocksSchema,
  docFieldsSchema,
  docOptionsSchema,
  UPLOAD_TEMPLATE_VERSIONS,
  type DocBlock,
  type DocBody,
} from "@/lib/agreement-doc";
import { getDefaultTemplateChoice, loadVersionForInstantiate } from "./agreement-templates";
import {
  BODY_SELECT,
  BODY_SELECT_WITH_BYTES,
  documentReadiness,
  loadAgreementBody,
  parseBodyRow,
} from "./agreement-body";
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
  signingUrl,
  recordAgreementEvent,
  type ActionResult,
  type SignatureSource,
} from "./agreement-core";
import { logActivity, diffFields } from "./activity-log";
import { normalizeWhatsappNumber } from "@/lib/phone";
import { mintAgreementToken } from "@/lib/agreement-token";
import { emailSigningReminder } from "./agreement-email";
import { getAgreementWorkflow } from "./founder-config";
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
  /**
   * Draw the document up from a template instead of the guided clause set. The template's
   * CURRENT version is COPIED onto this agreement's own body - blocks, placed fields and the
   * uploaded file - so a later edit to the template can never reach this contract.
   *
   * Absent means GUIDED, which is every agreement this app made before templates existed.
   */
  templateId?: string | null;
}): Promise<ActionResult<{ id: string }>> {
  const { allowed, denied, session } = await capabilityCheck("agreements.issue");
  if (!allowed) return denied;

  const parsed = parseAgreementData(input.data);
  if (!parsed.ok) return parsed;

  // Resolved BEFORE the create loop: a template that cannot be instantiated must fail without
  // having burnt a document number, and the body is written in the same transaction as the row.
  type Instantiated = Extract<Awaited<ReturnType<typeof resolveTemplateBody>>, { ok: true }>;
  let instantiate: Instantiated | null = null;
  if (input.templateId) {
    const resolved = await resolveTemplateBody(input.templateId);
    if (!resolved.ok) return { ok: false, error: resolved.error };
    instantiate = resolved;
  }

  for (let attempt = 0; attempt < 5; attempt++) {
    try {
      const row = await prisma.agreement.create({
        data: {
          documentNo: await nextDocumentNo(),
          templateVersion: instantiate
            ? UPLOAD_TEMPLATE_VERSIONS[instantiate.body.kind]
            : AGREEMENT_TEMPLATE_VERSION,
          documentKind: instantiate ? instantiate.body.kind : "GUIDED",
          data: parsed.data as unknown as Prisma.InputJsonValue,
          dataSha256: contentHash(
            parsed.data,
            instantiate ? UPLOAD_TEMPLATE_VERSIONS[instantiate.body.kind] : AGREEMENT_TEMPLATE_VERSION,
            instantiate?.body ?? null,
          ),
          leadId: input.leadId || null,
          studentId: input.studentId || null,
          // A nested create, so an agreement that says it has an uploaded document always has one.
          ...(instantiate ? { body: { create: instantiate.create } } : {}),
        },
        select: { id: true },
      });
      await recordAgreementEvent(row.id, "CREATED", {
        meta: instantiate
          ? { template: instantiate.templateName, version: instantiate.version, kind: instantiate.body.kind }
          : { kind: "GUIDED" },
      });
      await logActivity(session, {
        action: "agreement.create",
        section: "agreements",
        entityType: "Agreement",
        entityId: row.id,
        summary: instantiate
          ? `Created a draft agreement for ${parsed.data.student.fullName} from “${instantiate.templateName}” v${instantiate.version}`
          : `Created a draft agreement for ${parsed.data.student.fullName}`,
        meta: {
          leadId: input.leadId ?? null,
          studentId: input.studentId ?? null,
          templateId: input.templateId ?? null,
        },
      });
      revalidatePath(AGREEMENTS_PATH);
      return { ok: true, data: { id: row.id } };
    } catch (e) {
      if (!isUniqueViolation(e)) throw e; // someone raced us to this document number
    }
  }
  return { ok: false, error: "Could not allocate a document number. Try again." };
}

/**
 * A template's current version, as the `AgreementBody` create payload for a new agreement.
 *
 * NOT exported: this file is "use server", so an export would be a public RPC endpoint with no
 * capability check in front of it - the same trap `agreement-core` exists to avoid.
 */
async function resolveTemplateBody(templateId: string) {
  const template = await prisma.agreementTemplate.findUnique({
    where: { id: templateId },
    select: { id: true, name: true, archivedAt: true, currentVersionId: true },
  });
  if (!template) return { ok: false as const, error: "That template no longer exists." };
  if (template.archivedAt) {
    return { ok: false as const, error: `“${template.name}” is archived. Restore it first.` };
  }
  if (!template.currentVersionId) {
    return { ok: false as const, error: `“${template.name}” has no document uploaded yet.` };
  }

  const loaded = await loadVersionForInstantiate(template.currentVersionId);
  if (!loaded.ok) return { ok: false as const, error: loaded.error };

  const { row, body } = loaded;
  return {
    ok: true as const,
    templateName: template.name,
    version: row.version,
    body,
    create: {
      kind: row.kind,
      templateId: template.id,
      templateVersionId: row.id,
      templateLabel: row.label ?? `v${row.version}`,
      blocks: (body.blocks ?? Prisma.DbNull) as Prisma.InputJsonValue,
      sourceBytes: row.sourceBytes,
      sourceName: row.sourceName,
      sourceMime: row.sourceMime,
      sourceSize: row.sourceSize,
      sourceSha256: row.sourceSha256,
      pageCount: row.pageCount ?? null,
      pageSizes: (body.pageSizes ?? Prisma.DbNull) as Prisma.InputJsonValue,
      fields: body.fields as unknown as Prisma.InputJsonValue,
      options: (body.options ?? Prisma.DbNull) as Prisma.InputJsonValue,
      // The UNCHECKED variant: the provenance is written as foreign keys (`templateId`), not as
      // nested `connect`s, because that is all a copied snapshot needs.
    } satisfies Prisma.AgreementBodyUncheckedCreateWithoutAgreementInput,
  };
}

export async function updateAgreement(id: string, data: unknown): Promise<ActionResult> {
  const { allowed, denied, session } = await capabilityCheck("agreements.issue");
  if (!allowed) return denied;

  const parsed = parseAgreementData(data);
  if (!parsed.ok) return parsed;

  const before = await prisma.agreement.findUnique({
    where: { id },
    select: { data: true, documentKind: true },
  });

  /**
   * The hash covers the document body as well as the fields, so editing the money on an uploaded
   * agreement has to re-hash against that body - not against nothing. Re-read rather than
   * threaded through: the form that posts these fields knows nothing about the document.
   */
  const body =
    before && before.documentKind !== "GUIDED" ? await loadAgreementBody(id) : null;
  const parsedBody = body ? parseBodyRow(body) : null;
  const templateVersion =
    before && before.documentKind !== "GUIDED"
      ? UPLOAD_TEMPLATE_VERSIONS[before.documentKind]
      : AGREEMENT_TEMPLATE_VERSION;

  // Compare-and-set on status: an agreement that went out while this form sat open must not
  // silently absorb the founder's edits.
  const updated = await prisma.agreement.updateMany({
    where: { id, status: "DRAFT" },
    data: {
      data: parsed.data as unknown as Prisma.InputJsonValue,
      dataSha256: contentHash(
        parsed.data,
        templateVersion,
        parsedBody?.ok ? parsedBody.body : null,
      ),
      /**
       * Re-pin the draft to the CURRENT renderer for its kind.
       *
       * `contentHash` hashes the terms together with the template version - so a draft created
       * under guided-v3 and edited after the bump would have stored a v4 hash against a v3 row,
       * and the hash printed on its pages would have matched nothing. A draft has been signed by
       * nobody and promised to nobody, so moving it to the live renderer is the honest repair; an
       * ISSUED agreement is excluded by the `status: "DRAFT"` guard above and keeps its own
       * version forever.
       *
       * For an uploaded document this resolves to its OWN renderer (`upload-docx-v1`), never to
       * the guided clause set - writing `guided-v4` onto a row whose prose lives in
       * `agreement_body` would make the document render as the wrong contract entirely.
       */
      templateVersion,
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
 * master document reads. The body lives in `issueAgreementCore` - see the note there on why.
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
 *   reported - THIS session's browser (the founder is issuing from here, now)
 *   capture  - how the ink was really drawn, back at `savedAt`. Never synthesised: a `capture`
 *              invented at issue time would be a fabricated claim about a signature's provenance.
 *   observed - the IP/UA our server sees on THIS request (added by founderDeviceFrom).
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
 * `issueAgreementCore` hands back a signing URL with the raw token in it - the one place that token
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
 * Countersign an existing draft with the stored signature - no modal, no redraw.
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
 * two fields - rather than issuing a contract with a blank §2 header. An existing draft for the
 * same client is reused instead of stacking a second one.
 */
export async function generateAndSendAgreement(input: {
  leadId?: string | null;
  studentId?: string | null;
  /** This browser's account of itself (collectReportedDevice) - not the signature. */
  reported?: unknown;
  /**
   * Draw it up on an uploaded template rather than the guided clause set.
   *
   * `undefined` means "whatever the founder set as the default" (`defaultTemplateId`); an explicit
   * `null` means the guided clause set. The distinction matters because the bulk screen and the
   * task card do not ask, while the form does - so only the form can say "guided, and I mean it".
   */
  templateId?: string | null;
}): Promise<ActionResult<GenerateOutcome>> {
  const { allowed, denied, session } = await capabilityCheck("agreements.issue");
  if (!allowed) return denied;
  if (!input.leadId && !input.studentId) return { ok: false, error: "No client selected." };

  const href = `/agreements/new?${input.leadId ? `leadId=${input.leadId}` : `studentId=${input.studentId}`}`;
  const prefill = await getAgreementPrefill({ leadId: input.leadId, studentId: input.studentId });
  /*
    `suggested` counts as a reason to go to the form, exactly like `missing`.

    The batch box is prefilled from the cohorts on file, and when nothing seats this person that
    prefill is an INFERENCE - the next intake with room. A one-click send would countersign and
    deliver a contract naming a cohort nobody confirmed, and this path's whole promise is that it
    refuses to guess. So the founder gets the form, opened on the suggestion, one glance from
    sending.
  */
  const unconfirmed = [...prefill.missing, ...prefill.suggested];
  if (unconfirmed.length > 0) {
    return { ok: true, data: { kind: "needsForm", href, missing: unconfirmed } };
  }

  const saved = await getSavedSignature(session.user.id);
  if (!saved) return { ok: true, data: { kind: "needsSignature" } };
  const png = decodeSignaturePng(saved.dataUrl);
  if (!png) return { ok: false, error: "Your saved signature is unreadable. Save it again." };

  /**
   * Reuse a draft the founder already started rather than stacking a second one on the client.
   *
   * A template is only honoured when a NEW draft is created: an existing draft already has its own
   * document (possibly one the founder edited by hand), and silently replacing it because a
   * template was named here would throw that work away. `documentKind` comes back in the outcome
   * so the caller can say which document actually went out.
   */
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
    // Only when the caller did not say. A stale default resolves to the guided set rather than
    // failing the send - see `getDefaultTemplateChoice`.
    const templateId =
      input.templateId === undefined ? ((await getDefaultTemplateChoice())?.id ?? null) : input.templateId;
    const created = await createAgreement({
      data: prefill.data,
      leadId: prefill.leadId,
      studentId: prefill.studentId,
      templateId,
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
      // The reminder email says when the link went out, so the student knows which message to
      // look for. That is the only reason this is selected.
      issuedAt: true,
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

  const workflow = await getAgreementWorkflow();

  const outcome =
    workflow.deliverBy !== "EMAIL"
      ? await sendWhatsApp({
          kind: "AGREEMENT_REMINDER",
          to: parsed.data.student.phone,
          vars: { name: firstName(parsed.data.student.fullName), document_no: row.documentNo },
          sentById: session.user.id,
          bodySummary: `Agreement ${row.documentNo} - reminder`,
          agreementId: id,
          leadId: row.leadId,
          studentId: row.studentId,
        })
      : null;

  const email =
    workflow.deliverBy !== "WHATSAPP" && parsed.data.student.email
      ? await emailSigningReminder({
          to: parsed.data.student.email,
          name: parsed.data.student.fullName,
          documentNo: row.documentNo,
          issuedAt: row.issuedAt,
          expiresAt: row.expiresAt,
        })
      : null;

  const sent = !!outcome?.sent || !!email?.sent;
  /**
   * No `day` in the meta, deliberately: that key is how the automatic sweep knows which nudges it
   * has already sent (`agreement-reminders`), and a hand-sent reminder must not consume one of
   * the scheduled days. A founder nudging by hand on day 2 should not cancel day 3.
   */
  await recordAgreementEvent(id, sent ? "DELIVERY_SENT" : "DELIVERY_SKIPPED", {
    meta: {
      kind: "AGREEMENT_REMINDER",
      byHand: true,
      whatsapp: outcome ? { sent: outcome.sent, error: outcome.error ?? null } : null,
      email: email ? { sent: email.sent, error: email.error ?? null } : null,
    },
  });
  await logActivity(session, {
    action: "agreement.resend",
    section: "agreements",
    entityType: "Agreement",
    entityId: id,
    summary: `Sent a signing reminder to ${parsed.data.student.fullName}`,
    meta: {
      documentNo: row.documentNo,
      sent,
      whatsapp: outcome ? { sent: outcome.sent, error: outcome.error ?? null } : null,
      email: email ? { sent: email.sent, error: email.error ?? null } : null,
    },
  });

  revalidatePath(`${AGREEMENTS_PATH}/${id}`);

  const parts: string[] = [];
  if (outcome) parts.push(outcome.sent ? "sent on WhatsApp" : `WhatsApp failed (${outcome.error ?? "unknown"})`);
  if (workflow.deliverBy !== "WHATSAPP") {
    if (!parsed.data.student.email) parts.push("no email address on record");
    else if (email) parts.push(email.sent ? "emailed" : `email failed (${email.error ?? "unknown"})`);
  }
  return { ok: true, data: { delivery: `Reminder: ${parts.join("; ")}.` } };
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

/** Void this one and open a fresh draft carrying the same fields - the "edit after send" path. */
export async function cloneAgreement(id: string): Promise<ActionResult<{ id: string }>> {
  const { allowed, denied, session } = await capabilityCheck("agreements.issue");
  if (!allowed) return denied;

  const row = await prisma.agreement.findUnique({
    where: { id },
    select: { data: true, leadId: true, studentId: true, status: true, documentKind: true },
  });
  if (!row) return { ok: false, error: "Agreement not found." };

  /**
   * The document travels with the clone, and it is copied from the AGREEMENT rather than
   * re-instantiated from the template.
   *
   * That is the whole point of "void and clone": it is the edit path for an agreement that has
   * already gone out, so the founder must get back the document they sent - complete with the
   * boxes they placed and any wording they fixed on this copy - and not whatever the template
   * has become since. Provenance (templateId/templateVersionId) is carried across unchanged.
   */
  const source =
    row.documentKind === "GUIDED"
      ? null
      : await prisma.agreementBody.findUnique({
          where: { agreementId: id },
          select: BODY_SELECT_WITH_BYTES,
        });

  const data = parseAgreementData(row.data);
  if (!data.ok) return { ok: false, error: `Stored fields are invalid: ${data.error}` };

  // A signed agreement is never voided - it is superseded by the new draft, and both survive.
  if (row.status !== "SIGNED" && row.status !== "VOIDED") {
    const voided = await voidAgreement(id, "Superseded by a revised agreement");
    if (!voided.ok) return voided;
  }

  const created = await createAgreement({
    data: row.data,
    leadId: row.leadId,
    studentId: row.studentId,
  });
  if (!created.ok || !source) return created;

  const body = parseBodyRow(source);
  if (!body.ok) {
    // The clone exists and is a usable guided draft; the document could not come with it. Say so
    // rather than rolling back a row the founder can already see - and name the reason.
    return {
      ok: false,
      error: `The new draft was created, but its document could not be copied: ${body.error}`,
    };
  }

  const kind = body.body.kind;
  // The body, the kind, the renderer and the hash all move together, or none of them move.
  await prisma.$transaction([
    prisma.agreementBody.create({
      data: {
        agreementId: created.data!.id,
        kind,
        templateId: source.templateId,
        templateVersionId: source.templateVersionId,
        templateLabel: source.templateLabel,
        blocks: (body.body.blocks ?? Prisma.DbNull) as Prisma.InputJsonValue,
        sourceBytes: source.sourceBytes,
        sourceName: source.sourceName,
        sourceMime: source.sourceMime,
        sourceSize: source.sourceSize,
        sourceSha256: source.sourceSha256,
        pageCount: source.pageCount,
        pageSizes: (source.pageSizes ?? Prisma.DbNull) as Prisma.InputJsonValue,
        fields: body.body.fields as unknown as Prisma.InputJsonValue,
        options: (body.body.options ?? Prisma.DbNull) as Prisma.InputJsonValue,
      },
    }),
    prisma.agreement.update({
      where: { id: created.data!.id },
      data: {
        documentKind: kind,
        templateVersion: UPLOAD_TEMPLATE_VERSIONS[kind],
        dataSha256: contentHash(data.data, UPLOAD_TEMPLATE_VERSIONS[kind], body.body),
      },
    }),
  ]);

  await logActivity(session, {
    action: "agreement.document.clone",
    section: "agreements",
    entityType: "Agreement",
    entityId: created.data!.id,
    summary: `Copied the uploaded document onto the revised draft`,
    meta: { from: id, kind },
  });

  return created;
}

// ─────────────────── The agreement's own document (per-agreement override) ───────────────────

/**
 * Save the prose and the field placement for THIS agreement.
 *
 * This is the per-agreement override: a template is a starting point, and a contract for one
 * person regularly needs a line changed or a signature box moved. Editing here never touches the
 * template - the body is this agreement's own copy.
 *
 * DRAFT ONLY, enforced three times over, which is not paranoia but three different failures: the
 * UI hides the editor, the compare-and-set below refuses a row that has been issued, and
 * `agreement_body_sealed_immutable` refuses the write outright once the agreement is signed. The
 * middle one is what catches the founder who left this editor open while the link went out.
 */
export async function saveAgreementDocument(
  id: string,
  input: { blocks?: unknown; fields: unknown; options?: unknown },
): Promise<ActionResult<{ problems: string[] }>> {
  const { allowed, denied, session } = await capabilityCheck("agreements.issue");
  if (!allowed) return denied;

  const row = await prisma.agreement.findUnique({
    where: { id },
    select: { id: true, status: true, documentKind: true, data: true, body: { select: BODY_SELECT } },
  });
  if (!row) return { ok: false, error: "Agreement not found." };
  if (row.status !== "DRAFT") {
    return { ok: false, error: "This agreement has already been issued. Void it and clone instead." };
  }
  if (row.documentKind === "GUIDED" || !row.body) {
    return { ok: false, error: "This agreement has no uploaded document to edit." };
  }

  const fields = docFieldsSchema.safeParse(input.fields);
  if (!fields.success) {
    return { ok: false, error: `Those fields are not valid: ${fields.error.issues[0]?.message}` };
  }

  let blocks: DocBlock[] | null = null;
  if (row.documentKind === "DOCX") {
    const parsed = docBlocksSchema.safeParse(input.blocks);
    if (!parsed.success) {
      return { ok: false, error: `That document content is not valid: ${parsed.error.issues[0]?.message}` };
    }
    blocks = parsed.data;
  }

  const data = parseAgreementData(row.data);
  if (!data.ok) return { ok: false, error: `Stored fields are invalid: ${data.error}` };

  const options = docOptionsSchema.safeParse(input.options ?? {});
  if (!options.success) {
    return { ok: false, error: `Those document options are not valid: ${options.error.issues[0]?.message}` };
  }
  const keptOptions = Object.keys(options.data).length > 0 ? options.data : undefined;

  const body: DocBody = {
    kind: row.documentKind,
    blocks,
    fields: fields.data,
    ...(keptOptions ? { options: keptOptions } : {}),
    sourceName: row.body.sourceName,
    sourceSha256: row.body.sourceSha256,
    pageCount: row.body.pageCount,
    pageSizes: (row.body.pageSizes as DocBody["pageSizes"]) ?? null,
  };

  const [, updated] = await prisma.$transaction([
    prisma.agreementBody.update({
      where: { agreementId: id },
      data: {
        fields: fields.data as unknown as Prisma.InputJsonValue,
        ...(blocks ? { blocks: blocks as unknown as Prisma.InputJsonValue } : {}),
        options: (keptOptions ?? Prisma.DbNull) as Prisma.InputJsonValue,
      },
    }),
    prisma.agreement.updateMany({
      where: { id, status: "DRAFT" },
      data: { dataSha256: contentHash(data.data, UPLOAD_TEMPLATE_VERSIONS[row.documentKind], body) },
    }),
  ]);
  if (updated.count === 0) {
    return {
      ok: false,
      error: "This agreement was issued while you were editing. Void it and clone instead.",
    };
  }

  await logActivity(session, {
    action: "agreement.document.update",
    section: "agreements",
    entityType: "Agreement",
    entityId: id,
    summary: `Edited the document of the draft agreement for ${data.data.student.fullName}`,
    meta: { fields: fields.data.length, blocks: blocks?.length ?? null },
  });
  revalidatePath(`${AGREEMENTS_PATH}/${id}`);

  /**
   * Saving always succeeds; the problems come back as advice. A half-marked-up draft is a
   * legitimate work-in-progress, and the gate that matters is at issue.
   */
  const ready = documentReadiness(body);
  return { ok: true, data: { problems: ready.ok ? [] : ready.problems } };
}

/**
 * Drop the uploaded document and fall back to the guided clause set.
 *
 * The escape hatch for "I attached the wrong file to this agreement". It deletes the body rather
 * than leaving an orphan, and re-pins the renderer and the hash to guided - otherwise the row
 * would claim a document it no longer has, and the preview would throw.
 */
export async function removeAgreementDocument(id: string): Promise<ActionResult> {
  const { allowed, denied, session } = await capabilityCheck("agreements.issue");
  if (!allowed) return denied;

  const row = await prisma.agreement.findUnique({
    where: { id },
    select: { id: true, status: true, documentKind: true, data: true },
  });
  if (!row) return { ok: false, error: "Agreement not found." };
  if (row.status !== "DRAFT") return { ok: false, error: "Only a draft can be changed." };
  if (row.documentKind === "GUIDED") {
    return { ok: false, error: "This agreement has no uploaded document." };
  }

  const data = parseAgreementData(row.data);
  if (!data.ok) return { ok: false, error: `Stored fields are invalid: ${data.error}` };

  await prisma.$transaction([
    prisma.agreementBody.deleteMany({ where: { agreementId: id } }),
    prisma.agreement.updateMany({
      where: { id, status: "DRAFT" },
      data: {
        documentKind: "GUIDED",
        templateVersion: AGREEMENT_TEMPLATE_VERSION,
        dataSha256: contentHash(data.data, AGREEMENT_TEMPLATE_VERSION),
      },
    }),
  ]);

  await logActivity(session, {
    action: "agreement.document.remove",
    section: "agreements",
    entityType: "Agreement",
    entityId: id,
    summary: `Removed the uploaded document and reverted to the Guided Mode clause set`,
  });
  revalidatePath(`${AGREEMENTS_PATH}/${id}`);
  return { ok: true };
}

// ───────────────────────────── Co-signers (guardian / witness) ─────────────────────────────

/**
 * Invite a parent, guardian or witness to co-sign.
 *
 * DRAFT ONLY. Their link is minted and delivered by `issueAgreementCore` at the moment the
 * founder countersigns, so adding somebody after that would leave a signer row with no token on an
 * agreement that is already out - and the student's gate would then wait forever on a person who
 * was never asked. Void and clone instead, which is the same rule the terms follow.
 *
 * ONE guardian per agreement, enforced here. `DocField.signer` is a ROLE, not a person, so two
 * guardians would own the same boxes and the renderer could not say whose ink belongs in which.
 */
export async function addAgreementSigner(input: {
  agreementId: string;
  name: string;
  phone: string;
  email?: string | null;
}): Promise<ActionResult> {
  const { allowed, denied, session } = await capabilityCheck("agreements.issue");
  if (!allowed) return denied;

  const name = input.name.trim().slice(0, 120);
  const phone = normalizeWhatsappNumber(input.phone);
  const email = (input.email ?? "").trim().slice(0, 200);

  if (name.length < 2) return { ok: false, error: "Enter the co-signer's full name." };
  if (!phone) {
    return {
      ok: false,
      // Their number is not a contact detail here - it is the identity binding, exactly as the
      // student's is. Without one there is no way to prove who signed.
      error: "Enter a valid WhatsApp number with country code - the one-time code goes to it.",
    };
  }

  const row = await prisma.agreement.findUnique({
    where: { id: input.agreementId },
    select: { id: true, status: true, documentKind: true, data: true },
  });
  if (!row) return { ok: false, error: "Agreement not found." };
  if (row.status !== "DRAFT") {
    return { ok: false, error: "This agreement has already been issued. Void it and clone instead." };
  }

  const existing = await prisma.agreementSigner.count({
    where: { agreementId: input.agreementId, role: "GUARDIAN" },
  });
  if (existing > 0) {
    return { ok: false, error: "This agreement already has a co-signer. Remove them first." };
  }

  await prisma.agreementSigner.create({
    data: {
      agreementId: input.agreementId,
      role: "GUARDIAN",
      name,
      phone,
      email: email || null,
      position: 1,
    },
  });

  const data = parseAgreementData(row.data);
  await logActivity(session, {
    action: "agreement.signer.add",
    section: "agreements",
    entityType: "Agreement",
    entityId: input.agreementId,
    summary: `Added ${name} as a co-signer${data.ok ? ` on ${data.data.student.fullName}'s agreement` : ""}`,
    meta: { phone, email: email || null },
  });
  revalidatePath(`${AGREEMENTS_PATH}/${input.agreementId}`);
  return { ok: true };
}

/** Remove a co-signer from a draft. Same DRAFT-only rule, and for the same reason. */
export async function removeAgreementSigner(signerId: string): Promise<ActionResult> {
  const { allowed, denied, session } = await capabilityCheck("agreements.issue");
  if (!allowed) return denied;

  const signer = await prisma.agreementSigner.findUnique({
    where: { id: signerId },
    select: { id: true, name: true, agreementId: true, agreement: { select: { status: true } } },
  });
  if (!signer) return { ok: false, error: "That co-signer no longer exists." };
  if (signer.agreement.status !== "DRAFT") {
    return { ok: false, error: "This agreement has already been issued. Void it and clone instead." };
  }

  await prisma.agreementSigner.delete({ where: { id: signerId } });
  await logActivity(session, {
    action: "agreement.signer.remove",
    section: "agreements",
    entityType: "Agreement",
    entityId: signer.agreementId,
    summary: `Removed ${signer.name} as a co-signer`,
  });
  revalidatePath(`${AGREEMENTS_PATH}/${signer.agreementId}`);
  return { ok: true };
}

// ───────────────────────────── In-person signing ─────────────────────────────

/**
 * Sign the student in person, on the founder's own device, during a call.
 *
 * ── WHY THIS HAS TO MINT A FRESH LINK ───────────────────────────────────────────────────────
 * Only the SHA-256 of a signing token is stored, so the link that went out cannot be rebuilt -
 * not by this action, not by anybody. The only way to hand the founder a working URL after the
 * fact is to mint a new one, which necessarily kills the old one. That is stated plainly in the
 * UI rather than hidden, because a student who later taps the link in their WhatsApp deserves to
 * find a dead link rather than a mystery.
 *
 * ── WHAT DOES NOT CHANGE ────────────────────────────────────────────────────────────────────
 * The identity binding. The one-time code still goes to the STUDENT's own number, so "the person
 * holding that phone consented" remains exactly as true as it was over a remote link. The device
 * record will show the founder's hardware, which is the truth of what happened - and the IN_PERSON
 * event on the trail (reproduced on the certificate) says so explicitly, so the certificate can
 * never imply a link was followed from the student's own phone.
 */
export async function startInPersonSigning(
  id: string,
): Promise<ActionResult<{ signingUrl: string }>> {
  const { allowed, denied, session } = await capabilityCheck("agreements.issue");
  if (!allowed) return denied;

  const row = await prisma.agreement.findUnique({
    where: { id },
    select: { id: true, status: true, documentNo: true, signedAt: true, data: true },
  });
  if (!row) return { ok: false, error: "Agreement not found." };
  if (row.signedAt) return { ok: false, error: "This agreement has already been signed." };
  if (row.status !== "SENT" && row.status !== "VIEWED") {
    return {
      ok: false,
      error: "Only an issued, unsigned agreement can be signed in person. Countersign and send it first.",
    };
  }

  const workflow = await getAgreementWorkflow();
  const { token, tokenHash, expiresAt } = mintAgreementToken(workflow.ttlDays);

  // Compare-and-set on `signedAt`: the student must not be able to sign through the old link in
  // the instant between reading the row and replacing the token.
  const updated = await prisma.agreement.updateMany({
    where: { id, signedAt: null },
    data: { tokenHash, expiresAt, otpHash: null, otpExpiresAt: null, otpAttempts: 0 },
  });
  if (updated.count === 0) return { ok: false, error: "This agreement has just been signed." };

  await recordAgreementEvent(id, "IN_PERSON", {
    meta: { by: session.user.email, note: "A fresh signing link was minted for in-person signing" },
  });
  const party = await agreementParty(id);
  await logActivity(session, {
    action: "agreement.inperson",
    section: "agreements",
    entityType: "Agreement",
    entityId: id,
    summary: `Opened ${party.name}'s agreement for in-person signing (the previous link was replaced)`,
    meta: { documentNo: row.documentNo },
  });

  revalidatePath(`${AGREEMENTS_PATH}/${id}`);
  return { ok: true, data: { signingUrl: signingUrl(token) } };
}

// ───────────────────────────── Bulk send ─────────────────────────────

export type BulkOutcome = {
  studentId: string;
  name: string;
  status: "sent" | "needsForm" | "failed";
  note: string;
};

/**
 * Issue the same document to a group of students - a workshop waiver, a batch-wide addendum.
 *
 * ── IT IS A LOOP OVER THE SINGLE PATH, DELIBERATELY ─────────────────────────────────────────
 * Each student gets their own agreement, own document number, own token, own one-time code and
 * own audit trail, by going through `generateAndSendAgreement` exactly as a one-off would. There
 * is no "bulk agreement" entity and no shared token: a contract is between B2 and one person, and
 * the only thing being batched is the founder's clicking.
 *
 * ── IT NEVER GUESSES ────────────────────────────────────────────────────────────────────────
 * A student whose record cannot answer every field a contract needs (no postal address, no fee)
 * comes back as `needsForm` and is SKIPPED - not issued with a blank §2. The result is a per
 * student list, so the founder can see that 18 went and 2 need typing, rather than a count.
 *
 * Capped at 50 per call: each one countersigns, renders nothing, and sends up to two messages, so
 * a runaway list is a lot of outbound traffic signed in the founder's name.
 */
export async function bulkIssueAgreements(input: {
  studentIds: string[];
  templateId?: string | null;
  reported?: unknown;
}): Promise<ActionResult<{ outcomes: BulkOutcome[] }>> {
  const { allowed, denied, session } = await capabilityCheck("agreements.issue");
  if (!allowed) return denied;

  const ids = [...new Set(input.studentIds.filter(Boolean))].slice(0, 50);
  if (ids.length === 0) return { ok: false, error: "Pick at least one student." };

  const students = await prisma.student.findMany({
    where: { id: { in: ids } },
    select: { id: true, fullName: true },
  });
  const names = new Map(students.map((s) => [s.id, s.fullName]));

  const batchRef = `bulk-${Date.now().toString(36)}`;
  const outcomes: BulkOutcome[] = [];
  for (const studentId of ids) {
    const name = names.get(studentId) ?? "Unknown student";
    const result = await generateAndSendAgreement({
      studentId,
      // Passed through UNTOUCHED, undefined and all: `?? null` here would have turned "the founder
      // did not say" into "the guided clause set, definitely", and the default would never apply.
      templateId: input.templateId,
      reported: input.reported,
    });

    if (!result.ok) {
      outcomes.push({ studentId, name, status: "failed", note: result.error });
      continue;
    }
    const data = result.data!;
    if (data.kind === "needsSignature") {
      // Nothing can be issued for anybody without a stored countersignature, so stop rather than
      // producing fifty identical failures.
      return {
        ok: false,
        error: "Save your countersignature first - nothing can be sent without it.",
      };
    }
    if (data.kind === "needsForm") {
      outcomes.push({
        studentId,
        name,
        status: "needsForm",
        note: `Skipped - ${data.missing.join(", ")} missing from the record.`,
      });
      continue;
    }
    outcomes.push({
      studentId,
      name,
      status: data.sent ? "sent" : "failed",
      note: data.delivery,
    });
  }

  await logActivity(session, {
    action: "agreement.bulk",
    section: "agreements",
    /**
     * Its OWN entity type and reference, not a borrowed one.
     *
     * There is no single agreement this line is about - each one issued already has its own
     * `agreement.issue` entry naming the founder - and pointing this at the first of them would
     * read as though that student's contract was the batch. The reference is this run.
     */
    entityType: "AgreementBulk",
    entityId: batchRef,
    summary: `Issued agreements in bulk to ${outcomes.filter((o) => o.status === "sent").length} of ${outcomes.length} students`,
    meta: {
      templateId: input.templateId ?? null,
      batchRef,
      students: outcomes.map((o) => ({ id: o.studentId, status: o.status })),
      skipped: outcomes.filter((o) => o.status !== "sent").map((o) => o.name),
    },
  });

  revalidatePath(AGREEMENTS_PATH);
  return { ok: true, data: { outcomes } };
}
