"use client";

import { useRef, useState } from "react";
import { Plus, SlidersHorizontal, Trash2 } from "lucide-react";
import type { CustomFieldDefinition } from "@prisma/client";
import { Btn, IconButton } from "@/components/ui/controls";
import { Modal } from "@/components/ui/Modal";
import { Field, TextInput, Select, SubmitButton, FormError } from "@/components/ui/form";
import { toast, askConfirm } from "@/components/ui/feedback";
import { Chip, EmptyState, Hint } from "@/components/ui/kit";
import { DataTable, type Column } from "@/components/ui/DataTable";
import { createCustomField, deleteCustomField } from "@/server/contacts-actions";

const TYPE_OPTS = [
  { value: "TEXT", label: "Text" },
  { value: "LONG_TEXT", label: "Long text" },
  { value: "NUMBER", label: "Number" },
  { value: "DATE", label: "Date" },
  { value: "DROPDOWN", label: "Dropdown (single)" },
  { value: "MULTI_SELECT", label: "Multi-select" },
  { value: "CHECKBOX", label: "Checkbox" },
  { value: "PHONE", label: "Phone" },
  { value: "EMAIL", label: "Email" },
  { value: "URL", label: "URL" },
  { value: "MONETARY", label: "Money" },
];

const TYPE_LABEL: Record<string, string> = Object.fromEntries(TYPE_OPTS.map((o) => [o.value, o.label]));

export default function CustomFieldsPanel({ defs, canManage }: { defs: CustomFieldDefinition[]; canManage: boolean }) {
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [type, setType] = useState("TEXT");
  const formRef = useRef<HTMLFormElement>(null);

  const needsOptions = type === "DROPDOWN" || type === "MULTI_SELECT";

  async function submit(fd: FormData) {
    setError(null);
    const res = await createCustomField(fd);
    if (!res.ok) return setError(res.error);
    toast("Custom field created");
    setOpen(false);
    formRef.current?.reset();
    setType("TEXT");
  }

  async function remove(d: CustomFieldDefinition) {
    const ok = await askConfirm({ title: `Delete "${d.name}"?`, body: "Existing values on contacts are kept but hidden.", danger: true });
    if (!ok) return;
    const res = await deleteCustomField(d.id);
    toast(res.ok ? "Field deleted" : res.error, res.ok ? "success" : "error");
  }

  const columns: Column<CustomFieldDefinition>[] = [
    {
      key: "field", header: "Field",
      cell: (d) => (
        <>
          <span className="text-sm font-semibold text-ink">{d.name}</span>
          <span className="block text-xs text-ink-3">{d.key}</span>
        </>
      ),
      value: (d) => d.name,
    },
    { key: "type", header: "Type", cell: (d) => TYPE_LABEL[d.fieldType] ?? d.fieldType, value: (d) => TYPE_LABEL[d.fieldType] ?? d.fieldType },
    {
      key: "options", header: "Options", sortable: false,
      cell: (d) => (
        <div className="flex flex-wrap gap-1">
          {Array.isArray(d.options) ? (d.options as string[]).map((o) => <Chip key={o}>{o}</Chip>) : <span className="text-ink-3">—</span>}
        </div>
      ),
    },
    ...(canManage
      ? [
          {
            key: "actions", header: "Actions", align: "right" as const, sortable: false,
            cell: (d: CustomFieldDefinition) => (
              <IconButton label="Delete field" onClick={() => remove(d)}>
                <Trash2 size={16} />
              </IconButton>
            ),
          },
        ]
      : []),
  ];

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <Hint>User-defined fields captured on every contact record.</Hint>
        {canManage && (
          <Btn icon={<Plus size={16} />} onClick={() => setOpen(true)}>
            New field
          </Btn>
        )}
      </div>

      {defs.length === 0 ? (
        <EmptyState icon={<SlidersHorizontal size={20} />} title="No custom fields" body={canManage ? "Add fields like Visa type, Target country, Budget." : "An admin can add custom fields."} />
      ) : (
        <DataTable
          rows={defs}
          columns={columns}
          filterPlaceholder="Filter fields…"
          emptyMessage="No fields match."
        />
      )}

      <Modal open={open} onClose={() => setOpen(false)} title="New custom field" size="sm">
        <form action={submit} ref={formRef} className="space-y-4">
          <Field label="Field name">
            <TextInput name="name" required placeholder="e.g. Target country" />
          </Field>
          <Field label="Type">
            <Select name="fieldType" options={TYPE_OPTS} value={type} onChange={(e) => setType(e.target.value)} />
          </Field>
          {needsOptions && (
            <Field label="Options" hint="Comma-separated">
              <TextInput name="options" placeholder="Germany, Canada, Australia" />
            </Field>
          )}
          <FormError message={error} />
          <div className="flex justify-end gap-2 pt-1">
            <Btn variant="ghost" type="button" onClick={() => setOpen(false)}>
              Cancel
            </Btn>
            <SubmitButton>Create field</SubmitButton>
          </div>
        </form>
      </Modal>
    </div>
  );
}
