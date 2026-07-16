"use client";

import { useRef, useState } from "react";
import {
  createPendingPayment, deletePendingPayment, updatePendingPayment,
} from "@/server/finance-actions";
import { clearInstalmentPlan, generateInstalmentPlan, setInstalmentStatus } from "@/server/emi-actions";
import type { PendingRow } from "@/server/finance-metrics";
import type { WhatsAppStatusCell } from "@/server/whatsapp";
import { sendPaymentReminderMsg } from "@/server/whatsapp-actions";
import { DataTable, type Column } from "@/components/ui/DataTable";
import { Card } from "@/components/ui/kit";
import { Btn } from "@/components/ui/controls";
import { Modal } from "@/components/ui/Modal";
import { SendWhatsAppButton } from "@/components/ui/SendWhatsAppButton";
import { WhatsAppStatusBadge } from "@/components/ui/WhatsAppStatusBadge";
import { askConfirm, toast } from "@/components/ui/feedback";
import { Field, FormError, Select, SubmitButton, TextInput } from "@/components/ui/form";
import { AmountPair } from "@/components/ui/AmountPair";
import { SignalBadge } from "@/components/ui/SignalBadge";
import { formatDate, formatEurMinor, formatInrMinor } from "@/lib/format";
import { optionsFrom, PENDING_STATUS_LABELS, PROGRAM_LEVEL_LABELS } from "@/lib/labels";

const minorToInput = (raw: string) => {
  const v = BigInt(raw);
  return v === BigInt(0) ? "" : (Number(v) / 100).toFixed(2);
};

const money2 = (m: { inr: number; eur: number }) =>
  `${formatInrMinor(m.inr, { compact: true })} · ${formatEurMinor(m.eur, { compact: true })}`;

const INSTALMENT_STATUS_OPTIONS = [
  { value: "DUE", label: "Due" },
  { value: "PAID", label: "Paid" },
  { value: "OVERDUE", label: "Overdue" },
];

/** Structured EMI schedule (spec Module G): generate an N-instalment plan, mark each paid, or clear it. */
function EmiScheduleModal({
  row,
  onClose,
  onError,
}: {
  row: PendingRow;
  onClose: () => void;
  onError: (m: string | null) => void;
}) {
  const has = row.instalments.length > 0;
  const paidCount = row.instalments.filter((i) => i.status === "PAID").length;
  return (
    <Modal
      open
      onClose={onClose}
      title={`EMI schedule — ${row.studentName}`}
      subtitle={has ? `${paidCount}/${row.instalments.length} paid` : "No schedule yet"}
    >
      {has ? (
        <div className="space-y-2">
          {row.instalments.map((it) => (
            <div
              key={it.id}
              className="flex flex-wrap items-center gap-x-3 gap-y-1.5 rounded-field border border-line bg-surface-2 px-3 py-2 text-sm"
            >
              <span className="font-medium">#{it.seq}</span>
              <span className="tnum">{formatInrMinor(it.inr, { compact: true })}</span>
              <span className="text-xs text-muted">
                due {formatDate(it.dueDate)}
                {it.paidDate ? ` · paid ${formatDate(it.paidDate)}` : ""}
              </span>
              <div className="ml-auto">
                <Select
                  value={it.status}
                  aria-label={`Instalment ${it.seq} status`}
                  onChange={async (ev) => {
                    onError(null);
                    const res = await setInstalmentStatus(it.id, ev.target.value);
                    if (!res.ok) onError(res.error);
                    else toast("Instalment updated");
                  }}
                  options={INSTALMENT_STATUS_OPTIONS}
                />
              </div>
            </div>
          ))}
          <div className="pt-2">
            <Btn
              variant="danger"
              size="sm"
              onClick={async () => {
                const ok = await askConfirm({
                  title: "Clear this EMI schedule?",
                  body: "All instalment rows are deleted. The receivable itself stays.",
                  confirmLabel: "Clear schedule",
                  danger: true,
                });
                if (!ok) return;
                onError(null);
                const res = await clearInstalmentPlan(row.id);
                if (!res.ok) return onError(res.error);
                toast("Schedule cleared");
                onClose();
              }}
            >
              Clear schedule
            </Btn>
          </div>
        </div>
      ) : (
        <form
          action={async (form) => {
            onError(null);
            const res = await generateInstalmentPlan(row.id, form);
            if (!res.ok) return onError(res.error);
            toast("EMI schedule generated");
            onClose();
          }}
          className="space-y-4"
        >
          <p className="text-sm text-muted">
            Split {money2(row.totalFee)} into equal instalments — 2 per level, 6 for a 3-level bundle. The last
            instalment absorbs any rounding.
          </p>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            <Field label="Number of instalments"><TextInput name="count" inputMode="numeric" required defaultValue="2" /></Field>
            <Field label="First due date">
              <TextInput type="date" name="firstDueDate" required defaultValue={row.nextDueDate?.slice(0, 10) ?? ""} />
            </Field>
            <Field label="Days between"><TextInput name="intervalDays" inputMode="numeric" defaultValue="30" /></Field>
          </div>
          <SubmitButton>Generate schedule</SubmitButton>
        </form>
      )}
    </Modal>
  );
}

