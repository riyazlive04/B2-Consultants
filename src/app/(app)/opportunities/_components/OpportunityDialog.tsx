"use client";

import { useEffect, useState, type ReactNode } from "react";
import Link from "next/link";
import { CalendarCheck, CheckSquare, ExternalLink, FileText, Plus, Square, StickyNote, Trash2, User } from "lucide-react";
import { Btn } from "@/components/ui/controls";
import { Modal } from "@/components/ui/Modal";
import { Field, TextInput, Select, SubmitButton, FormError } from "@/components/ui/form";
import { toast } from "@/components/ui/feedback";
import { DateText } from "@/components/ui/DateText";
import { Pill } from "@/components/ui/kit";
import { formatDateTimeInZone } from "@/lib/format";
import { getOpportunityDetail, updateOpportunityContact, type OpportunityDetail } from "@/server/opportunities-actions";
import { createTask, toggleTask } from "@/server/contacts-actions";

/**
 * The "Edit opportunity" dialog, laid out like Synamate's: a left rail of sections, the contact
 * behind the deal FIRST (name, email, phone - the things someone opening a card actually wants),
 * then the deal's own fields, with the audit stamps in the footer.
 *
 * The board card carries only what a column needs, so the rest is fetched on open. Until it
 * arrives the form renders from the card (name, stage, value…) so the dialog is never blank.
 */

type Opt = { value: string; label: string };
type Section = "details" | "appointments" | "tasks" | "notes";

const NAV: { key: Section; label: string; icon: ReactNode }[] = [
  { key: "details", label: "Opportunity details", icon: <FileText size={14} /> },
  { key: "appointments", label: "Appointments", icon: <CalendarCheck size={14} /> },
  { key: "tasks", label: "Tasks", icon: <CheckSquare size={14} /> },
  { key: "notes", label: "Notes", icon: <StickyNote size={14} /> },
];

const STATUS_OPTS: Opt[] = [
  { value: "OPEN", label: "Open" },
  { value: "WON", label: "Won" },
  { value: "LOST", label: "Lost" },
  { value: "ABANDONED", label: "Abandoned" },
];

