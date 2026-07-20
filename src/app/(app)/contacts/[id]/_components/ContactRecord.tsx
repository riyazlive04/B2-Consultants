"use client";

import { useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  ArrowLeft, Pencil, Plus, X, StickyNote, GitBranch, MessageCircle, PhoneCall,
  CalendarCheck, CheckCircle2, Pin, Trash2, Clock, GraduationCap,
} from "lucide-react";
import type { CustomFieldDefinition } from "@prisma/client";
import type { ContactDetail } from "@/server/contacts-metrics";
import type { AgreementSummary } from "@/lib/agreement-state";
import { AgreementTaskCard } from "@/app/(app)/agreements/_components/AgreementTaskCard";
import { Btn, IconButton } from "@/components/ui/controls";
import { Modal } from "@/components/ui/Modal";
import { Field, TextInput, Select, TextArea, SubmitButton, FormError } from "@/components/ui/form";
import { toast, askConfirm } from "@/components/ui/feedback";
import { Avatar, Card, Chip, EmptyState, Pill, type Tone } from "@/components/ui/kit";
import { Tabs } from "@/components/ui/Tabs";
import { DateText } from "@/components/ui/DateText";
import {
  updateContact, setContactOwner, addContactTag, removeContactTag, setContactCustomField,
  createNote, deleteNote, toggleNotePin, createTask, toggleTask, deleteTask,
} from "@/server/contacts-actions";
import { convertLeadToStudent } from "@/server/students-actions";

const SOURCE_OPTS = [
  { value: "INSTAGRAM", label: "Instagram" }, { value: "YOUTUBE", label: "YouTube" },
  { value: "LINKEDIN", label: "LinkedIn" }, { value: "WHATSAPP", label: "WhatsApp" },
  { value: "REFERRAL", label: "Referral" }, { value: "SUMMIT", label: "Summit" },
  { value: "WORKSHOP", label: "Workshop" }, { value: "GHOSTED_BLUEPRINT", label: "Ghosted Blueprint" },
  { value: "OTHER", label: "Other" },
];

const TONE_TEXT: Record<Tone, string> = {
  neutral: "text-muted bg-surface-2", primary: "text-primary-strong bg-primary-soft",
  good: "text-good bg-good-soft", warn: "text-warn bg-warn-soft", bad: "text-bad bg-bad-soft",
  info: "text-ink-2 bg-sky",
};

const KIND_ICON = {
  NOTE: StickyNote, STAGE_CHANGE: GitBranch, WHATSAPP: MessageCircle,
  OUTCOME: PhoneCall, BOOKING: CalendarCheck, TASK: CheckCircle2,
} as const;

