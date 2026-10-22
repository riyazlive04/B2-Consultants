import { test, describe } from "node:test";
import assert from "node:assert/strict";

import {
  windowState,
  isCheckInOpen,
  remainingMs,
  windowEnd,
  countdownLabel,
  selfMarkFor,
  studentMaySeeMark,
  windowLabel,
  MAX_WINDOW_MINUTES,
} from "../attendance-window";

/**
 * The attendance window's rules.
 *
 * Every case here is one a tutor can actually create in an afternoon: opening the register
 * early, forgetting until the class is half over, closing it by hand, marking a student the
 * old way without ever opening a window. The ones worth reading are the two lateness cases -
 * they are the only place in this feature where the app decides something ABOUT a student
 * rather than just recording what a human said.
 */

const CLASS = new Date("2026-10-04T14:30:00.000Z"); // 20:00 IST, a Special Q&A slot
const at = (iso: string) => new Date(iso);

describe("windowState", () => {
  test("a session nobody opened is NEVER_OPENED, not CLOSED", () => {
    assert.equal(windowState({ opensAt: null, closesAt: null }, CLASS), "NEVER_OPENED");
    assert.equal(windowLabel({ opensAt: null, closesAt: null }, CLASS), "Not opened");
  });

  test("open while now is at or before the closing edge", () => {
    const w = { opensAt: at("2026-10-04T14:30:00Z"), closesAt: at("2026-10-04T14:45:00Z") };
    assert.equal(windowState(w, at("2026-10-04T14:30:00Z")), "OPEN");
    assert.equal(windowState(w, at("2026-10-04T14:44:59Z")), "OPEN");
    // Inclusive edge: a check-in landing on the exact closing second is accepted.
    assert.equal(windowState(w, at("2026-10-04T14:45:00Z")), "OPEN");
    assert.equal(windowState(w, at("2026-10-04T14:45:01Z")), "CLOSED");
  });

  test("a window opened in the future still reads OPEN - the lower edge is not tested", () => {
    // There is no UI for scheduling one; this pins the deliberate choice that clock skew
    // cannot lock out a student who is sitting in the class.
    const w = { opensAt: at("2026-10-04T15:00:00Z"), closesAt: at("2026-10-04T15:15:00Z") };
    assert.equal(isCheckInOpen(w, at("2026-10-04T14:30:00Z")), true);
  });

  test("closing by hand moves the closing edge back to now", () => {
    const closedByHand = { opensAt: at("2026-10-04T14:30:00Z"), closesAt: at("2026-10-04T14:33:00Z") };
    assert.equal(windowState(closedByHand, at("2026-10-04T14:34:00Z")), "CLOSED");
    assert.equal(windowLabel(closedByHand, at("2026-10-04T14:34:00Z")), "Closed");
  });

  test("a half-written window is NEVER_OPENED rather than a crash", () => {
    assert.equal(windowState({ opensAt: at("2026-10-04T14:30:00Z"), closesAt: null }, CLASS), "NEVER_OPENED");
  });
});

describe("remainingMs", () => {
  test("counts down, and is zero for anything not open", () => {
    const w = { opensAt: at("2026-10-04T14:30:00Z"), closesAt: at("2026-10-04T14:45:00Z") };
    assert.equal(remainingMs(w, at("2026-10-04T14:40:00Z")), 5 * 60_000);
    assert.equal(remainingMs(w, at("2026-10-04T14:46:00Z")), 0);
    assert.equal(remainingMs({ opensAt: null, closesAt: null }, CLASS), 0);
  });

  test("windowLabel carries the countdown", () => {
    const w = { opensAt: at("2026-10-04T14:30:00Z"), closesAt: at("2026-10-04T14:45:00Z") };
    assert.equal(windowLabel(w, at("2026-10-04T14:40:29Z")), "Open · 4:31 left");
  });
});

