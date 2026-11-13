import Link from "next/link";
import { CalendarPlus, ChevronLeft, ChevronRight } from "lucide-react";
import { DateJump } from "./DateJump";

/**
 * Synamate's toolbar: Today · ‹ range › · the range label as a date jump · Day/Week/Month.
 *
 * Plain links, not client state: the view and the date live in the URL, so Back, refresh and a
 * shared link all behave, and the grid re-renders on the server with the right data.
 */

export type CalView = "day" | "week" | "month";
export const CAL_VIEWS: CalView[] = ["day", "week", "month"];

const navCls =
  "grid h-8 w-8 place-items-center rounded-field border border-line text-muted transition-colors hover:bg-surface-2 hover:text-ink";
const btnCls =
  "inline-flex h-8 items-center gap-1.5 rounded-field border border-line px-3 text-xs font-medium text-muted transition-colors hover:bg-surface-2 hover:text-ink";

export function CalendarToolbar({
  view, label, hrefFor, todayHref, prevHref, nextHref, dayKey, actions,
}: {
  view: CalView;
  label: string;
  /** Same page, a different view - the date and every filter are kept. */
  hrefFor: (view: CalView) => string;
  todayHref: string;
  prevHref: string;
  nextHref: string;
  dayKey: string;
  actions?: React.ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <Link href={todayHref} className={btnCls}>Today</Link>
      <Link href={prevHref} className={navCls} aria-label={`Previous ${view}`}><ChevronLeft size={16} /></Link>
      <Link href={nextHref} className={navCls} aria-label={`Next ${view}`}><ChevronRight size={16} /></Link>
      <DateJump dayKey={dayKey} label={label} />

      {/* Segmented view switch. `aria-current` is what tells a reader which one is on, since the
          only other cue is the fill. */}
      <div className="ml-auto flex items-center rounded-field border border-line p-0.5" role="group" aria-label="Calendar view">
        {CAL_VIEWS.map((v) => (
          <Link
            key={v}
            href={hrefFor(v)}
            aria-current={v === view ? "true" : undefined}
            className={`rounded-[7px] px-3 py-1 text-xs font-medium capitalize transition-colors ${
              v === view ? "bg-accent text-on-accent" : "text-muted hover:bg-surface-2 hover:text-ink"
            }`}
          >
            {v}
          </Link>
        ))}
      </div>

      <Link href="/bookings/availability" className={btnCls}>
        <CalendarPlus size={14} /> Manage availability
      </Link>
      {actions}
    </div>
  );
}
