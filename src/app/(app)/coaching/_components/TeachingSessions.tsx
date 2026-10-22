"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { CalendarClock, ClipboardCheck, ExternalLink, Plus, Radio, Video } from "lucide-react";
import type { DeskSessionView } from "@/server/coaching-desk";
import { DAY_NAMES, formatDuration } from "@/lib/curriculum";
import { RECORDING_ACCESS_DAY_CHOICES } from "@/lib/recording-access";
import { postSessionRecording } from "@/server/batch-timetable-actions";
import { createSessionTask } from "@/server/session-tasks";
import { AttendanceSheetModal } from "@/components/attendance/AttendanceSheet";
import { toast } from "@/components/ui/feedback";
import { Btn } from "@/components/ui/controls";
import { Field, FormError, Select, SubmitButton, TextArea, TextInput } from "@/components/ui/form";
import { DatePicker } from "@/components/ui/DatePicker";
import { Modal } from "@/components/ui/Modal";
import { EmptyState, Pill } from "@/components/ui/kit";
import { formatDate } from "@/lib/format";
import { safeAction } from "@/lib/action-guard";

/**
 * A session, as the person TEACHING it needs it: when, who is in the room, and the three things
 * they do around it - take the register, post the recording, set the coursework.
 *
 * The same row serves "this week" and "needs a register", with only the actions differing by
 * whether the class has happened. One component, because a class before and after it runs is
 * the same object and the desk should not make a coach learn two layouts for it.
 */

const TASK_TYPES = [
  { value: "HOMEWORK", label: "Homework" },
  { value: "APPLY_JOB", label: "Apply to a job" },
  { value: "WATCH_VIDEO", label: "Watch a recording" },
  { value: "OTHER", label: "Other" },
];

