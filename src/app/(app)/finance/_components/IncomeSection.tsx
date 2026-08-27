"use client";

import { useRef, useState } from "react";
import { createIncome, deleteIncome, updateIncome } from "@/server/finance-actions";
import type { IncomeRow } from "@/server/finance-metrics";
import { DataTable, type Column } from "@/components/ui/DataTable";
import { Card } from "@/components/ui/kit";
import { Btn } from "@/components/ui/controls";
import { askConfirm, celebrate, toast } from "@/components/ui/feedback";
import { Field, FormError, Select, SubmitButton, TextArea, TextInput } from "@/components/ui/form";
import { ComboBox } from "@/components/ui/ComboBox";
import { InstalmentSchedule } from "./InstalmentSchedule";
import { formatDate, formatEurMinor, formatInrMinor } from "@/lib/format";
import {
  optionsFrom, PAYMENT_METHOD_LABELS, PAYMENT_TYPE_LABELS, PROGRAM_LEVEL_LABELS,
} from "@/lib/labels";
import { AmountPair } from "@/components/ui/AmountPair";
import { StudentName } from "@/components/ui/StudentName";
import { money, moneyAlt, moneyInline, moneyValue } from "@/lib/money-display";
import { useFinanceCcy } from "./FinanceCurrency";

const minorToInput = (raw: string) => {
  const v = BigInt(raw);
  return v === BigInt(0) ? "" : (Number(v) / 100).toFixed(2);
};

