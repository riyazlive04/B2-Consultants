import Link from "next/link";
import {
  CalendarCheck,
  CalendarClock,
  CalendarPlus,
  ChevronLeft,
  ChevronRight,
  ExternalLink,
  Flame,
  PhoneCall,
  Target,
} from "lucide-react";
import { MetricCard } from "@/components/ui/MetricCard";
import { PageHeader } from "@/components/ui/kit";
import { Tabs } from "@/components/ui/Tabs";
import { bantSignal, resolveBant } from "@/lib/bant-view";
import { slotHold, type SlotHold } from "@/lib/booking-hold";
import { slotTint } from "@/lib/slot-tint";
import { istToday, istWeekRange, istWallToUtc, parseDateInput, toDateInputValue } from "@/lib/dates";
import { formatDate } from "@/lib/format";
import { BOOKING_STATUS_LABELS, SLOT_HOLD_LABELS, SLOT_RELEASE_REASON_LABELS, slotTypeLabel } from "@/lib/labels";
import { requireSection } from "@/lib/rbac";
import { getBookableTeamMembers, getBookingsOverview, getWeekSlots, type WeekSlot } from "@/server/booking-metrics";
import { getBookingCalendars, getBookingRulesConfig, getSssConfig } from "@/server/founder-config";
import { getWhatsAppStatusMap } from "@/server/whatsapp";
import { listSssSlots, listSssNeedsScheduling } from "@/server/sss-slots";
import { listSlotReleases, releasesBySlotForWeek } from "@/server/slot-release";
import { BookingsTable } from "./_components/BookingsTable";
import { CancelledSlotsTable } from "./_components/CancelledSlotsTable";
import { SssCalendar } from "./_components/SssCalendar";

export const dynamic = "force-dynamic";

/**
 * Event-card tint per slot state (calendar design: pastel card + solid left edge).
 *
 * Mixed against `--surface`, NOT against the literal `white`. Hardcoding white produced a
 * light-blue chip on a dark card in dark mode - which is a large part of why this page "felt
 * broken": every booked and open slot on the week grid rendered as a bright rectangle nothing
 * else on the screen matched. `--surface` follows the theme, so the same 10% mix reads as a
 * subtle tint in both. (Design system §: never hardcode `white`; use the token.)
 */
const slotStyle = (s: WeekSlot, hold: SlotHold | null) => {
  if (s.booking?.status === "NO_SHOW" || s.booking?.status === "CANCELLED") return slotTint("RISK");
  /**
   * A slot held for someone who has not answered yet gets its own colour.
   *
   * It used to be the same blue card as a confirmed call, separated by a 6px dot - so the single
   * question this calendar is asked ("is that slot actually taken?") could not be answered by
   * looking at it. Amber is the app's "watch" token: held, not settled.
   */
  if (s.status === "BOOKED" && hold && hold.state !== "CONFIRMED") return slotTint("HELD");
  if (s.status === "BOOKED") return slotTint("BOOKED");
  if (s.status === "OPEN") return slotTint("OPEN");
  return slotTint("BLOCKED");
};

/** Compact IST clock for the "comes back at…" line - the whole date is already the column. */
const istClock = new Intl.DateTimeFormat("en-GB", {
  hour: "2-digit", minute: "2-digit", hour12: true, timeZone: "Asia/Kolkata",
});
const istStamp = new Intl.DateTimeFormat("en-GB", {
  weekday: "short", hour: "2-digit", minute: "2-digit", hour12: true, timeZone: "Asia/Kolkata",
});

/** "no reply" / "cancelled" / "postponed" - the reason, mid-sentence. */
const reasonWord = (reason: string) => (SLOT_RELEASE_REASON_LABELS[reason] ?? reason).toLowerCase();

/**
 * The tooltip tail for a slot that came back: who had it, why they lost it, and whether anyone
 * took it afterwards. Empty for a slot that was never booked, which is most of them.
 */
function freedTitle(freed: { prospectName: string; reason: string; promotedName: string | null } | undefined) {
  if (!freed) return "";
  const promoted = freed.promotedName ? `, ${freed.promotedName} moved in` : "";
  return ` · Freed: ${freed.prospectName} - ${reasonWord(freed.reason)}${promoted}`;
}

