/**
 * Class reminders - the rules behind "whose class is about to start, and have we said so yet".
 *
 * Pure and DB-free.
 *
 * The two things worth pinning: a rung never fires twice (a duplicate WhatsApp to a whole batch
 * is the failure this ladder exists to prevent), and the time in the message is IST regardless
 * of the machine that rendered it - the VPS runs UTC and the founders work from Germany, so a
 * `toLocaleString` here would have put a different time in the message than on the timetable.
 *
 * Run: npm test
 */

import assert from "node:assert/strict";
import { test, describe } from "node:test";
import {
  alertCountdown,
  classReminderRung,
  formatClassTime,
  isClassAlertOpen,
  leadLabel,
  maxLeadMs,
} from "../class-reminder";

const LIVE = { delivery: "LIVE" as const };
const at = (iso: string) => new Date(iso);

// Saturday 4 Oct 2026, 20:00 IST = 14:30 UTC - the final Q&A of Batch 14.
const CLASS = at("2026-10-04T14:30:00Z");
const LADDER = [24 * 60, 60];

describe("classReminderRung", () => {
  test("fires nothing while the class is further out than the widest rung", () => {
    assert.equal(classReminderRung({ ...LIVE, startsAt: CLASS }, LADDER, at("2026-10-03T10:00:00Z"), []), null);
  });

  test("fires the 24-hour rung once the window opens", () => {
    assert.equal(classReminderRung({ ...LIVE, startsAt: CLASS }, LADDER, at("2026-10-03T15:00:00Z"), []), 1440);
  });

  test("does not fire the same rung twice", () => {
    const sent = [at("2026-10-03T15:00:00Z")];
    assert.equal(classReminderRung({ ...LIVE, startsAt: CLASS }, LADDER, at("2026-10-03T16:00:00Z"), sent), null);
  });

  test("fires the 1-hour rung after the 24-hour one has gone", () => {
    const sent = [at("2026-10-03T15:00:00Z")];
    assert.equal(classReminderRung({ ...LIVE, startsAt: CLASS }, LADDER, at("2026-10-04T13:45:00Z"), sent), 60);
  });

  test("stops once every rung has been used", () => {
    const sent = [at("2026-10-03T15:00:00Z"), at("2026-10-04T13:45:00Z")];
    assert.equal(classReminderRung({ ...LIVE, startsAt: CLASS }, LADDER, at("2026-10-04T14:20:00Z"), sent), null);
  });

  test("never fires after the class has started", () => {
    assert.equal(classReminderRung({ ...LIVE, startsAt: CLASS }, LADDER, at("2026-10-04T14:31:00Z"), []), null);
  });

  test("never fires for a pre-recorded module - it has no start time to count down to", () => {
    const video = { delivery: "PRE_RECORDED" as const, startsAt: CLASS };
    assert.equal(classReminderRung(video, LADDER, at("2026-10-03T15:00:00Z"), []), null);
  });

  test("an empty ladder disables the touchpoint", () => {
    assert.equal(classReminderRung({ ...LIVE, startsAt: CLASS }, [], at("2026-10-04T13:45:00Z"), []), null);
  });

  test("a catch-up run picks the NEAREST open rung, not the oldest", () => {
    // The cron did not run for a day: both windows are open at once. The 1-hour rung is the
    // honest one to send - a message saying "tomorrow" an hour before the class is a lie.
    assert.equal(classReminderRung({ ...LIVE, startsAt: CLASS }, LADDER, at("2026-10-04T13:45:00Z"), []), 60);
  });
});

describe("maxLeadMs", () => {
  test("is the widest rung, in milliseconds - the window a query looks ahead over", () => {
    assert.equal(maxLeadMs(LADDER), 24 * 60 * 60_000);
  });
  test("ignores junk and zero rungs", () => {
    assert.equal(maxLeadMs([0, -5, 60, Number.NaN]), 60 * 60_000);
  });
  test("an empty ladder looks ahead over nothing", () => {
    assert.equal(maxLeadMs([]), 0);
  });
});

