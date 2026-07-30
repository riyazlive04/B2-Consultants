import "server-only";
import { cache } from "react";
import { prisma } from "@/lib/prisma";
import {
  payableAmountInrMinor,
  TUTOR_FEE_STATUS_LABELS,
  tutorFeeLevelFromCode,
} from "@/lib/tutor-fee-record";
import type { TutorFeeStatus } from "@prisma/client";

/**
 * Tutor fee reads (ER v2 Track C). Writes live in `tutor-fee-actions.ts`.
 *
 * Everything downstream reads `payableInrMinor`, never `amountInrMinor` — an override that
 * shows on screen but is ignored by the money is the kind of bug only an accountant finds.
 */

export type TutorFeeRow = {
  id: string;
  batchId: string;
  batchName: string;
  batchCode: string | null;
  level: string;
  trainerId: string | null;
  trainerName: string | null;
  headcount: number;
  ratePerHeadInrMinor: number;
  amountInrMinor: number;
  overrideAmountInrMinor: number | null;
  overrideReason: string | null;
  /** What is actually owed — override when set, computed otherwise. */
  payableInrMinor: number;
  status: TutorFeeStatus;
  statusLabel: string;
  computedAt: Date;
  approvedAt: Date | null;
  paidAt: Date | null;
  postedEntryId: string | null;
  /** True when the batch roster has moved since this DRAFT was computed. */
  stale: boolean;
  currentHeadcount: number;
};

export const listTutorFees = cache(async (status?: TutorFeeStatus): Promise<TutorFeeRow[]> => {
  const rows = await prisma.tutorFee.findMany({
    where: status ? { status } : undefined,
    select: {
      id: true, batchId: true, level: true, trainerId: true, headcount: true,
      ratePerHeadInrMinor: true, amountInrMinor: true, overrideAmountInrMinor: true,
      overrideReason: true, status: true, computedAt: true, approvedAt: true, paidAt: true,
      postedEntryId: true,
      trainer: { select: { name: true } },
      batch: {
        select: { name: true, code: true, _count: { select: { members: true, enrollments: true } } },
      },
    },
    orderBy: [{ status: "asc" }, { computedAt: "desc" }],
  });

  return rows.map((f) => {
    const currentHeadcount = f.batch._count.members + f.batch._count.enrollments;
    return {
      id: f.id,
      batchId: f.batchId,
      batchName: f.batch.name,
      batchCode: f.batch.code,
      level: f.level,
      trainerId: f.trainerId,
      trainerName: f.trainer?.name ?? null,
      headcount: f.headcount,
      ratePerHeadInrMinor: Number(f.ratePerHeadInrMinor),
      amountInrMinor: Number(f.amountInrMinor),
      overrideAmountInrMinor: f.overrideAmountInrMinor === null ? null : Number(f.overrideAmountInrMinor),
      overrideReason: f.overrideReason,
      payableInrMinor: Number(payableAmountInrMinor(f)),
      status: f.status,
      statusLabel: TUTOR_FEE_STATUS_LABELS[f.status],
      computedAt: f.computedAt,
      approvedAt: f.approvedAt,
      paidAt: f.paidAt,
      postedEntryId: f.postedEntryId,
      // Only a DRAFT can be stale in any actionable sense — an APPROVED fee is frozen BY
      // DESIGN, so flagging it as out of date would read as an error rather than the intent.
      stale: f.status === "DRAFT" && currentHeadcount !== f.headcount,
      currentHeadcount,
    };
  });
});

/**
 * Batch P&L — a LEDGER SLICE, not a stored FINANCE_RECORD.
 *
 * The diagram wants `BATCH ||--o| FINANCE_RECORD`. Storing that row would be a second source
 * of truth that drifts from the ledger the first time an income is edited. Instead:
 *
 *   revenue = Income linked to enrollments seated in this batch
 *   cogs    = tutor fees for the batch + book orders for its seated students
 *
 * Both sides read the SAME tables Finance reads, so the batch view and the P&L cannot
 * disagree about what a cohort earned.
 */
export const batchPnl = cache(async (batchId: string) => {
  const [enrollments, fees] = await Promise.all([
    prisma.enrollment.findMany({
      where: { batchId },
      select: { id: true, studentId: true },
    }),
    prisma.tutorFee.findMany({
      where: { batchId, status: { in: ["APPROVED", "PAID"] } },
      select: { amountInrMinor: true, overrideAmountInrMinor: true },
    }),
  ]);

  const enrollmentIds = enrollments.map((e) => e.id);
  const studentIds = [...new Set(enrollments.map((e) => e.studentId))];

  const [income, books] = await Promise.all([
    enrollmentIds.length
      ? prisma.income.aggregate({
          where: { enrollmentId: { in: enrollmentIds }, deletedAt: null },
          _sum: { amountInrMinor: true },
        })
      : Promise.resolve({ _sum: { amountInrMinor: null } }),
    studentIds.length
      ? prisma.bookOrder.aggregate({
          where: { studentId: { in: studentIds }, status: { in: ["PAID", "COURIERED"] } },
          _sum: { paidAmountInrMinor: true },
        })
      : Promise.resolve({ _sum: { paidAmountInrMinor: null } }),
  ]);

  const revenue = Number(income._sum.amountInrMinor ?? 0n);
  const tutorCost = fees.reduce((sum, f) => sum + Number(payableAmountInrMinor(f)), 0);
  const bookCost = Number(books._sum.paidAmountInrMinor ?? 0n);
  const cogs = tutorCost + bookCost;

  return {
    seats: enrollments.length,
    revenueInrMinor: revenue,
    tutorCostInrMinor: tutorCost,
    bookCostInrMinor: bookCost,
    cogsInrMinor: cogs,
    grossInrMinor: revenue - cogs,
    // Null rather than 0 when there is no revenue: a 0% margin and "nothing has been billed
    // yet" are different claims, and only one of them is a problem.
    grossMarginPct: revenue > 0 ? Math.round(((revenue - cogs) / revenue) * 1000) / 10 : null,
  };
});

/** Batches that would produce a tutor fee — i.e. German levels with a fee band. */
export const feeEligibleBatches = cache(async () => {
  const rows = await prisma.batch.findMany({
    where: { status: "ACTIVE" },
    select: {
      id: true, name: true, code: true, level: true, tutorId: true,
      tutor: { select: { name: true } },
      _count: { select: { members: true, enrollments: true } },
    },
  });
  return rows
    .filter((b) => tutorFeeLevelFromCode(b.level) !== null)
    .map((b) => ({
      id: b.id,
      name: b.name,
      code: b.code,
      level: b.level,
      tutorId: b.tutorId,
      tutorName: b.tutor?.name ?? null,
      headcount: b._count.members + b._count.enrollments,
    }));
});
