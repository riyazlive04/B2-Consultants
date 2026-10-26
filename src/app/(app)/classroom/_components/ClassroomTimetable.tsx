"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import {
  CalendarClock, CheckCircle2, Circle, Clock, ExternalLink, Flag, PlayCircle, Radio, Video,
} from "lucide-react";
import type { ClassroomBatchView, ClassroomSessionView } from "@/server/student-classroom";
import { DAY_NAMES, formatDuration } from "@/lib/curriculum";
import { toast } from "@/components/ui/feedback";
import { Card, EmptyState, Pill } from "@/components/ui/kit";
import { ResourceList } from "@/components/resources/ResourceList";
import { TaskChecklist } from "@/components/classroom/TaskChecklist";
import { Modal } from "@/components/ui/Modal";
import { Btn } from "@/components/ui/controls";
import { formatDate } from "@/lib/format";
import { sessionIsOn, sessionStatusLabel } from "@/lib/session-status";
import { safeAction } from "@/lib/action-guard";

/**
 * The student's own timetable, grouped the way their curriculum is written: by week.
 *
 * ── Why a week grouping rather than a flat list of dates ────────────────────────────────
 * The programme is sold as four weeks and a sprint, the agreement describes it that way, and
 * the founders' sheet is laid out that way. A student who has been told "week 3 is the job
 * market weekend" needs to find week 3, not scroll a list of eight dates. Sessions without a
 * week - German Note classes, anything added ad hoc - fall into one "Classes" group at the end
 * rather than being forced into a structure they do not have.
 */

const ATTENDANCE_PILL: Record<NonNullable<ClassroomSessionView["myAttendance"]>, { tone: "good" | "warn" | "bad" | "neutral"; label: string }> = {
  PRESENT: { tone: "good", label: "You attended" },
  LATE: { tone: "warn", label: "You joined late" },
  ABSENT: { tone: "bad", label: "You missed this" },
  EXCUSED: { tone: "neutral", label: "Excused" },
};

