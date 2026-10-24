"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { CalendarRange, Pencil, Plus, Trash2, Users } from "lucide-react";
import type { BatchLine } from "@prisma/client";
import type { BatchBoardRow } from "@/server/batches";
import { BATCH_LINE_LABELS, BATCH_READINESS_LABELS, describeBlockers } from "@/lib/batch";
import { READINESS_TONE } from "./readiness-tone";
import { withBack, type BackKey } from "@/lib/back-link";
import { upsertBatch, deleteBatch } from "@/server/batch-actions";
import { askConfirm, toast } from "@/components/ui/feedback";
import { Btn, IconButton } from "@/components/ui/controls";
import { Field, FormError, Select, SubmitButton, TextArea, TextInput } from "@/components/ui/form";
import { DatePicker } from "@/components/ui/DatePicker";
import { Modal } from "@/components/ui/Modal";
import { EmptyState, Pill, type Tone } from "@/components/ui/kit";
import { formatDate } from "@/lib/format";
import { safeAction } from "@/lib/action-guard";

/**
 * ── COHORTS, FOR EITHER BUSINESS LINE ────────────────────────────────────────────────
 *
 * `Batch` has been one table carrying a `line` since the ER-v2 unification, and `upsertBatch`
 * has been line-aware just as long - but no screen ever called it. German Note had its own
 * panel (which hardcodes a German level and never sets `line`), and B2 Consultants had no
 * cohort screen at all: there was no way in the app to create a coaching batch. This is it.
 *
 * It is deliberately line-agnostic rather than a B2-only panel. The two lines run cohorts the
 * same way - a named group, a level, somebody leading it, a start and a capacity - and the one
 * rule that differs is already pure and already enforced twice: `levelFitsBatchLine` picks the
 * levels on offer here, and `upsertBatch` re-checks it server-side, because a hidden option is
 * never the fence.
 *
 * ARCHIVE, NOT DELETE, is the way to close a finished cohort: the roster, the classes and the
 * history stay readable. Delete is offered only for a batch nobody has been put in yet, and the
 * action refuses the moment anything hangs off the row - `Enrollment.batchId` nulls on delete,
 * so an unguarded delete would silently unseat a whole cohort.
 */

const CAPACITY_TONE: Record<BatchBoardRow["capacity"], Tone> = {
  empty: "neutral",
  filling: "info",
  full: "good",
  over: "warn",
};

function BatchFields({
  batch,
  line,
  levelOptions,
  leadOptions,
}: {
  batch?: BatchBoardRow;
  line: BatchLine;
  levelOptions: { value: string; label: string }[];
  leadOptions: { value: string; label: string }[];
}) {
  const leadLabel = line === "B2" ? "Coach" : "Tutor";
  return (
    <div className="space-y-4">
      {/* The line is fixed by the screen this panel is on - a cohort does not change business. */}
      <input type="hidden" name="line" value={line} />
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Batch name" hint={line === "B2" ? "e.g. Guided - October 2026" : "e.g. A1 Evening - July 2026"}>
          <TextInput
            kind="text"
            name="name"
            required
            maxLength={160}
            placeholder={line === "B2" ? "Guided - October 2026" : "A1 Evening - July 2026"}
            defaultValue={batch?.name}
          />
        </Field>
        <Field label="Code (optional)" hint="The short label used on calls and in workbooks. Must be unique.">
          <TextInput kind="text" name="code" maxLength={24} placeholder="B29" defaultValue={batch?.code ?? ""} />
        </Field>
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Programme" hint={`Only ${BATCH_LINE_LABELS[line]} programmes can be seated here.`}>
          <Select name="level" options={levelOptions} defaultValue={batch?.level ?? levelOptions[0]?.value} />
        </Field>
        <Field label={leadLabel} hint="Who runs this cohort. Can be set later.">
          <Select
            name="tutorId"
            options={[{ value: "", label: `No ${leadLabel.toLowerCase()} assigned yet` }, ...leadOptions]}
            defaultValue={batch?.leadId ?? ""}
          />
        </Field>
      </div>
      <div className="grid gap-4 sm:grid-cols-3">
        <Field label="Starts" hint="Day 1 of the programme.">
          <DatePicker name="startDate" defaultValue={batch?.startDate ?? undefined} />
        </Field>
        <Field label="Ends (optional)">
          <DatePicker name="endDate" defaultValue={batch?.endDate ?? undefined} />
        </Field>
        <Field label="Target class size" hint="A warning, not a hard cap.">
          <TextInput kind="int" name="targetStrength" defaultValue={String(batch?.targetStrength ?? 8)} />
        </Field>
      </div>
      {batch && (
        <Field label="Status" hint="Archived cohorts keep their roster and history, and stop being offered for seating.">
          <Select
            name="status"
            options={[
              { value: "ACTIVE", label: "Active" },
              { value: "ARCHIVED", label: "Archived (finished)" },
            ]}
            defaultValue={batch.status}
          />
        </Field>
      )}
      <Field label="Notes (optional)">
        <TextArea kind="text" name="notes" maxLength={2000} rows={2} placeholder="Schedule, call link, track…" defaultValue={batch?.notes ?? undefined} />
      </Field>
    </div>
  );
}

