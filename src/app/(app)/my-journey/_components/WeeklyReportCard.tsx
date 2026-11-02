"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { CheckCircle2, ChevronDown, Clock } from "lucide-react";
import { SubmitButton, FormError } from "@/components/ui/form";
import { QuestionField, isOtherValue } from "@/components/weekly/WeeklyQuestionFields";
import { formatDate } from "@/lib/format";
import type { MyWeeklyWeek } from "@/server/student-weekly-report";
import { submitMyWeeklyReport } from "@/server/student-weekly-actions";

/**
 * THE OPEN WEEK, ANSWERED IN PLACE - and the only place it is answered.
 *
 * There is no public form and no per-cohort link. A student signs in and the week is on
 * their own dashboard, so the session is the identity check: a stronger one than a shared
 * link plus a typed Student ID, and one that cannot be forwarded to a classmate. The form
 * therefore has no identity step at all - it opens straight on the questions.
 */
export function WeeklyReportCard({ week }: { week: MyWeeklyWeek }) {
  const router = useRouter();
  const alreadyIn = Object.keys(week.answered).length > 0;
  const [open, setOpen] = useState(!alreadyIn);
  const [done, setDone] = useState<{ late: boolean; amended: boolean } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [otherOpen, setOtherOpen] = useState<Record<string, boolean>>({});

  async function save(form: FormData) {
    setError(null);
    setFieldErrors({});
    const res = await submitMyWeeklyReport(week.cycleId, form);
    if (!res.ok) {
      setError(res.error);
      setFieldErrors(res.fieldErrors ?? {});
      return;
    }
    setDone({ late: res.late, amended: res.amended });
    setOpen(false);
    // Pull the server's view back down, so the history below this card stops disagreeing
    // with the thank-you above it. The action revalidates; this is what asks for the result.
    router.refresh();
  }

  const weekLabel = `${week.batchWeekNumber !== null ? `Week ${week.batchWeekNumber} · ` : ""}${formatDate(week.weekStart)} - ${formatDate(week.weekEnd)}`;

  if (done) {
    return (
      <div className="mb-4 flex items-start gap-2 rounded-field bg-good-soft px-4 py-3">
        <CheckCircle2 size={18} className="mt-0.5 flex-none text-good" aria-hidden />
        <div>
          <p className="text-sm font-semibold text-ink">
            {done.amended ? "Your report has been updated" : "Thanks - that's in"}
          </p>
          <p className="text-caption text-muted">
            {done.late
              ? "It came in after this week's deadline, so your coach will see it marked late."
              : "Your coach will see this before your next session."}
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="mb-4 rounded-field border border-primary-tint bg-sky px-4 py-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-sm font-semibold text-ink">
            {alreadyIn
              ? "This week's report is in"
              : week.state === "LATE"
                ? "This week's report is overdue"
                : "This week's report is open"}
          </p>
          <p className="text-caption text-muted">
            {weekLabel}
            {week.state === "LATE" && !alreadyIn
              ? " · it will be marked late, and it still counts"
              : ""}
          </p>
        </div>
        <div className="flex items-center gap-2">
          {week.state === "LATE" && (
            <span className="inline-flex items-center gap-1 rounded-pill bg-warn-soft px-2 py-1 text-caption font-medium text-warn">
              <Clock size={12} aria-hidden /> Late
            </span>
          )}
          <button
            type="button"
            onClick={() => setOpen((v) => !v)}
            className="press inline-flex h-10 items-center gap-1 rounded-btn bg-primary px-4 text-sm font-semibold text-on-accent hover:bg-primary-strong"
            aria-expanded={open}
          >
            {open ? "Hide" : alreadyIn ? "Change my answers" : "Fill it in"}
            <ChevronDown size={15} className={open ? "rotate-180 transition-transform" : "transition-transform"} aria-hidden />
          </button>
        </div>
      </div>

      {open && (
        <form action={save} className="mt-4 space-y-4 border-t border-line pt-4">
          {alreadyIn && (
            <p className="text-caption text-muted">
              Your answers are below. Change anything you need to and send it again.
            </p>
          )}
          <FormError message={error} />
          {week.questions.map((q) => (
            <QuestionField
              key={q.id}
              q={q}
              error={fieldErrors[q.key] ?? null}
              initial={week.answered[q.key]}
              otherOpen={otherOpen[q.key] ?? isOtherValue(q, week.answered[q.key])}
              onOtherChange={(v) => setOtherOpen((prev) => ({ ...prev, [q.key]: v }))}
            />
          ))}
          <SubmitButton>{alreadyIn ? "Update my report" : "Send my report"}</SubmitButton>
        </form>
      )}
    </div>
  );
}
