import Link from "next/link";
import { CalendarCheck, ExternalLink } from "lucide-react";
import { EngineOffNotice, PageHeader } from "@/components/ui/kit";
import { enginesOff } from "@/server/engine-status";
import { Tabs } from "@/components/ui/Tabs";
import { istToday, istWallToUtc, parseDateInput, toDateInputValue } from "@/lib/dates";
import { formatDate } from "@/lib/format";
import { requireSection } from "@/lib/rbac";
import { addDays, monthDays, weekDays } from "@/lib/calendar-grid";
import { getBookableTeamMembers, getBookingsOverview } from "@/server/booking-metrics";
import { getCalendarEvents } from "@/server/calendar-events";
import {
  getBookingCalendars,
  getSssConfig,
} from "@/server/founder-config";
import { getWhatsAppStatusMap } from "@/server/whatsapp";
import { listSssSlots, listSssNeedsScheduling } from "@/server/sss-slots";
import { listSlotReleases } from "@/server/slot-release";
import { BookingsTable } from "./_components/BookingsTable";
import { CancelledSlotsTable } from "./_components/CancelledSlotsTable";
import { SssCalendar } from "./_components/SssCalendar";
import { CalendarView } from "./_components/calendar/CalendarView";
import { CAL_VIEWS, type CalView } from "./_components/calendar/Toolbar";
import { consoleHref } from "@/lib/guide/manual-types";

/** Its own name in the browser tab, rather than sharing one title with every other page
 *  (issue 28). The root layout adds the "· B2 Consultants" suffix. */
export const metadata = { title: "Calendars" };

export const dynamic = "force-dynamic";

/** The IST days a view needs loaded: a day, a Monday-first week, or whole weeks of a month. */
function visibleDays(view: CalView, dayKey: string): string[] {
  if (view === "day") return [dayKey];
  return view === "week" ? weekDays(dayKey) : monthDays(dayKey);
}

