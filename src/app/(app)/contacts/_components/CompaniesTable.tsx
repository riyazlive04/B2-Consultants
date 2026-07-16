"use client";

import { useRef, useState } from "react";
import { Plus, Building2, Trash2 } from "lucide-react";
import { Btn, IconButton } from "@/components/ui/controls";
import { Modal } from "@/components/ui/Modal";
import { Field, TextInput, Select, SubmitButton, FormError } from "@/components/ui/form";
import { toast, askConfirm } from "@/components/ui/feedback";
import { EmptyState } from "@/components/ui/kit";
import { DataTable, type Column } from "@/components/ui/DataTable";
import { createCompany, updateCompany, deleteCompany } from "@/server/contacts-actions";

type Row = {
  id: string;
  name: string;
  domain: string | null;
  phone: string | null;
  email: string | null;
  city: string | null;
  country: string | null;
  ownerName: string | null;
  contactCount: number;
};

export default function CompaniesTable({
  rows,
  owners,
  canDelete,
}: {
  rows: Row[];
  owners: { id: string; name: string }[];
  canDelete: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<Row | null>(null);
  const [error, setError] = useState<string | null>(null);
  const formRef = useRef<HTMLFormElement>(null);

  const ownerOpts = [{ value: "", label: "— unassigned —" }, ...owners.map((o) => ({ value: o.id, label: o.name }))];

  function openNew() {
    setEditing(null);
    setError(null);
    setOpen(true);
  }
  function openEdit(r: Row) {
    setEditing(r);
    setError(null);
    setOpen(true);
  }

  async function submit(fd: FormData) {
    setError(null);
    const res = editing ? await updateCompany(editing.id, fd) : await createCompany(fd);
    if (!res.ok) return setError(res.error);
    toast(editing ? "Company updated" : "Company added");
    setOpen(false);
  }

  async function remove(r: Row) {
    const ok = await askConfirm({ title: `Delete ${r.name}?`, body: "Contacts stay, but lose this company link.", danger: true });
    if (!ok) return;
    const res = await deleteCompany(r.id);
    toast(res.ok ? "Company deleted" : res.error, res.ok ? "success" : "error");
  }

  const columns: Column<Row>[] = [
    {
      key: "name", header: "Company",
      cell: (r) => (
        <button onClick={() => openEdit(r)} className="text-left text-sm font-semibold text-ink hover:text-primary">
          {r.name}
          {r.domain && <span className="block text-xs font-normal text-ink-3">{r.domain}</span>}
        </button>
      ),
      value: (r) => r.name,
    },
    { key: "contacts", header: "Contacts", align: "right", cell: (r) => r.contactCount, value: (r) => r.contactCount },
    { key: "phone", header: "Phone", cell: (r) => r.phone ?? "—", value: (r) => r.phone },
    { key: "location", header: "Location", cell: (r) => [r.city, r.country].filter(Boolean).join(", ") || "—", value: (r) => [r.city, r.country].filter(Boolean).join(", ") },
    { key: "owner", header: "Owner", cell: (r) => r.ownerName ?? "—", value: (r) => r.ownerName },
    {
      key: "actions", header: "Actions", align: "right", sortable: false,
      cell: (r) => (
        <div className="flex justify-end gap-1">
          <Btn size="sm" variant="ghost" onClick={() => openEdit(r)}>
            Edit
          </Btn>
          {canDelete && <IconButton label="Delete company" onClick={() => remove(r)}><Trash2 size={16} /></IconButton>}
        </div>
      ),
    },
  ];

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <Btn icon={<Plus size={16} />} onClick={openNew}>
          Add company
        </Btn>
      </div>

      {rows.length === 0 ? (
        <EmptyState icon={<Building2 size={20} />} title="No companies yet" body="Group B2B contacts under a company." action={<Btn icon={<Plus size={16} />} onClick={openNew}>Add company</Btn>} />
      ) : (
        <DataTable
          rows={rows}
          columns={columns}
          csvName="companies"
          filterPlaceholder="Filter companies…"
          emptyMessage="No companies match."
        />
      )}

      <Modal open={open} onClose={() => setOpen(false)} title={editing ? "Edit company" : "Add company"} size="md">
        <form action={submit} ref={formRef} key={editing?.id ?? "new"} className="space-y-4">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Field label="Company name">
              <TextInput name="name" required defaultValue={editing?.name ?? ""} />
            </Field>
            <Field label="Website / domain">
              <TextInput name="domain" defaultValue={editing?.domain ?? ""} placeholder="example.com" />
            </Field>
            <Field label="Phone">
              <TextInput name="phone" defaultValue={editing?.phone ?? ""} />
            </Field>
            <Field label="Email">
              <TextInput name="email" type="email" defaultValue={editing?.email ?? ""} />
            </Field>
            <Field label="City">
              <TextInput name="city" defaultValue={editing?.city ?? ""} />
            </Field>
            <Field label="Country">
              <TextInput name="country" defaultValue={editing?.country ?? ""} />
            </Field>
            <Field label="Owner">
              <Select name="ownerId" options={ownerOpts} defaultValue="" />
            </Field>
          </div>
          <FormError message={error} />
          <div className="flex justify-end gap-2 pt-1">
            <Btn variant="ghost" type="button" onClick={() => setOpen(false)}>
              Cancel
            </Btn>
            <SubmitButton>{editing ? "Save changes" : "Add company"}</SubmitButton>
          </div>
        </form>
      </Modal>
    </div>
  );
}
