import type { CalEvent } from "@/lib/calendar-event";
import { inMonth, istTimeLabel, monthCell, monthDays } from "@/lib/calendar-grid";
import { EventCard } from "./EventCard";

/**
 * Month view: 7 columns of whole weeks, each day a stack of one-line chips.
 *
 * "+N more" is a native `<details>` rather than a popover component - it opens on click and on
 * Enter, works before JavaScript loads, and closes itself; a bespoke popover here would be three
 * state hooks for the same behaviour the browser already has.
 */

const DOW = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

export function MonthGrid({ events, dayKey, todayKey }: { events: CalEvent[]; dayKey: string; todayKey: string }) {
  const days = monthDays(dayKey);
  return (
    <div className="overflow-hidden rounded-card border border-line bg-surface">
      <div className="grid grid-cols-7 border-b border-line">
        {DOW.map((d) => (
          <div key={d} className="px-2 py-2 text-center text-xs font-semibold text-muted">{d}</div>
        ))}
      </div>
      <div className="grid grid-cols-7">
        {days.map((key) => {
          const { all, shown, more } = monthCell(events, key);
          const faded = !inMonth(key, dayKey);
          return (
            <div key={key} className={`min-h-[112px] border-b border-r border-line p-1.5 last:border-r-0 ${faded ? "bg-surface-2" : ""}`}>
              <div className="mb-1 text-right">
                <span
                  className={`inline-block rounded-full px-1.5 text-caption font-semibold ${
                    key === todayKey ? "bg-accent text-on-accent" : faded ? "text-ink-disabled" : "text-muted"
                  }`}
                >
                  {Number(key.slice(8))}
                </span>
              </div>
              <div className="space-y-1">
                {shown.map((ev) => (
                  <EventCard key={ev.id} ev={ev} compact />
                ))}
                {more > 0 && (
                  <details className="group">
                    <summary className="cursor-pointer list-none rounded-field px-1.5 py-0.5 text-caption font-semibold text-accent hover:bg-accent-soft">
                      +{more} more
                    </summary>
                    <ul className="mt-1 space-y-1">
                      {all.map((ev) => (
                        <li key={ev.id} className="flex items-center gap-1">
                          <span className="flex-none text-caption text-muted">{istTimeLabel(ev.startsAt)}</span>
                          <span className="min-w-0 flex-1">
                            <EventCard ev={ev} compact />
                          </span>
                        </li>
                      ))}
                    </ul>
                  </details>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
