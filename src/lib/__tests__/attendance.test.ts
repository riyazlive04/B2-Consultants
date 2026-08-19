import { test, describe } from "node:test";
import assert from "node:assert/strict";

import {
  summarise,
  signalFor,
  signalReason,
  noShowRate,
  attendedHeadcount,
  attendanceLabel,
  isAttended,
  isCounted,
  type AttendanceMark,
  type AttendanceStatus,
} from "../attendance";
import { DEFAULT_ATTENDANCE_CONFIG } from "../config-schema";

/** Sessions one week apart, oldest first, so streak tests read chronologically. */
function marks(...statuses: AttendanceStatus[]): AttendanceMark[] {
  return statuses.map((status, i) => ({
    sessionId: `s${i}`,
    startsAt: new Date(2026, 0, 1 + i * 7),
    status,
  }));
}

describe("what counts as attending", () => {
  test("LATE counts as attended", () => {
    // A student who joined 20 minutes into a 90-minute class was in the room. Treating that as
    // a no-show puts a punctuality problem into the drop-risk list, where it drowns out the
    // students who are actually disappearing.
    assert.equal(isAttended("LATE"), true);
    assert.equal(isAttended("PRESENT"), true);
    assert.equal(isAttended("ABSENT"), false);
    assert.equal(isAttended("EXCUSED"), false);
  });

  test("EXCUSED is excluded from the denominator entirely", () => {
    // An excused absence is the system working - the student told someone. Counting it against
    // them punishes exactly the behaviour we want.
    assert.equal(isCounted("EXCUSED"), false);
    assert.equal(isCounted("ABSENT"), true);
  });
});

describe("summarise", () => {
  test("counts each category and computes the rate over counted sessions", () => {
    const s = summarise(marks("PRESENT", "PRESENT", "LATE", "ABSENT"));
    assert.equal(s.marked, 4);
    assert.equal(s.counted, 4);
    assert.equal(s.attended, 3);
    assert.equal(s.late, 1);
    assert.equal(s.absent, 1);
    assert.equal(s.rate, 0.75);
  });

  test("an excused session raises the rate rather than lowering it", () => {
    const withAbsent = summarise(marks("PRESENT", "PRESENT", "ABSENT"));
    const withExcused = summarise(marks("PRESENT", "PRESENT", "EXCUSED"));
    assert.equal(withAbsent.rate, 2 / 3);
    assert.equal(withExcused.rate, 1, "excused is removed from the denominator, not counted as a miss");
    assert.equal(withExcused.counted, 2);
    assert.equal(withExcused.excused, 1);
  });

  test("no marks at all yields a null rate, not zero", () => {
    // 0% would mean "they attended nothing"; null means "nobody took the register". Those lead
    // to opposite actions.
    const s = summarise([]);
    assert.equal(s.rate, null);
    assert.equal(s.counted, 0);
  });

  test("marks are ordered by session start, not by array order", () => {
    const outOfOrder: AttendanceMark[] = [
      { sessionId: "late", startsAt: new Date(2026, 0, 20), status: "ABSENT" },
      { sessionId: "early", startsAt: new Date(2026, 0, 1), status: "PRESENT" },
    ];
    assert.equal(summarise(outOfOrder).consecutiveMissed, 1, "the ABSENT is the most recent");
  });
});

describe("consecutive misses", () => {
  test("counts back from the most recent session", () => {
    assert.equal(summarise(marks("PRESENT", "ABSENT", "ABSENT", "ABSENT")).consecutiveMissed, 3);
  });

  test("an attendance resets the streak", () => {
    assert.equal(summarise(marks("ABSENT", "ABSENT", "PRESENT")).consecutiveMissed, 0);
  });

  test("a late arrival resets the streak too", () => {
    assert.equal(summarise(marks("ABSENT", "ABSENT", "LATE")).consecutiveMissed, 0);
  });

  test("an excused session is skipped - it neither breaks nor extends the streak", () => {
    // "Away for a wedding, then missed two more" is a two-session streak. If EXCUSED reset it,
    // the student would look fine right up until they stopped coming entirely.
    assert.equal(summarise(marks("PRESENT", "EXCUSED", "ABSENT", "ABSENT")).consecutiveMissed, 2);
    assert.equal(summarise(marks("PRESENT", "ABSENT", "EXCUSED", "ABSENT")).consecutiveMissed, 2);
  });

  test("a trailing excused session doesn't hide the misses behind it", () => {
    assert.equal(summarise(marks("ABSENT", "ABSENT", "EXCUSED")).consecutiveMissed, 2);
  });
});