export function IncomeSection({
  rows,
  today,
  studentOptions = [],
  studentCodeById = {},
  levelOptions,
  fxRate,
  fxStale,
  fxDate,
}: {
  rows: IncomeRow[];
  today: string;
  studentOptions?: { value: string; label: string; hint?: string }[];
  studentCodeById?: Record<string, string>;
  levelOptions: { value: string; label: string }[];
  fxRate: number;
  fxStale?: boolean;
  fxDate?: string;
}) {
  const { ccy } = useFinanceCcy();
  const [editing, setEditing] = useState<IncomeRow | null>(null);
  const [error, setError] = useState<string | null>(null);
  const formRef = useRef<HTMLFormElement>(null);
  // Which payment type the form currently shows - the instalment questions render only for
  // INSTALMENT. null = "follow the row being edited (or the default)", so entering/leaving
  // edit mode resets the answer along with the rest of the re-keyed form.
  const [paymentTypeChoice, setPaymentTypeChoice] = useState<string | null>(null);
  const paymentType = paymentTypeChoice ?? editing?.paymentType ?? "FULL_PAYMENT";
  const switchEditing = (row: IncomeRow | null) => {
    setEditing(row);
    setPaymentTypeChoice(null);
  };
  // Optimistic delete: hide the row at once, restore it if the archive fails.
  const [removedIds, setRemovedIds] = useState<Set<string>>(new Set());
  const visibleRows = rows.filter((r) => !removedIds.has(r.id));

  const submit = async (form: FormData) => {
    setError(null);
    const res = editing ? await updateIncome(editing.id, form) : await createIncome(form);
    if (!res.ok) return setError(res.error);
    toast(editing ? "Income entry updated" : "Payment recorded");
    if (!editing) celebrate(); // money in the door - worth confetti (edits stay quiet)
    switchEditing(null);
    formRef.current?.reset();
  };

  const remove = async (row: IncomeRow) => {
    const ok = await askConfirm({
      title: `Archive income entry for ${row.studentName}?`,
      body: "It moves to the Archived tab - you can restore it there.",
      confirmLabel: "Archive",
      danger: true,
    });
    if (!ok) return;
    setRemovedIds((s) => new Set(s).add(row.id)); // optimistic
    const res = await deleteIncome(row.id);
    if (!res.ok) {
      setRemovedIds((s) => {
        const n = new Set(s);
        n.delete(row.id);
        return n;
      });
      return toast(res.error, "error");
    }
    toast("Income entry archived");
  };

  const columns: Column<IncomeRow>[] = [
    { key: "date", header: "Date", cell: (r) => formatDate(r.date), value: (r) => r.date.slice(0, 10) },
    {
      key: "student", header: "Student",
      cell: (r) => <StudentName name={r.studentName} code={r.studentId ? studentCodeById[r.studentId] : null} />,
      // the code joins the sort/filter/CSV value so "B2-0007" finds the row
      value: (r) =>
        r.studentId && studentCodeById[r.studentId]
          ? `${r.studentName} ${studentCodeById[r.studentId]}`
          : r.studentName,
    },
    // The two "as entered" columns stay currency-LABELLED, because that is what they are: the
    // money that actually arrived in that currency, and a dash where none did. Converting them
    // would erase the very distinction (a €500 PayPal payment vs a ₹54,372 UPI one).
    {
      key: "inr", header: "Received ₹", align: "right",
      cell: (r) => (BigInt(r.amountInrRaw) === BigInt(0) ? "-" : formatInrMinor(BigInt(r.amountInrRaw))),
      value: (r) => Number(BigInt(r.amountInrRaw)) / 100,
    },
    {
      key: "eur", header: "Received €", align: "right",
      cell: (r) => (BigInt(r.amountEurRaw) === BigInt(0) ? "-" : formatEurMinor(BigInt(r.amountEurRaw))),
      value: (r) => Number(BigInt(r.amountEurRaw)) / 100,
    },
    // The aggregate DOES follow the toggle - it is one amount quoted two ways, so which way
    // leads is exactly the reader's choice.
    {
      key: "agg", header: "Total", align: "right",
      cell: (r) => moneyInline(r.agg, ccy, { compact: true }),
      value: (r) => moneyValue(r.agg, ccy),
    },
    { key: "level", header: "Level", cell: (r) => PROGRAM_LEVEL_LABELS[r.programLevel] ?? r.programLevel, value: (r) => PROGRAM_LEVEL_LABELS[r.programLevel] ?? r.programLevel },
    {
      key: "type", header: "Type",
      cell: (r) => {
        if (r.paymentType !== "INSTALMENT" || !r.instalmentCount) return PAYMENT_TYPE_LABELS[r.paymentType];
        const extraInr = BigInt(r.instalmentExtraInrRaw);
        const extraEur = BigInt(r.instalmentExtraEurRaw);
        const extras = [
          ...(extraInr > BigInt(0) ? [formatInrMinor(extraInr)] : []),
          ...(extraEur > BigInt(0) ? [formatEurMinor(extraEur)] : []),
        ];
        return (
          <span>
            {PAYMENT_TYPE_LABELS[r.paymentType]} · {r.instalmentCount}×
            {extras.length > 0 && (
              // As-entered again: the surcharge is stored in the currency it was charged in.
              <span className="block text-caption text-muted">+{extras.join(" + ")} extra</span>
            )}
          </span>
        );
      },
      // the count joins the filter/CSV value so "3" or "instalment" finds the row
      value: (r) =>
        r.paymentType === "INSTALMENT" && r.instalmentCount
          ? `${PAYMENT_TYPE_LABELS[r.paymentType]} (${r.instalmentCount}x)`
          : PAYMENT_TYPE_LABELS[r.paymentType],
    },
    { key: "method", header: "Method", cell: (r) => PAYMENT_METHOD_LABELS[r.paymentMethod], value: (r) => PAYMENT_METHOD_LABELS[r.paymentMethod] },
    { key: "notes", header: "Notes", cell: (r) => r.notes ?? "", value: (r) => r.notes ?? "" },
    {
      key: "actions", header: "", sortable: false,
      cell: (r) => (
        <span className="flex gap-2 whitespace-nowrap">
          <Btn variant="ghost" size="sm" onClick={() => switchEditing(r)}>Edit</Btn>
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
            <Btn variant="ghost" size="sm" onClick={() => switchEditing(null)}>
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
          <Field
            label="Student name"
            hint={studentOptions.length > 0 ? "Search to link a student - feeds their total paid" : undefined}
          >
            {studentOptions.length > 0 ? (
              // Searchable auto-populate (issue 2.6): picking a student fills the name AND the
              // hidden studentId, so the payment links to the right record instead of a typed match.
              <ComboBox
                options={studentOptions}
                nameText="studentName"
                nameValue="studentId"
                required
                placeholder="Search or type who paid"
                defaultText={editing?.studentName ?? ""}
                defaultValue={editing?.studentId ?? ""}
              />
            ) : (
              <TextInput kind="name" name="studentName" required placeholder="Who paid" defaultValue={editing?.studentName ?? ""} />
            )}
          </Field>
          <AmountPair
            fxRate={fxRate}
            fxStale={fxStale}
            fxDate={fxDate}
            inrName="amountInr"
            eurName="amountEur"
            inrLabel="Amount received (₹)"
            eurLabel="Amount received (€)"
            baseHint="INR, EUR, or both"
            defaultInr={editing ? minorToInput(editing.amountInrRaw) : ""}
            defaultEur={editing ? minorToInput(editing.amountEurRaw) : ""}
          />
          <Field label="Programme level">
            <Select name="programLevel" options={levelOptions} defaultValue={editing?.programLevel ?? "GUIDED"} />
          </Field>
          <Field label="Payment type">
            <Select
              name="paymentType"
              options={optionsFrom(PAYMENT_TYPE_LABELS)}
              defaultValue={editing?.paymentType ?? "FULL_PAYMENT"}
              onChange={(e) => setPaymentTypeChoice(e.currentTarget.value)}
            />
          </Field>
          {/* Instalment plans carry two more answers: how many instalments the fee is split
              into, and the surcharge added for choosing the plan. Asked only when it applies -
              a full payment keeps the short form. */}
          {paymentType === "INSTALMENT" && (
            <>
              <Field label="Number of instalments" hint="How many instalments the fee is split into">
                <TextInput
                  kind="int"
                  name="instalmentCount"
                  required
                  placeholder="e.g. 3"
                  defaultValue={editing?.instalmentCount ? String(editing.instalmentCount) : ""}
                />
              </Field>
              <AmountPair
                fxRate={fxRate}
                fxStale={fxStale}
                fxDate={fxDate}
                inrName="instalmentExtraInr"
                eurName="instalmentExtraEur"
                inrLabel="Extra amount (₹)"
                eurLabel="Extra amount (€)"
                baseHint="Added to the fee for paying in instalments"
                defaultInr={editing ? minorToInput(editing.instalmentExtraInrRaw) : ""}
                defaultEur={editing ? minorToInput(editing.instalmentExtraEurRaw) : ""}
              />
              {/* Only on a NEW entry. Editing an income row must not silently rewrite a schedule
                  the student has already agreed to and may have started paying against - that
                  edit belongs in the receivable itself, under Pending. */}
              {!editing && <InstalmentSchedule />}
            </>
          )}
          <Field label="Payment method">
            <Select name="paymentMethod" options={optionsFrom(PAYMENT_METHOD_LABELS)} defaultValue={editing?.paymentMethod ?? "UPI"} />
          </Field>
          <Field label="Notes (optional)">
            <TextInput kind="text" name="notes" placeholder="Any extra info" defaultValue={editing?.notes ?? ""} />
          </Field>
        </div>
        <div className="mt-4 flex items-center gap-3">
          <SubmitButton>{editing ? "Save changes" : "Add income"}</SubmitButton>
          <FormError message={error} />
        </div>
        </form>
      </Card>

      <DataTable rows={visibleRows} columns={columns} csvName="income" filterPlaceholder="Filter income…" />
    </section>
  );
}
