import "server-only";
import { prisma } from "@/lib/prisma";
import { istMonthInstantRange, istToday } from "@/lib/dates";
import { formatDateTimeInZone } from "@/lib/format";
import { intakeLabel } from "@/lib/booking-intake";
import { resolveBant } from "@/lib/bant-view";

/** Admin Bookings overview (Wave-1) - the in-house replacement for Synamate's booking view. */

const istDay = new Intl.DateTimeFormat("en-GB", {
  weekday: "short", day: "2-digit", month: "short", timeZone: "Asia/Kolkata",
});
const istTime = new Intl.DateTimeFormat("en-GB", {
  hour: "2-digit", minute: "2-digit", hour12: true, timeZone: "Asia/Kolkata",
});
/**
 * Berlin clock time with no date.
 *
 * `formatDateTimeInZone` gives "Thu 01 Oct, 11:43 am CET" - correct, and exactly wrong for a list
 * grouped by day, where it printed the date a second time on every single row. The day is the
 * group heading now; a row only needs the hand on the clock.
 */
const cetClock = new Intl.DateTimeFormat("en-GB", {
  hour: "2-digit", minute: "2-digit", hour12: true, timeZone: "Europe/Berlin",
});
/** IST calendar day - the key both the week grid and the availability list group on. */
const istDateKey = new Intl.DateTimeFormat("en-CA", {
  year: "numeric", month: "2-digit", day: "2-digit", timeZone: "Asia/Kolkata",
});

