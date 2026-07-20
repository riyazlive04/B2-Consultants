import { requireSection } from "@/lib/rbac";
import { hasCapability } from "@/lib/capabilities";
import { getTodayInrPerEur } from "@/lib/fx";
import { Grid } from "@/components/ui/kit";
import { ListHeader } from "@/components/ui/ListHeader";
import { MetricCard } from "@/components/ui/MetricCard";
import { Tabs } from "@/components/ui/Tabs";
import {
  getPaymentsOverview, getInvoicesList, getProductsList, getSubscriptionsList, getInvoicePickers,
} from "@/server/payments-metrics";
import InvoicesTab from "./_components/InvoicesTab";
import ProductsTab from "./_components/ProductsTab";
import SubscriptionsTab from "./_components/SubscriptionsTab";
import { ArchivedGroups } from "@/components/ui/ArchivedGroups";
import { getArchivedInvoices, getArchivedProducts } from "@/server/archive-metrics";
import { restoreInvoice, purgeInvoice, restoreProduct, purgeProduct } from "@/server/payments-actions";

export const dynamic = "force-dynamic";

export default async function PaymentsPage() {
  const session = await requireSection("payments");
  const canDelete = hasCapability(session.role, session.capabilities, "finance.write");

  const [overview, invoices, estimates, products, subs, pickers, fx, archInvoices, archProducts] =
    await Promise.all([
      getPaymentsOverview(),
      getInvoicesList("INVOICE"),
      getInvoicesList("ESTIMATE"),
      getProductsList(),
      getSubscriptionsList(),
      getInvoicePickers(),
      getTodayInrPerEur(),
      getArchivedInvoices(),
      getArchivedProducts(),
    ]);
  const fxRate = Number(fx.rate);
  const archivedCount = archInvoices.length + archProducts.length;
  const canPurge = session.role === "ADMIN";

  return (
    <div className="w-full space-y-4">
      <ListHeader title="Payments" subtitle="Invoices, estimates, products & subscriptions" />

      <Grid cols={4}>
        <MetricCard label={`Draft (${overview.counts.draft})`} value={overview.draftInr} />
        <MetricCard label={`Due (${overview.counts.sent})`} value={overview.dueInr} signal="watch" />
        <MetricCard label="Received" value={overview.receivedInr} signal="ok" />
        <MetricCard label={`Overdue (${overview.counts.overdue})`} value={overview.overdueInr} signal={overview.counts.overdue > 0 ? "risk" : undefined} />
      </Grid>

      <Tabs
        tabs={[
          { label: `Invoices (${invoices.length})`, content: <InvoicesTab rows={invoices} kind="INVOICE" /> },
          { label: `Estimates (${estimates.length})`, content: <InvoicesTab rows={estimates} kind="ESTIMATE" /> },
          { label: `Products (${products.length})`, content: <ProductsTab rows={products} canDelete={canDelete} fxRate={fxRate} fxStale={fx.stale} /> },
          { label: `Subscriptions (${subs.length})`, content: <SubscriptionsTab rows={subs} pickers={pickers} canDelete={canDelete} fxRate={fxRate} fxStale={fx.stale} /> },
          {
            label: `Archived${archivedCount ? ` (${archivedCount})` : ""}`,
            content: (
              <ArchivedGroups
                canPurge={canPurge}
                groups={[
                  { label: "Invoices & estimates", noun: "invoice", rows: archInvoices, restore: restoreInvoice, purge: purgeInvoice },
                  { label: "Products", noun: "product", rows: archProducts, restore: restoreProduct, purge: purgeProduct },
                ]}
              />
            ),
          },
        ]}
      />
    </div>
  );
}
