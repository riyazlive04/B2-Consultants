"use client";

import Link from "next/link";
import { useState } from "react";
import { useRouter } from "next/navigation";
import {
  CalendarRange, ClipboardCheck, ExternalLink, Flag, Pencil, PlayCircle, Plus, Trash2, Video, Wand2,
} from "lucide-react";
import type { BatchDetailView, TimetableSessionView } from "@/server/batch-detail";
import type { CurriculumTemplateView } from "@/server/curriculum";
import { DAY_NAMES, formatDuration, planTimetable, sortRows } from "@/lib/curriculum";
import {
  deleteBatchSession, generateTimetable, setSprintStart, upsertBatchSession,
} from "@/server/batch-timetable-actions";
import { AttendanceSheetModal } from "@/components/attendance/AttendanceSheet";
import { askConfirm, toast } from "@/components/ui/feedback";
import { Btn, IconButton } from "@/components/ui/controls";
import { Field, FormError, Select, SubmitButton, TextArea, TextInput } from "@/components/ui/form";
import { DatePicker } from "@/components/ui/DatePicker";
import { TimePicker } from "@/components/ui/TimePicker";
import { Modal } from "@/components/ui/Modal";
import { Card, EmptyState, Hint, Pill, TableShell, Td, Th, Tr } from "@/components/ui/kit";
import { formatDate } from "@/lib/format";
import { safeAction } from "@/lib/action-guard";

/**
 * ── ONE COHORT'S TIMETABLE - the founders' sheet, as a screen ─────────────────────────
 *
 * The sheet has one column per batch; this is that column, for this batch, beside the rows it
 * came from. Week · Topic · Duration · Day · Date · Time, in that order, because that is the
 * order the founders read it in.
 *
 * BUILD IT, THEN EDIT IT. "Build from curriculum" dates every session in one go and then gets
 * out of the way - afterwards each row is an ordinary class that can be moved, re-timed, given
 * a join link or deleted, without touching the curriculum other cohorts run on. Re-running the
 * build re-dates what has not been taught yet and leaves every class with a register against it
 * exactly where it is, which is what makes "the batch slipped a week" a two-click fix instead of
 * a reason to rebuild the cohort by hand.
 */

const TYPE_OPTIONS = [
  { value: "KICKOFF", label: "Kick off / onboarding" },
  { value: "COACHING", label: "Coaching" },
  { value: "LINKEDIN", label: "Social profile / LinkedIn" },
  { value: "QA", label: "Q&A" },
  { value: "OPEN_MARKET", label: "Job market strategy" },
  { value: "LIVE_CLASS", label: "Class" },
  { value: "OTHER", label: "Other" },
];

function SessionFields({ s }: { s?: TimetableSessionView }) {
  const [delivery, setDelivery] = useState<string>(s?.delivery ?? "LIVE");
  const live = delivery === "LIVE";
  return (
    <div className="space-y-4">
      <div className="grid gap-4 sm:grid-cols-[100px_1fr]">
        <Field label="Week" hint="Optional.">
          <TextInput kind="int" name="weekNumber" maxLength={3} defaultValue={s?.weekNumber ?? undefined} />
        </Field>
        <Field label="Topic">
          <TextInput kind="text" name="title" required maxLength={200} defaultValue={s?.title} />
        </Field>
      </div>
      <Field label="Framework (optional)">
        <TextInput kind="text" name="framework" maxLength={120} defaultValue={s?.framework ?? ""} />
      </Field>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Session type">
          <Select name="type" options={TYPE_OPTIONS} defaultValue={s?.type ?? "COACHING"} />
        </Field>
        <Field label="Delivery" hint="A pre-recorded module has no clock and no register.">
          <Select
            name="delivery"
            value={delivery}
            onChange={(e) => setDelivery(e.currentTarget.value)}
            options={[
              { value: "LIVE", label: "Live session" },
              { value: "PRE_RECORDED", label: "Pre-recorded video" },
            ]}
          />
        </Field>
      </div>
      <div className="grid gap-4 sm:grid-cols-3">
        <Field label={live ? "Date" : "Available from"}>
          <DatePicker name="date" required defaultValue={s?.dateYmd} />
        </Field>
        <Field label="Start time (IST)" hint={live ? "Leave blank if not confirmed." : "Not used for a video."}>
          <TimePicker name="time" disabled={!live} defaultValue={s?.timeHm ?? undefined} />
        </Field>
        <Field label="Duration (minutes)">
          <TextInput kind="int" name="durationMins" maxLength={4} defaultValue={s?.durationMins ?? undefined} />
        </Field>
      </div>
      <Field label={live ? "Join link" : "Video link"} hint={live ? "Zoom or Meet link the batch clicks." : "Where the module can be watched."}>
        <TextInput kind="url" name="joinUrl" maxLength={500} placeholder="https://…" defaultValue={s?.joinUrl ?? ""} />
      </Field>
      <Field label="Notes (optional)" hint="Shown to the batch - what to prepare, what it covers.">
        <TextArea kind="text" name="notes" rows={2} maxLength={2000} defaultValue={s?.notes ?? undefined} />
      </Field>
    </div>
  );
}

