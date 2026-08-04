"use client";

import { useMemo, useState } from "react";
import { ChevronLeft, ChevronRight, Globe } from "lucide-react";
import type { SlotOption } from "./BookingForm";

/**
 * The month-grid slot picker for the public booking page.
 *
 * ── Why a calendar and not the old list ─────────────────────────────────────────
 * This used to be every open slot rendered as a flat run of chips grouped by day. That is fine
 * for six slots and unreadable for ninety: a three-week rolling horizon at half-hourly intervals
 * is ~90 buttons in one column, and a prospect scrolls past most of the month to find a Thursday.
 * A month grid answers "which days can I even come?" in one glance, then shows only that day's
 * times — the shape everyone already knows from Calendly.
 *
 * ── The timezone is the load-bearing part ───────────────────────────────────────
 * Slots are stored as UTC instants; IST and CET were previously baked into the markup on the
 * server. A prospect in Dubai or Berlin then had to do the arithmetic themselves, which is
 * exactly the sort of thing people get wrong by a half-hour and then miss the call. Here the
 * visitor's zone is detected, overridable, and applied to BOTH the times and the day grouping —
 * because a 21:00 IST slot is the *previous* day in New York, and putting it under the wrong date
 * would be worse than not converting at all.
 */

/** Offered explicitly; the visitor's own zone is added on top when it isn't one of these. */
const COMMON_ZONES = [
  "Asia/Kolkata",
  "Europe/Berlin",
  "Asia/Dubai",
  "Europe/London",
  "America/New_York",
];

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

/** "GMT+5:30" for a zone, read out of Intl rather than kept in a table that drifts with DST. */
function offsetLabel(tz: string, at = new Date()): string {
  try {
    const parts = new Intl.DateTimeFormat("en-GB", { timeZone: tz, timeZoneName: "shortOffset" }).formatToParts(at);
    return parts.find((p) => p.type === "timeZoneName")?.value ?? "";
  } catch {
    return "";
  }
}

/** YYYY-MM-DD **in the given zone** — the key everything groups on. */
function dateKeyIn(tz: string, iso: string): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: tz,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(iso));
}

function timeIn(tz: string, iso: string): string {
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: tz,
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(new Date(iso));
}

