/**
 * Give Asma and Ameen a booking calendar each, then stock both.
 *
 * WHY THIS EXISTS. The funnel's apply page offers "Book a call with Asma" and "Book a call with
 * Ameen", and each disco page renders a calendar scoped to that person. Availability used to be
 * ONE pattern with ONE owner, so only Asma's page could ever have times in it - on 07/08/2026
 * production held 73 open slots, all hers, and Ameen's page showed an empty calendar to every
 * prospect who picked him. This writes the migrated multi-calendar document.
 *
 * Asma's existing pattern is PRESERVED exactly (Mon–Fri 18:00–21:00 IST, 30-minute calls); the
 * script only adds Ameen alongside her, so nobody's live availability silently changes.
 *
 * Idempotent: re-running matches calendars by owner and updates in place.
 *
 * Usage: npx tsx scripts/seed-booking-calendars.ts --force
 */
import { PrismaClient } from "@prisma/client";
import { coerceBookingCalendarsConfig, coerceBookingRulesConfig, type BookingCalendar } from "../src/lib/config-schema";
import { istToday, istWallToUtc, parseDateInput, toDateInputValue } from "../src/lib/dates";
import { slotStartsForRange } from "../src/lib/slot-plan";

const prisma = new PrismaClient();

if (!process.argv.includes("--force")) {
  console.error("Refusing to run without --force (this writes to whatever DATABASE_URL points at).");
  process.exit(1);
}

const SLOT_PATTERN_KEY = "slotPatternConfig";

/** Who gets a calendar, and the shape of their week. */
const WANTED: Array<{ email: string; name: string; pattern: Partial<BookingCalendar> }> = [
  {
    email: "asma@b2consultants.in",
    name: "Discovery calls - Asma",
    // Left to the live pattern where one already exists; these are only the fallback.
    pattern: { weekdays: ["MON", "TUE", "WED", "THU", "FRI"], startTime: "18:00", endTime: "21:00" },
  },
  {
    email: "ameen@b2consultants.in",
    name: "Discovery calls - Ameen",
    pattern: { weekdays: ["MON", "TUE", "WED", "THU", "FRI"], startTime: "18:00", endTime: "21:00" },
  },
];

async function main() {
  const people = await prisma.user.findMany({
    where: { email: { in: WANTED.map((w) => w.email) } },
    select: { id: true, name: true, email: true },
  });

  const missing = WANTED.filter((w) => !people.some((p) => p.email === w.email));
  if (missing.length) {
    console.error(`Missing user(s): ${missing.map((m) => m.email).join(", ")}. Refusing to author an ownerless calendar.`);
    process.exit(1);
  }

  const row = await prisma.appSetting.findUnique({ where: { key: SLOT_PATTERN_KEY } });
  // Reads the legacy single-pattern shape too, so Asma's live settings survive the migration.
  const existing = coerceBookingCalendarsConfig(row?.value).calendars;
  console.log(`existing calendars: ${existing.length ? existing.map((c) => `${c.name}[${c.assignedToId || "unassigned"}]`).join(", ") : "(none)"}`);

  const next: BookingCalendar[] = [];
  for (const want of WANTED) {
    const person = people.find((p) => p.email === want.email)!;
    const prior = existing.find((c) => c.assignedToId === person.id);

    if (prior) {
      // Keep every field they already had - only the display name is asserted.
      next.push({ ...prior, name: want.name, enabled: true });
      console.log(`· kept   ${want.name.padEnd(28)} ${prior.weekdays.join("/")} ${prior.startTime}–${prior.endTime}  (existing pattern preserved)`);
      continue;
    }

    const created: BookingCalendar = {
      id: person.id.slice(0, 8),
      name: want.name,
      enabled: true,
      weekdays: ["MON", "TUE", "WED", "THU", "FRI"],
      startTime: "18:00",
      endTime: "21:00",
      intervalMins: 30,
      durationMins: 30,
      horizonDays: 21,
      assignedToId: person.id,
      ...want.pattern,
    };
    next.push(created);
    console.log(`· added  ${want.name.padEnd(28)} ${created.weekdays.join("/")} ${created.startTime}–${created.endTime}`);
  }

  // Anything already configured for somebody else stays - this script owns two calendars, not
  // the whole document.
  const others = existing.filter((c) => !next.some((n) => n.id === c.id || n.assignedToId === c.assignedToId));
  for (const o of others) console.log(`· left   ${o.name.padEnd(28)} (not managed by this script)`);

  const calendars = [...next, ...others];

  /**
   * ── The document is written in BOTH shapes, deliberately ──────────────────────
   * The multi-calendar reader ships in code that is not deployed yet, and the running production
   * build still reads this key as a single flat `SlotPatternConfig`. A bare `{calendars: […]}`
   * parses there as every-field-default - i.e. `enabled: false` - so the live hourly top-up would
   * quietly stop, and Asma's calendar would drain as the horizon rolled forward. A config change
   * must not turn off a running engine.
   *
   * So the flat fields of the FIRST live calendar are kept alongside the list. The old build
   * reads them and carries on exactly as before; the new build sees the `calendars` key and takes
   * the list branch (see `coerceBookingCalendarsConfig`). The legacy half disappears on its own
   * the first time the console saves after deploy, since the action writes `{calendars}` only.
   */
  const primary = calendars.find((c) => c.enabled) ?? calendars[0];
  const legacyHalf = primary
    ? {
        enabled: primary.enabled,
        weekdays: primary.weekdays,
        startTime: primary.startTime,
        endTime: primary.endTime,
        intervalMins: primary.intervalMins,
        durationMins: primary.durationMins,
        horizonDays: primary.horizonDays,
        assignedToId: primary.assignedToId,
      }
    : {};

  const value = { ...legacyHalf, calendars };
  await prisma.appSetting.upsert({
    where: { key: SLOT_PATTERN_KEY },
    create: { key: SLOT_PATTERN_KEY, value },
    update: { value },
  });
  console.log(`\nwrote ${calendars.length} calendars to AppSetting["${SLOT_PATTERN_KEY}"]`);
  if (primary) {
    console.log(`· legacy compatibility fields mirror "${primary.name}" so the DEPLOYED build keeps generating slots until the multi-calendar code ships.`);
  }

  if (process.argv.includes("--stock")) await stock(calendars);
}

