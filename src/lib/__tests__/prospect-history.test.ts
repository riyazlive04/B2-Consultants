import test from "node:test";
import assert from "node:assert/strict";
import { summariseProspectHistory, type PriorBooking } from "../prospect-history";

const at = (iso: string) => new Date(`${iso}T10:00:00Z`);
const booking = (o: Partial<PriorBooking> & { id: string }): PriorBooking => ({
  at: at("2026-06-01"),
  status: "COMPLETED",
  email: "anna@work.com",
  bantAvg: null,
  bantVerdict: null,
  ...o,
});

const NOW = at("2026-10-01");

test("a booking is not counted as its own predecessor", () => {
  // The whole point of excludeBookingId: the row on screen must not report itself as history.
  const h = summariseProspectHistory({
    bookings: [booking({ id: "b1" })],
    excludeBookingId: "b1",
    now: NOW,
  });
  assert.equal(h.returning, false);
  assert.deepEqual(h.previous, []);
  assert.equal(h.headline, "");
});

test("a second booking reads as the 2nd, not the 1st", () => {
  const h = summariseProspectHistory({
    bookings: [booking({ id: "b1" }), booking({ id: "b2", at: at("2026-09-01") })],
    excludeBookingId: "b2",
    now: NOW,
  });
  assert.equal(h.returning, true);
  assert.match(h.headline, /^2nd booking/);
});

test("a no-show and a cancellation are never summed", () => {
  // They mean opposite things: one told us, one did not.
  const h = summariseProspectHistory({
    bookings: [
      booking({ id: "b1", status: "NO_SHOW", at: at("2026-05-01") }),
      booking({ id: "b2", status: "CANCELLED", at: at("2026-06-01") }),
      booking({ id: "b3", at: at("2026-09-01") }),
    ],
    excludeBookingId: "b3",
    now: NOW,
  });
  assert.equal(h.noShows, 1);
  assert.equal(h.cancelled, 1);
  assert.equal(h.attended, 0);
  // Two before this one, so the one on screen is their third.
  assert.equal(h.headline, "3rd booking · 1 no-show · 1 cancelled");
});

test("last time means the most recent RESOLVED booking, not the most recent one", () => {
  // A booking still in the future is not an outcome; it is a plan.
  const h = summariseProspectHistory({
    bookings: [
      booking({ id: "b1", status: "NO_SHOW", at: at("2026-05-01") }),
      booking({ id: "b2", status: "BOOKED", at: at("2026-12-01") }),
    ],
    now: NOW,
  });
  assert.equal(h.lastOutcome?.id, "b1");
  assert.equal(h.upcoming, 1);
});

test("a past BOOKED row is not counted as upcoming", () => {
  const h = summariseProspectHistory({
    bookings: [booking({ id: "b1", status: "BOOKED", at: at("2026-05-01") })],
    now: NOW,
  });
  assert.equal(h.upcoming, 0);
});

test("the earlier verdict is quoted, not the current one", () => {
  // The current score is already on the row being read; what it cannot show is the change.
  const h = summariseProspectHistory({
    bookings: [],
    scores: [
      { at: at("2026-09-01"), avg: 3.5, score: 4, verdict: "CONFIRM", source: "OPT_IN" },
      { at: at("2026-03-01"), avg: 1.5, score: 1, verdict: "CANCEL", source: "OPT_IN" },
    ],
    now: NOW,
  });
  assert.equal(h.headline, "was CANCEL");
  assert.equal(h.scores[0].verdict, "CONFIRM"); // newest first
});

test("one score alone says nothing about a change, so it is not quoted", () => {
  const h = summariseProspectHistory({
    bookings: [],
    scores: [{ at: at("2026-09-01"), avg: 3.5, score: 4, verdict: "CONFIRM", source: "OPT_IN" }],
    now: NOW,
  });
  assert.equal(h.returning, false);
  assert.equal(h.headline, "");
});

test("a second email address alone makes someone a returning prospect", () => {
  // This is the case that started all of it: the mail was going to the old address.
  const h = summariseProspectHistory({
    bookings: [],
    emails: [
      { email: "old@college.edu", lastSeenAt: at("2026-03-01"), timesSeen: 1, primary: false },
      { email: "new@work.com", lastSeenAt: at("2026-09-01"), timesSeen: 2, primary: true },
    ],
    now: NOW,
  });
  assert.equal(h.returning, true);
  assert.equal(h.headline, "2 email addresses");
  assert.equal(h.emails[0].email, "new@work.com"); // the one we write to, first
});

test("bookings are newest first whatever order they arrive in", () => {
  const h = summariseProspectHistory({
    bookings: [
      booking({ id: "old", at: at("2026-01-01") }),
      booking({ id: "new", at: at("2026-09-01") }),
      booking({ id: "mid", at: at("2026-05-01") }),
    ],
    now: NOW,
  });
  assert.deepEqual(h.previous.map((b) => b.id), ["new", "mid", "old"]);
});

test("11th, 12th and 13th are not 11st, 12nd and 13rd", () => {
  for (const [count, word] of [[10, "11th"], [11, "12th"], [12, "13th"], [20, "21st"]] as const) {
    const h = summariseProspectHistory({
      bookings: Array.from({ length: count }, (_, i) => booking({ id: `b${i}` })),
      now: NOW,
    });
    assert.match(h.headline, new RegExp(`^${word} booking`));
  }
});

test("a booking with no slot never crashes the sort", () => {
  const h = summariseProspectHistory({
    bookings: [booking({ id: "b1", at: null }), booking({ id: "b2", at: at("2026-09-01") })],
    now: NOW,
  });
  assert.equal(h.previous.length, 2);
  assert.equal(h.previous[0].id, "b2");
});
