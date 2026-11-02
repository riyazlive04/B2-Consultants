import { EmptyState, Pill, TableShell, Td, Th, Tr } from "@/components/ui/kit";
import { formatDate } from "@/lib/format";
import { WEEKLY_FLAG_LABELS, WEEKLY_FLAG_TONE } from "@/lib/weekly-flags";
import type { WeeklyBoard } from "@/server/weekly-report-board";

/**
 * THE STUDENT MASTER TAB - one row per student, their whole run of weeks across the page.
 *
 * The four columns on the right are the four the founders' sheet kept by hand and which are
 * derived here: Weekly Form Streak, Last Form Date, Weeks Silent, Flag Status. The grid in
 * the middle is the same information as the Sprint Tracker, read the other way round: down a
 * row rather than across a week, which is how you see a student going quiet.
 *
 * A server component - there is nothing to click.
 */
export function WeeklyHistory({ board }: { board: WeeklyBoard }) {
  if (board.weeks.length === 0 || board.rows.length === 0) {
    return (
      <EmptyState
        title="No history yet"
        body="Once this cohort has been asked about a week or two, each student's run of answers appears here."
      />
    );
  }

  // Oldest week on the left, so a row reads left-to-right like a calendar.
  const weeks = [...board.weeks].reverse();

  return (
    <TableShell
      minWidth={200 + weeks.length * 56 + 360}
      head={
        <>
          <Th>Student</Th>
          {weeks.map((w) => (
            <Th key={w.id} align="right">
              {w.batchWeekNumber !== null ? `W${w.batchWeekNumber}` : formatDate(w.weekStart).slice(0, 5)}
            </Th>
          ))}
          <Th align="right">Streak</Th>
          <Th align="right">Silent</Th>
          <Th>Last report</Th>
          <Th>Flag</Th>
        </>
      }
    >
      {board.rows.map((row) => {
        const byWeek = new Map(row.rollup.rows.map((r) => [r.isoWeek, r]));
        return (
          <Tr key={row.studentId}>
            <Td>
              <span className="font-medium text-ink">{row.name}</span>
              {row.code && <span className="block text-caption text-muted">{row.code}</span>}
            </Td>
            {weeks.map((w) => {
              const cell = byWeek.get(w.isoWeek);
              const tone = cell ? WEEKLY_FLAG_TONE[cell.flag] : "neutral";
              const label = cell ? WEEKLY_FLAG_LABELS[cell.flag] : "Not asked";
              return (
                <Td key={w.id} align="right">
                  {/* Never colour alone (DESIGN_SYSTEM §7): the dot carries a title and the
                      letter beside it says the same thing to anyone who cannot see the hue. */}
                  <span
                    className={`inline-flex h-6 w-6 items-center justify-center rounded-pill text-caption font-semibold ${
                      tone === "good"
                        ? "bg-good-soft text-good"
                        : tone === "warn"
                          ? "bg-warn-soft text-warn"
                          : tone === "bad"
                            ? "bg-risk-soft text-risk"
                            : "bg-surface-2 text-ink-3"
                    }`}
                    title={`${label}${cell?.reasons.length ? ` - ${cell.reasons.map((r) => r.label).join("; ")}` : ""}`}
                  >
                    {cell ? label[0] : "·"}
                  </span>
                </Td>
              );
            })}
            <Td align="right" className="tnum">{row.rollup.streak}</Td>
            <Td align="right" className="tnum">{row.rollup.weeksSilent}</Td>
            <Td>
              {/* The week an ISO key names, written the way every other date on the
                  screen is written. A bare 2026-10-26 beside 26/10/2026 reads as a
                  different kind of fact. */}
              {row.rollup.lastFormWeekStart ? formatDate(row.rollup.lastFormWeekStart) : "Never"}
            </Td>
            <Td>
              <Pill tone={WEEKLY_FLAG_TONE[row.rollup.flag]}>
                {WEEKLY_FLAG_LABELS[row.rollup.flag]}
              </Pill>
            </Td>
          </Tr>
        );
      })}
    </TableShell>
  );
}
