"use client";

import { Fragment, useState } from "react";
import { useRouter } from "next/navigation";
import {
  ArrowDown, ArrowUp, CalendarRange, Copy, Paperclip, Pencil, Plus, Sparkles, Trash2, Video,
} from "lucide-react";
import type { CurriculumItemView, CurriculumTemplateView } from "@/server/curriculum";
import {
  DAY_NAMES, dayCellLabel, formatDuration, planTimetable, sortRows,
} from "@/lib/curriculum";
import {
  deleteCurriculumItem, deleteCurriculumTemplate, duplicateCurriculumTemplate,
  moveCurriculumItem, seedGuidedCurriculum, upsertCurriculumItem, upsertCurriculumTemplate,
} from "@/server/curriculum-actions";
import { askConfirm, toast } from "@/components/ui/feedback";
import { Btn, IconButton } from "@/components/ui/controls";
import { Field, FormError, Select, SubmitButton, TextArea, TextInput } from "@/components/ui/form";
import { DatePicker } from "@/components/ui/DatePicker";
import { TimePicker } from "@/components/ui/TimePicker";
import { Modal } from "@/components/ui/Modal";
import { Card, EmptyState, Hint, Pill, TableShell, Td, Th, Tr } from "@/components/ui/kit";
import { formatDate } from "@/lib/format";
import { safeAction } from "@/lib/action-guard";
import { ResourceManager } from "@/components/resources/ResourceManager";

/**
 * ── THE CURRICULUM, AS THE FOUNDERS ALREADY WRITE IT ─────────────────────────────────
 *
 * This screen is their spreadsheet: one row per session (Week Nr · Topic · Duration · Day ·
 * Time), authored once and then used to date every cohort. What the sheet keeps in a column
 * per batch lives on the batch instead - see the timetable on /batches/[id].
 *
 * The PREVIEW is the part worth defending. A curriculum is abstract until it has dates, and the
 * dating rule is not the obvious one (week 3's third session spills into the next weekend, and
 * everything after it shifts). So the editor dates the sheet live against a start date you pick,
 * using `planTimetable` - the exact function the generate action calls - and shows the result
 * beside the rows. The founder sees the real dates before any cohort is built on them, and a
 * preview that could disagree with the write is impossible by construction.
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

const DAY_OPTIONS = DAY_NAMES.map((d, i) => ({ value: String(i), label: d }));

function TemplateFields({ t }: { t?: CurriculumTemplateView }) {
  return (
    <div className="space-y-4">
      <Field label="Curriculum name" hint="How the founders refer to it - this is what you pick when opening a batch.">
        <TextInput
          kind="text"
          name="name"
          required
          maxLength={160}
          placeholder="Guided Mode - 4 weeks + 90-day sprint"
          defaultValue={t?.name}
        />
      </Field>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Programme code (optional)" hint="The level this is written for, e.g. GUIDED.">
          <TextInput kind="text" name="levelCode" maxLength={40} placeholder="GUIDED" defaultValue={t?.levelCode ?? ""} />
        </Field>
        <Field
          label="Sprint length (days)"
          hint="Counted from the last live session. 0 means this programme has no sprint phase."
        >
          {/* An EXISTING template with no sprint stores null, which must render as 0 ("no
              sprint"), not as the 90 a NEW one starts from - otherwise opening the edit dialog
              and saving silently gave it a sprint it never had. */}
          <TextInput kind="int" name="sprintDays" maxLength={3} defaultValue={t ? String(t.sprintDays ?? 0) : "90"} />
        </Field>
      </div>
      <Field label="Description (optional)">
        <TextArea kind="text" name="description" rows={2} maxLength={2000} defaultValue={t?.description ?? undefined} />
      </Field>
      {t && (
        <Field label="Status" hint="A retired curriculum stays readable on the batches that ran it, and stops being offered for new ones.">
          <Select
            name="active"
            options={[
              { value: "true", label: "Active" },
              { value: "false", label: "Retired" },
            ]}
            defaultValue={String(t.active)}
          />
        </Field>
      )}
    </div>
  );
}

