import { notFound } from "next/navigation";
import nextDynamic from "next/dynamic";
import { requireSection } from "@/lib/rbac";
import { getInvoiceSettings } from "@/server/founder-config";
import { getTodayInrPerEur } from "@/lib/fx";
import { invoiceIssueGapsFor } from "@/lib/invoice-compliance";
import { getInvoice, getInvoicePickers } from "@/server/payments-metrics";

// See src/app/(app)/payments/new/page.tsx for why this is aliased to `nextDynamic`.
const InvoiceEditor = nextDynamic(() => import("../_components/InvoiceEditor"));

export const dynamic = "force-dynamic";

/**
 * The tab says WHICH invoice, because here it can.
 *
 * Every other detail screen takes a static section name: naming the record would mean a second
 * copy of its query for the label alone. `getInvoice` is `cache()`d, so this one asks the
 * question the page is already asking and gets the answer for nothing.
 *
 * An issued invoice is named by its number, which is what the customer quotes back. A draft has
 * only a placeholder reference, so it says so.
 */
export async function generateMetadata({ params }: { params: { id: string } }) {
  const invoice = await getInvoice(params.id);
  if (!invoice) return { title: "Payments" };
  const noun = invoice.kind === "ESTIMATE" ? "Estimate" : "Invoice";
  return { title: invoice.provisional ? `Draft ${noun.toLowerCase()}` : invoice.number };
}

export default async function InvoicePage({ params }: { params: { id: string } }) {
  await requireSection("payments");
  const [invoice, pickers, settings, fx] = await Promise.all([
    getInvoice(params.id),
    getInvoicePickers(),
    getInvoiceSettings(),
    getTodayInrPerEur(),
  ]);
  if (!invoice) notFound();

  /*
    What this draft still needs before it may be issued, computed HERE so the editor can say it
    instead of the operator discovering it by pressing Send.

    Only for an unissued invoice: an estimate is never issued, and an invoice that already has
    its number is a closed document whose gaps are no longer answerable.
  */
  const issueGaps =
    invoice.kind === "INVOICE" && invoice.status === "DRAFT"
      ? invoiceIssueGapsFor({
          issuer: settings.issuer,
          invoice: {
            customerName: invoice.customerName,
            customerAddress: invoice.customerAddress,
            servicePeriodStart: invoice.servicePeriodStart || null,
            taxPercent: invoice.taxPercent,
            taxNote: invoice.taxNote,
          },
          fallbackTaxNote: settings.tax[invoice.currency].note,
        })
      : [];

  return (
    <div className="w-full">
      <InvoiceEditor
        invoice={invoice}
        kind={invoice.kind}
        pickers={pickers}
        tax={settings.tax}
        fxRate={Number(fx.rate)}
        issueGaps={issueGaps}
      />
    </div>
  );
}
