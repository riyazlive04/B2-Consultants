"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { withBack } from "@/lib/back-link";
import { Clock, Video, VideoOff } from "lucide-react";
import { setRecordingWindow } from "@/server/batch-timetable-actions";
import type { CatchUpRow } from "@/server/catch-up";
import { RECORDING_ACCESS_DAY_CHOICES } from "@/lib/recording-access";
import { Btn } from "@/components/ui/controls";
import { Card, Chip, Pill } from "@/components/ui/kit";
import { toast } from "@/components/ui/feedback";
import { formatDate } from "@/lib/format";

/**
 * MISSED A CLASS AND HAS NOT CAUGHT UP - the founders' "section for when they are not watching
 * the recordings within 24 hours".
 *
 * ── Grouped by CLASS, not by student ────────────────────────────────────────────────────
 * The opposite of how the teaching desk lists people, and deliberately. A coach acting on this
 * is either chasing one person or fixing one class, and the second is much more common: a
 * missing recording, or a viewing window that closed, puts everybody who missed that session
 * on the list at once from a single cause. Grouping by student would scatter one fixable cause
 * across six rows and invite six conversations instead of one action.
 *
 * ── Why the fix is offered on the row ───────────────────────────────────────────────────
 * "Extend to 7d" and "Post the recording" are the two things these rows actually need. Sending
 * the coach off to the cohort page to find them is how a follow-up list stops being used.
 */

const CATCH_UP_PILL: Record<
  CatchUpRow["state"],
  { tone: "bad" | "warn" | "neutral" | "good" | "info"; label: string; hint: string }
> = {
  WINDOW_CLOSED: {
    tone: "bad",
    label: "Window closed",
    hint: "The viewing window ran out before they watched it. Reopen it, or go through the class with them.",
  },
  NO_RECORDING: {
    tone: "bad",
    label: "No recording",
    hint: "They cannot catch up because the video was never posted. This one is yours to fix, not theirs.",
  },
  OVERDUE: { tone: "warn", label: "Overdue", hint: "Absent, recording available, grace gone." },
  IN_GRACE: { tone: "neutral", label: "Still in time", hint: "Not late yet." },
  CAUGHT_UP: { tone: "good", label: "Caught up", hint: "Watched it." },
};

export function CatchUpCard({
  rows,
  graceHours,
  onChanged,
}: {
  rows: CatchUpRow[];
  graceHours: number;
  onChanged: () => void;
}) {
  const [busy, setBusy] = useState<string | null>(null);

  const groups = useMemo(() => {
    const by = new Map<
      string,
      { title: string; batchName: string; dateYmd: string; batchId: string; accessLabel: string; rows: CatchUpRow[] }
    >();
    for (const r of rows) {
      const g =
        by.get(r.sessionId) ??
        {
          title: r.sessionTitle,
          batchName: r.batchName,
          dateYmd: r.classDateYmd,
          batchId: r.batchId,
          accessLabel: r.accessLabel,
          rows: [] as CatchUpRow[],
        };
      g.rows.push(r);
      by.set(r.sessionId, g);
    }
    return [...by.entries()];
  }, [rows]);

  const setWindow = async (sessionId: string, days: number) => {
    setBusy(sessionId);
    const res = await setRecordingWindow(sessionId, days);
    setBusy(null);
    if (!res.ok) {
      toast(res.error, "error");
      return;
    }
    toast(days === 0 ? "Viewing limit removed." : `Students may watch it for ${days} days.`, "success");
    onChanged();
  };

  return (
    <Card
      title={`Not caught up${rows.length ? ` (${rows.length})` : ""}`}
      subtitle={`Students marked absent who still have not watched the recording ${graceHours} hours after it went up.`}
    >
      {groups.length === 0 ? (
        <p className="text-sm text-muted">
          Nobody is behind. Everyone who missed a class has watched its recording - or still has
          time to.
        </p>
      ) : (
        <div className="space-y-4">
          {groups.map(([sessionId, g]) => {
            const noRecording = g.rows.some((r) => r.state === "NO_RECORDING");
            const closed = g.rows.some((r) => r.state === "WINDOW_CLOSED");
            return (
              <div key={sessionId} className="rounded-field border border-line bg-surface p-4">
                <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
                  <div className="min-w-[200px] flex-1">
                    <p className="font-display text-[15px] font-semibold text-ink">{g.title}</p>
                    <p className="text-caption text-muted">
                      {g.batchName} · {formatDate(g.dateYmd)} · {g.rows.length} behind · {g.accessLabel}
                    </p>
                  </div>

                  {noRecording ? (
                    <Link
                      href={withBack(`/batches/${g.batchId}`, "attendance")}
                      className="press inline-flex h-9 items-center gap-1.5 rounded-btn bg-primary px-3 text-sm font-semibold text-[color:var(--on-accent)] hover:opacity-90"
                    >
                      <VideoOff size={14} aria-hidden /> Post the recording
                    </Link>
                  ) : (
                    <span className="flex flex-wrap items-center gap-1.5">
                      <span className="text-caption text-muted">
                        {closed ? "Reopen for" : "Watchable for"}
                      </span>
                      {RECORDING_ACCESS_DAY_CHOICES.filter((d) => d !== 0).map((d) => (
                        <Btn
                          key={d}
                          size="sm"
                          variant="outline"
                          busy={busy === sessionId}
                          onClick={() => setWindow(sessionId, d)}
                          title={`Students may watch it until ${d} days after it was posted`}
                        >
                          {d}d
                        </Btn>
                      ))}
                      <Btn
                        size="sm"
                        variant="ghost"
                        busy={busy === sessionId}
                        onClick={() => setWindow(sessionId, 0)}
                        icon={<Clock size={14} />}
                        title="Remove the time limit entirely"
                      >
                        No limit
                      </Btn>
                    </span>
                  )}
                </div>

                <ul className="mt-3 divide-y divide-line border-t border-line">
                  {g.rows.map((r) => {
                    const pill = CATCH_UP_PILL[r.state];
                    return (
                      <li
                        key={`${r.sessionId}-${r.studentId}`}
                        className="flex flex-wrap items-center gap-x-3 gap-y-1 py-2"
                      >
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-sm font-medium text-ink">
                            {r.studentName}
                          </span>
                          {r.studentCode && (
                            <span className="block text-caption tabular-nums text-muted">
                              {r.studentCode}
                            </span>
                          )}
                        </span>
                        {/*
                          The TRACKED percentage, not the tick. A student at 40% who ticked
                          "watched" is still behind, and saying the number is what lets a coach
                          have that conversation without it becoming an argument.
                        */}
                        {r.watchedPct > 0 && (
                          <Pill
                            tone="info"
                            title={r.watchDisputed ? "Ticked watched, but the tracking disagrees" : undefined}
                          >
                            <Video size={12} aria-hidden /> {r.watchedPct}%
                            {r.watchDisputed ? " (disputed)" : ""}
                          </Pill>
                        )}
                        {r.hoursSinceRecording !== null && r.state === "OVERDUE" && (
                          <Chip>{r.hoursSinceRecording}h since posted</Chip>
                        )}
                        {!r.hasLogin && (
                          <Pill tone="bad" title="No portal login, so they have no way to watch anything">
                            No login
                          </Pill>
                        )}
                        <Pill tone={pill.tone} title={pill.hint}>
                          {pill.label}
                        </Pill>
                      </li>
                    );
                  })}
                </ul>
              </div>
            );
          })}
        </div>
      )}
    </Card>
  );
}
