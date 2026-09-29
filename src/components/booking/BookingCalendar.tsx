"use client";

import { useEffect, useId, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { CalendarDays, ChevronDown, ChevronLeft, ChevronRight, CheckCircle2, Clock, Globe } from "lucide-react";
import { submitBooking } from "@/server/booking-actions";
import { FormError, SubmitButton } from "@/components/ui/form";
import { BookingIntakeFields } from "./BookingIntakeFields";

/**
 * The embedded discovery-call booker - a month grid, that day's times, then the questionnaire.
 *
 * ── Why a month grid and not the flat day-by-day list `/book` uses ──────────────
 * A funnel step shows ONE person's calendar, and one person's open slots are sparse: Ameen had a
 * single 23:00 on one day of the month. A flat list of every open slot reads as "there is almost
 * nothing here"; a month with a handful of live dates reads as "pick one of these". The grid also
 * makes availability scannable at a glance, which is the whole job of this screen.
 *
 * ── Times are rendered in the VISITOR's zone, and that is a deliberate change ────
 * `/book` prints IST and CET as fixed strings and offers the visitor's local time as an extra.
 * Here the visitor's own zone is the primary reading, because this page is the last thing between
 * a prospect and a booked call - "19:00" meaning a time they have to convert themselves is how
 * people no-show. The zone in use is named under the grid so it is never ambiguous. The slot's
 * identity is still its id and its UTC instant; nothing about the stored booking changes.
 */

export type CalendarSlot = {
  id: string;
  /** UTC instant, ISO. Every label below is derived from this in the chosen zone. */
  startsAtIso: string;
  durationMins: number;
};

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

/** The visitor's own zone, falling back to IST - this audience is overwhelmingly in India. */
function detectZone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || "Asia/Kolkata";
  } catch {
    return "Asia/Kolkata";
  }
}

/**
 * The calendar day a UTC instant falls on IN A GIVEN ZONE, as "YYYY-MM-DD".
 *
 * Via `en-CA` because it formats as ISO already. Doing this by hand with `getDate()` would use the
 * SERVER's zone and put a 23:00 IST slot on the previous day for anyone west of it - the exact
 * class of bug that makes a booking land on the wrong date.
 */
function dayKeyInZone(iso: string, zone: string): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: zone, year: "numeric", month: "2-digit", day: "2-digit" })
    .format(new Date(iso));
}

function timeInZone(iso: string, zone: string): string {
  return new Intl.DateTimeFormat("en-GB", { timeZone: zone, hour: "2-digit", minute: "2-digit", hour12: false })
    .format(new Date(iso));
}

function longDateInZone(iso: string, zone: string): string {
  return new Intl.DateTimeFormat("en-GB", { timeZone: zone, weekday: "short", day: "numeric", month: "short", year: "numeric" })
    .format(new Date(iso));
}

/** The UTC offset for a zone, e.g. "GMT+05:30". */
function offsetLabel(zone: string): string {
  try {
    const parts = new Intl.DateTimeFormat("en-GB", { timeZone: zone, timeZoneName: "longOffset" })
      .formatToParts(new Date());
    return parts.find((p) => p.type === "timeZoneName")?.value ?? "";
  } catch {
    return "";
  }
}

/** "GMT+05:30 Asia/Calcutta" - offset first, because that is what people scan for. */
function zoneLabel(zone: string): string {
  const off = offsetLabel(zone);
  return off ? `${off} ${zone}` : zone;
}

/**
 * Every zone the browser knows, so someone booking from Berlin or Dubai can say so.
 *
 * `supportedValuesOf` is the whole IANA list (~400 entries) and is not in older Safari - hence the
 * fallback to the handful this audience actually books from. The visitor's own detected zone is
 * merged in either way, so the control can always represent where they really are.
 */
function zoneOptions(detected: string): string[] {
  let all: string[] = [];
  try {
    all = (Intl as unknown as { supportedValuesOf?: (k: string) => string[] }).supportedValuesOf?.("timeZone") ?? [];
  } catch {
    all = [];
  }
  if (!all.length) {
    all = [
      "Asia/Kolkata", "Asia/Dubai", "Asia/Singapore", "Europe/Berlin", "Europe/London",
      "America/New_York", "America/Los_Angeles", "Australia/Sydney", "UTC",
    ];
  }
  return all.includes(detected) ? all : [detected, ...all];
}

/** Local midnight "YYYY-MM-DD" for the day-grid keys - never via toISOString (that is UTC). */
function todayKeyInZone(zone: string): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: zone, year: "numeric", month: "2-digit", day: "2-digit" })
    .format(new Date());
}

