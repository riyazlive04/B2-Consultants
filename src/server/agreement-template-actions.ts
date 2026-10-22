"use server";

import { revalidatePath } from "next/cache";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { capabilityCheck } from "@/lib/rbac";
import {
  AGREEMENT_TEMPLATES_PATH,
  docBlocksSchema,
  docFieldsSchema,
  docOptionsSchema,
  validateDocBody,
  type DocBody,
} from "@/lib/agreement-doc";
import { mergeProblems } from "@/lib/agreement-merge";
import { logActivity } from "./activity-log";
import type { ActionResult } from "./agreement-core";

/**
 * The template library's write side: rename, archive, choose the current version, and save the
 * field placement made on a version.
 *
 * ── WHAT IS NOT HERE ────────────────────────────────────────────────────────────────────────
 * UPLOADING. A file body cannot travel as a server-action argument - the whole payload would be
 * serialised into the action call, and Next caps that at a couple of megabytes - so uploads go
 * through `POST /api/agreements/templates/upload`, exactly as the public form's attachment field
 * does. See the note at the top of that route.
 *
 * Every export here is a public RPC endpoint (this file is "use server"), so every one of them
 * starts with a capability check.
 */

function revalidateTemplate(id?: string) {
  revalidatePath(AGREEMENT_TEMPLATES_PATH);
  if (id) revalidatePath(`${AGREEMENT_TEMPLATES_PATH}/${id}`);
}

export async function renameAgreementTemplate(
  id: string,
  input: { name: string; description: string },
): Promise<ActionResult> {
  const { allowed, denied, session } = await capabilityCheck("agreements.issue");
  if (!allowed) return denied;

  const name = input.name.trim().slice(0, 120);
  if (name.length < 2) return { ok: false, error: "Give the template a name." };

  await prisma.agreementTemplate.update({
    where: { id },
    data: { name, description: input.description.trim().slice(0, 500) || null },
  });
  await logActivity(session, {
    action: "agreement.template.update",
    section: "agreements",
    entityType: "AgreementTemplate",
    entityId: id,
    summary: `Renamed the agreement template to “${name}”`,
  });
  revalidateTemplate(id);
  return { ok: true };
}

/**
 * Archive, not delete.
 *
 * An agreement's body records which template version it was drawn from, and that provenance has
 * to survive - which is why the FK is `SetNull` and why nothing here deletes a row that
 * agreements point at. Archiving takes it out of the picker and leaves the history intact.
 */
export async function archiveAgreementTemplate(id: string, archived: boolean): Promise<ActionResult> {
  const { allowed, denied, session } = await capabilityCheck("agreements.issue");
  if (!allowed) return denied;

  const row = await prisma.agreementTemplate.update({
    where: { id },
    data: { archivedAt: archived ? new Date() : null },
    select: { name: true },
  });
  await logActivity(session, {
    action: archived ? "agreement.template.archive" : "agreement.template.restore",
    section: "agreements",
    entityType: "AgreementTemplate",
    entityId: id,
    summary: `${archived ? "Archived" : "Restored"} the agreement template “${row.name}”`,
  });
  revalidateTemplate(id);
  return { ok: true };
}

/**
 * Which version a NEW agreement instantiates.
 *
 * Changing it cannot reach an agreement that already exists: instantiating copies the body onto
 * the agreement (see `agreement-body`), so a draft raised last week keeps the version it was
 * raised on. That is the whole reason the copy exists.
 */
export async function setTemplateCurrentVersion(
  templateId: string,
  versionId: string,
): Promise<ActionResult> {
  const { allowed, denied, session } = await capabilityCheck("agreements.issue");
  if (!allowed) return denied;

  const version = await prisma.agreementTemplateVersion.findUnique({
    where: { id: versionId },
    select: { id: true, templateId: true, version: true },
  });
  if (!version || version.templateId !== templateId) {
    return { ok: false, error: "That version does not belong to this template." };
  }

  await prisma.agreementTemplate.update({
    where: { id: templateId },
    data: { currentVersionId: versionId },
  });
  await logActivity(session, {
    action: "agreement.template.version.current",
    section: "agreements",
    entityType: "AgreementTemplate",
    entityId: templateId,
    summary: `Made v${version.version} the current version of this agreement template`,
    meta: { versionId },
  });
  revalidateTemplate(templateId);
  return { ok: true };
}