export function PendingSection({
  rows,
  waStatus = {},
  fxRate,
  fxStale,
}: {
  rows: PendingRow[];
  waStatus?: Record<string, WhatsAppStatusCell>;
  fxRate: number;
  fxStale?: boolean;
}) {
  const [editing, setEditing] = useState<PendingRow | null>(null);
  const [emiRowId, setEmiRowId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const formRef = useRef<HTMLFormElement>(null);
  // Derive by id (not a captured row) so the modal reflects fresh instalments after a revalidate.
  const emiRow = emiRowId ? rows.find((r) => r.id === emiRowId) ?? null : null;

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
      key: "whatsapp", header: "WhatsApp", sortable: false,
      cell: (r) => {
        const w = waStatus[r.id];
        return (
          <span className="flex items-center gap-2 whitespace-nowrap">
            {w && <WhatsAppStatusBadge status={w.status} kind={w.kind} at={w.at} />}
            {r.balance.inr > 0 && (
              <SendWhatsAppButton action={() => sendPaymentReminderMsg(r.id)} label="Remind" />
            )}
          </span>
        );
      },
      value: (r) => waStatus[r.id]?.status ?? "",
    },
    {
      key: "actions", header: "", sortable: false,
      cell: (r) => (
        <span className="flex gap-2 whitespace-nowrap">
          <Btn variant="ghost" size="sm" onClick={() => setEmiRowId(r.id)}>
            EMI{r.instalments.length ? ` ${r.instalments.filter((i) => i.status === "PAID").length}/${r.instalments.length}` : ""}
          </Btn>
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
        title={editing ? `Edit pending payment - ${editing.studentName}` : "Pending payment (instalments)"}
        subtitle="“Paid so far” is summed automatically from income entries with the same student name - enter the agreed total fee only."
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
          <Field label="Student name">
            <TextInput name="studentName" required defaultValue={editing?.studentName ?? ""} />
          </Field>
          <Field label="Program level">
            <Select name="programLevel" options={optionsFrom(PROGRAM_LEVEL_LABELS)} defaultValue={editing?.programLevel ?? "GUIDED"} />
          </Field>
          <AmountPair
            fxRate={fxRate}
            fxStale={fxStale}
            inrName="totalFeeInr"
            eurName="totalFeeEur"
            inrLabel="Total fee agreed (₹)"
            eurLabel="Total fee agreed (€)"
            baseHint="INR, EUR, or both"
            defaultInr={editing ? minorToInput(editing.totalFeeInrRaw) : ""}
            defaultEur={editing ? minorToInput(editing.totalFeeEurRaw) : ""}
          />
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
      </Card>

      <DataTable
        rows={rows}
        columns={columns}
        csvName="pending-payments"
        filterPlaceholder="Filter pending payments…"
        rowClassName={(r) => (r.overdue ? "bg-risk-soft" : undefined)}
      />

      {emiRow && <EmiScheduleModal row={emiRow} onClose={() => setEmiRowId(null)} onError={setError} />}
    </section>
  );
}
