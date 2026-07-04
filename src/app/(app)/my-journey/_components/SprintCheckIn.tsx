"use client";

import { useState } from "react";
import { CalendarCheck } from "lucide-react";
import { submitMySprintCheckIn } from "@/server/portal-actions";
import { toast } from "@/components/ui/feedback";
import { Field, FormError, SubmitButton, TextArea, TextInput } from "@/components/ui/form";
import { formatDate } from "@/lib/format";
import { SPRINT_STATUS_LABELS } from "@/lib/labels";

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
export function SprintCheckIn({ weeks }: { weeks: PortalSprintWeek[] }) {
  const [error, setError] = useState<string | null>(null);
  if (!weeks.length) return null;

  // the week to check in on: current week first, else the oldest past week still pending
  const todayTarget =
    weeks.find((w) => w.isCurrent && w.status === "PENDING") ??
    weeks.find((w) => w.status === "PENDING" && !w.actual && new Date(w.weekEnd) < new Date());

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
            className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${STATUS_PILL[w.status]} ${
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
            const res = await submitMySprintCheckIn(todayTarget.id, form);
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
          </p>
          {todayTarget.target ? (
            <p className="mt-1 text-sm text-muted">
              Your target: <span className="font-semibold text-ink">{todayTarget.target}</span>
            </p>
          ) : (
            <p className="mt-1 text-sm text-muted">No target set yet - tell us what you worked on anyway.</p>
          )}
          <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
            <Field label="What did you get done?">
              <TextInput name="actual" required placeholder="e.g. 12 applications, 1 interview" />
            </Field>
            <Field label="Anything in the way? (optional)">
              <TextArea name="note" rows={1} placeholder="Blockers, questions for your coach…" />
            </Field>
          </div>
          <div className="mt-3 flex items-center gap-3">
            <SubmitButton>Submit check-in</SubmitButton>
            <FormError message={error} />
          </div>
        </form>
      ) : (
        <p className="mt-3 text-xs text-muted">
          All caught up - your next check-in opens on the weekend. Keep the streak alive!
        </p>
      )}
    </div>
  );
}