function ItemFields({ item, nextWeek }: { item?: CurriculumItemView; nextWeek: number }) {
  // The day and time inputs are disabled for a pre-recorded module, which has neither. Local
  // state only - the server clears both regardless of what the form carries.
  const [delivery, setDelivery] = useState<string>(item?.delivery ?? "LIVE");
  const live = delivery === "LIVE";

  return (
    <div className="space-y-4">
      <div className="grid gap-4 sm:grid-cols-[100px_1fr]">
        <Field label="Week">
          <TextInput kind="int" name="weekNumber" required maxLength={3} defaultValue={String(item?.weekNumber ?? nextWeek)} />
        </Field>
        <Field label="Topic">
          <TextInput kind="text" name="title" required maxLength={200} placeholder="Hidden Job Market" defaultValue={item?.title} />
        </Field>
      </div>
      <Field label="Framework (optional)" hint="The line under the topic on the sheet.">
        <TextInput kind="text" name="framework" maxLength={120} placeholder="H.I.D.E. Framework" defaultValue={item?.framework ?? ""} />
      </Field>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Session type">
          <Select name="type" options={TYPE_OPTIONS} defaultValue={item?.type ?? "COACHING"} />
        </Field>
        <Field label="Delivery" hint="A pre-recorded module has no day, no clock and no register.">
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
        <Field label="Duration (minutes)" hint="90 reads as 1.5 hrs.">
          <TextInput kind="int" name="durationMins" maxLength={4} placeholder="90" defaultValue={item?.durationMins ?? undefined} />
        </Field>
        <Field label="Day" hint={live ? "Which weekday this class runs on." : "Not used for a video."}>
          <Select
            name="dayOfWeek"
            disabled={!live}
            options={[{ value: "", label: live ? "Pick a day" : "Video (pre-rec)" }, ...DAY_OPTIONS]}
            defaultValue={item?.dayOfWeek === null || item?.dayOfWeek === undefined ? "" : String(item.dayOfWeek)}
          />
        </Field>
        <Field label="Start time (IST)" hint={live ? "24-hour clock." : "Not used for a video."}>
          <TimePicker name="startTime" disabled={!live} defaultValue={item?.startTime ?? undefined} />
        </Field>
      </div>
      <Field label="Notes (optional)" hint="What this session covers - shown to the batch.">
        <TextArea kind="text" name="notes" rows={2} maxLength={2000} defaultValue={item?.notes ?? undefined} />
      </Field>
    </div>
  );
}

