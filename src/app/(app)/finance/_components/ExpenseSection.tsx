"use client";

import { useRef, useState } from "react";
import { createExpense, deleteExpense, updateExpense } from "@/server/finance-actions";
import type { ExpenseRow } from "@/server/finance-metrics";
import { DataTable, type Column } from "@/components/ui/DataTable";
import { Card } from "@/components/ui/kit";
import { Btn } from "@/components/ui/controls";
import { askConfirm, toast } from "@/components/ui/feedback";
import { guardAction } from "@/lib/action-guard";
import { CheckboxField, Field, FormError, NotesField, Select, SubmitButton, TextInput } from "@/components/ui/form";
import { useUnsavedGuard } from "@/components/ui/use-unsaved-guard";
import { formatDate, formatEurMinor, formatInrMinor } from "@/lib/format";
import { moneyInline, moneyValue } from "@/lib/money-display";
import { EXPENSE_BUSINESS_LINE_LABELS, EXPENSE_CATEGORY_LABELS, optionsFrom } from "@/lib/labels";
import { AmountPair } from "@/components/ui/AmountPair";
import { useFinanceCcy } from "./FinanceCurrency";
import { safeAction } from "@/lib/action-guard";

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
  defaultBusinessLine = "SHARED",
}: {
  rows: ExpenseRow[];
  today: string;
  fxRate: number;
  fxStale?: boolean;
  fxDate?: string;
  /**
   * What a new cost is tagged with when nobody says otherwise - the page's business-line switch,
   * or "SHARED" on the Combined view.
   *
   * An expense carries its line as a STORED column (unlike income, which derives it from the
   * level), so this is the whole of the fix here: filter the page to German Note and the next
   * cost you type is already a German Note cost. "Shared" remains the honest default for
   * Combined, because rent and tools genuinely do belong to both.
   */
  defaultBusinessLine?: string;
}) {
  const { ccy } = useFinanceCcy();
  const [editing, setEditing] = useState<ExpenseRow | null>(null);
  const [error, setError] = useState<string | null>(null);
  const formRef = useRef<HTMLFormElement>(null);
  // Warn before a refresh or a tab close throws away a half-typed entry.
  useUnsavedGuard(formRef);
  // Optimistic delete: hide the row immediately, put it back if the archive fails. Survives the
  // server action's revalidatePath (the row is simply gone from `rows` by then).
  const [removedIds, setRemovedIds] = useState<Set<string>>(new Set());
  const visibleRows = rows.filter((r) => !removedIds.has(r.id));

  /** Load a row into the form and take the eye there too (issue 21). */
  const startEdit = (row: ExpenseRow) => {
    setEditing(row);
    formRef.current?.scrollIntoView({ behavior: "smooth", block: "center" });
  };

  const submit = async (form: FormData) => {
    setError(null);
    // Guarded so an offline submit keeps what was typed instead of taking the page down with
    // it (issue 10) - see lib/action-guard.
    const guarded = await guardAction(() =>
      editing ? updateExpense(editing.id, form) : createExpense(form),
    );
    if (!guarded.ok) return setError(guarded.error);
    const res = guarded.value;
    if (!res.ok) return setError(res.error);
    toast(editing ? "Expense updated" : "Expense added");
    setEditing(null);
    formRef.current?.reset();
  };

  const remove = async (row: ExpenseRow) => {
    const ok = await askConfirm({
      title: `Archive expense to ${row.vendor}?`,
      body: "It moves to the Archived tab - you can restore it there.",
      confirmLabel: "Archive",
      danger: true,
    });
    if (!ok) return;
    setRemovedIds((s) => new Set(s).add(row.id)); // optimistic
    const res = await safeAction(() => deleteExpense(row.id));
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
    // "Paid ₹" / "Paid €" are as-entered columns - the currency the money actually left in,
    // dash where none did. Only the aggregate follows the ₹/€ toggle (see IncomeSection).
    {
      key: "inr", header: "Paid ₹", align: "right",
      cell: (r) => (BigInt(r.amountInrRaw) === BigInt(0) ? "-" : formatInrMinor(BigInt(r.amountInrRaw))),
      value: (r) => Number(BigInt(r.amountInrRaw)) / 100,
    },
    {
      key: "eur", header: "Paid €", align: "right",
      cell: (r) => (BigInt(r.amountEurRaw) === BigInt(0) ? "-" : formatEurMinor(BigInt(r.amountEurRaw))),
      value: (r) => Number(BigInt(r.amountEurRaw)) / 100,
    },
    {
      key: "agg", header: "Total", align: "right",
      cell: (r) => moneyInline(r.agg, ccy, { compact: true }),
      value: (r) => moneyValue(r.agg, ccy),
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
          {/* Scrolls to the form and tints the row (issue 21) - opening the editor from a row
              far down the table otherwise looked like a click that did nothing. */}
          <Btn variant="ghost" size="sm" onClick={() => startEdit(r)}>Edit</Btn>
          {/* "Archive" - the dialog already said so, the button did not (issue 26). The row moves
              to the Archived tab and can be restored for 90 days; "Delete permanently" lives
              there, on the only control that really destroys anything. */}
          <Btn variant="danger" size="sm" onClick={() => remove(r)}>Archive</Btn>
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
            {/* Browser's today on a new entry, the stored date when editing - see IncomeSection. */}
            <TextInput
              type="date"
              name="date"
              required
              defaultValue={editing ? editing.date.slice(0, 10) : today}
              defaultToday={!editing}
            />
          </Field>
          <AmountPair
            fxRate={fxRate}
            fxStale={fxStale}
            fxDate={fxDate}
            inrName="amountInr"
            eurName="amountEur"
            inrLabel="Price paid (₹)"
            eurLabel="Price paid (€)"
            baseHint="INR, EUR, or both"
            defaultInr={editing ? minorToInput(editing.amountInrRaw) : ""}
            defaultEur={editing ? minorToInput(editing.amountEurRaw) : ""}
          />
          <Field label="Expense category">
            <Select name="category" options={optionsFrom(EXPENSE_CATEGORY_LABELS)} defaultValue={editing?.category ?? "TOOLS_SOFTWARE"} />
          </Field>
          <Field
            label="Business line"
            hint="Tag a cost that belongs to ONE business. Leave Shared for rent, ads and tools - those get split across both by revenue share."
          >
            <Select
              name="businessLine"
              options={optionsFrom(EXPENSE_BUSINESS_LINE_LABELS)}
              defaultValue={editing?.businessLine ?? defaultBusinessLine}
            />
          </Field>
          {/* Not kind="name": a vendor is a company ("3M", "Zoho One"), not a person. */}
          <Field label="Paid to (vendor)">
            <TextInput kind="text" name="vendor" required placeholder="Who received this payment" defaultValue={editing?.vendor ?? ""} />
          </Field>
          {/* Counts down the last characters instead of silently swallowing them (issue 18). */}
          <NotesField placeholder="Any extra info" defaultValue={editing?.notes ?? ""} key={`notes-${editing?.id ?? "new"}`} />
          <div className="flex items-end pb-1">
            <CheckboxField
              name="isCogs"
              label="Is this COGS?"
              defaultChecked={editing?.isCogs ?? false}
              // The COGS test is "would this cost exist if nobody enrolled?" - tutor
              // salary, books and delivery tools scale with students, so they are COGS.
              // A platform subscription (Skool, WATI) is paid whether or not anyone
              // enrols, so it belongs in Tools & Software. The old hint listed Skool as
              // a COGS example, which is exactly how it got misfiled.
              hint="Direct cost of delivering the programme - a cost you'd avoid if nobody enrolled (e.g. tutor salary, books, delivery tools). Platform subscriptions like Skool are Tools & Software, not COGS."
            />
          </div>
        </div>
        <div className="mt-4 flex items-center gap-3">
          <SubmitButton>{editing ? "Save changes" : "Add expense"}</SubmitButton>
          <FormError message={error} />
        </div>
        </form>
      </Card>

      <DataTable
        rows={visibleRows}
        columns={columns}
        csvName="expenses"
        filterPlaceholder="Filter expenses…"
        // The row currently loaded into the form at the top of the tab (issue 21).
        rowClassName={(r) => (r.id === editing?.id ? "bg-accent-soft" : undefined)}
      />
    </section>
  );
}