/** One line saying what the hold is waiting on, and when it runs out. */
function holdNote(hold: SlotHold): { chip: string | null; title: string } {
  if (hold.state === "CONFIRMED") return { chip: null, title: "Confirmed - they replied YES" };
  if (hold.state === "NOT_ASKED") {
    return {
      chip: null,
      title: hold.askAt
        ? `Held - we ask them to confirm on ${istStamp.format(hold.askAt)} IST`
        : "Held - no confirm request is scheduled (the confirmation loop is off)",
    };
  }
  return hold.releaseAt
    ? { chip: `frees ${istClock.format(hold.releaseAt)}`, title: `Held - asked on ${istStamp.format(hold.askedAt)} IST. Released at ${istStamp.format(hold.releaseAt)} IST if they stay silent.` }
    : { chip: null, title: `Held - asked on ${istStamp.format(hold.askedAt)} IST. Nothing is released automatically, so this one is yours to judge.` };
}

/**
 * One prospect's score as a calendar chip.
 *
 * "Not scored" is a first-class result and is NEVER rendered as 0. An unscored prospect is one
 * nobody has evidence about; showing them as 0.0/4 beside genuinely poor prospects is how a good
 * lead gets deprioritised for never having been asked. (`lib/bant-view.ts` states the same rule
 * for every other surface - this page was the one rendering the raw column instead.)
 */
function bantLabel(bant: { avg: number; origin: string } | null): string {
  return bant ? `BANT ${bant.avg.toFixed(1)}/4` : "Not scored";
}

