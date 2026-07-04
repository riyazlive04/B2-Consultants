import type { Metadata } from "next";
import { prisma } from "@/lib/prisma";
import { formatDateTimeInZone } from "@/lib/format";
import { BookingForm, type SlotOption } from "./_components/BookingForm";

// Prospect-facing discovery-call booking page (Wave-1 - replaces Synamate's booking form).
// Public: no session required (whitelisted in middleware).
export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Book your Germany Career Call - B2 Consultants",
  description: "Book a free discovery call with B2 Consultants and see if you qualify for our Germany job-placement programs.",
};

const istDay = new Intl.DateTimeFormat("en-GB", {
  weekday: "long", day: "2-digit", month: "long", timeZone: "Asia/Kolkata",
});
const istTime = new Intl.DateTimeFormat("en-GB", {
  hour: "2-digit", minute: "2-digit", hour12: true, timeZone: "Asia/Kolkata",
});

export default async function BookPage() {
  const slots = await prisma.appointmentSlot.findMany({
    where: { status: "OPEN", startsAt: { gt: new Date() } },
    orderBy: { startsAt: "asc" },
    take: 80,
  });

  const slotOptions: SlotOption[] = slots.map((s) => ({
    id: s.id,
    day: istDay.format(s.startsAt),
    time: istTime.format(s.startsAt),
    cet: formatDateTimeInZone(s.startsAt, "Europe/Berlin"),
  }));

  return (
    <main className="min-h-screen bg-canvas px-4 py-10 sm:py-14">
      <div className="mx-auto w-full max-w-2xl">
        <header className="mb-8 text-center">
          <span className="mx-auto grid h-12 w-12 place-items-center rounded-2xl bg-accent text-base font-bold text-white shadow-pop">
            B2
          </span>
          <h1 className="mt-4 font-display text-2xl font-semibold tracking-tight text-ink sm:text-3xl">
            Book your Germany Career Call
          </h1>
          <p className="mx-auto mt-2 max-w-md text-sm text-muted">
            A free 30-minute discovery call with our team. Tell us a little about your
            background so we can make the call count - and see if you qualify for our
            Germany job-placement programs.
          </p>
        </header>

        <BookingForm slots={slotOptions} />

        <p className="mt-6 text-center text-xs text-muted">
          Your details are private and used only to prepare for your call.
        </p>
      </div>
    </main>
  );
}
