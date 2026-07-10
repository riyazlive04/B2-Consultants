"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Pencil, Plus, Trash2, Users, Video } from "lucide-react";
import { createBatch, deleteBatch, updateBatch } from "@/server/german-note-actions";
import type { GnManageBatch, GnTutorRow } from "@/server/german-note-metrics";
import { askConfirm, toast } from "@/components/ui/feedback";
import { Field, FormError, Select, SubmitButton, TextArea, TextInput } from "@/components/ui/form";
import { Modal } from "@/components/ui/Modal";
import { LevelChip, StatusChip } from "./LevelChip";

const LEVEL_OPTIONS = [
  { value: "GN_A1", label: "GN A1" },
  { value: "GN_A2", label: "GN A2" },
  { value: "GN_B1", label: "GN B1" },
  { value: "GN_B2", label: "GN B2" },
];

function BatchFields({ batch, tutors }: { batch?: GnManageBatch; tutors: GnTutorRow[] }) {
  const tutorOptions = [
    { value: "", label: "No tutor assigned yet" },
    ...tutors.map((t) => ({ value: t.id, label: `${t.name} (${t.email})` })),
  ];
  return (
    <div className="space-y-4">
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Batch name">
          <TextInput name="name" required maxLength={120} placeholder="A1 Evening — July 2026" defaultValue={batch?.name} />
        </Field>
        <Field label="Level">
          <Select name="level" options={LEVEL_OPTIONS} defaultValue={batch?.level ?? "GN_A1"} />
        </Field>
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Tutor" hint="Create tutor accounts in the Tutors tab first.">
          <Select name="tutorId" options={tutorOptions} defaultValue={batch?.tutorId ?? ""} />
        </Field>
        {batch && (
          <Field label="Status" hint="Archived batches keep recordings readable but close their discussion.">
            <Select
              name="status"
              options={[
                { value: "ACTIVE", label: "Active" },
                { value: "ARCHIVED", label: "Archived" },
              ]}
              defaultValue={batch.status}
            />
          </Field>
        )}
      </div>
      <Field label="Notes (optional)">
        <TextArea name="notes" maxLength={2000} defaultValue={batch?.notes ?? undefined} placeholder="Schedule, Zoom link, track…" />
      </Field>
    </div>
  );
}

export function BatchesPanel({ batches, tutors }: { batches: GnManageBatch[]; tutors: GnTutorRow[] }) {
  const router = useRouter();
  const [, startTransition] = useTransition();
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<GnManageBatch | null>(null);
  const [error, setError] = useState<string | null>(null);

  const refresh = () => startTransition(() => router.refresh());

  return (
    <section className="space-y-5">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h3 className="font-display text-lg font-semibold">Batches</h3>
          <p className="text-xs text-muted">One batch = one cohort with a tutor, its recordings and its own discussion.</p>
        </div>
        <button
          type="button"
          className="inline-flex items-center gap-1.5 rounded-btn bg-primary px-3 py-1.5 text-sm font-semibold text-white hover:bg-primary-strong"
          onClick={() => { setCreating((v) => !v); setError(null); }}
        >
          <Plus size={15} /> {creating ? "Close" : "Create batch"}
        </button>
      </div>

      {creating && (
        <form
          className="rounded-card border border-line bg-surface p-4 shadow-card"
          action={async (form) => {
            setError(null);
            const res = await createBatch(form);
            if (!res.ok) return setError(res.error);
            setCreating(false);
            toast("Batch created");
            refresh();
          }}
        >
          <BatchFields tutors={tutors} />
          <div className="mt-4 flex items-center justify-between gap-3">
            <FormError message={error} />
            <span className="ml-auto"><SubmitButton>Create batch</SubmitButton></span>
          </div>
        </form>
      )}

      {batches.length === 0 && !creating && (
        <p className="rounded-card border border-dashed border-line bg-surface-2 px-4 py-8 text-center text-sm text-muted">
          No batches yet — create the first cohort above.
        </p>
      )}

      <div className="space-y-2.5">
        {batches.map((b) => (
          <div key={b.id} className="flex flex-wrap items-center gap-3 rounded-card border border-line bg-surface px-4 py-3 shadow-card">
            <div className="min-w-[220px] flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <Link href={`/german-note/${b.id}`} className="text-sm font-semibold text-accent hover:underline">
                  {b.name}
                </Link>
                <LevelChip level={b.level} />
                <StatusChip status={b.status} />
              </div>
              <p className="mt-0.5 text-xs text-muted">
                {b.tutorName ? `Tutor: ${b.tutorName}` : "No tutor assigned"}
              </p>
            </div>
            <span className="inline-flex items-center gap-1 text-xs text-muted"><Users size={13} /> {b.memberCount}</span>
            <span className="inline-flex items-center gap-1 text-xs text-muted"><Video size={13} /> {b.recordingCount}</span>
            <button
              type="button"
              aria-label={`Edit ${b.name}`}
              className="grid h-8 w-8 place-items-center rounded-field text-muted hover:bg-ink/5 hover:text-ink"
              onClick={() => { setEditing(b); setError(null); }}
            >
              <Pencil size={15} />
            </button>
            <button
              type="button"
              aria-label={`Delete ${b.name}`}
              className="grid h-8 w-8 place-items-center rounded-field text-muted hover:bg-risk-soft hover:text-risk"
              onClick={async () => {
                const ok = await askConfirm({
                  title: `Delete “${b.name}”?`,
                  body: "Members, recordings and the batch discussion are removed permanently. Prefer Archive (edit → status) to close a finished batch.",
                  confirmLabel: "Delete forever",
                  danger: true,
                });
                if (!ok) return;
                const res = await deleteBatch(b.id);
                if (!res.ok) return toast(res.error, "error");
                toast("Batch deleted");
                refresh();
              }}
            >
              <Trash2 size={15} />
            </button>
          </div>
        ))}
      </div>

      <Modal open={editing !== null} onClose={() => setEditing(null)} title="Edit batch" size="md">
        {editing && (
          <form
            action={async (form) => {
              setError(null);
              const res = await updateBatch(editing.id, form);
              if (!res.ok) return setError(res.error);
              setEditing(null);
              toast("Batch updated");
              refresh();
            }}
          >
            <BatchFields batch={editing} tutors={tutors} />
            <div className="mt-4 flex items-center justify-between gap-3">
              <FormError message={error} />
              <span className="ml-auto"><SubmitButton>Save changes</SubmitButton></span>
            </div>
          </form>
        )}
      </Modal>
    </section>
  );
}
