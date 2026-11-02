import { NextResponse } from "next/server";
import { requireSection } from "@/lib/rbac";
import { getInvoicePdfData } from "@/server/payments-metrics";
import { renderInvoicePdf } from "@/documents/invoice-pdf";

/**
 * THE STAFF'S OWN COPY OF AN INVOICE PDF, keyed by id and behind the app's own auth.
 *
 * ── Why this route exists ────────────────────────────────────────────────────────────────────
 * The PDF button on the invoice editor pointed at `/i/[token]/pdf` - the CUSTOMER's link. That
 * route is correctly gated by `publicLinkIsLive`, so revoking a leaked URL, or letting one
 * expire, also took the invoice's PDF away from the team that issued it. The founder could not
 * download their own tax document from their own screen, and the only way to get it back was to
 * un-revoke the link they had deliberately killed.
 *
 * Two audiences, two doors. The public one keeps its gate; this one asks the question that
 * actually applies to a member of staff - may you open Payments - and is keyed by the invoice id
 * rather than the shareable token, so nothing here is guessable or forwardable.
 *
 * `getInvoicePdfData` is the same builder `sendInvoice` already used to attach a PDF to the
 * customer's email, so there is no second rendering path: one document, two ways in.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request, { params }: { params: { id: string } }) {
  // Redirects rather than 403s when refused, like every other guarded route in the app.
  await requireSection("payments");

  const inv = await getInvoicePdfData(params.id);
  if (!inv) return new NextResponse("Not found", { status: 404 });

  const bytes = await renderInvoicePdf(inv);
  const download = new URL(req.url).searchParams.get("download") === "1";
  return new NextResponse(new Uint8Array(bytes), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Length": String(bytes.length),
      "Content-Disposition": `${download ? "attachment" : "inline"}; filename="${inv.number}.pdf"`,
      // Never cached: an invoice is re-rendered from live data and a shared browser must not keep
      // somebody else's tax document in its disk cache.
      "Cache-Control": "private, no-store, max-age=0",
    },
  });
}