export default async function BookingsPage({
  searchParams,
}: {
  searchParams: { week?: string; date?: string; view?: string };
}) {
  const session = await requireSection("bookings");
  /* `availability` is NOT asked for here: the block below already explains an empty calendar in
     more detail than the shared notice could, naming which of three causes applies. */
  const enginesDown = await enginesOff(["confirmLoop"]);
  const canConfigure = session.role === "ADMIN";

  const todayKey = toDateInputValue(istToday());
  const view: CalView = CAL_VIEWS.includes(searchParams.view as CalView) ? (searchParams.view as CalView) : "week";
  /** `?date=`; `?week=` is the old parameter and still honoured so existing links keep working. */
  const raw = searchParams.date ?? searchParams.week ?? "";
  const dayKey = /^\d{4}-\d{2}-\d{2}$/.test(raw) ? toDateInputValue(parseDateInput(raw)) : todayKey;

  // The grid's own window, in UTC instants: from the first visible IST day to the start of the
  // day after the last, so a late-evening IST call is not cut off by a UTC boundary.
  const days = visibleDays(view, dayKey);
  const from = istWallToUtc(days[0], "00:00");
  const to = istWallToUtc(addDays(days[days.length - 1], 1), "00:00");
  // The SSS tab still shows its own Monday-first week, independent of the calendar's view.
  const week = weekDays(todayKey === dayKey ? todayKey : dayKey);
  const weekStartUtc = istWallToUtc(week[0], "00:00");
  const weekEndUtc = istWallToUtc(addDays(week[6], 1), "00:00");

  const [
    { bookings, openSlots },
    events, teamMembers, sssSlots, sssNeeds, sssConfig, slotPattern, slotReleases,
  ] = await Promise.all([
    getBookingsOverview(),
    getCalendarEvents({ from, to }),
    getBookableTeamMembers(),
    listSssSlots(weekStartUtc, weekEndUtc),
    listSssNeedsScheduling(),
    getSssConfig(),
    // Read so the page can EXPLAIN an empty calendar instead of just showing one - see the
    // availability banner below.
    getBookingCalendars(),
    listSlotReleases(),
  ]);
  /**
   * Depends on `bookings`, so it cannot join the batch above - but it must not be a bare
   * sequential `await` either. Against Supabase in Singapore every round trip costs ~205ms, and
   * this one was paying that on every single load for a lookup that is empty whenever there are
   * no bookings. Skipped entirely in that case.
   */
  const waByBooking = bookings.length
    ? await getWhatsAppStatusMap("bookingRequestId", bookings.map((b) => b.id))
    : {};
  const bookingUrl = `${process.env.BETTER_AUTH_URL ?? ""}/book`;

  /**
   * The single most common reason this page looks broken: no availability pattern was ever
   * configured, so the hourly top-up job short-circuits, no slots exist, `/book` offers a
   * prospect an empty calendar, and every figure here reads zero with no explanation.
   *
   * Calendars ship as an empty list, and production ran that way - 0 slots, 0 bookings,
   * 23,545 leads - because nothing on any screen said so.
   */
  const liveCalendars = slotPattern.filter((c) => c.enabled && c.weekdays.length > 0);
  const availabilityOff = liveCalendars.length === 0;
  /** Switched on but toothless - the trap the banner below has to name specifically. */
  const enabledButEmpty = slotPattern.some((c) => c.enabled && c.weekdays.length === 0);

  /**
   * Counted the way the tab's own default filter counts: a postponed call is not a cancelled one.
   * The badge said 2 while the table below it showed 1, which is the fastest way to make a number
   * stop meaning anything.
   */
  const cancelledSlotCount = slotReleases.filter((r) => r.reason !== "POSTPONED").length;

  /** Keeps every other parameter (tab, and the filters features 3+ add) while changing one. */
  const hrefFor = (patch: Record<string, string>) => {
    const next = new URLSearchParams(
      Object.entries(searchParams).filter(([k, v]) => typeof v === "string" && k !== "week") as [string, string][],
    );
    next.set("view", view);
    next.set("date", dayKey);
    for (const [k, v] of Object.entries(patch)) next.set(k, v);
    return `/bookings?${next}`;
  };

  const sssWeekLabel = `${formatDate(new Date(weekStartUtc))} - ${formatDate(new Date(weekEndUtc.getTime() - 86400000))}`;
  const sssDays = week.map((key) => ({
    key,
    name: new Intl.DateTimeFormat("en-GB", { weekday: "short", timeZone: "UTC" }).format(new Date(`${key}T00:00:00Z`)),
    num: Number(key.slice(8)),
  }));

  return (
    <div className="w-full space-y-6">
      {/* The shared header, not a bespoke strip. This page used to hand-roll its own icon chip,
          type scale and action slot - one of five pages that did, which is what made the app's
          dashboards look like five different products. */}
      <PageHeader
        icon={<CalendarCheck size={20} />}
        title="Calendars"
        subtitle="Discovery and strategy calls on one calendar - in-house, replacing Synamate."
        actions={
          <a
            href="/book"
            target="_blank"
            className="flex items-center gap-1.5 rounded-full bg-accent-soft px-3.5 py-1.5 text-xs font-semibold text-accent transition-opacity hover:opacity-80"
          >
            <ExternalLink size={13} /> {bookingUrl || "/book"}
          </a>
        }
      />

      {/* ── Why the calendar is empty ────────────────────────────────────────────────────
          Named cause, named cure, one click away. Without this the page shows an empty week,
          which reads as "the booking system is broken" rather than "nobody has set the working
          hours yet" - and the prospect on /book sees the same empty calendar. */}
      {availabilityOff && (
        <div role="status" className="rounded-card border border-warn bg-warn-soft p-4">
          <p className="text-sm font-semibold text-warn-ink">
            No booking calendar is live - so no slots exist and nobody can book a call.
          </p>
          <p className="mt-1 text-caption text-warn-ink">
            {enabledButEmpty
              ? "A calendar is switched on but has no weekdays selected, so it fits no slots."
              : slotPattern.length === 0
                ? "Discovery slots are generated hourly from named weekly calendars, one per person. Until you add one, /book and every funnel booking page show prospects an empty calendar."
                : "Every calendar you have is switched off, so the hourly top-up creates nothing."}{" "}
            Set the weekdays, hours and owner at{" "}
            <Link href={consoleHref("sales", "availability")} className="font-semibold underline">
              Console → Availability
            </Link>
            .
          </p>
        </div>
      )}

      {/* Built, and switched off - said on the screen it affects rather than only on the
          Console, because an engine nobody armed is indistinguishable from a broken one. */}
      <EngineOffNotice engines={enginesDown} canOpenConsole={session.role === "ADMIN"} />

      {/* ── The calendar, then the lists ─────────────────────────────────────────────────
          Synamate's shape: the grid is the page, and the tables are tabs under it. The KPI
          strip and "Next call" panel that used to sit above the grid moved to the dashboard
          (one "Discovery calls" tile) - on a calendar, the calendar is the answer. */}
      <CalendarView
        view={view}
        dayKey={dayKey}
        todayKey={todayKey}
        events={events}
        team={teamMembers}
        hrefFor={hrefFor}
      />

      {/* Keeps the open tab in the address, so a refresh (or a shared link) does not drop
          back to the first tab (issue 28). */}
      <Tabs
        urlKey="tab"
        tabs={[
          { label: `Booking requests${bookings.length ? ` (${bookings.length})` : ""}`, content: <BookingsTable rows={bookings} waStatus={waByBooking} teamMembers={teamMembers} openSlots={openSlots} canExport={canConfigure} /> },
          {
            /**
             * The slots we gave back. Its own view because a release is the one booking event with
             * no row anywhere else: the booking lost its time the moment `slotId` was nulled, and
             * the slot itself looks untouched once it reopens.
             */
            label: `Cancelled slots${cancelledSlotCount ? ` (${cancelledSlotCount})` : ""}`,
            content: <CancelledSlotsTable rows={slotReleases} />,
          },
          {
            label: "SSS Calendar",
            content: (
              <SssCalendar
                slots={sssSlots}
                needsScheduling={sssNeeds}
                config={sssConfig}
                teamMembers={teamMembers}
                days={sssDays}
                weekLabel={sssWeekLabel}
                nav={{
                  prev: hrefFor({ date: addDays(dayKey, -7) }),
                  next: hrefFor({ date: addDays(dayKey, 7) }),
                  today: hrefFor({ date: todayKey }),
                }}
                canConfigure={canConfigure}
              />
            ),
          },
        ]}
      />
    </div>
  );
}
