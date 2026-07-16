"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  ChevronDown, ChevronUp, CheckCircle2, Circle, ExternalLink, FolderPlus, Layers,
  Pencil, Plus, Settings2, Trash2, Video,
} from "lucide-react";
import {
  createGnModule, deleteGnModule, deleteRecording, postRecording, renameGnModule,
  reorderGnModule, toggleRecordingWatched, updateRecording,
} from "@/server/german-note-actions";
import type { GnModuleRow, GnRecordingRow, GnSection } from "@/server/german-note-metrics";
import { parseVideoUrl, VIDEO_PROVIDER_LABELS } from "@/lib/video-embed";
import { askConfirm, toast } from "@/components/ui/feedback";
import { Btn, IconButton } from "@/components/ui/controls";
import { Field, FormError, Select, SubmitButton, TextArea, TextInput } from "@/components/ui/form";
import { Modal } from "@/components/ui/Modal";
import { formatDate, formatPct } from "@/lib/format";
import { toDateInputValue } from "@/lib/dates";

/** Structured Classroom: recordings grouped into ordered modules, with course + per-module progress. */

function UrlField({ defaultValue }: { defaultValue?: string }) {
  const [url, setUrl] = useState(defaultValue ?? "");
  const parsed = url.trim() ? parseVideoUrl(url) : null;
  return (
    <Field
      label="Video link"
      hint={
        url.trim()
          ? parsed
            ? `✓ Recognised as ${VIDEO_PROVIDER_LABELS[parsed.provider]}`
            : "Not a recognisable Fathom / YouTube / Vimeo / Google Drive link — for Fathom, use “Copy share link”"
          : "Paste the Fathom share link from the recorded class. YouTube / Vimeo / Drive links work too."
      }
    >
      <TextInput name="videoUrl" type="url" required placeholder="https://fathom.video/share/…" value={url} onChange={(e) => setUrl(e.target.value)} />
    </Field>
  );
}

function RecordingFields({ recording, modules }: { recording?: GnRecordingRow; modules: GnModuleRow[] }) {
  return (
    <div className="space-y-4">
      <Field label="Title">
        <TextInput name="title" required maxLength={160} placeholder="Class 12 — Dativ prepositions" defaultValue={recording?.title} />
      </Field>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Class date">
          <TextInput name="classDate" type="date" required defaultValue={recording ? recording.classDate.slice(0, 10) : toDateInputValue(new Date())} />
        </Field>
        <UrlField defaultValue={recording?.videoUrl} />
      </div>
      {modules.length > 0 && (
        <Field label="Module" hint="Group this lesson into a classroom module (optional).">
          <Select
            name="moduleId"
            defaultValue={recording?.moduleId ?? ""}
            options={[{ value: "", label: "Class recordings (no module)" }, ...modules.map((m) => ({ value: m.id, label: m.title }))]}
          />
        </Field>
      )}
      <Field label="Notes (optional)" hint="Homework, chapter covered, links mentioned in class…">
        <TextArea name="notes" maxLength={2000} defaultValue={recording?.notes ?? undefined} />
      </Field>
    </div>
  );
}

