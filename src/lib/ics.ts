/**
 * iCalendar (RFC 5545) output - the timetable's cheaper cousin.
 *
 * The founders asked for a timetable DOCUMENT (@15:36, @16:33) and `documents/timetable-pdf.tsx`
 * is that. This answers the different question the same data can answer - "put my classes in my
 * phone" - and it is worth having beside the PDF because it is the half that stays correct: a
 * printed timetable is a snapshot, whereas a calendar entry can be re-imported after a class
 * moves and will update in place, because the UID stays the same.
 *
 * ── Why hand-written and not a library ────────────────────────────────────────────────
 * The whole format needed here is six properties and three escaping rules. A dependency for
 * that would be a supply-chain surface in exchange for about forty lines, on a file whose
 * correctness is entirely testable.
 *
 * Pure and dependency-free, like the rest of lib/.
 */

export type IcsEvent = {
  /**
   * STABLE across regenerations - this is what makes a re-import UPDATE an existing entry
   * rather than add a duplicate. Use the database id, never a timestamp or a random value.
   */
  uid: string;
  start: Date;
  /** Omitted for an all-day entry - see `allDay`. */
  end?: Date;
  /**
   * A pre-recorded module has no clock: `startsAt` carries the DAY it is released. An all-day
   * entry is the honest representation; a 90-minute block at midnight is not.
   */
  allDay?: boolean;
  summary: string;
  description?: string;
  location?: string;
};

/** UTC basic format: 20261011T143000Z. Everything is emitted in UTC, so no VTIMEZONE is needed. */
function utc(d: Date): string {
  return `${d.toISOString().slice(0, 19).replace(/[-:]/g, "")}Z`;
}

/** DATE value for an all-day entry: 20261011. */
function dateOnly(d: Date): string {
  return d.toISOString().slice(0, 10).replace(/-/g, "");
}

/**
 * RFC 5545 §3.3.11 text escaping: backslash, semicolon, comma and newline.
 *
 * The order matters - the backslash must be escaped FIRST, or every escape added afterwards
 * gets escaped again and a session title containing a comma arrives as "Week 1\\, part 2".
 */
function esc(s: string): string {
  return s
    .replace(/\\/g, "\\\\")
    .replace(/\n/g, "\\n")
    .replace(/;/g, "\\;")
    .replace(/,/g, "\\,");
}

/**
 * Fold to 75 OCTETS per line (§3.1), continuing with a leading space.
 *
 * Counted in bytes rather than characters on purpose: a line is limited to 75 octets, and a
 * student's name or a German session title carrying "ü" spends two of them on one character.
 * Folding by character length would emit an over-long line that strict parsers reject.
 */
function fold(line: string): string {
  const bytes = Buffer.from(line, "utf8");
  if (bytes.length <= 75) return line;

  const out: string[] = [];
  let cursor = 0;
  let limit = 75;
  while (cursor < bytes.length) {
    let take = Math.min(limit, bytes.length - cursor);
    // Never split a multi-byte character: back off until the slice decodes cleanly.
    while (take > 1 && Buffer.compare(
      Buffer.from(bytes.subarray(cursor, cursor + take).toString("utf8"), "utf8"),
      bytes.subarray(cursor, cursor + take),
    ) !== 0) {
      take -= 1;
    }
    out.push(bytes.subarray(cursor, cursor + take).toString("utf8"));
    cursor += take;
    limit = 74; // continuation lines spend one octet on the leading space
  }
  return out.join("\r\n ");
}

/**
 * One calendar, from a list of events.
 *
 * `name` becomes the calendar's display name in the clients that honour X-WR-CALNAME (Apple,
 * Google, Outlook), so an imported feed reads "B2 Guided - Oct 2026" rather than "Untitled".
 *
 * `METHOD:PUBLISH` and `X-WR-CALNAME` are non-standard-but-universal; the properties above them
 * are the required core. Lines are joined with CRLF because §3.1 says so and some parsers -
 * Outlook among them - genuinely reject LF.
 */
export function buildIcs(events: readonly IcsEvent[], name: string): string {
  const stamp = utc(new Date());
  const lines: string[] = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//B2 Consultants//Timetable//EN",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    fold(`X-WR-CALNAME:${esc(name)}`),
  ];

  for (const e of events) {
    lines.push("BEGIN:VEVENT");
    lines.push(`UID:${e.uid}`);
    lines.push(`DTSTAMP:${stamp}`);
    if (e.allDay) {
      /**
       * DTEND is EXCLUSIVE for a DATE value (§3.8.2.2), so a one-day entry ends the NEXT day.
       * Omitting it, or setting it to the same day, renders as a zero-length event that several
       * clients simply do not draw.
       */
      lines.push(`DTSTART;VALUE=DATE:${dateOnly(e.start)}`);
      lines.push(`DTEND;VALUE=DATE:${dateOnly(new Date(e.start.getTime() + 86_400_000))}`);
    } else {
      lines.push(`DTSTART:${utc(e.start)}`);
      // A class with no duration recorded gets the house 90 minutes rather than no end at all,
      // which some clients draw as a whole day.
      lines.push(`DTEND:${utc(e.end ?? new Date(e.start.getTime() + 90 * 60_000))}`);
    }
    lines.push(fold(`SUMMARY:${esc(e.summary)}`));
    if (e.description) lines.push(fold(`DESCRIPTION:${esc(e.description)}`));
    if (e.location) lines.push(fold(`LOCATION:${esc(e.location)}`));
    lines.push("END:VEVENT");
  }

  lines.push("END:VCALENDAR");
  return `${lines.join("\r\n")}\r\n`;
}
