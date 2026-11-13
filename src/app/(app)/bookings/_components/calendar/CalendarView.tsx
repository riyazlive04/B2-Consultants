import { Plus } from "lucide-react";
import type { CalEvent } from "@/lib/calendar-event";
import { isDefaultFilters, showsNothing, type CalFilters } from "@/lib/calendar-filters";
import { addDays, dayColumns, weekDays } from "@/lib/calendar-grid";
import { EmptyState } from "@/components/ui/kit";
import { CalendarToolbar, type CalView } from "./Toolbar";
import { CalendarHost } from "./CalendarHost";
import { ManageView } from "./ManageView";
import { MonthGrid } from "./MonthGrid";
import { TimeGrid, type GridColumn } from "./TimeGrid";

/**
 * The Calendars grid: Synamate's three views over B2's own slots.
 *
 * Server-rendered. `view`, `date` and the filters are read from the URL by the page, so this
 * component is given its state rather than holding any - which is what lets Back, refresh and a
 * pasted link all land on the same screen.
 */

const dmy = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
const dowShort = new Intl.DateTimeFormat("en-GB", { weekday: "short", timeZone: "UTC" });
const monthYear = new Intl.DateTimeFormat("en-GB", { month: "long", year: "numeric", timeZone: "UTC" });
/** Day keys are plain calendar dates; parse as UTC so no zone can shift the day. */
const asDate = (dayKey: string) => new Date(`${dayKey}T00:00:00Z`);

export function rangeLabel(view: CalView, dayKey: string): string {
  if (view === "day") return dmy.format(asDate(dayKey));
  if (view === "month") return monthYear.format(asDate(dayKey));
  const days = weekDays(dayKey);
  return `${dmy.format(asDate(days[0]))} - ${dmy.format(asDate(days[6]))}`;
}

/** How far Today/‹/› steps: a day, a week, or to the same date in the next month. */
export function stepDate(view: CalView, dayKey: string, dir: 1 | -1): string {
  if (view === "day") return addDays(dayKey, dir);
  if (view === "week") return addDays(dayKey, 7 * dir);
  const d = asDate(dayKey);
  // Clamped by Date itself: 31 Jan + 1 month would otherwise land in March.
  const target = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + dir, 1));
  const lastDay = new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0)).getUTCDate();
  target.setUTCDate(Math.min(d.getUTCDate(), lastDay));
  return target.toISOString().slice(0, 10);
}

export function CalendarView({
  view, dayKey, todayKey, events, team, filters, panelOpen, canSetSss, hrefFor, toolbarActions,
}: {
  view: CalView;
  dayKey: string;
  todayKey: string;
  events: CalEvent[];
  team: { id: string; name: string | null }[];
  filters: CalFilters;
  panelOpen: boolean;
  /** Whether this person may confirm a strategy session (that action belongs to Outreach). */
  canSetSss: boolean;
  /** Builds a URL for this page with some params changed, keeping the rest. */
  hrefFor: (patch: Record<string, string>) => string;
  toolbarActions?: React.ReactNode;
}) {
  const columns: GridColumn[] =
    view === "week"
      ? weekDays(dayKey).map((key) => ({
          key,
          dayKey: key,
          label: dowShort.format(asDate(key)),
          sublabel: String(Number(key.slice(8))),
          isToday: key === todayKey,
          events,
        }))
      : dayColumns(events, dayKey, team).map((c) => ({
          key: c.id || "unassigned",
          dayKey,
          label: c.name,
          events: c.events,
        }));

  const hiddenByFilter = showsNothing(filters);
  const isDefault = isDefaultFilters(filters);

  const grid = hiddenByFilter ? (
    <EmptyState
      title="Nothing is selected"
      body="Every team member or calendar is unticked in Manage view, so there is nothing to draw."
    />
  ) : view === "month" ? (
    <MonthGrid events={events} dayKey={dayKey} todayKey={todayKey} />
  ) : view === "day" && columns.length === 0 ? (
    // Day view is one column per person with something on; with nothing booked there is no
    // column to draw, so say so rather than render an empty 24-hour ruler.
    <EmptyState title="Nothing booked on this day" body="Blocked time and booked calls appear here, one column per team member." />
  ) : (
    <TimeGrid columns={columns} />
  );

  return (
    <CalendarHost events={events} team={team} dayKey={dayKey} canSetSss={canSetSss}>
    <div className="space-y-3">
      <CalendarToolbar
        view={view}
        dayKey={dayKey}
        label={rangeLabel(view, dayKey)}
        hrefFor={(v) => hrefFor({ view: v })}
        todayHref={hrefFor({ date: todayKey })}
        prevHref={hrefFor({ date: stepDate(view, dayKey, -1) })}
        nextHref={hrefFor({ date: stepDate(view, dayKey, 1) })}
        manageHref={panelOpen ? hrefFor({ panel: "" }) : hrefFor({ panel: "1" })}
        manageOpen={panelOpen}
        filtersOn={!isDefault}
        actions={
          <>
            {/* No onClick: CalendarHost listens for this above (same path as a card or a lane). */}
            <button
              type="button"
              data-new-entry="1"
              className="inline-flex h-9 items-center gap-1.5 rounded-btn bg-accent px-3 text-sm font-semibold text-on-accent transition-opacity hover:opacity-90"
            >
              <Plus size={15} aria-hidden /> New
            </button>
            {toolbarActions}
          </>
        }
      />

      {/* The panel takes its width from the grid rather than covering it - as an overlay it hid
          Saturday and Sunday, which are exactly the columns someone filtering is looking at. */}
      <div className="flex flex-col gap-3 lg:flex-row">
        <div className="min-w-0 flex-1">{grid}</div>
        {panelOpen && <ManageView filters={filters} team={team} closeHref={hrefFor({ panel: "" })} />}
      </div>
    </div>
    </CalendarHost>
  );
}