/**
 * Save the edited prose and the field placement for one template version.
 *
 * A version IS edited in place, unlike an agreement body - and the distinction is deliberate. A
 * template is a working document: the founder uploads it, drags the signature boxes around, fixes
 * a line, and that iteration must not mint v2, v3, v4. What must never change under anybody is
 * the COPY an agreement took, and that is a different row entirely.
 *
 * The blocks are only accepted for a DOCX version. A PDF version has no editable prose - its
 * bytes are the document - so a `blocks` payload against one is a bug in the caller, not a
 * feature to support.
 */
export async function saveTemplateVersionDocument(
  versionId: string,
  input: { blocks?: unknown; fields: unknown; options?: unknown },
): Promise<ActionResult<{ problems: string[] }>> {
  const { allowed, denied, session } = await capabilityCheck("agreements.issue");
  if (!allowed) return denied;

  const row = await prisma.agreementTemplateVersion.findUnique({
    where: { id: versionId },
    select: {
      id: true,
      templateId: true,
      version: true,
      kind: true,
      sourceName: true,
      sourceSha256: true,
      pageCount: true,
      pageSizes: true,
    },
  });
  if (!row) return { ok: false, error: "That version no longer exists." };
  if (row.kind === "GUIDED") return { ok: false, error: "That version has no uploaded document." };

  const fields = docFieldsSchema.safeParse(input.fields);
  if (!fields.success) {
    return { ok: false, error: `Those fields are not valid: ${fields.error.issues[0]?.message}` };
  }

  let blocks: DocBody["blocks"] = null;
  if (row.kind === "DOCX") {
    const parsed = docBlocksSchema.safeParse(input.blocks);
    if (!parsed.success) {
      return { ok: false, error: `That document content is not valid: ${parsed.error.issues[0]?.message}` };
    }
    blocks = parsed.data;
  }

  const options = docOptionsSchema.safeParse(input.options ?? {});
  if (!options.success) {
    return { ok: false, error: `Those document options are not valid: ${options.error.issues[0]?.message}` };
  }
  const keptOptions = Object.keys(options.data).length > 0 ? options.data : undefined;

  await prisma.agreementTemplateVersion.update({
    where: { id: versionId },
    data: {
      fields: fields.data as unknown as Prisma.InputJsonValue,
      ...(row.kind === "DOCX" ? { blocks: (blocks ?? []) as unknown as Prisma.InputJsonValue } : {}),
      options: (keptOptions ?? Prisma.DbNull) as Prisma.InputJsonValue,
    },
  });

  await logActivity(session, {
    action: "agreement.template.version.update",
    section: "agreements",
    entityType: "AgreementTemplateVersion",
    entityId: versionId,
    summary: `Edited v${row.version} of an agreement template`,
    meta: { fields: fields.data.length },
  });
  revalidateTemplate(row.templateId);

  /**
   * Saving is ALWAYS allowed; the problems come back as advice.
   *
   * A half-marked-up template is a legitimate work-in-progress - the founder places B2's box,
   * goes to lunch, and places the student's afterwards. The gate that actually matters is at
   * ISSUE (`issueAgreementCore`), where a document with no counterparty signature line is
   * refused outright.
   */
  const body: DocBody = {
    kind: row.kind,
    blocks,
    fields: fields.data,
    ...(keptOptions ? { options: keptOptions } : {}),
    sourceName: row.sourceName,
    sourceSha256: row.sourceSha256,
    pageCount: row.pageCount,
    pageSizes: (row.pageSizes as DocBody["pageSizes"]) ?? null,
  };
  const problems = [
    ...validateDocBody(body).map((p) => p.message),
    ...mergeProblems(blocks ?? [], fields.data, keptOptions?.custom),
  ];
  return { ok: true, data: { problems } };
}
