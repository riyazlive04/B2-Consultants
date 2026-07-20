"use client";

import { useRef, useState } from "react";
import { Gift } from "lucide-react";
import {
  createPayout,
  deletePayout,
  setPayoutStatus,
  updatePayout,
} from "@/server/telecaller-actions";
import type { PayoutRow, TelecallerBoard } from "@/server/telecaller-metrics";
import { DataTable, type Column } from "@/components/ui/DataTable";
import { askConfirm, celebrate, toast } from "@/components/ui/feedback";
import { Card, CardTitle, Pill } from "@/components/ui/kit";
import { Btn } from "@/components/ui/controls";
import { Field, FormError, Select, SubmitButton, TextInput } from "@/components/ui/form";
import { formatEurMinor, formatInrMinor } from "@/lib/format";
import { LOG_VARIANT_LABELS, PAYOUT_STATUS_LABELS, optionsFrom } from "@/lib/labels";

const ZERO = BigInt(0);

/** "₹1,00,000.99 · 100.000,99 €" — INR shown Indian, EUR shown German (CONTEXT §6). */
const pair = (inrRaw: string, eurRaw: string) => {
  const inr = BigInt(inrRaw);
  const eur = BigInt(eurRaw);
  if (inr === ZERO && eur === ZERO) return "-";
  const parts: string[] = [];
  if (inr !== ZERO) parts.push(formatInrMinor(inr));
  if (eur !== ZERO) parts.push(formatEurMinor(eur));
  return parts.join(" · ");
};

const minorToInput = (raw: string) => {
  const v = BigInt(raw);
  return v === ZERO ? "" : (Number(v) / 100).toFixed(2);
};

