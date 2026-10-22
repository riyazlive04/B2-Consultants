import "server-only";
import { cache } from "react";
import type { BatchLine } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { capacityBand, capacityLabel, levelFitsBatchLine } from "@/lib/batch";
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
        _count: { select: { members: true, enrollments: true } },
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
      _count: { select: { members: true, enrollments: true } },
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
    })),
    levelOptions: levels
      .filter((l) => l.active && levelFitsBatchLine(l.kind, line))
      .map((l) => ({ value: l.code, label: l.label })),
    leadOptions: leads.map((u) => ({ value: u.id, label: `${u.name} · ${u.role.toLowerCase()}` })),
  };
}
