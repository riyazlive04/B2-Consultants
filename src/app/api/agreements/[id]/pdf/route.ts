import { NextResponse } from "next/server";
import { headers } from "next/headers";
import { prisma } from "@/lib/prisma";
import { hasCapability, requireSession } from "@/lib/rbac";
import { clientIpFrom } from "@/lib/rate-limit";
import { parseAgreementData, recordAgreementEvent } from "@/server/agreement-core";
import { renderAgreementPdf } from "@/server/agreement-render";

/**
 * The founder's view of an agreement PDF.
 *
 * A DRAFT is rendered live from its fields (watermarked UNSIGNED). A SIGNED agreement is served
 * from `pdfBytes` — the exact bytes that were hashed at signing. It is never re-rendered: PDFKit
 * stamps a creation date, so a re-render would not reproduce `pdfSha256` and the artifact we hand
 * over must be the artifact we attested to.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request, { params }: { params: { id: string } }) {
  const session = await requireSession();
  if (!hasCapability(session.role, session.capabilities, "agreements.issue")) {
    return new NextResponse("Forbidden", { status: 403 });
  }

  const download = new URL(req.url).searchParams.get("download") === "1";

  const row = await prisma.agreement.findUnique({
    where: { id: params.id },
    select: {
      id: true,
      documentNo: true,
      templateVersion: true,
      data: true,
      status: true,
      signedAt: true,
      founderSignedAt: true,
      founderSignaturePng: true,
      studentSignaturePng: true,
      pdfBytes: true, // the one query in the app that is allowed to pull the bytea
    },
  });
  if (!row) return new NextResponse("Not found", { status: 404 });

  let bytes: Buffer;
  if (row.pdfBytes && row.signedAt) {
    bytes = Buffer.from(row.pdfBytes);
    if (download) {
      const h = await Promise.resolve(headers());
      await recordAgreementEvent(row.id, "COPY_DOWNLOADED", {
        ip: clientIpFrom(h),
        userAgent: h.get("user-agent"),
        meta: { by: session.user.email },
      });
    }
  } else {
    const parsed = parseAgreementData(row.data);
    if (!parsed.ok) return new NextResponse(`Invalid fields: ${parsed.error}`, { status: 422 });
    bytes = await renderAgreementPdf({
      documentNo: row.documentNo,
      data: parsed.data,
      templateVersion: row.templateVersion,
      founderSignaturePng: row.founderSignaturePng,
      founderSignedAt: row.founderSignedAt,
    });
  }

  return new NextResponse(new Uint8Array(bytes), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Length": String(bytes.length),
      "Content-Disposition": `${download ? "attachment" : "inline"}; filename="${row.documentNo}.pdf"`,
      // Contains a home address and B2's IBANs. Nothing caches this, anywhere.
      "Cache-Control": "private, no-store, max-age=0",
    },
  });
}