describe("the signal", () => {
  const cfg = DEFAULT_ATTENDANCE_CONFIG; // amber < 80%, red < 60%, red at 3 in a row, min 2

  test("too few sessions is UNKNOWN, not GREEN and not RED", () => {
    // One missed class out of one is 0%, which would paint every new student red on their first
    // absence. "We don't know yet" is both true and more useful.
    assert.equal(signalFor(summarise(marks("ABSENT")), cfg), "UNKNOWN");
    assert.equal(signalFor(summarise(marks("PRESENT")), cfg), "UNKNOWN");
    assert.equal(signalFor(summarise([]), cfg), "UNKNOWN");
  });

  test("green above the target", () => {
    assert.equal(signalFor(summarise(marks("PRESENT", "PRESENT", "PRESENT", "PRESENT")), cfg), "GREEN");
  });

  test("amber between the floor and the target", () => {
    // 3/4 = 75%: under the 80% target, over the 60% floor.
    assert.equal(signalFor(summarise(marks("PRESENT", "PRESENT", "PRESENT", "ABSENT")), cfg), "AMBER");
  });

  test("exactly on the target is green, not amber", () => {
    // 4/5 = 80%. The thresholds are "below X", so the boundary itself passes.
    assert.equal(
      signalFor(summarise(marks("PRESENT", "PRESENT", "PRESENT", "PRESENT", "ABSENT")), cfg),
      "GREEN",
    );
  });

  test("red below the floor", () => {
    // 1/4 = 25%.
    assert.equal(signalFor(summarise(marks("PRESENT", "ABSENT", "ABSENT", "ABSENT")), cfg), "RED");
  });

  test("a consecutive-miss streak turns a healthy average red on its own", () => {
    // 7 present then 3 absent = 70% - comfortably amber by rate alone. But this is the student
    // about to drop, and the average is exactly the statistic that cannot see it.
    const s = summarise(
      marks("PRESENT", "PRESENT", "PRESENT", "PRESENT", "PRESENT", "PRESENT", "PRESENT", "ABSENT", "ABSENT", "ABSENT"),
    );
    assert.equal(Math.round((s.rate ?? 0) * 100), 70);
    assert.equal(signalFor(s, cfg), "RED");
    assert.match(signalReason(s, cfg), /last 3 sessions in a row/);
  });

  test("the streak rule respects a configured threshold", () => {
    const s = summarise(marks("PRESENT", "PRESENT", "PRESENT", "PRESENT", "ABSENT", "ABSENT"));
    assert.equal(signalFor(s, { ...cfg, consecutiveMissedForRed: 2 }), "RED");
    assert.equal(signalFor(s, { ...cfg, consecutiveMissedForRed: 5 }), "AMBER");
  });

  test("every signal carries a reason", () => {
    assert.match(signalReason(summarise(marks("PRESENT")), cfg), /too few to judge/);
    assert.match(signalReason(summarise(marks("PRESENT", "PRESENT")), cfg), /100% attendance/);
    // 3/4 = 75% - amber territory, so the reason names the target rather than the floor.
    assert.match(
      signalReason(summarise(marks("PRESENT", "PRESENT", "PRESENT", "ABSENT")), cfg),
      /below the 80% target/,
    );
    // 2/5 = 40% - below the floor, so the reason names the floor instead.
    assert.match(
      signalReason(summarise(marks("PRESENT", "ABSENT", "ABSENT", "ABSENT", "PRESENT")), cfg),
      /below the 60% floor/,
    );
  });
});

describe("session-level numbers", () => {
  test("no-show rate is over counted marks", () => {
    assert.equal(noShowRate(["PRESENT", "PRESENT", "ABSENT", "ABSENT"]), 0.5);
    assert.equal(noShowRate(["PRESENT", "LATE"]), 0);
  });

  test("an excused student neither helps nor hurts the no-show rate", () => {
    assert.equal(noShowRate(["PRESENT", "ABSENT", "EXCUSED"]), 0.5);
  });

  test("an unmarked session has no no-show rate", () => {
    // Returning 0 would read as "everybody came" on a register nobody opened.
    assert.equal(noShowRate([]), null);
    assert.equal(noShowRate(["EXCUSED", "EXCUSED"]), null);
  });

  test("attended headcount is the number to hold beside the roster-priced fee", () => {
    // The fee is priced off the roster; this says how much of it was in the room. The gap is
    // the point - it is reported, never auto-corrected.
    assert.equal(attendedHeadcount(["PRESENT", "LATE", "ABSENT", "EXCUSED", "PRESENT"]), 3);
  });

  test("the one-line label says what it means", () => {
    assert.equal(attendanceLabel(summarise(marks("PRESENT", "PRESENT", "ABSENT"))), "2 of 3 (67%)");
    assert.equal(attendanceLabel(summarise([])), "Not marked");
  });
});