/**
 * Create the slots the hourly job WOULD create, now.
 *
 * Needed because the running production build cannot see the new calendars yet, so Ameen's page
 * would keep showing an empty calendar until the multi-calendar code deploys. The instants come
 * from `slotStartsForRange` - the same planner the cron and the manual "generate for this range"
 * form both use - so once the new code ships it finds these already present and creates nothing.
 *
 * Additive only, exactly like `ensureBookingSlots`: it never updates or deletes, so a BOOKED or
 * BLOCKED slot cannot be touched.
 */
async function stock(calendars: BookingCalendar[]) {
  const rulesRow = await prisma.appSetting.findUnique({ where: { key: "bookingRulesConfig" } });
  const rules = coerceBookingRulesConfig(rulesRow?.value);
  const today = istToday();
  const earliest = Date.now() + rules.minNoticeHours * 3_600_000;
  console.log(`\nstocking (buffer ${rules.bufferMinutes}m · notice ${rules.minNoticeHours}h · max ${rules.maxAdvanceDays}d):`);

  for (const cal of calendars.filter((c) => c.enabled && c.weekdays.length)) {
    const horizonEnd = new Date(today);
    horizonEnd.setUTCDate(today.getUTCDate() + Math.min(cal.horizonDays, rules.maxAdvanceDays));

    const starts = slotStartsForRange({
      startDate: toDateInputValue(today),
      endDate: toDateInputValue(horizonEnd),
      pattern: cal,
      bufferMinutes: rules.bufferMinutes,
      istWallToUtc,
      parseDate: parseDateInput,
      formatDate: toDateInputValue,
    }).filter((s) => s.getTime() >= earliest);

    const owner = cal.assignedToId || null;
    // Per-OWNER dedupe: two people are routinely free at the same instant, and keying on time
    // alone would let one calendar block every other calendar's slots.
    const existing = await prisma.appointmentSlot.findMany({
      where: { startsAt: { in: starts }, assignedToId: owner },
      select: { startsAt: true },
    });
    const taken = new Set(existing.map((s) => s.startsAt.getTime()));
    const fresh = starts.filter((s) => !taken.has(s.getTime()));

    if (fresh.length) {
      await prisma.appointmentSlot.createMany({
        data: fresh.map((startsAt) => ({ startsAt, durationMins: cal.durationMins, assignedToId: owner })),
        skipDuplicates: true,
      });
    }
    console.log(`· ${cal.name.padEnd(28)} +${String(fresh.length).padStart(3)} new · ${taken.size} already there · through ${toDateInputValue(horizonEnd)}`);
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