/** The build dialog: pick a curriculum and a start date, see the real dates, then commit. */
function BuildDialog({
  batch, templates, onClose,
}: {
  batch: BatchDetailView;
  templates: CurriculumTemplateView[];
  onClose: () => void;
}) {
  const router = useRouter();
  const [templateId, setTemplateId] = useState(batch.curriculumTemplateId ?? templates[0]?.id ?? "");
  const [start, setStart] = useState(batch.startDate ?? "");
  const [error, setError] = useState<string | null>(null);

  const template = templates.find((t) => t.id === templateId) ?? null;
  // The same function the server will run, so what is approved here is what lands.
  const plan =
    template && template.items.length > 0 && /^\d{4}-\d{2}-\d{2}$/.test(start)
      ? planTimetable(sortRows(template.items), start, { sprintDays: template.sprintDays })
      : null;
  const taught = batch.sessions.filter((s) => s.markedCount > 0).length;

  return (
    <Modal open title={`Build ${batch.name}'s timetable`} onClose={onClose}>
      <form
        action={async (fd) => {
          const res = await safeAction(() => generateTimetable(batch.id, fd));
          if (!res.ok) return setError(res.error);
          const { created, updated, kept, removed } = res.summary;
          toast(
            `Timetable built: ${created} new, ${updated} re-dated` +
              (kept ? `, ${kept} already taught and left alone` : "") +
              (removed ? `, ${removed} removed` : ""),
          );
          onClose();
          router.refresh();
        }}
        className="space-y-4"
      >
        <Field label="Curriculum" hint="The programme this cohort runs.">
          <Select
            name="templateId"
            value={templateId}
            onChange={(e) => setTemplateId(e.currentTarget.value)}
            options={templates.map((t) => ({
              value: t.id,
              label: `${t.name} · ${t.sessionCount} session${t.sessionCount === 1 ? "" : "s"}`,
            }))}
          />
        </Field>
        <Field label="Start date" hint="Day 1. The first session takes the first of its weekday on or after this.">
          <DatePicker name="startDate" required value={start} onChange={(e) => setStart(e.currentTarget.value)} />
        </Field>

        {taught > 0 && (
          <Hint>
            {taught} class{taught === 1 ? " has" : "es have"} already had a register taken. Those keep
            their dates - only classes that have not been marked are moved.
          </Hint>
        )}

        {plan && (
          <div className="rounded-card border border-line bg-surface-2 p-3">
            <p className="mb-2 text-label font-semibold uppercase text-ink-2">
              {plan.sessions.length} session{plan.sessions.length === 1 ? "" : "s"}
              {plan.sprintStartYmd
                ? ` · sprint ${formatDate(plan.sprintStartYmd)} → ${formatDate(plan.sprintEndYmd!)}`
                : ""}
            </p>
            <ul className="space-y-1">
              {plan.sessions.map((s) => (
                <li key={s.curriculumItemId} className="flex flex-wrap items-baseline gap-2 text-sm">
                  <span className="w-14 shrink-0 text-caption text-muted">
                    W{String(s.weekNumber).padStart(2, "0")}
                  </span>
                  <span className="flex-1 text-ink">{s.title}</span>
                  <span className="text-ink-2">
                    {s.delivery === "PRE_RECORDED" ? "Video · from " : ""}
                    {formatDate(s.dateYmd)}
                    {s.timeHm ? ` · ${s.timeHm}` : ""}
                  </span>
                </li>
              ))}
            </ul>
            {plan.missingTimes > 0 && (
              <p className="mt-2 text-caption text-warn">
                {plan.missingTimes} live session{plan.missingTimes === 1 ? " has" : "s have"} no time on
                the curriculum - set it on the row afterwards.
              </p>
            )}
          </div>
        )}

        <FormError message={error} />
        <SubmitButton>{batch.sessions.length ? "Rebuild timetable" : "Build timetable"}</SubmitButton>
      </form>
    </Modal>
  );
}

