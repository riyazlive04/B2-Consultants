/**
 * The maths behind the Calendars grid: which IST day an event falls on, where it sits in a day
 * column, and how a month cell is filled. Pure, so the Week/Day/Month views only do markup.
 */

import { layoutDay, type Placed } from "./calendar-layout";
import type { CalEvent } from "./calendar-event";

/** Hour row height in px; Synamate's grid is two 36px half-hour lanes per hour. */
export const HOUR_PX = 72;
export const DAY_MINS = 1440;
/** Full height of a day column in px, and the px offset of a given minute inside it. */
export const DAY_PX = (DAY_MINS * HOUR_PX) / 60;
export const minutePx = (min: number) => (min * HOUR_PX) / 60;
/** Where the grid scrolls to on load - the working day, not midnight. */
export const SCROLL_TO_MIN = 8 * 60;

const istParts = new Intl.DateTimeFormat("en-CA", {
  year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit",
  hour12: false, timeZone: "Asia/Kolkata",
});

/** `{ key: "2026-11-13", min: 810 }` - the IST calendar day an instant falls on, and the time in it. */
export function istSlot(iso: string | Date): { key: string; min: number } {
  const p = istParts.formatToParts(typeof iso === "string" ? new Date(iso) : iso);
  const get = (t: string) => p.find((x) => x.type === t)!.value;
  // Intl renders midnight as "24" in some engines; normalise so the day key and minutes agree.
  const h = Number(get("hour")) % 24;
  return { key: `${get("year")}-${get("month")}-${get("day")}`, min: h * 60 + Number(get("minute")) };
}

export const istTimeLabel = (iso: string | Date) =>
  new Intl.DateTimeFormat("en-GB", { hour: "2-digit", minute: "2-digit", hour12: true, timeZone: "Asia/Kolkata" })
    .format(typeof iso === "string" ? new Date(iso) : iso)
    .toUpperCase();

/** "Mon, 17 Nov" in IST - the day a card sits on, spelled out. */
export const istDateLabel = (iso: string | Date) =>
  new Intl.DateTimeFormat("en-GB", { weekday: "short", day: "numeric", month: "short", year: "numeric", timeZone: "Asia/Kolkata" })
    .format(typeof iso === "string" ? new Date(iso) : iso);

/** Synamate's hover line: "06:30 PM - 06:50 PM (IST)". */
export const istRangeLabel = (ev: Pick<CalEvent, "startsAt" | "endsAt">) =>
  `${istTimeLabel(ev.startsAt)} - ${istTimeLabel(ev.endsAt)} (IST)`;

export type PlacedEvent = { event: CalEvent; place: Placed };

/**
 * The events of one IST day, packed into side-by-side columns. An event is included when either
 * end falls in the day, and `layoutDay` clips it to the day's own minutes.
 */
export function placeDay(events: CalEvent[], dayKey: string): PlacedEvent[] {
  const mine: { ev: CalEvent; startMin: number; endMin: number }[] = [];
  for (const ev of events) {
    const s = istSlot(ev.startsAt);
    const e = istSlot(ev.endsAt);
    if (s.key !== dayKey && e.key !== dayKey) continue;
    mine.push({
      ev,
      startMin: s.key === dayKey ? s.min : 0,
      // An event ending exactly at midnight belongs to the day it started in, not the next one.
      endMin: e.key === dayKey ? (e.min === 0 ? DAY_MINS : e.min) : DAY_MINS,
    });
  }
  const placed = layoutDay(mine.map((m) => ({ id: m.ev.id, startMin: m.startMin, endMin: m.endMin })), 0, DAY_MINS);
  const by = new Map(mine.map((m) => [m.ev.id, m.ev]));
  return placed.map((place) => ({ event: by.get(place.id)!, place }));
}

const pad = (n: number) => String(n).padStart(2, "0");
export const dayKeyOf = (d: Date) => `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
/** Day keys are plain calendar dates, so they move a day at a time with no zone involved. */
export function addDays(dayKey: string, n: number): string {
  const [y, m, d] = dayKey.split("-").map(Number);
  return dayKeyOf(new Date(Date.UTC(y, m - 1, d + n)));
}

/** Monday-first week containing `dayKey` (the app's weeks start Monday, as `istWeekRange` does). */
export function weekDays(dayKey: string): string[] {
  const [y, m, d] = dayKey.split("-").map(Number);
  const dow = (new Date(Date.UTC(y, m - 1, d)).getUTCDay() + 6) % 7;
  return Array.from({ length: 7 }, (_, i) => addDays(dayKey, i - dow));
}

/** Whole weeks covering the month of `dayKey`, Monday-first - 5 or 6 rows of 7. */
export function monthDays(dayKey: string): string[] {
  const [y, m] = dayKey.split("-").map(Number);
  const first = `${y}-${pad(m)}-01`;
  const start = weekDays(first)[0];
  const lastOfMonth = dayKeyOf(new Date(Date.UTC(y, m, 0)));
  const end = weekDays(lastOfMonth)[6];
  const out = [start];
  while (out[out.length - 1] < end) out.push(addDays(out[out.length - 1], 1));
  return out;
}

export const inMonth = (dayKey: string, ref: string) => dayKey.slice(0, 7) === ref.slice(0, 7);

/** A month cell: the first `cap` events of the day, and how many are hidden behind "+N more". */
export function monthCell(events: CalEvent[], dayKey: string, cap = 3): { all: CalEvent[]; shown: CalEvent[]; more: number } {
  const all = events.filter((e) => istSlot(e.startsAt).key === dayKey);
  return { all, shown: all.slice(0, cap), more: Math.max(0, all.length - cap) };
}

/** Day view columns: one per owner who has something that day, unassigned last. */
export function dayColumns(events: CalEvent[], dayKey: string, team: { id: string; name: string | null }[]) {
  const today = events.filter((e) => istSlot(e.startsAt).key === dayKey || istSlot(e.endsAt).key === dayKey);
  const used = new Set(today.map((e) => e.ownerId ?? ""));
  const cols = team.filter((u) => used.has(u.id)).map((u) => ({ id: u.id, name: u.name ?? "Unnamed" }));
  if (used.has("")) cols.push({ id: "", name: "Unassigned" });
  return cols.map((c) => ({ ...c, events: today.filter((e) => (e.ownerId ?? "") === c.id) }));
}
