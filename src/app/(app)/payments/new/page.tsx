import nextDynamic from "next/dynamic";
import { requireSection } from "@/lib/rbac";
import { getInvoiceSettings } from "@/server/founder-config";
import { getTodayInrPerEur } from "@/lib/fx";
import { getInvoicePickers } from "@/server/payments-metrics";

// Heavy form editor - code-split out of this route's bundle (BUILD_CHECKLIST.md §12). Aliased to
// `nextDynamic`: this file already exports the Next.js route-segment config `dynamic`, and `import
// dynamic from "next/dynamic"` would silently shadow it (the exact bug found in ProfileClient.tsx).
const InvoiceEditor = nextDynamic(() => import("../_components/InvoiceEditor"));

export const dynamic = "force-dynamic";

export default async function NewInvoicePage({ searchParams }: { searchParams: { kind?: string } }) {
  await requireSection("payments");
  const kind = searchParams.kind === "ESTIMATE" ? "ESTIMATE" : "INVOICE";
  const [pickers, settings, fx] = await Promise.all([
    getInvoicePickers(),
    getInvoiceSettings(),
    getTodayInrPerEur(),
  ]);

  return (
    <div className="w-full">
      <InvoiceEditor
        invoice={null}
        kind={kind}
        pickers={pickers}
        tax={settings.tax}
        fxRate={Number(fx.rate)}
      />
    </div>
  );
}