export function SlotCalendar({
  slots,
  selectedId,
  onSelect,
  tz,
  onTzChange,
}: {
  slots: SlotOption[];
  selectedId: string;
  onSelect: (id: string) => void;
  tz: string;
  onTzChange: (tz: string) => void;
}) {
  /** date key → slots, in the visitor's chosen zone. */
  const byDate = useMemo(() => {
    const map = new Map<string, SlotOption[]>();
    for (const s of slots) {
      const key = dateKeyIn(tz, s.startsAtIso);
      const arr = map.get(key) ?? [];
      arr.push(s);
      map.set(key, arr);
    }
    for (const arr of map.values()) arr.sort((a, b) => a.startsAtIso.localeCompare(b.startsAtIso));
    return map;
  }, [slots, tz]);

  const availableKeys = useMemo(() => [...byDate.keys()].sort(), [byDate]);
  const firstKey = availableKeys[0];
  const lastKey = availableKeys[availableKeys.length - 1];

  /** The day the grid opens on: the first one that actually has times. */
  const [selectedDate, setSelectedDate] = useState<string | null>(firstKey ?? null);
  const [month, setMonth] = useState(() => (firstKey ? firstKey.slice(0, 7) : ""));

  const activeDate = selectedDate && byDate.has(selectedDate) ? selectedDate : firstKey ?? null;
  const activeMonth = month || (firstKey ? firstKey.slice(0, 7) : "");

  // Month navigation is bounded by the horizon — an empty grid you can page into forever is a
  // control that does nothing, and it invites the reading that there is nothing available at all.
  const canPrev = !!firstKey && activeMonth > firstKey.slice(0, 7);
  const canNext = !!lastKey && activeMonth < lastKey.slice(0, 7);
  const shiftMonth = (dir: -1 | 1) => {
    const [y, m] = activeMonth.split("-").map(Number);
    const d = new Date(Date.UTC(y, m - 1 + dir, 1));
    setMonth(`${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`);
  };

  const grid = useMemo(() => {
    if (!activeMonth) return { cells: [] as (string | null)[], title: "" };
    const [y, m] = activeMonth.split("-").map(Number);
    const first = new Date(Date.UTC(y, m - 1, 1));
    const daysInMonth = new Date(Date.UTC(y, m, 0)).getUTCDate();
    const lead = first.getUTCDay();
    const cells: (string | null)[] = Array.from({ length: lead }, () => null);
    for (let d = 1; d <= daysInMonth; d++) {
      cells.push(`${activeMonth}-${String(d).padStart(2, "0")}`);
    }
    return {
      cells,
      title: new Intl.DateTimeFormat("en-GB", { month: "long", year: "numeric", timeZone: "UTC" }).format(first),
    };
  }, [activeMonth]);

  const todayKey = dateKeyIn(tz, new Date().toISOString());
  const dayTimes = activeDate ? byDate.get(activeDate) ?? [] : [];

  const zones = useMemo(() => {
    const set = [...COMMON_ZONES];
    if (tz && !set.includes(tz)) set.unshift(tz);
    return set;
  }, [tz]);

  return (
    <div className="grid grid-cols-1 gap-6 sm:grid-cols-[minmax(0,1fr)_180px]">
      {/* ── Month grid ── (the heading lives in the wizard's step header, not here) */}
      <div>
        <div className="flex items-center justify-center gap-4">
          <button
            type="button"
            onClick={() => shiftMonth(-1)}
            disabled={!canPrev}
            aria-label="Previous month"
            className="grid h-9 w-9 place-items-center rounded-full text-ink-2 transition-colors hover:bg-surface-2 disabled:opacity-30 disabled:hover:bg-transparent"
          >
            <ChevronLeft size={18} />
          </button>
          <p aria-live="polite" className="min-w-40 text-center text-sm font-semibold text-ink">
            {grid.title}
          </p>
          <button
            type="button"
            onClick={() => shiftMonth(1)}
            disabled={!canNext}
            aria-label="Next month"
            className="grid h-9 w-9 place-items-center rounded-full bg-primary-soft text-primary-strong transition-colors hover:bg-primary-tint disabled:bg-transparent disabled:text-ink-2 disabled:opacity-30"
          >
            <ChevronRight size={18} />
          </button>
        </div>

        <div className="mt-4 grid grid-cols-7 gap-y-1 text-center">
          {WEEKDAYS.map((d) => (
            <div key={d} className="pb-2 text-caption font-semibold text-ink-3">
              {d}
            </div>
          ))}
          {grid.cells.map((key, i) => {
            if (!key) return <div key={`pad-${i}`} />;
            const dayNum = Number(key.slice(-2));
            const has = byDate.has(key);
            const isSelected = key === activeDate;
            const isToday = key === todayKey;
            return (
              <div key={key} className="flex flex-col items-center py-0.5">
                <button
                  type="button"
                  disabled={!has}
                  onClick={() => setSelectedDate(key)}
                  aria-pressed={isSelected}
                  aria-label={`${dayNum} ${grid.title}${has ? `, ${byDate.get(key)!.length} times available` : ", no times"}`}
                  className={`grid h-10 w-10 place-items-center rounded-full text-sm transition-colors ${
                    isSelected
                      ? "bg-primary font-semibold text-on-accent"
                      : has
                        ? "bg-primary-soft font-semibold text-primary-strong hover:bg-primary-tint"
                        : "text-ink-3"
                  }`}
                >
                  {dayNum}
                </button>
                {/* The today marker, as a dot under the number — it must not compete with the
                    selected-day fill, which carries the more important state. */}
                <span
                  aria-hidden
                  className={`mt-0.5 h-1 w-1 rounded-full ${isToday ? "bg-primary" : "bg-transparent"}`}
                />
              </div>
            );
          })}
        </div>

        <div className="mt-5">
          <p className="mb-1.5 text-caption font-semibold text-ink-3">Time zone</p>
          <span className="relative block max-w-xs">
            <Globe size={15} aria-hidden className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-ink-3" />
            {/* A native select on purpose: this is a stranger's unknown device on the one page
                where a broken control costs a booking. */}
            <select
              value={tz}
              onChange={(e) => onTzChange(e.target.value)}
              aria-label="Time zone"
              className="h-11 w-full cursor-pointer appearance-none rounded-field border border-line bg-surface pl-9 pr-9 text-sm text-ink outline-none focus:border-primary"
            >
              {zones.map((z) => (
                <option key={z} value={z}>
                  {z.replace(/_/g, " ")} ({offsetLabel(z)})
                </option>
              ))}
            </select>
            <ChevronRight size={15} aria-hidden className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 rotate-90 text-ink-3" />
          </span>
        </div>
      </div>

      {/* ── Times for the chosen day ── */}
      <div className="sm:border-l sm:border-line sm:pl-5">
        <p className="text-sm font-semibold text-ink sm:sr-only">
          {activeDate
            ? new Intl.DateTimeFormat("en-GB", { weekday: "long", day: "numeric", month: "long", timeZone: "UTC" }).format(
                new Date(`${activeDate}T00:00:00Z`),
              )
            : "Times"}
        </p>
        <div className="mt-3 flex max-h-[26rem] flex-col gap-2.5 overflow-y-auto pr-1 sm:mt-0">
          {dayTimes.map((s) => {
            const active = s.id === selectedId;
            return (
              <button
                key={s.id}
                type="button"
                onClick={() => onSelect(s.id)}
                aria-pressed={active}
                className={`h-11 flex-none rounded-field border text-sm font-semibold transition-colors ${
                  active
                    ? "border-primary bg-primary text-on-accent"
                    : "border-primary-tint bg-surface text-primary-strong hover:border-primary hover:bg-primary-soft"
                }`}
              >
                {timeIn(tz, s.startsAtIso)}
              </button>
            );
          })}
          {dayTimes.length === 0 && (
            <p className="text-caption text-muted">No times on this day — pick another highlighted date.</p>
          )}
        </div>
      </div>
    </div>
  );
}
