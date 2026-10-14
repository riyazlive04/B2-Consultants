import { NextResponse } from "next/server";
import { getPublicReceiptPdfData } from "@/server/payments-metrics";
import { renderReceiptPdf } from "@/documents/receipt-pdf";

/**
 * A payment receipt PDF, public like its invoice - addressed by the invoice's unguessable token
 * AND the receipt number, so a receipt number alone (printed, sequential, guessable) opens nothing.
 * Staff download through this same route: one rendering, one source of truth.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request, { params }: { params: { token: string; number: string } }) {
  const receipt = await getPublicReceiptPdfData(params.token, decodeURIComponent(params.number));
  if (!receipt) return new NextResponse("Not found", { status: 404 });

  const bytes = await renderReceiptPdf(receipt);
  const download = new URL(req.url).searchParams.get("download") === "1";
  return new NextResponse(new Uint8Array(bytes), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Length": String(bytes.length),
      "Content-Disposition": `${download ? "attachment" : "inline"}; filename="${receipt.receiptNumber}.pdf"`,
      "Cache-Control": "private, no-store, max-age=0",
    },
  });
}
