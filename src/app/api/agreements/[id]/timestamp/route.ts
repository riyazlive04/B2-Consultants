import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { hasCapability, requireSession } from "@/lib/rbac";

/**
 * The RFC 3161 timestamp token for a sealed agreement, as a `.tsr` file.
 *
 * ── WHY THIS IS DOWNLOADABLE AT ALL ─────────────────────────────────────────────────────────
 * Because the token is only worth something OUTSIDE this app. It is a third party's signed
 * statement that the sealed PDF's hash existed at a given moment, and the way anybody checks that
 * is with their own tools, against the authority's own certificate:
 *
 *   openssl ts -verify -in <this file> -digest <pdfSha256> -CAfile <authority chain>
 *
 * A token nobody can get out of the database proves nothing to anybody, so it has a route.
 *
 * Served byte-for-byte as the authority returned it - nothing here re-encodes it, because a
 * re-encoded token is a broken signature.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(_req: Request, { params }: { params: { id: string } }) {
  const session = await requireSession();
  if (!hasCapability(session.role, session.capabilities, "agreements.issue")) {
    return new NextResponse("Forbidden", { status: 403 });
  }

  const row = await prisma.agreement.findUnique({
    where: { id: params.id },
    select: { documentNo: true, tsToken: true },
  });
  if (!row?.tsToken) return new NextResponse("This agreement has no timestamp token.", { status: 404 });

  const bytes = Buffer.from(row.tsToken);
  return new NextResponse(new Uint8Array(bytes), {
    headers: {
      // The IANA type for a timestamp reply. `openssl ts` does not care, but a mail client might.
      "Content-Type": "application/timestamp-reply",
      "Content-Length": String(bytes.length),
      "Content-Disposition": `attachment; filename="${row.documentNo}.tsr"`,
      "Cache-Control": "private, no-store, max-age=0",
    },
  });
}
