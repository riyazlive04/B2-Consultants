"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { CalendarClock, CalendarPlus, ExternalLink, Pencil, Trash2 } from "lucide-react";
import { deleteGnEvent, scheduleGnEvent, updateGnEvent } from "@/server/german-note-actions";
import type { GnEventRow } from "@/server/german-note-metrics";
import { askConfirm, toast } from "@/components/ui/feedback";
import { Btn, IconButton } from "@/components/ui/controls";
import { Field, FormError, Select, SubmitButton, TextArea, TextInput } from "@/components/ui/form";
import { Modal } from "@/components/ui/Modal";
import { formatDateTimeInZone } from "@/lib/format";

/** Calendar of scheduled live classes: upcoming (with join link) + past; tutor/admin manage. */

function toLocalInput(iso: string): string {
  const d = new Date(iso);
  const local = new Date(d.getTime() - d.getTimezoneOffset() * 60000);
  return local.toISOString().slice(0, 16);
}

const EVENT_TYPE_OPTIONS = [
  { value: "LIVE_CLASS", label: "Live class" },
  { value: "KICKOFF", label: "Kickoff / onboarding" },
  { value: "COACHING", label: "Coaching" },
  { value: "LINKEDIN", label: "LinkedIn session" },
  { value: "QA", label: "Q&A" },
  { value: "OPEN_MARKET", label: "Open-market strategy" },
  { value: "OTHER", label: "Other" },
];

function EventFields({ event }: { event?: GnEventRow }) {
  return (
    <div className="space-y-4">
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Class title">
          <TextInput name="title" required maxLength={160} placeholder="A1 · Class 13 — Modalverben" defaultValue={event?.title} />
        </Field>
        <Field label="Session type">
          <Select name="type" options={EVENT_TYPE_OPTIONS} defaultValue={event?.type ?? "LIVE_CLASS"} />
        </Field>
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Starts at">
          <TextInput name="startsAt" type="datetime-local" required defaultValue={event ? toLocalInput(event.startsAt) : ""} />
        </Field>
        <Field label="Duration (minutes)" hint="Optional">
          <TextInput name="durationMins" inputMode="numeric" pattern="\d*" maxLength={4} placeholder="90" defaultValue={event?.durationMins ?? undefined} />
        </Field>
      </div>
      <Field label="Join link" hint="Zoom / Google Meet link students click to join the live class.">
        <TextInput name="joinUrl" type="url" placeholder="https://zoom.us/j/…" defaultValue={event?.joinUrl ?? undefined} />
      </Field>
      <Field label="Notes (optional)">
        <TextArea name="notes" maxLength={1000} placeholder="What to prepare, chapter, etc." defaultValue={event?.notes ?? undefined} />
      </Field>
    </div>
  );
}

function EventCard({ e, canManage, onEdit, onChanged }: {
  e: GnEventRow; canManage: boolean; onEdit: (e: GnEventRow) => void; onChanged: () => void;
}) {
  return (
    <div className={`rounded-card border bg-surface p-4 shadow-card ${e.isPast ? "opacity-70" : "border-[var(--lvl-gn)]"} ${e.isPast ? "border-line" : ""}`}>
      <div className="flex flex-wrap items-center gap-2">
        <CalendarClock size={15} className="text-[var(--lvl-gn)]" />
        <h4 className="font-display text-[15px] font-semibold">{e.title}</h4>
        {!e.isPast && <span className="rounded-full bg-lvl-gn/10 px-2 py-0.5 text-caption font-semibold text-ink">Upcoming</span>}
        {canManage && (
          <span className="ml-auto flex items-center gap-1.5">
            <button type="button" aria-label="Edit class" className="grid h-7 w-7 place-items-center rounded-field text-muted hover:bg-ink/5 hover:text-ink" onClick={() => onEdit(e)}>
              <Pencil size={13} />
            </button>
            <button type="button" aria-label="Delete class" className="grid h-7 w-7 place-items-center rounded-field text-muted hover:bg-risk-soft hover:text-risk"
              onClick={async () => {
                const ok = await askConfirm({ title: `Delete “${e.title}”?`, confirmLabel: "Delete", danger: true });
                if (!ok) return;
                const r = await deleteGnEvent(e.id);
                if (!r.ok) return toast(r.error, "error");
                toast("Class removed");
                onChanged();
              }}>
              <Trash2 size={13} />
            </button>
          </span>
        )}
      </div>
      <p className="mt-1 text-sm text-ink-2">
        {formatDateTimeInZone(e.startsAt, "Asia/Kolkata")} IST{e.durationMins ? ` · ${e.durationMins} min` : ""}
      </p>
      {e.notes && <p className="mt-1 whitespace-pre-wrap text-sm text-muted">{e.notes}</p>}
      {!e.isPast && e.joinUrl && (
        <a href={e.joinUrl} target="_blank" rel="noopener noreferrer"
          className="mt-3 inline-flex items-center gap-1.5 rounded-btn bg-[var(--lvl-gn)] px-3 py-1.5 text-sm font-semibold text-ink hover:opacity-90">
          <ExternalLink size={14} /> Join class
        </a>
      )}
    </div>
  );
}

