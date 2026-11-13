/**
 * One shape for "a thing on the calendar", shared by Discovery (AppointmentSlot + BookingRequest)
 * and SSS (SssSlot + OutreachJourney), so both render, filter and list through the same code -
 * the way Synamate treats every calendar's appointments alike. Pure and client-safe.
 *
 * Look copied from Synamate (capture 12 Nov 2026): fill = calendar colour, 5px left edge = owner
 * colour, cancelled = hollow + strikethrough, blocked = grey "Busy". Text colour is the one
 * deliberate departure: Synamate puts white on yellow/green (1.7:1, 2.6:1), we pick dark there.
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

// Synamate's own calendar colours first (Asma's Disco indigo, Ameen's Disco yellow), then the
// rest of the Google-calendar set it picks from.
const DISCO_FILLS = ["#3F51B5", "#F6BF26", "#039BE5", "#8E24AA", "#E67C73", "#0B8043", "#F4511E", "#7986CB"];
const SSS_FILL = "#33B679";
// Owner edge colours: Synamate's Asma purple + Ameen gold, then six more darker hues.
const OWNER_EDGES = ["#50449A", "#BFA100", "#0E7490", "#B42318", "#3B7C0F", "#9F1AB1", "#C4320A", "#344054"];
const UNASSIGNED = "#98A2B3";

export const DARK_TEXT = "#101828";
export const BUSY = { bg: "#E1E1E1", text: "#475467" }; // Synamate's #667085 is 3.7:1 on #E1E1E1

/** `index` = the owner's position in the name-sorted team list; -1 = unassigned/unknown. */
export function ownerColor(index: number): string {
  return index < 0 ? UNASSIGNED : OWNER_EDGES[index % OWNER_EDGES.length];
}

const firstName = (name: string | null) => name?.trim().split(/\s+/)[0] || "";

export function calendarRef(type: CalType, owner: { id: string; name: string | null } | null, index: number): CalendarRef {
  const who = firstName(owner?.name ?? null);
  const key = `${type === "DISCO" ? "disco" : "sss"}:${owner?.id ?? ""}`;
  if (type === "SSS") {
    return { key, type, name: who ? `Solution Strategy Session - ${who}` : "Solution Strategy Session", color: SSS_FILL };
  }
  return {
    key,
    type,
    name: who ? `Personalized Discovery Call with ${who}` : "Discovery Call (unassigned)",
    color: index < 0 ? UNASSIGNED : DISCO_FILLS[index % DISCO_FILLS.length],
  };
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

function luminance(hex: string): number {
  const n = parseInt(hex.slice(1), 16);
  const lin = (c: number) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
  return 0.2126 * lin(((n >> 16) & 255) / 255) + 0.7152 * lin(((n >> 8) & 255) / 255) + 0.0722 * lin((n & 255) / 255);
}

export function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

/** White when it meets WCAG AA (4.5:1) on `fill`, otherwise dark. */
export function textOn(fill: string): string {
  return contrast("#FFFFFF", fill) >= 4.5 ? "#FFFFFF" : DARK_TEXT;
}

export type EventLook = { bg: string; border: string; edge: string; text: string; strike: boolean };

/** Colours for one event card (Synamate: 2px border, 5px left edge in the owner colour). */
export function eventLook(ev: Pick<CalEvent, "kind" | "status" | "calendar" | "ownerColor">): EventLook {
  if (ev.kind === "BLOCKED") return { bg: BUSY.bg, border: BUSY.bg, edge: BUSY.bg, text: BUSY.text, strike: false };
  const fill = ev.calendar.color;
  if (ev.status === "CANCELLED" || ev.status === "NO_SHOW") {
    // Hollow card: calendar colour as text only where it is readable on white.
    const text = contrast(fill, "#FFFFFF") >= 4.5 ? fill : DARK_TEXT;
    return { bg: "#FFFFFF", border: fill, edge: fill, text, strike: ev.status === "CANCELLED" };
  }
  return { bg: fill, border: fill, edge: ev.ownerColor, text: textOn(fill), strike: false };
}
