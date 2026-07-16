import { NextResponse } from "next/server";
import { getPublicInvoice } from "@/server/payments-metrics";
import { renderInvoicePdf } from "@/documents/invoice-pdf";

/** Public invoice/estimate PDF, addressed by publicToken. Available once the doc is not DRAFT/VOID. */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const fmt = (d: Date | null) => (d ? new Date(d).toLocaleDateString("en-GB") : null);

export async function GET(req: Request, { params }: { params: { token: string } }) {
  const inv = await getPublicInvoice(params.token);
  if (!inv) return new NextResponse("Not found", { status: 404 });

  const bytes = await renderInvoicePdf({
    kind: inv.kind,
    number: inv.number,
    status: inv.status,
    issueDate: fmt(inv.issueDate) ?? "",
    dueDate: fmt(inv.dueDate),
    customerName: inv.customerName,
    customerEmail: inv.customerEmail,
    items: inv.items,
    subtotalDisplay: inv.subtotalDisplay,
    discountDisplay: inv.discountDisplay,
    taxPercent: inv.taxPercent,
    taxDisplay: inv.taxDisplay,
    totalDisplay: inv.totalDisplay,
    totalEurDisplay: inv.totalEurDisplay,
    balanceDisplay: inv.balanceDisplay,
    notes: inv.notes,
  });

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
