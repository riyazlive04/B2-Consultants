import { NextResponse } from "next/server";
import { requireSection } from "@/lib/rbac";
import { getReceiptPdfData } from "@/server/payments-metrics";
import { renderReceiptPdf } from "@/documents/receipt-pdf";

/**
 * THE STAFF'S OWN COPY OF A PAYMENT RECEIPT. See the invoice route beside this one for why.
 *
 * The Receipt buttons in the invoice editor pointed at `/i/[token]/receipt/[number]`, which rides
 * on the invoice's PUBLIC link and therefore dies with it: revoke the link and the team loses
 * every receipt under that invoice, which is the written confirmation of payment the agreement
 * promises (§7.4) and the thing a student asks for months later.
 *
 * Keyed by PAYMENT ID, not by receipt number. A receipt number is printed, sequential and
 * guessable - which is exactly why the public route insists on the token as well - so a staff
 * route addressed by number would be the weaker of the two despite being the guarded one.
 *
 * `getReceiptPdfData` is the builder the staff side already used; this is its missing door.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request, { params }: { params: { paymentId: string } }) {
  await requireSection("payments");

  const receipt = await getReceiptPdfData(params.paymentId);
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
