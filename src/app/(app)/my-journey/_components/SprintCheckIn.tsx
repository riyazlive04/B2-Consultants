"use client";

import { useState } from "react";
import { CalendarCheck } from "lucide-react";
import { submitMySprintCheckIn } from "@/server/portal-actions";
import { toast } from "@/components/ui/feedback";
import { Field, FormError, SubmitButton, TextArea, TextInput } from "@/components/ui/form";
import { formatDate } from "@/lib/format";
import { SPRINT_STATUS_LABELS } from "@/lib/labels";
import { safeAction } from "@/lib/action-guard";
import {
  awaitsCoach,
  checkInState,
  nextWeekToAnswer,
  unansweredStreak,
} from "@/lib/sprint-check-in";

export type PortalSprintWeek = {
  id: string;
  weekIndex: number;
  weekStart: string;
  weekEnd: string;
  target: string | null;
  actual: string | null;
  status: string;
  note: string | null;
  isCurrent: boolean;
};

const STATUS_PILL: Record<string, string> = {
  ACHIEVED: "bg-ok-soft text-ok",
  MISSED: "bg-risk-soft text-risk",
  PENDING: "bg-surface-2 text-muted",
};

/**
 * The student's weekend check-in (client notes: "every weekend → fill it"). Shows the
 * week-wise plan, and lets the student submit what they actually did for the current
 * (or any past unreviewed) week. Achieved = keep going; missed = say what got in the way.
 */