export function SchedulePanel({ batchId, events, canManage }: { batchId: string; events: GnEventRow[]; canManage: boolean }) {
  const router = useRouter();
  const [, startTransition] = useTransition();
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState<GnEventRow | null>(null);
  const [error, setError] = useState<string | null>(null);
  const addRef = useRef<HTMLFormElement>(null);

  const refresh = () => startTransition(() => router.refresh());
  const upcoming = events.filter((e) => !e.isPast);
  const past = events.filter((e) => e.isPast).reverse();

  return (
    <div className="space-y-4">
      {canManage && (
        <div>
          <button type="button" className="inline-flex items-center gap-1.5 rounded-btn bg-primary px-3 py-1.5 text-sm font-semibold text-on-accent hover:bg-primary-strong"
            onClick={() => { setAdding((v) => !v); setError(null); }}>
            <CalendarPlus size={15} /> {adding ? "Close" : "Schedule class"}
          </button>
          {adding && (
            <form ref={addRef} className="mt-3 rounded-card border border-line bg-surface p-4 shadow-card"
              action={async (form) => {
                setError(null);
                const r = await scheduleGnEvent(batchId, form);
                if (!r.ok) return setError(r.error);
                addRef.current?.reset();
                setAdding(false);
                toast("Class scheduled");
                refresh();
              }}>
              <EventFields />
              <div className="mt-4 flex items-center justify-between gap-3">
                <FormError message={error} />
                <span className="ml-auto"><SubmitButton>Schedule</SubmitButton></span>
              </div>
            </form>
          )}
        </div>
      )}

      {events.length === 0 && (
        <p className="rounded-card border border-dashed border-line bg-surface-2 px-4 py-8 text-center text-sm text-muted">
          No classes scheduled{canManage ? " — schedule the next live class above." : " yet — your tutor will post the schedule here."}
        </p>
      )}

      {upcoming.length > 0 && (
        <div className="space-y-2">
          <p className="text-xs font-semibold uppercase tracking-wide text-muted">Upcoming</p>
          {upcoming.map((e) => <EventCard key={e.id} e={e} canManage={canManage} onEdit={(ev) => { setEditing(ev); setError(null); }} onChanged={refresh} />)}
        </div>
      )}
      {past.length > 0 && (
        <div className="space-y-2">
          <p className="text-xs font-semibold uppercase tracking-wide text-muted">Past</p>
          {past.map((e) => <EventCard key={e.id} e={e} canManage={canManage} onEdit={(ev) => { setEditing(ev); setError(null); }} onChanged={refresh} />)}
        </div>
      )}

      <Modal open={editing !== null} onClose={() => setEditing(null)} title="Edit class" size="md">
        {editing && (
          <form action={async (form) => {
            setError(null);
            const r = await updateGnEvent(editing.id, form);
            if (!r.ok) return setError(r.error);
            setEditing(null);
            toast("Class updated");
            refresh();
          }}>
            <EventFields event={editing} />
            <div className="mt-4 flex items-center justify-between gap-3">
              <FormError message={error} />
              <span className="ml-auto"><SubmitButton>Save changes</SubmitButton></span>
            </div>
          </form>
        )}
      </Modal>
    </div>
  );
}
