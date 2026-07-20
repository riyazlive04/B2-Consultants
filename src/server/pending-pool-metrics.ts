import "server-only";
import { cache } from "react";
import { prisma } from "@/lib/prisma";
import { suggestBatchesToOpen, DEFAULT_MIN_TO_OPEN, type PoolJoiner } from "@/lib/pending-pool";
import { getTutorFeeConfig } from "./founder-config";
import { tutorRatePerHeadRupees, tutorFeeForBatchInrMinor } from "@/lib/tutor-fee";
import type { TutorFeeLevel } from "@/lib/config-schema";

/**
 * Reads for the pending pool and the per-batch cost line.
 *
 * Kept out of german-note-metrics.ts because that file is already the batch/community
 * reader — this is the waiting room and the money, which are different questions.
 */

export type PoolRow = {
  id: string;
  studentId: string;
  fullName: string;
  email: string | null;
  level: string;
  preference: "WEEKDAY" | "WEEKEND" | "EITHER";
  preferredTime: string | null;
  workshopName: string | null;
  notes: string | null;
  /** Whole days this person has been waiting — the number that makes a stale pool visible. */
  waitingDays: number;
  createdAt: string;
};

export type PoolSuggestionRow = {
  level: string;
  slot: "WEEKDAY" | "WEEKEND";
  count: number;
  openable: boolean;
  reason: string;
  joinerIds: string[];
};

export type BatchWithRoom = {
  id: string;
  name: string;
  level: string;
  filled: number;
  targetStrength: number;
};

const DAY_MS = 86_400_000;

export const getPendingPoolData = cache(async (minToOpen: number = DEFAULT_MIN_TO_OPEN) => {
  const now = Date.now();
  const [waiting, batches] = await Promise.all([
    prisma.gnPendingJoiner.findMany({
      where: { assignedBatchId: null },
      orderBy: { createdAt: "asc" }, // longest wait first — they've earned the next seat
      select: {
        id: true,
        studentId: true,
        level: true,
        preference: true,
        preferredTime: true,
        notes: true,
        createdAt: true,
        student: { select: { fullName: true, email: true } },
        workshop: { select: { name: true } },
      },
    }),
    prisma.gnBatch.findMany({
      where: { status: "ACTIVE" },
      orderBy: { createdAt: "asc" },
      select: {
        id: true,
        name: true,
        level: true,
        targetStrength: true,
        _count: { select: { members: true } },
      },
    }),
  ]);

  const rows: PoolRow[] = waiting.map((w) => ({
    id: w.id,
    studentId: w.studentId,
    fullName: w.student.fullName,
    email: w.student.email,
    level: w.level,
    preference: w.preference,
    preferredTime: w.preferredTime,
    workshopName: w.workshop?.name ?? null,
    notes: w.notes,
    waitingDays: Math.floor((now - w.createdAt.getTime()) / DAY_MS),
    createdAt: w.createdAt.toISOString(),
  }));

  const pool: PoolJoiner[] = waiting.map((w) => ({ id: w.id, level: w.level, preference: w.preference }));
  const suggestions: PoolSuggestionRow[] = suggestBatchesToOpen(pool, minToOpen);

  // Only batches with room can take a seat — a full one is not an option to offer.
  const withRoom: BatchWithRoom[] = batches
    .filter((b) => b._count.members < b.targetStrength)
    .map((b) => ({
      id: b.id,
      name: b.name,
      level: b.level,
      filled: b._count.members,
      targetStrength: b.targetStrength,
    }));

  return { rows, suggestions, batchesWithRoom: withRoom };
});

export type BatchCostRow = {
  id: string;
  name: string;
  level: string;
  headcount: number;
  targetStrength: number;
  /** Whole rupees per head at this batch's size. */
  ratePerHead: number;
  /** Whole rupees for the batch. */
  tutorFeeTotal: number;
  band: "at-or-above" | "below";
  threshold: number;
};

/** Levels the tutor-fee table prices. A GN_A1 batch is priced as A1. */
const LEVEL_TO_FEE_LEVEL: Record<string, TutorFeeLevel | undefined> = {
  GN_A1: "A1",
  GN_A2: "A2",
  GN_B1: "B1",
};

/**
 * The tutor cost of every active batch (spec Part 2 §5, test cases FIN-004/005).
 *
 * Derived live from the batch's CURRENT headcount rather than stored: the fee genuinely
 * changes when a student joins or leaves, so a cached figure would just be a stale one. A
 * batch whose level the fee table doesn't price (GN_B2, which §18.2 never gave a rate for) is
 * omitted rather than shown at a guessed rate.
 */
export const getBatchCosts = cache(async (): Promise<BatchCostRow[]> => {
  const [batches, config] = await Promise.all([
    prisma.gnBatch.findMany({
      where: { status: "ACTIVE" },
      orderBy: [{ level: "asc" }, { name: "asc" }],
      select: {
        id: true,
        name: true,
        level: true,
        targetStrength: true,
        _count: { select: { members: true } },
      },
    }),
    getTutorFeeConfig(),
  ]);

  const out: BatchCostRow[] = [];
  for (const b of batches) {
    const feeLevel = LEVEL_TO_FEE_LEVEL[b.level];
    if (!feeLevel) continue; // unpriced level — say nothing rather than invent a rate
    const headcount = b._count.members;
    out.push({
      id: b.id,
      name: b.name,
      level: b.level,
      headcount,
      targetStrength: b.targetStrength,
      ratePerHead: tutorRatePerHeadRupees(feeLevel, headcount, config),
      tutorFeeTotal: Math.round(tutorFeeForBatchInrMinor(feeLevel, headcount, config) / 100),
      band: headcount >= config.thresholdStudents ? "at-or-above" : "below",
      threshold: config.thresholdStudents,
    });
  }
  return out;
});
