import { NextResponse } from "next/server";
import { clientIpFrom, rateLimitOk } from "@/lib/rate-limit";
import { loadSignedAgreementByToken, recordAgreementEvent } from "@/server/agreement-core";

/**
 * The student's countersigned copy. PUBLIC, gated only by the token.
 *
 * This is the other half of the promise the signing screen makes ("we'll send your countersigned
 * copy"). It serves the SEALED bytes — the exact ones that were hashed into `pdfSha256` at signing
 * — and never re-renders: PDFKit stamps a fresh creation date and document id, so a re-render
 * would produce a different file that no longer matches the hash on record.
 *
 * The sibling `[token]/pdf` route renders the UNSIGNED document for someone about to sign, and its
 * loader refuses a signed row. This one inverts that: signed rows only. Voided and declined
 * agreements can never reach it, because both paths null out `tokenHash`.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request, { params }: { params: { token: string } }) {
  const ip = clientIpFrom(new Headers(req.headers));
  if (!rateLimitOk(`agr:copy:ip:${ip}`, 60, 60 * 60_000)) {
    return new NextResponse("Too many requests", { status: 429 });
  }

  const row = await loadSignedAgreementByToken(params.token);
  if (!row?.pdfBytes) return new NextResponse("This link is not valid.", { status: 404 });

  await recordAgreementEvent(row.id, "COPY_DOWNLOADED", {
    ip,
    userAgent: req.headers.get("user-agent"),
    meta: { by: "student" },
  });

  const bytes = new Uint8Array(row.pdfBytes);
  return new NextResponse(bytes, {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Length": String(bytes.length),
      "Content-Disposition": `inline; filename="${row.documentNo}-signed.pdf"`,
      "Cache-Control": "private, no-store, max-age=0",
    },
  });
}