export function TimetablePanel({
  batch,
  templates,
}: {
  batch: BatchDetailView;
  templates: CurriculumTemplateView[];
}) {
  const router = useRouter();
  const [building, setBuilding] = useState(false);
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState<TimetableSessionView | null>(null);
  const [register, setRegister] = useState<TimetableSessionView | null>(null);
  const [error, setError] = useState<string | null>(null);

  const refresh = () => router.refresh();
  // Sheet order: the week grouping, then the clock. `startsAt` already sorts the server read,
  // but a week with two sessions on one day needs `orderIndex` to break the tie.
  const rows = [...batch.sessions].sort(
    (a, b) =>
      (a.weekNumber ?? 99) - (b.weekNumber ?? 99) ||
      a.startsAt.localeCompare(b.startsAt) ||
      a.orderIndex - b.orderIndex,
  );

  const sprintEnd =
    batch.sprintStartDate && batch.sprintDays
      ? formatDate(new Date(new Date(`${batch.sprintStartDate}T00:00:00Z`).getTime() + batch.sprintDays * 86_400_000))
      : null;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        {batch.curriculumName ? (
          <Pill tone="info">
            <span className="inline-flex items-center gap-1">
              <CalendarRange size={12} aria-hidden /> {batch.curriculumName}
            </span>
          </Pill>
        ) : (
          <Hint>This cohort has no curriculum yet - build one to get its dates.</Hint>
        )}
        {batch.canManage && (
          <span className="ml-auto flex flex-wrap gap-2">
            {templates.length > 0 && (
              <Btn size="sm" variant="primary" onClick={() => setBuilding(true)}>
                <Wand2 size={14} /> {batch.sessions.length ? "Rebuild from curriculum" : "Build from curriculum"}
              </Btn>
            )}
            <Btn size="sm" variant="soft" onClick={() => { setAdding(true); setError(null); }}>
              <Plus size={14} /> Add a session
            </Btn>
          </span>
        )}
      </div>

      {rows.length === 0 ? (
        <EmptyState
          title="No timetable yet"
          body={
            templates.length
              ? "Build it from a curriculum - pick the programme and a start date, and every session is dated for you."
              : "Write a curriculum under Programs → Curriculum first, then build this cohort's timetable from it."
          }
          /*
            The control, not a description of where the control lives. Offered only to somebody
            who may actually use it: a coach reading a cohort they do not run gets the
            explanation without a button the server would refuse.
          */
          action={
            batch.canManage ? (
              templates.length > 0 ? (
                <Btn variant="primary" icon={<Wand2 size={15} />} onClick={() => setBuilding(true)}>
                  Build from curriculum
                </Btn>
              ) : (
                <Link
                  href="/programs?tab=1"
                  className="inline-flex h-10 items-center rounded-btn bg-primary px-4 text-sm font-semibold text-on-accent hover:bg-primary-strong"
                >
                  Write a curriculum
                </Link>
              )
            ) : undefined
          }
        />
      ) : (
        <TableShell
          head={
            <>
              <Th>Week</Th>
              <Th>Topic</Th>
              <Th>Duration</Th>
              <Th>Day</Th>
              <Th>Date &amp; time</Th>
              <Th align="right">{""}</Th>
            </>
          }
        >
          <>
            {rows.map((s, i) => {
              const firstOfWeek = i === 0 || rows[i - 1].weekNumber !== s.weekNumber;
              const dow = DAY_NAMES[new Date(`${s.dateYmd}T00:00:00Z`).getUTCDay()];
              return (
                <Tr key={s.id} className={s.isPast ? "opacity-70" : ""}>
                  <Td>
                    {firstOfWeek && s.weekNumber !== null ? (
                      <span className="font-semibold text-ink">Week {String(s.weekNumber).padStart(2, "0")}</span>
                    ) : (
                      <span className="text-muted" aria-hidden>·</span>
                    )}
                  </Td>
                  <Td>
                    <span className="font-medium text-ink">{s.title}</span>
                    {s.framework && <span className="block text-caption italic text-muted">{s.framework}</span>}
                    <span className="mt-1 flex flex-wrap items-center gap-2">
                      {s.taskCount > 0 && <span className="text-caption text-muted">{s.taskCount} task{s.taskCount === 1 ? "" : "s"}</span>}
                      {s.markedCount > 0 && (
                        <span className="text-caption text-good">Register taken</span>
                      )}
                      {!s.fromCurriculum && <span className="text-caption text-muted">Added by hand</span>}
                    </span>
                  </Td>
                  <Td>{formatDuration(s.durationMins) ?? "-"}</Td>
                  <Td>
                    {s.delivery === "PRE_RECORDED" ? (
                      <span className="inline-flex items-center gap-1 text-muted">
                        <Video size={13} aria-hidden /> Video (pre-rec)
                      </span>
                    ) : (
                      dow
                    )}
                  </Td>
                  <Td>
                    <span className="text-ink-2">
                      {s.delivery === "PRE_RECORDED" ? "From " : ""}
                      {formatDate(s.dateYmd)}
                    </span>
                    <span className="block text-caption text-muted">
                      {s.timeHm ? `${s.timeHm} IST` : s.delivery === "LIVE" ? "Time to be confirmed" : "Watch any time"}
                    </span>
                  </Td>
                  <Td align="right">
                    <span className="inline-flex flex-wrap items-center justify-end gap-1">
                      {/* A meeting link is only offered while it can still be joined. A "Join"
                          on a class that ran three weeks ago opens a dead room, and the student
                          classroom already hides it for exactly that reason - this is the same
                          rule on the staff side. A pre-recorded module has no such window. */}
                      {s.joinUrl && (s.delivery === "PRE_RECORDED" || !s.isPast) && (
                        <a
                          href={s.joinUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex items-center gap-1 rounded-btn px-2 py-1 text-caption font-semibold text-primary hover:bg-ink/5"
                        >
                          {s.delivery === "PRE_RECORDED" ? <PlayCircle size={13} /> : <ExternalLink size={13} />}
                          {s.delivery === "PRE_RECORDED" ? "Watch" : "Join"}
                        </a>
                      )}
                      {batch.canManage && s.delivery === "LIVE" && s.isPast && (
                        <IconButton label={`Take the register for ${s.title}`} size="sm" onClick={() => setRegister(s)}>
                          <ClipboardCheck size={14} />
                        </IconButton>
                      )}
                      {batch.canManage && (
                        <>
                          <IconButton label={`Edit ${s.title}`} size="sm" onClick={() => { setEditing(s); setError(null); }}>
                            <Pencil size={14} />
                          </IconButton>
                          {s.markedCount === 0 && (
                            <IconButton label={`Remove ${s.title}`} size="sm" tone="danger" onClick={async () => {
                              const ok = await askConfirm({
                                title: `Remove “${s.title}”?`,
                                confirmLabel: "Remove",
                                danger: true,
                              });
                              if (!ok) return;
                              const res = await safeAction(() => deleteBatchSession(s.id));
                              if (!res.ok) return toast(res.error, "error");
                              toast("Class removed");
                              refresh();
                            }}>
                              <Trash2 size={14} />
                            </IconButton>
                          )}
                        </>
                      )}
                    </span>
                  </Td>
                </Tr>
              );
            })}
          </>
        </TableShell>
      )}

      {/* The sheet's last row. Its own card rather than a table row because it is not a class -
          nothing is taught on it, nobody attends it, and it has no duration. */}
      <Card>
        <div className="flex flex-wrap items-center gap-3">
          <span className="flex items-center gap-2">
            <Flag size={15} className="text-primary" aria-hidden />
            <span className="font-display text-[15px] font-semibold text-ink">
              {batch.sprintDays ? `${batch.sprintDays}-Day Sprint` : "Sprint"}
            </span>
          </span>
          <span className="text-sm text-ink-2">
            {batch.sprintStartDate
              ? `${formatDate(batch.sprintStartDate)}${sprintEnd ? ` → ${sprintEnd}` : ""}`
              : "Not set - it starts after the final live session."}
          </span>
          {batch.canManage && (
            <span className="ml-auto w-[170px]">
              <DatePicker
                aria-label="Sprint start date"
                size="sm"
                defaultValue={batch.sprintStartDate ?? undefined}
                onChange={async (e) => {
                  const res = await safeAction(() => setSprintStart(batch.id, e.currentTarget.value));
                  if (!res.ok) return toast(res.error, "error");
                  toast("Sprint start updated");
                  refresh();
                }}
              />
            </span>
          )}
        </div>
      </Card>

      {building && (
        <BuildDialog batch={batch} templates={templates} onClose={() => setBuilding(false)} />
      )}

      {(adding || editing) && (
        <Modal
          open
          title={editing ? `Edit “${editing.title}”` : "Add a session"}
          onClose={() => { setAdding(false); setEditing(null); }}
        >
          <form
            action={async (fd) => {
              const res = await safeAction(() => upsertBatchSession(batch.id, editing?.id ?? null, fd));
              if (!res.ok) return setError(res.error);
              toast(editing ? "Class updated" : "Class scheduled");
              setAdding(false);
              setEditing(null);
              refresh();
            }}
            className="space-y-4"
          >
            {/* Keyed to remount - see the note on ItemFields in CurriculumPanel. */}
            <SessionFields key={editing?.id ?? "new"} s={editing ?? undefined} />
            <FormError message={error} />
            <SubmitButton>{editing ? "Save class" : "Schedule class"}</SubmitButton>
          </form>
        </Modal>
      )}

      {register && (
        <AttendanceSheetModal
          open
          sessionId={register.id}
          sessionTitle={register.title}
          onClose={() => setRegister(null)}
          onSaved={() => { setRegister(null); refresh(); }}
        />
      )}
    </div>
  );
}
