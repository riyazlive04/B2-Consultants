import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { hasCapability, requireSession } from "@/lib/rbac";
import { parseBodyRow } from "@/server/agreement-body";
import { renderAgreementPdf } from "@/server/agreement-render";
import { UPLOAD_TEMPLATE_VERSIONS } from "@/lib/agreement-doc";
import { SAMPLE_AGREEMENT_DATA } from "@/lib/agreement-sample";

/**
 * What a template actually PRODUCES - rendered with sample data.
 *
 * ── WHY THIS MATTERS MORE THAN IT SOUNDS ────────────────────────────────────────────────────
 * Until this existed, a founder marking up a template could not see the document their marking-up
 * made. The block editor shows the prose, and the field list shows the boxes, but neither shows a
 * page - so the only way to find out whether the signature zone landed in a sensible place was to
 * raise a real agreement against a real student and look at that.
 *
 * It renders through `renderAgreementPdf`, the same function the student's copy goes through, so
 * what is previewed here is what the renderer will do - not a mock-up of it.
 *
 * ── THE SAMPLE DATA IS DELIBERATELY OBVIOUS ─────────────────────────────────────────────────
 * "Sample Student", a 0001 document number, an address that is plainly not real. A preview filled
 * with a plausible-looking name is one screenshot away from being mistaken for a real contract.
 * Everything else about it is honest: no signatures, so it carries the UNSIGNED watermark and the
 * empty signature zones exactly as a student would first see it.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(_req: Request, { params }: { params: { versionId: string } }) {
  const session = await requireSession();
  if (!hasCapability(session.role, session.capabilities, "agreements.issue")) {
    return new NextResponse("Forbidden", { status: 403 });
  }

  const row = await prisma.agreementTemplateVersion.findUnique({
    where: { id: params.versionId },
    select: {
      kind: true,
      blocks: true,
      fields: true,
      options: true,
      sourceName: true,
      sourceSha256: true,
      sourceBytes: true,
      pageCount: true,
      pageSizes: true,
      version: true,
      template: { select: { name: true } },
    },
  });
  if (!row) return new NextResponse("Not found", { status: 404 });

  const body = parseBodyRow(row);
  if (!body.ok) return new NextResponse(body.error, { status: 422 });

  const templateVersion = UPLOAD_TEMPLATE_VERSIONS[body.body.kind];
  const bytes = await renderAgreementPdf({
    documentNo: "PREVIEW-0001",
    data: SAMPLE_AGREEMENT_DATA,
    templateVersion,
    // The PDF path stamps onto the stored upload, so it needs the bytes; the DOCX path does not.
    body: body.body.kind === "PDF" ? { ...body.body, sourceBytes: row.sourceBytes } : body.body,
  });

  return new NextResponse(new Uint8Array(bytes), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Length": String(bytes.length),
      "Content-Disposition": `inline; filename="preview-${row.template.name.replace(/[^\w -]/g, "")}-v${row.version}.pdf"`,
      "Cache-Control": "private, no-store, max-age=0",
    },
  });
}
