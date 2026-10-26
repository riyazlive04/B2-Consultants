/**
 * Batch - pure rules for the unified cohort model (ER v2 Track A).
 *
 * NO prisma, NO server-only: the German Note panel, the Students batches tab and the seat
 * dialog all import from here. DB reads live in `src/server/batches.ts`, writes in
 * `src/server/batch-actions.ts`.
 *
 * Background: `Batch` was `GnBatch`. Decision D1 was "unify" - German Note already ran two
 * batch worlds (real rows for the LMS, free-text labels on workshop conversions), and a
 * separate B2 coaching batch would have made three. `line` is what keeps the one table honest.
 */

import type { BatchLine, LevelKind } from "@prisma/client";

export const BATCH_LINE_LABELS: Record<BatchLine, string> = {
  B2: "B2 Coaching",
  GERMAN_NOTE: "German Note",
};

/**
 * Which business line a level belongs to.
 *
 * Returns null for OTHER, which is genuinely ambiguous - the founders use it for one-off
 * products that belong to neither line. A null here means "don't enforce", not "reject":
 * refusing to seat an OTHER-level student anywhere would be a worse failure than allowing it.
 */
export function lineForLevelKind(kind: LevelKind): BatchLine | null {
  switch (kind) {
    case "COACHING_TIER":
      return "B2";
    case "GERMAN_LEVEL":
    case "GERMAN_BUNDLE":
      return "GERMAN_NOTE";
    case "OTHER":
      return null;
  }
}

/**
 * May a student on `levelKind` be seated in a batch on `line`?
 *
 * The rule the one-table design has to carry: without it, "unify the batch tables" would
 * silently mean "a coaching client can be seated in an A1 German cohort".
 */
export function levelFitsBatchLine(levelKind: LevelKind, line: BatchLine): boolean {
  const expected = lineForLevelKind(levelKind);
  return expected === null || expected === line;
}

/* ────────────────────────────────────────────────────────────────────────────────────────
   WHAT A SEAT IS
   ────────────────────────────────────────────────────────────────────────────────────────

   A cohort has `targetStrength` seats, and TWO different rows can occupy one:

     · `Enrollment.batchId`  - a B2 coaching client, seated from the student's record
     · `BatchMember`         - a German Note learner, added from the German Note screens

   Nothing in the schema says which applies; `Batch.line` decides, by convention. That fork is
   the deepest structural finding of the flow audit (docs/refactor/02-current-state.md, P1), and
   the thing it actually broke is this: the two capacity checks over one `targetStrength`
   DISAGREED about what a seat is.

     server/batch-actions.ts   seatEnrollment  →  members + seated enrolments   ← both
     server/german-note-actions.ts  claimSeat  →  members                       ← one

   So a German Note cohort holding seated enrolments counted itself emptier than the B2 writer
   thought it was, over the same column. `seatCount` is now the ONE definition both sides read.
   Unifying the two TABLES is a later, separate migration; unifying the ANSWER costs nothing and
   removes the disagreement today.                                                            */

/** Which row occupies a seat on this business line. Presentation and copy read this. */
export type SeatMechanism = "ENROLLMENT" | "MEMBER";

/**
 * The mechanism a line seats people through.
 *
 * Deliberately total over `BatchLine` rather than defaulting, so adding a third line is a
 * compile error here instead of a silently mis-seated cohort.
 */
export function seatMechanism(line: BatchLine): SeatMechanism {
  switch (line) {
    case "B2":
      return "ENROLLMENT";
    case "GERMAN_NOTE":
      return "MEMBER";
  }
}

/**
 * Someone who could take a seat in this cohort.
 *
 * Lives in this pure module rather than beside the query that builds it, because the seat picker
 * is a CLIENT component and the query lives in a `server-only` file. A type-only import across
 * that boundary is erased and happens to work - but it is one missing `type` keyword from a build
 * failure, and it points the dependency the wrong way. The shape is isomorphic; this is where
 * isomorphic things go.
 */