export async function getBookingsOverview() {
  const now = new Date();
  // createdAt is a timestamp - use IST instants, not @db.Date midnight boundaries
  const month = istMonthInstantRange(istToday());

  const [openSlots, upcomingSlots, monthBookings, bookings, openSlotList] = await Promise.all([
    prisma.appointmentSlot.count({ where: { status: "OPEN", startsAt: { gt: now } } }),
    prisma.appointmentSlot.findMany({
      where: { startsAt: { gt: now } },
      orderBy: { startsAt: "asc" },
      take: 60,
      include: {
        booking: { select: { id: true, name: true } },
        assignedTo: { select: { id: true, name: true } },
      },
    }),
    prisma.bookingRequest.findMany({
      where: { createdAt: { gte: month.start, lt: month.end } },
      select: { bantScore: true, bantAvg: true, bantVerdict: true, status: true },
    }),
    prisma.bookingRequest.findMany({
      orderBy: { createdAt: "desc" },
      take: 300,
      include: {
        slot: { select: { startsAt: true, durationMins: true, assignedTo: { select: { id: true, name: true } } } },
        /**
         * The slot this booking gave back, if it has given one back.
         *
         * A cancel NULLS `slotId` (it is unique, so the slot cannot be re-booked otherwise), which
         * left this table printing "-" in the time column of every cancelled row - the one row
         * where "when was it?" is the whole question. One row, newest first.
         */
        slotReleases: {
          orderBy: { createdAt: "desc" },
          take: 1,
          select: { slotStartsAt: true, reason: true, releasedStatus: true, promotedName: true },
        },
        // The lead's own columns too, so `resolveBant` can fall back to the LANDING PAGE's
        // opt-in score for a booking that carries none. Without them a prospect who answered
        // the qualification questions at opt-in but not at booking showed as unscored here
        // while showing a score on My Desk - the same person, two answers.
        lead: {
          select: {
            id: true,
            bantAvg: true, bantScore: true, bantVerdict: true, bantSource: true,
            bantBudget: true, bantAuthority: true, bantNeed: true, bantTimeline: true,
          },
        },
      },
    }),
    // Upcoming OPEN slots - the pool the "Postpone to…" picker draws from.
    prisma.appointmentSlot.findMany({
      where: { status: "OPEN", startsAt: { gt: now } },
      orderBy: { startsAt: "asc" },
      take: 200,
      include: { assignedTo: { select: { id: true, name: true } } },
    }),
  ]);

  const bookedThisMonth = monthBookings.length;
  const avgBant =
    bookedThisMonth > 0
      ? monthBookings.reduce((a, b) => a + b.bantScore, 0) / bookedThisMonth
      : 0;
  const highBant = monthBookings.filter((b) => b.bantScore >= 3).length;
  const noShows = monthBookings.filter((b) => b.status === "NO_SHOW").length;
  // Weighted layer (client thresholds on 0-4: >2.4 confirm · 1.6-2.4 doubt · <1.6 cancel).
  // Legacy rows booked before the weighted scorer have no bantAvg - excluded from the mean.
  const scored = monthBookings.filter((b) => b.bantAvg !== null);
  const avgWeighted = scored.length
    ? scored.reduce((a, b) => a + (b.bantAvg ?? 0), 0) / scored.length
    : null;
  const verdicts = {
    confirm: monthBookings.filter((b) => b.bantVerdict === "CONFIRM").length,
    doubt: monthBookings.filter((b) => b.bantVerdict === "DOUBT").length,
    cancel: monthBookings.filter((b) => b.bantVerdict === "CANCEL").length,
  };
  const statusCounts = {
    booked: monthBookings.filter((b) => b.status === "BOOKED").length,
    rescheduled: monthBookings.filter((b) => b.status === "RESCHEDULED").length,
    cancelled: monthBookings.filter((b) => b.status === "CANCELLED").length,
    completed: monthBookings.filter((b) => b.status === "COMPLETED").length,
    noShow: monthBookings.filter((b) => b.status === "NO_SHOW").length,
  };

  return {
    kpis: { openSlots, bookedThisMonth, avgBant, avgWeighted, highBant, noShows, verdicts, statusCounts },
    slots: upcomingSlots.map((s) => ({
      id: s.id,
      day: istDay.format(s.startsAt),
      /** YYYY-MM-DD in IST - what the availability list groups on, and compares against today. */
      dayKey: istDateKey.format(s.startsAt),
      time: istTime.format(s.startsAt),
      cet: formatDateTimeInZone(s.startsAt, "Europe/Berlin"),
      /** Berlin clock only. The day heading already carries the date. */
      cetTime: cetClock.format(s.startsAt),
      durationMins: s.durationMins,
      status: s.status,
      bookedName: s.booking?.name ?? null,
      assignedToId: s.assignedTo?.id ?? null,
      assignedToName: s.assignedTo?.name ?? null,
    })),
    bookings: bookings.map((b) => ({
      id: b.id,
      leadId: b.lead?.id ?? null,
      name: b.name,
      email: b.email,
      phone: b.phone,
      city: b.city ?? "",
      jobTitle: b.currentJobTitle ?? "",
      industry: b.prospectIndustry ?? "",
      slotId: b.slotId,
      slotDay: b.slot ? istDay.format(b.slot.startsAt) : "-",
      slotTime: b.slot ? istTime.format(b.slot.startsAt) : "",
      slotCet: b.slot ? formatDateTimeInZone(b.slot.startsAt, "Europe/Berlin") : "",
      slotDurationMins: b.slot?.durationMins ?? null,
      slotStartsAt: b.slot ? b.slot.startsAt.toISOString() : null,
      assignedToId: b.slot?.assignedTo?.id ?? null,
      assignedToName: b.slot?.assignedTo?.name ?? null,
      // Confirmation loop (Module E): confirmed = the prospect said YES (WhatsApp) or was marked so.
      confirmed: b.confirmedAt !== null,
      confirmSent: b.confirmSentAt !== null,
      confirmSentAt: b.confirmSentAt ? b.confirmSentAt.toISOString() : null,
      /**
       * The slot it USED to hold. Deliberately a separate field rather than filling slotDay/slotTime
       * back in: a cancelled booking must not render a time that looks like a live appointment.
       * The UI shows it as "was <time>" with the reason.
       */
      released: b.slotReleases[0]
        ? {
            day: istDay.format(b.slotReleases[0].slotStartsAt),
            time: istTime.format(b.slotReleases[0].slotStartsAt),
            reason: b.slotReleases[0].reason,
            slotStatus: b.slotReleases[0].releasedStatus,
            promotedName: b.slotReleases[0].promotedName,
          }
        : null,
      // The ONE resolved snapshot every surface renders - booking score first, then the lead's
      // opt-in score, null when nobody has scored them. Callers must show null as "not scored".
      bant: resolveBant(b, b.lead),
      whenStart: intakeLabel("whenStartGermany", b.whenStartGermany),
      readyToInvest: intakeLabel("readyToInvest", b.readyToInvest),
      commitment: intakeLabel("commitment", b.commitment),
      status: b.status,
      createdAt: b.createdAt.toISOString(),
    })),
    openSlots: openSlotList.map((s) => ({
      id: s.id,
      day: istDay.format(s.startsAt),
      time: istTime.format(s.startsAt),
      cet: formatDateTimeInZone(s.startsAt, "Europe/Berlin"),
      durationMins: s.durationMins,
      assignedToId: s.assignedTo?.id ?? null,
      assignedToName: s.assignedTo?.name ?? null,
    })),
  };
}

