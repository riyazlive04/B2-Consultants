"use client";

import Link from "next/link";
import { useRef, useState } from "react";
import { createStudent, deleteStudent } from "@/server/students-actions";
import type { StudentListRow } from "@/server/students-metrics";
import { DataTable, type Column } from "@/components/ui/DataTable";
import { Modal } from "@/components/ui/Modal";
import { askConfirm, celebrate, toast } from "@/components/ui/feedback";
import { Field, FormError, Select, SubmitButton, TextArea, TextInput } from "@/components/ui/form";
import { Plus } from "lucide-react";
import { formatDate, formatInrMinor } from "@/lib/format";
import { LEAD_SOURCE_LABELS, optionsFrom } from "@/lib/labels";

const B2_LEVEL_OPTIONS = [
  { value: "SOLO", label: "Solo (lifetime, self-paced)" },
  { value: "GUIDED", label: "Guided (90 days)" },
  { value: "ELITE", label: "Elite (120 days)" },
];

/** Student list + add form (Admin) - one row per person; LTV column sortable (PRD2 §4.6). */
export function StudentsPanel({ rows, isAdmin }: { rows: StudentListRow[]; isAdmin: boolean }) {
  const [adding, setAdding] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const formRef = useRef<HTMLFormElement>(null);

  const submit = async (form: FormData) => {
    setError(null);
    const res = await createStudent(form);
    if (!res.ok) return setError(res.error);
    setAdding(false);
    formRef.current?.reset();
    toast("Student created - past payments auto-linked by name");
    celebrate(); // a new enrollment is a win worth confetti
  };

  const remove = async (row: StudentListRow) => {
    const ok = await askConfirm({
      title: `Delete student ${row.fullName}?`,
      body: "Enrollments and tracker history are removed. Linked income entries stay in Finance.",
      confirmLabel: "Delete student",
      danger: true,
    });
    if (!ok) return;
    await deleteStudent(row.id);
    toast("Student deleted");
  };

  const columns: Column<StudentListRow>[] = [
    {
      key: "name", header: "Student",
      cell: (r) => (
        <Link href={`/students/${r.id}`} className="font-medium text-accent hover:underline">
          {r.fullName}
        </Link>
      ),
      value: (r) => r.fullName,
    },
    { key: "levels", header: "Program(s)", cell: (r) => r.levels, value: (r) => r.levels },
    { key: "status", header: "Status", cell: (r) => r.statuses, value: (r) => r.statuses },
    {
      key: "enrolled", header: "Enrolled",
      cell: (r) => (r.firstEnrollment ? formatDate(r.firstEnrollment) : "-"),
      value: (r) => r.firstEnrollment?.slice(0, 10) ?? "",
    },
    {
      key: "ltv", header: "LTV", align: "right",
      cell: (r) => formatInrMinor(r.ltvInr, { compact: true }),
      value: (r) => r.ltvInr / 100,
    },
    { key: "source", header: "Lead source", cell: (r) => (r.leadSource ? LEAD_SOURCE_LABELS[r.leadSource] : "-"), value: (r) => r.leadSource ?? "" },
    { key: "industry", header: "Industry", cell: (r) => r.industry ?? "-", value: (r) => r.industry ?? "" },
    ...(isAdmin
      ? [{
          key: "actions", header: "", sortable: false,
          cell: (r: StudentListRow) => (
            <button type="button" className="py-1 text-risk hover:underline" onClick={() => remove(r)}>
              Delete
            </button>
          ),
          value: () => null,
        } satisfies Column<StudentListRow>]
      : []),
  ];

  return (
    <div className="space-y-4">
      {isAdmin && (
        <div className="flex justify-end">
          <button
            type="button"
            className="glow-accent inline-flex items-center gap-1.5 rounded-field bg-accent px-3.5 py-2 text-sm font-semibold text-white transition-opacity hover:opacity-95"
            onClick={() => setAdding(true)}
          >
            <Plus size={16} /> Add student
          </button>
        </div>
      )}

      <Modal
        open={adding}
        onClose={() => setAdding(false)}
        title="New student"
        subtitle="Created when a student pays. Past Finance income entries with the same name link automatically; duration and end date derive from the program level."
      >
        <form ref={formRef} action={submit}>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            <Field label="Full name">
              <TextInput name="fullName" required />
            </Field>
            <Field label="Email">
              <TextInput type="email" name="email" />
            </Field>
            <Field label="Phone / WhatsApp" hint="With country code">
              <TextInput name="phone" />
            </Field>
            <Field label="Program level">
              <Select name="programLevel" options={B2_LEVEL_OPTIONS} defaultValue="GUIDED" />
            </Field>
            <Field label="Enrollment date" hint="Date they paid and started">
              <TextInput type="date" name="enrollmentDate" required />
            </Field>
            <Field label="Sessions planned" hint="e.g. 12 for Guided">
              <TextInput name="totalSessionsPlanned" inputMode="numeric" />
            </Field>
            <Field label="Assigned coach">
              <TextInput name="assignedCoach" defaultValue="Karthick" />
            </Field>
            <Field label="Lead source" hint="Ghosted Blueprint tag drives Phase 3 attribution">
              <Select name="leadSource" options={[{ value: "", label: "-" }, ...optionsFrom(LEAD_SOURCE_LABELS)]} defaultValue="" />
            </Field>
            <Field label="Industry / background">
              <TextInput name="industry" placeholder="e.g. Mechanical Engineer" />
            </Field>
            <Field label="Target role in Germany">
              <TextInput name="targetRole" />
            </Field>
            <div className="sm:col-span-2">
              <Field label="Internal notes">
                <TextArea name="internalNotes" />
              </Field>
            </div>
          </div>
          <div className="mt-5 flex items-center gap-3">
            <SubmitButton>Create student</SubmitButton>
            <button type="button" className="text-sm text-muted hover:underline" onClick={() => setAdding(false)}>
              Cancel
            </button>
            <FormError message={error} />
          </div>
        </form>
      </Modal>

      <DataTable
        rows={rows}
        columns={columns}
        csvName={isAdmin ? "students" : undefined}
        filterPlaceholder="Filter students…"
        emptyMessage="No students yet."
      />
    </div>
  );
}
