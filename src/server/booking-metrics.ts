import "server-only";
import { prisma } from "@/lib/prisma";
import { istMonthInstantRange, istToday } from "@/lib/dates";
import { formatDateTimeInZone } from "@/lib/format";
import { intakeLabel } from "@/lib/booking-intake";

/** Admin Bookings overview (Wave-1) - the in-house replacement for Synamate's booking view. */

const istDay = new Intl.DateTimeFormat("en-GB", {
  weekday: "short", day: "2-digit", month: "short", timeZone: "Asia/Kolkata",
});
const istTime = new Intl.DateTimeFormat("en-GB", {
  hour: "2-digit", minute: "2-digit", hour12: true, timeZone: "Asia/Kolkata",
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
        lead: { select: { id: true } },
      },
    }),
    // Upcoming OPEN slots — the pool the "Postpone to…" picker draws from.
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
  // Weighted layer (client thresholds: >3 confirm · 2-3 doubt · <2 cancel).
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

  return {
    kpis: { openSlots, bookedThisMonth, avgBant, avgWeighted, highBant, noShows, verdicts },
    slots: upcomingSlots.map((s) => ({
      id: s.id,
      day: istDay.format(s.startsAt),
      time: istTime.format(s.startsAt),
      cet: formatDateTimeInZone(s.startsAt, "Europe/Berlin"),
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
      bantScore: b.bantScore,
      bantAvg: b.bantAvg,
      bantVerdict: b.bantVerdict,
      bantBudget: b.bantBudget,
      bantAuthority: b.bantAuthority,
      bantNeed: b.bantNeed,
      bantTimeline: b.bantTimeline,
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

const istDateKey = new Intl.DateTimeFormat("en-CA", {
  year: "numeric", month: "2-digit", day: "2-digit", timeZone: "Asia/Kolkata",
});

/** All slots inside [weekStartUtc, weekEndUtc) for the week-calendar view, keyed by IST day. */
export async function getWeekSlots(weekStartUtc: Date, weekEndUtc: Date) {
  const slots = await prisma.appointmentSlot.findMany({
    where: { startsAt: { gte: weekStartUtc, lt: weekEndUtc } },
    orderBy: { startsAt: "asc" },
    include: {
      booking: { select: { name: true, bantScore: true, status: true, confirmedAt: true } },
      assignedTo: { select: { name: true } },
    },
  });
  return slots.map((s) => ({
    id: s.id,
    dayKey: istDateKey.format(s.startsAt),
    time: istTime.format(s.startsAt),
    durationMins: s.durationMins,
    status: s.status,
    assignedToName: s.assignedTo?.name ?? null,
    booking: s.booking
      ? {
          name: s.booking.name,
          bantScore: s.booking.bantScore,
          status: s.booking.status,
          confirmed: s.booking.confirmedAt !== null,
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
