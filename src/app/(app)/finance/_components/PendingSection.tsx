"use client";

import { useRef, useState } from "react";
import {
  createPendingPayment, deletePendingPayment, updatePendingPayment,
} from "@/server/finance-actions";
import type { PendingRow } from "@/server/finance-metrics";
import { DataTable, type Column } from "@/components/ui/DataTable";
import { askConfirm, toast } from "@/components/ui/feedback";
import { Field, FormError, Select, SubmitButton, TextInput } from "@/components/ui/form";
import { SignalBadge } from "@/components/ui/SignalBadge";
import { formatDate, formatEurMinor, formatInrMinor } from "@/lib/format";
import { optionsFrom, PENDING_STATUS_LABELS, PROGRAM_LEVEL_LABELS } from "@/lib/labels";

const minorToInput = (raw: string) => {
  const v = BigInt(raw);
  return v === BigInt(0) ? "" : (Number(v) / 100).toFixed(2);
};

const money2 = (m: { inr: number; eur: number }) =>
  `${formatInrMinor(m.inr, { compact: true })} · ${formatEurMinor(m.eur, { compact: true })}`;

export function PendingSection({ rows }: { rows: PendingRow[] }) {
  const [editing, setEditing] = useState<PendingRow | null>(null);
  const [error, setError] = useState<string | null>(null);
  const formRef = useRef<HTMLFormElement>(null);

  const submit = async (form: FormData) => {
    setError(null);
    const res = editing
      ? await updatePendingPayment(editing.id, form)
      : await createPendingPayment(form);
    if (!res.ok) return setError(res.error);
    toast(editing ? "Pending payment updated" : "Pending payment added");
    setEditing(null);
    formRef.current?.reset();
  };

  const remove = async (row: PendingRow) => {
    const ok = await askConfirm({
      title: `Delete pending payment for ${row.studentName}?`,
      confirmLabel: "Delete",
      danger: true,
    });
    if (!ok) return;
    await deletePendingPayment(row.id);
    toast("Pending payment deleted");
  };

  const columns: Column<PendingRow>[] = [
    { key: "student", header: "Student", cell: (r) => r.studentName, value: (r) => r.studentName },
    { key: "level", header: "Level", cell: (r) => PROGRAM_LEVEL_LABELS[r.programLevel], value: (r) => PROGRAM_LEVEL_LABELS[r.programLevel] },
    { key: "fee", header: "Total fee", align: "right", cell: (r) => money2(r.totalFee), value: (r) => r.totalFee.inr / 100 },
    {
      key: "paid", header: "Paid so far", align: "right",
      cell: (r) => money2(r.paidSoFar), value: (r) => r.paidSoFar.inr / 100,
    },
    {
      key: "balance", header: "Balance pending", align: "right",
      cell: (r) => <strong className="tnum">{money2(r.balance)}</strong>, value: (r) => r.balance.inr / 100,
    },
    {
      key: "due", header: "Next due", cell: (r) => (r.nextDueDate ? formatDate(r.nextDueDate) : "-"),
      value: (r) => r.nextDueDate?.slice(0, 10) ?? "",
    },
    {
      key: "status", header: "Status",
      cell: (r) =>
        r.overdue ? (
          <SignalBadge level="risk" size="sm" label="Overdue" />
        ) : (
          PENDING_STATUS_LABELS[r.status]
        ),
      value: (r) => (r.overdue ? "Overdue" : PENDING_STATUS_LABELS[r.status]),
    },
    {
      key: "actions", header: "", sortable: false,
      cell: (r) => (
        <span className="flex gap-2 whitespace-nowrap">
          <button type="button" className="py-1 text-accent hover:underline" onClick={() => setEditing(r)}>Edit</button>
          <button type="button" className="py-1 text-risk hover:underline" onClick={() => remove(r)}>Delete</button>
        </span>
      ),
      value: () => null,
    },
  ];

  return (
    <section className="space-y-4">
      <form
        ref={formRef}
        action={submit}
        key={editing?.id ?? "new"}
        className="rounded-card border border-line bg-surface p-5 shadow-card"
      >
        <div className="mb-1 flex items-center justify-between">
          <h3 className="font-display text-lg font-semibold">
            {editing ? `Edit pending payment - ${editing.studentName}` : "Pending payment (instalments)"}
          </h3>
          {editing && (
            <button type="button" className="text-sm text-muted hover:underline" onClick={() => setEditing(null)}>
              Cancel edit
            </button>
          )}
        </div>
        <p className="mb-4 text-xs text-muted">
          “Paid so far” is summed automatically from income entries with the same student name - enter the
          agreed total fee only.
        </p>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <Field label="Student name">
            <TextInput name="studentName" required defaultValue={editing?.studentName ?? ""} />
          </Field>
          <Field label="Program level">
            <Select name="programLevel" options={optionsFrom(PROGRAM_LEVEL_LABELS)} defaultValue={editing?.programLevel ?? "GUIDED"} />
          </Field>
          <Field label="Total fee agreed (₹)" hint="INR, EUR, or both">
            <TextInput name="totalFeeInr" inputMode="decimal" placeholder="0.00" defaultValue={editing ? minorToInput(editing.totalFeeInrRaw) : ""} />
          </Field>
          <Field label="Total fee agreed (€)">
            <TextInput name="totalFeeEur" inputMode="decimal" placeholder="0.00" defaultValue={editing ? minorToInput(editing.totalFeeEurRaw) : ""} />
          </Field>
          <Field label="Next payment due date">
            <TextInput type="date" name="nextDueDate" defaultValue={editing?.nextDueDate?.slice(0, 10) ?? ""} />
          </Field>
          <Field label="Status">
            <Select name="status" options={optionsFrom(PENDING_STATUS_LABELS)} defaultValue={editing?.status ?? "ACTIVE"} />
          </Field>
          <Field label="Notes (optional)">
            <TextInput name="notes" defaultValue={editing?.notes ?? ""} />
          </Field>
        </div>
        <div className="mt-4 flex items-center gap-3">
          <SubmitButton>{editing ? "Save changes" : "Add pending payment"}</SubmitButton>
          <FormError message={error} />
        </div>
      </form>

      <DataTable
        rows={rows}
        columns={columns}
        csvName="pending-payments"
        filterPlaceholder="Filter pending payments…"
        rowClassName={(r) => (r.overdue ? "bg-risk-soft" : undefined)}
      />
    </section>
  );
}
