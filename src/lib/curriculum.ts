/**
 * Curriculum - pure rules for turning a programme timetable into a cohort's dated classes.
 *
 * NO prisma, NO server-only: the admin curriculum editor, the batch timetable preview and the
 * generate action all import from here, and the preview has to produce exactly the dates the
 * write will. Reads live in `src/server/curriculum.ts`, writes in `curriculum-actions.ts` and
 * `batch-timetable-actions.ts`.
 *
 * ── THE DATING RULE, AND WHY IT IS NOT "WEEK N = START + 7N" ────────────────────────────
 * The founders' sheet looks like a calendar grid, so the obvious reading is that Week 03's
 * sessions all fall in the third calendar week. They do not. Batch 14 reads:
 *
 *     W1 Kick Off            Sat 05/09      W3 Hidden Job Market   Sun 20/09
 *     W2 Resume Building     Sat 12/09      W3 Open Job Market     Sun 27/09   <- week 4
 *     W2 Social Profile      Sun 13/09      W4 Final Q&A           Sun 04/10   <- week 5
 *     W3 Special Q&A         Sat 19/09
 *
 * Week 03 holds three sessions but only two weekend days, so the third spills into the next
 * weekend and everything after it shifts. Dating each week off the start date would have put
 * Open Job Market on 20/09 - on top of Hidden Job Market - and the final Q&A a week early.
 *
 * So the rule is SEQUENTIAL, not absolute: each session lands on the next occurrence of its
 * weekday STRICTLY AFTER the previous session. Run against Batch 14's template that reproduces
 * the founders' own dates exactly, spill included, which is the test that settled it.
 *
 * `weekNumber` is therefore a LABEL - the curriculum's own grouping, which is what the student's
 * timetable shows - and never an input to the arithmetic.
 */

export const DAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"] as const;
export const DAY_SHORT = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"] as const;

export type SessionDeliveryValue = "LIVE" | "PRE_RECORDED";

export const DELIVERY_LABELS: Record<SessionDeliveryValue, string> = {
  LIVE: "Live",
  PRE_RECORDED: "Pre-recorded video",
};

/** One row of the curriculum sheet, as the planner needs it. */
export type CurriculumRow = {
  id: string;
  weekNumber: number;
  orderIndex: number;
  title: string;
  framework: string | null;
  type: string;
  delivery: SessionDeliveryValue;
  durationMins: number | null;
  /** 0 = Sunday … 6 = Saturday, matching JS `getDay()`. Null = no fixed day. */
  dayOfWeek: number | null;
  /** "HH:MM" wall-clock IST. Null = not decided yet. */
  startTime: string | null;
  notes: string | null;
};

/** A row of the sheet with a batch's column filled in. */
export type PlannedSession = {
  curriculumItemId: string;
  weekNumber: number;
  orderIndex: number;
  title: string;
  framework: string | null;
  type: string;
  delivery: SessionDeliveryValue;
  durationMins: number | null;
  notes: string | null;
  /** The IST calendar day this lands on, YYYY-MM-DD. */
  dateYmd: string;
  /** "HH:MM" IST, or null when the template has no time or the session is pre-recorded. */
  timeHm: string | null;
  /** The instant stored on ClassSession.startsAt. IST midnight when `timeHm` is null. */
  startsAt: Date;
};

export type TimetablePlan = {
  sessions: PlannedSession[];
  /**
   * The day the sprint begins: the date of the LAST live session, because agreement Annexure A
   * has it commencing "immediately after the Final Special Q&A" rather than at a fixed offset
   * from the start. Null when the curriculum has no sprint phase or plans no live session.
   */
  sprintStartYmd: string | null;
  /** `sprintStartYmd` + the template's sprint length - the sheet's own "90 Day Sprint" date. */
  sprintEndYmd: string | null;
  /** Rows the planner could date but could not time - surfaced rather than silently 00:00. */
  missingTimes: number;
};

const MS_PER_DAY = 86_400_000;
const YMD = /^\d{4}-\d{2}-\d{2}$/;

/** YYYY-MM-DD to UTC-midnight Date. The whole module works in UTC-midnight day keys so that
 *  no server timezone can shift which DAY a class falls on. */
