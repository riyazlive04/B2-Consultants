import { NextResponse } from "next/server";
import { getPublicInvoicePdfData } from "@/server/payments-metrics";
import { renderInvoicePdf } from "@/documents/invoice-pdf";

/** Public invoice/estimate PDF, addressed by publicToken. Available once the doc is not DRAFT/VOID. */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request, { params }: { params: { token: string } }) {
  // One builder for the page and the PDF: this route used to re-assemble the document field by
  // field (with its own date formatting), so every addition to an invoice had to be made twice.
  const inv = await getPublicInvoicePdfData(params.token);
  if (!inv) return new NextResponse("Not found", { status: 404 });

  const bytes = await renderInvoicePdf(inv);

  const download = new URL(req.url).searchParams.get("download") === "1";
  return new NextResponse(new Uint8Array(bytes), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Length": String(bytes.length),
      "Content-Disposition": `${download ? "attachment" : "inline"}; filename="${inv.number}.pdf"`,
      "Cache-Control": "private, no-store, max-age=0",
    },
  });
}