export function OpportunityDialog({
  card,
  stageOpts,
  ownerOpts,
  sourceOpts,
  error,
  onSave,
  onDelete,
  onClose,
  notesPanel,
}: {
  card: { id: string; name: string; stageId: string; valueInr: string; source: string | null; ownerId: string | null; status: string; contactId: string; contactName: string; contactPhone: string | null } | null;
  stageOpts: Opt[];
  ownerOpts: Opt[];
  sourceOpts: Opt[];
  error: string | null;
  /** Saves the DEAL fields (the existing board flow, incl. the stage move). */
  onSave: (fd: FormData) => Promise<void>;
  onDelete: () => void;
  onClose: () => void;
  notesPanel: ReactNode;
}) {
  const [section, setSection] = useState<Section>("details");
  const [detail, setDetail] = useState<OpportunityDetail | null>(null);
  const [contactError, setContactError] = useState<string | null>(null);

  // Reset and reload whenever a different card opens.
  useEffect(() => {
    setSection("details");
    setDetail(null);
    setContactError(null);
    if (!card) return;
    let live = true;
    getOpportunityDetail(card.id).then((d) => { if (live) setDetail(d); });
    return () => { live = false; };
  }, [card?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const reload = () => { if (card) getOpportunityDetail(card.id).then(setDetail); };

  async function save(fd: FormData) {
    if (!card) return;
    setContactError(null);
    // The contact lives on the Lead, the deal on the Opportunity - two rows, two actions. The
    // contact is saved first so a failed deal save (e.g. a refused stage move) never leaves a
    // corrected phone number unsaved.
    const contactFd = new FormData();
    contactFd.set("name", String(fd.get("contactName") ?? ""));
    contactFd.set("phone", String(fd.get("contactPhone") ?? ""));
    contactFd.set("email", String(fd.get("contactEmail") ?? ""));
    const c = await updateOpportunityContact(card.contactId, contactFd);
    if (!c.ok) return setContactError(c.error);
    for (const k of ["contactName", "contactPhone", "contactEmail"]) fd.delete(k);
    await onSave(fd);
  }

  const contact = detail?.contact;

  return (
    <Modal open={!!card} onClose={onClose} title={card ? `Edit "${card.name}"` : "Edit opportunity"} subtitle="Contact, deal, appointments, tasks and notes in one place." size="lg">
      {card && (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-[180px_1fr]">
          {/* ── Left rail ── */}
          <nav className="flex gap-1 overflow-x-auto sm:flex-col" aria-label="Opportunity sections">
            {NAV.map((n) => (
              <button
                key={n.key}
                type="button"
                onClick={() => setSection(n.key)}
                className={`flex flex-none items-center gap-2 rounded-field px-3 py-2 text-left text-sm ${
                  section === n.key ? "bg-primary-soft font-semibold text-primary-strong" : "text-ink-2 hover:bg-surface-2"
                }`}
              >
                {n.icon} {n.label}
              </button>
            ))}
            <Link
              href={`/contacts/${card.contactId}`}
              className="mt-2 hidden items-center gap-2 rounded-field px-3 py-2 text-sm text-ink-2 hover:bg-surface-2 sm:flex"
            >
              <User size={14} /> Open contact record
            </Link>
          </nav>

          {/* ── Content ── */}
          <div className="min-w-0">
            {section === "details" && (
              <form action={save} key={card.id} className="space-y-5">
                <section>
                  <h3 className="mb-3 flex items-center gap-2 text-sm font-semibold text-ink">
                    Contact details
                    {detail?.contact.tags.length ? (
                      <span className="flex flex-wrap gap-1">
                        {detail.contact.tags.map((t) => <Pill key={t} tone="neutral">{t}</Pill>)}
                      </span>
                    ) : null}
                  </h3>
                  <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                    <Field label="Primary contact name">
                      <TextInput kind="text" name="contactName" required defaultValue={contact?.name ?? card.contactName} />
                    </Field>
                    <Field label="Primary email">
                      <TextInput kind="text" name="contactEmail" defaultValue={contact?.email ?? ""} placeholder={detail && !contact?.email ? "No email on file" : "Loading…"} />
                    </Field>
                    <Field label="Primary phone">
                      <TextInput kind="text" name="contactPhone" defaultValue={contact?.phone ?? card.contactPhone ?? ""} placeholder="+91…" />
                    </Field>
                    <div className="text-sm">
                      <span className="mb-1 block text-caption font-semibold uppercase tracking-wide text-ink-3">Contact since</span>
                      <span className="text-ink-2">
                        {detail ? <DateText date={detail.contact.createdAt} /> : "…"}
                        {detail?.contact.enteredByName ? ` · entered by ${detail.contact.enteredByName}` : ""}
                        {detail?.contact.companyName ? ` · ${detail.contact.companyName}` : ""}
                        {detail?.contact.city ? ` · ${detail.contact.city}` : ""}
                      </span>
                    </div>
                  </div>
                  <FormError message={contactError} />
                </section>

                <section>
                  <h3 className="mb-3 text-sm font-semibold text-ink">Opportunity details</h3>
                  <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                    <Field label="Opportunity name"><TextInput kind="text" name="name" required defaultValue={card.name} /></Field>
                    <Field label="Value (₹)"><TextInput kind="money" name="valueInr" defaultValue={card.valueInr.replace(/[^\d.]/g, "")} /></Field>
                    <Field label="Pipeline">
                      <input className="h-10 w-full rounded-field border border-line bg-surface-2 px-3 text-sm text-ink-3" value={detail?.pipelineName ?? "…"} readOnly tabIndex={-1} />
                    </Field>
                    <Field label="Stage"><Select name="stageId" options={stageOpts} defaultValue={card.stageId} /></Field>
                    <Field label="Status"><Select name="status" options={STATUS_OPTS} defaultValue={card.status} /></Field>
                    <Field label="Owner"><Select name="assignedToId" options={ownerOpts} defaultValue={card.ownerId ?? ""} /></Field>
                    <Field label="Source"><Select name="source" options={sourceOpts} defaultValue={card.source ?? ""} /></Field>
                    {detail?.lostReason && (
                      <Field label="Lost reason">
                        <input className="h-10 w-full rounded-field border border-line bg-surface-2 px-3 text-sm text-ink-3" value={detail.lostReason} readOnly tabIndex={-1} />
                      </Field>
                    )}
                  </div>
                </section>

                <FormError message={error} />

                <div className="flex flex-wrap items-center justify-between gap-3 border-t border-line pt-3">
                  <p className="text-caption text-ink-3">
                    {detail ? (
                      <>
                        Created <DateText date={detail.createdAt} /> · Updated <DateText date={detail.updatedAt} />
                      </>
                    ) : "…"}
                  </p>
                  <div className="flex gap-2">
                    <Btn variant="danger" type="button" icon={<Trash2 size={15} />} onClick={onDelete}>Delete</Btn>
                    <Btn variant="ghost" type="button" onClick={onClose}>Cancel</Btn>
                    <SubmitButton>Update</SubmitButton>
                  </div>
                </div>
              </form>
            )}

            {section === "appointments" && (
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <h3 className="text-sm font-semibold text-ink">Appointments</h3>
                  <a href="/book" target="_blank" rel="noreferrer">
                    <Btn size="sm" variant="outline" icon={<ExternalLink size={13} />}>Booking page</Btn>
                  </a>
                </div>
                {!detail ? (
                  <p className="text-sm text-ink-3">Loading…</p>
                ) : detail.appointments.length === 0 ? (
                  <p className="rounded-field border border-dashed border-line px-3 py-6 text-center text-sm text-ink-3">
                    No calls booked for this contact yet.
                  </p>
                ) : (
                  <ul className="divide-y divide-line rounded-field border border-line">
                    {detail.appointments.map((a) => (
                      <li key={a.id} className="flex items-center justify-between gap-3 px-3 py-2 text-sm">
                        <span className="text-ink">
                          {a.startsAt ? formatDateTimeInZone(a.startsAt, "Asia/Kolkata") : "No slot"}
                          <span className="block text-caption text-ink-3">Requested <DateText date={a.createdAt} /></span>
                        </span>
                        <span className="flex items-center gap-1.5">
                          {a.confirmed && <Pill tone="good">Confirmed</Pill>}
                          <Pill tone={a.status === "BOOKED" ? "good" : a.status === "CANCELLED" ? "bad" : "neutral"}>{a.status.toLowerCase()}</Pill>
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
                <p className="text-caption text-ink-3">
                  Manage slots and reschedules in <Link href="/bookings" className="text-primary hover:underline">Bookings</Link>.
                </p>
              </div>
            )}

            {section === "tasks" && (
              <TasksPanel leadId={card.contactId} tasks={detail?.tasks ?? null} onChanged={reload} />
            )}

            {section === "notes" && notesPanel}
          </div>
        </div>
      )}
    </Modal>
  );
}

function TasksPanel({
  leadId,
  tasks,
  onChanged,
}: {
  leadId: string;
  tasks: OpportunityDetail["tasks"] | null;
  onChanged: () => void;
}) {
  const [err, setErr] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  async function add(fd: FormData) {
    setErr(null);
    fd.set("leadId", leadId);
    const res = await createTask(fd);
    if (!res.ok) return setErr(res.error);
    toast("Task added");
    onChanged();
  }

  return (
    <div className="space-y-3">
      <h3 className="text-sm font-semibold text-ink">Tasks</h3>
      <form action={add} className="flex flex-wrap gap-2 rounded-field border border-line p-3">
        <input name="title" required placeholder="What needs doing?" className="h-9 min-w-0 flex-1 rounded-field border border-line bg-surface px-3 text-sm outline-none focus:border-primary" />
        <input name="dueAt" type="datetime-local" className="h-9 rounded-field border border-line bg-surface px-2 text-sm outline-none focus:border-primary" />
        <Btn size="sm" variant="primary" type="submit" icon={<Plus size={14} />}>Add</Btn>
        <FormError message={err} />
      </form>
      {!tasks ? (
        <p className="text-sm text-ink-3">Loading…</p>
      ) : tasks.length === 0 ? (
        <p className="rounded-field border border-dashed border-line px-3 py-6 text-center text-sm text-ink-3">No tasks yet.</p>
      ) : (
        <ul className="divide-y divide-line rounded-field border border-line">
          {tasks.map((t) => (
            <li key={t.id} className="flex items-center gap-3 px-3 py-2 text-sm">
              <button
                type="button"
                aria-label={t.done ? "Reopen task" : "Complete task"}
                disabled={busyId === t.id}
                onClick={async () => {
                  setBusyId(t.id);
                  const res = await toggleTask(t.id);
                  setBusyId(null);
                  if (!res.ok) return toast(res.error, "error");
                  onChanged();
                }}
                className="text-ink-2 hover:text-primary disabled:opacity-50"
              >
                {t.done ? <CheckSquare size={16} /> : <Square size={16} />}
              </button>
              <span className={`min-w-0 flex-1 ${t.done ? "text-ink-3 line-through" : "text-ink"}`}>
                {t.title}
                <span className="block text-caption text-ink-3">
                  {t.dueAt ? <>Due <DateText date={t.dueAt} /></> : "No due date"}
                  {t.assigneeName ? ` · ${t.assigneeName}` : ""}
                </span>
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
