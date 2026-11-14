"use client";

import { useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { Btn } from "@/components/ui/controls";
import { askConfirm, toast } from "@/components/ui/feedback";
import { safeAction } from "@/lib/action-guard";
import type { CalEvent } from "@/lib/calendar-event";
import { canMove, movePlan, type MoveLane } from "@/lib/calendar-move";
import { rescheduleBookingToTime } from "@/server/booking-actions";
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
 *
 * Moving a call is the same two-step the SSS calendar already uses - arm it, then pick a time -
 * with dragging as a second way to arm and land it in one gesture. That is what makes it work for
 * a keyboard and a phone, where HTML5 drag does not exist at all.
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
  const router = useRouter();
  const [eventId, setEventId] = useState<string | null>(null);
  const [book, setBook] = useState<{ dayKey: string; min: number | null } | null>(null);
  const [moving, setMoving] = useState<CalEvent | null>(null);
  const [busy, setBusy] = useState(false);
  const ev = events.find((e) => e.id === eventId) ?? null;

  const laneOf = (el: Element): MoveLane => {
    const [day, min] = (el.getAttribute("data-lane") ?? ":").split(":");
    const owner = el.getAttribute("data-lane-owner");
    return { dayKey: day, min: Number(min), ...(owner === null ? {} : { ownerId: owner }) };
  };

  const cardOf = (target: EventTarget | null) => {
    const el = (target as HTMLElement | null)?.closest?.("[data-event-id]");
    return el ? events.find((e) => e.id === el.getAttribute("data-event-id")) ?? null : null;
  };

  /** Moves the armed call onto `lane`, after asking. The server re-checks everything. */
  const place = async (target: CalEvent, lane: MoveLane) => {
    if (busy) return;
    setMoving(null);
    const r = movePlan(target, lane, new Date().toISOString());
    if ("error" in r) return toast(r.error, "error");
    const ok = await askConfirm({
      title: r.plan.label,
      body: "The old slot goes back on the calendar, and the prospect is told their call moved and asked to confirm the new time.",
      confirmLabel: "Move call",
    });
    if (!ok) return;
    setBusy(true);
    const res = await safeAction(() => rescheduleBookingToTime(r.plan));
    setBusy(false);
    if (!res.ok) return toast(res.error, "error");
    toast("Call moved - prospect notified", "success");
    router.refresh();
  };

  return (
    <div
      className="group"
      data-moving={moving ? "1" : undefined}
      onClick={(e) => {
        const el = (e.target as HTMLElement).closest?.("[data-event-id], [data-lane], [data-new-entry]");
        if (!el) return;
        const id = el.getAttribute("data-event-id");
        if (id) return setEventId(id);
        const lane = el.getAttribute("data-lane");
        if (lane) {
          // Armed? the lane is where this call is going. Otherwise it is an empty time to book.
          if (moving) return void place(moving, laneOf(el));
          const [day, min] = lane.split(":");
          return setBook({ dayKey: day, min: Number(min) });
        }
        setBook({ dayKey, min: null });
      }}
      onDragStart={(e) => {
        const card = cardOf(e.target);
        if (!card || !canMove(card)) return;
        // Firefox starts no drag without data on the transfer.
        e.dataTransfer.setData("text/plain", card.id);
        e.dataTransfer.effectAllowed = "move";
        setMoving(card);
      }}
      onDragOver={(e) => {
        if (moving && (e.target as HTMLElement).closest?.("[data-lane]")) e.preventDefault();
      }}
      onDrop={(e) => {
        const el = (e.target as HTMLElement).closest?.("[data-lane]");
        if (!moving || !el) return;
        e.preventDefault();
        void place(moving, laneOf(el));
      }}
      /* A drag that ends anywhere but a lane disarms; one armed from the drawer stays armed. */
      onDragEnd={() => setMoving(null)}
    >
      {moving && (
        <div
          role="status"
          className="mb-3 flex flex-wrap items-center justify-between gap-2 rounded-card border border-primary bg-primary-soft px-3 py-2 text-sm text-ink"
        >
          <span>
            Moving <strong className="font-semibold">{moving.contact?.name ?? "this call"}</strong> - pick an empty
            time on the grid, or drop the card on one.
          </span>
          <Btn variant="ghost" size="sm" onClick={() => setMoving(null)}>
            Cancel
          </Btn>
        </div>
      )}
      {children}
      {ev && (
        <EventDrawer
          ev={ev}
          canSetSss={canSetSss}
          onMove={() => {
            setMoving(ev);
            setEventId(null);
          }}
          onClose={() => setEventId(null)}
        />
      )}
      {book && <BookModal dayKey={book.dayKey} min={book.min} team={team} onClose={() => setBook(null)} />}
    </div>
  );
}
