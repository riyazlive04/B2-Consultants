"use client";

import { useRef, useState } from "react";
import { createIncome, deleteIncome, updateIncome } from "@/server/finance-actions";
import type { IncomeRow } from "@/server/finance-metrics";
import { DataTable, type Column } from "@/components/ui/DataTable";
import { Card } from "@/components/ui/kit";
import { Btn } from "@/components/ui/controls";
import { askConfirm, celebrate, toast } from "@/components/ui/feedback";
import { Field, FormError, Select, SubmitButton, TextArea, TextInput } from "@/components/ui/form";
import { formatDate, formatEurMinor, formatInrMinor } from "@/lib/format";
import {
  optionsFrom, PAYMENT_METHOD_LABELS, PAYMENT_TYPE_LABELS, PROGRAM_LEVEL_LABELS,
} from "@/lib/labels";
import { AmountPair } from "@/components/ui/AmountPair";

const minorToInput = (raw: string) => {
  const v = BigInt(raw);
  return v === BigInt(0) ? "" : (Number(v) / 100).toFixed(2);
};

export function IncomeSection({
  rows,
  today,
  studentOptions = [],
  fxRate,
  fxStale,
}: {
  rows: IncomeRow[];
  today: string;
  studentOptions?: { value: string; label: string }[];
  fxRate: number;
  fxStale?: boolean;
}) {
  const [editing, setEditing] = useState<IncomeRow | null>(null);
  const [error, setError] = useState<string | null>(null);
  const formRef = useRef<HTMLFormElement>(null);

  const submit = async (form: FormData) => {
    setError(null);
    const res = editing ? await updateIncome(editing.id, form) : await createIncome(form);
    if (!res.ok) return setError(res.error);
    toast(editing ? "Income entry updated" : "Payment recorded");
    if (!editing) celebrate(); // money in the door — worth confetti (edits stay quiet)
    setEditing(null);
    formRef.current?.reset();
  };

  const remove = async (row: IncomeRow) => {
    const ok = await askConfirm({
      title: `Delete income entry for ${row.studentName}?`,
      body: "This cannot be undone.",
      confirmLabel: "Delete",
      danger: true,
    });
    if (!ok) return;
    await deleteIncome(row.id);
    toast("Income entry deleted");
  };

  const columns: Column<IncomeRow>[] = [
    { key: "date", header: "Date", cell: (r) => formatDate(r.date), value: (r) => r.date.slice(0, 10) },
    { key: "student", header: "Student", cell: (r) => r.studentName, value: (r) => r.studentName },
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
    { key: "level", header: "Level", cell: (r) => PROGRAM_LEVEL_LABELS[r.programLevel], value: (r) => PROGRAM_LEVEL_LABELS[r.programLevel] },
    { key: "type", header: "Type", cell: (r) => PAYMENT_TYPE_LABELS[r.paymentType], value: (r) => PAYMENT_TYPE_LABELS[r.paymentType] },
    { key: "method", header: "Method", cell: (r) => PAYMENT_METHOD_LABELS[r.paymentMethod], value: (r) => PAYMENT_METHOD_LABELS[r.paymentMethod] },
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
        title={editing ? `Edit income - ${editing.studentName}` : "Daily income entry"}
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
          <Field label="Student name">
            <TextInput name="studentName" required placeholder="Who paid" defaultValue={editing?.studentName ?? ""} />
          </Field>
          <AmountPair
            fxRate={fxRate}
            fxStale={fxStale}
            inrName="amountInr"
            eurName="amountEur"
            inrLabel="Amount received (₹)"
            eurLabel="Amount received (€)"
            baseHint="INR, EUR, or both"
            defaultInr={editing ? minorToInput(editing.amountInrRaw) : ""}
            defaultEur={editing ? minorToInput(editing.amountEurRaw) : ""}
          />
          <Field label="Program level">
            <Select name="programLevel" options={optionsFrom(PROGRAM_LEVEL_LABELS)} defaultValue={editing?.programLevel ?? "GUIDED"} />
          </Field>
          <Field label="Payment type">
            <Select name="paymentType" options={optionsFrom(PAYMENT_TYPE_LABELS)} defaultValue={editing?.paymentType ?? "FULL_PAYMENT"} />
          </Field>
          <Field label="Payment method">
            <Select name="paymentMethod" options={optionsFrom(PAYMENT_METHOD_LABELS)} defaultValue={editing?.paymentMethod ?? "UPI"} />
          </Field>
          <Field label="Notes (optional)">
            <TextInput name="notes" placeholder="Any extra info" defaultValue={editing?.notes ?? ""} />
          </Field>
          {studentOptions.length > 0 && (
            <Field label="Link to student (optional)" hint="Feeds the student’s LTV">
              <Select
                name="studentId"
                options={[{ value: "", label: "-" }, ...studentOptions]}
                defaultValue={editing?.studentId ?? ""}
              />
            </Field>
          )}
        </div>
        <div className="mt-4 flex items-center gap-3">
          <SubmitButton>{editing ? "Save changes" : "Add income"}</SubmitButton>
          <FormError message={error} />
        </div>
        </form>
      </Card>

      <DataTable rows={rows} columns={columns} csvName="income" filterPlaceholder="Filter income…" />
    </section>
  );
}
