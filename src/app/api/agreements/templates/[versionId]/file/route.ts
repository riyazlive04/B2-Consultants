import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { hasCapability, requireSession } from "@/lib/rbac";

/**
 * The file a template version was uploaded from.
 *
 * Two readers, and the second is the reason this route exists at all:
 *   · the founder, downloading the `.docx` to edit the next draft in Word;
 *   · the FIELD DESIGNER, which renders a PDF's pages in the browser with pdf.js so the founder
 *     can drag signature boxes onto them. There is no server-side rasteriser in this image (and
 *     adding poppler for one screen is not worth it), so the bytes have to reach the browser.
 *
 * Session + `agreements.issue`. These documents carry a home address and B2's IBANs, so there is
 * no public URL and no caching anywhere - the same contract as the agreement PDF routes.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request, { params }: { params: { versionId: string } }) {
  const session = await requireSession();
  if (!hasCapability(session.role, session.capabilities, "agreements.issue")) {
    return new NextResponse("Forbidden", { status: 403 });
  }

  const row = await prisma.agreementTemplateVersion.findUnique({
    where: { id: params.versionId },
    select: { sourceBytes: true, sourceMime: true, sourceName: true },
  });
  if (!row?.sourceBytes) return new NextResponse("Not found", { status: 404 });

  const download = new URL(req.url).searchParams.get("download") === "1";
  const bytes = Buffer.from(row.sourceBytes);

  return new NextResponse(new Uint8Array(bytes), {
    headers: {
      "Content-Type": row.sourceMime,
      "Content-Length": String(bytes.length),
      "Content-Disposition": `${download ? "attachment" : "inline"}; filename="${row.sourceName.replace(/"/g, "")}"`,
      "Cache-Control": "private, no-store, max-age=0",
    },
  });
}
