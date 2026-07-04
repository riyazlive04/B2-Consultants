import { CalendarCheck, CalendarClock, Flame, Target } from "lucide-react";
import { MetricCard } from "@/components/ui/MetricCard";
import { Tabs } from "@/components/ui/Tabs";
import { requireSection } from "@/lib/rbac";
import { getBookingsOverview } from "@/server/booking-metrics";
import { SlotManager } from "./_components/SlotManager";
import { BookingsTable } from "./_components/BookingsTable";

export const dynamic = "force-dynamic";

export default async function BookingsPage() {
  await requireSection("bookings");
  const { kpis, slots, bookings } = await getBookingsOverview();
  const bookingUrl = `${process.env.BETTER_AUTH_URL ?? ""}/book`;

  return (
    <div className="mx-auto max-w-7xl space-y-8">
      <div>
        <h1 className="font-serif text-3xl font-semibold tracking-tight sm:text-4xl">Bookings</h1>
        <p className="mt-1 text-sm text-muted">
          Discovery-call bookings and availability - in-house, replacing Synamate. Share your
          public booking link:{" "}
          <a href="/book" target="_blank" className="font-medium text-accent hover:underline">
            {bookingUrl || "/book"}
          </a>
        </p>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <MetricCard label="Open slots (upcoming)" value={kpis.openSlots} secondary="Available to book right now" icon={<CalendarClock size={18} />} />
        <MetricCard label="Booked this month" value={kpis.bookedThisMonth} icon={<CalendarCheck size={18} />} />
        <MetricCard
          label="Avg BANT score"
          value={kpis.avgBant.toFixed(1)}
          secondary="Out of 4 - this month"
          signal={kpis.bookedThisMonth === 0 ? undefined : kpis.avgBant >= 3 ? "ok" : kpis.avgBant >= 2 ? "watch" : "risk"}
          icon={<Target size={18} />}
        />
        <MetricCard
          label="High-intent bookings"
          value={kpis.highBant}
          secondary="BANT 3+ this month"
          signal={kpis.highBant > 0 ? "ok" : undefined}
          icon={<Flame size={18} />}
        />
      </div>

      <Tabs
        tabs={[
          { label: "Bookings", content: <BookingsTable rows={bookings} /> },
          { label: "Availability", content: <SlotManager slots={slots} /> },
        ]}
      />
    </div>
  );
}
