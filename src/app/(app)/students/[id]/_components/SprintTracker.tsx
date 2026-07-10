"use client";

import { useState } from "react";
import { generateSprintPlan, saveSprintWeek } from "@/server/students-actions";
import type { StudentDetail } from "@/server/students-metrics";
import { toast } from "@/components/ui/feedback";
import { formatDate } from "@/lib/format";
import { optionsFrom, SPRINT_STATUS_LABELS } from "@/lib/labels";

type Enrollment = StudentDetail["enrollments"][number];
type SprintWeekRow = Enrollment["sprintWeeks"][number];

const STATUS_PILL: Record<string, string> = {
  ACHIEVED: "bg-ok-soft text-ok",
  MISSED: "bg-risk-soft text-risk",
  PENDING: "bg-surface-2 text-muted",
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
          <span className="flex gap-1.5 text-[11px] font-semibold">
            <span className="rounded-full bg-ok-soft px-2 py-0.5 text-ok">{counts.achieved} achieved</span>
            <span className="rounded-full bg-risk-soft px-2 py-0.5 text-risk">{counts.missed} missed</span>
            <span className="rounded-full bg-surface-2 px-2 py-0.5 text-muted">{counts.pending} pending</span>
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
        <div className="mt-3 overflow-x-auto">
          <table className="w-full min-w-[860px] border-collapse text-sm">
            <thead>
              <tr className="border-b border-line text-left text-xs font-semibold text-muted">
                <th className="py-2 pr-3">Week</th>
                <th className="py-2 pr-3">Dates</th>
                <th className="py-2 pr-3">Target</th>
                <th className="py-2 pr-3">Weekend check-in (actual)</th>
                <th className="py-2 pr-3">Status</th>
                <th className="py-2 pr-3">Note / why missed</th>
                {canEdit && <th className="py-2" />}
              </tr>
            </thead>
            <tbody>
              {weeks.map((w) => (
                <tr
                  key={w.id}
                  className={`border-b border-line align-middle ${isCurrent(w) ? "bg-accent-soft/40" : ""}`}
                >
                  <td className="py-2 pr-3 font-semibold tnum">
                    {w.weekIndex}
                    {isCurrent(w) && (
                      <span className="ml-1.5 rounded-full bg-accent-soft px-1.5 py-px text-[10px] font-bold text-accent">
                        NOW
                      </span>
                    )}
                  </td>
                  <td className="whitespace-nowrap py-2 pr-3 text-xs text-muted tnum">
                    {formatDate(w.weekStart)} - {formatDate(w.weekEnd)}
                  </td>
                  {canEdit ? (
                    <SprintRowForm w={w} onSave={saveRow} saving={saving === w.id} />
                  ) : (
                    <>
                      <td className="py-2 pr-3">{w.target ?? "-"}</td>
                      <td className="py-2 pr-3">{w.actual ?? "-"}</td>
                      <td className="py-2 pr-3">
                        <span className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${STATUS_PILL[w.status]}`}>
                          {SPRINT_STATUS_LABELS[w.status]}
                        </span>
                      </td>
                      <td className="py-2 pr-3 text-xs text-muted">{w.note ?? ""}</td>
                    </>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

/** One editable row = one tiny form; saving a week never touches its neighbours. */
function SprintRowForm({
  w,
  onSave,
  saving,
}: {
  w: SprintWeekRow;
  onSave: (w: SprintWeekRow, form: FormData) => Promise<void>;
  saving: boolean;
}) {
  const formId = `sprint-${w.id}`;
  const inputCls =
    "w-full rounded-field border border-line bg-surface px-2 py-1 text-xs outline-none focus:border-accent";
  return (
    <>
      <td className="py-1.5 pr-3">
        <input form={formId} name="target" defaultValue={w.target ?? ""} placeholder="e.g. 15 applications" className={inputCls} />
      </td>
      <td className="py-1.5 pr-3">
        <input form={formId} name="actual" defaultValue={w.actual ?? ""} placeholder="What happened" className={inputCls} />
      </td>
      <td className="py-1.5 pr-3">
        <select form={formId} name="status" defaultValue={w.status} className={inputCls}>
          {optionsFrom(SPRINT_STATUS_LABELS).map((o) => (
            <option key={o.value} value={o.value}>{o.label}</option>
          ))}
        </select>
      </td>
      <td className="py-1.5 pr-3">
        <input form={formId} name="note" defaultValue={w.note ?? ""} placeholder="Why missed / action" className={inputCls} />
      </td>
      <td className="py-1.5">
        <form id={formId} action={(form) => onSave(w, form)}>
          <button
            type="submit"
            disabled={saving}
            className="rounded-field bg-primary px-2.5 py-1 text-xs font-semibold text-white hover:bg-primary-strong disabled:opacity-60"
          >
            {saving ? "…" : "Save"}
          </button>
        </form>
      </td>
    </>
  );
}
