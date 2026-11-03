/**
 * Per-person working-day pattern, stored as a 7-bit mask on `TeamProfile.workingDaysMask`.
 *
 * Bit 0 = Monday … bit 6 = Sunday. The default `63` (bits 0–5) means Mon–Sat, which is
 * what the retired `worksSaturdays = true` meant. The one real pattern the old boolean
 * held - "off Saturdays" - is `31` (Mon–Fri). The point of the widening: a person can
 * now be off ANY day(s), and work a comp-off day in return - Asma off Tuesday but in on
 * Saturday is a mask of `0b1101111` = 111, with no new column.
 *
 * All weekday arithmetic uses IST, matching the rest of the app's day boundaries
 * (`istToday`, `istMinutesOfDay`): a Saturday booking at 23:30 UTC Friday is Saturday
 * for the people who have to show up to it.
 */

export const WEEKDAY_BITS = [0, 1, 2, 3, 4, 5, 6] as const;
export type WeekdayBit = (typeof WEEKDAY_BITS)[number];

/** Mon–Sat. Preserves the old `worksSaturdays = true` behaviour exactly. */
export const WORKING_DAYS_DEFAULT_MASK = 0b0111111;
/** All-day mask - every bit set. */
export const WORKING_DAYS_FULL_MASK = 0b1111111;

/** Short label for each bit, in week order. */
export const WEEKDAY_SHORT = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"] as const;
/** Plural label for sentences ("off Tuesdays, Sundays"). */
export const WEEKDAY_PLURAL = [
  "Mondays",
  "Tuesdays",
  "Wednesdays",
  "Thursdays",
  "Fridays",
  "Saturdays",
  "Sundays",
] as const;

/** The IST weekday as a bit index (Mon = 0 … Sun = 6). */
export function istWeekdayBit(date: Date): WeekdayBit {
  // `en-GB` + Asia/Kolkata gives the short weekday name in IST, which is the day the
  // founder means when they say "Saturday". Reading `getUTCDay()` directly would shift
  // a Saturday booking at 23:30 UTC on Friday back into Friday for the engine.
  const short = new Intl.DateTimeFormat("en-GB", {
    weekday: "short",
    timeZone: "Asia/Kolkata",
  }).format(date);
  const idx = WEEKDAY_SHORT.indexOf(short as (typeof WEEKDAY_SHORT)[number]);
  // Intl always returns one of the seven shorts for `weekday: "short"` + `en-GB`, so
  // this is unreachable - but the Narrow forces a WeekdayBit for callers rather than
  // leaking a `-1`.
  return (idx === -1 ? 0 : idx) as WeekdayBit;
}

/** True when `date` falls on a day the mask says the person works. */
export function isWorkingDay(mask: number, date: Date): boolean {
  return (mask & (1 << istWeekdayBit(date))) !== 0;
}

/** Normalise anything out of range back to the shipped default. */
export function normaliseMask(raw: number | null | undefined): number {
  if (!Number.isInteger(raw) || raw === null || raw === undefined) return WORKING_DAYS_DEFAULT_MASK;
  const clean = raw & WORKING_DAYS_FULL_MASK;
  // A mask of 0 means "works no days", which has no legitimate caller - every reader
  // treats it as "always off" and silently excludes the person. Returning the default
  // instead stops a cleared-every-box save from accidentally benching someone forever.
  return clean === 0 ? WORKING_DAYS_DEFAULT_MASK : clean;
}

/**
 * The days this person is off, as a short label - "" for a Mon-Sun worker, "Saturdays"
 * for the old `worksSaturdays = false`, "Tuesdays, Sundays" for a split week.
 *
 * Used in the pipeline banner and Console → Call Distribution to show rather than hide
 * what the rotation will do today.
 */
export function offDaysLabel(mask: number): string {
  const off = WEEKDAY_BITS.filter((b) => (mask & (1 << b)) === 0);
  if (!off.length) return "";
  return off.map((b) => WEEKDAY_PLURAL[b]).join(", ");
}

/** The single-day label for a date - e.g. "Tuesday" - for an "off today" badge. */
export function weekdayLabelFor(date: Date): string {
  return new Intl.DateTimeFormat("en-GB", { weekday: "long", timeZone: "Asia/Kolkata" }).format(date);
}

/** The form field name a <CheckboxField> uses for day `bit`. */
export function workDayFieldName(bit: WeekdayBit): string {
  return `workDay${bit}`;
}

/**
 * Parse the 7 `workDay0`…`workDay6` checkbox values out of FormData into a mask. An
 * unchecked box is simply absent from FormData, so a form that submits ONLY the mask's
 * ticked boxes still produces the right number.
 */
export function maskFromFormData(form: FormData): number {
  let mask = 0;
  for (const bit of WEEKDAY_BITS) {
    if (form.get(workDayFieldName(bit)) === "on") mask |= 1 << bit;
  }
  return normaliseMask(mask);
}
