import { test, describe } from "node:test";
import assert from "node:assert/strict";

import { buildIcs, type IcsEvent } from "../ics";

/**
 * The calendar feed.
 *
 * The cases worth reading are the escaping (a session title with a comma in it is ordinary, and
 * an unescaped one corrupts every property after it) and the exclusive all-day DTEND, which is
 * the rule people get wrong and which renders as a missing event rather than an error.
 */

const ev = (over: Partial<IcsEvent> = {}): IcsEvent => ({
  uid: "abc123@b2consultants",
  start: new Date("2026-10-11T14:30:00.000Z"),
  end: new Date("2026-10-11T16:00:00.000Z"),
  summary: "Week 1: Resume teardown",
  ...over,
});

const lines = (ics: string) => ics.split("\r\n");

describe("the envelope", () => {
  test("every line ends CRLF, which Outlook genuinely requires", () => {
    const ics = buildIcs([ev()], "B2 Guided");
    assert.equal(ics.includes("\r\n"), true);
    // No bare LF anywhere: a single \n would be one broken line, and strict parsers stop there.
    assert.equal(/[^\r]\n/.test(ics), false);
    assert.equal(ics.endsWith("\r\n"), true);
  });

  test("opens and closes correctly, with the required core properties", () => {
    const out = lines(buildIcs([ev()], "B2 Guided"));
    assert.equal(out[0], "BEGIN:VCALENDAR");
    assert.equal(out.includes("VERSION:2.0"), true);
    assert.equal(out.includes("CALSCALE:GREGORIAN"), true);
    assert.equal(out.at(-2), "END:VCALENDAR");
  });

  test("an empty timetable is still a valid calendar", () => {
    // A cohort whose dates are not set yet. An empty file with no envelope is a parse error in
    // every client, which reads to the student as "the app is broken".
    const out = lines(buildIcs([], "B2 Guided"));
    assert.equal(out[0], "BEGIN:VCALENDAR");
    assert.equal(out.includes("BEGIN:VEVENT"), false);
  });

  test("the calendar is named, so an import does not read as Untitled", () => {
    assert.equal(lines(buildIcs([], "B2 Guided")).includes("X-WR-CALNAME:B2 Guided"), true);
  });
});

describe("a timed class", () => {
  test("start and end are UTC basic format", () => {
    const out = lines(buildIcs([ev()], "c"));
    assert.equal(out.includes("DTSTART:20261011T143000Z"), true);
    assert.equal(out.includes("DTEND:20261011T160000Z"), true);
  });

  test("no duration recorded gets the house 90 minutes, not an open end", () => {
    // Several clients draw an event with no DTEND as a whole day, which would bury the day's
    // other classes under it.
    const out = lines(buildIcs([ev({ end: undefined })], "c"));
    assert.equal(out.includes("DTEND:20261011T160000Z"), true);
  });

  test("the UID is passed through untouched - it is what makes a re-import an update", () => {
    const out = lines(buildIcs([ev()], "c"));
    assert.equal(out.includes("UID:abc123@b2consultants"), true);
  });
});

describe("a pre-recorded module", () => {
  test("becomes an all-day DATE entry rather than a midnight block", () => {
    // `startsAt` carries the RELEASE DAY for a recording - there is no clock. A 90-minute
    // event at 00:00 IST would be a lie about something that has no time at all.
    const out = lines(buildIcs([ev({ allDay: true, end: undefined })], "c"));
    assert.equal(out.includes("DTSTART;VALUE=DATE:20261011"), true);
  });

  test("DTEND is the NEXT day, because a DATE DTEND is exclusive", () => {
    // Same-day DTEND is the classic mistake: it is a zero-length event and some clients simply
    // do not draw it, so the module silently vanishes from the student's calendar.
    const out = lines(buildIcs([ev({ allDay: true })], "c"));
    assert.equal(out.includes("DTEND;VALUE=DATE:20261012"), true);
  });
});

describe("escaping", () => {
  test("commas and semicolons in a title are escaped", () => {
    // Unescaped, a comma starts a new property value and everything after it on the line is
    // reinterpreted - so one session title corrupts the event around it.
    const out = buildIcs([ev({ summary: "Week 1, part 2; H.I.D.E." })], "c");
    assert.equal(out.includes("SUMMARY:Week 1\\, part 2\\; H.I.D.E."), true);
  });

  test("newlines in a description become the literal \\n iCalendar expects", () => {
    const out = buildIcs([ev({ description: "Line one\nLine two" })], "c");
    assert.equal(out.includes("DESCRIPTION:Line one\\nLine two"), true);
    // And NOT an actual line break, which would be an unfolded continuation and a parse error.
    assert.equal(out.includes("DESCRIPTION:Line one\r\nLine two"), false);
  });

  test("a backslash is escaped first, so later escapes are not double-escaped", () => {
    const out = buildIcs([ev({ summary: "A\\B, C" })], "c");
    assert.equal(out.includes("SUMMARY:A\\\\B\\, C"), true);
  });
});

describe("line folding", () => {
  test("a long line is folded at 75 octets with a leading space", () => {
    const long = "T".repeat(200);
    const out = lines(buildIcs([ev({ summary: long })], "c"));
    const start = out.findIndex((l) => l.startsWith("SUMMARY:"));
    assert.ok(Buffer.from(out[start], "utf8").length <= 75, "the first line must fit in 75 octets");
    assert.equal(out[start + 1].startsWith(" "), true, "continuations begin with a space");
  });

  test("folding counts OCTETS and never splits a multi-byte character", () => {
    // A German Note title is full of these. Splitting one would emit two invalid bytes and the
    // client would render a replacement character in the middle of the class name.
    const out = buildIcs([ev({ summary: "ü".repeat(100) })], "c");
    for (const line of lines(out)) {
      assert.ok(Buffer.from(line, "utf8").length <= 75, `over-long line: ${line.length}`);
    }
    // Unfolding (strip CRLF + one leading space) must give the original back intact.
    const unfolded = out.replace(/\r\n /g, "");
    assert.equal(unfolded.includes(`SUMMARY:${"ü".repeat(100)}`), true);
    assert.equal(unfolded.includes("�"), false, "no replacement characters");
  });

  test("a line that exactly fits is not folded", () => {
    const summary = "x".repeat(75 - "SUMMARY:".length);
    const out = lines(buildIcs([ev({ summary })], "c"));
    const start = out.findIndex((l) => l.startsWith("SUMMARY:"));
    assert.equal(out[start + 1].startsWith(" "), false);
  });
});
