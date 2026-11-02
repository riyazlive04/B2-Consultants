"use client";

import { Copy, ShieldAlert } from "lucide-react";
import { formatDate } from "@/lib/format";
import { EmptyState, Pill, TableShell, Td, Th, Tr } from "@/components/ui/kit";
import { toast } from "@/components/ui/feedback";
import {
  chaseMessage,
  primaryChaseReason,
  WEEKLY_FLAG_LABELS,
  WEEKLY_FLAG_TONE,
} from "@/lib/weekly-flags";
import type { WeeklyAttentionRow } from "@/server/weekly-report-board";

/**
 * STUDENTS NEEDING ATTENTION - every yellow and red across the cohorts you run, worst first.
 *
 * The founders' tracker had this block too, under an instruction that says everything about
 * why this feature exists: "Manually copy Yellow/Red flag students here weekly for quick
 * reference. Or filter the Student Master sheet by flag color." Deriving it removes the
 * weekly copy AND the chance that the person doing it was looking at a stale flag column.
 *
 * ── Why the message is copied rather than sent ───────────────────────────────────────
 * The chase copy comes from the sheet's own "Message Template" column, and those messages
 * are long, personal and specific - which is exactly what an approved WhatsApp template
 * cannot be. So this hands the delivery person the words for a real conversation. The
 * approved templates carry the weekly LINK; this carries the argument.
 */
export function WeeklyAttention({ rows }: { rows: WeeklyAttentionRow[] }) {
  if (rows.length === 0) {
    return (
      <EmptyState
        icon={<ShieldAlert size={20} />}
        title="Nobody is slipping"
        body="Every student on the cohorts you run is green this week. This list fills itself the moment one is not."
      />
    );
  }

  return (
    <TableShell
      minWidth={900}
      head={
        <>
          <Th>Student</Th>
          <Th>Cohort</Th>
          <Th>Flag</Th>
          <Th>Why</Th>
          <Th align="right">Silent</Th>
          <Th align="right">Streak</Th>
          <Th>Last report</Th>
          <Th>Chase</Th>
        </>
      }
    >
      {rows.map((row) => {
        const reason = primaryChaseReason(row.rollup.reasons);
        const message = reason
          ? chaseMessage(reason, {
              name: row.name.trim().split(/\s+/)[0],
              // This week's figures beside the targets they were judged against - both from
              // the row, so the message cannot quote a target the rule did not actually use.
              applications: row.latest.APPLICATIONS ?? null,
              networking: row.latest.NETWORKING ?? null,
              linkedinPosts: row.latest.LINKEDIN_POSTS ?? null,
              weeksSilent: row.rollup.weeksSilent,
              appsTarget: row.thresholds.appsTarget,
              networkingTarget: row.thresholds.networkingTarget,
              linkedinTarget: row.thresholds.linkedinTarget,
            })
          : null;

        return (
          <Tr key={`${row.batchId}:${row.studentId}`}>
            <Td>
              <span className="font-medium text-ink">{row.name}</span>
              {row.code && <span className="block text-caption text-muted">{row.code}</span>}
            </Td>
            <Td>
              <span className="text-ink-2">{row.cohortName}</span>
              {row.programLevel && (
                <span className="block text-caption text-muted">{row.programLevel}</span>
              )}
            </Td>
            <Td>
              <Pill tone={WEEKLY_FLAG_TONE[row.rollup.flag]}>
                {WEEKLY_FLAG_LABELS[row.rollup.flag]}
              </Pill>
              {/* "Red -> Ameen: any Red flag student must be reported within 24 hours." */}
              {row.escalate && (
                <span className="mt-1 block text-caption font-medium text-risk">
                  Tell the founder
                </span>
              )}
            </Td>
            <Td>
              <ul className="space-y-0.5">
                {row.rollup.reasons.slice(0, 3).map((r) => (
                  <li key={r.code} className="text-caption text-ink-2">
                    {r.label}
                  </li>
                ))}
              </ul>
              {row.notes.length > 0 && (
                <p className="mt-1 text-caption text-muted">
                  Said: {row.notes.map((n) => n.value).join("; ")}
                </p>
              )}
            </Td>
            <Td align="right" className="tnum">
              {row.rollup.weeksSilent > 0 ? `${row.rollup.weeksSilent}w` : "-"}
            </Td>
            <Td align="right" className="tnum">
              {row.rollup.streak > 0 ? `${row.rollup.streak}w` : "-"}
            </Td>
            <Td>
              {/* The week an ISO key names, written the way every other date on the
                  screen is written. A bare 2026-10-26 beside 26/10/2026 reads as a
                  different kind of fact. */}
              {row.rollup.lastFormWeekStart ? formatDate(row.rollup.lastFormWeekStart) : "Never"}
            </Td>
            <Td>
              {message ? (
                <button
                  type="button"
                  className="press inline-flex items-center gap-1 rounded-pill border border-line px-2 py-1 text-caption font-medium text-ink hover:border-primary-tint"
                  onClick={() => {
                    navigator.clipboard?.writeText(message);
                    toast("Message copied. Check the bracketed bits before you send it.");
                  }}
                  title={message}
                >
                  <Copy size={12} aria-hidden /> Copy message
                </button>
              ) : (
                <span className="text-caption text-muted">-</span>
              )}
              {row.phone && (
                <span className="mt-1 block text-caption text-muted">{row.phone}</span>
              )}
            </Td>
          </Tr>
        );
      })}
    </TableShell>
  );
}
