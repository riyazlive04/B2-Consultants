import test from "node:test";
import assert from "node:assert/strict";
import { discoStatusWrite, FREES_THE_SLOT, type CalStatus } from "../calendar-event";

/** Feature 4 (build-docs/features/appointment-drawer.md): what the drawer's status select writes. */

test("appointment-drawer AC2: No show writes setBookingStatus(id,'NO_SHOW')", () => {
  assert.deepEqual(discoStatusWrite("NO_SHOW"), { bookingStatus: "NO_SHOW" });
  assert.deepEqual(discoStatusWrite("CANCELLED"), { bookingStatus: "CANCELLED" });
  // "Showed" is the calendar's word for the booking's COMPLETED - the select must translate it,
  // or the action rejects the status outright.
  assert.deepEqual(discoStatusWrite("SHOWED"), { bookingStatus: "COMPLETED" });
});

test("appointment-drawer AC2: the two unfinished states are a confirmation, not an outcome", () => {
  assert.deepEqual(discoStatusWrite("CONFIRMED"), { confirmed: true });
  assert.deepEqual(discoStatusWrite("UNCONFIRMED"), { confirmed: false });
});

test("appointment-drawer AC4: exactly the slot-freeing outcomes are confirmed first", () => {
  const frees = (["CONFIRMED", "UNCONFIRMED", "SHOWED", "NO_SHOW", "CANCELLED"] as CalStatus[])
    .filter((s) => FREES_THE_SLOT.includes(s));
  assert.deepEqual(frees, ["NO_SHOW", "CANCELLED"]);
});