export default async function BookingsPage({ searchParams }: { searchParams: { week?: string } }) {
  const session = await requireSection("bookings");
  const canConfigure = session.role === "ADMIN";

  // Week selection - ?week=YYYY-MM-DD (any day inside the wanted week), default today
  const ref = /^\d{4}-\d{2}-\d{2}$/.test(searchParams.week ?? "") ? parseDateInput(searchParams.week!) : istToday();
  const week = istWeekRange(ref);
  const weekStartUtc = istWallToUtc(toDateInputValue(week.start), "00:00");
  const weekEndUtc = istWallToUtc(toDateInputValue(week.end), "00:00");

  const [
    { kpis, slots, bookings, openSlots },
    weekSlots, teamMembers, rules, sssSlots, sssNeeds, sssConfig, slotPattern,
    weekReleases, slotReleases,
  ] =
    await Promise.all([
      getBookingsOverview(),
      getWeekSlots(weekStartUtc, weekEndUtc),
      getBookableTeamMembers(),
      getBookingRulesConfig(),
      listSssSlots(weekStartUtc, weekEndUtc),
      listSssNeedsScheduling(),
      getSssConfig(),
      // Read so the page can EXPLAIN an empty calendar instead of just showing one - see the
      // availability banner below.
      getBookingCalendars(),
      // Which of this week's slots came back, and why - so a freed cell says "Priya never replied"
      // rather than looking like a slot nobody ever booked.
      releasesBySlotForWeek(weekStartUtc, weekEndUtc),
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

  const todayKey = toDateInputValue(istToday());
  const days = Array.from({ length: 7 }, (_, i) => {
    const d = new Date(week.start);
    d.setUTCDate(week.start.getUTCDate() + i);
    return {
      key: toDateInputValue(d),
      name: new Intl.DateTimeFormat("en-GB", { weekday: "short" }).format(d),
      num: d.getUTCDate(),
    };
  });
  const weekNav = (offsetDays: number) => {
    const d = new Date(week.start);
    d.setUTCDate(week.start.getUTCDate() + offsetDays);
    return `/bookings?week=${toDateInputValue(d)}`;
  };
  const weekLabel = `${formatDate(week.start)} - ${formatDate(new Date(weekEndUtc.getTime() - 86400000))}`;

  /**
   * The hold on each booked slot, worked out once for the whole grid.
   *
   * `slotHold` is pure (lib/booking-hold) and restates the engine's own arithmetic, so what the
   * calendar promises - "this comes back at 14:30" - is what booking-automation.ts will do.
   */
  const holdFor = (s: WeekSlot): SlotHold | null =>
    s.status === "BOOKED" && s.booking && s.booking.status === "BOOKED"
      ? slotHold({
          slotStartsAt: new Date(s.startsAt),
          confirmedAt: s.booking.confirmedAt ? new Date(s.booking.confirmedAt) : null,
          confirmSentAt: s.booking.confirmSentAt ? new Date(s.booking.confirmSentAt) : null,
          rules,
        })
      : null;

  const weekCounts = {
    booked: weekSlots.filter((s) => s.status === "BOOKED").length,
    open: weekSlots.filter((s) => s.status === "OPEN").length,
    blocked: weekSlots.filter((s) => s.status === "BLOCKED").length,
    /**
     * Booked but nobody has said yes - every amber card on the grid, which is what this legend
     * row has to count. Narrowing it to AWAITING_REPLY would have printed "1" beside a dot
     * matching three cards: a slot nobody has been asked about yet is just as unconfirmed, it is
     * only earlier in the same story.
     */
    held: weekSlots.filter((s) => {
      const h = holdFor(s);
      return h !== null && h.state !== "CONFIRMED";
    }).length,
    freed: weekSlots.filter((s) => weekReleases[s.id]).length,
  };
  const nextBooked = slots.find((s) => s.status === "BOOKED" && s.bookedName);

  const openSlotsByAssignee = new Map<string, number>();
  for (const s of openSlots) {
    const name = s.assignedToName ?? "Unassigned";
    openSlotsByAssignee.set(name, (openSlotsByAssignee.get(name) ?? 0) + 1);
  }

  return (
    <div className="w-full space-y-6">
      {/* The shared header, not a bespoke strip. This page used to hand-roll its own icon chip,
          type scale and action slot - one of five pages that did, which is what made the app's
          dashboards look like five different products. */}
      <PageHeader
        icon={<CalendarCheck size={20} />}
        title="Bookings"
        subtitle="Discovery-call bookings and availability - in-house, replacing Synamate."
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
          Named cause, named cure, one click away. Without this the page shows four zeroes and
          an empty week, which reads as "the booking system is broken" rather than "nobody has
          set the working hours yet" - and the prospect on /book sees the same empty calendar. */}
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
            <Link href="/console" className="font-semibold underline">
              Console → Availability
            </Link>
            .
          </p>
        </div>
      )}

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <MetricCard
          label="Open slots (upcoming)"
          value={kpis.openSlots}
          secondary="Available to book right now"
          icon={<CalendarClock size={18} />}
          detail={{
            rows: [...openSlotsByAssignee.entries()].map(([name, count]) => ({ label: name, value: count })),
          }}
        />
        <MetricCard
          label="Booked this month"
          value={kpis.bookedThisMonth}
          icon={<CalendarCheck size={18} />}
          detail={{
            rows: [
              { label: BOOKING_STATUS_LABELS.BOOKED, value: kpis.statusCounts.booked },
              { label: BOOKING_STATUS_LABELS.RESCHEDULED, value: kpis.statusCounts.rescheduled },
              { label: BOOKING_STATUS_LABELS.CANCELLED, value: kpis.statusCounts.cancelled },
              { label: BOOKING_STATUS_LABELS.COMPLETED, value: kpis.statusCounts.completed },
              { label: BOOKING_STATUS_LABELS.NO_SHOW, value: kpis.statusCounts.noShow },
            ],
          }}
        />
        <MetricCard
          label="Avg BANT score"
          value={kpis.avgWeighted !== null ? kpis.avgWeighted.toFixed(1) : kpis.avgBant.toFixed(1)}
          secondary={kpis.avgWeighted !== null ? "Weighted, out of 4 - this month" : "Out of 4 - this month"}
          tooltip="Weighted average of the four BANT dimension scores. Above 2.4 = confirm the call, 1.6-2.4 = go but doubtful, below 1.6 = cancel recommended."
          signal={
            kpis.bookedThisMonth === 0
              ? undefined
              : kpis.avgWeighted !== null
                ? bantSignal(kpis.avgWeighted)
                : kpis.avgBant >= 3 ? "ok" : kpis.avgBant >= 2 ? "watch" : "risk"
          }
          icon={<Target size={18} />}
          detail={{
            rows: [
              { label: "Confirm (avg > 3)", value: kpis.verdicts.confirm },
              { label: "Doubtful (avg 2-3)", value: kpis.verdicts.doubt },
              { label: "Cancel (avg < 2)", value: kpis.verdicts.cancel },
            ],
          }}
        />
        <MetricCard
          label="BANT verdicts"
          value={
            <span className="text-2xl">
              {kpis.verdicts.confirm} · {kpis.verdicts.doubt} · {kpis.verdicts.cancel}
            </span>
          }
          secondary="Confirm · Doubtful · Cancel - this month"
          signal={kpis.verdicts.cancel > kpis.verdicts.confirm ? "watch" : kpis.verdicts.confirm > 0 ? "ok" : undefined}
          icon={<Flame size={18} />}
          detail={{
            rows: [
              { label: "Confirm call", value: kpis.verdicts.confirm },
              { label: "Doubtful", value: kpis.verdicts.doubt },
              { label: "Cancel recommended", value: kpis.verdicts.cancel },
            ],
          }}
        />
      </div>

      {/* Week calendar + side rail (calendar design: rail left, week grid right) */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-4">
        <div className="space-y-4">
          <div className="rounded-card border border-line bg-surface p-5 shadow-card">
            <h3 className="flex items-center gap-2 font-display text-base font-semibold">
              <PhoneCall size={16} className="text-accent" /> Next call
            </h3>
            {nextBooked ? (
              <div className="mt-3 rounded-field p-3" style={{ background: "color-mix(in srgb, var(--chart-1) 10%, white)", borderLeft: "3px solid var(--chart-1)" }}>
                <p className="text-sm font-semibold">{nextBooked.bookedName}</p>
                {nextBooked.assignedToName && (
                  <p className="mt-0.5 text-xs text-muted">with {nextBooked.assignedToName}</p>
                )}
                <p className="mt-0.5 text-xs text-muted">{nextBooked.day} · {nextBooked.time} IST</p>
                <p className="text-xs text-muted">{nextBooked.cet} CET</p>
              </div>
            ) : (
              <p className="mt-3 text-sm text-muted">No booked calls coming up.</p>
            )}
          </div>

          <div className="rounded-card border border-line bg-surface p-5 shadow-card">
            <h3 className="font-display text-base font-semibold">This week</h3>
            <ul className="mt-3 space-y-2 text-sm">
              <li className="flex items-center gap-2">
                <span className="h-2.5 w-2.5 flex-none rounded-full" style={{ background: "var(--chart-1)" }} />
                <span className="flex-1 text-muted">Booked</span>
                <span className="font-semibold tnum">{weekCounts.booked}</span>
              </li>
              {/* Held but unanswered - the slots the confirmation loop is counting down on. */}
              <li className="flex items-center gap-2" title="Booked, but nobody has replied YES yet. Each card says when we ask - or, once asked, when the slot is released.">
                <span className="h-2.5 w-2.5 flex-none rounded-full" style={{ background: "var(--watch)" }} />
                <span className="flex-1 text-muted">Held, unconfirmed</span>
                <span className="font-semibold tnum">{weekCounts.held}</span>
              </li>
              <li className="flex items-center gap-2">
                <span className="h-2.5 w-2.5 flex-none rounded-full" style={{ background: "var(--ok)" }} />
                <span className="flex-1 text-muted">Open</span>
                <span className="font-semibold tnum">{weekCounts.open}</span>
              </li>
              <li className="flex items-center gap-2">
                <span className="h-2.5 w-2.5 flex-none rounded-full" style={{ background: "var(--muted)" }} />
                <span className="flex-1 text-muted">Blocked</span>
                <span className="font-semibold tnum">{weekCounts.blocked}</span>
              </li>
              <li className="flex items-center gap-2 border-t border-line pt-2" title="Slots that were booked and came back this week - listed under Cancelled slots.">
                <span className="h-2.5 w-2.5 flex-none rounded-full" style={{ background: "var(--accent)" }} />
                <span className="flex-1 text-muted">Freed this week</span>
                <span className="font-semibold tnum">{weekCounts.freed}</span>
              </li>
              <li className="flex items-center gap-2">
                <span className="h-2.5 w-2.5 flex-none rounded-full" style={{ background: "var(--risk)" }} />
                <span className="flex-1 text-muted">No-shows (month)</span>
                <span className="font-semibold tnum">{kpis.noShows}</span>
              </li>
            </ul>
          </div>
        </div>

        <div className="rounded-card border border-line bg-surface p-5 shadow-card lg:col-span-3">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h3 className="font-display text-h2 font-semibold">{weekLabel}</h3>
            <div className="flex items-center gap-1">
              {/* Availability lives next to the calendar it fills, but on its own ROUTE.
                  It was a dialog, and it had outgrown one: five settings stacked in a 600px
                  scrolling box, over a page scrolled somewhere else, with the browser's Back
                  button doing nothing. A link costs nothing here and gives that screen a URL,
                  working Back, and room for its fields. */}
              <Link
                href="/bookings/availability"
                className="inline-flex h-8 items-center gap-1.5 rounded-field border border-line px-3 text-xs font-medium text-muted transition-colors hover:bg-surface-2 hover:text-ink"
              >
                <CalendarPlus size={14} /> Manage availability
              </Link>
              <Link href={weekNav(-7)} className="grid h-8 w-8 place-items-center rounded-field border border-line text-muted transition-colors hover:bg-surface-2 hover:text-ink" aria-label="Previous week">
                <ChevronLeft size={16} />
              </Link>
              <Link href="/bookings" className="rounded-field border border-line px-3 py-1.5 text-xs font-medium text-muted transition-colors hover:bg-surface-2 hover:text-ink">
                Today
              </Link>
              <Link href={weekNav(7)} className="grid h-8 w-8 place-items-center rounded-field border border-line text-muted transition-colors hover:bg-surface-2 hover:text-ink" aria-label="Next week">
                <ChevronRight size={16} />
              </Link>
            </div>
          </div>

          <div className="mt-4 overflow-x-auto">
            <div className="grid min-w-[760px] grid-cols-7 gap-2">
              {days.map((d) => (
                <div key={d.key} className="min-w-0">
                  <div
                    className={`mb-2 rounded-field px-2 py-1.5 text-center text-xs font-medium ${
                      d.key === todayKey ? "bg-accent-soft text-accent" : "text-muted"
                    }`}
                  >
                    {d.name} <span className="font-display font-bold">{d.num}</span>
                  </div>
                  <div className="space-y-1.5">
                    {weekSlots
                      .filter((s) => s.dayKey === d.key)
                      .map((s) => {
                        const hold = holdFor(s);
                        const note = hold ? holdNote(hold) : null;
                        const freed = weekReleases[s.id];
                        const st = slotStyle(s, hold);
                        return (
                          <div
                            key={s.id}
                            className="rounded-field p-2"
                            style={{ background: st.bg, borderLeft: `3px solid ${st.edge}` }}
                            title={
                              s.booking
                                ? `${s.booking.name}${s.assignedToName ? ` · with ${s.assignedToName}` : ""} · ${s.time} IST · ${slotTypeLabel(s.durationMins)} · ${bantLabel(s.booking.bant)} · ${note ? note.title : s.booking.confirmed ? "Confirmed" : "Awaiting confirmation"} · ${BOOKING_STATUS_LABELS[s.booking.status] ?? s.booking.status}`
                                : `${s.status === "OPEN" ? "Open slot" : "Blocked"}${s.assignedToName ? ` · ${s.assignedToName}` : ""} · ${s.time} IST · ${slotTypeLabel(s.durationMins)}${freedTitle(freed)}`
                            }
                          >
                            <p className="text-caption font-medium text-muted">
                              {s.time} · {s.durationMins}m
                            </p>
                            <p className="flex items-center gap-1 truncate text-xs font-semibold">
                              {s.booking && (
                                <span
                                  aria-hidden
                                  className="h-1.5 w-1.5 flex-none rounded-full"
                                  title={note ? note.title : s.booking.confirmed ? "Confirmed" : "Awaiting confirmation"}
                                  style={{ background: s.booking.confirmed ? "var(--ok)" : "var(--watch)" }}
                                />
                              )}
                              <span className="truncate">
                                {s.booking ? s.booking.name : s.status === "OPEN" ? "Open slot" : "Blocked"}
                              </span>
                            </p>
                            {s.booking ? (
                              <p className="mt-0.5 flex items-center gap-1 text-caption text-muted">
                                {s.assignedToName && <span className="truncate">with {s.assignedToName}</span>}
                                {/* `--surface` mix, not `bg-white/70`: a translucent white chip
                                    on a dark card is unreadable in dark mode. */}
                                <span
                                  className="ml-auto flex-none rounded-full px-1.5 py-px font-medium"
                                  style={{ background: "color-mix(in srgb, var(--surface) 70%, transparent)" }}
                                >
                                  {bantLabel(s.booking.bant)}
                                </span>
                              </p>
                            ) : (
                              s.assignedToName && (
                                <p className="mt-0.5 truncate text-caption text-muted" title={s.assignedToName}>{s.assignedToName}</p>
                              )
                            )}

                            {/* ── What the hold is waiting on, and what became of a freed slot ──
                                The two facts a held-or-returned slot never showed. "frees 2:30 pm"
                                on an amber card is the whole confirm-or-cancel rule, in place, on
                                the slot it applies to; "Freed · Priya, no reply" stops a returned
                                slot from reading as one nobody ever wanted. */}
                            {note?.chip && (
                              <p className="mt-0.5 truncate text-caption font-medium text-watch-ink" title={note.title}>
                                {note.chip}
                              </p>
                            )}
                            {!s.booking && freed && (
                              <p className="mt-0.5 truncate text-caption text-muted" title={freedTitle(freed)}>
                                Freed · {freed.promotedName ? freed.promotedName + " moved in" : freed.prospectName + ", " + reasonWord(freed.reason)}
                              </p>
                            )}
                          </div>
                        );
                      })}
                  </div>
                </div>
              ))}
            </div>
            {weekSlots.length === 0 && (
              <p className="py-10 text-center text-sm text-muted">
                {availabilityOff ? (
                  <>
                    No slots exist at all - no availability pattern is configured. Set one at{" "}
                    <Link href="/console" className="font-semibold text-accent underline">
                      Console → Availability
                    </Link>
                    .
                  </>
                ) : (
                  <>
                    No slots this week -{" "}
                    <Link href="/bookings/availability#add-slots" className="font-semibold text-accent underline">
                      add availability
                    </Link>
                    .
                  </>
                )}
              </p>
            )}
          </div>
        </div>
      </div>

      {/* ── Two tabs, not three ──────────────────────────────────────────────────────────
          "Bookings" inside a page called "Bookings", sitting under a calendar that also shows
          bookings, read as the same thing three times. It is not: the calendar shows SLOTS
          (including empty and blocked ones), this shows BOOKING REQUESTS - the prospect's form,
          their BANT answers, their WhatsApp confirmation state and the confirm/postpone/cancel
          actions. Renaming it says so.

          "Availability" left the strip entirely. It is a SETUP screen - generate slots for a
          date range - not something anyone opens daily, and giving it equal billing with the two
          working views is what made this page feel like a pile of panels. It now lives behind
          "Manage availability" beside the week navigation. */}
      <Tabs
        tabs={[
          { label: `Booking requests${bookings.length ? ` (${bookings.length})` : ""}`, content: <BookingsTable rows={bookings} waStatus={waByBooking} teamMembers={teamMembers} openSlots={openSlots} /> },
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
                days={days}
                weekLabel={weekLabel}
                nav={{ prev: weekNav(-7), next: weekNav(7), today: "/bookings" }}
                canConfigure={canConfigure}
              />
            ),
          },
        ]}
      />
    </div>
  );
}
