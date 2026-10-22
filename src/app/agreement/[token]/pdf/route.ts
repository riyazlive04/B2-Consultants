import { NextResponse } from "next/server";
import { clientIpFrom, rateLimitOk } from "@/lib/rate-limit";
import { loadAgreementByToken, parseAgreementData } from "@/server/agreement-core";
import { uploadedBodyFor } from "@/server/agreement-body";
import { renderAgreementPdf } from "@/server/agreement-render";
import type { AgreementData } from "@/lib/agreement";

/**
 * The document the student reads before signing. PUBLIC, gated only by the token.
 *
 * Rendered live from the same component the sealed copy will use, so "what they read" and "what
 * they signed" cannot differ. It carries an UNSIGNED watermark and no student signature, and the
 * content hash in its header is the same one that will appear on the executed copy - which is how
 * the student can tell the two are the same terms.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request, { params }: { params: { token: string } }) {
  const ip = clientIpFrom(new Headers(req.headers));
  // A token is unguessable, but rendering is CPU-bound - don't let a leaked link become a lever.
  if (!rateLimitOk(`agr:pdf:ip:${ip}`, 60, 60 * 60_000)) {
    return new NextResponse("Too many requests", { status: 429 });
  }

  const found = await loadAgreementByToken(params.token);
  if (!found.ok) return new NextResponse("This signing link is not valid.", { status: 404 });
  const { row } = found;

  const parsed = parseAgreementData(row.data);
  if (!parsed.ok) return new NextResponse("This agreement is not ready to sign.", { status: 422 });

  // An uploaded document renders from its own body; a guided one has none. A missing body on a
  // kind that needs one is a 422, not a half-document: the student must never be shown a contract
  // with the prose missing.
  const body = row.documentKind === "GUIDED" ? null : await uploadedBodyFor(row.id);
  if (row.documentKind !== "GUIDED" && !body) {
    return new NextResponse("This agreement is not ready to sign.", { status: 422 });
  }

  const bytes = await renderAgreementPdf({
    documentNo: row.documentNo,
    data: parsed.data as AgreementData,
    templateVersion: row.templateVersion,
    body,
    founderSignaturePng: row.founderSignaturePng,
    founderSignedAt: row.founderSignedAt,
    // No student signature, no certificate: this is not an executed agreement and must not look like one.
  });

  return new NextResponse(new Uint8Array(bytes), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Length": String(bytes.length),
      "Content-Disposition": `inline; filename="${row.documentNo}.pdf"`,
      "Cache-Control": "private, no-store, max-age=0",
    },
  });
}
