import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { hasCapability, requireSession } from "@/lib/rbac";

/**
 * The file THIS agreement's document was uploaded from.
 *
 * Mirror of the template version's file route, and it exists for the same two readers: the
 * founder downloading the `.docx` to revise in Word, and the field designer rendering a PDF's
 * pages in the browser with pdf.js.
 *
 * Founder-only (`agreements.issue`), never public and never cached. The STUDENT is deliberately
 * not given access here even to their own agreement: what they are entitled to is the rendered
 * contract (`/agreement/<token>/pdf` and the sealed copy), not the unstamped source file.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request, { params }: { params: { id: string } }) {
  const session = await requireSession();
  if (!hasCapability(session.role, session.capabilities, "agreements.issue")) {
    return new NextResponse("Forbidden", { status: 403 });
  }

  const row = await prisma.agreementBody.findUnique({
    where: { agreementId: params.id },
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
