import Link from "next/link";
import {
  CalendarCheck,
  CalendarClock,
  ChevronLeft,
  ChevronRight,
  ExternalLink,
  Flame,
  PhoneCall,
  Target,
} from "lucide-react";
import { MetricCard } from "@/components/ui/MetricCard";
import { Tabs } from "@/components/ui/Tabs";
import { istToday, istWeekRange, istWallToUtc, parseDateInput, toDateInputValue } from "@/lib/dates";
import { BOOKING_STATUS_LABELS } from "@/lib/labels";
import { requireSection } from "@/lib/rbac";
import { getBookingsOverview, getWeekSlots, type WeekSlot } from "@/server/booking-metrics";
import { getWhatsAppStatusMap } from "@/server/whatsapp";
import { SlotManager } from "./_components/SlotManager";
import { BookingsTable } from "./_components/BookingsTable";

export const dynamic = "force-dynamic";

// Event-card tint per slot state (calendar design: pastel card + solid left edge)
const slotStyle = (s: WeekSlot) => {
  if (s.booking?.status === "NO_SHOW" || s.booking?.status === "CANCELLED") {
    return { bg: "var(--risk-soft)", edge: "var(--risk)" };
  }
  if (s.status === "BOOKED") return { bg: "color-mix(in srgb, var(--chart-1) 10%, white)", edge: "var(--chart-1)" };
  if (s.status === "OPEN") return { bg: "color-mix(in srgb, var(--ok) 10%, white)", edge: "var(--ok)" };
  return { bg: "var(--surface-2)", edge: "var(--muted)" }; // BLOCKED
};

export default async function BookingsPage({ searchParams }: { searchParams: { week?: string } }) {
  await requireSection("bookings");

  // Week selection - ?week=YYYY-MM-DD (any day inside the wanted week), default today
  const ref = /^\d{4}-\d{2}-\d{2}$/.test(searchParams.week ?? "") ? parseDateInput(searchParams.week!) : istToday();
  const week = istWeekRange(ref);
  const weekStartUtc = istWallToUtc(toDateInputValue(week.start), "00:00");
  const weekEndUtc = istWallToUtc(toDateInputValue(week.end), "00:00");

  const [{ kpis, slots, bookings }, weekSlots] = await Promise.all([
    getBookingsOverview(),
    getWeekSlots(weekStartUtc, weekEndUtc),
  ]);
  const waByBooking = await getWhatsAppStatusMap("bookingRequestId", bookings.map((b) => b.id));
  const bookingUrl = `${process.env.BETTER_AUTH_URL ?? ""}/book`;

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
  const weekLabel = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short" }).format(week.start) +
    " - " +
    new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", year: "numeric" }).format(
      new Date(weekEndUtc.getTime() - 86400000),
    );

  const weekCounts = {
    booked: weekSlots.filter((s) => s.status === "BOOKED").length,
    open: weekSlots.filter((s) => s.status === "OPEN").length,
    blocked: weekSlots.filter((s) => s.status === "BLOCKED").length,
  };
  const nextBooked = slots.find((s) => s.status === "BOOKED" && s.bookedName);

  return (
    <div className="mx-auto max-w-7xl space-y-6">
      {/* Header strip */}
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-card border border-line bg-surface px-5 py-4 shadow-card">
        <div className="flex items-center gap-3">
          <span className="grid h-10 w-10 flex-none place-items-center rounded-field bg-accent-soft text-accent">
            <CalendarCheck size={20} />
          </span>
          <div>
            <h1 className="font-display text-2xl font-bold tracking-tight sm:text-3xl">Bookings</h1>
            <p className="text-xs text-muted">
              Discovery-call bookings and availability - in-house, replacing Synamate.
            </p>
          </div>
        </div>
        <a
          href="/book"
          target="_blank"
          className="flex items-center gap-1.5 rounded-full bg-accent-soft px-3.5 py-1.5 text-xs font-semibold text-accent transition-opacity hover:opacity-80"
        >
          <ExternalLink size={13} /> {bookingUrl || "/book"}
        </a>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <MetricCard label="Open slots (upcoming)" value={kpis.openSlots} secondary="Available to book right now" icon={<CalendarClock size={18} />} />
        <MetricCard label="Booked this month" value={kpis.bookedThisMonth} icon={<CalendarCheck size={18} />} />
        <MetricCard
          label="Avg BANT score"
          value={kpis.avgWeighted !== null ? kpis.avgWeighted.toFixed(1) : kpis.avgBant.toFixed(1)}
          secondary={kpis.avgWeighted !== null ? "Weighted, out of 5 - this month" : "Out of 4 - this month"}
          tooltip="Weighted average of the four BANT dimension scores. Above 3 = confirm the call, 2-3 = go but doubtful, below 2 = cancel recommended."
          signal={
            kpis.bookedThisMonth === 0
              ? undefined
              : kpis.avgWeighted !== null
                ? kpis.avgWeighted > 3 ? "ok" : kpis.avgWeighted >= 2 ? "watch" : "risk"
                : kpis.avgBant >= 3 ? "ok" : kpis.avgBant >= 2 ? "watch" : "risk"
          }
          icon={<Target size={18} />}
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
              <li className="flex items-center gap-2 border-t border-line pt-2">
                <span className="h-2.5 w-2.5 flex-none rounded-full" style={{ background: "var(--risk)" }} />
                <span className="flex-1 text-muted">No-shows (month)</span>
                <span className="font-semibold tnum">{kpis.noShows}</span>
              </li>
            </ul>
          </div>
        </div>

        <div className="rounded-card border border-line bg-surface p-5 shadow-card lg:col-span-3">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h3 className="font-display text-lg font-semibold">{weekLabel}</h3>
            <div className="flex items-center gap-1">
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
                        const st = slotStyle(s);
                        return (
                          <div
                            key={s.id}
                            className="rounded-field p-2"
                            style={{ background: st.bg, borderLeft: `3px solid ${st.edge}` }}
                            title={
                              s.booking
                                ? `${s.booking.name} · ${s.time} IST · BANT ${s.booking.bantScore}/4 · ${BOOKING_STATUS_LABELS[s.booking.status] ?? s.booking.status}`
                                : `${s.status === "OPEN" ? "Open slot" : "Blocked"} · ${s.time} IST`
                            }
                          >
                            <p className="text-[11px] font-medium text-muted">
                              {s.time} · {s.durationMins}m
                            </p>
                            <p className="truncate text-xs font-semibold">
                              {s.booking ? s.booking.name : s.status === "OPEN" ? "Open slot" : "Blocked"}
                            </p>
                            {s.booking && (
                              <p className="mt-0.5 flex items-center gap-1 text-[10px] text-muted">
                                <span className="rounded-full bg-white/70 px-1.5 py-px font-medium">
                                  BANT {s.booking.bantScore}/4
                                </span>
                                {s.booking.status !== "BOOKED" && (
                                  <span className="truncate">{BOOKING_STATUS_LABELS[s.booking.status] ?? s.booking.status}</span>
                                )}
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
                No slots this week - generate availability in the tab below.
              </p>
            )}
          </div>
        </div>
      </div>

      <Tabs
        tabs={[
          { label: "Bookings", content: <BookingsTable rows={bookings} waStatus={waByBooking} /> },
          { label: "Availability", content: <SlotManager slots={slots} /> },
        ]}
      />
    </div>
  );
}