function ModuleManager({ batchId, modules, onChanged }: { batchId: string; modules: GnModuleRow[]; onChanged: () => void }) {
  const [error, setError] = useState<string | null>(null);
  const [renaming, setRenaming] = useState<GnModuleRow | null>(null);
  const addRef = useRef<HTMLFormElement>(null);

  return (
    <div className="rounded-card border border-line bg-surface p-4 shadow-card">
      <h4 className="flex items-center gap-2 font-display text-[15px] font-semibold">
        <Layers size={15} className="text-[var(--lvl-gn)]" /> Modules
      </h4>
      <p className="mt-0.5 text-xs text-muted">Organise lessons into an ordered curriculum. Reorder with the arrows.</p>

      <div className="mt-3 space-y-2">
        {modules.length === 0 && <p className="text-xs text-muted">No modules yet — add one below, then file recordings into it.</p>}
        {modules.map((m, i) => (
          <div key={m.id} className="flex items-center gap-2 rounded-field border border-line bg-surface-2 px-3 py-2">
            <span className="flex flex-col">
              <button type="button" aria-label="Move up" disabled={i === 0} className="text-muted hover:text-ink disabled:opacity-30"
                onClick={async () => { const r = await reorderGnModule(m.id, "up"); if (!r.ok) return toast(r.error, "error"); onChanged(); }}>
                <ChevronUp size={14} />
              </button>
              <button type="button" aria-label="Move down" disabled={i === modules.length - 1} className="text-muted hover:text-ink disabled:opacity-30"
                onClick={async () => { const r = await reorderGnModule(m.id, "down"); if (!r.ok) return toast(r.error, "error"); onChanged(); }}>
                <ChevronDown size={14} />
              </button>
            </span>
            <span className="flex-1 truncate text-sm font-medium">{m.title}</span>
            <button type="button" aria-label="Rename module" className="text-muted hover:text-ink" onClick={() => setRenaming(m)}>
              <Pencil size={14} />
            </button>
            <button type="button" aria-label="Delete module" className="text-muted hover:text-risk"
              onClick={async () => {
                const ok = await askConfirm({ title: `Delete module “${m.title}”?`, body: "Its lessons move to the default Class recordings section — they aren't deleted.", confirmLabel: "Delete module", danger: true });
                if (!ok) return;
                const r = await deleteGnModule(m.id);
                if (!r.ok) return toast(r.error, "error");
                toast("Module deleted");
                onChanged();
              }}>
              <Trash2 size={14} />
            </button>
          </div>
        ))}
      </div>

      <form ref={addRef} className="mt-3 flex items-start gap-2"
        action={async (form) => {
          setError(null);
          const r = await createGnModule(batchId, form);
          if (!r.ok) return setError(r.error);
          addRef.current?.reset();
          onChanged();
        }}>
        <div className="flex-1">
          <TextInput name="title" required maxLength={120} placeholder="New module title (e.g. A1 · Grammar)" />
          <FormError message={error} />
        </div>
        <button type="submit" className="inline-flex h-10 items-center gap-1.5 rounded-btn border border-line-strong px-3 text-sm font-semibold text-ink-2 hover:bg-surface-2">
          <FolderPlus size={15} /> Add
        </button>
      </form>

      <Modal open={renaming !== null} onClose={() => setRenaming(null)} title="Rename module" size="sm">
        {renaming && (
          <form action={async (form) => { const r = await renameGnModule(renaming.id, form); if (!r.ok) return setError(r.error); setRenaming(null); onChanged(); }} className="space-y-3">
            <Field label="Module title"><TextInput name="title" required maxLength={120} defaultValue={renaming.title} /></Field>
            <div className="flex justify-end"><SubmitButton>Save</SubmitButton></div>
          </form>
        )}
      </Modal>
    </div>
  );
}

function LessonCard({ r, index, canManage, onEdit, onChanged }: {
  r: GnRecordingRow; index: number; canManage: boolean; onEdit: (r: GnRecordingRow) => void; onChanged: () => void;
}) {
  return (
    <article className="overflow-hidden rounded-card border border-line bg-surface shadow-card">
      <div className="aspect-video w-full bg-ink/5">
        <iframe src={r.embedUrl} title={r.title} loading="lazy" allow="autoplay; encrypted-media; picture-in-picture" allowFullScreen className="h-full w-full" />
      </div>
      <div className="p-4">
        <div className="flex flex-wrap items-center gap-2">
          <span className="grid h-6 min-w-6 place-items-center rounded-full bg-lvl-gn/10 px-1.5 text-caption font-bold text-ink">
            {index + 1}
          </span>
          {r.watched && <CheckCircle2 size={15} className="text-[var(--lvl-gn)]" />}
          <h3 className="font-display text-[15px] font-semibold">{r.title}</h3>
          <span className="text-xs text-muted">
            {formatDate(r.classDate)} · {VIDEO_PROVIDER_LABELS[r.provider]}{r.postedByName ? ` · by ${r.postedByName}` : ""}
          </span>
          <span className="ml-auto flex items-center gap-2">
            <button type="button"
              // "watched" is a done-state, so it takes the success signal (AA-safe 5.07:1);
              // the program teal fails as text (2.23:1) and is an identity fill, not a state.
              className={`inline-flex items-center gap-1 text-xs font-medium ${r.watched ? "text-ok" : "text-muted hover:text-ink"}`}
              onClick={async () => { const res = await toggleRecordingWatched(r.id); if (!res.ok) return toast(res.error, "error"); onChanged(); }}>
              {r.watched ? <CheckCircle2 size={13} /> : <Circle size={13} />}
              {r.watched ? "Watched" : "Mark watched"}
            </button>
            <a href={r.videoUrl} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-xs font-medium text-accent hover:underline">
              <ExternalLink size={13} /> open original
            </a>
            {canManage && (
              <>
                <IconButton label="Edit recording" size="sm" onClick={() => onEdit(r)}>
                  <Pencil size={14} />
                </IconButton>
                <IconButton
                  label="Delete recording"
                  size="sm"
                  tone="danger"
                  onClick={async () => {
                    const ok = await askConfirm({ title: `Delete “${r.title}”?`, body: "The video stays on its platform — only the batch entry is removed.", confirmLabel: "Delete", danger: true });
                    if (!ok) return;
                    const res = await deleteRecording(r.id);
                    if (!res.ok) return toast(res.error, "error");
                    toast("Recording deleted");
                    onChanged();
                  }}
                >
                  <Trash2 size={14} />
                </IconButton>
              </>
            )}
          </span>
        </div>
        {r.notes && <p className="mt-2 whitespace-pre-wrap text-sm text-ink-2">{r.notes}</p>}
      </div>
    </article>
  );
}

