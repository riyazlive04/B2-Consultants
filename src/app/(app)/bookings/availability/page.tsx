import { CalendarPlus } from "lucide-react";
import { PageHeader } from "@/components/ui/kit";
import { requireSection } from "@/lib/rbac";
import { getBookableTeamMembers, getBookingsOverview } from "@/server/booking-metrics";
import { getBookingRulesConfig } from "@/server/founder-config";
import { SlotManager } from "../_components/SlotManager";

export const dynamic = "force-dynamic";

/**
 * Bookings → Availability & booking rules.
 *
 * WHY THIS IS A PAGE AND NOT A MODAL. It used to open in a dialog from the Bookings week
 * navigation, and it had outgrown one badly: five separate concerns (generate slots, the public
 * booking window, the confirm-or-cancel loop, who gets turned away and what they are told, and the
 * list of upcoming slots) stacked inside a scrolling box about 600px tall, over a page that was
 * itself scrolled somewhere else. You could not see where you were, could not link anyone to a
 * section, and the browser's own Back button did nothing.
 *
 * As a route it gets the things a setup screen needs for free: a URL to share, working Back, full
 * width for the fields, and a header that says where you are and how to get out.
 */
export default async function AvailabilityPage() {
  await requireSection("bookings");

  const [{ slots }, teamMembers, rules] = await Promise.all([
    getBookingsOverview(),
    getBookableTeamMembers(),
    getBookingRulesConfig(),
  ]);

  return (
    <div className="w-full space-y-6">
      <PageHeader
        icon={<CalendarPlus size={20} />}
        title="Availability & booking rules"
        subtitle="Generate discovery slots, set what the public booking page will accept, and decide what happens to a call nobody confirms."
        back={{ href: "/bookings", label: "Bookings" }}
      />
      <SlotManager slots={slots} teamMembers={teamMembers} rules={rules} />
    </div>
  );
}
