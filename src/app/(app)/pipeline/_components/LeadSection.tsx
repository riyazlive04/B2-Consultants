"use client";

import { useRef, useState } from "react";
import { assignLead, createLead, deleteLead, markLeadContacted, updateLead } from "@/server/pipeline-actions";
import type { LeadRow } from "@/server/pipeline-metrics";
import { DataTable, type Column } from "@/components/ui/DataTable";
import { SendWhatsAppButton } from "@/components/ui/SendWhatsAppButton";
import { WhatsAppStatusBadge } from "@/components/ui/WhatsAppStatusBadge";
import { sendLeadReminder } from "@/server/whatsapp-actions";
import type { WhatsAppStatusCell } from "@/server/whatsapp";
import { askConfirm, toast } from "@/components/ui/feedback";
import { Field, FormError, Select, SubmitButton, TextArea, TextInput } from "@/components/ui/form";
import { formatDate, formatDuration } from "@/lib/format";
import { signalForSpeedToLead } from "@/lib/signals";
import {
  LEAD_SOURCE_LABELS, LEAD_STAGE_LABELS, optionsFrom, PAYMENT_PLAN_LABELS, PROGRAM_LEVEL_LABELS,
} from "@/lib/labels";

// Split/full pay applies once a deposit is in (client notes: "Split Pay / Full Pay").
const PAYMENT_PLAN_STAGES = new Set(["DEPOSIT_PAID", "WON"]);

// Speed-to-lead colour rule (client notes): green ≤5 min · amber 6-60 min · no colour above.
const SPEED_PILL: Record<string, string> = {
  ok: "bg-ok-soft text-ok",
  watch: "bg-watch-soft text-watch",
  none: "bg-surface-2 text-muted",
};

