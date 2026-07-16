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

export const dynamic = "force-dynamic";

export default async function PaymentsPage() {
  const session = await requireSection("payments");
  const canDelete = hasCapability(session.role, session.capabilities, "finance.write");

  const [overview, invoices, estimates, products, subs, pickers, fx] = await Promise.all([
    getPaymentsOverview(),
    getInvoicesList("INVOICE"),
    getInvoicesList("ESTIMATE"),
    getProductsList(),
    getSubscriptionsList(),
    getInvoicePickers(),
    getTodayInrPerEur(),
  ]);
  const fxRate = Number(fx.rate);

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
        ]}
      />
    </div>
  );
}