export type SeatCandidate = {
  /**
   * What to pass back to `addSeats`. An ENROLMENT id on the B2 line, a STUDENT id on German
   * Note - because that is what each underlying action takes. Callers treat it as opaque.
   */
  id: string;
  studentId: string;
  name: string;
  code: string | null;
  /** The programme they bought, when the candidate is an enrolment. Null on German Note. */
  programLevel: string | null;
  mechanism: SeatMechanism;
};

/** The two counts a batch can produce. Callers pass what they queried; neither is optional. */
export type SeatCounts = {
  /** `BatchMember` rows. */
  members: number;
  /** `Enrollment` rows whose status still occupies a seat - see `occupiesSeat`. */
  seatedEnrollments: number;
};

/**
 * How many of a cohort's seats are taken - counting BOTH mechanisms, whatever its line.
 *
 * Counting both even on a line that "should" only use one is the point. A cohort that holds
 * rows of both kinds is a data state that already exists and can be reached from the UI; a
 * count that ignored half of it would under-report a full class and let the founders oversell
 * it without the over-capacity prompt they rely on.
 */
export function seatCount(counts: SeatCounts): number {
  return counts.members + counts.seatedEnrollments;
}

export type CapacityBand = "empty" | "filling" | "full" | "over";

/**
 * How full a batch is, as a band rather than a boolean.
 *
 * `over` is deliberately NOT an error state. The founders overfill batches on purpose when a
 * ninth person turns up and the next cohort is a month away - a hard block would send them
 * back to a spreadsheet. The seat action warns and asks for confirmation; it does not refuse.
 */
export function capacityBand(filled: number, target: number): CapacityBand {
  if (filled <= 0) return "empty";
  if (target <= 0) return "filling"; // no target set → nothing to be full against
  if (filled > target) return "over";
  if (filled >= target) return "full";
  return "filling";
}

export function capacityLabel(filled: number, target: number): string {
  const band = capacityBand(filled, target);
  if (target <= 0) return `${filled} seated`;
  return band === "over"
    ? `${filled} / ${target} - over capacity`
    : `${filled} / ${target}`;
}

/**
 * Normalise the founders' batch label ("b26", " B 26 ") to the stored shape ("B26").
 *
 * `Batch.code` is UNIQUE, and these labels arrive typed by hand into workshop workbooks. Two
 * spellings of the same cohort would produce two batches and split its roster - which is the
 * exact failure the free-text `batchA1`/`batchA2`/`batchB1` columns already caused.
 * Returns "" when nothing usable is left, so callers can reject rather than store junk.
 */
export function normalizeBatchCode(raw: string): string {
  return raw
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, "")
    .slice(0, 24);
}

/**
 * The day-N of a batch a given date falls on, 1-based, or null when the batch has no start.
 *
 * Used by the milestone radar (Track I) to ask "is this cohort past day 45 yet".
 * Both dates are floored to UTC midnight first: the caller passes real timestamps, and a
 * class at 09:00 versus 21:00 must not shift which day of the programme it counts as.
 */
export function batchDayNumber(startDate: Date | null, on: Date): number | null {
  if (!startDate) return null;
  const MS_PER_DAY = 86_400_000;
  const floor = (d: Date) => Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
  const days = Math.floor((floor(on) - floor(startDate)) / MS_PER_DAY);
  return days < 0 ? null : days + 1;
}

/**
 * ── WHICH COHORT IS RUNNING, WHICH IS NEXT ───────────────────────────────────────────
 *
 * Added for the agreement form, where "Batch" used to be a free-text box: the founder typed
 * "Batch 12" into a contract while the app already knew the real cohorts by name. A chooser
 * needs to say which of them is running today and which one starts next, and that question is
 * pure arithmetic on two nullable dates - so it lives here with the rest of the batch rules.
 *
 * UNDATED is its own case and not folded into RUNNING. Every batch on the live database has a
 * null `startDate` (the German Note cohorts predate the ER-v2 column), so a classifier that
 * guessed "running" for them would describe twenty batches as in-progress without evidence.
 * They are still offered - they are the real cohorts - just not described as something they
 * may not be.
 */
export type BatchTiming = "UPCOMING" | "RUNNING" | "UNDATED" | "FINISHED";