export function SessionRow({ s }: { s: DeskSessionView }) {
  // What this viewer may do here is decided server-side, per session - see `canMark` on
  // DeskSessionView. A supervisor's desk mixes cohorts they run with cohorts they only watch.
  const canAct = s.canMark;
  const router = useRouter();
  const [register, setRegister] = useState(false);
  const [recording, setRecording] = useState(false);
  const [task, setTask] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const dow = DAY_NAMES[new Date(`${s.dateYmd}T00:00:00Z`).getUTCDay()];
  const soon = !s.isPast && new Date(s.startsAt).getTime() - Date.now() < 60 * 60_000;

  return (
    <div className={`rounded-card border bg-surface p-4 shadow-card ${soon ? "border-primary" : "border-line"}`}>
      <div className="flex flex-wrap items-start gap-2">
        {s.delivery === "PRE_RECORDED" ? (
          <Video size={15} className="mt-0.5 text-muted" aria-hidden />
        ) : (
          <CalendarClock size={15} className="mt-0.5 text-primary" aria-hidden />
        )}
        <div className="min-w-0 flex-1">
          <h4 className="font-display text-[15px] font-semibold text-ink">{s.title}</h4>
          {s.framework && <p className="text-caption italic text-muted">{s.framework}</p>}
          <p className="mt-0.5 text-xs text-muted">
            <Link href={s.batchLine === "B2" ? `/batches/${s.batchId}` : `/german-note/${s.batchId}`} className="hover:underline">
              {s.batchName}
            </Link>
            {` · ${s.rosterSize} student${s.rosterSize === 1 ? "" : "s"}`}
          </p>
        </div>
        {soon && (
          <Pill tone="primary">
            <span className="inline-flex items-center gap-1">
              <Radio size={11} aria-hidden /> Starting soon
            </span>
          </Pill>
        )}
        {s.isPast && s.markedCount === 0 && <Pill tone="warn">Register not taken</Pill>}
        {s.markedCount > 0 && <Pill tone="good">{s.markedCount} marked</Pill>}
      </div>

      <p className="mt-1.5 text-sm text-ink-2">
        {dow} {formatDate(s.dateYmd)}
        {s.timeHm ? ` · ${s.timeHm} IST` : s.delivery === "LIVE" ? " · time to be confirmed" : ""}
        {formatDuration(s.durationMins) ? ` · ${formatDuration(s.durationMins)}` : ""}
      </p>

      <div className="mt-3 flex flex-wrap items-center gap-2">
        {s.joinUrl && !s.isPast && (
          <a
            href={s.joinUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1.5 rounded-btn bg-primary px-3 py-1.5 text-sm font-semibold text-[color:var(--on-accent)] hover:opacity-90"
          >
            <ExternalLink size={14} aria-hidden /> Start the class
          </a>
        )}
        {canAct && s.delivery === "LIVE" && s.isPast && (
          <Btn size="sm" variant={s.markedCount === 0 ? "primary" : "soft"} onClick={() => setRegister(true)}>
            <ClipboardCheck size={14} /> {s.markedCount === 0 ? "Take the register" : "Edit the register"}
          </Btn>
        )}
        {/*
          Offered whether or not a recording already exists. A head coach correcting a wrong
          link was previously stuck: the button disappeared the moment anything was posted, so
          the only way to fix a bad paste was through the German Note classroom - a screen a
          coach has no section for.
        */}
        {canAct && s.isPast && (
          <Btn size="sm" variant="soft" onClick={() => { setRecording(true); setError(null); }}>
            <Video size={14} /> {s.hasRecording ? "Replace the recording" : "Post the recording"}
          </Btn>
        )}
        {canAct && (
          <Btn size="sm" variant="ghost" onClick={() => { setTask(true); setError(null); }}>
            <Plus size={14} /> Set coursework
          </Btn>
        )}
        {s.taskCount > 0 && (
          <span className="text-caption text-muted">{s.taskCount} task{s.taskCount === 1 ? "" : "s"} set</span>
        )}
        {s.hasRecording && <span className="text-caption text-good">Recording posted</span>}
      </div>

      {register && (
        <AttendanceSheetModal
          open
          sessionId={s.id}
          sessionTitle={s.title}
          onClose={() => setRegister(false)}
          onSaved={() => { setRegister(false); router.refresh(); }}
        />
      )}

      {recording && (
        <Modal open title={`Recording of “${s.title}”`} onClose={() => setRecording(false)}>
          <form
            action={async (fd) => {
              const res = await safeAction(() => postSessionRecording(s.id, fd));
              if (!res.ok) return setError(res.error);
              toast("Recording posted - the batch can watch it now");
              setRecording(false);
              router.refresh();
            }}
            className="space-y-4"
          >
            <Field
              label="Recording link"
              hint="Paste the Fathom share link, or a YouTube / Vimeo / Google Drive video link."
            >
              <TextInput kind="url" name="videoUrl" required maxLength={500} placeholder="https://fathom.video/share/…" />
            </Field>
            {/*
              HOW LONG THE STUDENTS MAY WATCH IT.
              A plain select rather than a free number, because the useful answers are few and a
              box inviting "how many days?" gets 1 typed into it by accident. The window runs
              from when the recording is posted, so re-posting a replacement restarts it.
            */}
            <Field
              label="Students may watch it for"
              hint="Counted from now. Staff always keep access - this governs the student portal only."
            >
              <Select
                name="accessDays"
                defaultValue=""
                options={[
                  { value: "", label: "Use the house default (Console → Attendance)" },
                  ...RECORDING_ACCESS_DAY_CHOICES.filter((d) => d !== 0).map((d) => ({
                    value: String(d),
                    label: `${d} days`,
                  })),
                  { value: "0", label: "No time limit" },
                ]}
              />
            </Field>
            {s.hasRecording && (
              <p className="rounded-field bg-warn-soft px-3 py-2 text-caption font-medium text-warn">
                This class already has a recording. Posting replaces it, and the old one - with
                any watch progress recorded against it - is removed.
              </p>
            )}
            <FormError message={error} />
            <SubmitButton>{s.hasRecording ? "Replace recording" : "Post recording"}</SubmitButton>
          </form>
        </Modal>
      )}

      {task && (
        <Modal open title={`Coursework for “${s.title}”`} onClose={() => setTask(false)}>
          <form
            action={async (fd) => {
              const res = await safeAction(() => createSessionTask(s.id, fd));
              if (!res.ok) return setError(res.error);
              toast("Coursework set for the whole batch");
              setTask(false);
              router.refresh();
            }}
            className="space-y-4"
          >
            <Field label="What should they do?">
              <TextInput kind="text" name="title" required maxLength={200} placeholder="Apply to 10 roles on StepStone" />
            </Field>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Type">
                <Select name="type" options={TASK_TYPES} defaultValue="HOMEWORK" />
              </Field>
              <Field label="Due (optional)">
                <DatePicker name="dueAt" />
              </Field>
            </div>
            <Field label="Detail (optional)">
              <TextArea kind="text" name="description" rows={3} maxLength={4000} />
            </Field>
            <FormError message={error} />
            <SubmitButton>Set coursework</SubmitButton>
          </form>
        </Modal>
      )}
    </div>
  );
}

export function SessionList({
  sessions,
  emptyTitle,
  emptyBody,
}: {
  sessions: DeskSessionView[];
  emptyTitle: string;
  emptyBody: string;
}) {
  if (sessions.length === 0) return <EmptyState title={emptyTitle} body={emptyBody} />;
  return (
    <div className="space-y-3">
      {sessions.map((s) => (
        <SessionRow key={s.id} s={s} />
      ))}
    </div>
  );
}