export function LeadSection({
  rows,
  today,
  isAdmin,
  assignees,
  waStatus = {},
}: {
  rows: LeadRow[];
  today: string;
  isAdmin: boolean;
  assignees: { value: string; label: string }[];
  waStatus?: Record<string, WhatsAppStatusCell>;
}) {
  const [editing, setEditing] = useState<LeadRow | null>(null);
  const [stage, setStage] = useState<string>("NEW_LEAD");
  const [error, setError] = useState<string | null>(null);
  const formRef = useRef<HTMLFormElement>(null);

  const startEdit = (row: LeadRow) => {
    setEditing(row);
    setStage(row.stage);
  };

  const submit = async (form: FormData) => {
    setError(null);
    const res = editing ? await updateLead(editing.id, form) : await createLead(form);
    if (!res.ok) return setError(res.error);
    toast(editing ? "Lead updated" : "Lead added to pipeline");
    setEditing(null);
    setStage("NEW_LEAD");
    formRef.current?.reset();
  };

  const remove = async (row: LeadRow) => {
    const ok = await askConfirm({
      title: `Delete lead ${row.name}?`,
      body: "Their call outcomes and stage history are removed too.",
      confirmLabel: "Delete lead",
      danger: true,
    });
    if (!ok) return;
    await deleteLead(row.id);
    toast("Lead deleted");
  };

  const contact = async (row: LeadRow) => {
    const res = await markLeadContacted(row.id);
    if (!res.ok) return toast(res.error, "error");
    toast("Marked contacted");
  };

  const reassign = async (row: LeadRow, userId: string) => {
    if (userId === (row.assignedToId ?? "")) return;
    const res = await assignLead(row.id, userId);
    if (!res.ok) return toast(res.error, "error");
    toast(userId ? "Lead assigned" : "Lead unassigned");
  };

  const columns: Column<LeadRow>[] = [
    { key: "name", header: "Lead", cell: (r) => r.name, value: (r) => r.name },
    { key: "phone", header: "Phone / WhatsApp", cell: (r) => r.phone, value: (r) => r.phone },
    { key: "source", header: "Source", cell: (r) => LEAD_SOURCE_LABELS[r.leadSource], value: (r) => LEAD_SOURCE_LABELS[r.leadSource] },
    { key: "dateIn", header: "Date in", cell: (r) => formatDate(r.dateIn), value: (r) => r.dateIn.slice(0, 10) },
    {
      key: "stage", header: "Stage",
      cell: (r) => (
        <span className={r.stage === "WON" ? "font-semibold text-ok" : r.stage === "LOST" ? "text-muted" : ""}>
          {LEAD_STAGE_LABELS[r.stage]}
          {r.wonLevel ? ` · ${PROGRAM_LEVEL_LABELS[r.wonLevel]}` : ""}
          {r.paymentPlan ? ` · ${PAYMENT_PLAN_LABELS[r.paymentPlan]}` : ""}
        </span>
      ),
      value: (r) => LEAD_STAGE_LABELS[r.stage],
    },
    {
      key: "assignedTo", header: "Assigned to",
      cell: (r) =>
        isAdmin ? (
          <select
            defaultValue={r.assignedToId ?? ""}
            onChange={(e) => reassign(r, e.target.value)}
            className="rounded-field border border-line bg-surface px-2 py-1 text-xs outline-none focus:border-accent"
          >
            <option value="">Unassigned</option>
            {assignees.map((a) => (
              <option key={a.value} value={a.value}>{a.label}</option>
            ))}
          </select>
        ) : (
          r.assignedTo ?? "-"
        ),
      value: (r) => r.assignedTo ?? "",
    },
    {
      key: "speed", header: "Speed to lead",
      cell: (r) =>
        r.speedMs !== null ? (
          <span
            title="Green: contacted within 5 minutes · Amber: within an hour"
            className={`tnum rounded-full px-2 py-0.5 text-xs font-medium ${SPEED_PILL[signalForSpeedToLead(r.speedMs) ?? "none"]}`}
          >
            {formatDuration(r.speedMs)}
          </span>
        ) : (
          <button type="button" onClick={() => contact(r)} className="text-xs text-accent hover:underline">
            Mark contacted
          </button>
        ),
      value: (r) => r.speedMs ?? Number.MAX_SAFE_INTEGER,
    },
    { key: "enteredBy", header: "Entered by", cell: (r) => r.enteredBy, value: (r) => r.enteredBy },
    { key: "notes", header: "Notes", cell: (r) => r.notes ?? "", value: (r) => r.notes ?? "" },
    {
      key: "actions", header: "", sortable: false,
      cell: (r) => (
        <span className="flex items-center gap-2 whitespace-nowrap">
          {waStatus[r.id] && <WhatsAppStatusBadge status={waStatus[r.id]!.status} kind={waStatus[r.id]!.kind} at={waStatus[r.id]!.at} />}
          <SendWhatsAppButton action={() => sendLeadReminder(r.id)} label="WhatsApp" />
          <button type="button" className="py-1 text-accent hover:underline" onClick={() => startEdit(r)}>Edit</button>
          {isAdmin && (
            <button type="button" className="py-1 text-risk hover:underline" onClick={() => remove(r)}>Delete</button>
          )}
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
        <div className="mb-4 flex items-center justify-between">
          <h3 className="font-display text-lg font-semibold">
            {editing ? `Edit lead - ${editing.name}` : "New lead"}
          </h3>
          {editing && (
            <button
              type="button"
              className="text-sm text-muted hover:underline"
              onClick={() => { setEditing(null); setStage("NEW_LEAD"); }}
            >
              Cancel edit
            </button>
          )}
        </div>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <Field label="Lead name">
            <TextInput name="name" required placeholder="Full name" defaultValue={editing?.name ?? ""} />
          </Field>
          <Field label="Phone / WhatsApp" hint="With country code">
            <TextInput name="phone" required placeholder="+91…" defaultValue={editing?.phone ?? ""} />
          </Field>
          <Field label="Lead source">
            <Select name="leadSource" options={optionsFrom(LEAD_SOURCE_LABELS)} defaultValue={editing?.leadSource ?? "INSTAGRAM"} />
          </Field>
          <Field label="Date lead came in">
            <TextInput type="date" name="dateIn" required defaultValue={editing ? editing.dateIn.slice(0, 10) : today} />
          </Field>
          <Field label="Current stage">
            <Select
              name="stage"
              options={optionsFrom(LEAD_STAGE_LABELS)}
              value={stage}
              onChange={(e) => setStage(e.target.value)}
            />
          </Field>
          {stage === "WON" && (
            <Field label="Program level (Won)" hint="Which program did they enrol in?">
              <Select name="wonLevel" options={optionsFrom(PROGRAM_LEVEL_LABELS)} defaultValue={editing?.wonLevel ?? "GUIDED"} />
            </Field>
          )}
          {PAYMENT_PLAN_STAGES.has(stage) && (
            <Field label="Payment plan" hint="Split pay or full pay?">
              <Select
                name="paymentPlan"
                options={[{ value: "", label: "-" }, ...optionsFrom(PAYMENT_PLAN_LABELS)]}
                defaultValue={editing?.paymentPlan ?? ""}
              />
            </Field>
          )}
          <div className="sm:col-span-2">
            <Field label="Notes" hint="What was said, objections, situation">
              <TextArea name="notes" defaultValue={editing?.notes ?? ""} />
            </Field>
          </div>
        </div>
        <div className="mt-4 flex items-center gap-3">
          <SubmitButton>{editing ? "Save changes" : "Add lead"}</SubmitButton>
          <FormError message={error} />
        </div>
      </form>

      <DataTable
        rows={rows}
        columns={columns}
        csvName={isAdmin ? "leads" : undefined}
        filterPlaceholder="Filter leads…"
      />
    </section>
  );
}
