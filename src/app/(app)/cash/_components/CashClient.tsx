"use client";

import { useState } from "react";
import { deletePayable, saveCashPosition, savePayable, setGrowthOverride } from "@/server/cash-actions";
import type { CashOverview, PayableRow } from "@/server/cash-metrics";
import { DataTable, type Column } from "@/components/ui/DataTable";
import { askConfirm, toast } from "@/components/ui/feedback";
import { Card, Pill } from "@/components/ui/kit";
import { Btn } from "@/components/ui/controls";
import { CheckboxField, Field, FormError, Select, SubmitButton, TextArea, TextInput } from "@/components/ui/form";
import { formatDate, formatInrMinor } from "@/lib/format";
import { EXPENSE_CATEGORY_LABELS, optionsFrom } from "@/lib/labels";

const FREQ_LABELS: Record<string, string> = {
  MONTHLY: "Monthly", QUARTERLY: "Quarterly", ANNUAL: "Annual", ONE_TIME: "One-time",
};
const PAYABLE_STATUS_LABELS: Record<string, string> = {
  ACTIVE: "Active", PAUSED: "Paused", CANCELLED: "Cancelled",
};

const minorToInput = (raw: string) => (Number(BigInt(raw)) / 100).toFixed(2);

/** Cash Position weekly entry + history. */
export function CashPositionSection({
  positions,
  today,
  stale,
}: {
  positions: CashOverview["positions"];
  today: string;
  stale: boolean;
}) {
  const [error, setError] = useState<string | null>(null);

  const columns: Column<CashOverview["positions"][number]>[] = [
    { key: "date", header: "Date", cell: (r) => formatDate(r.date), value: (r) => r.date.slice(0, 10) },
    {
      key: "balance", header: "Bank balance", align: "right",
      cell: (r) => formatInrMinor(r.balanceInr), value: (r) => r.balanceInr / 100,
    },
    {
      key: "savings", header: "Personal savings (planning only)", align: "right",
      cell: (r) => (r.personalSavingsInr === null ? "-" : formatInrMinor(r.personalSavingsInr)),
      value: (r) => (r.personalSavingsInr ?? 0) / 100,
    },
    { key: "notes", header: "Notes", cell: (r) => r.notes ?? "", value: (r) => r.notes ?? "" },
  ];

  return (
    <section className="space-y-4">
      <Card
        title="Weekly cash position (every Monday)"
        actions={stale ? <Pill tone="warn">⚠ Last entry is more than 7 days old</Pill> : undefined}
      >
      <form
        action={async (form) => {
          setError(null);
          const res = await saveCashPosition(form);
          if (!res.ok) return setError(res.error);
          toast("Cash position saved");
        }}
      >
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <Field label="Date of entry">
            <TextInput type="date" name="date" required defaultValue={today} />
          </Field>
          <Field label="Business bank balance (₹)">
            <TextInput name="bankBalance" inputMode="decimal" required placeholder="0.00" />
          </Field>
          <Field label="Personal savings (₹, optional)" hint="Planning only - never counted in runway">
            <TextInput name="personalSavings" inputMode="decimal" placeholder="0.00" />
          </Field>
          <Field label="Notes">
            <TextInput name="notes" placeholder="Large payment made / expected…" />
          </Field>
        </div>
        <div className="mt-4 flex items-center gap-3">
          <SubmitButton>Save position</SubmitButton>
          <FormError message={error} />
        </div>
      </form>
      </Card>
      <DataTable rows={positions} columns={columns} csvName="cash-positions" emptyMessage="No entries yet - add the first Monday balance above." />
    </section>
  );
}

