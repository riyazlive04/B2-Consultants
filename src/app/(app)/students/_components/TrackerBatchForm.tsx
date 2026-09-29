"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { ClipboardList, Save } from "lucide-react";
import { updateTrackerBatch } from "@/server/students-actions";
import { MILESTONE_LABELS } from "@/lib/labels";
import { Card, EmptyState, Pill } from "@/components/ui/kit";
import { Btn } from "@/components/ui/controls";
import { Select, TextInput } from "@/components/ui/form";
import { DatePicker } from "@/components/ui/DatePicker";
import { toast } from "@/components/ui/feedback";

/**
 * The weekly tracker round - every student a coach is updating, on one screen.
 *
 * ── Why this exists ─────────────────────────────────────────────────────────────
 * The 90/120-day tracker has always been editable per student, and that per-student form is
 * fine - for one student. Updating twelve of them meant opening twelve pages, which is exactly
 * why a Google Form was being used instead. This replaces that form: same fields, same audited
 * write path (`updateTracker`, looped), no external dependency and no sheet to reconcile.
 *
 * ── Only what you touch is saved ────────────────────────────────────────────────
 * A row joins the submit only once something in it changes. Posting every visible row would bump
 * `updatedAt` on students nobody looked at, which destroys "last updated" as a signal of
 * attention - and that signal is the point of a weekly round.
 *
 * ── Partial failure is shown ────────────────────────────────────────────────────
 * Rows are independent. If two fail, ten still save and the two are named. A batch save that
 * quietly dropped rows would leave a coach believing the round was recorded.
 */

const MILESTONES = Object.keys(MILESTONE_LABELS);

const SIGNALS = [
  { value: "", label: "Not set" },
  { value: "GREEN", label: "Green - on track" },
  { value: "AMBER", label: "Amber - slipping" },
  { value: "RED", label: "Red - at risk" },
];

const TASK_STATES = [
  { value: "", label: "-" },
  { value: "YES", label: "Done" },
  { value: "NO", label: "Not done" },
  { value: "PENDING", label: "Pending" },
];

export type TrackerBatchRow = {
  enrollmentId: string;
  studentName: string;
  programLevel: string;
  dayNumber: number;
  totalDays: number;
  currentMilestone: string;
  signalColour: string | null;
  daysSinceLastSession: number | null;
};

