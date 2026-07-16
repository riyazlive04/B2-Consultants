"use client";

import { useState } from "react";
import Link from "next/link";
import { Plus, RefreshCw, Trash2 } from "lucide-react";
import { Btn, IconButton } from "@/components/ui/controls";
import { Modal } from "@/components/ui/Modal";
import { Field, TextInput, Select, SubmitButton, FormError } from "@/components/ui/form";
import { toast, askConfirm } from "@/components/ui/feedback";
import { EmptyState, Pill } from "@/components/ui/kit";
import { DataTable, type Column } from "@/components/ui/DataTable";
import { DateText } from "@/components/ui/DateText";
import { AmountPair } from "@/components/ui/AmountPair";
import { createSubscription, setSubscriptionStatus, deleteSubscription } from "@/server/payments-actions";

type Row = {
  id: string; customerName: string; contactId: string | null; productName: string | null;
  amountDisplay: string; amountEurDisplay: string | null; interval: string; status: string; nextBillingDate: Date | null;
};
type Pickers = { contacts: { id: string; name: string }[]; products: { id: string; name: string; priceInr: string }[] };

const INTERVAL_OPTS = [
  { value: "MONTHLY", label: "Monthly" }, { value: "QUARTERLY", label: "Quarterly" },
  { value: "YEARLY", label: "Yearly" }, { value: "ONE_TIME", label: "One-time" },
];

/** Parse a formatted money string (₹1,00,000.99) into a number for sorting. */
function amountValue(s: string): number {
  const n = Number(s.replace(/[^0-9.-]/g, ""));
  return Number.isFinite(n) ? n : 0;
}

export default function SubscriptionsTab({
  rows, pickers, canDelete, fxRate, fxStale,
}: {
  rows: Row[]; pickers: Pickers; canDelete: boolean; fxRate: number; fxStale?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function create(fd: FormData) {
    setError(null);
    const res = await createSubscription(fd);
    if (!res.ok) return setError(res.error);
    toast("Subscription created");
    setOpen(false);
  }
  async function cycle(r: Row) {
    const next = r.status === "ACTIVE" ? "PAUSED" : r.status === "PAUSED" ? "ACTIVE" : "ACTIVE";
    const res = await setSubscriptionStatus(r.id, next);
    if (res.ok) toast(`Set ${next.toLowerCase()}`);
  }
  async function cancel(r: Row) {
    if (!(await askConfirm({ title: "Cancel subscription?", danger: true }))) return;
    const res = await setSubscriptionStatus(r.id, "CANCELLED");
    if (res.ok) toast("Cancelled");
  }
  async function remove(r: Row) {
    if (!(await askConfirm({ title: "Delete subscription?", danger: true }))) return;
    const res = await deleteSubscription(r.id);
    toast(res.ok ? "Deleted" : res.error, res.ok ? "success" : "error");
  }

  const columns: Column<Row>[] = [
    {
      key: "customer", header: "Customer",
      cell: (r) => r.contactId ? <Link href={`/contacts/${r.contactId}`} className="text-sm font-semibold text-ink hover:text-primary">{r.customerName}</Link> : <span className="text-sm font-semibold text-ink">{r.customerName}</span>,
      value: (r) => r.customerName,
    },
    { key: "plan", header: "Plan", cell: (r) => r.productName ?? "—", value: (r) => r.productName },
    {
      key: "amount", header: "Amount", align: "right",
      cell: (r) => (
        <>
          <span className="block font-medium text-ink">{r.amountDisplay}</span>
          {r.amountEurDisplay && <span className="block text-xs text-ink-3">{r.amountEurDisplay}</span>}
        </>
      ),
      value: (r) => amountValue(r.amountDisplay),
    },
    { key: "billing", header: "Billing", cell: (r) => r.interval.replace("_", "-").toLowerCase(), value: (r) => r.interval },
    { key: "next", header: "Next", cell: (r) => (r.nextBillingDate ? <DateText date={r.nextBillingDate} /> : "—"), value: (r) => (r.nextBillingDate ? r.nextBillingDate.getTime() : null) },
    { key: "status", header: "Status", cell: (r) => <Pill tone={r.status === "ACTIVE" ? "good" : r.status === "CANCELLED" ? "bad" : "warn"}>{r.status}</Pill>, value: (r) => r.status },
    {
      key: "actions", header: "Actions", align: "right", sortable: false,
      cell: (r) => (
        <div className="flex items-center justify-end gap-1">
          {r.status !== "CANCELLED" && <Btn size="sm" variant="ghost" onClick={() => cycle(r)}>{r.status === "ACTIVE" ? "Pause" : "Resume"}</Btn>}
          {r.status !== "CANCELLED" && <Btn size="sm" variant="ghost" onClick={() => cancel(r)}>Cancel</Btn>}
          {canDelete && <IconButton label="Delete subscription" onClick={() => remove(r)}><Trash2 size={16} /></IconButton>}
        </div>
      ),
    },
  ];

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <Btn icon={<Plus size={16} />} onClick={() => { setError(null); setOpen(true); }}>New subscription</Btn>
      </div>

      {rows.length === 0 ? (
        <EmptyState icon={<RefreshCw size={20} />} title="No subscriptions" body="Track recurring plans here (billing runs manually until a processor is wired)." />
      ) : (
        <DataTable
          rows={rows}
          columns={columns}
          csvName="subscriptions"
          filterPlaceholder="Filter subscriptions…"
          emptyMessage="No subscriptions match."
        />
      )}

      <Modal open={open} onClose={() => setOpen(false)} title="New subscription" size="sm">
        <form action={create} className="space-y-4">
          <Field label="Contact (optional)">
            <Select name="leadId" options={[{ value: "", label: "— none / manual —" }, ...pickers.contacts.slice(0, 500).map((c) => ({ value: c.id, label: c.name }))]} defaultValue="" />
          </Field>
          <Field label="Customer name"><TextInput name="customerName" required /></Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Product (optional)"><Select name="productId" options={[{ value: "", label: "— none —" }, ...pickers.products.map((p) => ({ value: p.id, label: p.name }))]} defaultValue="" /></Field>
            <Field label="Billing"><Select name="interval" options={INTERVAL_OPTS} defaultValue="MONTHLY" /></Field>
            <AmountPair
              fxRate={fxRate}
              fxStale={fxStale}
              inrName="amountInr"
              eurName="amountEur"
              inrLabel="Amount (₹)"
              eurLabel="Amount (€)"
              baseHint="INR, EUR, or both"
            />
            <Field label="Next billing"><TextInput name="nextBillingDate" type="date" /></Field>
          </div>
          <FormError message={error} />
          <div className="flex justify-end gap-2"><Btn variant="ghost" type="button" onClick={() => setOpen(false)}>Cancel</Btn><SubmitButton>Create</SubmitButton></div>
        </form>
      </Modal>
    </div>
  );
}
