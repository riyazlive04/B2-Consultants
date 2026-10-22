import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { hasCapability, requireSession } from "@/lib/rbac";

/**
 * A file a signer uploaded during their ceremony.
 *
 * Founder-only (`agreements.issue`). These are identity documents - a passport photo, a
 * certificate - so there is no public URL, no CDN and no caching anywhere, exactly as for the
 * agreement PDFs themselves.
 *
 * `attachmentId` is checked AGAINST the agreement in the path rather than looked up on its own.
 * Both are opaque cuids, so guessing one is not a realistic attack - but a scoped query means a
 * mismatched pair is a 404 rather than a file served from under a different agreement, and that
 * is one fewer thing to reason about.
 *
 * Always `attachment`, never `inline`: the content type comes from our own magic-byte sniff, but a
 * document uploaded by a stranger is not something to render in the founder's browser on this
 * origin when handing it to them as a download does the same job.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
  _req: Request,
  { params }: { params: { id: string; attachmentId: string } },
) {
  const session = await requireSession();
  if (!hasCapability(session.role, session.capabilities, "agreements.issue")) {
    return new NextResponse("Forbidden", { status: 403 });
  }

  const row = await prisma.agreementAttachment.findFirst({
    where: { id: params.attachmentId, agreementId: params.id },
    select: { bytes: true, mimeType: true, filename: true },
  });
  if (!row) return new NextResponse("Not found", { status: 404 });

  const bytes = Buffer.from(row.bytes);
  return new NextResponse(new Uint8Array(bytes), {
    headers: {
      "Content-Type": row.mimeType,
      "Content-Length": String(bytes.length),
      "Content-Disposition": `attachment; filename="${row.filename.replace(/"/g, "")}"`,
      "Cache-Control": "private, no-store, max-age=0",
      // The sniffed type is ours, but belt-and-braces on a file we did not author.
      "X-Content-Type-Options": "nosniff",
    },
  });
}
