import { notFound } from "next/navigation";
import { Download } from "lucide-react";
import { getPublicInvoice } from "@/server/payments-metrics";
import { DateText } from "@/components/ui/DateText";

/**
 * The invoice as the customer sees it - the same document the PDF prints, in the browser.
 *
 * Both read one builder (`payments-metrics.invoiceDocument`), so the page and the PDF cannot
 * state different figures, a different tax line or a different issuer. Everything arrives
 * pre-formatted in the currency the invoice was issued in; nothing is computed here.
 */

export const dynamic = "force-dynamic";

export default async function PublicInvoicePage({ params }: { params: { token: string } }) {
  const inv = await getPublicInvoice(params.token);
  if (!inv) notFound();
  const title = inv.kind === "ESTIMATE" ? "Estimate" : "Invoice";
  const iss = inv.issuer;
  const cityLine = [iss.postcode, iss.city].filter(Boolean).join(" ");

  return (
    <main className="min-h-screen bg-app px-4 py-10">
      <div className="mx-auto max-w-3xl space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h1 className="font-display text-h1 font-bold text-ink">{title} {inv.number}</h1>
          <a href={`/i/${params.token}/pdf?download=1`} className="inline-flex h-10 items-center gap-2 rounded-btn bg-primary px-4 text-sm font-semibold text-on-accent hover:bg-primary-strong">
            <Download size={16} /> Download PDF
          </a>
        </div>

        <div className="overflow-hidden rounded-card border border-line bg-surface shadow-card">
          {/* ── Who is issuing it, and what it is ── */}
          <div className="flex flex-wrap items-start justify-between gap-4 border-b border-line p-6">
            <div className="text-sm">
              <p className="font-display text-h3 text-primary">{iss.name}</p>
              <div className="mt-1 text-caption text-ink-3">
                {iss.addressLines.map((l, i) => <p key={i}>{l}</p>)}
                {cityLine && <p>{cityLine}</p>}
                {iss.country && <p>{iss.country}</p>}
                {iss.email && <p className="mt-1">{iss.email}</p>}
                {iss.phone && <p>{iss.phone}</p>}
                {iss.taxId && <p className="mt-1">Tax ID {iss.taxId}</p>}
                {iss.registrationNo && <p>Reg. no. {iss.registrationNo}</p>}
              </div>
            </div>
            <div className="text-right text-sm">
              <p className="text-label uppercase text-ink-3">Bill to</p>
              <p className="font-semibold text-ink">{inv.customerName}</p>
              {inv.customerEmail && <p className="text-ink-3">{inv.customerEmail}</p>}
              {inv.customerPhone && <p className="text-ink-3">{inv.customerPhone}</p>}
              <p className="mt-2 text-caption text-ink-3">Issued <DateText date={inv.issueDate} /></p>
              {inv.dueDate && <p className="text-caption text-ink-3">Due <DateText date={inv.dueDate} /></p>}
              <p className="text-caption text-ink-3">Currency {inv.currency}</p>
            </div>
          </div>

          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-line bg-surface-2 text-label uppercase text-ink-2">
                <th className="px-6 py-2.5 text-left">Description</th>
                <th className="px-3 py-2.5 text-right">Qty</th>
                <th className="px-3 py-2.5 text-right">Unit price</th>
                <th className="px-6 py-2.5 text-right">Amount</th>
              </tr>
            </thead>
            <tbody>
              {inv.items.map((it, i) => (
                <tr key={i} className="border-b border-line">
                  <td className="px-6 py-3 text-ink">{it.description}</td>
                  <td className="px-3 py-3 text-right text-ink-2">{it.quantity}</td>
                  <td className="px-3 py-3 text-right text-ink-2">{it.unitPriceDisplay}</td>
                  <td className="px-6 py-3 text-right font-medium text-ink">{it.lineTotalDisplay}</td>
                </tr>
              ))}
            </tbody>
          </table>

          {/* A row that would read zero is left out entirely - see the PDF's note. */}
          <div className="flex justify-end p-6">
            <div className="w-72 space-y-1 text-sm">
              <Row label="Subtotal" value={inv.subtotalDisplay} />
              {inv.discountDisplay && <Row label="Discount" value={`-${inv.discountDisplay}`} />}
              {inv.taxLineLabel && inv.taxDisplay && <Row label={inv.taxLineLabel} value={inv.taxDisplay} />}
              <div className="flex justify-between border-t border-line pt-2 text-base font-bold text-ink">
                <span>{inv.settled ? "Total paid" : "Total due"}</span>
                <span>{inv.settled ? inv.totalDisplay : inv.balanceDisplay}</span>
              </div>
              <div className="flex justify-between text-caption text-ink-3">
                <span>approx. {inv.convertedTotalDisplay}</span>
                <span>Total {inv.totalDisplay}</span>
              </div>
              <p className="text-right text-caption text-ink-3">{inv.convertedRateNote}</p>
              {!inv.settled && (
                <div className="flex justify-between text-caption text-ink-3">
                  <span>Paid to date</span><span>{inv.amountPaidDisplay}</span>
                </div>
              )}
            </div>
          </div>

          {/* How to pay, the standing terms, and anything written on this one. */}
          {(!inv.settled && iss.bankDetails) || iss.paymentTerms || inv.notes ? (
            <div className="grid gap-6 border-t border-line p-6 text-sm text-ink-2 sm:grid-cols-3">
              {!inv.settled && iss.bankDetails && <Note label="How to pay" text={iss.bankDetails} />}
              {iss.paymentTerms && <Note label="Terms" text={iss.paymentTerms} />}
              {inv.notes && <Note label="Notes" text={inv.notes} />}
            </div>
          ) : null}

          <div className="flex flex-wrap items-center justify-between gap-2 border-t border-line bg-surface-2 px-6 py-3 text-caption text-ink-3">
            <span>{inv.issuedByName ? `Issued by ${inv.issuedByName}` : iss.name}</span>
            <span>{iss.website || iss.email}</span>
          </div>
        </div>

        <p className="text-center text-caption text-ink-3">Online payment coming soon · pay via the details on your invoice.</p>
      </div>
    </main>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return <div className="flex justify-between text-ink-2"><span>{label}</span><span>{value}</span></div>;
}

function Note({ label, text }: { label: string; text: string }) {
  return (
    <div>
      <p className="text-label uppercase text-ink-3">{label}</p>
      <p className="mt-1 whitespace-pre-wrap">{text}</p>
    </div>
  );
}
