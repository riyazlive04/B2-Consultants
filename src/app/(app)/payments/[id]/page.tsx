import { notFound } from "next/navigation";
import nextDynamic from "next/dynamic";
import { requireSection } from "@/lib/rbac";
import { getInvoice, getInvoicePickers } from "@/server/payments-metrics";

// See src/app/(app)/payments/new/page.tsx for why this is aliased to `nextDynamic`.
const InvoiceEditor = nextDynamic(() => import("../_components/InvoiceEditor"));

export const dynamic = "force-dynamic";

export default async function InvoicePage({ params }: { params: { id: string } }) {
  await requireSection("payments");
  const [invoice, pickers] = await Promise.all([getInvoice(params.id), getInvoicePickers()]);
  if (!invoice) notFound();

  return (
    <div className="w-full">
      <InvoiceEditor invoice={invoice} kind={invoice.kind} pickers={pickers} />
    </div>
  );
}