/** The sheet, with a live preview column for whichever start date you are testing. */
function TemplateSheet({ t }: { t: CurriculumTemplateView }) {
  const router = useRouter();
  const [editingItem, setEditingItem] = useState<CurriculumItemView | null>(null);
  const [addingItem, setAddingItem] = useState(false);
  // Which row's material shelf is open. One at a time - eight open panels is not a table.
  const [openResources, setOpenResources] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [previewStart, setPreviewStart] = useState<string>("");

  const rows = sortRows(t.items);
  const nextWeek = rows.length ? Math.max(...rows.map((r) => r.weekNumber)) : 1;
  const plan = previewStart && rows.length
    ? planTimetable(rows, previewStart, { sprintDays: t.sprintDays })
    : null;
  const planById = new Map((plan?.sessions ?? []).map((s) => [s.curriculumItemId, s]));

  const refresh = () => router.refresh();

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end gap-3">
        <div className="w-[180px]">
          <Field
            label="Preview a start date"
            hint="Dates the sheet exactly as a batch would."
          >
            <DatePicker value={previewStart} onChange={(e) => setPreviewStart(e.currentTarget.value)} />
          </Field>
        </div>
        {plan && (
          <p className="pb-2 text-xs text-muted">
            {plan.sessions.length} sessions
            {plan.sprintStartYmd ? ` · sprint ${formatDate(plan.sprintStartYmd)} → ${formatDate(plan.sprintEndYmd!)}` : ""}
            {plan.missingTimes > 0 ? ` · ${plan.missingTimes} without a time` : ""}
          </p>
        )}
        <span className="ml-auto">
          <Btn size="sm" variant="soft" onClick={() => { setAddingItem(true); setError(null); }}>
            <Plus size={14} /> Add session
          </Btn>
        </span>
      </div>

      {rows.length === 0 ? (
        <EmptyState title="No sessions yet" body="Add the first week to start the timetable." />
      ) : (
        <TableShell
          head={
            <>
              <Th>Week</Th>
              <Th>Topic</Th>
              <Th>Duration</Th>
              <Th>Day</Th>
              <Th>Time</Th>
              {plan && <Th>Preview date</Th>}
              <Th align="right">{""}</Th>
            </>
          }
        >
          <>
            {rows.map((r, i) => {
              const planned = planById.get(r.id);
              // The week label is printed once per week, like the merged cell on the sheet.
              const firstOfWeek = i === 0 || rows[i - 1].weekNumber !== r.weekNumber;
              return (
                <Fragment key={r.id}>
                <Tr>
                  <Td>
                    {firstOfWeek ? (
                      <span className="font-semibold text-ink">Week {String(r.weekNumber).padStart(2, "0")}</span>
                    ) : (
                      <span className="text-muted" aria-hidden>
                        ·
                      </span>
                    )}
                  </Td>
                  <Td>
                    <span className="font-medium text-ink">{r.title}</span>
                    {r.framework && <span className="block text-caption italic text-muted">{r.framework}</span>}
                  </Td>
                  <Td>{formatDuration(r.durationMins) ?? "-"}</Td>
                  <Td>
                    {r.delivery === "PRE_RECORDED" ? (
                      <span className="inline-flex items-center gap-1 text-muted">
                        <Video size={13} aria-hidden /> Video (pre-rec)
                      </span>
                    ) : (
                      dayCellLabel(r)
                    )}
                  </Td>
                  <Td>{r.startTime ?? "-"}</Td>
                  {plan && (
                    <Td>
                      {planned ? (
                        <span className="text-ink-2">
                          {formatDate(planned.dateYmd)}
                          {planned.timeHm && <span className="block text-caption text-muted">{planned.timeHm}</span>}
                        </span>
                      ) : (
                        "-"
                      )}
                    </Td>
                  )}
                  <Td align="right">
                    <span className="inline-flex items-center gap-1">
                      <IconButton
                        label={`Resources for ${r.title}`}
                        size="sm"
                        onClick={() => setOpenResources(openResources === r.id ? null : r.id)}
                      >
                        <span className="inline-flex items-center gap-0.5">
                          <Paperclip size={14} />
                          {r.resources.length > 0 && (
                            <span className="text-caption font-semibold">{r.resources.length}</span>
                          )}
                        </span>
                      </IconButton>
                      <IconButton label={`Move ${r.title} up`} size="sm" onClick={async () => {
                        const res = await safeAction(() => moveCurriculumItem(r.id, "up"));
                        if (!res.ok) return toast(res.error, "error");
                        refresh();
                      }}>
                        <ArrowUp size={14} />
                      </IconButton>
                      <IconButton label={`Move ${r.title} down`} size="sm" onClick={async () => {
                        const res = await safeAction(() => moveCurriculumItem(r.id, "down"));
                        if (!res.ok) return toast(res.error, "error");
                        refresh();
                      }}>
                        <ArrowDown size={14} />
                      </IconButton>
                      <IconButton label={`Edit ${r.title}`} size="sm" onClick={() => { setEditingItem(r); setError(null); }}>
                        <Pencil size={14} />
                      </IconButton>
                      <IconButton label={`Remove ${r.title}`} size="sm" tone="danger" onClick={async () => {
                        const ok = await askConfirm({
                          title: `Remove “${r.title}”?`,
                          body: "Batches already built from this curriculum keep the class - they hold their own copy of it.",
                          confirmLabel: "Remove",
                          danger: true,
                        });
                        if (!ok) return;
                        const res = await safeAction(() => deleteCurriculumItem(r.id));
                        if (!res.ok) return toast(res.error, "error");
                        toast("Session removed");
                        refresh();
                      }}>
                        <Trash2 size={14} />
                      </IconButton>
                    </span>
                  </Td>
                </Tr>
                {/* The row's own shelf, opened from the paperclip. Attached HERE rather than on
                    each batch, so one upload reaches every cohort that will ever run this
                    programme - which is the whole reason the curriculum scope exists. */}
                {openResources === r.id && (
                  <tr>
                    <td colSpan={plan ? 7 : 6} className="border-b border-line bg-surface-2 px-3 py-3">
                      <ResourceManager
                        scope="curriculumItem"
                        scopeId={r.id}
                        resources={r.resources}
                        canManage
                        title={`Material for "${r.title}"`}
                        hint="Every cohort running this curriculum sees these on this class - including batches opened next year."
                      />
                    </td>
                  </tr>
                )}
                </Fragment>
              );
            })}
          </>
        </TableShell>
      )}

      {(addingItem || editingItem) && (
        <Modal
          open
          title={editingItem ? `Edit “${editingItem.title}”` : "Add a session"}
          onClose={() => { setAddingItem(false); setEditingItem(null); }}
        >
          <form
            action={async (fd) => {
              const res = await safeAction(() => upsertCurriculumItem(t.id, editingItem?.id ?? null, fd));
              if (!res.ok) return setError(res.error);
              toast(editingItem ? "Session updated" : "Session added");
              setAddingItem(false);
              setEditingItem(null);
              setError(null);
              refresh();
            }}
            className="space-y-4"
          >
            {/* Keyed so switching from one row straight to another REMOUNTS the fields.
                `delivery` is local state seeded from the item; without a key the second row
                would open showing the first row's delivery mode. */}
            <ItemFields key={editingItem?.id ?? "new"} item={editingItem ?? undefined} nextWeek={nextWeek} />
            <FormError message={error} />
            <SubmitButton>{editingItem ? "Save session" : "Add session"}</SubmitButton>
          </form>
        </Modal>
      )}
    </div>
  );
}