describe("leadLabel", () => {
  test("reads as a person would say it", () => {
    assert.equal(leadLabel(1440), "tomorrow");
    assert.equal(leadLabel(2880), "in 2 days");
    assert.equal(leadLabel(60), "in 1 hour");
    assert.equal(leadLabel(120), "in 2 hours");
    assert.equal(leadLabel(20), "in 20 minutes");
  });
});

describe("formatClassTime", () => {
  test("renders IST whatever the machine's clock is set to", () => {
    assert.equal(formatClassTime(CLASS), "Sun 4 Oct, 08:00 PM IST");
  });

  test("a morning class reads as AM", () => {
    // 10:30 IST on Sat 5 Sep 2026 = 05:00 UTC - Batch 14's Kick Off.
    assert.equal(formatClassTime(at("2026-09-05T05:00:00Z")), "Sat 5 Sep, 10:30 AM IST");
  });

  test("midday and midnight do not render as 00", () => {
    assert.equal(formatClassTime(at("2026-09-05T06:30:00Z")), "Sat 5 Sep, 12:00 PM IST");
    assert.equal(formatClassTime(at("2026-09-04T18:30:00Z")), "Sat 5 Sep, 12:00 AM IST");
  });

  test("a late-evening IST class belongs to the NEXT UTC day, and says the IST one", () => {
    // 23:00 IST on 4 Oct is 17:30 UTC on 4 Oct - same day. 01:00 IST on 5 Oct is 19:30 UTC
    // on the 4th, and must read as the 5th.
    assert.equal(formatClassTime(at("2026-10-04T19:30:00Z")), "Mon 5 Oct, 01:00 AM IST");
  });
});

describe("isClassAlertOpen", () => {
  const session = { ...LIVE, startsAt: CLASS, durationMins: 90 };

  test("opens when the class comes inside the window", () => {
    assert.equal(isClassAlertOpen(session, at("2026-10-04T10:00:00Z"), 120), false);
    assert.equal(isClassAlertOpen(session, at("2026-10-04T13:00:00Z"), 120), true);
  });

  test("stays open THROUGH the class - that is when the link is wanted", () => {
    assert.equal(isClassAlertOpen(session, at("2026-10-04T15:00:00Z"), 120), true);
  });

  test("closes once the class has run its duration", () => {
    assert.equal(isClassAlertOpen(session, at("2026-10-04T16:01:00Z"), 120), false);
  });

  test("a class with no duration is assumed to run 90 minutes", () => {
    const noDuration = { ...LIVE, startsAt: CLASS, durationMins: null };
    assert.equal(isClassAlertOpen(noDuration, at("2026-10-04T15:59:00Z"), 120), true);
    assert.equal(isClassAlertOpen(noDuration, at("2026-10-04T16:01:00Z"), 120), false);
  });

  test("a pre-recorded module never raises an alert", () => {
    const video = { delivery: "PRE_RECORDED" as const, startsAt: CLASS, durationMins: 120 };
    assert.equal(isClassAlertOpen(video, at("2026-10-04T14:00:00Z"), 120), false);
  });
});

describe("alertCountdown", () => {
  test("counts down, then reports progress", () => {
    assert.equal(alertCountdown(CLASS, at("2026-10-04T14:05:00Z")), "starts in 25 minutes");
    assert.equal(alertCountdown(CLASS, at("2026-10-04T13:30:00Z")), "starts in 1 hour");
    assert.equal(alertCountdown(CLASS, at("2026-10-04T14:30:00Z")), "starting now");
    assert.equal(alertCountdown(CLASS, at("2026-10-04T14:40:00Z")), "started 10 minutes ago");
    assert.equal(alertCountdown(CLASS, at("2026-10-04T16:00:00Z")), "in progress");
  });

  test("a day out reads as tomorrow, not as 24 hours", () => {
    assert.equal(alertCountdown(CLASS, at("2026-10-03T14:30:00Z")), "starts tomorrow");
  });
});
