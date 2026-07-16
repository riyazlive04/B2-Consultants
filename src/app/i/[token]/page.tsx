import { notFound } from "next/navigation";
import { Download } from "lucide-react";
import { getPublicInvoice } from "@/server/payments-metrics";
import { DateText } from "@/components/ui/DateText";

export const dynamic = "force-dynamic";

export default async function PublicInvoicePage({ params }: { params: { token: string } }) {
  const inv = await getPublicInvoice(params.token);
  if (!inv) notFound();
  const title = inv.kind === "ESTIMATE" ? "Estimate" : "Invoice";

  return (
    <main className="min-h-screen bg-app px-4 py-10">
      <div className="mx-auto max-w-2xl space-y-4">
        <div className="flex items-center justify-between">
          <h1 className="font-display text-h1 font-bold text-ink">{title} {inv.number}</h1>
          <a href={`/i/${params.token}/pdf?download=1`} className="inline-flex h-10 items-center gap-2 rounded-btn bg-primary px-4 text-sm font-semibold text-on-accent hover:bg-primary-strong">
            <Download size={16} /> Download PDF
          </a>
        </div>

        <div className="overflow-hidden rounded-card border border-line bg-surface shadow-card">
          <div className="flex items-start justify-between gap-4 border-b border-line p-6">
            <div>
              <p className="font-display text-h3 text-primary">B2 Consultants</p>
              <p className="text-caption text-ink-3">Reichelsheim, Germany</p>
            </div>
            <div className="text-right text-sm">
              <p className="text-ink-2">Bill to</p>
              <p className="font-semibold text-ink">{inv.customerName}</p>
              {inv.customerEmail && <p className="text-ink-3">{inv.customerEmail}</p>}
              <p className="mt-2 text-caption text-ink-3">Issued <DateText date={inv.issueDate} /></p>
              {inv.dueDate && <p className="text-caption text-ink-3">Due <DateText date={inv.dueDate} /></p>}
            </div>
          </div>

          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-line bg-surface-2 text-label uppercase text-ink-2">
                <th className="px-6 py-2.5 text-left">Description</th>
                <th className="px-3 py-2.5 text-right">Qty</th>
                <th className="px-3 py-2.5 text-right">Unit</th>
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

          <div className="flex justify-end p-6">
            <div className="w-64 space-y-1 text-sm">
              <Row label="Subtotal" value={inv.subtotalDisplay} />
              <Row label="Discount" value={`-${inv.discountDisplay}`} />
              <Row label={`Tax (${inv.taxPercent}%)`} value={inv.taxDisplay} />
              <div className="flex justify-between border-t border-line pt-2 text-base font-bold text-ink">
                <span>Total</span><span>{inv.totalDisplay}</span>
              </div>
              <div className="flex justify-between text-caption text-ink-3">
                <span>{inv.totalEurDisplay}</span><span>Balance {inv.balanceDisplay}</span>
              </div>
            </div>
          </div>

          {inv.notes && <div className="border-t border-line p-6 text-sm text-ink-2"><p className="text-label uppercase text-ink-3">Notes</p><p className="mt-1 whitespace-pre-wrap">{inv.notes}</p></div>}
        </div>

        <p className="text-center text-caption text-ink-3">Online payment coming soon · pay via the details on your invoice.</p>
      </div>
    </main>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return <div className="flex justify-between text-ink-2"><span>{label}</span><span>{value}</span></div>;
}
