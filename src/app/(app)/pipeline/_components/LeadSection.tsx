"use client";

import { useEffect, useRef, useState } from "react";
import { assignLead, createLead, deleteLead, markLeadContacted, updateLead } from "@/server/pipeline-actions";
import { restoreLead } from "@/server/contacts-actions";
import type { LeadRow } from "@/server/pipeline-metrics";
import { DataTable, type Column } from "@/components/ui/DataTable";
import { SendWhatsAppButton } from "@/components/ui/SendWhatsAppButton";
import { WhatsAppStatusBadge } from "@/components/ui/WhatsAppStatusBadge";
import { sendLeadReminder } from "@/server/whatsapp-actions";
import type { WhatsAppStatusCell } from "@/server/whatsapp";
import { toast, toastUndo } from "@/components/ui/feedback";
import { Card } from "@/components/ui/kit";
import { Btn } from "@/components/ui/controls";
import { Field, FormError, Select, SubmitButton, TextArea, TextInput } from "@/components/ui/form";
import { PhoneField } from "@/components/ui/PhoneField";
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
  levelOptions,
  waStatus = {},
}: {
  rows: LeadRow[];
  today: string;
  isAdmin: boolean;
  assignees: { value: string; label: string }[];
  levelOptions: { value: string; label: string }[];
  waStatus?: Record<string, WhatsAppStatusCell>;
}) {
  const [editing, setEditing] = useState<LeadRow | null>(null);
  const [stage, setStage] = useState<string>("NEW_LEAD");
  const [error, setError] = useState<string | null>(null);
  // Optimistic owner overrides, keyed by lead id: the assignee <Select> shows the new
  // owner the instant it's picked, and reverts to the prior owner if the server rejects.
  const [assignVal, setAssignVal] = useState<Record<string, string>>({});
  const formRef = useRef<HTMLFormElement>(null);

  const ownerOf = (row: LeadRow) => assignVal[row.id] ?? row.assignedToId ?? "";

  const startEdit = (row: LeadRow) => {
    setEditing(row);
    setStage(row.stage);
  };

  // The edit form lives at the top of the section, above the table. Editing a row far
  // down the list used to silently repopulate a form off-screen — the click read as a
  // no-op. Bring the form into view and focus its first field when an edit begins.
  useEffect(() => {
    if (!editing) return;
    const form = formRef.current;
    if (!form) return;
    form.scrollIntoView({ behavior: "smooth", block: "center" });
    form.querySelector<HTMLElement>("input, textarea, select")?.focus({ preventScroll: true });
  }, [editing]);

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
    // Delete IS a soft-delete (archive) — reversible — so it follows the Gmail undo-send
    // model instead of a blocking confirm: archive now, offer Undo for a grace window.
    // askConfirm stays reserved for the truly irreversible (permanent purge).
    const res = await deleteLead(row.id);
    if (!res.ok) return toast(res.error, "error");
    toastUndo(`Archived ${row.name}`, async () => {
      const r = await restoreLead(row.id);
      toast(r.ok ? `Restored ${row.name}` : r.error, r.ok ? "success" : "error");
    });
  };

  const contact = async (row: LeadRow) => {
    const res = await markLeadContacted(row.id);
    if (!res.ok) return toast(res.error, "error");
    toast("Marked contacted");
  };

  const reassign = async (row: LeadRow, userId: string) => {
    const prev = ownerOf(row);
    if (userId === prev) return;
    setAssignVal((m) => ({ ...m, [row.id]: userId })); // optimistic
    const res = await assignLead(row.id, userId);
    if (!res.ok) {
      setAssignVal((m) => ({ ...m, [row.id]: prev })); // rollback the select
      return toast(res.error, "error");
    }
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
          {r.wonLevel ? ` · ${PROGRAM_LEVEL_LABELS[r.wonLevel] ?? r.wonLevel}` : ""}
          {r.paymentPlan ? ` · ${PAYMENT_PLAN_LABELS[r.paymentPlan]}` : ""}
        </span>
      ),
      value: (r) => LEAD_STAGE_LABELS[r.stage],
    },
    {
      key: "assignedTo", header: "Assigned to",
      cell: (r) =>
        isAdmin ? (
          <Select
            aria-label={`Assign ${r.name}`}
            value={ownerOf(r)}
            onChange={(e) => reassign(r, e.target.value)}
            size="sm"
            options={[{ value: "", label: "Unassigned" }, ...assignees]}
          />
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
          <Btn variant="ghost" size="sm" onClick={() => contact(r)}>
            Mark contacted
          </Btn>
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
          <Btn variant="ghost" size="sm" onClick={() => startEdit(r)}>Edit</Btn>
          {isAdmin && (
            <Btn variant="danger" size="sm" onClick={() => remove(r)}>Delete</Btn>
          )}
        </span>
      ),
      value: () => null,
    },
  ];

  return (
    <section className="space-y-4">
      <Card
        title={editing ? `Edit lead - ${editing.name}` : "New lead"}
        actions={
          editing ? (
            <Btn variant="ghost" size="sm" onClick={() => { setEditing(null); setStage("NEW_LEAD"); }}>
              Cancel edit
            </Btn>
          ) : undefined
        }
      >
        <form ref={formRef} action={submit} key={editing?.id ?? "new"}>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <Field label="Lead name">
            <TextInput kind="name" name="name" required placeholder="Full name" defaultValue={editing?.name ?? ""} />
          </Field>
          <Field label="Phone / WhatsApp" hint="Pick country, then number">
            <PhoneField name="phone" required defaultValue={editing?.phone ?? ""} />
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
            <Field label="Programme level (Won)" hint="Which programme did they enrol in?">
              <Select name="wonLevel" options={levelOptions} defaultValue={editing?.wonLevel ?? "GUIDED"} />
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
              <TextArea kind="text" name="notes" defaultValue={editing?.notes ?? ""} />
            </Field>
          </div>
        </div>
        <div className="mt-4 flex items-center gap-3">
          <SubmitButton>{editing ? "Save changes" : "Add lead"}</SubmitButton>
          <FormError message={error} />
        </div>
        </form>
      </Card>

      <DataTable
        rows={rows}
        columns={columns}
        csvName={isAdmin ? "leads" : undefined}
        filterPlaceholder="Filter leads…"
      />
    </section>
  );
}
