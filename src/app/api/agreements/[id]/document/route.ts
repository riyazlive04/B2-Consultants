import { NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { hasCapability, requireSession } from "@/lib/rbac";
import { clientIpFrom, rateLimitOk } from "@/lib/rate-limit";
import { logActivity } from "@/server/activity-log";
import { parseAgreementData, recordAgreementEvent } from "@/server/agreement-core";
import { contentHash } from "@/server/agreement-render";
import { parseUpload } from "@/server/agreement-upload";
import { UPLOAD_TEMPLATE_VERSIONS, describeFields } from "@/lib/agreement-doc";
import type { DocBody } from "@/lib/agreement-doc";

/**
 * Attach (or replace) the document of ONE agreement - the per-agreement override, and the
 * one-off-upload path for an agreement that was never drawn from a template.
 *
 * A route handler for the same reason as the template upload: a file body cannot ride in a server
 * action argument. Everything else about an agreement's document is an action.
 *
 * ── WHY THIS IS DRAFT-ONLY, AND WHAT ENFORCES IT ────────────────────────────────────────────
 * Replacing the body of an agreement whose link is already out would change the contract under
 * the counterparty mid-read, which is precisely what the whole module refuses to do (see the note
 * on the missing edit path in `agreement-actions`). So:
 *   · the status is checked here;
 *   · the hash update is a compare-and-set on `status = DRAFT`, which catches an issue that
 *     landed while the file was uploading;
 *   · and `agreement_body_sealed_immutable` refuses the write outright once signed.
 *
 * The body, the kind, the renderer and the content hash are written in ONE transaction. A row
 * that says "PDF" with no body, or a hash that does not cover the document it names, is not a
 * state this app is allowed to be in even for a moment.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request, { params }: { params: { id: string } }) {
  const session = await requireSession();
  if (!hasCapability(session.role, session.capabilities, "agreements.issue")) {
    return NextResponse.json({ ok: false, error: "You cannot change agreement documents." }, { status: 403 });
  }
  const ip = clientIpFrom(new Headers(req.headers));
  if (!rateLimitOk(`agr:doc:upload:${session.user.id}:${ip}`, 30, 60 * 60_000)) {
    return NextResponse.json({ ok: false, error: "Too many uploads. Wait a few minutes." }, { status: 429 });
  }

  const row = await prisma.agreement.findUnique({
    where: { id: params.id },
    select: { id: true, documentNo: true, status: true, data: true },
  });
  if (!row) return NextResponse.json({ ok: false, error: "Agreement not found." }, { status: 404 });
  if (row.status !== "DRAFT") {
    return NextResponse.json(
      { ok: false, error: "This agreement has already been issued. Void it and clone instead." },
      { status: 409 },
    );
  }

  const data = parseAgreementData(row.data);
  if (!data.ok) {
    return NextResponse.json({ ok: false, error: `Stored fields are invalid: ${data.error}` }, { status: 422 });
  }

  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return NextResponse.json({ ok: false, error: "That upload could not be read." }, { status: 400 });
  }
  const file = form.get("file");
  if (!(file instanceof File)) {
    return NextResponse.json({ ok: false, error: "Choose a .docx or .pdf file." }, { status: 400 });
  }

  const parsed = await parseUpload({
    bytes: Buffer.from(await file.arrayBuffer()),
    filename: file.name,
  });
  if (!parsed.ok) return NextResponse.json(parsed, { status: 400 });

  // Both kinds can arrive pre-marked-up: a DOCX from its `[[sign:…]]` placeholders, a fillable
  // PDF from its own form boxes. See `agreement-acroform.ts`.
  const fields = parsed.fields;
  const blocks = parsed.kind === "DOCX" ? parsed.blocks : null;
  const body: DocBody = {
    kind: parsed.kind,
    blocks,
    fields,
    sourceName: parsed.sourceName,
    sourceSha256: parsed.sourceSha256,
    pageCount: parsed.kind === "PDF" ? parsed.pageCount : null,
    pageSizes: parsed.kind === "PDF" ? parsed.pageSizes : null,
  };

  const stored = {
    kind: parsed.kind,
    // A fresh upload onto this agreement has no template behind it any more. Saying it does
    // would be a false provenance claim on a document the founder replaced by hand.
    templateId: null,
    templateVersionId: null,
    templateLabel: null,
    blocks: (blocks ?? Prisma.DbNull) as Prisma.InputJsonValue,
    sourceBytes: parsed.bytes,
    sourceName: parsed.sourceName,
    sourceMime: parsed.sourceMime,
    sourceSize: parsed.sourceSize,
    sourceSha256: parsed.sourceSha256,
    pageCount: body.pageCount ?? null,
    pageSizes: (body.pageSizes ?? Prisma.DbNull) as Prisma.InputJsonValue,
    fields: fields as unknown as Prisma.InputJsonValue,
  };

  const [, updated] = await prisma.$transaction([
    prisma.agreementBody.upsert({
      where: { agreementId: params.id },
      create: { agreementId: params.id, ...stored },
      update: stored,
    }),
    prisma.agreement.updateMany({
      where: { id: params.id, status: "DRAFT" },
      data: {
        documentKind: parsed.kind,
        templateVersion: UPLOAD_TEMPLATE_VERSIONS[parsed.kind],
        dataSha256: contentHash(data.data, UPLOAD_TEMPLATE_VERSIONS[parsed.kind], body),
      },
    }),
  ]);
  if (updated.count === 0) {
    return NextResponse.json(
      { ok: false, error: "This agreement was issued while the file was uploading." },
      { status: 409 },
    );
  }

  // On the trail, not just in the activity feed: for an uploaded agreement the document IS the
  // terms, so which file was attached and when is evidence the certificate should reproduce.
  await recordAgreementEvent(params.id, "DOCUMENT_ATTACHED", {
    ip,
    meta: { kind: parsed.kind, file: parsed.sourceName, sha256: parsed.sourceSha256, by: session.user.email },
  });
  await logActivity(session, {
    action: "agreement.document.upload",
    section: "agreements",
    entityType: "Agreement",
    entityId: params.id,
    summary: `Attached ${parsed.sourceName} to the draft agreement for ${data.data.student.fullName}`,
    meta: { kind: parsed.kind, bytes: parsed.sourceSize, documentNo: row.documentNo },
  });

  return NextResponse.json({
    ok: true,
    kind: parsed.kind,
    warnings: parsed.warnings,
    fieldSummary: describeFields(fields),
  });
}
