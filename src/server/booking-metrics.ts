import "server-only";
import { prisma } from "@/lib/prisma";
import { istMonthRange, istToday } from "@/lib/dates";
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
  const month = istMonthRange(istToday());

  const [openSlots, upcomingSlots, monthBookings, bookings] = await Promise.all([
    prisma.appointmentSlot.count({ where: { status: "OPEN", startsAt: { gt: now } } }),
    prisma.appointmentSlot.findMany({
      where: { startsAt: { gt: now } },
      orderBy: { startsAt: "asc" },
      take: 60,
      include: { booking: { select: { id: true, name: true } } },
    }),
    prisma.bookingRequest.findMany({
      where: { createdAt: { gte: month.start, lt: month.end } },
      select: { bantScore: true, status: true },
    }),
    prisma.bookingRequest.findMany({
      orderBy: { createdAt: "desc" },
      take: 300,
      include: { slot: { select: { startsAt: true } }, lead: { select: { id: true } } },
    }),
  ]);

  const bookedThisMonth = monthBookings.length;
  const avgBant =
    bookedThisMonth > 0
      ? monthBookings.reduce((a, b) => a + b.bantScore, 0) / bookedThisMonth
      : 0;
  const highBant = monthBookings.filter((b) => b.bantScore >= 3).length;
  const noShows = monthBookings.filter((b) => b.status === "NO_SHOW").length;

  return {
    kpis: { openSlots, bookedThisMonth, avgBant, highBant, noShows },
    slots: upcomingSlots.map((s) => ({
      id: s.id,
      day: istDay.format(s.startsAt),
      time: istTime.format(s.startsAt),
      cet: formatDateTimeInZone(s.startsAt, "Europe/Berlin"),
      status: s.status,
      bookedName: s.booking?.name ?? null,
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
      slotDay: b.slot ? istDay.format(b.slot.startsAt) : "-",
      slotTime: b.slot ? istTime.format(b.slot.startsAt) : "",
      slotCet: b.slot ? formatDateTimeInZone(b.slot.startsAt, "Europe/Berlin") : "",
      bantScore: b.bantScore,
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
  };
}

export type BookingsOverview = Awaited<ReturnType<typeof getBookingsOverview>>;
export type BookingRow = BookingsOverview["bookings"][number];
export type SlotRow = BookingsOverview["slots"][number];