describe("windowEnd", () => {
  test("adds the minutes asked for", () => {
    assert.equal(windowEnd(at("2026-10-04T14:30:00Z"), 15).toISOString(), "2026-10-04T14:45:00.000Z");
  });

  test("clamps a nonsense duration instead of trusting it", () => {
    // 0 and a negative would create a window that is shut the instant it opens; 10_000 would
    // leave one open for a week. Both are clamped rather than rejected, because the caller is
    // a form and the useful outcome is a usable window, not an error.
    assert.equal(windowEnd(at("2026-10-04T14:30:00Z"), 0).toISOString(), "2026-10-04T14:31:00.000Z");
    assert.equal(windowEnd(at("2026-10-04T14:30:00Z"), -5).toISOString(), "2026-10-04T14:31:00.000Z");
    assert.equal(
      windowEnd(at("2026-10-04T14:30:00Z"), 10_000).getTime() - at("2026-10-04T14:30:00Z").getTime(),
      MAX_WINDOW_MINUTES * 60_000,
    );
  });
});

describe("countdownLabel", () => {
  test("mm:ss, and h:mm:ss past the hour", () => {
    assert.equal(countdownLabel(271_000), "4:31");
    assert.equal(countdownLabel(9_000), "0:09");
    assert.equal(countdownLabel(0), "0:00");
    assert.equal(countdownLabel(-500), "0:00");
    assert.equal(countdownLabel(3_661_000), "1:01:01");
  });
});

describe("selfMarkFor", () => {
  const grace = 10;

  test("checking in as the class begins is PRESENT even when the register opened early", () => {
    // THE CASE THAT BREAKS A WINDOW-ONLY ANCHOR. The tutor opened 10 minutes before the hour
    // so arrivals could tick themselves off; a student checking in exactly on the hour is on
    // time, and anchoring to the window alone would have called them late.
    const opensAt = at("2026-10-04T14:20:00Z");
    assert.equal(selfMarkFor({ opensAt, classStartsAt: CLASS, graceMinutes: grace }, CLASS), "PRESENT");
    assert.equal(
      selfMarkFor({ opensAt, classStartsAt: CLASS, graceMinutes: grace }, at("2026-10-04T14:40:00Z")),
      "PRESENT",
    );
    assert.equal(
      selfMarkFor({ opensAt, classStartsAt: CLASS, graceMinutes: grace }, at("2026-10-04T14:40:01Z")),
      "LATE",
    );
  });

  test("a tutor who opens the register late does not make the whole room late", () => {
    // THE CASE THAT BREAKS A CLASS-START-ONLY ANCHOR. The class began at 20:00 and the tutor
    // remembered at 20:25; everyone present checks in at once and all of them are PRESENT.
    const opensAt = at("2026-10-04T14:55:00Z");
    assert.equal(
      selfMarkFor({ opensAt, classStartsAt: CLASS, graceMinutes: grace }, at("2026-10-04T14:56:00Z")),
      "PRESENT",
    );
    assert.equal(
      selfMarkFor({ opensAt, classStartsAt: CLASS, graceMinutes: grace }, at("2026-10-04T15:06:00Z")),
      "LATE",
    );
  });

  test("zero grace means on the dot or late", () => {
    const opensAt = at("2026-10-04T14:30:00Z");
    assert.equal(selfMarkFor({ opensAt, classStartsAt: CLASS, graceMinutes: 0 }, CLASS), "PRESENT");
    assert.equal(
      selfMarkFor({ opensAt, classStartsAt: CLASS, graceMinutes: 0 }, at("2026-10-04T14:30:01Z")),
      "LATE",
    );
  });
});

describe("studentMaySeeMark", () => {
  test("their own check-in is always visible to them", () => {
    assert.equal(
      studentMaySeeMark({ publishedAt: null, mySource: "SELF", publishRequired: true }),
      true,
    );
  });

  test("a tutor's mark waits for the publish switch", () => {
    assert.equal(
      studentMaySeeMark({ publishedAt: null, mySource: "TUTOR", publishRequired: true }),
      false,
    );
    assert.equal(
      studentMaySeeMark({ publishedAt: new Date(), mySource: "TUTOR", publishRequired: true }),
      true,
    );
  });

  test("with publishing switched off, marks are visible as they always were", () => {
    assert.equal(
      studentMaySeeMark({ publishedAt: null, mySource: "TUTOR", publishRequired: false }),
      true,
    );
  });

  test("no mark at all is still gated, so an unpublished blank does not read as absent", () => {
    assert.equal(studentMaySeeMark({ publishedAt: null, mySource: null, publishRequired: true }), false);
  });
});