export function TrackerBatchForm({ rows }: { rows: TrackerBatchRow[] }) {
  const router = useRouter();
  const [touched, setTouched] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);

  const markTouched = (id: string) =>
    setTouched((prev) => (prev.has(id) ? prev : new Set(prev).add(id)));

  if (rows.length === 0) {
    return (
      <EmptyState
        icon={<ClipboardList size={20} />}
        title="No students on the 90/120-day tracker"
        body="Guided and Elite enrollments appear here while they are active. Solo is self-paced and has no tracker."
      />
    );
  }

  const submit = async (form: FormData) => {
    if (touched.size === 0) return toast("Nothing changed yet", "error");
    setBusy(true);
    const res = await updateTrackerBatch(form);
    setBusy(false);
    if (!res.ok) return toast(res.error, "error");

    if (res.failures.length) {
      toast(
        `Saved ${res.updated}. ${res.failures.length} failed: ${res.failures
          .map((f) => `${f.name} (${f.error})`)
          .join("; ")}`,
        "error",
      );
    } else {
      toast(`Saved ${res.updated} student${res.updated === 1 ? "" : "s"}`);
    }
    setTouched(new Set());
    router.refresh();
  };

  return (
    <form action={submit}>
      {/* Only the touched rows travel - see the note above on why. */}
      {[...touched].map((id) => (
        <input key={id} type="hidden" name="touched" value={id} />
      ))}

      <Card
        title="This week's round"
        subtitle="Update several students at once. Only rows you change are saved, and every change writes the same milestone and signal history the single-student form does."
        actions={
          <Btn type="submit" disabled={busy || touched.size === 0} icon={<Save size={15} />}>
            {busy ? "Saving…" : touched.size ? `Save ${touched.size} change${touched.size === 1 ? "" : "s"}` : "No changes"}
          </Btn>
        }
        flush
      >
        <div className="overflow-x-auto">
          <table className="w-full min-w-[1100px] border-collapse text-sm">
            <thead>
              <tr className="border-b border-line bg-surface-2 text-left">
                <th className="px-4 py-2.5 font-semibold text-ink-2">Student</th>
                <th className="px-3 py-2.5 font-semibold text-ink-2">Last session</th>
                <th className="px-3 py-2.5 font-semibold text-ink-2">Sessions done</th>
                <th className="px-3 py-2.5 font-semibold text-ink-2">Task set</th>
                <th className="px-3 py-2.5 font-semibold text-ink-2">Task done?</th>
                <th className="px-3 py-2.5 font-semibold text-ink-2">Applications</th>
                <th className="px-3 py-2.5 font-semibold text-ink-2">Interviews</th>
                <th className="px-3 py-2.5 font-semibold text-ink-2">Milestone</th>
                <th className="px-3 py-2.5 font-semibold text-ink-2">Signal</th>
                <th className="px-3 py-2.5 font-semibold text-ink-2">Next check-in</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => {
                const p = `${r.enrollmentId}__`;
                const isTouched = touched.has(r.enrollmentId);
                /**
                 * "Not seen in over a week" is the whole reason for a weekly round, so the row
                 * says it rather than making the coach compute it from a date.
                 */
                const stale = r.daysSinceLastSession != null && r.daysSinceLastSession >= 7;
                return (
                  <tr
                    key={r.enrollmentId}
                    onChange={() => markTouched(r.enrollmentId)}
                    className={`border-b border-line last:border-0 ${isTouched ? "bg-primary-soft/40" : ""}`}
                  >
                    <td className="px-4 py-2.5 align-top">
                      <div className="font-medium text-ink">{r.studentName}</div>
                      <div className="flex flex-wrap items-center gap-1.5 text-caption text-ink-3">
                        <span>
                          {r.programLevel} · day {r.dayNumber}/{r.totalDays}
                        </span>
                        {stale && <Pill tone="warn">{r.daysSinceLastSession}d since a session</Pill>}
                        {r.daysSinceLastSession === null && <Pill tone="neutral">No session logged</Pill>}
                      </div>
                    </td>
                    <td className="px-3 py-2.5 align-top">
                      <DatePicker size="sm" name={`${p}lastSessionDate`} aria-label={`Last session for ${r.studentName}`} />
                    </td>
                    <td className="w-24 px-3 py-2.5 align-top">
                      {/* Blank = leave as it is. `updateTracker` treats an empty counter that
                          way on purpose - these feed journey XP and the at-risk radar, and a
                          blank box must never silently reset audited progress to zero. */}
                      <TextInput kind="int" name={`${p}totalSessionsCompleted`} placeholder="-" maxLength={4} aria-label={`Sessions completed for ${r.studentName}`} />
                    </td>
                    <td className="px-3 py-2.5 align-top">
                      <TextInput kind="text" name={`${p}lastTaskAssigned`} placeholder="Task set" maxLength={200} aria-label={`Task set for ${r.studentName}`} />
                    </td>
                    <td className="w-28 px-3 py-2.5 align-top">
                      <Select size="sm" name={`${p}lastTaskCompleted`} defaultValue="" options={TASK_STATES} aria-label={`Task done for ${r.studentName}`} />
                    </td>
                    <td className="w-24 px-3 py-2.5 align-top">
                      <TextInput kind="int" name={`${p}applicationsSubmitted`} placeholder="-" maxLength={5} aria-label={`Applications for ${r.studentName}`} />
                    </td>
                    <td className="w-24 px-3 py-2.5 align-top">
                      <TextInput kind="int" name={`${p}interviewsReceived`} placeholder="-" maxLength={5} aria-label={`Interviews for ${r.studentName}`} />
                    </td>
                    <td className="px-3 py-2.5 align-top">
                      {/* Required by the schema, so it defaults to where they already are -
                          a batch save must never move someone's milestone by omission. */}
                      <Select
                        size="sm"
                        name={`${p}currentMilestone`}
                        defaultValue={r.currentMilestone}
                        options={MILESTONES.map((m) => ({ value: m, label: MILESTONE_LABELS[m] ?? m }))}
                        aria-label={`Milestone for ${r.studentName}`}
                      />
                    </td>
                    <td className="px-3 py-2.5 align-top">
                      <Select
                        size="sm"
                        name={`${p}signalColour`}
                        defaultValue={r.signalColour ?? ""}
                        options={SIGNALS}
                        aria-label={`Signal for ${r.studentName}`}
                      />
                    </td>
                    <td className="px-3 py-2.5 align-top">
                      <DatePicker size="sm" name={`${p}nextCheckInDate`} aria-label={`Next check-in for ${r.studentName}`} />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </Card>
    </form>
  );
}
