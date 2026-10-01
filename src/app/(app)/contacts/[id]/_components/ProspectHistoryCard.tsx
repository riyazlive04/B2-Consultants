import { History, Mail } from "lucide-react";
import { Card, Pill } from "@/components/ui/kit";
import { BANT_VERDICT_LABELS, BOOKING_STATUS_LABELS } from "@/lib/labels";
import { formatDate } from "@/lib/format";
import type { ProspectHistory } from "@/lib/prospect-history";

/**
 * Everything we already knew about this person, which until now was spread across three tables
 * and shown nowhere.
 *
 * The addresses come FIRST, and that ordering is the point. "We have been writing to
 * old@college.edu" is the single most actionable line on this page: it explains a prospect who
 * never answered an email without ever having bounced one, and it is invisible everywhere else.
 *
 * Rendered only for someone with a history. A card saying "nothing to report" on every brand-new
 * contact is a card people learn to skip, and then miss on the one record where it matters.
 */
export function ProspectHistoryCard({ history }: { history: ProspectHistory }) {
  if (!history.returning) return null;

  const others = history.emails.filter((e) => !e.primary);

  return (
    <Card
      title="We have met before"
      actions={<History size={15} aria-hidden className="text-ink-3" />}
    >
      <div className="space-y-4">
        {others.length > 0 && (
          <div>
            <p className="text-label uppercase text-ink-3">Email addresses</p>
            <ul className="mt-1.5 space-y-1">
              {history.emails.map((e) => (
                <li key={e.email} className="flex items-baseline gap-2 text-sm">
                  <Mail size={13} aria-hidden className="flex-none translate-y-0.5 text-ink-3" />
                  <span className={`min-w-0 break-all ${e.primary ? "font-medium text-ink" : "text-muted"}`}>
                    {e.email}
                  </span>
                  {e.primary ? (
                    <Pill tone="good">We write here</Pill>
                  ) : (
                    <span className="flex-none text-caption text-ink-3">
                      last used {formatDate(e.lastSeenAt.toISOString())}
                    </span>
                  )}
                </li>
              ))}
            </ul>
            <p className="mt-1.5 text-caption text-muted">
              They opted in again with a different address, so that is the one we send to now. The
              earlier ones are kept, and still find this record when they come back on one.
            </p>
          </div>
        )}

        {history.previous.length > 0 && (
          <div>
            <p className="text-label uppercase text-ink-3">Calls booked</p>
            <ul className="mt-1.5 space-y-1.5">
              {history.previous.slice(0, 6).map((b) => (
                <li key={b.id} className="flex items-baseline justify-between gap-3 text-sm">
                  <span className="text-ink-2">
                    {b.at ? formatDate(b.at.toISOString()) : "no slot"}
                  </span>
                  <span className="flex items-baseline gap-2">
                    {b.bantVerdict && (
                      <span className="text-caption text-muted">
                        {BANT_VERDICT_LABELS[b.bantVerdict] ?? b.bantVerdict}
                      </span>
                    )}
                    <Pill tone={b.status === "NO_SHOW" ? "bad" : b.status === "COMPLETED" ? "good" : "neutral"}>
                      {BOOKING_STATUS_LABELS[b.status] ?? b.status}
                    </Pill>
                  </span>
                </li>
              ))}
            </ul>
            {history.noShows > 0 && (
              // Said plainly, because it changes how hard you confirm before holding a slot.
              <p className="mt-1.5 text-caption text-muted">
                {history.noShows === 1 ? "One call" : `${history.noShows} calls`} booked and not
                attended - worth confirming before holding another slot.
              </p>
            )}
          </div>
        )}

        {history.scores.length > 1 && (
          <div>
            <p className="text-label uppercase text-ink-3">How they have scored</p>
            <ul className="mt-1.5 space-y-1">
              {history.scores.slice(0, 6).map((s, i) => (
                <li key={`${s.at.toISOString()}-${i}`} className="flex items-baseline justify-between gap-3 text-sm">
                  <span className="text-ink-2">{formatDate(s.at.toISOString())}</span>
                  <span className="flex items-baseline gap-2">
                    {s.avg !== null && <span className="tnum text-muted">{s.avg.toFixed(1)}/4</span>}
                    {s.verdict && (
                      <Pill tone={s.verdict === "CONFIRM" ? "good" : s.verdict === "CANCEL" ? "bad" : "warn"}>
                        {BANT_VERDICT_LABELS[s.verdict] ?? s.verdict}
                      </Pill>
                    )}
                  </span>
                </li>
              ))}
            </ul>
            <p className="mt-1.5 text-caption text-muted">
              Newest first. A prospect whose verdict has moved is a different conversation from one
              who has always scored the same.
            </p>
          </div>
        )}
      </div>
    </Card>
  );
}