/** Payables list + form (PRD3 §4.3). */
export function PayablesSection({ payables }: { payables: PayableRow[] }) {
  const [editing, setEditing] = useState<PayableRow | null>(null);
  const [adding, setAdding] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const showForm = adding || editing;

  const columns: Column<PayableRow>[] = [
    { key: "name", header: "Payable", cell: (r) => r.name, value: (r) => r.name },
    { key: "category", header: "Category", cell: (r) => EXPENSE_CATEGORY_LABELS[r.category], value: (r) => r.category },
    { key: "amount", header: "Amount", align: "right", cell: (r) => formatInrMinor(r.amountInr), value: (r) => r.amountInr / 100 },
    { key: "freq", header: "Frequency", cell: (r) => FREQ_LABELS[r.frequency], value: (r) => r.frequency },
    { key: "due", header: "Next due", cell: (r) => (r.nextDueDate ? formatDate(r.nextDueDate) : "-"), value: (r) => r.nextDueDate?.slice(0, 10) ?? "" },
    { key: "cogs", header: "COGS", cell: (r) => (r.isCogs ? "Yes" : "No"), value: (r) => (r.isCogs ? "Yes" : "No") },
    { key: "status", header: "Status", cell: (r) => PAYABLE_STATUS_LABELS[r.status], value: (r) => r.status },
    {
      key: "actions", header: "", sortable: false,
      cell: (r) => (
        <span className="flex gap-2 whitespace-nowrap">
          <Btn variant="ghost" size="sm" onClick={() => { setEditing(r); setAdding(false); }}>Edit</Btn>
          <Btn
            variant="danger"
            size="sm"
            onClick={async () => {
              const ok = await askConfirm({ title: `Delete payable ${r.name}?`, confirmLabel: "Delete", danger: true });
              if (ok) {
                await deletePayable(r.id);
                toast("Payable deleted");
              }
            }}
          >
            Delete
          </Btn>
        </span>
      ),
      value: () => null,
    },
  ];

  return (
    <section className="space-y-4">
      <div className="flex justify-end">
        <Btn variant="soft" onClick={() => { setAdding((v) => !v); setEditing(null); }}>
          {showForm ? "Close" : "Add payable"}
        </Btn>
      </div>
      {showForm && (
        <Card title={editing ? `Edit - ${editing.name}` : "New payable"}>
        <form
          action={async (form) => {
            setError(null);
            const res = await savePayable(editing?.id ?? null, form);
            if (!res.ok) return setError(res.error);
            toast(editing ? "Payable updated" : "Payable added");
            setEditing(null);
            setAdding(false);
          }}
          key={editing?.id ?? "new"}
        >
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <Field label="Payable name" hint="e.g. WATI subscription, Karthick salary">
              <TextInput name="name" required defaultValue={editing?.name ?? ""} />
            </Field>
            <Field label="Category">
              <Select name="category" options={optionsFrom(EXPENSE_CATEGORY_LABELS)} defaultValue={editing?.category ?? "TOOLS_SOFTWARE"} />
            </Field>
            <Field label="Amount (₹)">
              <TextInput name="amountInr" inputMode="decimal" required defaultValue={editing ? minorToInput(editing.amountInrRaw) : ""} />
            </Field>
            <Field label="Frequency">
              <Select name="frequency" options={optionsFrom(FREQ_LABELS)} defaultValue={editing?.frequency ?? "MONTHLY"} />
            </Field>
            <Field label="Next due date">
              <TextInput type="date" name="nextDueDate" defaultValue={editing?.nextDueDate?.slice(0, 10) ?? ""} />
            </Field>
            <Field label="Status">
              <Select name="status" options={optionsFrom(PAYABLE_STATUS_LABELS)} defaultValue={editing?.status ?? "ACTIVE"} />
            </Field>
            <div className="flex items-end pb-1">
              <CheckboxField name="isCogs" label="Is this COGS?" defaultChecked={editing?.isCogs ?? false} />
            </div>
          </div>
          <div className="mt-4 flex items-center gap-3">
            <SubmitButton>{editing ? "Save payable" : "Add payable"}</SubmitButton>
            <FormError message={error} />
          </div>
        </form>
        </Card>
      )}
      <DataTable
        rows={payables}
        columns={columns}
        csvName="payables"
        rowClassName={(r) => (r.dueSoonUnderfunded ? "bg-risk-soft" : undefined)}
        emptyMessage="No payables yet - add fixed costs to compute break-even."
      />
    </section>
  );
}

/** Growth override for months-to-₹8L (PRD3 §4.4). */
export function GrowthOverrideForm({ overridePct }: { overridePct: number | null }) {
  const [error, setError] = useState<string | null>(null);
  return (
    <form
      action={async (form) => {
        setError(null);
        const res = await setGrowthOverride(form);
        if (!res.ok) setError(res.error);
      }}
      className="flex flex-wrap items-center gap-2"
    >
      <label className="text-xs text-muted" htmlFor="growthPct">Growth % override</label>
      <input
        id="growthPct"
        name="growthPct"
        inputMode="decimal"
        defaultValue={overridePct ?? ""}
        placeholder="auto"
        className="w-20 rounded-field border border-line bg-surface-2 px-2 py-1 text-sm"
      />
      <button type="submit" className="text-xs text-accent hover:underline">Set</button>
      <FormError message={error} />
    </form>
  );
}