function prettyStage(s: string) {
  return s.toLowerCase().replaceAll("_", " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

export default function ContactRecord({
  contact,
  owners,
  companies,
  allTags,
  customFields,
  agreement,
  canConvert,
}: {
  contact: ContactDetail;
  owners: { id: string; name: string }[];
  companies: { id: string; name: string }[];
  allTags: string[];
  customFields: CustomFieldDefinition[];
  agreement: AgreementSummary;
  canConvert: boolean;
}) {
  const router = useRouter();
  const [editOpen, setEditOpen] = useState(false);
  const [editError, setEditError] = useState<string | null>(null);
  const [newTag, setNewTag] = useState("");
  const [cfValues, setCfValues] = useState<Record<string, string>>(
    Object.fromEntries(customFields.map((f) => [f.key, String(contact.customFields[f.key] ?? "")])),
  );

  async function saveDetails(fd: FormData) {
    setEditError(null);
    const res = await updateContact(contact.id, fd);
    if (!res.ok) return setEditError(res.error);
    toast("Contact updated");
    setEditOpen(false);
  }

  // Convert this contact into a student record without re-keying (issue 2.1).
  async function convertToStudent() {
    const ok = await askConfirm({
      title: `Convert ${contact.name} to a student?`,
      body: "Creates a student record from this contact and carries their details over. You can set the programme level on the student next.",
      confirmLabel: "Convert",
    });
    if (!ok) return;
    const res = await convertLeadToStudent(contact.id);
    if (!res.ok) return toast(res.error, "error");
    toast("Converted to student");
    router.push("/students");
  }

  async function addTag() {
    const name = newTag.trim();
    if (!name) return;
    const res = await addContactTag(contact.id, name);
    if (res.ok) { toast("Tag added"); setNewTag(""); } else toast(res.error, "error");
  }

  async function saveCustomField(key: string) {
    const res = await setContactCustomField(contact.id, key, cfValues[key] ?? "");
    if (res.ok) toast("Saved");
    else toast(res.error, "error");
  }

  const ownerOpts = [{ value: "", label: "Unassigned" }, ...owners.map((o) => ({ value: o.id, label: o.name }))];

  return (
    <div className="space-y-5">
      <Link href="/contacts" className="inline-flex items-center gap-1.5 text-sm text-ink-2 hover:text-primary">
        <ArrowLeft size={16} /> Contacts
      </Link>

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-[360px_1fr]">
        {/* ─── Left: identity + details + tags + custom fields ─── */}
        <div className="space-y-5">
          <Card>
            <div className="flex items-start gap-3">
              <Avatar name={contact.name} size={52} />
              <div className="min-w-0 flex-1">
                <h1 className="font-display text-h2 text-ink">{contact.name}</h1>
                <p className="text-sm text-ink-2">{contact.phone ?? "No phone"}</p>
                {contact.email && <p className="truncate text-sm text-ink-3">{contact.email}</p>}
              </div>
              <Link href={`/conversations?contact=${contact.id}`}>
                <IconButton label="Message contact"><MessageCircle size={16} /></IconButton>
              </Link>
              <IconButton label="Edit details" onClick={() => setEditOpen(true)}>
                <Pencil size={16} />
              </IconButton>
            </div>
            <div className="mt-4 flex flex-wrap items-center gap-2">
              <Pill tone="info">{prettyStage(contact.stage)}</Pill>
              <Pill tone="neutral">{contact.leadSource.replaceAll("_", " ").toLowerCase()}</Pill>
            </div>

            <div className="mt-4 space-y-3 border-t border-line pt-4 text-sm">
              <Row label="Owner">
                <Select
                  aria-label="Owner"
                  defaultValue={contact.ownerId ?? ""}
                  onChange={async (e) => {
                    const res = await setContactOwner(contact.id, e.target.value);
                    if (res.ok) toast("Owner updated");
                  }}
                  options={ownerOpts}
                />
              </Row>
              <Row label="Company">{contact.companyName ?? <span className="text-ink-3">—</span>}</Row>
              <Row label="City">{contact.city ?? <span className="text-ink-3">—</span>}</Row>
              <Row label="Industry">{contact.industry ?? <span className="text-ink-3">—</span>}</Row>
              <Row label="Created"><DateText date={contact.createdAt} /></Row>
            </div>

            {canConvert && (
              <div className="mt-4 border-t border-line pt-4">
                <Btn variant="secondary" size="sm" className="w-full justify-center" onClick={convertToStudent}>
                  <GraduationCap size={15} /> Convert to student
                </Btn>
              </div>
            )}
          </Card>

          {/* Agreement — the next action on this contract, wherever it currently stands. */}
          <AgreementTaskCard summary={agreement} />

          {/* Tags */}
          <Card title="Tags">
            <div className="flex flex-wrap gap-1.5">
              {contact.tags.length === 0 && <span className="text-sm text-ink-3">No tags yet.</span>}
              {contact.tags.map((t) => (
                <span key={t.id} className="inline-flex items-center gap-1 rounded-full bg-primary-soft px-2.5 py-0.5 text-caption font-semibold text-primary-strong">
                  {t.name}
                  <button onClick={async () => { const r = await removeContactTag(contact.id, t.id); if (r.ok) toast("Tag removed"); }} className="hover:text-bad" aria-label={`Remove ${t.name}`}>
                    <X size={12} />
                  </button>
                </span>
              ))}
            </div>
            <div className="mt-3 flex gap-2">
              <input
                value={newTag}
                onChange={(e) => setNewTag(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && addTag()}
                list="tag-suggestions"
                placeholder="Add a tag…"
                className="h-9 flex-1 rounded-field border border-line bg-surface px-3 text-sm outline-none focus:border-primary"
              />
              <datalist id="tag-suggestions">
                {allTags.map((t) => <option key={t} value={t} />)}
              </datalist>
              <Btn size="sm" onClick={addTag} icon={<Plus size={15} />}>Add</Btn>
            </div>
          </Card>

          {/* Custom fields */}
          {customFields.length > 0 && (
            <Card title="Custom fields">
              <div className="space-y-3">
                {customFields.map((f) => (
                  <div key={f.id}>
                    <label className="text-caption font-semibold uppercase text-ink-3">{f.name}</label>
                    <div className="mt-1 flex gap-2">
                      {f.fieldType === "DROPDOWN" && Array.isArray(f.options) ? (
                        <div className="flex-1 min-w-0">
                          <Select
                            aria-label={f.name}
                            value={cfValues[f.key] ?? ""}
                            onChange={(e) => setCfValues((v) => ({ ...v, [f.key]: e.target.value }))}
                            options={[{ value: "", label: "—" }, ...(f.options as string[]).map((o) => ({ value: o, label: o }))]}
                          />
                        </div>
                      ) : (
                        <input
                          value={cfValues[f.key] ?? ""}
                          onChange={(e) => setCfValues((v) => ({ ...v, [f.key]: e.target.value }))}
                          className="h-9 flex-1 rounded-field border border-line bg-surface px-3 text-sm outline-none focus:border-primary"
                        />
                      )}
                      <Btn size="sm" variant="soft" onClick={() => saveCustomField(f.key)}>Save</Btn>
                    </div>
                  </div>
                ))}
              </div>
            </Card>
          )}
        </div>

        {/* ─── Right: activity / notes / tasks / opportunities ─── */}
        <Card flush>
          <div className="p-6">
            <Tabs
              tabs={[
                { label: `Activity`, content: <Timeline contact={contact} /> },
                { label: `Notes (${contact.noteList.length})`, content: <Notes contact={contact} /> },
                { label: `Tasks (${contact.taskList.filter((t) => t.status === "OPEN").length})`, content: <ContactTasks contact={contact} owners={owners} /> },
                { label: `Opportunities (${contact.opportunities.length})`, content: <Opps contact={contact} /> },
              ]}
            />
          </div>
        </Card>
      </div>

      {/* Edit details modal */}
      <Modal open={editOpen} onClose={() => setEditOpen(false)} title="Edit contact" size="md">
        <form action={saveDetails} className="space-y-4">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Field label="Name"><TextInput kind="name" name="name" required defaultValue={contact.name} /></Field>
            <Field label="Phone / WhatsApp"><TextInput kind="phone" name="phone" required defaultValue={contact.phone ?? ""} /></Field>
            <Field label="Email"><TextInput kind="email" name="email" defaultValue={contact.email ?? ""} /></Field>
            <Field label="Lead source">
              <Select name="leadSource" options={SOURCE_OPTS} defaultValue={SOURCE_OPTS.some((s) => s.value === contact.leadSource) ? contact.leadSource : "OTHER"} />
            </Field>
            <Field label="City"><TextInput kind="city" name="city" defaultValue={contact.city ?? ""} /></Field>
            <Field label="Industry"><TextInput name="industry" defaultValue={contact.industry ?? ""} /></Field>
            <Field label="Company">
              <Select name="companyId" options={[{ value: "", label: "— none —" }, ...companies.map((c) => ({ value: c.id, label: c.name }))]} defaultValue={contact.companyId ?? ""} />
            </Field>
          </div>
          <FormError message={editError} />
          <div className="flex justify-end gap-2 pt-1">
            <Btn variant="ghost" type="button" onClick={() => setEditOpen(false)}>Cancel</Btn>
            <SubmitButton>Save changes</SubmitButton>
          </div>
        </form>
      </Modal>
    </div>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <span className="text-caption font-semibold uppercase text-ink-3">{label}</span>
      <span className="text-right text-ink-2">{children}</span>
    </div>
  );
}

function Timeline({ contact }: { contact: ContactDetail }) {
  if (contact.timeline.length === 0) {
    return <EmptyState icon={<Clock size={20} />} title="No activity yet" body="Notes, calls, messages, stage changes and appointments show up here." />;
  }
  return (
    <ol className="space-y-4">
      {contact.timeline.map((ev) => {
        const Icon = KIND_ICON[ev.kind];
        return (
          <li key={ev.id} className="flex gap-3">
            <span className={`mt-0.5 grid h-8 w-8 flex-none place-items-center rounded-full ${TONE_TEXT[ev.tone]}`}>
              <Icon size={15} />
            </span>
            <div className="min-w-0 flex-1">
              <p className="text-sm font-semibold text-ink">{ev.title}</p>
              {ev.body && <p className="mt-0.5 whitespace-pre-wrap text-sm text-ink-2">{ev.body}</p>}
              <p className="mt-0.5 text-caption text-ink-3">
                <DateText date={ev.at} />
                {ev.authorName && ` · ${ev.authorName}`}
              </p>
            </div>
          </li>
        );
      })}
    </ol>
  );
}

function Notes({ contact }: { contact: ContactDetail }) {
  const ref = useRef<HTMLFormElement>(null);
  const [error, setError] = useState<string | null>(null);
  async function add(fd: FormData) {
    setError(null);
    const res = await createNote(contact.id, fd);
    if (!res.ok) return setError(res.error);
    toast(res.mentionedCount ? `Note added — mentioned ${res.mentionedCount}` : "Note added");
    ref.current?.reset();
  }
  return (
    <div className="space-y-4">
      <form action={add} ref={ref} className="space-y-2">
        <TextArea kind="text" name="body" rows={3} placeholder="Write a note…" />
        <FormError message={error} />
        <div className="flex justify-end"><SubmitButton>Add note</SubmitButton></div>
      </form>
      <div className="space-y-3">
        {contact.noteList.length === 0 && <p className="text-sm text-ink-3">No notes yet.</p>}
        {contact.noteList.map((n) => (
          <div key={n.id} className="rounded-field border border-line bg-surface-2 p-3">
            <p className="whitespace-pre-wrap text-sm text-ink">{n.body}</p>
            <div className="mt-2 flex items-center justify-between">
              <span className="text-caption text-ink-3">
                {n.authorName ?? "—"} · <DateText date={n.createdAt} />
              </span>
              <div className="flex items-center gap-1">
                {n.pinned && <Pill tone="warn">Pinned</Pill>}
                <IconButton label="Pin note" onClick={async () => { const r = await toggleNotePin(n.id); if (r.ok) toast(n.pinned ? "Unpinned" : "Pinned"); }}>
                  <Pin size={14} />
                </IconButton>
                <IconButton label="Delete note" onClick={async () => { if (await askConfirm({ title: "Delete note?", danger: true })) { const r = await deleteNote(n.id); if (r.ok) toast("Note deleted"); } }}>
                  <Trash2 size={14} />
                </IconButton>
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function ContactTasks({ contact, owners }: { contact: ContactDetail; owners: { id: string; name: string }[] }) {
  const ref = useRef<HTMLFormElement>(null);
  const [error, setError] = useState<string | null>(null);
  const ownerOpts = [{ value: "", label: "— unassigned —" }, ...owners.map((o) => ({ value: o.id, label: o.name }))];
  async function add(fd: FormData) {
    setError(null);
    fd.set("leadId", contact.id);
    const res = await createTask(fd);
    if (!res.ok) return setError(res.error);
    toast("Task added");
    ref.current?.reset();
  }
  return (
    <div className="space-y-4">
      <form action={add} ref={ref} className="space-y-2">
        <TextInput name="title" required placeholder="Task title" />
        <div className="grid grid-cols-2 gap-2">
          <TextInput name="dueAt" type="datetime-local" />
          <Select name="assignedToId" options={ownerOpts} defaultValue="" />
        </div>
        <FormError message={error} />
        <div className="flex justify-end"><SubmitButton>Add task</SubmitButton></div>
      </form>
      <div className="space-y-2">
        {contact.taskList.length === 0 && <p className="text-sm text-ink-3">No tasks yet.</p>}
        {contact.taskList.map((t) => (
          <div key={t.id} className="flex items-center gap-3 rounded-field border border-line p-3">
            <input type="checkbox" checked={t.status === "COMPLETED"} onChange={async () => { const r = await toggleTask(t.id); if (r.ok) toast("Updated"); }} className="h-4 w-4 accent-[var(--primary)]" />
            <div className="min-w-0 flex-1">
              <p className={`text-sm font-semibold ${t.status === "COMPLETED" ? "text-ink-3 line-through" : "text-ink"}`}>{t.title}</p>
              <p className="text-caption text-ink-3">
                {t.dueAt ? <>Due <DateText date={t.dueAt} /></> : "No due date"}
                {t.assigneeName && ` · ${t.assigneeName}`}
              </p>
            </div>
            <IconButton label="Delete task" onClick={async () => { if (await askConfirm({ title: "Delete task?", danger: true })) { const r = await deleteTask(t.id); if (r.ok) toast("Deleted"); } }}>
              <Trash2 size={14} />
            </IconButton>
          </div>
        ))}
      </div>
    </div>
  );
}

function Opps({ contact }: { contact: ContactDetail }) {
  if (contact.opportunities.length === 0) {
    return <EmptyState icon={<GitBranch size={20} />} title="No opportunities" body="Create a deal for this contact on the Opportunities board." action={<Link href="/opportunities"><Btn>Go to board</Btn></Link>} />;
  }
  return (
    <div className="space-y-2">
      {contact.opportunities.map((o) => (
        <Link key={o.id} href="/opportunities" className="flex items-center justify-between rounded-field border border-line p-3 hover:bg-surface-2">
          <div>
            <p className="text-sm font-semibold text-ink">{o.name}</p>
            <p className="text-caption text-ink-3">{o.pipelineName} · {o.stageName}</p>
          </div>
          <div className="text-right">
            <p className="text-sm font-semibold text-ink">{o.valueDisplay}</p>
            <Pill tone={o.status === "WON" ? "good" : o.status === "LOST" || o.status === "ABANDONED" ? "bad" : "info"}>{o.status}</Pill>
          </div>
        </Link>
      ))}
    </div>
  );
}
