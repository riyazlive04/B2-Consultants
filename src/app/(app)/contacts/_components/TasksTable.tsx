"use client";

import { useMemo, useRef, useState } from "react";
import Link from "next/link";
import { Plus, ListChecks, Trash2 } from "lucide-react";
import { Btn, IconButton } from "@/components/ui/controls";
import { Modal } from "@/components/ui/Modal";
import { Field, TextInput, TextArea, Select, SubmitButton, FormError } from "@/components/ui/form";
import { toast, askConfirm } from "@/components/ui/feedback";
import { EmptyState, Pill } from "@/components/ui/kit";
import { DataTable, type Column } from "@/components/ui/DataTable";
import { DateText } from "@/components/ui/DateText";
import { createTask, toggleTask, deleteTask } from "@/server/contacts-actions";

type Row = {
  id: string;
  title: string;
  body: string | null;
  dueAt: Date | null;
  status: string;
  assigneeName: string | null;
  contactId: string | null;
  contactName: string | null;
};

export default function TasksTable({ rows, owners }: { rows: Row[]; owners: { id: string; name: string }[] }) {
  const [showDone, setShowDone] = useState(false);
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const formRef = useRef<HTMLFormElement>(null);

  const shown = useMemo(() => rows.filter((r) => (showDone ? true : r.status === "OPEN")), [rows, showDone]);
  const ownerOpts = [{ value: "", label: "— unassigned —" }, ...owners.map((o) => ({ value: o.id, label: o.name }))];

  async function submit(fd: FormData) {
    setError(null);
    const res = await createTask(fd);
    if (!res.ok) return setError(res.error);
    toast("Task created");
    setOpen(false);
    formRef.current?.reset();
  }

  async function complete(r: Row) {
    const res = await toggleTask(r.id);
    if (res.ok) toast(r.status === "OPEN" ? "Task completed" : "Task reopened");
  }

  async function remove(r: Row) {
    const ok = await askConfirm({ title: "Delete task?", body: r.title, danger: true });
    if (!ok) return;
    const res = await deleteTask(r.id);
    if (res.ok) toast("Task deleted");
  }

  const columns: Column<Row>[] = [
    {
      key: "done", header: "Done", sortable: false,
      cell: (r) => (
        <input
          type="checkbox"
          checked={r.status === "COMPLETED"}
          onChange={() => complete(r)}
          className="h-4 w-4 accent-[var(--primary)]"
        />
      ),
    },
    {
      key: "task", header: "Task",
      cell: (r) => (
        <>
          <span className={`text-sm font-semibold ${r.status === "COMPLETED" ? "text-ink-3 line-through" : "text-ink"}`}>{r.title}</span>
          {r.body && <span className="block text-xs text-ink-3">{r.body}</span>}
        </>
      ),
      value: (r) => r.title,
    },
    {
      key: "contact", header: "Contact",
      cell: (r) =>
        r.contactId ? (
          <Link href={`/contacts/${r.contactId}`} className="text-sm text-ink-2 hover:text-primary">
            {r.contactName}
          </Link>
        ) : (
          <span className="text-sm text-ink-2">—</span>
        ),
      value: (r) => r.contactName,
    },
    {
      key: "due", header: "Due",
      cell: (r) => (r.dueAt ? <DateText date={r.dueAt} /> : <span className="text-ink-3">—</span>),
      value: (r) => (r.dueAt ? r.dueAt.getTime() : null),
    },
    { key: "assignee", header: "Assignee", cell: (r) => r.assigneeName ?? "—", value: (r) => r.assigneeName },
    {
      key: "actions", header: "Actions", align: "right", sortable: false,
      cell: (r) => (
        <div className="flex items-center justify-end gap-1">
          <Pill tone={r.status === "COMPLETED" ? "good" : "warn"}>{r.status === "COMPLETED" ? "Done" : "Open"}</Pill>
          <IconButton label="Delete task" onClick={() => remove(r)}>
            <Trash2 size={16} />
          </IconButton>
        </div>
      ),
    },
  ];

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <label className="flex items-center gap-2 text-sm text-ink-2">
          <input type="checkbox" checked={showDone} onChange={(e) => setShowDone(e.target.checked)} className="h-4 w-4 accent-[var(--primary)]" />
          Show completed
        </label>
        <Btn icon={<Plus size={16} />} onClick={() => setOpen(true)}>
          New task
        </Btn>
      </div>

      {shown.length === 0 ? (
        <EmptyState icon={<ListChecks size={20} />} title="No tasks" body="Create follow-up tasks for your team." />
      ) : (
        <DataTable
          rows={shown}
          columns={columns}
          filterPlaceholder="Filter tasks…"
          emptyMessage="No tasks match."
        />
      )}

      <Modal open={open} onClose={() => setOpen(false)} title="New task" size="md">
        <form action={submit} ref={formRef} className="space-y-4">
          <Field label="Title">
            <TextInput name="title" required placeholder="e.g. Follow up on proposal" />
          </Field>
          <Field label="Details">
            <TextArea kind="text" name="body" rows={2} placeholder="Optional notes" />
          </Field>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Field label="Due">
              <TextInput name="dueAt" type="datetime-local" />
            </Field>
            <Field label="Assign to">
              <Select name="assignedToId" options={ownerOpts} defaultValue="" />
            </Field>
          </div>
          <FormError message={error} />
          <div className="flex justify-end gap-2 pt-1">
            <Btn variant="ghost" type="button" onClick={() => setOpen(false)}>
              Cancel
            </Btn>
            <SubmitButton>Create task</SubmitButton>
          </div>
        </form>
      </Modal>
    </div>
  );
}
