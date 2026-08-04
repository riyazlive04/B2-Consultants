import type { Metadata } from "next";
import { prisma } from "@/lib/prisma";
import { formatDate, formatDateTimeInZone } from "@/lib/format";
import { getBookingRulesConfig } from "@/server/founder-config";
import { BookingForm, type SlotOption } from "./_components/BookingForm";

// Prospect-facing discovery-call booking page (Wave-1 - replaces Synamate's booking form).
// Public: no session required (whitelisted in middleware).
export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Book your Germany Career Call - B2 Consultants",
  description: "Book a free discovery call with B2 Consultants and see if you qualify for our Germany job-placement programs.",
};

const istTime = new Intl.DateTimeFormat("en-GB", {
  hour: "2-digit", minute: "2-digit", hour12: true, timeZone: "Asia/Kolkata",
});

export default async function BookPage() {
  // §9/§13: buffer/min-notice/max-advance window (founder-configurable, AppSetting-backed) -
  // hide slots that are too soon to be booked or too far out to be worth showing yet.
  const rules = await getBookingRulesConfig();
  const now = Date.now();
  const earliest = new Date(now + rules.minNoticeHours * 3_600_000);
  const latest = new Date(now + rules.maxAdvanceDays * 86_400_000);

  const slots = await prisma.appointmentSlot.findMany({
    where: { status: "OPEN", startsAt: { gt: earliest, lte: latest } },
    orderBy: { startsAt: "asc" },
    // A three-week horizon of half-hourly slots is ~90 rows; the calendar groups them by day, so
    // the cap has to clear a full horizon or the last days would silently show as unavailable.
    take: 400,
    include: { assignedTo: { select: { name: true } } },
  });

  /**
   * Whose diary this is, for "…with Asma" in the header.
   *
   * The most common owner across the open slots rather than the first: one covered slot handed to
   * someone else should not rename the whole page.
   */
  const hostTally = new Map<string, number>();
  for (const s of slots) {
    const n = s.assignedTo?.name;
    if (n) hostTally.set(n, (hostTally.get(n) ?? 0) + 1);
  }
  const hostName = [...hostTally.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;

  const slotOptions: SlotOption[] = slots.map((s) => ({
    id: s.id,
    day: formatDate(s.startsAt),
    time: istTime.format(s.startsAt),
    cet: formatDateTimeInZone(s.startsAt, "Europe/Berlin"),
    durationMins: s.durationMins,
    startsAtIso: s.startsAt.toISOString(),
  }));

  return (
    // The header that used to sit here — mark, title, blurb — is now the scheduler's own left
    // panel, where it stays beside the calendar instead of scrolling away above it.
    <main className="min-h-screen bg-canvas px-4 py-10 sm:py-14">
      <BookingForm slots={slotOptions} hostName={hostName} />
      <p className="mx-auto mt-6 max-w-5xl text-center text-xs text-muted">
        Your details are private and used only to prepare for your call.
      </p>
    </main>
  );
}