export function ClassroomPanel({ batchId, classroom, modules, canManage, recordingTotal, watchedCount }: {
  batchId: string;
  classroom: GnSection[];
  modules: GnModuleRow[];
  canManage: boolean;
  recordingTotal: number;
  watchedCount: number;
}) {
  const router = useRouter();
  const [, startTransition] = useTransition();
  const [adding, setAdding] = useState(false);
  const [managingModules, setManagingModules] = useState(false);
  const [editing, setEditing] = useState<GnRecordingRow | null>(null);
  const [error, setError] = useState<string | null>(null);
  const addFormRef = useRef<HTMLFormElement>(null);

  const refresh = () => startTransition(() => router.refresh());
  const pct = recordingTotal ? (watchedCount / recordingTotal) * 100 : 0;

  return (
    <div className="space-y-4">
      {/* course progress for learners */}
      {!canManage && recordingTotal > 0 && (
        <div className="rounded-card border border-line bg-surface p-4 shadow-card">
          <div className="flex items-center justify-between text-sm">
            <span className="font-semibold">Course progress</span>
            <span className="tnum text-muted">{watchedCount} of {recordingTotal} watched · {formatPct(pct)}</span>
          </div>
          <div className="mt-2 h-2 w-full overflow-hidden rounded-full bg-surface-2">
            <div className="h-full rounded-full bg-[var(--lvl-gn)] transition-all" style={{ width: `${pct}%` }} />
          </div>
          {watchedCount === recordingTotal && <p className="mt-2 text-xs font-medium text-ok">🎉 You&apos;ve completed every class in this batch!</p>}
        </div>
      )}

      {canManage && (
        <div className="flex flex-wrap gap-2">
          <Btn variant="soft" icon={<Plus size={15} />} onClick={() => { setAdding((v) => !v); setError(null); }}>
            {adding ? "Close" : "Post recording"}
          </Btn>
          <Btn variant="soft" icon={<Settings2 size={15} />} onClick={() => setManagingModules((v) => !v)}>
            {managingModules ? "Done" : "Manage modules"}
          </Btn>
        </div>
      )}

      {canManage && managingModules && <ModuleManager batchId={batchId} modules={modules} onChanged={refresh} />}

      {canManage && adding && (
        <form ref={addFormRef} className="rounded-card border border-line bg-surface p-4 shadow-card"
          action={async (form) => {
            setError(null);
            const res = await postRecording(batchId, form);
            if (!res.ok) return setError(res.error);
            addFormRef.current?.reset();
            setAdding(false);
            toast("Recording posted");
            refresh();
          }}>
          <RecordingFields modules={modules} />
          <div className="mt-4 flex items-center justify-between gap-3">
            <FormError message={error} />
            <span className="ml-auto"><SubmitButton>Post to batch</SubmitButton></span>
          </div>
        </form>
      )}

      {!canManage && recordingTotal > 0 && (
        <p className="text-xs text-muted">
          Your class recordings live here for <span className="font-semibold text-ink">lifetime</span> — rewatch them anytime, even after the batch ends.
        </p>
      )}

      {recordingTotal === 0 && (
        <p className="rounded-card border border-dashed border-line bg-surface-2 px-4 py-8 text-center text-sm text-muted">
          No recordings yet{canManage ? " — post the first class recording above." : " — your tutor posts the Fathom recording here after each class."}
        </p>
      )}

      {classroom.map((section) => (
        <section key={section.id ?? "default"} className="space-y-3">
          {(modules.length > 0 || section.id !== null) && section.recordings.length > 0 && (
            <div className="flex items-center gap-2 pt-1">
              <Layers size={14} className="text-[var(--lvl-gn)]" />
              <h3 className="font-display text-sm font-semibold">{section.title}</h3>
              <span className="text-xs text-muted">
                {section.watchedCount}/{section.recordings.length} watched
              </span>
              <span className="ml-2 h-1.5 flex-1 max-w-[120px] overflow-hidden rounded-full bg-surface-2">
                <span className="block h-full rounded-full bg-[var(--lvl-gn)]"
                  style={{ width: `${section.recordings.length ? Math.round((section.watchedCount / section.recordings.length) * 100) : 0}%` }} />
              </span>
            </div>
          )}
          {section.recordings.map((r, i) => (
            <LessonCard key={r.id} r={r} index={i} canManage={canManage} onEdit={(rec) => { setEditing(rec); setError(null); }} onChanged={refresh} />
          ))}
        </section>
      ))}

      <Modal open={editing !== null} onClose={() => setEditing(null)} title="Edit recording" subtitle="Change the module, title, date or link." size="md">
        {editing && (
          <form action={async (form) => {
            setError(null);
            const res = await updateRecording(editing.id, form);
            if (!res.ok) return setError(res.error);
            setEditing(null);
            toast("Recording updated");
            refresh();
          }}>
            <RecordingFields recording={editing} modules={modules} />
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