function ymdToUtc(ymd: string): Date {
  return new Date(`${ymd}T00:00:00Z`);
}

export function toYmd(d: Date): string {
  return d.toISOString().slice(0, 10);
}

export function addDaysYmd(ymd: string, days: number): string {
  return toYmd(new Date(ymdToUtc(ymd).getTime() + days * MS_PER_DAY));
}

/** 0 = Sunday … 6 = Saturday, for a YYYY-MM-DD day key. */
export function dayOfWeekOf(ymd: string): number {
  return ymdToUtc(ymd).getUTCDay();
}

/** The first `dow` on or after `ymd`. */
export function onOrAfter(ymd: string, dow: number): string {
  const delta = (dow - dayOfWeekOf(ymd) + 7) % 7;
  return delta === 0 ? ymd : addDaysYmd(ymd, delta);
}

/** The first `dow` strictly after `ymd` - never the same day, which is what makes a week
 *  holding two Sundays spill into the next one instead of double-booking. */
export function strictlyAfter(ymd: string, dow: number): string {
  const delta = (dow - dayOfWeekOf(ymd) + 7) % 7;
  return addDaysYmd(ymd, delta === 0 ? 7 : delta);
}

/** IST is a fixed +05:30 offset (no DST), so the ISO offset form is exact. Mirrors
 *  `istWallToUtc` in dates.ts, kept local so this module stays dependency-free. */
function istInstant(ymd: string, hm: string): Date {
  return new Date(`${ymd}T${hm}:00+05:30`);
}

/** "1.5 hrs" as the sheet writes it, from stored minutes. */
export function formatDuration(mins: number | null | undefined): string | null {
  if (!mins || mins <= 0) return null;
  if (mins % 60 === 0) return `${mins / 60} hr${mins === 60 ? "" : "s"}`;
  return `${(mins / 60).toFixed(mins % 6 === 0 ? 1 : 2)} hrs`;
}

/** The sheet's Day cell: a weekday for a live class, "Video (pre-rec)" for a module. */
export function dayCellLabel(row: { delivery: SessionDeliveryValue; dayOfWeek: number | null }): string {
  if (row.delivery === "PRE_RECORDED") return "Video (pre-rec)";
  return row.dayOfWeek === null ? "-" : DAY_NAMES[row.dayOfWeek];
}

/** Sheet order: by week, then by position within the week. */
export function sortRows<T extends { weekNumber: number; orderIndex: number }>(rows: readonly T[]): T[] {
  return [...rows].sort((a, b) => a.weekNumber - b.weekNumber || a.orderIndex - b.orderIndex);
}

/**
 * Fill in a batch's column: every curriculum row, dated from `startYmd`.
 *
 * `startYmd` is the batch's own start date and anchors the FIRST live session - which takes the
 * first occurrence of its weekday on or after it, so a start date that already falls on the
 * right day is honoured rather than pushed a week out.
 *
 * A PRE_RECORDED module has no clock and no weekday. It is released on the day of the session
 * BEFORE it (the batch start, if it comes first) and does NOT move the cursor, so dropping a
 * video into the middle of a curriculum never shifts the live classes around it. That is also
 * why `startsAt` can stay non-null: the module has a real release date, just no time.
 */