export const BATCH_TIMING_LABELS: Record<BatchTiming, string> = {
  UPCOMING: "Starts soon",
  RUNNING: "Running now",
  UNDATED: "No start date",
  FINISHED: "Finished",
};

/** Floor to the calendar day: `startDate`/`endDate` are `@db.Date`, so time of day is noise. */
const dayOf = (d: Date) => Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());

/**
 * Where a batch sits relative to `on` (pass the caller's "today" rather than reading the clock,
 * which is what makes this testable).
 *
 * A batch with no `endDate` that has started is RUNNING and stays RUNNING - open-ended is how
 * the founders actually run a cohort, and inventing a length to expire it by would be a guess.
 */
export function batchTiming(
  b: { startDate: Date | null; endDate: Date | null },
  on: Date,
): BatchTiming {
  if (!b.startDate) return "UNDATED";
  const today = dayOf(on);
  if (dayOf(b.startDate) > today) return "UPCOMING";
  if (b.endDate && dayOf(b.endDate) < today) return "FINISHED";
  return "RUNNING";
}

/** One batch as a chooser needs it - the only fields the offer rules below read. */
export type BatchChoice = {
  id: string;
  /** The founders' label for this cohort - what a contract would name. */
  label: string;
  level: string;
  timing: BatchTiming;
  /** `yyyy-mm-dd`, already serialized: these cross to a client component and feed a date input. */
  startDate: string | null;
  filled: number;
  targetStrength: number;
};

const TIMING_RANK: Record<BatchTiming, number> = {
  UPCOMING: 0,
  RUNNING: 1,
  UNDATED: 2,
  FINISHED: 3,
};

/**
 * The order a chooser offers batches in: what starts next, then what is running, then the
 * undated ones, then anything already over.
 *
 * "Next" first rather than "running" first on purpose - someone signing today joins the cohort
 * that has not started yet far more often than one already half-way through.
 */
export function compareBatchChoices(a: BatchChoice, b: BatchChoice): number {
  const rank = TIMING_RANK[a.timing] - TIMING_RANK[b.timing];
  if (rank !== 0) return rank;
  if (a.timing === "UPCOMING") {
    // Soonest first: the next intake is the useful one.
    return (a.startDate ?? "").localeCompare(b.startDate ?? "");
  }
  if (a.timing === "RUNNING" || a.timing === "FINISHED") {
    // Most recent first - the one that started last is the one still taking joiners.
    return (b.startDate ?? "").localeCompare(a.startDate ?? "");
  }
  // Undated: newest label first. The codes count up ("B07" … "B28"), so a descending string
  // compare puts the current cohort at the top, which is the only signal these rows carry.
  return b.label.localeCompare(a.label);
}

/**
 * Which batch to OPEN the form on - a suggestion, never a decision.
 *
 * Priority, in the order a human would reason:
 *   1. the batch this person is already seated in. A fact, so it wins even if that cohort is
 *      full or finished: the contract must name where they actually are.
 *   2. the first batch in offer order that still has room AND matches their programme level.
 *   3. the first batch in offer order that still has room, whatever its level.
 *
 * Full and over-capacity batches are skipped from 2 and 3 - `capacityBand` exists because the
 * founders overfill on purpose, but a DEFAULT should never do that on their behalf. A finished
 * cohort is skipped for the same reason. Returns null when nothing qualifies, and the form then
 * simply asks.
 */
// Generic in the row type, so a caller that passes richer rows gets its own type back rather
// than the bare `BatchChoice` this file reasons about.
export function defaultBatchChoice<T extends BatchChoice>(
  choices: T[],
  opts: { seatedId?: string | null; preferLevel?: string | null } = {},
): T | null {
  if (opts.seatedId) {
    const seated = choices.find((c) => c.id === opts.seatedId);
    if (seated) return seated;
  }
  const open = choices
    .filter((c) => c.timing !== "FINISHED")
    .filter((c) => {
      const band = capacityBand(c.filled, c.targetStrength);
      return band !== "full" && band !== "over";
    })
    .sort(compareBatchChoices);
  if (opts.preferLevel) {
    const onLevel = open.find((c) => c.level === opts.preferLevel);
    if (onLevel) return onLevel;
  }
  return open[0] ?? null;
}

