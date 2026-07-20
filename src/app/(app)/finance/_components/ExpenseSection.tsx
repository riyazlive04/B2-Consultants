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
import { EXPENSE_BUSINESS_LINE_LABELS, EXPENSE_CATEGORY_LABELS, optionsFrom } from "@/lib/labels";
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
  fxDate,
}: {
  rows: ExpenseRow[];
  today: string;
  fxRate: number;
  fxStale?: boolean;
  fxDate?: string;
}) {
  const [editing, setEditing] = useState<ExpenseRow | null>(null);
  const [error, setError] = useState<string | null>(null);
  const formRef = useRef<HTMLFormElement>(null);
  // Optimistic delete: hide the row immediately, put it back if the archive fails. Survives the
  // server action's revalidatePath (the row is simply gone from `rows` by then).
  const [removedIds, setRemovedIds] = useState<Set<string>>(new Set());
  const visibleRows = rows.filter((r) => !removedIds.has(r.id));

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
      title: `Archive expense to ${row.vendor}?`,
      body: "It moves to the Archived tab — you can restore it there.",
      confirmLabel: "Archive",
      danger: true,
    });
    if (!ok) return;
    setRemovedIds((s) => new Set(s).add(row.id)); // optimistic
    const res = await deleteExpense(row.id);
    if (!res.ok) {
      setRemovedIds((s) => {
        const n = new Set(s);
        n.delete(row.id);
        return n;
      });
      return toast(res.error, "error");
    }
    toast("Expense archived");
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
      key: "businessLine", header: "Business line",
      cell: (r) => (r.businessLine === "SHARED" ? "Shared" : r.businessLine === "B2" ? "B2" : "German Note"),
      value: (r) => r.businessLine,
    },
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
            fxDate={fxDate}
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
          <Field
            label="Business line"
            hint="Tag a cost that belongs to ONE business. Leave Shared for rent, ads and tools — those get split across both by revenue share."
          >
            <Select
              name="businessLine"
              options={optionsFrom(EXPENSE_BUSINESS_LINE_LABELS)}
              defaultValue={editing?.businessLine ?? "SHARED"}
            />
          </Field>
          {/* Not kind="name": a vendor is a company ("3M", "Zoho One"), not a person. */}
          <Field label="Paid to (vendor)">
            <TextInput kind="text" name="vendor" required placeholder="Who received this payment" defaultValue={editing?.vendor ?? ""} />
          </Field>
          <Field label="Notes (optional)">
            <TextInput kind="text" name="notes" placeholder="Any extra info" defaultValue={editing?.notes ?? ""} />
          </Field>
          <div className="flex items-end pb-1">
            <CheckboxField
              name="isCogs"
              label="Is this COGS?"
              defaultChecked={editing?.isCogs ?? false}
              // The COGS test is "would this cost exist if nobody enrolled?" — tutor
              // salary, books and delivery tools scale with students, so they are COGS.
              // A platform subscription (Skool, WATI) is paid whether or not anyone
              // enrols, so it belongs in Tools & Software. The old hint listed Skool as
              // a COGS example, which is exactly how it got misfiled.
              hint="Direct cost of delivering the programme — a cost you'd avoid if nobody enrolled (e.g. tutor salary, books, delivery tools). Platform subscriptions like Skool are Tools & Software, not COGS."
            />
          </div>
        </div>
        <div className="mt-4 flex items-center gap-3">
          <SubmitButton>{editing ? "Save changes" : "Add expense"}</SubmitButton>
          <FormError message={error} />
        </div>
        </form>
      </Card>

      <DataTable rows={visibleRows} columns={columns} csvName="expenses" filterPlaceholder="Filter expenses…" />
    </section>
  );
}
