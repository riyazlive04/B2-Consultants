/**
 * One shape for "a thing on the calendar", shared by Discovery (AppointmentSlot + BookingRequest)
 * and SSS (SssSlot + OutreachJourney), so both render, filter and list through the same code -
 * the way Synamate treats every calendar's appointments alike. Pure and client-safe.
 *
 * Layout copied from Synamate (capture 12 Nov 2026); colours are the app's own tokens (eventLook).
 */

export type CalType = "DISCO" | "SSS";
export type CalStatus = "CONFIRMED" | "UNCONFIRMED" | "SHOWED" | "NO_SHOW" | "CANCELLED";

export type CalendarRef = {
  key: string; // "disco:<ownerId>" | "sss:<ownerId>"; ownerId "" = unassigned
  type: CalType;
  name: string;
  color: string;
};

export type CalEvent = {
  id: string;
  kind: "APPOINTMENT" | "BLOCKED";
  calendar: CalendarRef;
  ownerId: string | null;
  ownerName: string | null;
  ownerColor: string;
  startsAt: string; // ISO UTC
  endsAt: string;
  title: string;
  contact: { name: string; phone: string | null; email: string | null; leadId: string | null } | null;
  status: CalStatus;
  source: { table: "slot" | "release" | "sss"; id: string; bookingId?: string; journeyId?: string };
};

// Colours are the app's design tokens (owner decision 13 Nov), so both themes and the AA tuning of
// design system v1.1 carry over. Each person keeps one hue; SSS calendars share --chart-2, which is
// left out of the people palette so an SSS card never reads as someone's Discovery call.
const PEOPLE = ["var(--chart-1)", "var(--chart-3)", "var(--chart-4)", "var(--chart-5)", "var(--chart-6)", "var(--primary)"];
const SSS_COLOR = "var(--chart-2)";
const UNASSIGNED = "var(--border-strong)";

/** `index` = the owner's position in the name-sorted team list; -1 = unassigned/unknown. */
export function ownerColor(index: number): string {
  return index < 0 ? UNASSIGNED : PEOPLE[index % PEOPLE.length];
}

const firstName = (name: string | null) => name?.trim().split(/\s+/)[0] || "";

export function calendarRef(type: CalType, owner: { id: string; name: string | null } | null, index: number): CalendarRef {
  const who = firstName(owner?.name ?? null);
  const key = `${type === "DISCO" ? "disco" : "sss"}:${owner?.id ?? ""}`;
  if (type === "SSS") {
    return { key, type, name: who ? `Solution Strategy Session - ${who}` : "Solution Strategy Session", color: SSS_COLOR };
  }
  return { key, type, name: who ? `Personalized Discovery Call with ${who}` : "Discovery Call (unassigned)", color: ownerColor(index) };
}

/** Synamate: "<calendar label> between <contact> and <owner first name>". */
export function eventTitle(type: CalType, contactName: string, ownerName: string | null): string {
  const label = type === "SSS" ? "Solution Strategy Session" : "Personalized Discovery Call";
  const who = firstName(ownerName);
  return who ? `${label} between ${contactName} and ${who}` : `${label} with ${contactName}`;
}

/** Discovery BookingStatus (+ confirmation) → the calendar's status. */
export function discoStatus(status: string, confirmed: boolean): CalStatus {
  if (status === "COMPLETED") return "SHOWED";
  if (status === "NO_SHOW") return "NO_SHOW";
  if (status === "CANCELLED") return "CANCELLED";
  return confirmed ? "CONFIRMED" : "UNCONFIRMED";
}

/** A SlotRelease reason → the status of the ghost event it leaves; null = not shown (a move). */
export function releaseStatus(reason: string): CalStatus | null {
  if (reason === "POSTPONED") return null; // the booking is drawn at its new slot instead
  return reason === "NO_SHOW" ? "NO_SHOW" : "CANCELLED";
}

export type EventLook = { bg: string; border: string; edge: string; text: string; strike: boolean; dashed: boolean };

const tint = (c: string, pct: number) => `color-mix(in srgb, ${c} ${pct}%, var(--surface))`;

/**
 * Colours for one event card: Synamate's structure (fill = calendar, 5px left edge = owner,
 * cancelled hollow + struck, blocked grey) in the house slot-tint idiom - a soft tint mixed over
 * `--surface` with ink text, never a saturated fill under white, so it holds AA in both themes.
 */
export function eventLook(ev: Pick<CalEvent, "kind" | "status" | "calendar" | "ownerColor">): EventLook {
  if (ev.kind === "BLOCKED") {
    return { bg: "var(--surface-2)", border: "var(--line)", edge: "var(--border-strong)", text: "var(--ink-2)", strike: false, dashed: false };
  }
  const c = ev.calendar.color;
  if (ev.status === "CANCELLED" || ev.status === "NO_SHOW") {
    return { bg: "var(--surface)", border: tint(c, 55), edge: tint(c, 55), text: "var(--ink-3)", strike: ev.status === "CANCELLED", dashed: false };
  }
  // Unconfirmed = a slot held for someone who has not said YES; the dashed border is the one cue.
  return { bg: tint(c, 16), border: tint(c, 45), edge: ev.ownerColor, text: "var(--ink)", strike: false, dashed: ev.status === "UNCONFIRMED" };
}
