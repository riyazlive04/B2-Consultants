import { ClipboardList } from "lucide-react";
import { Card, Pill } from "@/components/ui/kit";
import { formatDate } from "@/lib/format";
import type { MyWeeklyWeek } from "@/server/student-weekly-report";
import { WeeklyReportCard } from "./WeeklyReportCard";

/**
 * MY WEEKLY REPORTS - the student's own side of the weekly form.
 *
 * The open week comes first, as the form itself, because that is the one thing a student can
 * act on. Below it, the weeks they have already answered, with their own figures back - so the
 * form feels like a record they are keeping rather than a tax they are paying.
 *
 * No flag, no streak and no coach remark unless the coach marked it shareable. That
 * stripping happens on the server in student-weekly-report.ts, not here: a component that
 * merely declines to render something it was handed is one refactor away from rendering it.
 */
export function MyWeeklyReports({ weeks }: { weeks: MyWeeklyWeek[] }) {
  if (weeks.length === 0) return null;

  // The week they can still answer - whether or not they already have, because amending is
  // the same form. Everything else is history.
  const open = weeks.find((w) => w.questions.length > 0);
  const answered = weeks.filter((w) => w.submittedAt && w.cycleId !== open?.cycleId);

  return (
    <Card
      title="My weekly reports"
      subtitle="Four minutes a week. It is how your coach knows what to help you with before your next session."
    >
      {/* Answered in place. This is the only way a weekly report is ever filled in: the
          session is the identity check, so there is nothing to type - see WeeklyReportCard. */}
      {open && <WeeklyReportCard week={open} />}

      {answered.length === 0 ? (
        /**
         * "Nothing yet" only when there is genuinely nothing - the open week counts.
         *
         * The open week is deliberately absent from `answered`, because it is already drawn
         * in full by the card above. Reading that absence as "they have never submitted"
         * told a student who had just pressed send, and been thanked for it, that nothing
         * had arrived.
         */
        open?.submittedAt ? null : (
          <p className="text-sm text-muted">
            Nothing submitted yet. Your answers will appear here once you send your first report.
          </p>
        )
      ) : (
        <ul className="space-y-3">
          {answered.map((w) => (
            <li key={w.cycleId} className="rounded-field border border-line px-4 py-3">
              <div className="flex flex-wrap items-center gap-2">
                <ClipboardList size={14} className="text-ink-3" aria-hidden />
                <span className="text-sm font-medium text-ink">
                  {w.batchWeekNumber !== null ? `Week ${w.batchWeekNumber}` : formatDate(w.weekStart)}
                </span>
                <span className="text-caption text-muted">
                  {formatDate(w.weekStart)} - {formatDate(w.weekEnd)}
                </span>
                {w.late && <Pill tone="warn">Late</Pill>}
              </div>

              {w.answers.length > 0 && (
                <dl className="mt-2 grid grid-cols-1 gap-x-6 gap-y-1 sm:grid-cols-2">
                  {w.answers.map((a) => (
                    <div key={a.label} className="flex justify-between gap-3 text-caption">
                      <dt className="text-muted">{a.label}</dt>
                      <dd className="font-medium text-ink">{a.value}</dd>
                    </div>
                  ))}
                </dl>
              )}

              {w.remark && (
                <p className="mt-2 rounded-field bg-surface-2 px-3 py-2 text-caption text-ink-2">
                  <span className="font-semibold text-ink">From your coach: </span>
                  {w.remark}
                </p>
              )}
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}
