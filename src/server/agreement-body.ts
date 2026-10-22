import "server-only";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import {
  docBlocksSchema,
  docBodyHashInput,
  docFieldsSchema,
  docOptionsSchema,
  uploadTemplateVersion,
  validateDocBody,
  type DocBody,
  type DocKind,
} from "@/lib/agreement-doc";
import { mergeProblems } from "@/lib/agreement-merge";

/**
 * Reading an agreement's document body back out of the database, and the gate that decides
 * whether it may go out.
 *
 * ── TWO SELECTS, AND THE DIFFERENCE MATTERS ─────────────────────────────────────────────────
 * `BODY_SELECT` omits `sourceBytes`. Everything that reasons about a document - the editor, the
 * validator, the hash - uses it. `BODY_SELECT_WITH_BYTES` is for the two callers that genuinely
 * need megabytes: stamping a PDF, and letting the founder download what they uploaded. This is
 * the same discipline the schema asks for around `pdfBytes`, and for the same reason: one
 * forgotten narrowing in a list query turns a page of agreements into a hundred megabytes of
 * response.
 */

export const BODY_SELECT = {
  agreementId: true,
  kind: true,
  templateId: true,
  templateVersionId: true,
  templateLabel: true,
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
} as const;

export const BODY_SELECT_WITH_BYTES = { ...BODY_SELECT, sourceBytes: true } as const;

export type BodyRow = Prisma.AgreementBodyGetPayload<{ select: typeof BODY_SELECT }>;
export type BodyRowWithBytes = Prisma.AgreementBodyGetPayload<{ select: typeof BODY_SELECT_WITH_BYTES }>;

/**
 * A stored row → the validated `DocBody` every other module speaks.
 *
 * Re-parsed through the same schemas that guarded the upload, deliberately: a Json column is not
 * a type, and `blocks`/`fields` are the prose and the signature placement of a contract. If a row
 * no longer validates the surfaces say so rather than rendering half a document.
 */
export function parseBodyRow(
  row: Pick<
    BodyRow,
    "kind" | "blocks" | "fields" | "options" | "sourceName" | "sourceSha256" | "pageCount" | "pageSizes"
  >,
): { ok: true; body: DocBody } | { ok: false; error: string } {
  if (row.kind === "GUIDED") {
    return { ok: false, error: "This agreement has a stored body but is marked as a guided document." };
  }

  const fields = docFieldsSchema.safeParse(row.fields);
  if (!fields.success) {
    return { ok: false, error: `The stored signature fields are invalid: ${fields.error.issues[0]?.message}` };
  }

  let blocks: DocBody["blocks"] = null;
  if (row.kind === "DOCX") {
    const parsed = docBlocksSchema.safeParse(row.blocks);
    if (!parsed.success) {
      return { ok: false, error: `The stored document content is invalid: ${parsed.error.issues[0]?.message}` };
    }
    blocks = parsed.data;
  }

  /**
   * Options are DROPPED when they do not parse, never defaulted into something.
   *
   * They enter the content hash, so inventing a value here would change the hash of a stored
   * document on read - the exact failure mode the note at the top of `agreement-doc` warns about.
   * An unreadable options blob therefore means "no options", which is what every document written
   * before they existed already meant.
   */
  const options = docOptionsSchema.safeParse(row.options ?? undefined);

  return {
    ok: true,
    body: {
      kind: row.kind,
      blocks,
      fields: fields.data,
      ...(options.success && Object.keys(options.data).length > 0 ? { options: options.data } : {}),
      sourceName: row.sourceName,
      sourceSha256: row.sourceSha256,
      pageCount: row.pageCount,
      pageSizes: (row.pageSizes as DocBody["pageSizes"]) ?? null,
    },
  };
}

/** The body's contribution to `dataSha256`, or `undefined` for a guided agreement. */
export function bodyHashInput(body: DocBody | null | undefined): Record<string, unknown> | undefined {
  return body ? docBodyHashInput(body) : undefined;
}

/** The renderer pinned on the row for this kind. Guided agreements keep their own clause set. */
export function templateVersionFor(kind: DocKind, guidedVersion: string): string {
  return uploadTemplateVersion(kind) ?? guidedVersion;
}

/**
 * The body in the shape `renderAgreementPdf` wants, bytes included - for the two render paths
 * (preview and seal) and nothing else.
 *
 * Bytes are fetched only for the PDF kind, because only the PDF kind stamps onto the original
 * file; a Word agreement renders from its blocks, so pulling its upload would be a bytea read
 * for nothing. Returns null when there is no body or it no longer validates, and the callers
 * turn that into a plain message rather than a half-rendered contract.
 */
export async function uploadedBodyFor(
  agreementId: string,
): Promise<(DocBody & { sourceBytes?: Uint8Array | null }) | null> {
  const row = await prisma.agreementBody.findUnique({ where: { agreementId }, select: BODY_SELECT });
  if (!row) return null;
  const parsed = parseBodyRow(row);
  if (!parsed.ok) return null;
  if (row.kind !== "PDF") return parsed.body;

  // A second round trip, on purpose: it is the only way to leave a 5MB Word upload in the
  // database when the document being rendered does not need it. Only the PDF path pays it.
  const file = await prisma.agreementBody.findUnique({
    where: { agreementId },
    select: { sourceBytes: true },
  });
  return { ...parsed.body, sourceBytes: file?.sourceBytes ?? null };
}

export async function loadAgreementBody(agreementId: string): Promise<BodyRow | null> {
  return prisma.agreementBody.findUnique({ where: { agreementId }, select: BODY_SELECT });
}

export async function loadAgreementBodyWithBytes(agreementId: string): Promise<BodyRowWithBytes | null> {
  return prisma.agreementBody.findUnique({ where: { agreementId }, select: BODY_SELECT_WITH_BYTES });
}

/**
 * EVERYTHING that must be true before an uploaded document may be countersigned and sent.
 *
 * Called by the editor so the founder sees what is outstanding, and again inside `issueAgreement`
 * because the editor's answer is advisory - the same arrangement as the instalment-sum check.
 *
 * The merge gate is the half that is easy to underrate: a mistyped `{{payment.totl}}` would
 * otherwise be PRINTED, verbatim, in the middle of a clause, on a document somebody then signs.
 * See the note at the top of lib/agreement-merge.
 */
export function documentReadiness(body: DocBody): { ok: true } | { ok: false; problems: string[] } {
  const problems = [
    ...validateDocBody(body).map((p) => p.message),
    ...mergeProblems(body.blocks ?? [], body.fields, body.options?.custom),
  ];

  return problems.length === 0 ? { ok: true } : { ok: false, problems };
}
