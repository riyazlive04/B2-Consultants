import "server-only";
import { cache } from "react";
import { prisma } from "@/lib/prisma";
import { getTutorFeeConfig } from "./founder-config";
import { tutorRatePerHeadRupees, tutorFeeForBatchInrMinor } from "@/lib/tutor-fee";
import type { TutorFeeLevel } from "@/lib/config-schema";

/**
 * The per-batch tutor cost line (German Note → Manage → Costs).
 *
 * Previously shared a file with the pending-pool reads. The pending pool has been removed from
 * the app, so this moved here on its own rather than keeping a module named after a section that
 * no longer exists.
 */

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
    prisma.batch.findMany({
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
    if (!feeLevel) continue; // unpriced level - say nothing rather than invent a rate
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
