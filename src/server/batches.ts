import "server-only";
import { cache } from "react";
import type { BatchLine } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { SEATED_STATUSES } from "@/lib/enrollment-lifecycle";
import {
  BATCH_LINE_LABELS,
  type BatchChoice,
  batchTiming,
  capacityBand,
  capacityLabel,
  compareBatchChoices,
  levelFitsBatchLine,
} from "@/lib/batch";
import { toDateInputValue } from "@/lib/dates";
import { getLevels } from "./levels";

/**
 * Batch reads - the unified cohort model (ER v2 Track A).
 *
 * Writes live in `batch-actions.ts`. German Note's existing panels keep calling
 * `german-note-metrics.ts`; this module is the line-agnostic view the Students board needs,
 * and the one the batch P&L reads.
 */

export type BatchRow = {
  id: string;
  line: BatchLine;
  code: string | null;
  name: string;
  level: string;
  status: "ACTIVE" | "ARCHIVED";
  tutorId: string | null;
  tutorName: string | null;
  startDate: Date | null;
  endDate: Date | null;
  targetStrength: number;
  notes: string | null;
  /** German Note roster (BatchMember) + B2 seats (Enrollment) - the two ways in. */
  filled: number;
  /** Classes on its timetable. 0 means the cohort has dates for nothing yet. */
  sessionCount: number;
  capacity: ReturnType<typeof capacityBand>;
  capacityLabel: string;
};

/**
 * List batches, optionally by line/status.
 *
 * `filled` counts BOTH membership routes and adds them. That is correct rather than lazy: a
 * batch is only ever one line, and a line only ever uses one route (German Note seats through
 * BatchMember, B2 through Enrollment), so exactly one of the two counts is non-zero in
 * practice. Summing means a mixed batch - which the level/line guard is supposed to prevent -
 * still reports its true headcount rather than silently under-counting half the room.
 */
export const listBatches = cache(
  async (opts: { line?: BatchLine; status?: "ACTIVE" | "ARCHIVED" } = {}): Promise<BatchRow[]> => {
    const rows = await prisma.batch.findMany({
      where: {
        ...(opts.line ? { line: opts.line } : {}),
        ...(opts.status ? { status: opts.status } : {}),
      },
      select: {
        id: true,
        line: true,
        code: true,
        name: true,
        level: true,
        status: true,
        tutorId: true,
        startDate: true,
        endDate: true,
        targetStrength: true,
        notes: true,
        tutor: { select: { name: true } },
        /**
         * SEATED enrolments only - see `occupiesSeat` in lib/enrollment-lifecycle.ts.
         *
         * This was an unfiltered relation count, so a cohort of ten that lost two students
         * still read ten of ten - full - and the capacity band refused the replacements the
         * founders had already sold. A graduate and a leaver both free their seat; a PAUSED
         * student does not, because theirs is being held for them.
         */
        _count: {
          select: {
            members: true,
            enrollments: { where: { status: { in: [...SEATED_STATUSES] } } },
            events: true,
          },
        },
      },
      orderBy: [{ status: "asc" }, { startDate: "desc" }, { name: "asc" }],
    });

    return rows.map((b) => {
      const filled = b._count.members + b._count.enrollments;
      return {
        id: b.id,
        line: b.line,
        code: b.code,
        name: b.name,
        level: b.level,
        status: b.status,
        tutorId: b.tutorId,
        tutorName: b.tutor?.name ?? null,
        startDate: b.startDate,
        endDate: b.endDate,
        targetStrength: b.targetStrength,
        notes: b.notes,
        filled,
        sessionCount: b._count.events,
        capacity: capacityBand(filled, b.targetStrength),
        capacityLabel: capacityLabel(filled, b.targetStrength),
      };
    });
  },
);

