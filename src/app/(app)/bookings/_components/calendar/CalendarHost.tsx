"use client";

import { useState, type ReactNode } from "react";
import type { CalEvent } from "@/lib/calendar-event";
import { BookModal } from "./BookModal";
import { EventDrawer } from "./EventDrawer";

/**
 * The one client listener over the whole calendar.
 *
 * Everything on the grid is already a `<button>` carrying what it is in a data attribute - a card
 * (`data-event-id`), an empty half-hour (`data-lane="<day>:<minutes>"`) or the toolbar's New
 * button (`data-new-entry`). One delegated click handler therefore replaces three callbacks
 * threaded down through the week grid, the day grid and the month grid, and because the browser
 * fires `click` for Enter and Space on a button, the keyboard path is the same one.
 *
 * It also means focus is never moved by us: the button keeps it, so the dialog hands it straight
 * back when it closes.
 */
export function CalendarHost({
  events, team, dayKey, canSetSss, children,
}: {
  events: CalEvent[];
  team: { id: string; name: string | null }[];
  /** The day the grid is showing: what "New" prefills when no lane was clicked. */
  dayKey: string;
  canSetSss: boolean;
  children: ReactNode;
}) {
  const [eventId, setEventId] = useState<string | null>(null);
  const [book, setBook] = useState<{ dayKey: string; min: number | null } | null>(null);
  const ev = events.find((e) => e.id === eventId) ?? null;

  return (
    <div
      onClick={(e) => {
        const el = (e.target as HTMLElement).closest?.("[data-event-id], [data-lane], [data-new-entry]");
        if (!el) return;
        const id = el.getAttribute("data-event-id");
        if (id) return setEventId(id);
        const lane = el.getAttribute("data-lane");
        if (lane) {
          const [day, min] = lane.split(":");
          return setBook({ dayKey: day, min: Number(min) });
        }
        setBook({ dayKey, min: null });
      }}
    >
      {children}
      {ev && <EventDrawer ev={ev} canSetSss={canSetSss} onClose={() => setEventId(null)} />}
      {book && <BookModal dayKey={book.dayKey} min={book.min} team={team} onClose={() => setBook(null)} />}
    </div>
  );
}
