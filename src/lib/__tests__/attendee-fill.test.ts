import { test } from "node:test";
import assert from "node:assert/strict";
import { fillFromAttendee } from "../attendee-fill";

/**
 * The agreement's signing link and its one-time code both go to the WhatsApp number this rule
 * decides. Every case below is a way the wrong number reaches the wrong person, and two of them
 * are bugs this actually shipped with before the browser caught them.
 */

const BLANK = { phone: "", email: "" };
const PRIYA = { phone: "+919876500001", email: "priya@example.com" };
const ARUN = { phone: "+919876500002", email: "arun@example.com" };
/** A real case: plenty of bookings carry a number and no address. */
const SANA = { phone: "+919876500003", email: "" };

test("an empty form takes everything the booking knows", () => {
  assert.deepEqual(fillFromAttendee({ current: BLANK, injected: BLANK, picked: PRIYA }), PRIYA);
});

test("correcting yourself to another attendee replaces the first one's details", () => {
  // THE BUG: "only fill empty boxes" left the form reading "Arun Mehta" beside Priya's number,
  // so the code that executes the contract was delivered to somebody else's phone.
  const after = fillFromAttendee({ current: PRIYA, injected: PRIYA, picked: ARUN });
  assert.deepEqual(after, ARUN);
});

test("an attendee with no email CLEARS the last one's, rather than keeping it", () => {
  // A blank is honest. Priya's address sitting under Sana's name is not.
  const after = fillFromAttendee({ current: PRIYA, injected: PRIYA, picked: SANA });
  assert.deepEqual(after, { phone: SANA.phone, email: "" });
});

test("what a person typed is never overwritten", () => {
  const typed = { phone: "+4915222311374", email: "" };
  const after = fillFromAttendee({ current: typed, injected: PRIYA, picked: ARUN });
  assert.equal(after.phone, "+4915222311374", "a hand-typed number outranks any booking");
  assert.equal(after.email, ARUN.email, "the untouched box still fills");
});

test("a CRM prefill outranks the booking form", () => {
  // The form opened from the client picker already carries the student's current number. A
  // booking filled in months ago must not quietly downgrade it.
  const fromCrm = { phone: "+919999000011", email: "current@example.com" };
  const after = fillFromAttendee({ current: fromCrm, injected: BLANK, picked: PRIYA });
  assert.deepEqual(after, fromCrm);
});

test("whitespace is not a value", () => {
  // A box holding only spaces reads as empty to the person looking at it, so it fills.
  const after = fillFromAttendee({ current: { phone: "   ", email: "" }, injected: BLANK, picked: PRIYA });
  assert.deepEqual(after, PRIYA);
});

test("picking the same person twice is a no-op", () => {
  const after = fillFromAttendee({ current: PRIYA, injected: PRIYA, picked: PRIYA });
  assert.deepEqual(after, PRIYA);
});