/** The seat picker's options: active batches on one line, cheapest possible projection. */
export const seatableBatches = cache(async (line: BatchLine) => {
  const rows = await prisma.batch.findMany({
    where: { line, status: "ACTIVE" },
    select: {
      id: true,
      name: true,
      code: true,
      level: true,
      targetStrength: true,
      // Same seat rule as the list above, so the picker and the board cannot disagree.
      _count: { select: { members: true, enrollments: { where: { status: { in: [...SEATED_STATUSES] } } } } },
    },
    orderBy: [{ name: "asc" }],
  });
  return rows.map((b) => ({
    id: b.id,
    name: b.name,
    code: b.code,
    level: b.level,
    filled: b._count.members + b._count.enrollments,
    targetStrength: b.targetStrength,
  }));
});

/** Everyone seated in a batch, from both routes, as one roster. */
export const batchRoster = cache(async (batchId: string) => {
  const [members, enrollments] = await Promise.all([
    prisma.batchMember.findMany({
      where: { batchId },
      select: { id: true, addedAt: true, student: { select: { id: true, fullName: true, code: true, email: true } } },
      orderBy: { addedAt: "asc" },
    }),
    prisma.enrollment.findMany({
      where: { batchId },
      select: {
        id: true,
        programLevel: true,
        status: true,
        enrollmentDate: true,
        student: { select: { id: true, fullName: true, code: true, email: true } },
      },
      orderBy: { enrollmentDate: "asc" },
    }),
  ]);

  return {
    members: members.map((m) => ({
      kind: "member" as const,
      rowId: m.id,
      studentId: m.student.id,
      name: m.student.fullName,
      code: m.student.code,
      email: m.student.email,
      since: m.addedAt,
    })),
    enrollments: enrollments.map((e) => ({
      kind: "enrollment" as const,
      rowId: e.id,
      studentId: e.student.id,
      name: e.student.fullName,
      code: e.student.code,
      email: e.student.email,
      level: e.programLevel,
      status: e.status,
      since: e.enrollmentDate,
    })),
  };
});

/**
 * ── THE BATCH BOARD: everything one line's cohort screen needs, serializable ──────────
 *
 * The write path (`upsertBatch`) has been line-aware since the ER-v2 unification, but nothing
 * ever called it: German Note kept its own panel, and the B2 side had no cohort screen at all,
 * so there was no way to create a coaching batch in the app. This is the read behind that screen.
 *
 * Dates come out as `YYYY-MM-DD` strings and `BigInt` never appears, because every field here
 * crosses to a client component and feeds a date input directly.
 */
export type BatchBoardRow = {
  id: string;
  code: string | null;
  name: string;
  level: string;
  /** The catalogue's own words for the level, falling back to the stored code. */
  levelLabel: string;
  status: "ACTIVE" | "ARCHIVED";
  leadId: string | null;
  leadName: string | null;
  startDate: string | null;
  endDate: string | null;
  targetStrength: number;
  filled: number;
  capacity: ReturnType<typeof capacityBand>;
  capacityLabel: string;
  /** Carried so the edit form re-submits what is stored instead of blanking it. */
  notes: string | null;
  /**
   * ── IS THIS COHORT ACTUALLY SCHEDULED? ────────────────────────────────────────────
   * Classes on its timetable, and when the next one is. The board's whole job on the Batches
   * & Plans screen is to answer "which cohorts still need their dates and times set", and a
   * list of names with nothing but a capacity pill cannot answer it.
   *
   * `nextSessionAt` is `yyyy-mm-dd`, and null means either no timetable or nothing left in the
   * future - the two read differently beside `sessionCount`.
   */
  sessionCount: number;
  nextSessionAt: string | null;
};