/* ────────────────────────────────────────────────────────────────────────────────────────
   IS THIS COHORT READY TO RUN?
   ────────────────────────────────────────────────────────────────────────────────────────

   `Batch.status` holds two values - ACTIVE and ARCHIVED - and `tutorId`, `curriculumTemplateId`,
   `startDate` and `endDate` are every one of them nullable. So a cohort with no teacher, no
   syllabus, no dates and nobody in it is ACTIVE from the moment it is saved, and is
   indistinguishable on every screen from one that is actually teaching. Nothing could say "this
   one is not ready", so nothing ever did - and the people who found out were the students,
   whose Classroom was empty.

   DERIVED, NOT STORED, and that is the important decision. The app already proves the pattern:
   `agreement-state.ts` derives an eight-state lifecycle spanning two phases of one timeline as a
   pure function, "always current because it is recomputed every render". The same reasoning
   applies with more force here:

     · Every existing row classifies correctly on day one. No backfill, no migration, no risk of
       a column that says READY while the syllabus it names has been deleted.
     · The gate and the display cannot drift, because they are the same function.
     · Rolling it back is deleting a call site.

   So DRAFT, READY and COMPLETED are computed; ACTIVE and ARCHIVED remain the stored column.    */

export type BatchReadiness = "DRAFT" | "READY" | "ACTIVE" | "COMPLETED" | "ARCHIVED";

export const BATCH_READINESS_LABELS: Record<BatchReadiness, string> = {
  DRAFT: "Draft",
  READY: "Ready to start",
  ACTIVE: "Running",
  COMPLETED: "Completed",
  ARCHIVED: "Archived",
};

/**
 * What a cohort still needs before it can teach anybody.
 *
 * `key` matches the tab or control that fixes it, so the checklist on the cohort hub can link
 * each unmet item straight at its remedy instead of describing it.
 */
export type BatchPrerequisite = "curriculum" | "teacher" | "dates" | "timetable" | "learners";

export const BATCH_PREREQUISITE_LABELS: Record<BatchPrerequisite, string> = {
  curriculum: "A plan to teach from",
  teacher: "Someone to teach it",
  dates: "A start date",
  timetable: "Classes on the calendar",
  learners: "At least one learner",
};

/** The facts readiness is computed from - all of them already columns or counts on the row. */
export type BatchReadinessInput = {
  status: "ACTIVE" | "ARCHIVED" | string;
  line: BatchLine;
  curriculumTemplateId: string | null;
  tutorId: string | null;
  startDate: Date | null;
  endDate: Date | null;
  seats: SeatCounts;
  /** `ClassSession` rows on this batch. */
  sessionCount: number;
  /** Sessions whose `startsAt` is still in the future, relative to the caller's `on`. */
  upcomingSessionCount: number;
};

/**
 * Which prerequisites are NOT met, in the order a founder would work through them.
 *
 * German Note is exempt from `curriculum` and `timetable` on purpose: its cohorts are scheduled
 * one class at a time from the German Note classroom and have no week structure to template, so
 * demanding a curriculum of them would mark every real GN cohort as a draft. The honest reading
 * of "ready" differs by line, and pretending otherwise would make the whole state useless on
 * half the data.
 */
export function batchBlockers(b: BatchReadinessInput): BatchPrerequisite[] {
  const needsPlan = b.line === "B2";
  const blockers: BatchPrerequisite[] = [];
  if (needsPlan && !b.curriculumTemplateId) blockers.push("curriculum");
  if (!b.tutorId) blockers.push("teacher");
  if (!b.startDate) blockers.push("dates");
  if (needsPlan && b.sessionCount === 0) blockers.push("timetable");
  if (seatCount(b.seats) === 0) blockers.push("learners");
  return blockers;
}

/**
 * The three prerequisites that gate ACTIVATION, as opposed to the five the checklist shows.
 *
 * The founders' rule is "a plan, a teacher and at least one learner". Dates and a built
 * timetable are on the checklist because a cohort without them cannot be sequenced or reported
 * on - but they are not a reason to refuse to start, because a cohort can legitimately begin
 * before its later weeks are timed. A gate that demanded all five would be a gate the founders
 * routed around.
 */
