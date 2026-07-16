import nextDynamic from "next/dynamic";
import { requireSection } from "@/lib/rbac";
import { getInvoicePickers } from "@/server/payments-metrics";

// Heavy form editor — code-split out of this route's bundle (BUILD_CHECKLIST.md §12). Aliased to
// `nextDynamic`: this file already exports the Next.js route-segment config `dynamic`, and `import
// dynamic from "next/dynamic"` would silently shadow it (the exact bug found in ProfileClient.tsx).
const InvoiceEditor = nextDynamic(() => import("../_components/InvoiceEditor"));

export const dynamic = "force-dynamic";

export default async function NewInvoicePage({ searchParams }: { searchParams: { kind?: string } }) {
  await requireSection("payments");
  const kind = searchParams.kind === "ESTIMATE" ? "ESTIMATE" : "INVOICE";
  const pickers = await getInvoicePickers();

  return (
    <div className="w-full">
      <InvoiceEditor invoice={null} kind={kind} pickers={pickers} />
    </div>
  );
}