export async function getBatchBoard(line: BatchLine): Promise<{
  rows: BatchBoardRow[];
  /** Active levels this line's batches may seat - the guard `levelFitsBatchLine` enforces. */
  levelOptions: { value: string; label: string }[];
  /** Who can lead a cohort: active team accounts, never a student login. */
  leadOptions: { value: string; label: string }[];
}> {
  const [batches, levels, leads] = await Promise.all([
    listBatches({ line }),
    getLevels(),
    prisma.user.findMany({
      where: { status: "ACTIVE", role: { not: "STUDENT" } },
      orderBy: { name: "asc" },
      select: { id: true, name: true, email: true, role: true },
    }),
  ]);
  const labelOf = (code: string) => levels.find((l) => l.code === code)?.label ?? code;

  // ONE query for every cohort's next class, rather than one per row. `groupBy` with `_min`
  // is the cheapest shape for "the soonest future session per batch".
  const nextByBatch = new Map<string, Date>();
  if (batches.length > 0) {
    const upcoming = await prisma.classSession.groupBy({
      by: ["batchId"],
      where: { batchId: { in: batches.map((b) => b.id) }, startsAt: { gte: new Date() } },
      _min: { startsAt: true },
    });
    for (const row of upcoming) {
      if (row._min.startsAt) nextByBatch.set(row.batchId, row._min.startsAt);
    }
  }

  return {
    rows: batches.map((b) => ({
      id: b.id,
      code: b.code,
      name: b.name,
      level: b.level,
      levelLabel: labelOf(b.level),
      status: b.status,
      leadId: b.tutorId,
      leadName: b.tutorName,
      startDate: b.startDate ? toDateInputValue(b.startDate) : null,
      endDate: b.endDate ? toDateInputValue(b.endDate) : null,
      targetStrength: b.targetStrength,
      filled: b.filled,
      capacity: b.capacity,
      capacityLabel: b.capacityLabel,
      notes: b.notes,
      sessionCount: b.sessionCount,
      nextSessionAt: (() => {
        const d = nextByBatch.get(b.id);
        return d ? toDateInputValue(d) : null;
      })(),
    })),
    levelOptions: levels
      .filter((l) => l.active && levelFitsBatchLine(l.kind, line))
      .map((l) => ({ value: l.code, label: l.label })),
    leadOptions: leads.map((u) => ({ value: u.id, label: `${u.name} · ${u.role.toLowerCase()}` })),
  };
}

/**
 * ── THE COHORTS AN AGREEMENT CAN NAME ────────────────────────────────────────────────
 *
 * `AgreementData.batch.number` is free text, and it stays free text: it is a term of a frozen
 * contract, and existing signed agreements say "Batch 12" where no `Batch` row ever existed.
 * What was wrong is that the form ASKED as if the app knew nothing - so this is the list it
 * should have been offering, with the cohort that is running and the one that starts next
 * named as such.
 *
 * Both lines are returned, labelled. An agreement is raised against a person, not a line, and
 * German Note sells one too; filtering to B2 here would have hidden every cohort that exists
 * on the live database.
 */
export type AgreementBatchOption = BatchChoice & {
  code: string | null;
  name: string;
  line: BatchLine;
  lineLabel: string;
  levelLabel: string;
  endDate: string | null;
  capacity: ReturnType<typeof capacityBand>;
  capacityLabel: string;
};

/**
 * What a contract should call this cohort.
 *
 * `code` is the founders' human key ("B26") and the thing they say on calls, so it wins. The
 * cap is `agreementDataSchema`'s own 40 characters - a name long enough to be rejected by the
 * schema must never be offered as a choice the form cannot then submit.
 */
const BATCH_LABEL_MAX = 40;
function batchLabel(b: { code: string | null; name: string }): string {
  return (b.code?.trim() || b.name.trim()).slice(0, BATCH_LABEL_MAX);
}

/** Active batches on both lines, classified and in offer order. `cache`d per request. */
export const agreementBatchOptions = cache(async (): Promise<AgreementBatchOption[]> => {
  const [batches, levels] = await Promise.all([listBatches({ status: "ACTIVE" }), getLevels()]);
  const now = new Date();
  const labelOf = (code: string) => levels.find((l) => l.code === code)?.label ?? code;

  return batches
    .map((b) => ({
      id: b.id,
      label: batchLabel(b),
      code: b.code,
      name: b.name,
      line: b.line,
      lineLabel: BATCH_LINE_LABELS[b.line],
      level: b.level,
      levelLabel: labelOf(b.level),
      timing: batchTiming({ startDate: b.startDate, endDate: b.endDate }, now),
      startDate: b.startDate ? toDateInputValue(b.startDate) : null,
      endDate: b.endDate ? toDateInputValue(b.endDate) : null,
      filled: b.filled,
      targetStrength: b.targetStrength,
      capacity: b.capacity,
      capacityLabel: b.capacityLabel,
    }))
    .sort(compareBatchChoices);
});
