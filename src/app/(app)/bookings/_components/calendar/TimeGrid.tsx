"use client";

import { useEffect, useRef, useState } from "react";
import type { CalEvent } from "@/lib/calendar-event";
import { DAY_PX, HOUR_PX, SCROLL_TO_MIN, istSlot, minutePx, placeDay } from "@/lib/calendar-grid";
import { EventCard } from "./EventCard";

/**
 * The hour-by-hour grid behind both Week (one column per day) and Day (one per team member).
 *
 * Client-side for three reasons only: the scroll position on load, the red "now" line, and
 * clicking an empty lane to book. Everything else - which events exist, where they sit, what they
 * look like - was decided on the server by `placeDay`.
 */

export type GridColumn = {
  key: string; // the column's identity: a day key in Week, an owner id in Day
  label: string;
  sublabel?: string;
  isToday?: boolean;
  /** The IST day these events are laid out against. */
  dayKey: string;
  events: CalEvent[];
};

const HOURS = Array.from({ length: 24 }, (_, h) => h);
const hourLabel = (h: number) => `${((h + 11) % 12) + 1}:00 ${h < 12 ? "AM" : "PM"}`;

export function TimeGrid({ columns }: { columns: GridColumn[] }) {
  const scroller = useRef<HTMLDivElement>(null);
  const [nowMin, setNowMin] = useState<{ key: string; min: number } | null>(null);

  // The clock belongs to the browser, so it can only be read after mount - a server-rendered
  // "now" line would be the server's clock, frozen at render time.
  useEffect(() => {
    const tick = () => setNowMin(istSlot(new Date()));
    tick();
    const id = setInterval(tick, 60_000);
    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    // Less the label's own height, or the 8 AM label sits half under the sticky header.
    if (scroller.current) scroller.current.scrollTop = minutePx(SCROLL_TO_MIN) - 10;
  }, []);

  return (
    <div ref={scroller} className="max-h-[640px] overflow-auto overscroll-contain rounded-card border border-line bg-surface">
      <div className="grid min-w-[760px]" style={{ gridTemplateColumns: `72px repeat(${columns.length}, minmax(0, 1fr))` }}>
        {/* Sticky header: the timezone over the gutter, then one heading per column. */}
        <div className="sticky top-0 z-20 border-b border-r border-line bg-surface px-2 py-2 text-caption text-muted">
          GMT +05:30
        </div>
        {columns.map((c) => (
          <div
            key={c.key}
            className={`sticky top-0 z-20 border-b border-line bg-surface px-2 py-2 text-center ${c.isToday ? "text-accent" : "text-muted"}`}
          >
            <div className="truncate text-xs font-semibold">{c.label}</div>
            {c.sublabel && <div className="truncate text-caption opacity-80">{c.sublabel}</div>}
          </div>
        ))}

        {/* The hour gutter: one cell per hour, its label sitting on the line it names. */}
        <div className="border-r border-line">
          {HOURS.map((h) => (
            <div key={h} className="relative border-b border-line" style={{ height: HOUR_PX }}>
              <span className="absolute -top-2 right-2 bg-surface px-1 text-caption text-muted">{h === 0 ? "" : hourLabel(h)}</span>
            </div>
          ))}
        </div>

        {columns.map((c, i) => (
          <Column key={c.key} col={c} now={nowMin} first={i === 0} />
        ))}
      </div>
    </div>
  );
}

function Column({ col, now, first }: { col: GridColumn; now: { key: string; min: number } | null; first: boolean }) {
  const placed = placeDay(col.events, col.dayKey);
  const showNow = now?.key === col.dayKey;
  return (
    <div className="relative border-r border-line last:border-r-0">
      {/* Half-hour lanes. Each is a button so an empty time can be booked by click or keyboard;
          which half-hour it is travels in `data-lane`, and CalendarHost opens the modal. */}
      {HOURS.map((h) => (
        <div key={h} className="border-b border-line" style={{ height: HOUR_PX }}>
          {[0, 30].map((m) => (
            <button
              key={m}
              type="button"
              data-lane={`${col.dayKey}:${h * 60 + m}`}
              aria-label={`Book ${col.label} at ${String(h).padStart(2, "0")}:${m === 0 ? "00" : "30"}`}
              className="block w-full border-line transition-colors first:border-b first:border-dashed hover:bg-surface-2"
              style={{ height: HOUR_PX / 2 }}
            />
          ))}
        </div>
      ))}

      {placed.map(({ event, place }) => (
        <div
          key={event.id}
          className="absolute px-0.5"
          style={{
            top: `${(place.top / 100) * DAY_PX}px`,
            // Floor: a 20-minute discovery call is 24px tall, and a card below ~22px cannot show
            // a name at all. Overlap is preferable to an unreadable sliver.
            height: `${Math.max((place.height / 100) * DAY_PX, 22)}px`,
            left: `${(place.col / place.cols) * 100}%`,
            width: `${100 / place.cols}%`,
          }}
        >
          <EventCard ev={event} />
        </div>
      ))}

      {showNow && (
        <div
          aria-hidden
          className="pointer-events-none absolute inset-x-0 z-10 border-t-2 border-risk"
          style={{ top: `${minutePx(now.min)}px` }}
        >
          {/* One dot for the line, not one per column: in Day view every column is the same day,
              so the line runs across all of them and only the first should carry the marker. */}
          {first && <span className="absolute -left-0.5 -top-[5px] block h-2 w-2 rounded-full bg-risk" />}
        </div>
      )}
    </div>
  );
}
