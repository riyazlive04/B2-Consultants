"use client";

import { useState } from "react";
import { Plus, FileText, Trash2 } from "lucide-react";
import { Btn, IconButton } from "@/components/ui/controls";
import { Modal } from "@/components/ui/Modal";
import { Field, TextInput, TextArea, Select, SubmitButton, FormError } from "@/components/ui/form";
import { toast, askConfirm } from "@/components/ui/feedback";
import { EmptyState, Pill, TableShell, Td, Th, Tr } from "@/components/ui/kit";
import { createTemplate, updateTemplate, deleteTemplate } from "@/server/messaging-actions";

type Template = { id: string; channel: "EMAIL" | "SMS"; name: string; subject: string | null; body: string };

export default function TemplatesPanel({ templates }: { templates: Template[] }) {
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<Template | null>(null);
  const [channel, setChannel] = useState<"EMAIL" | "SMS">("EMAIL");
  const [error, setError] = useState<string | null>(null);

  function openNew() { setEditing(null); setChannel("EMAIL"); setError(null); setOpen(true); }
  function openEdit(t: Template) { setEditing(t); setChannel(t.channel); setError(null); setOpen(true); }

  async function submit(fd: FormData) {
    setError(null);
    const res = editing ? await updateTemplate(editing.id, fd) : await createTemplate(fd);
    if (!res.ok) return setError(res.error);
    toast(editing ? "Template updated" : "Template created");
    setOpen(false);
  }
  async function remove(t: Template) {
    if (!(await askConfirm({ title: `Delete "${t.name}"?`, danger: true }))) return;
    const res = await deleteTemplate(t.id);
    if (res.ok) toast("Template deleted");
  }

  return (
    <div className="space-y-4">
      <div className="flex justify-end"><Btn icon={<Plus size={16} />} onClick={openNew}>New template</Btn></div>

      {templates.length === 0 ? (
        <EmptyState icon={<FileText size={20} />} title="No templates" body="Save reusable email & SMS templates with {{name}} tokens." />
      ) : (
        <TableShell minWidth={640} head={<><Th>Name</Th><Th>Channel</Th><Th>Preview</Th><Th align="right">Actions</Th></>}>
          {templates.map((t) => (
            <Tr key={t.id} className="border-b border-line hover:bg-surface-2">
              <Td><button onClick={() => openEdit(t)} className="text-sm font-semibold text-ink hover:text-primary">{t.name}</button></Td>
              <Td><Pill tone={t.channel === "EMAIL" ? "info" : "primary"}>{t.channel}</Pill></Td>
              <Td className="max-w-sm truncate text-sm text-ink-3">{t.subject ? `${t.subject} — ` : ""}{t.body}</Td>
              <Td align="right">
                <div className="flex items-center justify-end gap-1">
                  <Btn size="sm" variant="ghost" onClick={() => openEdit(t)}>Edit</Btn>
                  <IconButton label="Delete template" onClick={() => remove(t)}><Trash2 size={16} /></IconButton>
                </div>
              </Td>
            </Tr>
          ))}
        </TableShell>
      )}

      <Modal open={open} onClose={() => setOpen(false)} title={editing ? "Edit template" : "New template"} size="md">
        <form action={submit} key={editing?.id ?? "new"} className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <Field label="Name"><TextInput name="name" required defaultValue={editing?.name ?? ""} /></Field>
            <Field label="Channel"><Select name="channel" options={[{ value: "EMAIL", label: "Email" }, { value: "SMS", label: "SMS" }]} value={channel} onChange={(e) => setChannel(e.target.value as "EMAIL" | "SMS")} /></Field>
          </div>
          {channel === "EMAIL" && <Field label="Subject"><TextInput name="subject" defaultValue={editing?.subject ?? ""} placeholder="Hi {{first_name}} 👋" /></Field>}
          <Field label="Body" hint="Tokens: {{name}}, {{first_name}}, {{email}}, {{phone}}">
            <TextArea name="body" rows={5} required defaultValue={editing?.body ?? ""} />
          </Field>
          <FormError message={error} />
          <div className="flex justify-end gap-2"><Btn variant="ghost" type="button" onClick={() => setOpen(false)}>Cancel</Btn><SubmitButton>{editing ? "Save" : "Create"}</SubmitButton></div>
        </form>
      </Modal>
    </div>
  );
}
