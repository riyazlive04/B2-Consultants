import test from "node:test";
import assert from "node:assert/strict";
import { canMove, movePlan } from "../calendar-move";
import type { CalEvent, CalStatus, CalType } from "../calendar-event";

/**
 * Feature 8 (build-docs/features/calendar-drag-reschedule.md): what a drop on a lane means.
 *
 * The move itself is `rescheduleBookingToTime`, which is already live from the Bookings table and
 * re-validates everything here. These cases pin the half that is new: which cards may be dragged,
 * and the exact action input a drop turns into - including the refusals that stop a move ever
 * reaching the database (AC2).
 */

const NOW = "2026-11-14T06:00:00Z"; // 11:30 IST on 14 Nov

const ev = (o: Partial<CalEvent> = {}): CalEvent => ({
  id: "e1",
  kind: "APPOINTMENT",
  calendar: { key: "disco:u1", type: "DISCO", name: "Disco", color: "var(--chart-1)" },
  ownerId: "u1",
  ownerName: "Asma",
  ownerColor: "var(--chart-1)",
  // 15:00-15:30 IST on 16 Nov.
  startsAt: "2026-11-16T09:30:00Z",
  endsAt: "2026-11-16T10:00:00Z",
  title: "Discovery",
  contact: { name: "Rohan Pillai", phone: null, email: null, leadId: "l1" },
  status: "CONFIRMED",
  meetingUrl: null,
  source: { table: "slot", id: "s1", bookingId: "b1" },
  ...o,
});

const plan = (e: CalEvent, lane: Parameters<typeof movePlan>[1]) => {
  const r = movePlan(e, lane, NOW);
  assert.ok("plan" in r, `expected a plan, got ${JSON.stringify(r)}`);
  return r.plan;
};
const err = (e: CalEvent, lane: Parameters<typeof movePlan>[1]) => {
  const r = movePlan(e, lane, NOW);
  assert.ok("error" in r, "expected a refusal");
  return r.error;
};

test("drag-reschedule AC1: a valid drop becomes the reschedule the Bookings table already does", () => {
  // Dropped on the 10:00 lane of 20 Nov in Week view (no owner column), from a 30-minute call.
  const p = plan(ev(), { dayKey: "2026-11-20", min: 600 });
  assert.deepEqual(
    { ...p, label: "" },
    { bookingId: "b1", date: "2026-11-20", time: "10:00", durationMins: 30, assignedToId: "u1", label: "" },
  );
  // The question names the person and the IST time they are being moved to.
  assert.equal(p.label, "Move Rohan Pillai to Fri, 20 Nov 2026, 10:00 AM?");
  // The call's own length is carried over, never a default: a 45-minute call stays 45.
  assert.equal(plan(ev({ endsAt: "2026-11-16T10:15:00Z" }), { dayKey: "2026-11-20", min: 600 }).durationMins, 45);
});

test("drag-reschedule AC1: dropping in another person's Day column hands them the call", () => {
  assert.equal(plan(ev(), { dayKey: "2026-11-20", min: 540, ownerId: "u2" }).assignedToId, "u2");
  // The Unassigned column is "" - a real choice, not a missing one.
  assert.equal(plan(ev(), { dayKey: "2026-11-20", min: 540, ownerId: "" }).assignedToId, "");
  // Week view has no owner column, so the owner is left exactly as it was.
  assert.equal(plan(ev({ ownerId: null }), { dayKey: "2026-11-20", min: 540 }).assignedToId, "");
});

test("drag-reschedule AC2: a drop in the past, or on its own time, never becomes a move", () => {
  assert.equal(err(ev(), { dayKey: "2026-11-14", min: 600 }), "That time has already passed."); // 10:00 IST, gone
  assert.equal(err(ev(), { dayKey: "2026-11-13", min: 900 }), "That time has already passed.");
  // Its own lane, same owner: nothing to do. In Day view the same lane under another name is a move.
  assert.equal(err(ev(), { dayKey: "2026-11-16", min: 900 }), "That call is already at this time.");
  assert.equal(plan(ev(), { dayKey: "2026-11-16", min: 900, ownerId: "u2" }).assignedToId, "u2");
  // A lane that is not a time at all.
  assert.equal(err(ev(), { dayKey: "2026-11-20", min: 1440 }), "That is not a time on this calendar.");
  assert.equal(err(ev(), { dayKey: "not-a-day", min: 600 }), "That is not a time on this calendar.");
});

test("drag-reschedule AC2/AC3: only a live discovery call is draggable at all", () => {
  assert.equal(canMove(ev()), true);
  assert.equal(canMove(ev({ status: "UNCONFIRMED" })), true);
  assert.equal(canMove(ev({ status: "SHOWED" })), true);
  // Blocked time has no booking; a cancelled or no-show card is a release ghost with no slot left.
  assert.equal(canMove(ev({ kind: "BLOCKED", source: { table: "slot", id: "s1" } })), false);
  for (const s of ["CANCELLED", "NO_SHOW"] as CalStatus[]) assert.equal(canMove(ev({ status: s })), false);
  assert.equal(canMove(ev({ source: { table: "release", id: "r1", bookingId: "b1" } })), false);
  // AC3: a strategy session is NOT moved here - the grid draws no open SSS slots to land on, and
  // the SSS Calendar tab already moves one onto a real slot (keeping journey.sssAt in step).
  const sss = ev({
    calendar: { key: "sss:u1", type: "SSS" as CalType, name: "SSS", color: "var(--chart-2)" },
    source: { table: "sss", id: "x1", journeyId: "j1" },
  });
  assert.equal(canMove(sss), false);
  assert.equal(err(sss, { dayKey: "2026-11-20", min: 600 }), "Only a booked discovery call can be dragged to a new time.");
});
