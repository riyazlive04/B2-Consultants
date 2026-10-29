import Link from "next/link";
import { ChevronsUp, Mic, MonitorPlay, PowerOff } from "lucide-react";
import { Pill, TableShell, Td, Th, Tr } from "@/components/ui/kit";
import { DateText } from "@/components/ui/DateText";
import { IMPROVEMENT_KIND_SHORT, IMPROVEMENT_SEVERITY_SHORT, IMPROVEMENT_STATUS_LABELS } from "@/lib/improvement";
import { formatClipLength } from "@/lib/recording";
import type { ImprovementRow } from "@/server/improvements";
import { severityTone, statusTone } from "./tone";

/**
 * The queue.
 *
 * Rows are LINKS to `?improvement=<id>`, not click handlers: the detail is a server read, and making
 * the open report part of the URL is what lets one be sent to somebody ("look at IMP-0014"). It
 * is also how the notification email's deep link lands on the right report.
 *
 * The engine-off chip is on the ROW, not only in the detail. It is the cheapest possible triage:
 * somebody scanning this list can see which reports are probably already answered without
 * opening any of them.
 */
export function ImprovementTable({ rows, openId }: { rows: ImprovementRow[]; openId: string | null }) {
  return (
    <TableShell
      head={
        <>
          <Th>Ref</Th>
          <Th>What</Th>
          <Th>Screen</Th>
          <Th>Who</Th>
          <Th>Hurt</Th>
          <Th>Status</Th>
          <Th align="right">Reported</Th>
        </>
      }
    >
      {rows.map((r) => (
        <Tr key={r.id} className={openId === r.id ? "bg-primary-soft" : ""}>
          <Td>
            <Link
              href={`/improvements?improvement=${r.id}`}
              className="font-semibold text-primary-strong hover:underline"
            >
              {r.ref}
            </Link>
          </Td>
          <Td>
            <Link href={`/improvements?improvement=${r.id}`} className="block min-w-0">
              <span className="block truncate text-sm text-ink hover:underline">{r.title}</span>
              <span className="mt-1 flex flex-wrap items-center gap-1.5">
                <Pill tone="neutral">{IMPROVEMENT_KIND_SHORT[r.kind]}</Pill>
                {/* First chip after the kind, because it is why this row is at the top. */}
                {r.urgent && (
                  <Pill tone="bad" title="Escalated - someone has said this one matters now">
                    <ChevronsUp size={11} /> Urgent
                  </Pill>
                )}
                {r.enginesOff.length > 0 && (
                  <Pill
                    tone="warn"
                    title={`Switched off when this was reported: ${r.enginesOff.join(", ")}`}
                  >
                    <PowerOff size={11} /> engine off
                  </Pill>
                )}
                {/* A recording is invisible in a queue unless the queue says so, and it is the
                    one part of a report that cannot be skimmed. The length is on the chip because
                    that is what decides whether it gets played now or later. */}
                {r.recording && (
                  <Pill
                    tone={r.recording.kind === "SCREEN" ? "info" : "neutral"}
                    title={
                      r.recording.kind === "SCREEN"
                        ? "This report has a screen recording showing what happened"
                        : "This report has a voice note to listen to"
                    }
                  >
                    {r.recording.kind === "SCREEN" ? <MonitorPlay size={11} /> : <Mic size={11} />}{" "}
                    {formatClipLength(r.recording.seconds)}
                  </Pill>
                )}
                {r.events > 0 && (
                  <span className="text-caption text-muted">{r.events} updates</span>
                )}
              </span>
            </Link>
          </Td>
          <Td>
            <span className="block max-w-48 truncate font-mono text-caption text-ink-2" title={r.route}>
              {r.sectionKey ?? r.route}
            </span>
          </Td>
          <Td>
            <span className="block truncate text-caption text-ink-2">
              {r.reporterName}
              <span className="block text-muted">{r.reporterRole}</span>
            </span>
          </Td>
          <Td>
            <Pill tone={severityTone(r.severity)}>{IMPROVEMENT_SEVERITY_SHORT[r.severity]}</Pill>
          </Td>
          <Td>
            <Pill tone={statusTone(r.status)}>{IMPROVEMENT_STATUS_LABELS[r.status]}</Pill>
          </Td>
          <Td align="right">
            <DateText date={r.createdAt} />
          </Td>
        </Tr>
      ))}
    </TableShell>
  );
}
