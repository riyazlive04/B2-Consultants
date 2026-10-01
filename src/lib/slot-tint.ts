/**
 * What a slot looks like, defined once.
 *
 * Two surfaces draw the same slot - the week grid on /bookings and the "Upcoming slots" list on
 * /bookings/availability - and they had drifted into two different visual languages for the same
 * five states. A founder reading "open" as a green card on one screen and as a green PILL in a
 * sentence on the other is being asked to learn the thing twice.
 *
 * Colours are mixed against `--surface`, never against literal white: a 12% tint of `--ok` over
 * white is a bright mint rectangle on a dark card in dark mode, which is most of what made these
 * panels look broken at night. (Design system §: never hardcode `white`; use the token.)
 */

export type SlotTintKind =
  /** Bookable - nobody has it. */
  | "OPEN"
  /** Booked and confirmed: the prospect said YES. */
  | "BOOKED"
  /** Booked but unconfirmed - held for someone who has not answered. See lib/booking-hold. */
  | "HELD"
  /** Deliberately out of availability. */
  | "BLOCKED"
  /** Cancelled or no-show. */
  | "RISK";

export type SlotTint = { bg: string; edge: string };

const TINTS: Record<SlotTintKind, SlotTint> = {
  OPEN: { bg: "color-mix(in srgb, var(--ok) 12%, var(--surface))", edge: "var(--ok)" },
  BOOKED: { bg: "color-mix(in srgb, var(--chart-1) 12%, var(--surface))", edge: "var(--chart-1)" },
  // Slightly stronger than the others on purpose: an unanswered hold is the one state that is
  // counting down, and it should catch the eye on a grid of forty slots.
  HELD: { bg: "color-mix(in srgb, var(--watch) 14%, var(--surface))", edge: "var(--watch)" },
  BLOCKED: { bg: "var(--surface-2)", edge: "var(--muted)" },
  RISK: { bg: "var(--risk-soft)", edge: "var(--risk)" },
};

export function slotTint(kind: SlotTintKind): SlotTint {
  return TINTS[kind];
}

/** The plain `SlotStatus` → tint, for surfaces that have no booking to ask about. */
export function statusTint(status: string): SlotTint {
  return TINTS[status === "BOOKED" ? "BOOKED" : status === "BLOCKED" ? "BLOCKED" : "OPEN"];
}