export function TelecallerClient({ board }: { board: TelecallerBoard }) {
  const [editing, setEditing] = useState<PayoutRow | null>(null);
  const [prefill, setPrefill] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const formRef = useRef<HTMLFormElement>(null);

  const hasTelecallers = board.teamOptions.length > 0;
  const selectedProfile = editing?.teamProfileId ?? prefill ?? board.teamOptions[0]?.value ?? "";

  const submit = async (form: FormData) => {
    setError(null);
    const res = editing ? await updatePayout(editing.id, form) : await createPayout(form);
    if (!res.ok) return setError(res.error);
    toast(editing ? "Payout updated" : "Payout assigned");
    if (!editing) celebrate(); // money going out the door to a telecaller — small win
    setEditing(null);
    setPrefill(null);
    formRef.current?.reset();
  };

  const startEdit = (row: PayoutRow) => {
    setPrefill(null);
    setEditing(row);
    formRef.current?.scrollIntoView({ behavior: "smooth", block: "center" });
  };

  const assignTo = (teamProfileId: string) => {
    setEditing(null);
    setPrefill(teamProfileId);
    formRef.current?.scrollIntoView({ behavior: "smooth", block: "center" });
  };

  const remove = async (row: PayoutRow) => {
    const ok = await askConfirm({
      title: `Delete this payout for ${row.name}?`,
      body: "This cannot be undone.",
      confirmLabel: "Delete",
      danger: true,
    });
    if (!ok) return;
    await deletePayout(row.id);
    toast("Payout deleted");
  };

  const toggleStatus = async (row: PayoutRow) => {
    const next = row.status === "PAID" ? "PENDING" : "PAID";
    await setPayoutStatus(row.id, next);
    toast(next === "PAID" ? "Marked paid" : "Marked pending");
  };

  const columns: Column<PayoutRow>[] = [
    { key: "name", header: "Telecaller", cell: (r) => r.name, value: (r) => r.name },
    {
      key: "bonus", header: "Bonus", align: "right",
      cell: (r) => <span className="tnum">{pair(r.bonusInrRaw, r.bonusEurRaw)}</span>,
      value: (r) => Number(BigInt(r.bonusInrRaw)) / 100,
    },
    {
      key: "commission", header: "Commission", align: "right",
      cell: (r) => <span className="tnum">{pair(r.commInrRaw, r.commEurRaw)}</span>,
      value: (r) => Number(BigInt(r.commInrRaw)) / 100,
    },
    {
      key: "total", header: "Total (₹ agg)", align: "right",
      cell: (r) => <span className="tnum font-semibold">{formatInrMinor(r.aggInrMinor, { compact: true })}</span>,
      value: (r) => r.aggInrMinor / 100,
    },
    { key: "reason", header: "Reason", cell: (r) => r.reason, value: (r) => r.reason },
    {
      key: "status", header: "Status", sortable: false,
      cell: (r) => (
        <button
          type="button"
          onClick={() => toggleStatus(r)}
          title={r.status === "PAID" ? "Mark as not paid yet" : "Mark as paid"}
          className="rounded-full transition-transform hover:brightness-95"
        >
          <Pill tone={r.status === "PAID" ? "good" : "warn"}>{PAYOUT_STATUS_LABELS[r.status]}</Pill>
        </button>
      ),
      value: (r) => r.status,
    },
    { key: "by", header: "Entered by", cell: (r) => r.enteredBy ?? "-", value: (r) => r.enteredBy ?? "" },
    {
      key: "actions", header: "", sortable: false,
      cell: (r) => (
        <span className="flex gap-2 whitespace-nowrap">
          <Btn variant="ghost" size="sm" onClick={() => startEdit(r)}>Edit</Btn>
          <Btn variant="danger" size="sm" onClick={() => remove(r)}>Delete</Btn>
        </span>
      ),
      value: () => null,
    },
  ];

  return (
    <section className="space-y-6">
      {/* Telecaller call-context cards — the basis for the reward */}
      {hasTelecallers ? (
        <div>
          <h2 className="mb-3 font-display text-h2 font-semibold">
            Telecallers <span className="text-sm font-normal text-muted">· calls this month</span>
          </h2>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {board.telecallers.map((t) => (
              <div key={t.teamProfileId} className="rounded-card border border-line bg-surface p-4 shadow-card">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="truncate font-display text-base font-semibold">{t.name}</p>
                    <p className="truncate text-xs text-muted">{LOG_VARIANT_LABELS[t.logVariant] ?? t.roleTitle}</p>
                  </div>
                  <Btn variant="soft" size="sm" onClick={() => assignTo(t.teamProfileId)}>
                    Assign
                  </Btn>
                </div>
                <div className="mt-3 flex flex-wrap gap-1.5">
                  {t.calls.map((c) => (
                    <span key={c.key} className="rounded-full bg-surface-2 px-2 py-0.5 text-caption text-muted">
                      {c.label}: <span className="tnum font-semibold text-ink">{c.value}</span>
                    </span>
                  ))}
                </div>
                <p className="mt-3 text-xs text-muted">
                  Assigned this month:{" "}
                  <span className="tnum font-semibold text-ink">
                    {t.assignedInrMinor === 0 ? "—" : formatInrMinor(t.assignedInrMinor, { compact: true })}
                  </span>
                  {t.payoutCount > 0 && ` · ${t.payoutCount} entr${t.payoutCount === 1 ? "y" : "ies"}`}
                </p>
              </div>
            ))}
          </div>
        </div>
      ) : (
        <p className="rounded-card border border-line bg-surface p-5 text-sm text-muted shadow-card">
          No active telecallers yet. Add team members with the <strong>Appointment Setter</strong> or{" "}
          <strong>Discovery Call Specialist</strong> role in <strong>Users</strong>, then come back to assign their pay.
        </p>
      )}

      {/* Assignment form */}
      {hasTelecallers && (
        <Card
          title={
            <CardTitle icon={<Gift size={18} />}>
              {editing ? `Edit payout — ${editing.name}` : "Assign bonus / commission"}
            </CardTitle>
          }
          actions={
            editing ? (
              <Btn variant="ghost" size="sm" onClick={() => setEditing(null)}>
                Cancel edit
              </Btn>
            ) : undefined
          }
        >
        <form ref={formRef} action={submit} key={editing?.id ?? `new-${prefill ?? ""}`}>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <Field label="Telecaller">
              <Select name="teamProfileId" options={board.teamOptions} defaultValue={selectedProfile} />
            </Field>
            <Field label="Month">
              <TextInput type="month" name="month" required defaultValue={board.month} />
            </Field>
            <Field label="Bonus (₹)" hint="INR, EUR, or both">
              <TextInput kind="money" name="bonusInr" placeholder="0.00" defaultValue={editing ? minorToInput(editing.bonusInrRaw) : ""} />
            </Field>
            <Field label="Bonus (€)">
              <TextInput kind="money" name="bonusEur" placeholder="0.00" defaultValue={editing ? minorToInput(editing.bonusEurRaw) : ""} />
            </Field>
            <Field label="Commission (₹)" hint="INR, EUR, or both">
              <TextInput kind="money" name="commInr" placeholder="0.00" defaultValue={editing ? minorToInput(editing.commInrRaw) : ""} />
            </Field>
            <Field label="Commission (€)">
              <TextInput kind="money" name="commEur" placeholder="0.00" defaultValue={editing ? minorToInput(editing.commEurRaw) : ""} />
            </Field>
            {/* Free text — the reason is prose with numbers in it ("hit 40 appointments"). */}
            <Field label="Reason / criteria" hint="e.g. hit 40 appointments · good call QA">
              <TextInput kind="text" name="reason" required placeholder="Why this reward" defaultValue={editing?.reason ?? ""} />
            </Field>
            <Field label="Status">
              <Select name="status" options={optionsFrom(PAYOUT_STATUS_LABELS)} defaultValue={editing?.status ?? "PENDING"} />
            </Field>
          </div>
          <div className="mt-4 flex items-center gap-3">
            <SubmitButton>{editing ? "Save changes" : "Assign payout"}</SubmitButton>
            <FormError message={error} />
          </div>
        </form>
        </Card>
      )}

      {/* Payouts ledger for the month */}
      <div>
        <h3 className="mb-3 font-display text-h2 font-semibold">
          Payouts <span className="text-sm font-normal text-muted">· {board.monthLabel}</span>
        </h3>
        <DataTable
          rows={board.payouts}
          columns={columns}
          csvName={`telecaller-payouts-${board.month}`}
          filterPlaceholder="Filter payouts…"
          emptyMessage="No bonuses or commission assigned this month yet."
        />
      </div>
    </section>
  );
}
