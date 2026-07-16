"use client";

import { useRef, useState } from "react";
import { createOutcome, deleteOutcome, updateOutcome } from "@/server/pipeline-actions";
import type { OutcomeRow } from "@/server/pipeline-metrics";
import { DataTable, type Column } from "@/components/ui/DataTable";
import { askConfirm, toast } from "@/components/ui/feedback";
import { Card } from "@/components/ui/kit";
import { Btn } from "@/components/ui/controls";
import { CheckboxField, Field, FormError, Select, SubmitButton, TextArea, TextInput } from "@/components/ui/form";
import { formatDate } from "@/lib/format";
import { CALL_OUTCOME_LABELS, optionsFrom } from "@/lib/labels";

export function OutcomeSection({
  rows,
  leadOptions,
  today,
  isAdmin,
}: {
  rows: OutcomeRow[];
  leadOptions: { value: string; label: string }[];
  today: string;
  isAdmin: boolean;
}) {
  const [editing, setEditing] = useState<OutcomeRow | null>(null);
  const [error, setError] = useState<string | null>(null);
  const formRef = useRef<HTMLFormElement>(null);

  const submit = async (form: FormData) => {
    setError(null);
    const res = editing ? await updateOutcome(editing.id, form) : await createOutcome(form);
    if (!res.ok) return setError(res.error);
    toast(editing ? "Outcome updated" : "Call outcome recorded");
    setEditing(null);
    formRef.current?.reset();
  };

  const remove = async (row: OutcomeRow) => {
    const ok = await askConfirm({
      title: `Delete this call outcome for ${row.leadName}?`,
      confirmLabel: "Delete",
      danger: true,
    });
    if (!ok) return;
    await deleteOutcome(row.id);
    toast("Outcome deleted");
  };

  const columns: Column<OutcomeRow>[] = [
    { key: "lead", header: "Lead", cell: (r) => r.leadName, value: (r) => r.leadName },
    { key: "date", header: "Call date", cell: (r) => formatDate(r.callDate), value: (r) => r.callDate.slice(0, 10) },
    { key: "outcome", header: "Outcome", cell: (r) => CALL_OUTCOME_LABELS[r.outcome], value: (r) => CALL_OUTCOME_LABELS[r.outcome] },
    {
      key: "hq", header: "Highly qualified",
      cell: (r) => (r.highlyQualified ? "Yes" : "No"), value: (r) => (r.highlyQualified ? "Yes" : "No"),
    },
    {
      key: "bant", header: "BANT", align: "right",
      cell: (r) => {
        const n = [r.bantBudget, r.bantAuthority, r.bantNeed, r.bantTimeline].filter(Boolean).length;
        return n === 0 ? "-" : `${n}/4`;
      },
      value: (r) => [r.bantBudget, r.bantAuthority, r.bantNeed, r.bantTimeline].filter(Boolean).length,
    },
    { key: "sss", header: "SSS date", cell: (r) => (r.sssDate ? formatDate(r.sssDate) : "-"), value: (r) => r.sssDate?.slice(0, 10) ?? "" },
    { key: "by", header: "Entered by", cell: (r) => r.enteredBy, value: (r) => r.enteredBy },
    { key: "notes", header: "Key notes to closer", cell: (r) => r.notes ?? "", value: (r) => r.notes ?? "" },
    {
      key: "actions", header: "", sortable: false,
      cell: (r) => (
        <span className="flex gap-2 whitespace-nowrap">
          <Btn variant="ghost" size="sm" onClick={() => setEditing(r)}>Edit</Btn>
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
        title={editing ? `Edit outcome - ${editing.leadName}` : "Discovery call outcome"}
        actions={
          editing ? (
            <Btn variant="ghost" size="sm" onClick={() => setEditing(null)}>
              Cancel edit
            </Btn>
          ) : undefined
        }
      >
        <form ref={formRef} action={submit} key={editing?.id ?? "new"}>
        {leadOptions.length === 0 ? (
          <p className="text-sm text-muted">Add a lead first - outcomes link to a lead record.</p>
        ) : (
          <>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
              <Field label="Lead">
                <Select name="leadId" options={leadOptions} defaultValue={editing?.leadId ?? leadOptions[0].value} />
              </Field>
              <Field label="Call date">
                <TextInput type="date" name="callDate" required defaultValue={editing ? editing.callDate.slice(0, 10) : today} />
              </Field>
              <Field label="Call outcome">
                <Select name="outcome" options={optionsFrom(CALL_OUTCOME_LABELS)} defaultValue={editing?.outcome ?? "QUALIFIED_FOR_SSS"} />
              </Field>
              <Field label="SSS date (if booked)">
                <TextInput type="date" name="sssDate" defaultValue={editing?.sssDate?.slice(0, 10) ?? ""} />
              </Field>
              <div className="flex items-end pb-1">
                <CheckboxField name="highlyQualified" label="Highly qualified" defaultChecked={editing?.highlyQualified ?? false} />
              </div>
              <div className="sm:col-span-2 lg:col-span-3">
                <p className="mb-1.5 text-sm font-medium">BANT qualification <span className="font-normal text-muted">- drives the “call these first” ranking</span></p>
                <div className="flex flex-wrap gap-4">
                  <CheckboxField name="bantBudget" label="Budget" defaultChecked={editing?.bantBudget ?? false} />
                  <CheckboxField name="bantAuthority" label="Authority" defaultChecked={editing?.bantAuthority ?? false} />
                  <CheckboxField name="bantNeed" label="Need" defaultChecked={editing?.bantNeed ?? false} />
                  <CheckboxField name="bantTimeline" label="Timeline" defaultChecked={editing?.bantTimeline ?? false} />
                </div>
              </div>
              <div className="sm:col-span-2 lg:col-span-3">
                <Field label="Call notes" hint="Summary of what was discussed - key notes to closer">
                  <TextArea name="notes" defaultValue={editing?.notes ?? ""} />
                </Field>
              </div>
            </div>
            <div className="mt-4 flex items-center gap-3">
              <SubmitButton>{editing ? "Save changes" : "Add outcome"}</SubmitButton>
              <FormError message={error} />
            </div>
          </>
        )}
        </form>
      </Card>

      <DataTable
        rows={rows}
        columns={columns}
        csvName={isAdmin ? "discovery-outcomes" : undefined}
        filterPlaceholder="Filter outcomes…"
      />
    </section>
  );
}