export function BookingCalendar({
  slots,
  eyebrow,
  title,
  description,
  logoUrl,
  redirectTo,
}: {
  slots: CalendarSlot[];
  eyebrow?: string;
  title: string;
  description?: string;
  logoUrl?: string;
  /** Where to go once the booking lands. Unset keeps the inline success card. */
  redirectTo?: string;
}) {
  /**
   * The zone starts at a FIXED default and only becomes the visitor's after mount.
   *
   * Detecting it in the initialiser looks right and is a hydration bug: on the server
   * `Intl...timeZone` is the SERVER's zone, on the client it is the browser's, so the two renders
   * disagreed about which day every slot falls on and React discarded the server HTML. The zone
   * offset labels are worse - Node's ICU prints "GMT" for Africa/Abidjan where the browser prints
   * "GMT+00:00", so even the <option> text mismatched.
   *
   * Fixed default → server and first client render are identical → hydration succeeds; the effect
   * then switches to the real zone and everything re-labels. IST is the right default for this
   * audience, so most visitors never see a change.
   *
   * Changing the zone re-labels every date and time from the same UTC instants - a slot can move
   * to a different calendar DAY, which is why the grid is derived from `zone` rather than fixed.
   */
  const router = useRouter();
  const [zone, setZone] = useState("Asia/Kolkata");
  const [mounted, setMounted] = useState(false);
  useEffect(() => {
    setZone(detectZone());
    setMounted(true);
  }, []);
  const [selectedDay, setSelectedDay] = useState<string | null>(null);
  const [slotId, setSlotId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<CalendarSlot | null>(null);
  // Two booking blocks can appear on one page, so the timezone label needs a unique `for`.
  const blockKey = useId();
  const zones = useMemo(() => zoneOptions(zone), [zone]);
  const today = todayKeyInZone(zone);

  /** day key -> that day's slots, ascending. The grid's source of truth for "is this day live". */
  const byDay = useMemo(() => {
    const map = new Map<string, CalendarSlot[]>();
    for (const s of [...slots].sort((a, b) => a.startsAtIso.localeCompare(b.startsAtIso))) {
      const k = dayKeyInZone(s.startsAtIso, zone);
      map.set(k, [...(map.get(k) ?? []), s]);
    }
    return map;
  }, [slots, zone]);

  // Open on the month holding the first available day, not on today - a calendar that opens on an
  // empty month looks like there is no availability at all.
  const firstDay = useMemo(() => [...byDay.keys()].sort()[0] ?? null, [byDay]);
  const [cursor, setCursor] = useState(() => {
    const base = firstDay ? new Date(`${firstDay}T00:00:00`) : new Date();
    return { y: base.getFullYear(), m: base.getMonth() };
  });

  const grid = useMemo(() => {
    const first = new Date(cursor.y, cursor.m, 1);
    const daysInMonth = new Date(cursor.y, cursor.m + 1, 0).getDate();
    const cells: ({ key: string; day: number } | null)[] = Array.from({ length: first.getDay() }, () => null);
    for (let d = 1; d <= daysInMonth; d++) {
      const key = `${cursor.y}-${String(cursor.m + 1).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
      cells.push({ key, day: d });
    }
    return cells;
  }, [cursor]);

  /**
   * Open with the first available day already chosen, so the times are on screen immediately.
   *
   * Also the recovery path: switching timezone can move a slot onto a different calendar day, and
   * without this the previously-selected date would still be highlighted while its time list had
   * silently emptied - a dead-looking widget with no way to tell what went wrong.
   */
  useEffect(() => {
    if (firstDay && (!selectedDay || !byDay.has(selectedDay))) {
      setSelectedDay(firstDay);
      setSlotId(null);
    }
  }, [firstDay, selectedDay, byDay]);

  /**
   * Carry the prospect down to the questionnaire the moment a time is held.
   *
   * The form does not exist until `slotId` is set, so picking a time silently grows the page
   * BELOW the fold: on a phone the calendar fills the screen, the tap highlights a button, and
   * nothing else visibly happens. The prospect has no way to know a thirty-field form just
   * appeared, so the booking is abandoned at the last step - having already done the hard part.
   *
   * Fires only on the null → chosen transition. Switching between two times re-scrolls nothing,
   * because by then the form is already on screen and yanking the page under someone who is
   * mid-form is worse than not scrolling at all.
   */
  const detailsRef = useRef<HTMLFormElement | null>(null);
  const hadSlot = useRef(false);
  useEffect(() => {
    if (!slotId) {
      hadSlot.current = false;
      return;
    }
    if (hadSlot.current) return;
    hadSlot.current = true;
    // Honour the OS "reduce motion" setting - a smooth scroll is exactly the kind of movement
    // that setting exists to suppress.
    const reduced = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;
    detailsRef.current?.scrollIntoView({ behavior: reduced ? "auto" : "smooth", block: "start" });
  }, [slotId]);

  const monthLabel = new Intl.DateTimeFormat("en-GB", { month: "long", year: "numeric" })
    .format(new Date(cursor.y, cursor.m, 1));
  const daySlots = selectedDay ? byDay.get(selectedDay) ?? [] : [];
  const chosen = slots.find((s) => s.id === slotId) ?? null;

  const submit = async (form: FormData) => {
    setError(null);
    if (!slotId) return setError("Please choose a time for your call.");
    const res = await submitBooking(form);
    if (!res.ok) return setError(res.error);
    if (redirectTo) {
      /**
       * `setDone` FIRST, then navigate. The push is not instant - it is a server round trip for
       * the confirmation page - and without this the form sits there looking unsubmitted, which
       * is exactly when someone presses "Confirm my call" a second time. The slot is already
       * gone by then, so the retry fails with "no longer available" on a booking that in fact
       * succeeded. The success card covers that gap and is then replaced by the new page.
       */
      setDone(chosen);
      router.push(redirectTo);
      return;
    }
    setDone(chosen);
  };

  if (done) {
    return (
      <div className="rounded-card border border-line bg-surface p-8 text-center shadow-card">
        <CheckCircle2 className="mx-auto text-good" size={40} />
        <h2 className="mt-3 font-display text-h2 font-semibold text-ink">You&rsquo;re booked in 🎉</h2>
        <p className="mx-auto mt-2 max-w-sm text-sm text-muted">
          Your call is confirmed for{" "}
          <strong className="text-ink">{longDateInZone(done.startsAtIso, zone)}</strong> at{" "}
          <strong className="text-ink">{timeInZone(done.startsAtIso, zone)}</strong> ({zone}). Check your
          email and WhatsApp for the joining details.
        </p>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-[1000px] overflow-hidden rounded-card border border-line bg-surface shadow-card">
      <div className="grid grid-cols-1 md:grid-cols-[minmax(0,300px)_1fr]">
        {/* ── Left rail: what is being booked ─────────────────────────────────── */}
        <div className="border-b border-line p-6 md:border-b-0 md:border-r">
          {logoUrl && (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={logoUrl} alt="" className="mb-5 h-16 w-auto" />
          )}
          {eyebrow && (
            <p className="text-caption font-semibold uppercase tracking-[0.14em] text-ink-3">{eyebrow}</p>
          )}
          <h2 className="mt-1 font-display text-h2 font-semibold leading-tight text-ink">{title}</h2>
          <p className="mt-3 flex items-center gap-2 text-sm text-ink-2">
            <Clock size={15} className="text-ink-3" /> {slots[0]?.durationMins ?? 20} min
          </p>
          {/* Shown as soon as a DAY is picked, not a time - picking the date is the moment the
              prospect has decided something, and echoing it back is what confirms the click
              landed on the day they meant. */}
          {selectedDay && daySlots[0] && (
            <p className="mt-1.5 flex items-center gap-2 text-sm text-ink-2">
              <CalendarDays size={15} className="text-ink-3" /> {longDateInZone(daySlots[0].startsAtIso, zone)}
            </p>
          )}
          {description && <p className="mt-4 text-sm leading-relaxed text-ink-2">{description}</p>}
        </div>

        {/* ── Right: pick a date, then a time ─────────────────────────────────── */}
        <div className="p-6">
          <h3 className="font-display text-h3 font-semibold text-ink">Select Date &amp; Time</h3>

          {slots.length === 0 ? (
            <p className="mt-4 rounded-field border border-dashed border-line p-6 text-center text-sm text-muted">
              No times are open right now. Please check back shortly - new slots are released regularly.
            </p>
          ) : (
            <div className="mt-4 flex flex-col gap-8 sm:flex-row sm:items-start">
              <div className="w-full min-w-0 sm:w-[336px] sm:flex-none">
                <div className="flex items-center justify-center gap-4">
                  <button
                    type="button"
                    aria-label="Previous month"
                    onClick={() => setCursor((c) => (c.m === 0 ? { y: c.y - 1, m: 11 } : { ...c, m: c.m - 1 }))}
                    className="rounded-full p-1.5 text-ink-3 hover:bg-surface-2 hover:text-ink"
                  >
                    <ChevronLeft size={18} />
                  </button>
                  <span className="min-w-[9rem] text-center text-sm font-semibold text-ink">{monthLabel}</span>
                  <button
                    type="button"
                    aria-label="Next month"
                    onClick={() => setCursor((c) => (c.m === 11 ? { y: c.y + 1, m: 0 } : { ...c, m: c.m + 1 }))}
                    className="rounded-full bg-primary-soft p-1.5 text-primary-strong hover:bg-sky"
                  >
                    <ChevronRight size={18} />
                  </button>
                </div>

                <div className="mt-4 grid grid-cols-7 gap-y-1 text-center">
                  {WEEKDAYS.map((d) => (
                    <span key={d} className="pb-2 text-caption font-medium text-ink-3">{d}</span>
                  ))}
                  {grid.map((cell, i) => {
                    if (!cell) return <span key={`pad-${i}`} />;
                    const has = byDay.has(cell.key);
                    const isSelected = selectedDay === cell.key;
                    const isToday = mounted && cell.key === today;
                    return (
                      <span key={cell.key} className="grid place-items-center py-0.5">
                        <button
                          type="button"
                          disabled={!has}
                          aria-pressed={isSelected}
                          aria-current={isToday ? "date" : undefined}
                          aria-label={`${cell.day} ${monthLabel}${isToday ? " (today)" : ""}${has ? "" : " - no times"}`}
                          onClick={() => { setSelectedDay(cell.key); setSlotId(null); }}
                          className={`grid h-9 w-9 place-items-center rounded-full text-sm transition-colors ${
                            isSelected
                              ? "bg-primary font-semibold text-on-accent"
                              : has
                                ? "bg-primary-soft font-medium text-primary-strong hover:bg-sky"
                                : "cursor-default text-ink-3 opacity-45"
                          }`}
                        >
                          {cell.day}
                        </button>
                        {/* Today's marker. Sits under the number rather than restyling it, so a
                            day that is both today and selected still reads as selected. */}
                        <span
                          aria-hidden
                          className={`mt-0.5 h-1 w-1 rounded-full ${isToday && !isSelected ? "bg-primary" : "bg-transparent"}`}
                        />
                      </span>
                    );
                  })}
                </div>

                <div className="mt-6">
                  <label htmlFor={`${blockKey}-tz`} className="text-sm font-semibold text-ink">Time zone</label>
                  <span className="relative mt-1.5 flex items-center gap-2">
                    <Globe size={15} aria-hidden className="pointer-events-none absolute left-0 text-ink-3" />
                    {/* A real <select>: ~400 zones on an unknown device, on the booking path. The
                        OS picker is searchable and already known to every screen reader. */}
                    <select
                      id={`${blockKey}-tz`}
                      value={zone}
                      onChange={(e) => { setZone(e.target.value); setSelectedDay(null); setSlotId(null); }}
                      className="w-full cursor-pointer appearance-none border-0 bg-transparent py-1 pl-6 pr-6 text-sm text-ink-2 outline-none focus:text-ink"
                    >
                      {/* Pre-mount we emit ONE option holding the default, so the server and the
                          first client render agree; the full Intl-derived list arrives after. */}
                      {mounted
                        ? zones.map((z) => <option key={z} value={z}>{zoneLabel(z)}</option>)
                        : <option value={zone}>{zone}</option>}
                    </select>
                    <ChevronDown size={15} aria-hidden className="pointer-events-none absolute right-0 text-ink-3" />
                  </span>
                </div>
              </div>

              {/* The times for the chosen day. Its own column on desktop, matching the source. */}
              {/* `mt-11` drops the first time button level with the weekday row, so the two
                  columns read as one grid rather than two stacks that happen to be adjacent. */}
              <div className="w-full sm:mt-11 sm:w-40 sm:flex-none">
                {selectedDay ? (
                  daySlots.length ? (
                    <div className="flex flex-col gap-3">
                      {daySlots.map((s) => (
                        <button
                          key={s.id}
                          type="button"
                          onClick={() => setSlotId(s.id)}
                          aria-pressed={slotId === s.id}
                          className={`rounded-field border py-2.5 text-sm font-medium transition-colors ${
                            slotId === s.id
                              ? "border-primary bg-primary text-on-accent"
                              : "border-primary/40 text-primary-strong hover:border-primary"
                          }`}
                        >
                          {timeInZone(s.startsAtIso, zone)}
                        </button>
                      ))}
                    </div>
                  ) : null
                ) : (
                  <p className="text-caption text-muted">Pick a highlighted date to see its times.</p>
                )}
              </div>
            </div>
          )}
        </div>
      </div>

      {/*
        The questionnaire appears only once a time is held. Showing thirty fields before the
        prospect has committed to anything is what makes a booking form feel like a tax return -
        and the slot is the thing that can run out, so it goes first.
      */}
      {slotId && (
        <form ref={detailsRef} action={submit} className="scroll-mt-4 space-y-6 border-t border-line p-6">
          <input type="hidden" name="slotId" value={slotId} />
          <BookingIntakeFields />
          <div className="flex flex-col items-center gap-3">
            <SubmitButton>Confirm my call</SubmitButton>
            <FormError message={error} />
          </div>
        </form>
      )}
    </div>
  );
}
