import { test, describe } from "node:test";
import assert from "node:assert/strict";

import {
  expiryFor,
  recordingState,
  isRecordingAvailable,
  daysLeft,
  accessLabel,
  catchUpState,
  hoursSince,
  needsFollowUp,
  MAX_RECORDING_ACCESS_DAYS,
} from "../recording-access";

/**
 * The recording access window, and the catch-up verdict built on it.
 *
 * The cases worth reading are the two that decide whether a real person gets chased:
 * `NO_RECORDING` (where the chore is the coach's, not the student's) and `WINDOW_CLOSED` (where
 * nagging is pointless because the video is gone).
 */

const at = (iso: string) => new Date(iso);
const POSTED = at("2026-10-21T12:00:00.000Z");

describe("expiryFor", () => {
  test("adds the days asked for", () => {
    assert.equal(expiryFor(POSTED, 7)!.toISOString(), "2026-10-28T12:00:00.000Z");
    assert.equal(expiryFor(POSTED, 30)!.toISOString(), "2026-11-20T12:00:00.000Z");
  });

  test("zero and below mean no limit, which is null and not an error", () => {
    assert.equal(expiryFor(POSTED, 0), null);
    assert.equal(expiryFor(POSTED, -5), null);
    assert.equal(expiryFor(POSTED, Number.NaN), null);
  });

  test("caps a runaway number rather than storing a 300-year window", () => {
    const capped = expiryFor(POSTED, 9_999_999)!;
    assert.equal(capped.getTime() - POSTED.getTime(), MAX_RECORDING_ACCESS_DAYS * 86_400_000);
  });
});

describe("recordingState", () => {
  const until = at("2026-10-28T12:00:00Z");

  test("null is UNLIMITED - the old lifetime behaviour, kept as the default", () => {
    assert.equal(recordingState(null, POSTED), "UNLIMITED");
    assert.equal(isRecordingAvailable(null, at("2099-01-01T00:00:00Z")), true);
  });

  test("open up to and including the closing instant", () => {
    assert.equal(recordingState(until, at("2026-10-28T11:59:59Z")), "OPEN");
    assert.equal(recordingState(until, until), "OPEN");
    assert.equal(recordingState(until, at("2026-10-28T12:00:01Z")), "EXPIRED");
    assert.equal(isRecordingAvailable(until, at("2026-10-29T00:00:00Z")), false);
  });
});

describe("daysLeft and accessLabel", () => {
  const until = at("2026-10-28T12:00:00Z");

  test("rounds UP, so a part-day never reads as zero days left", () => {
    // Eleven hours left is still today's problem, not a closed window.
    assert.equal(daysLeft(until, at("2026-10-28T01:00:00Z")), 1);
    assert.equal(daysLeft(until, at("2026-10-26T12:00:00Z")), 2);
    assert.equal(daysLeft(until, at("2026-10-29T00:00:00Z")), 0);
    assert.equal(daysLeft(null, POSTED), null);
  });

  test("reads as a sentence a student can act on", () => {
    assert.equal(accessLabel(null, POSTED), "No time limit");
    assert.equal(accessLabel(until, at("2026-10-24T12:00:00Z")), "4 days left to watch");
    assert.equal(accessLabel(until, at("2026-10-28T01:00:00Z")), "Last day to watch");
    assert.equal(accessLabel(until, at("2026-10-29T12:00:00Z")), "No longer available");
  });
});

describe("catchUpState", () => {
  const grace = 24;

  test("watched beats everything, including an expired window", () => {
    // The catch-up happened. A window that has since closed does not un-happen it.
    assert.equal(
      catchUpState(
        {
          recordingPostedAt: POSTED,
          availableUntil: at("2026-10-22T12:00:00Z"),
          watchComplete: true,
          graceHours: grace,
        },
        at("2026-11-01T12:00:00Z"),
      ),
      "CAUGHT_UP",
    );
  });

  test("no recording is the COACH's chore, not the student's", () => {
    // The one row on the list that blames the right person. Checked before the grace, because a
    // student cannot be late for a video that does not exist.
    assert.equal(
      catchUpState(
        { recordingPostedAt: null, availableUntil: null, watchComplete: false, graceHours: grace },
        at("2026-11-01T12:00:00Z"),
      ),
      "NO_RECORDING",
    );
  });

  test("inside the grace window it is not yet a problem", () => {
    assert.equal(
      catchUpState(
        { recordingPostedAt: POSTED, availableUntil: null, watchComplete: false, graceHours: grace },
        at("2026-10-22T11:59:00Z"),
      ),
      "IN_GRACE",
    );
  });

  test("OVERDUE the moment the grace runs out - the founders' 24 hours", () => {
    assert.equal(
      catchUpState(
        { recordingPostedAt: POSTED, availableUntil: null, watchComplete: false, graceHours: grace },
        at("2026-10-22T12:00:00Z"),
      ),
      "OVERDUE",
    );
  });

  test("a zero grace makes it overdue immediately", () => {
    assert.equal(
      catchUpState(
        { recordingPostedAt: POSTED, availableUntil: null, watchComplete: false, graceHours: 0 },
        POSTED,
      ),
      "OVERDUE",
    );
  });

  test("WINDOW_CLOSED outranks OVERDUE - nagging is pointless once the video is gone", () => {
    assert.equal(
      catchUpState(
        {
          recordingPostedAt: POSTED,
          availableUntil: at("2026-10-28T12:00:00Z"),
          watchComplete: false,
          graceHours: grace,
        },
        at("2026-10-29T12:00:00Z"),
      ),
      "WINDOW_CLOSED",
    );
  });
});

describe("needsFollowUp", () => {
  test("only the three states a coach can do something about", () => {
    assert.equal(needsFollowUp("OVERDUE"), true);
    assert.equal(needsFollowUp("WINDOW_CLOSED"), true);
    assert.equal(needsFollowUp("NO_RECORDING"), true);
    assert.equal(needsFollowUp("IN_GRACE"), false);
    assert.equal(needsFollowUp("CAUGHT_UP"), false);
  });
});

describe("hoursSince", () => {
  test("floors, and never goes negative on a future timestamp", () => {
    assert.equal(hoursSince(POSTED, at("2026-10-22T13:30:00Z")), 25);
    assert.equal(hoursSince(POSTED, POSTED), 0);
    assert.equal(hoursSince(POSTED, at("2026-10-20T12:00:00Z")), 0);
  });
});