export function CurriculumPanel({ templates }: { templates: CurriculumTemplateView[] }) {
  const router = useRouter();
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<CurriculumTemplateView | null>(null);
  const [openId, setOpenId] = useState<string | null>(templates[0]?.id ?? null);
  const [error, setError] = useState<string | null>(null);

  const refresh = () => router.refresh();

  if (templates.length === 0) {
    return (
      <Card title="Curriculum">
        <EmptyState
          title="No curriculum yet"
          body="A curriculum is the week-by-week timetable a batch is built from - the sheet with Week Nr, Topic, Duration and Day. Start from the Guided programme your agreement already describes, or write one from scratch."
        />
        <div className="mt-4 flex flex-wrap gap-2">
          <Btn
            variant="primary"
            onClick={async () => {
              const res = await safeAction(() => seedGuidedCurriculum());
              if (!res.ok) return toast(res.error, "error");
              toast("Guided curriculum created");
              refresh();
            }}
          >
            <Sparkles size={15} /> Start from the Guided programme
          </Btn>
          <Btn variant="soft" onClick={() => { setCreating(true); setError(null); }}>
            <Plus size={15} /> Blank curriculum
          </Btn>
        </div>
        {creating && (
          <Modal open title="New curriculum" onClose={() => setCreating(false)}>
            <form
              action={async (fd) => {
                const res = await safeAction(() => upsertCurriculumTemplate(null, fd));
                if (!res.ok) return setError(res.error);
                toast("Curriculum created");
                setCreating(false);
                refresh();
              }}
              className="space-y-4"
            >
              <TemplateFields />
              <FormError message={error} />
              <SubmitButton>Create curriculum</SubmitButton>
            </form>
          </Modal>
        )}
      </Card>
    );
  }

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center gap-2">
        <Hint>
          A curriculum is authored once and dates itself per cohort. Editing one never changes a
          batch that is already running on it.
        </Hint>
        <span className="ml-auto">
          <Btn variant="soft" size="sm" onClick={() => { setCreating(true); setError(null); }}>
            <Plus size={14} /> New curriculum
          </Btn>
        </span>
      </div>

      {templates.map((t) => {
        const open = openId === t.id;
        return (
          <Card key={t.id}>
            <div className="flex flex-wrap items-center gap-3">
              <button
                type="button"
                className="min-w-[200px] flex-1 text-left"
                onClick={() => setOpenId(open ? null : t.id)}
                aria-expanded={open}
              >
                <span className="flex flex-wrap items-center gap-2">
                  <CalendarRange size={15} className="text-primary" aria-hidden />
                  <span className="font-display text-[15px] font-semibold text-ink">{t.name}</span>
                  {t.levelCode && <Pill tone="info">{t.levelCode}</Pill>}
                  {!t.active && <Pill tone="neutral">Retired</Pill>}
                </span>
                <span className="mt-0.5 block text-xs text-muted">
                  {t.weekCount} week{t.weekCount === 1 ? "" : "s"} · {t.sessionCount} session
                  {t.sessionCount === 1 ? "" : "s"}
                  {t.sprintDays ? ` · ${t.sprintDays}-day sprint` : " · no sprint"}
                  {t.batchCount > 0 ? ` · ${t.batchCount} batch${t.batchCount === 1 ? "" : "es"} running it` : ""}
                </span>
              </button>
              <IconButton label={`Copy ${t.name}`} size="sm" onClick={async () => {
                const res = await safeAction(() => duplicateCurriculumTemplate(t.id));
                if (!res.ok) return toast(res.error, "error");
                toast("Curriculum copied");
                refresh();
              }}>
                <Copy size={15} />
              </IconButton>
              <IconButton label={`Edit ${t.name}`} size="sm" onClick={() => { setEditing(t); setError(null); }}>
                <Pencil size={15} />
              </IconButton>
              {t.batchCount === 0 && (
                <IconButton label={`Delete ${t.name}`} size="sm" tone="danger" onClick={async () => {
                  const ok = await askConfirm({
                    title: `Delete “${t.name}”?`,
                    body: "Only a curriculum no cohort was built from can be deleted. To close one that ran, edit it and set the status to Retired.",
                    confirmLabel: "Delete",
                    danger: true,
                  });
                  if (!ok) return;
                  const res = await safeAction(() => deleteCurriculumTemplate(t.id));
                  if (!res.ok) return toast(res.error, "error");
                  toast("Curriculum deleted");
                  refresh();
                }}>
                  <Trash2 size={15} />
                </IconButton>
              )}
            </div>
            {open && (
              <div className="mt-4 border-t border-line pt-4">
                <TemplateSheet t={t} />
              </div>
            )}
          </Card>
        );
      })}

      {(creating || editing) && (
        <Modal
          open
          title={editing ? `Edit “${editing.name}”` : "New curriculum"}
          onClose={() => { setCreating(false); setEditing(null); }}
        >
          <form
            action={async (fd) => {
              const res = await safeAction(() => upsertCurriculumTemplate(editing?.id ?? null, fd));
              if (!res.ok) return setError(res.error);
              toast(editing ? "Curriculum updated" : "Curriculum created");
              setCreating(false);
              setEditing(null);
              refresh();
            }}
            className="space-y-4"
          >
            <TemplateFields t={editing ?? undefined} />
            <FormError message={error} />
            <SubmitButton>{editing ? "Save curriculum" : "Create curriculum"}</SubmitButton>
          </form>
        </Modal>
      )}
    </div>
  );
}
