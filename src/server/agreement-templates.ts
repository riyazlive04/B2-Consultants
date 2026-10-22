import "server-only";
import { prisma } from "@/lib/prisma";
import { parseBodyRow } from "./agreement-body";
import { getAgreementWorkflow } from "./founder-config";
import { describeFields, docFieldsSchema, type DocBody } from "@/lib/agreement-doc";

/**
 * Read side of the agreement template library.
 *
 * SAME ONE RULE as the agreements read side: `sourceBytes` is a `bytea` that can run to several
 * megabytes, and Prisma will happily stream every one of them into memory if you `findMany`
 * without a `select`. Nothing here selects it; the file is served by its own route, one row at a
 * time.
 */

const VERSION_SELECT = {
  id: true,
  version: true,
  label: true,
  kind: true,
  blocks: true,
  sourceName: true,
  sourceMime: true,
  sourceSize: true,
  sourceSha256: true,
  pageCount: true,
  pageSizes: true,
  fields: true,
  options: true,
  createdAt: true,
  updatedAt: true,
  createdBy: { select: { id: true, name: true } },
} as const;

const LIST_SELECT = {
  id: true,
  name: true,
  description: true,
  kind: true,
  archivedAt: true,
  createdAt: true,
  updatedAt: true,
  currentVersionId: true,
  currentVersion: { select: { id: true, version: true, label: true, fields: true, sourceName: true } },
  createdBy: { select: { id: true, name: true } },
  _count: { select: { versions: true, bodies: true } },
} as const;

export type TemplateListRow = Awaited<ReturnType<typeof listAgreementTemplates>>[number];

export async function listAgreementTemplates(opts?: { includeArchived?: boolean }) {
  const rows = await prisma.agreementTemplate.findMany({
    where: opts?.includeArchived ? {} : { archivedAt: null },
    select: LIST_SELECT,
    orderBy: [{ archivedAt: "asc" }, { updatedAt: "desc" }],
    take: 200,
  });

  return rows.map((r) => {
    // `fields` is Json to Prisma. A template whose placement no longer validates is shown with
    // "-" rather than crashing the list: the version screen is where it gets fixed.
    const parsed = docFieldsSchema.safeParse(r.currentVersion?.fields ?? []);
    return {
      ...r,
      fieldSummary: parsed.success ? describeFields(parsed.data) : "Fields need attention",
      /** How many agreements were drawn from this template. Provenance, and a deletion guard. */
      usedBy: r._count.bodies,
      versionCount: r._count.versions,
    };
  });
}

export type TemplateDetail = NonNullable<Awaited<ReturnType<typeof getAgreementTemplate>>>;

export async function getAgreementTemplate(id: string) {
  const row = await prisma.agreementTemplate.findUnique({
    where: { id },
    select: {
      ...LIST_SELECT,
      versions: { select: VERSION_SELECT, orderBy: { version: "desc" } },
    },
  });
  if (!row) return null;

  const current = row.versions.find((v) => v.id === row.currentVersionId) ?? row.versions[0] ?? null;

  return {
    ...row,
    usedBy: row._count.bodies,
    current,
    /** The current version as the editor's `DocBody`, or the reason it cannot be edited. */
    currentBody: current ? parseBodyRow(current) : null,
  };
}

/** One version, for the field designer. Still no bytes - the designer fetches the file itself. */
export async function getTemplateVersion(versionId: string) {
  const row = await prisma.agreementTemplateVersion.findUnique({
    where: { id: versionId },
    select: { ...VERSION_SELECT, templateId: true, template: { select: { id: true, name: true, kind: true } } },
  });
  if (!row) return null;
  return { ...row, body: parseBodyRow(row) };
}

/**
 * The template list as the "new agreement" picker needs it: only templates that are usable.
 *
 * A template with no current version, or whose current version has no signature box for both
 * parties, is deliberately NOT offered - the founder would pick it, fill in the money, and then
 * be refused at the one moment they wanted to press send. The list says why instead.
 */
export async function listUsableTemplates() {
  const rows = await listAgreementTemplates();
  return rows
    .filter((r) => r.currentVersionId)
    .map((r) => ({
      id: r.id,
      name: r.name,
      description: r.description,
      kind: r.kind,
      version: r.currentVersion?.version ?? 1,
      label: r.currentVersion?.label ?? null,
      fieldSummary: r.fieldSummary,
      sourceName: r.currentVersion?.sourceName ?? "",
    }));
}

/**
 * WHICH DOCUMENT THE ONE-TAP PATH WILL USE, resolved and verified.
 *
 * `agreementWorkflow.defaultTemplateId` is a config blob holding a bare id, so it can outlive the
 * template it names - archived, deleted, or left with no usable current version. Every caller goes
 * through here, and here a stale id means the guided clause set, never an error: the alternative is
 * a founder pressing "Generate & send" and being told their configuration is broken, which is the
 * one moment they can least act on it.
 *
 * Returns the NAME as well, because both callers want it: the task card prints which document is
 * about to go out, and the form pre-selects it.
 */
export async function getDefaultTemplateChoice(): Promise<{ id: string; name: string } | null> {
  const { defaultTemplateId } = await getAgreementWorkflow();
  if (!defaultTemplateId) return null;
  const row = await prisma.agreementTemplate.findFirst({
    where: { id: defaultTemplateId, archivedAt: null, currentVersionId: { not: null } },
    select: { id: true, name: true },
  });
  return row ?? null;
}

/**
 * Both halves of a template version, for instantiating it onto an agreement.
 *
 * The return type is INFERRED, not annotated. Writing `sourceBytes: Uint8Array` here would widen
 * Prisma's `Uint8Array<ArrayBuffer>` to `ArrayBufferLike` and the caller could no longer write it
 * back into a `Bytes` column - the same trap `toOwnedBytes` carries a note about.
 */
export async function loadVersionForInstantiate(versionId: string) {
  const row = await prisma.agreementTemplateVersion.findUnique({
    where: { id: versionId },
    select: {
      id: true,
      templateId: true,
      version: true,
      label: true,
      kind: true,
      blocks: true,
      fields: true,
      sourceBytes: true,
      sourceName: true,
      sourceMime: true,
      sourceSize: true,
      sourceSha256: true,
      pageCount: true,
      pageSizes: true,
      options: true,
    },
  });
  if (!row) return { ok: false as const, error: "That template version no longer exists." };
  if (row.kind === "GUIDED") {
    return { ok: false as const, error: "That template has no uploaded document." };
  }

  const parsed = parseBodyRow(row);
  if (!parsed.ok) return { ok: false as const, error: parsed.error };

  return { ok: true as const, body: parsed.body, row: { ...row, kind: row.kind } };
}
