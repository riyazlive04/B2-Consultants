"use client";

import { useRef, useState } from "react";
import { createExpense, deleteExpense, updateExpense } from "@/server/finance-actions";
import type { ExpenseRow } from "@/server/finance-metrics";
import { DataTable, type Column } from "@/components/ui/DataTable";
import { Card } from "@/components/ui/kit";
import { Btn } from "@/components/ui/controls";
import { askConfirm, toast } from "@/components/ui/feedback";
import { CheckboxField, Field, FormError, Select, SubmitButton, TextInput } from "@/components/ui/form";
import { formatDate, formatEurMinor, formatInrMinor } from "@/lib/format";
import { EXPENSE_CATEGORY_LABELS, optionsFrom } from "@/lib/labels";
import { AmountPair } from "@/components/ui/AmountPair";

const minorToInput = (raw: string) => {
  const v = BigInt(raw);
  return v === BigInt(0) ? "" : (Number(v) / 100).toFixed(2);
};

export function ExpenseSection({
  rows,
  today,
  fxRate,
  fxStale,
}: {
  rows: ExpenseRow[];
  today: string;
  fxRate: number;
  fxStale?: boolean;
}) {
  const [editing, setEditing] = useState<ExpenseRow | null>(null);
  const [error, setError] = useState<string | null>(null);
  const formRef = useRef<HTMLFormElement>(null);

  const submit = async (form: FormData) => {
    setError(null);
    const res = editing ? await updateExpense(editing.id, form) : await createExpense(form);
    if (!res.ok) return setError(res.error);
    toast(editing ? "Expense updated" : "Expense added");
    setEditing(null);
    formRef.current?.reset();
  };

  const remove = async (row: ExpenseRow) => {
    const ok = await askConfirm({
      title: `Delete expense to ${row.vendor}?`,
      body: "This cannot be undone.",
      confirmLabel: "Delete",
      danger: true,
    });
    if (!ok) return;
    await deleteExpense(row.id);
    toast("Expense deleted");
  };

  const columns: Column<ExpenseRow>[] = [
    { key: "date", header: "Date", cell: (r) => formatDate(r.date), value: (r) => r.date.slice(0, 10) },
    {
      key: "inr", header: "INR", align: "right",
      cell: (r) => (BigInt(r.amountInrRaw) === BigInt(0) ? "-" : formatInrMinor(BigInt(r.amountInrRaw))),
      value: (r) => Number(BigInt(r.amountInrRaw)) / 100,
    },
    {
      key: "eur", header: "EUR", align: "right",
      cell: (r) => (BigInt(r.amountEurRaw) === BigInt(0) ? "-" : formatEurMinor(BigInt(r.amountEurRaw))),
      value: (r) => Number(BigInt(r.amountEurRaw)) / 100,
    },
    {
      key: "agg", header: "Total (₹ · €)", align: "right",
      cell: (r) => `${formatInrMinor(r.agg.inr, { compact: true })} · ${formatEurMinor(r.agg.eur, { compact: true })}`,
      value: (r) => r.agg.inr / 100,
    },
    { key: "category", header: "Category", cell: (r) => EXPENSE_CATEGORY_LABELS[r.category], value: (r) => EXPENSE_CATEGORY_LABELS[r.category] },
    {
      key: "cogs", header: "COGS", cell: (r) => (r.isCogs ? "Yes" : "No"), value: (r) => (r.isCogs ? "Yes" : "No"),
    },
    { key: "vendor", header: "Paid to", cell: (r) => r.vendor, value: (r) => r.vendor },
    { key: "notes", header: "Notes", cell: (r) => r.notes ?? "", value: (r) => r.notes ?? "" },
    {
      key: "actions", header: "", sortable: false,
      cell: (r) => (
        <span className="flex gap-2 whitespace-nowrap">
          <Btn variant="ghost" size="sm" onClick={() => setEditing(r)}>Edit</Btn>
          <Btn variant="danger" size="sm" onClick={() => remove(r)}>Delete</Btn>
        </span>
      ),
      value: () => null,
    },
  ];

  return (
    <section className="space-y-4">
      <Card
        title={editing ? `Edit expense - ${editing.vendor}` : "Daily expense entry"}
        actions={
          editing ? (
            <Btn variant="ghost" size="sm" onClick={() => setEditing(null)}>
              Cancel edit
            </Btn>
          ) : undefined
        }
      >
        <form ref={formRef} action={submit} key={editing?.id ?? "new"}>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <Field label="Date">
            <TextInput type="date" name="date" required defaultValue={editing ? editing.date.slice(0, 10) : today} />
          </Field>
          <AmountPair
            fxRate={fxRate}
            fxStale={fxStale}
            inrName="amountInr"
            eurName="amountEur"
            inrLabel="Amount paid (₹)"
            eurLabel="Amount paid (€)"
            baseHint="INR, EUR, or both"
            defaultInr={editing ? minorToInput(editing.amountInrRaw) : ""}
            defaultEur={editing ? minorToInput(editing.amountEurRaw) : ""}
          />
          <Field label="Expense category">
            <Select name="category" options={optionsFrom(EXPENSE_CATEGORY_LABELS)} defaultValue={editing?.category ?? "TOOLS_SOFTWARE"} />
          </Field>
          <Field label="Paid to (vendor)">
            <TextInput name="vendor" required placeholder="Who received this payment" defaultValue={editing?.vendor ?? ""} />
          </Field>
          <Field label="Notes (optional)">
            <TextInput name="notes" placeholder="Any extra info" defaultValue={editing?.notes ?? ""} />
          </Field>
          <div className="flex items-end pb-1">
            <CheckboxField
              name="isCogs"
              label="Is this COGS?"
              defaultChecked={editing?.isCogs ?? false}
              hint="Direct cost to deliver the program (e.g. Karthick salary, Skool, delivery tools)"
            />
          </div>
        </div>
        <div className="mt-4 flex items-center gap-3">
          <SubmitButton>{editing ? "Save changes" : "Add expense"}</SubmitButton>
          <FormError message={error} />
        </div>
        </form>
      </Card>

      <DataTable rows={rows} columns={columns} csvName="expenses" filterPlaceholder="Filter expenses…" />
    </section>
  );
}