export function SprintCheckIn({
  weeks,
  todayYmd,
}: {
  weeks: PortalSprintWeek[];
  /**
   * The IST day, resolved on the SERVER and passed in.
   *
   * Not `new Date()` in here, which is what this component used to compare against. That is the
   * BROWSER's clock in the BROWSER's timezone: a student opening the app from Berlin at 9pm is
   * already on the next IST day, so a week could read as overdue for them and open for their
   * coach - and the overdue copy below says something quite different to the student.
   */
  todayYmd: string;
}) {
  const [error, setError] = useState<string | null>(null);
  if (!weeks.length) return null;

  /**
   * Whose move it is, from the ONE definition in lib/sprint-check-in.ts.
   *
   * Both of these used to be written out here - `status === "PENDING" && !w.actual`, twice, in
   * two arms of one expression - and the first version had it on only one of them. A week whose
   * target was prose stayed PENDING after the student answered, so the form came straight back,
   * empty, with nothing to say the first answer had been received, and submitting again
   * overwrote it. The coach's queue in `server/notifications.ts` had its own copy of the
   * complementary test. Now there is one.
   */
  const shaped = weeks.map((w) => ({
    ...w,
    weekStartYmd: w.weekStart.slice(0, 10),
    weekEndYmd: w.weekEnd.slice(0, 10),
  }));
  const todayTarget = nextWeekToAnswer(shaped, todayYmd);
  const awaitingReview = shaped.find((w) => awaitsCoach(w, todayYmd));

  /**
   * An overdue week asks a DIFFERENT question.
   *
   * "How did the week go" is an invitation; the week has closed, so the honest question is what
   * got in the way - and that answer is worth more to the coach than the number is. Same form,
   * same `note` field, re-labelled: a second form would be a second place for the answer to
   * land.
   */
  const isOverdue = todayTarget ? checkInState(todayTarget, todayYmd) === "OVERDUE" : false;
  const streak = unansweredStreak(shaped, todayYmd);

  const done = weeks.filter((w) => w.status === "ACHIEVED").length;

  return (
    <div className="mt-5 border-t border-line pt-4">
      <p className="flex items-center gap-1.5 text-sm font-semibold">
        <CalendarCheck size={15} /> Weekly sprint
        <span className="text-xs font-normal text-muted">
          {done}/{weeks.length} weeks achieved
        </span>
      </p>

      {/* week strip - one chip per week */}
      <div className="mt-3 flex flex-wrap gap-1.5">
        {weeks.map((w) => (
          <span
            key={w.id}
            title={`Week ${w.weekIndex} (${formatDate(w.weekStart)} - ${formatDate(w.weekEnd)})${w.target ? ` · Target: ${w.target}` : ""} · ${SPRINT_STATUS_LABELS[w.status]}`}
            className={`rounded-full px-2 py-0.5 text-caption font-semibold ${STATUS_PILL[w.status]} ${
              w.isCurrent ? "ring-2 ring-[var(--accent)]" : ""
            }`}
          >
            W{w.weekIndex}
          </span>
        ))}
      </div>

      {todayTarget ? (
        <form
          action={async (form) => {
            setError(null);
            const res = await safeAction(() => submitMySprintCheckIn(todayTarget.id, form));
            if (!res.ok) return setError(res.error);
            toast("Check-in submitted - great job showing up 💪");
          }}
          className="mt-4 rounded-field border border-line bg-surface-2 p-4"
        >
          <p className="text-sm font-semibold">
            Week {todayTarget.weekIndex} check-in
            <span className="ml-2 font-normal text-muted tnum">
              {formatDate(todayTarget.weekStart)} - {formatDate(todayTarget.weekEnd)}
            </span>
            {isOverdue && (
              <span className="ml-2 rounded-full bg-warn-soft px-2 py-0.5 text-caption font-semibold text-warn">
                still open
              </span>
            )}
          </p>
          {isOverdue && (
            // Explicitly NOT "you missed this". The window stays open on purpose, and a student
            // who is already behind does not need to be told off by a form before they fill it.
            <p className="mt-1 text-sm text-ink-2">
              This week has closed, but it is still yours to fill in.
              {streak > 1 && ` That is ${streak} weekends now - worth a word with your coach.`}
            </p>
          )}
          {todayTarget.target ? (
            <p className="mt-1 text-sm text-muted">
              Your target: <span className="font-semibold text-ink">{todayTarget.target}</span>
            </p>
          ) : (
            <p className="mt-1 text-sm text-muted">No target set yet - tell us what you worked on anyway.</p>
          )}
          <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
            <Field label="What did you get done?">
              <TextInput kind="text" name="actual" required placeholder="e.g. 12 applications, 1 interview" />
            </Field>
            {/*
              One field, two questions. On an open week this is the optional extra; on an
              overdue one it is the point of the exercise, and the label says so - the answer
              lands in `SprintWeek.note` either way, which is where the coach reads it.
            */}
            <Field
              label={isOverdue ? "What got in the way?" : "Anything in the way? (optional)"}
              hint={isOverdue ? "More useful to your coach than the number is." : undefined}
            >
              <TextArea
                kind="text"
                name="note"
                rows={isOverdue ? 2 : 1}
                placeholder={
                  isOverdue ? "Interviews at work, family, lost the thread…" : "Blockers, questions for your coach…"
                }
              />
            </Field>
          </div>
          <div className="mt-3 flex items-center gap-3">
            <SubmitButton>Submit check-in</SubmitButton>
            <FormError message={error} />
          </div>
        </form>
      ) : awaitingReview ? (
        // Their own words, read back. Without this the only acknowledgement of a check-in was
        // the toast, which is gone on the next page load.
        <div className="mt-4 rounded-field border border-line bg-surface-2 p-4">
          <p className="text-sm font-semibold">
            Week {awaitingReview.weekIndex} check-in received
            <span className="ml-2 font-normal text-muted">with your coach for review</span>
          </p>
          <p className="mt-1 text-sm text-muted">
            You said: <span className="font-medium text-ink">{awaitingReview.actual}</span>
          </p>
          {awaitingReview.note && (
            <p className="mt-1 text-sm text-muted">
              Note: <span className="text-ink">{awaitingReview.note}</span>
            </p>
          )}
        </div>
      ) : (
        <p className="mt-3 text-xs text-muted">
          All caught up - your next check-in opens on the weekend. Keep the streak alive!
        </p>
      )}
    </div>
  );
}