export function planTimetable(
  rows: readonly CurriculumRow[],
  startYmd: string,
  opts: { sprintDays?: number | null } = {},
): TimetablePlan {
  if (!YMD.test(startYmd)) throw new Error(`planTimetable: startYmd must be YYYY-MM-DD, got ${startYmd}`);
  const ordered = sortRows(rows);

  let cursor = startYmd;
  let first = true;
  let missingTimes = 0;
  const sessions: PlannedSession[] = [];

  for (const row of ordered) {
    let dateYmd: string;
    if (row.delivery === "PRE_RECORDED") {
      dateYmd = cursor; // released alongside the preceding session; cursor unchanged
    } else if (row.dayOfWeek === null) {
      // The sheet left the Day blank. Sit it with the previous session rather than inventing
      // a weekday - a wrong date a human can see beats a guess they cannot.
      dateYmd = cursor;
      first = false;
    } else {
      dateYmd = first ? onOrAfter(cursor, row.dayOfWeek) : strictlyAfter(cursor, row.dayOfWeek);
      cursor = dateYmd;
      first = false;
    }

    const timeHm = row.delivery === "PRE_RECORDED" ? null : row.startTime || null;
    if (row.delivery === "LIVE" && !timeHm) missingTimes += 1;

    sessions.push({
      curriculumItemId: row.id,
      weekNumber: row.weekNumber,
      orderIndex: row.orderIndex,
      title: row.title,
      framework: row.framework,
      type: row.type,
      delivery: row.delivery,
      durationMins: row.durationMins,
      notes: row.notes,
      dateYmd,
      timeHm,
      startsAt: istInstant(dateYmd, timeHm ?? "00:00"),
    });
  }

  const lastLive = [...sessions].reverse().find((s) => s.delivery === "LIVE") ?? null;
  const sprintDays = opts.sprintDays ?? null;
  const sprintStartYmd = sprintDays && lastLive ? lastLive.dateYmd : null;

  return {
    sessions,
    sprintStartYmd,
    sprintEndYmd: sprintStartYmd && sprintDays ? addDaysYmd(sprintStartYmd, sprintDays) : null,
    missingTimes,
  };
}

/**
 * The Guided curriculum exactly as Annexure A of the signed agreement describes it, carrying the
 * two topics the founders have since renamed (Hidden / Open Job Market and their frameworks).
 *
 * Here so a founder opening an empty Curriculum tab can start from the programme they actually
 * sell rather than a blank sheet. It is a SEED, not a binding: the template it creates is an
 * ordinary editable row set from the moment it is written.
 */
export const GUIDED_CURRICULUM_SEED: ReadonlyArray<Omit<CurriculumRow, "id">> = [
  {
    weekNumber: 1, orderIndex: 0, title: "Kick Off", framework: null,
    type: "KICKOFF", delivery: "LIVE", durationMins: 90, dayOfWeek: 6, startTime: "10:30",
    notes: "Programme orientation, German job market overview, mindset and sprint readiness.",
  },
  {
    weekNumber: 2, orderIndex: 0, title: "Resume Building", framework: null,
    type: "COACHING", delivery: "LIVE", durationMins: 180, dayOfWeek: 6, startTime: "10:30",
    notes: "Guided group build of a German-format resume.",
  },
  {
    weekNumber: 2, orderIndex: 1, title: "Social Profile Building", framework: null,
    type: "LINKEDIN", delivery: "LIVE", durationMins: 180, dayOfWeek: 0, startTime: "19:00",
    notes: "LinkedIn and Xing, optimised for the German market.",
  },
  {
    weekNumber: 3, orderIndex: 0, title: "Special Q&A", framework: null,
    type: "QA", delivery: "LIVE", durationMins: 60, dayOfWeek: 6, startTime: "20:00", notes: null,
  },
  {
    weekNumber: 3, orderIndex: 1, title: "Hidden Job Market", framework: "H.I.D.E. Framework",
    type: "OPEN_MARKET", delivery: "LIVE", durationMins: 120, dayOfWeek: 0, startTime: "10:30", notes: null,
  },
  {
    weekNumber: 3, orderIndex: 2, title: "Open Job Market", framework: "O.P.E.N. Framework",
    type: "OPEN_MARKET", delivery: "LIVE", durationMins: 180, dayOfWeek: 0, startTime: "10:30",
    notes: "The core search, approach and apply session.",
  },
  {
    weekNumber: 4, orderIndex: 0, title: "German Interview Structure", framework: null,
    type: "COACHING", delivery: "PRE_RECORDED", durationMins: 120, dayOfWeek: null, startTime: null,
    notes: "Video module: interview structure, cultural expectations, dos and donts.",
  },
  {
    weekNumber: 4, orderIndex: 1, title: "Special Q&A & Sprint Start", framework: null,
    type: "QA", delivery: "LIVE", durationMins: 90, dayOfWeek: 0, startTime: "20:00",
    notes: "The 90-Day Sprint begins after this session.",
  },
];
