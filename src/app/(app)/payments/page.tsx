import { requireSection } from "@/lib/rbac";
import { hasCapability } from "@/lib/capabilities";
import { getTodayInrPerEur } from "@/lib/fx";
import { Grid } from "@/components/ui/kit";
import { ListHeader } from "@/components/ui/ListHeader";
import { MetricCard } from "@/components/ui/MetricCard";
import { Tabs } from "@/components/ui/Tabs";
import { PeriodBar } from "@/components/ui/PeriodBar";
import { parsePeriod, resolvePeriod } from "@/lib/period";
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

export default async function PaymentsPage({
  searchParams,
}: {
  searchParams?: { period?: string; on?: string; from?: string; to?: string; range?: string };
}) {
  const session = await requireSection("payments");
  // Defaults to "all" rather than "month": an invoice board whose default hid every invoice
  // older than the 1st would be a surprising regression for anyone chasing an old debt.
  const periodSpec = parsePeriod(searchParams ?? {});
  const period = resolvePeriod(periodSpec);
  const canDelete = hasCapability(session.role, session.capabilities, "finance.write");

  const [overview, invoices, estimates, products, subs, pickers, fx, archInvoices, archProducts] =
    await Promise.all([
      getPaymentsOverview(period),
      getInvoicesList("INVOICE", period),
      getInvoicesList("ESTIMATE", period),
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
      <ListHeader
        title="Payments"
        subtitle="Invoices, estimates, products & subscriptions"
        actions={<PeriodBar spec={periodSpec} />}
      />

      <Grid cols={4}>
        <MetricCard
          label={`Draft (${overview.counts.draft})`}
          value={overview.draftInr}
          detail={{
            rows: invoices.filter((i) => i.status === "DRAFT").length
              ? invoices.filter((i) => i.status === "DRAFT").slice(0, 5).map((i) => ({ label: i.customerName, value: i.totalDisplay }))
              : [{ label: "No draft invoices", value: "—" }],
            note: overview.counts.draft > 5 ? `Showing 5 of ${overview.counts.draft}.` : undefined,
          }}
        />
        <MetricCard
          label={`Due (${overview.counts.sent})`}
          value={overview.dueInr}
          signal="watch"
          detail={{
            rows: invoices.filter((i) => i.status !== "DRAFT" && i.status !== "PAID" && i.status !== "VOID").length
              ? invoices
                  .filter((i) => i.status !== "DRAFT" && i.status !== "PAID" && i.status !== "VOID")
                  .slice(0, 5)
                  .map((i) => ({ label: i.customerName, value: i.balanceDisplay }))
              : [{ label: "Nothing due", value: "—" }],
            note: overview.counts.sent > 5 ? `Showing 5 of ${overview.counts.sent}.` : undefined,
          }}
        />
        <MetricCard
          label="Received"
          value={overview.receivedInr}
          signal="ok"
          detail={{
            rows: overview.receivedByMethod.length
              ? overview.receivedByMethod.map((m) => ({ label: m.method, value: m.amountInr }))
              : [{ label: "No payments received yet", value: "—" }],
            note: "By payment method.",
          }}
        />
        <MetricCard
          label={`Overdue (${overview.counts.overdue})`}
          value={overview.overdueInr}
          signal={overview.counts.overdue > 0 ? "risk" : undefined}
          detail={{
            rows: invoices.filter((i) => i.status !== "DRAFT" && i.status !== "PAID" && i.status !== "VOID" && i.dueDate && i.dueDate < new Date()).length
              ? invoices
                  .filter((i) => i.status !== "DRAFT" && i.status !== "PAID" && i.status !== "VOID" && i.dueDate && i.dueDate < new Date())
                  .slice(0, 5)
                  .map((i) => ({ label: i.customerName, value: i.balanceDisplay }))
              : [{ label: "Nothing overdue", value: "—" }],
            note: overview.counts.overdue > 5 ? `Showing 5 of ${overview.counts.overdue}.` : undefined,
          }}
        />
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
