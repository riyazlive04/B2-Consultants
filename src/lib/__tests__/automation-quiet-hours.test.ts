/**
 * Automation quiet hours — window boundary tests.
 *
 * The window maths is pure and takes `now` explicitly, so every boundary is checked exactly
 * (at the edge and one minute either side) with no fake timers and no DB — same approach as
 * outreach-engine.test.ts.
 *
 * The wrapping window (21:00 → 09:00) is the default shape and the easy one to get wrong, so
 * it gets the most cases.
 *
 * Run: npm test
 */

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { inQuietWindow, quietWindowEndsAt, describeQuietWindow } from "../automation-quiet-hours";

/** An instant at a given IST wall-clock time. IST is UTC+05:30, so 09:00 IST = 03:30 UTC. */
function ist(hour: number, minute = 0): Date {
  return new Date(Date.UTC(2026, 6, 15, hour, minute) - 5.5 * 3600_000);
}

describe("inQuietWindow — wrapping window (21:00 → 09:00)", () => {
  const START = 21;
  const END = 9;
  const quiet = (d: Date) => inQuietWindow(d, START, END);

  test("is quiet through the night", () => {
    assert.equal(quiet(ist(22)), true);
    assert.equal(quiet(ist(0)), true); // midnight — the wrap point itself
    assert.equal(quiet(ist(3, 30)), true);
    assert.equal(quiet(ist(8, 59)), true);
  });

  test("is not quiet during the day", () => {
    assert.equal(quiet(ist(9, 1)), false);
    assert.equal(quiet(ist(12)), false);
    assert.equal(quiet(ist(20, 59)), false);
  });

  test("start boundary is inclusive, end boundary is exclusive", () => {
    assert.equal(quiet(ist(20, 59)), false);
    assert.equal(quiet(ist(21, 0)), true); // quiet begins exactly at start
    assert.equal(quiet(ist(8, 59)), true);
    assert.equal(quiet(ist(9, 0)), false); // sending resumes exactly at end
  });
});

describe("inQuietWindow — non-wrapping window (09:00 → 17:00)", () => {
  const quiet = (d: Date) => inQuietWindow(d, 9, 17);

  test("is quiet only inside the window", () => {
    assert.equal(quiet(ist(8, 59)), false);
    assert.equal(quiet(ist(9, 0)), true);
    assert.equal(quiet(ist(12)), true);
    assert.equal(quiet(ist(16, 59)), true);
    assert.equal(quiet(ist(17, 0)), false);
    assert.equal(quiet(ist(23)), false);
    assert.equal(quiet(ist(2)), false);
  });
});

describe("inQuietWindow — zero-width window", () => {
  test("holds nothing rather than everything", () => {
    // The dangerous misreading: start === end could mean "always quiet", which would freeze
    // every send forever. It must mean "never quiet".
    for (const h of [0, 9, 12, 21, 23]) {
      assert.equal(inQuietWindow(ist(h), 12, 12), false, `hour ${h}`);
    }
  });
});

describe("quietWindowEndsAt", () => {
  test("same-day end returns today's end", () => {
    // 22:00 IST, window ends 23:00 IST → 1 hour away.
    assert.equal(quietWindowEndsAt(ist(22), 23).getTime(), ist(23).getTime());
  });

  test("wrapping window resumes at end time the next morning", () => {
    // 22:00 IST with end 09:00 → 11 hours away, i.e. 09:00 the following day.
    const from = ist(22);
    const resume = quietWindowEndsAt(from, 9);
    assert.equal(resume.getTime() - from.getTime(), 11 * 3600_000);
  });

  test("after midnight resumes the same morning, not a day later", () => {
    // 03:00 IST with end 09:00 → 6 hours, NOT 30. This is the wrap bug to guard against:
    // an enrollment parked at 3am must send at 9am today.
    const from = ist(3);
    assert.equal(quietWindowEndsAt(from, 9).getTime() - from.getTime(), 6 * 3600_000);
  });

  test("exactly at the end hour parks a full day, never zero", () => {
    // delta === 0 must roll forward, or a caller could park with nextRunAt === now and spin.
    const from = ist(9);
    assert.equal(quietWindowEndsAt(from, 9).getTime() - from.getTime(), 24 * 3600_000);
  });

  test("always returns a strictly future instant", () => {
    for (const h of [0, 3, 9, 12, 21, 23]) {
      const from = ist(h);
      assert.ok(quietWindowEndsAt(from, 9).getTime() > from.getTime(), `hour ${h}`);
    }
  });
});

describe("describeQuietWindow", () => {
  test("flags the overnight case", () => {
    const s = describeQuietWindow(21, 9);
    assert.match(s, /21:00/);
    assert.match(s, /09:00/);
    assert.match(s, /overnight/);
  });

  test("omits 'overnight' for a same-day window", () => {
    assert.doesNotMatch(describeQuietWindow(9, 17), /overnight/);
  });

  test("says nothing is held when the window is zero-width — matching inQuietWindow", () => {
    assert.match(describeQuietWindow(12, 12), /nothing is held/);
    assert.equal(inQuietWindow(ist(12), 12, 12), false);
  });
});