export function activationBlockers(b: BatchReadinessInput): BatchPrerequisite[] {
  const gated = new Set<BatchPrerequisite>(["curriculum", "teacher", "learners"]);
  return batchBlockers(b).filter((x) => gated.has(x));
}

/**
 * Where this cohort actually is.
 *
 * ARCHIVED wins over everything - it is the one state that is stored, and an archived cohort is
 * not a draft however incomplete it is. After that:
 *
 *   DRAFT      something it needs to teach is missing
 *   COMPLETED  it has classes, and every one of them is in the past
 *   ACTIVE     it has started
 *   READY      it is complete but has not started yet
 *
 * COMPLETED is reversible by adding or re-timing a class, which is correct: a cohort the
 * founders extend by one make-up session has not finished, and a stored column would have had
 * to be hand-corrected to say so.
 *
 * `on` is passed rather than read from the clock - the same choice `batchTiming` makes, and what
 * makes this testable.
 */
export function batchReadiness(b: BatchReadinessInput, on: Date): BatchReadiness {
  if (b.status === "ARCHIVED") return "ARCHIVED";
  if (activationBlockers(b).length > 0) return "DRAFT";

  const timing = batchTiming({ startDate: b.startDate, endDate: b.endDate }, on);
  // Every class taught and none left to come. Requires sessions to exist at all: a cohort with
  // an empty calendar has not completed anything.
  if (b.sessionCount > 0 && b.upcomingSessionCount === 0) return "COMPLETED";
  if (timing === "FINISHED") return "COMPLETED";
  if (timing === "RUNNING") return "ACTIVE";
  // UPCOMING or UNDATED, with nothing blocking: everything is in place, it just has not begun.
  return "READY";
}

/** May the founder press Activate, and if not, why not. */
export function canActivateBatch(b: BatchReadinessInput): { ok: boolean; blockers: BatchPrerequisite[] } {
  const blockers = activationBlockers(b);
  return { ok: blockers.length === 0, blockers };
}

/** "Needs a plan to teach from and at least one learner" - the disabled button's reason. */
export function describeBlockers(blockers: BatchPrerequisite[]): string {
  const parts = blockers.map((b) => BATCH_PREREQUISITE_LABELS[b].toLowerCase());
  if (parts.length === 0) return "";
  if (parts.length === 1) return `Needs ${parts[0]}`;
  return `Needs ${parts.slice(0, -1).join(", ")} and ${parts[parts.length - 1]}`;
}

/* ────────────────────────────────────────────────────────────────────────────────────────
   ONE ROSTER FROM TWO TABLES (P1)
   ──────────────────────────────────────────────────────────────────────────────────────── */

/**
 * `Batch` has two membership mechanisms and nothing in the schema says which applies: B2 seats
 * through `Enrollment.batchId`, German Note through the `BatchMember` join table, and
 * `Batch.line` decides by convention. The cost is that every feature asking "who is in this
 * cohort" has to be written twice - and when it is, the two copies drift. Two capacity checks
 * disagreed about exactly this for months.
 *
 * The merge below is the shared answer, and it lives HERE rather than in `server/` because it is
 * pure: no prisma, no I/O, just two row shapes folded into one. That is what lets the cohort hub
 * share the rule without paying a second query for it, and what lets it be tested at all.
 *
 * The fork itself is not closed - the two tables remain, with different delete semantics.
 * Collapsing them is a migration; `docs/refactor/migrations/` holds the proposal.
 */

export type BatchSeat = {
  studentId: string;
  /** The enrolment that holds this seat, or null for a `BatchMember` (German Note). */
  enrollmentId: string | null;
  name: string;
  code: string | null;
  /** Null for German Note - a course is sat, not bought as a tier. */
  programLevel: string | null;
  /** The enrolment lifecycle status, or null for a `BatchMember`. */
  status: string | null;
  coachName: string | null;
  /** Which table this seat came from. Callers that must branch should branch on THIS. */
  via: SeatMechanism;
};