export function BatchesManager({
  line,
  rows,
  levelOptions,
  leadOptions,
  backKey,
  canEdit = true,
}: {
  line: BatchLine;
  rows: BatchBoardRow[];
  levelOptions: { value: string; label: string }[];
  leadOptions: { value: string; label: string }[];
  /**
   * May this viewer CREATE, EDIT or DELETE a cohort? (P18)
   *
   * Separate from being able to read the list and open a cohort. `upsertBatch` and `deleteBatch`
   * are `requireAdmin()`, while seating is the `batches.manage` capability - so a head coach who
   * holds that capability can legitimately see this list and work a cohort's roster without being
   * able to create one. Drawing the create form for them would be the same lie the teaching desk
   * was corrected for: a control the server refuses.
   *
   * Defaults true so the admin screens read exactly as they did.
   */
  canEdit?: boolean;
  /**
   * Which list this panel is being rendered in, so a cohort opened from it offers a way back
   * HERE. The same panel appears on Students → Batches and on Batches & Plans, and the cohort
   * page cannot tell which one sent you unless it is told.
   */
  backKey?: BackKey;
}) {
  const router = useRouter();
  const batchHref = (id: string) => (backKey ? withBack(`/batches/${id}`, backKey) : `/batches/${id}`);
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<BatchBoardRow | null>(null);
  const [error, setError] = useState<string | null>(null);

  const refresh = () => router.refresh();
  const active = rows.filter((r) => r.status === "ACTIVE");
  const archived = rows.filter((r) => r.status === "ARCHIVED");

  /** No programmes on this line = nothing a cohort could be seating. Say so, don't offer a form. */
  const canCreate = canEdit && levelOptions.length > 0;

  function Row({ b }: { b: BatchBoardRow }) {
    return (
      <div className="flex flex-wrap items-center gap-3 rounded-card border border-line bg-surface px-4 py-3 shadow-card">
        <div className="min-w-[220px] flex-1">
          <div className="flex flex-wrap items-center gap-2">
            {/* B2 cohorts have a screen of their own - the timetable and the roster. German
                Note runs from its own batch page, which this panel does not link to because
                that section has its own list. */}
            {line === "B2" ? (
              <Link href={batchHref(b.id)} className="text-sm font-semibold text-ink underline-offset-2 hover:underline">
                {b.name}
              </Link>
            ) : (
              <span className="text-sm font-semibold text-ink">{b.name}</span>
            )}
            {b.code && <span className="rounded bg-surface-2 px-1.5 py-0.5 font-mono text-[11px] text-muted">{b.code}</span>}
            <Pill tone="info">{b.levelLabel}</Pill>
            {/*
              DRAFT / READY / RUNNING - derived from the row, not from `status` (refactor C3).
              `status` only ever says ACTIVE or ARCHIVED, so a cohort with nothing set up sat in
              this list looking identical to one that was teaching. Archived keeps its own pill
              because that IS the stored state and reads better than "Archived" twice over.
            */}
            {b.status === "ARCHIVED" ? (
              <Pill tone="neutral">Archived</Pill>
            ) : (
              b.readiness !== "ACTIVE" && (
                <Pill tone={READINESS_TONE[b.readiness]}>{BATCH_READINESS_LABELS[b.readiness]}</Pill>
              )
            )}
          </div>
          {/* What it is missing, in the founders' own order, so the fix is visible from the
              list rather than only after opening the cohort. */}
          {b.status !== "ARCHIVED" && b.blockers.length > 0 && (
            <p className="mt-0.5 text-xs text-warn">{describeBlockers(b.blockers)}</p>
          )}
          <p className="mt-0.5 text-xs text-muted">
            {b.leadName ?? "Nobody assigned"}
            {b.startDate ? ` · from ${formatDate(b.startDate)}` : ""}
            {b.endDate ? ` to ${formatDate(b.endDate)}` : ""}
          </p>
          {/*
            WHETHER THIS COHORT HAS DATES YET - the question this list exists to answer on the
            Batches & Plans screen, and one a name and a capacity pill cannot. A B2 cohort says
            it as a link, because the answer to "no timetable" is the page that builds one.
          */}
          {line === "B2" ? (
            <Link
              href={batchHref(b.id)}
              className="mt-0.5 inline-block text-xs text-muted underline-offset-2 hover:text-ink hover:underline"
            >
              {b.sessionCount === 0 ? (
                <span className="text-warn">No timetable yet - set the dates</span>
              ) : (
                <>
                  {b.sessionCount} class{b.sessionCount === 1 ? "" : "es"}
                  {b.nextSessionAt ? ` · next ${formatDate(b.nextSessionAt)}` : " · none upcoming"}
                </>
              )}
            </Link>
          ) : (
            <p className="mt-0.5 text-xs text-muted">
              {b.sessionCount === 0
                ? "No classes scheduled yet"
                : `${b.sessionCount} class${b.sessionCount === 1 ? "" : "es"}${b.nextSessionAt ? ` · next ${formatDate(b.nextSessionAt)}` : " · none upcoming"}`}
            </p>
          )}
        </div>
        <Pill tone={CAPACITY_TONE[b.capacity]}>
          <span className="inline-flex items-center gap-1">
            <Users size={12} aria-hidden /> {b.capacityLabel}
          </span>
        </Pill>
        {canEdit && (
          <IconButton label={`Edit ${b.name}`} size="sm" onClick={() => { setEditing(b); setError(null); }}>
            <Pencil size={15} />
          </IconButton>
        )}
        {canEdit && b.filled === 0 && (
          <IconButton
            label={`Delete ${b.name}`}
            size="sm"
            tone="danger"
            onClick={async () => {
              const ok = await askConfirm({
                title: `Delete “${b.name}”?`,
                body: "Only an empty cohort can be deleted. To close one that ran, edit it and set the status to Archived instead.",
                confirmLabel: "Delete",
                danger: true,
              });
              if (!ok) return;
              const res = await safeAction(() => deleteBatch(b.id));
              if (!res.ok) return toast(res.error, "error");
              toast("Batch deleted");
              refresh();
            }}
          >
            <Trash2 size={15} />
          </IconButton>
        )}
      </div>
    );
  }

  return (
    <section className="space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="font-display text-h2 font-semibold">{BATCH_LINE_LABELS[line]} batches</h3>
          {/*
            This used to end "Seat a student from their own profile - the batch picker there
            offers the active cohorts on their programme's line", which was the only true
            instruction before the Roster became writable. It is now the WRONG one, and it sat
            directly above an empty state telling the reader to use the cohort's Roster tab -
            two instructions pointing opposite ways on one screen.

            The old route still works; it is just no longer the one to teach.
          */}
          {/*
            LINE-AWARE, because the two businesses genuinely add learners differently and this
            panel renders for both.

            It used to read "Seat a student from their own profile", which was the only true
            instruction before the Roster became writable - and then, once corrected to point at
            the Roster tab, it was true for B2 and WRONG for German Note: a German Note cohort's
            name is not a link here (its classroom is a different screen), so there was no Roster
            tab to open and the sentence could not be followed at all.

            German Note adds learners from its own Manage screen, which also offers a quick-create
            for somebody with no record yet. That is a better fit for a course than a seat picker,
            and it stays.
          */}
          <p className="mt-0.5 max-w-2xl text-xs text-muted">
            {line === "B2" ? (
              <>
                One batch = one cohort: a programme, whoever runs it, and the learners seated in
                it. Open a cohort to add learners from its Roster tab - several at once.
              </>
            ) : (
              <>
                One batch = one cohort: a level, the tutor who runs it, and its learners. This is
                where the cohort itself is created - add learners under German Note → Manage →
                Members, which can also create one from scratch.
              </>
            )}
          </p>
        </div>
        {canCreate && (
          <Btn
            variant="soft"
            icon={<Plus size={15} />}
            onClick={() => { setCreating((v) => !v); setError(null); }}
          >
            {creating ? "Close" : "Create batch"}
          </Btn>
        )}
      </div>

      {!canCreate && canEdit && (
        <EmptyState
          icon={<CalendarRange size={20} />}
          title="No programmes to run a batch for"
          body={
            line === "B2"
              ? "Add a coaching tier under Programs first - a batch has to be seating something."
              : "Add a German level under German Note → Manage → Levels first."
          }
          /* Naming the fix is not the same as offering it - the screen it names is two clicks
             away through a menu the reader may not have. */
          action={
            <Link
              href={line === "B2" ? "/programs" : "/german-note/manage?tab=3"}
              className="inline-flex h-10 items-center rounded-btn bg-primary px-4 text-sm font-semibold text-on-accent hover:bg-primary-strong"
            >
              {line === "B2" ? "Add a coaching tier" : "Add a German level"}
            </Link>
          }
        />
      )}

      {creating && (
        <form
          className="rounded-card border border-line bg-surface p-4 shadow-card"
          action={async (form) => {
            setError(null);
            const res = await safeAction(() => upsertBatch(null, form));
            if (!res.ok) return setError(res.error);
            setCreating(false);
            toast("Batch created");
            refresh();
          }}
        >
          <BatchFields line={line} levelOptions={levelOptions} leadOptions={leadOptions} />
          <div className="mt-4 flex items-center justify-between gap-3">
            <FormError message={error} />
            <span className="ml-auto"><SubmitButton>Create batch</SubmitButton></span>
          </div>
        </form>
      )}

      {rows.length === 0 && canCreate && !creating && (
        <EmptyState
          icon={<CalendarRange size={20} />}
          title="No batches yet"
          body="Create the first cohort, then add learners to it from the cohort's own Roster tab."
          action={
            <Btn variant="primary" icon={<Plus size={15} />} onClick={() => { setCreating(true); setError(null); }}>
              Create the first cohort
            </Btn>
          }
        />
      )}

      {active.length > 0 && <div className="space-y-2.5">{active.map((b) => <Row key={b.id} b={b} />)}</div>}

      {archived.length > 0 && (
        <details className="rounded-card border border-line bg-surface-2/40 px-4 py-3">
          <summary className="cursor-pointer text-sm font-semibold text-ink-2">
            Archived ({archived.length})
          </summary>
          <div className="mt-3 space-y-2.5">{archived.map((b) => <Row key={b.id} b={b} />)}</div>
        </details>
      )}

      <Modal open={editing !== null} onClose={() => setEditing(null)} title="Edit batch" size="md">
        {editing && (
          <form
            action={async (form) => {
              setError(null);
              const res = await safeAction(() => upsertBatch(editing.id, form));
              if (!res.ok) return setError(res.error);
              setEditing(null);
              toast("Batch updated");
              refresh();
            }}
          >
            <BatchFields batch={editing} line={line} levelOptions={levelOptions} leadOptions={leadOptions} />
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