function SessionCard({ s, onChanged }: { s: ClassroomSessionView; onChanged: () => void }) {
  const [watching, setWatching] = useState(false);
  const pre = s.delivery === "PRE_RECORDED";
  const dow = DAY_NAMES[new Date(`${s.dateYmd}T00:00:00Z`).getUTCDay()];
  const mark = s.myAttendance ? ATTENDANCE_PILL[s.myAttendance] : null;
  /**
   * CALLED OFF (issue C3).
   *
   * The card stays on the timetable rather than disappearing. A class that silently vanishes
   * from a week a student was already told about is worse than no notice: they turn up, or they
   * assume they misread it, and either way they never learn what happened. So it is dimmed,
   * struck through, labelled, and carries the coach's reason - and the affordances that imply
   * the class is happening (the join link and the three attendance pills) are withheld below.
   *
   * The CHECK-IN button is already gone by then: `getMyOpenCheckIns` spreads `SESSION_ON`, so a
   * cancelled class is never in the set the dashboard offers. Withheld at the query, like a
   * recording past its window - a button a student may not press should not be in their page.
   */
  const off = !sessionIsOn(s.status);
  const offLabel = sessionStatusLabel(s.status);

  return (
    <div
      className={`rounded-card border bg-surface p-4 shadow-card ${
        off
          ? "border-dashed border-line opacity-70"
          : s.isLive
            ? "border-primary"
            : s.isPast
              ? "border-line opacity-80"
              : "border-line"
      }`}
    >
      <div className="flex flex-wrap items-start gap-2">
        {pre ? (
          <Video size={15} className="mt-0.5 text-muted" aria-hidden />
        ) : (
          <CalendarClock size={15} className="mt-0.5 text-primary" aria-hidden />
        )}
        <div className="min-w-0 flex-1">
          <h4 className={`font-display text-[15px] font-semibold text-ink ${off ? "line-through decoration-muted" : ""}`}>
            {s.title}
          </h4>
          {s.framework && <p className="text-caption italic text-muted">{s.framework}</p>}
        </div>
        {/* The called-off pill replaces every other badge on this row - see `off` above. */}
        {off && offLabel && <Pill tone="bad">{offLabel}</Pill>}
        {!off && s.isLive && (
          <Pill tone="primary">
            <span className="inline-flex items-center gap-1">
              <Radio size={11} aria-hidden /> Starting now
            </span>
          </Pill>
        )}
        {!off && mark && <Pill tone={mark.tone}>{mark.label}</Pill>}
        {/* A register taken but not yet released. Saying so beats the alternative, which is a
            card that looks identical to a class nobody marked at all - a student would read
            that silence as having been forgotten. */}
        {!off && !mark && s.attendancePending && (
          <Pill tone="neutral" title="Your coach has taken the register but not shared it yet">
            Attendance pending
          </Pill>
        )}
        {/*
          THE THIRD STATE, which was the silent one (issue A8).
          "Attendance pending" already distinguished a withheld mark from a shown one. What
          looked identical to both was a past live class with NO register at all - the card
          simply carried no pill, which a student reads as "I have been forgotten" or, worse,
          assumes is an absence they cannot see. Naming it closes the set: shown, withheld,
          never taken. Live and past only - a pre-recorded module has no register by design,
          and a future class has not happened.
        */}
        {!off && !mark && !s.attendancePending && !pre && s.isPast && (
          <Pill tone="neutral" title="No register has been taken for this class yet - it does not count against you">
            Not marked yet
          </Pill>
        )}
      </div>

      <p className="mt-1.5 text-sm text-ink-2">
        {pre ? (
          <>Watch any time · available from {formatDate(s.dateYmd)}</>
        ) : (
          <>
            {dow} {formatDate(s.dateYmd)}
            {s.timeHm ? ` · ${s.timeHm} IST` : " · time to be confirmed"}
          </>
        )}
        {formatDuration(s.durationMins) ? ` · ${formatDuration(s.durationMins)}` : ""}
      </p>

      {/* The coach's own words. This is the sentence the whole feature exists to deliver -
          "Cancelled" alone leaves a student guessing whether to expect a replacement. */}
      {off && (
        <p className="mt-1.5 text-sm text-bad">
          {s.cancelReason?.trim()
            ? s.cancelReason
            : offLabel === "Postponed"
              ? "Your coach will confirm a new time."
              : "This class is not going ahead."}
        </p>
      )}

      {s.notes && <p className="mt-1 whitespace-pre-wrap text-sm text-muted">{s.notes}</p>}

      <div className="mt-3 flex flex-wrap items-center gap-2">
        {/* The join link appears an hour before and disappears when the class ends - a link to
            a meeting that finished last month is worse than no link. */}
        {!off && !pre && s.joinUrl && !s.isPast && (
          <a
            href={s.joinUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1.5 rounded-btn bg-primary px-3 py-1.5 text-sm font-semibold text-[color:var(--on-accent)] hover:opacity-90"
          >
            <ExternalLink size={14} aria-hidden /> Join class
          </a>
        )}
        {pre && s.joinUrl && (
          <a
            href={s.joinUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1.5 rounded-btn bg-primary px-3 py-1.5 text-sm font-semibold text-[color:var(--on-accent)] hover:opacity-90"
          >
            <PlayCircle size={14} aria-hidden /> Watch the module
          </a>
        )}
        {s.recordingEmbedUrl && (
          <>
            <Btn size="sm" variant="soft" onClick={() => setWatching(true)}>
              <PlayCircle size={14} /> Watch the recording
            </Btn>
            {/*
              How long is left, but only when there IS a limit. A deadline shown on a recording
              that has none would invent urgency, and a student who sees one countdown assumes
              every card has one.
            */}
            {s.recordingDaysLeft !== null && (
              <Pill tone={s.recordingDaysLeft <= 2 ? "bad" : s.recordingDaysLeft <= 7 ? "warn" : "neutral"}>
                <Clock size={12} aria-hidden /> {s.recordingAccessLabel}
              </Pill>
            )}
          </>
        )}
        {/*
          The window has closed. Said out loud rather than silently dropping the button: a card
          that simply has no recording on it is indistinguishable from one where the coach never
          posted anything, and a student would read our deadline as our failure.
        */}
        {s.recordingExpired && (
          <span className="text-caption font-medium text-warn">
            The recording is no longer available - ask your coach if you still need it.
          </span>
        )}
        {s.isPast && !s.recordingEmbedUrl && !s.recordingExpired && (
          <span className="text-caption text-muted">Recording not posted yet</span>
        )}
      </div>

      {/* Material BEFORE coursework: you read the worksheet, then you do the task. */}
      {s.resources.length > 0 && (
        <div className="mt-3 border-t border-line pt-3">
          <ResourceList resources={s.resources} title="Resources" />
        </div>
      )}

      {s.tasks.length > 0 && (
        <div className="mt-3 border-t border-line pt-3">
          <TaskChecklist tasks={s.tasks} onChanged={onChanged} />
        </div>
      )}

      {watching && s.recordingEmbedUrl && (
        <Modal open title={s.recordingTitle ?? s.title} onClose={() => setWatching(false)} size="lg">
          <div className="aspect-video w-full overflow-hidden rounded-card bg-black">
            <iframe
              src={s.recordingEmbedUrl}
              title={s.recordingTitle ?? s.title}
              allow="accelerometer; autoplay; clipboard-write; encrypted-media; picture-in-picture"
              allowFullScreen
              className="h-full w-full"
            />
          </div>
          {s.recordingUrl && (
            <p className="mt-3 text-caption text-muted">
              <a href={s.recordingUrl} target="_blank" rel="noopener noreferrer" className="underline">
                Open the original
              </a>
            </p>
          )}
        </Modal>
      )}
    </div>
  );
}

export function ClassroomTimetable({ batch }: { batch: ClassroomBatchView }) {
  const router = useRouter();
  const refresh = () => router.refresh();

  if (batch.sessions.length === 0) {
    return (
      <EmptyState
        title="No classes scheduled yet"
        body="Your coach will publish the timetable before the programme starts - it will appear here."
      />
    );
  }

  // Week groups, in order, with the un-weeked ones ("Classes") last.
  const weeks = [...new Set(batch.sessions.map((s) => s.weekNumber))].sort((a, b) => {
    if (a === null) return 1;
    if (b === null) return -1;
    return a - b;
  });

  return (
    <div className="space-y-6">
      {/* The cohort shelf, once at the top rather than repeated under every class. */}
      {batch.resources.length > 0 && (
        <Card title="Your batch resources">
          <ResourceList resources={batch.resources} />
        </Card>
      )}

      {weeks.map((w) => {
        const inWeek = batch.sessions.filter((s) => s.weekNumber === w);
        return (
          <section key={String(w)} className="space-y-3">
            <h3 className="font-display text-sm font-semibold uppercase tracking-wide text-ink-2">
              {w === null ? "Classes" : `Week ${String(w).padStart(2, "0")}`}
            </h3>
            {inWeek.map((s) => (
              <SessionCard key={s.id} s={s} onChanged={refresh} />
            ))}
          </section>
        );
      })}

      {batch.sprintStartYmd && (
        <Card>
          <div className="flex flex-wrap items-center gap-3">
            <Flag size={16} className="text-primary" aria-hidden />
            <span className="font-display text-[15px] font-semibold text-ink">Your sprint</span>
            <span className="text-sm text-ink-2">
              {formatDate(batch.sprintStartYmd)}
              {batch.sprintEndYmd ? ` → ${formatDate(batch.sprintEndYmd)}` : ""}
            </span>
            <span className="ml-auto text-caption text-muted">
              Weekly targets and check-ins are on My Journey.
            </span>
          </div>
        </Card>
      )}
    </div>
  );
}
