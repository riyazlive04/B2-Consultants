"use client";

import { useState } from "react";
import { Plus, Package, Trash2 } from "lucide-react";
import { Btn, IconButton } from "@/components/ui/controls";
import { Modal } from "@/components/ui/Modal";
import { Field, TextInput, TextArea, Select, SubmitButton, FormError } from "@/components/ui/form";
import { toast, askConfirm } from "@/components/ui/feedback";
import { EmptyState, Pill } from "@/components/ui/kit";
import { DataTable, type Column } from "@/components/ui/DataTable";
import { AmountPair } from "@/components/ui/AmountPair";
import { createProduct, updateProduct, deleteProduct } from "@/server/payments-actions";

type Row = {
  id: string; name: string; description: string | null;
  priceInr: string; priceEur: string; priceDisplay: string; priceEurDisplay: string | null;
  interval: string; active: boolean;
};

const INTERVAL_OPTS = [
  { value: "ONE_TIME", label: "One-time" }, { value: "MONTHLY", label: "Monthly" },
  { value: "QUARTERLY", label: "Quarterly" }, { value: "YEARLY", label: "Yearly" },
];

export default function ProductsTab({
  rows, canDelete, fxRate, fxStale,
}: {
  rows: Row[]; canDelete: boolean; fxRate: number; fxStale?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<Row | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function submit(fd: FormData) {
    setError(null);
    const res = editing ? await updateProduct(editing.id, fd) : await createProduct(fd);
    if (!res.ok) return setError(res.error);
    toast(editing ? "Product updated" : "Product added");
    setOpen(false);
  }
  async function remove(r: Row) {
    if (!(await askConfirm({ title: `Delete "${r.name}"?`, danger: true }))) return;
    const res = await deleteProduct(r.id);
    toast(res.ok ? "Product deleted" : res.error, res.ok ? "success" : "error");
  }

  const columns: Column<Row>[] = [
    {
      key: "product", header: "Product",
      cell: (r) => (
        <>
          <button onClick={() => { setEditing(r); setError(null); setOpen(true); }} className="text-left text-sm font-semibold text-ink hover:text-primary">{r.name}</button>
          {r.description && <span className="block text-xs text-ink-3">{r.description}</span>}
        </>
      ),
      value: (r) => r.name,
    },
    {
      key: "price", header: "Price",
      cell: (r) => (
        <>
          <span className="block">{r.priceDisplay}</span>
          {r.priceEurDisplay && <span className="block text-xs text-ink-3">{r.priceEurDisplay}</span>}
        </>
      ),
      value: (r) => Number(r.priceInr),
    },
    { key: "billing", header: "Billing", cell: (r) => r.interval.replace("_", "-").toLowerCase(), value: (r) => r.interval },
    { key: "status", header: "Status", cell: (r) => <Pill tone={r.active ? "good" : "neutral"}>{r.active ? "Active" : "Inactive"}</Pill>, value: (r) => (r.active ? 1 : 0) },
    {
      key: "actions", header: "Actions", align: "right", sortable: false,
      cell: (r) => (
        <div className="flex items-center justify-end gap-1">
          <Btn size="sm" variant="ghost" onClick={() => { setEditing(r); setError(null); setOpen(true); }}>Edit</Btn>
          {canDelete && <IconButton label="Delete product" onClick={() => remove(r)}><Trash2 size={16} /></IconButton>}
        </div>
      ),
    },
  ];

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <Btn icon={<Plus size={16} />} onClick={() => { setEditing(null); setError(null); setOpen(true); }}>New product</Btn>
      </div>

      {rows.length === 0 ? (
        <EmptyState icon={<Package size={20} />} title="No products yet" body="Add reusable products/services for invoices." />
      ) : (
        <DataTable
          rows={rows}
          columns={columns}
          csvName="products"
          filterPlaceholder="Filter products…"
          emptyMessage="No products match."
        />
      )}

      <Modal open={open} onClose={() => setOpen(false)} title={editing ? "Edit product" : "New product"} size="sm">
        <form action={submit} key={editing?.id ?? "new"} className="space-y-4">
          <Field label="Name"><TextInput name="name" required defaultValue={editing?.name ?? ""} /></Field>
          <Field label="Description"><TextArea name="description" rows={2} defaultValue={editing?.description ?? ""} /></Field>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <AmountPair
              fxRate={fxRate}
              fxStale={fxStale}
              inrName="priceInr"
              eurName="priceEur"
              inrLabel="Price (₹)"
              eurLabel="Price (€)"
              baseHint="INR, EUR, or both"
              defaultInr={editing?.priceInr ?? ""}
              defaultEur={editing?.priceEur ?? ""}
            />
            <Field label="Billing"><Select name="interval" options={INTERVAL_OPTS} defaultValue={editing?.interval ?? "ONE_TIME"} /></Field>
          </div>
          <Field label="Status"><Select name="active" options={[{ value: "on", label: "Active" }, { value: "off", label: "Inactive" }]} defaultValue={editing ? (editing.active ? "on" : "off") : "on"} /></Field>
          <FormError message={error} />
          <div className="flex justify-end gap-2"><Btn variant="ghost" type="button" onClick={() => setOpen(false)}>Cancel</Btn><SubmitButton>{editing ? "Save" : "Add product"}</SubmitButton></div>
        </form>
      </Modal>
    </div>
  );
}
