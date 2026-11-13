import { eventLook, type CalEvent } from "@/lib/calendar-event";
import { istRangeLabel, istTimeLabel } from "@/lib/calendar-grid";
import { CALENDAR_STATUS_LABELS } from "@/lib/labels";

/**
 * One appointment on the grid: Synamate's card (left edge in the owner's colour, time under the
 * name, struck through once cancelled) drawn in the app's tokens via `eventLook`.
 *
 * A button, not a div: Enter/Space must open the same details the pointer does. `title` carries
 * the full text because the card itself truncates, and `aria-label` says it again for a reader.
 */

export function eventSummary(ev: CalEvent): string {
  const who = ev.contact ? ev.contact.name : "Blocked time";
  const parts = [
    `${who} - ${ev.calendar.name}`,
    istRangeLabel(ev),
    ev.kind === "BLOCKED" ? "Blocked" : CALENDAR_STATUS_LABELS[ev.status],
  ];
  return parts.join(" · ");
}

export function EventCard({ ev, compact = false }: { ev: CalEvent; compact?: boolean }) {
  const look = eventLook(ev);
  const label = eventSummary(ev);
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      data-event-id={ev.id}
      className={`block w-full overflow-hidden rounded-field border text-left transition-shadow hover:shadow-card focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-accent ${
        compact ? "px-1.5 py-0.5" : "h-full px-2 py-1"
      }`}
      style={{
        background: look.bg,
        color: look.text,
        borderColor: look.border,
        borderStyle: look.dashed ? "dashed" : "solid",
        // Long-hand, not `borderLeft`: React warns (and can mis-apply) when a shorthand and a
        // long-hand fight over the same property across a re-render.
        borderLeftWidth: 5,
        borderLeftStyle: "solid",
        borderLeftColor: look.edge,
      }}
    >
      <span className={`block truncate text-caption font-semibold ${look.strike ? "line-through" : ""}`}>
        {ev.kind === "BLOCKED" ? "Blocked" : ev.contact?.name}
      </span>
      {compact ? null : (
        <span className="block truncate text-caption opacity-80">{istTimeLabel(ev.startsAt)}</span>
      )}
    </button>
  );
}