/** All slots inside [weekStartUtc, weekEndUtc) for the week-calendar view, keyed by IST day. */
export async function getWeekSlots(weekStartUtc: Date, weekEndUtc: Date) {
  const slots = await prisma.appointmentSlot.findMany({
    where: { startsAt: { gte: weekStartUtc, lt: weekEndUtc } },
    orderBy: { startsAt: "asc" },
    include: {
      /**
       * Enough columns for `resolveBant`, plus the LEAD's own score.
       *
       * The calendar used to render `bantScore` straight off the booking as "BANT n/4", which is
       * the raw dimensions-met count and NOT what the table three inches below it shows - that
       * one goes through `resolveBant` and can display the weighted average, or the landing
       * page's opt-in score when the booking has none. Two surfaces, same prospect, different
       * numbers. `lib/bant-view.ts` exists precisely so this question is answered once.
       */
      booking: {
        select: {
          name: true, status: true, confirmedAt: true, confirmSentAt: true,
          bantScore: true, bantAvg: true, bantVerdict: true,
          bantBudget: true, bantAuthority: true, bantNeed: true, bantTimeline: true,
          lead: {
            select: {
              bantAvg: true, bantScore: true, bantVerdict: true, bantSource: true,
              bantBudget: true, bantAuthority: true, bantNeed: true, bantTimeline: true,
            },
          },
        },
      },
      assignedTo: { select: { name: true } },
    },
  });
  return slots.map((s) => ({
    id: s.id,
    dayKey: istDateKey.format(s.startsAt),
    time: istTime.format(s.startsAt),
    startsAt: s.startsAt.toISOString(),
    durationMins: s.durationMins,
    status: s.status,
    assignedToName: s.assignedTo?.name ?? null,
    booking: s.booking
      ? {
          name: s.booking.name,
          status: s.booking.status,
          confirmed: s.booking.confirmedAt !== null,
          /**
           * ISO strings, not Dates: this crosses the server→client boundary into the calendar,
           * which needs the exact stamps to say when an unanswered hold is released (lib/booking-hold).
           */
          confirmedAt: s.booking.confirmedAt ? s.booking.confirmedAt.toISOString() : null,
          confirmSentAt: s.booking.confirmSentAt ? s.booking.confirmSentAt.toISOString() : null,
          // Null when nobody has scored this prospect. The caller MUST render that as
          // "not scored" and never as 0 - see resolveBant's contract.
          bant: resolveBant(s.booking, s.booking.lead),
        }
      : null,
  }));
}

export type WeekSlot = Awaited<ReturnType<typeof getWeekSlots>>[number];

export type BookingsOverview = Awaited<ReturnType<typeof getBookingsOverview>>;
export type BookingRow = BookingsOverview["bookings"][number];
export type SlotRow = BookingsOverview["slots"][number];
export type OpenSlotOption = BookingsOverview["openSlots"][number];

/** Active users, for the "assign slots to a team member" picker and the bookings/slots
 *  filter dropdown (AppointmentSlot.assignedToId - previously written/read nowhere). */
export async function getBookableTeamMembers() {
  return prisma.user.findMany({
    where: { status: "ACTIVE" },
    select: { id: true, name: true },
    orderBy: { name: "asc" },
  });
}

export type TeamMemberOption = Awaited<ReturnType<typeof getBookableTeamMembers>>[number];