/** What `BATCH_MEMBERSHIP_SELECT` returns, as the merge below needs it. */
export type BatchMembershipRows = {
  members: { student: { id: string; fullName: string; code: string | null } }[];
  enrollments: {
    id: string;
    programLevel: string | null;
    status: string;
    student: { id: string; fullName: string; code: string | null };
    coach: { name: string } | null;
    assignedCoach: string | null;
  }[];
};

/**
 * Merge both mechanisms into one roster, one row per person.
 *
 * Pure, so it can be called from any read that has already fetched the rows - which is how
 * `batch-detail.ts` uses it without a second query. Members first, then enrolments: within each
 * the database ordering is kept (joined date, enrolment date), and the two never interleave in
 * practice because a cohort only ever uses one mechanism.
 *
 * ── DEDUPED, and the enrolment wins ────────────────────────────────────────────────────
 * Nothing in the schema forbids being in both: `BatchMember` has `@@unique([batchId, studentId])`
 * and `Enrollment.batchId` has no such constraint against it, so one person CAN hold a seat
 * through each. The register has always deduped for exactly this reason ("deduped because nothing
 * forbids being in both", server/attendance.ts) and the cohort roster did not - so the same
 * cohort would have listed that person twice on one screen and once on the other.
 *
 * The enrolment row wins because it is strictly richer: it carries the programme level, the
 * lifecycle status and the coach, and the member row carries none of them. Keeping the member row
 * would mean silently dropping three facts we hold.
 *
 * `optOut` lets a caller drop enrolments it should not list - the register passes
 * `belongsOnRegister`, which keeps a departed student on sheets they were already marked on while
 * taking them off future ones. Members are never filtered: a `BatchMember` row has no status to
 * judge, so its existence IS the membership.
 */
export function mergeBatchSeats(
  b: BatchMembershipRows,
  opts?: { optOut?: (enrollment: { status: string; studentId: string }) => boolean },
): BatchSeat[] {
  const byStudent = new Map<string, BatchSeat>();

  for (const m of b.members) {
    byStudent.set(m.student.id, {
      studentId: m.student.id,
      enrollmentId: null,
      name: m.student.fullName,
      code: m.student.code,
      programLevel: null,
      status: null,
      coachName: null,
      via: "MEMBER",
    });
  }

  for (const e of b.enrollments) {
    if (opts?.optOut?.({ status: e.status, studentId: e.student.id })) continue;
    // Overwrites a member row for the same person - see the note above on why that direction.
    byStudent.set(e.student.id, {
      studentId: e.student.id,
      enrollmentId: e.id,
      name: e.student.fullName,
      code: e.student.code,
      programLevel: e.programLevel,
      status: e.status,
      coachName: e.coach?.name ?? e.assignedCoach ?? null,
      via: "ENROLLMENT",
    });
  }

  return [...byStudent.values()];
}

/**
 * The distinct people on a cohort's roster, from the two mechanisms' id lists.
 *
 * ── Why a named function for one `Set` ──────────────────────────────────────────────────
 * Because forgetting it has a cost, and it was hand-rolled in five places. Nothing in the schema
 * stops one person holding a seat through both mechanisms - `BatchMember` is unique on
 * `[batchId, studentId]`, and `Enrollment.batchId` has no constraint against it - so the naive
 * concatenation yields that person twice. Each caller that noticed wrote its own comment about
 * it:
 *
 *   · `session-tasks.ts`   "two completion rows for one person would double every count"
 *   · `class-reminders.ts` "that must not mean two reminders"
 *   · `attendance.ts`      "deduped because nothing forbids being in both"
 *
 * …and `batch-detail.ts` did not notice, which is why its roster listed that person twice while
 * the register listed them once. One function, so the next caller inherits the knowledge instead
 * of having to rediscover it.
 *
 * Use `mergeBatchSeats` when you need the people themselves; this is for the ids alone, so a
 * caller that only needs to know WHO does not have to over-fetch what they are.
 */
export function rosterStudentIds(
  memberStudentIds: readonly string[],
  enrollmentStudentIds: readonly string[],
): string[] {
  return [...new Set([...memberStudentIds, ...enrollmentStudentIds])];
}
