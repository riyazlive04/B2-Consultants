"use client";

import { useState } from "react";
import { generateSprintPlan, saveSprintWeek } from "@/server/students-actions";
import type { StudentDetail } from "@/server/students-metrics";
import { toast } from "@/components/ui/feedback";
import { Pill } from "@/components/ui/kit";
import { DataTable, type Column } from "@/components/ui/DataTable";
import { Btn } from "@/components/ui/controls";
import { Select } from "@/components/ui/form";
import { formatDate } from "@/lib/format";
import { optionsFrom, SPRINT_STATUS_LABELS } from "@/lib/labels";

type Enrollment = StudentDetail["enrollments"][number];
type SprintWeekRow = Enrollment["sprintWeeks"][number];

const STATUS_TONE: Record<string, "good" | "bad" | "neutral"> = {
  ACHIEVED: "good",
  MISSED: "bad",
  PENDING: "neutral",
};

/**
 * Week-wise sprint tracker (client notes): Guided 13 weeks / Elite 18 weeks. The coach
 * sets each week's target; the weekend check-in records the actual and the verdict.
 * "Achieved = no disturbance; missed = ask about the problem" - the asking is human
 * (or Wave-2 automation later); this board is where the answer lands.
 */
export function SprintTracker({
  enrollment,
  todayKey,
  canEdit,
}: {
  enrollment: Enrollment;
  todayKey: string; // YYYY-MM-DD (IST)
  canEdit: boolean;
}) {
  const [saving, setSaving] = useState<string | null>(null);
  const weeks = enrollment.sprintWeeks;
  const planWeeks = enrollment.programLevel === "GUIDED" ? 13 : 18;

  const counts = {
    achieved: weeks.filter((w) => w.status === "ACHIEVED").length,
    missed: weeks.filter((w) => w.status === "MISSED").length,
    pending: weeks.filter((w) => w.status === "PENDING").length,
  };
  const isCurrent = (w: SprintWeekRow) =>
    todayKey >= w.weekStart.slice(0, 10) && todayKey <= w.weekEnd.slice(0, 10);

  const saveRow = async (w: SprintWeekRow, form: FormData) => {
    setSaving(w.id);
    const res = await saveSprintWeek(w.id, form);
    setSaving(null);
    if (!res.ok) return toast(res.error, "error");
    toast(`Week ${w.weekIndex} saved`);
  };

  const inputCls =
    "h-9 w-full rounded-field border border-line bg-surface px-2 text-xs outline-none focus:border-accent";

  // Fixed-order week-by-week plan — sortable: false throughout so DataTable's
  // per-column click-sort can't scramble the sprint's natural sequence.
  const columns: Column<SprintWeekRow>[] = [
    {
      key: "week", header: "Week", sortable: false,
      cell: (w) => (
        <span className="font-semibold tnum">
          {w.weekIndex}
          {isCurrent(w) && (
            <span className="ml-1.5 rounded-full bg-accent-soft px-1.5 py-px text-caption font-bold text-accent">
              NOW
            </span>
          )}
        </span>
      ),
    },
    {
      key: "dates", header: "Dates", sortable: false,
      cell: (w) => (
        <span className="whitespace-nowrap text-xs text-muted tnum">
          {formatDate(w.weekStart)} - {formatDate(w.weekEnd)}
        </span>
      ),
    },
    {
      key: "target", header: "Target", sortable: false,
      cell: (w) =>
        canEdit ? (
          <input form={`sprint-${w.id}`} name="target" aria-label={`Week ${w.weekIndex} target`} defaultValue={w.target ?? ""} placeholder="e.g. 15 applications" className={inputCls} />
        ) : (
          w.target ?? "-"
        ),
    },
    {
      key: "actual", header: "Weekend check-in (actual)", sortable: false,
      cell: (w) =>
        canEdit ? (
          <input form={`sprint-${w.id}`} name="actual" aria-label={`Week ${w.weekIndex} actual`} defaultValue={w.actual ?? ""} placeholder="What happened" className={inputCls} />
        ) : (
          w.actual ?? "-"
        ),
    },
    {
      key: "status", header: "Status", sortable: false,
      cell: (w) =>
        canEdit ? (
          <Select form={`sprint-${w.id}`} name="status" aria-label={`Week ${w.weekIndex} status`} defaultValue={w.status} size="sm" className="w-full" options={optionsFrom(SPRINT_STATUS_LABELS)} />
        ) : (
          <Pill tone={STATUS_TONE[w.status]}>{SPRINT_STATUS_LABELS[w.status]}</Pill>
        ),
    },
    {
      key: "note", header: "Note / why missed", sortable: false,
      cell: (w) =>
        canEdit ? (
          <input form={`sprint-${w.id}`} name="note" aria-label={`Week ${w.weekIndex} note`} defaultValue={w.note ?? ""} placeholder="Why missed / action" className={inputCls} />
        ) : (
          <span className="text-xs text-muted">{w.note ?? ""}</span>
        ),
    },
    ...(canEdit
      ? [
          {
            key: "save", header: "", sortable: false,
            cell: (w: SprintWeekRow) => (
              <form id={`sprint-${w.id}`} action={(form: FormData) => saveRow(w, form)}>
                <Btn type="submit" variant="soft" size="sm" busy={saving === w.id}>Save</Btn>
              </form>
            ),
          },
        ]
      : []),
  ];

  return (
    <div className="mt-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h4 className="text-sm font-semibold">
          Sprint tracker
          <span className="ml-2 font-normal text-muted">
            {enrollment.programLevel === "GUIDED" ? "90 days · 13 weeks" : "120 days · 18 weeks"}
          </span>
        </h4>
        {weeks.length > 0 && (
          <span className="flex gap-1.5">
            <Pill tone="good">{counts.achieved} achieved</Pill>
            <Pill tone="bad">{counts.missed} missed</Pill>
            <Pill tone="neutral">{counts.pending} pending</Pill>
          </span>
        )}
      </div>

      {weeks.length === 0 ? (
        <div className="mt-3 rounded-field border border-dashed border-line bg-surface-2 p-4 text-sm text-muted">
          No week-wise plan yet.
          {canEdit ? (
            <button
              type="button"
              className="ml-2 font-semibold text-accent hover:underline"
              onClick={async () => {
                const res = await generateSprintPlan(enrollment.id);
                if (!res.ok) return toast(res.error, "error");
                toast(`${planWeeks}-week sprint plan created`);
              }}
            >
              Generate the {planWeeks}-week plan
            </button>
          ) : (
            " The coach hasn't generated it yet."
          )}
        </div>
      ) : (
        <div className="mt-3">
          <DataTable
            rows={weeks}
            columns={columns}
            rowClassName={(w) => (isCurrent(w) ? "bg-accent-soft/40" : undefined)}
            filterPlaceholder="Filter weeks…"
          />
        </div>
      )}
    </div>
  );
}
