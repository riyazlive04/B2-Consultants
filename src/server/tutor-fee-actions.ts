"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import type { TutorFeeStatus } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { capabilityCheck } from "@/lib/rbac";
import { computeTutorFee, isRecomputable, canTransition, payableAmountInrMinor } from "@/lib/tutor-fee-record";
import { postEntryOnce } from "./ledger-core";
import { tutorFeeAccrualDraft } from "./finance-posting";
import { getTutorFeeConfig, getFinancePostingConfig } from "./founder-config";
import { logActivity } from "./activity-log";
import { feeEligibleBatches } from "./tutor-fees";
import type { ActionResult } from "./finance-actions";

/**
 * Tutor fee writes (ER v2 Track C).
 *
 * ADMIN-triggered via `finance.write`, never a cron: money never moves on a schedule, and a
 * human clicking "approve" IS the sign-off. Recompute is idempotent and only ever touches
 * DRAFT rows - the database enforces that too (`tutor_fee_settled_guard`), so this is
 * defence in depth rather than the only guard.
 */

function firstError(e: z.ZodError): string {
  return e.issues[0]?.message ?? "Invalid input";
}

/**
 * Recompute every eligible batch's DRAFT fee against its CURRENT roster.
 *
 * Skips APPROVED / PAID / CANCELLED rows and REPORTS the skips rather than swallowing them:
 * "nothing changed" and "three fees were frozen so I left them" look identical on screen
 * otherwise, and the second one is the answer to "why didn't the number move".
 */
export async function recomputeTutorFees(): Promise<ActionResult & { summary?: string }> {
  const { allowed, denied, session } = await capabilityCheck("finance.write");
  if (!allowed) return denied;

  const [batches, config, existing] = await Promise.all([
    feeEligibleBatches(),
    getTutorFeeConfig(),
    prisma.tutorFee.findMany({ select: { id: true, batchId: true, level: true, status: true } }),
  ]);

  const byKey = new Map(existing.map((f) => [`${f.batchId}:${f.level}`, f]));
  let created = 0;
  let updated = 0;
  let frozen = 0;

  for (const b of batches) {
    const computed = computeTutorFee(b.level, b.headcount, config);
    if (!computed) continue; // level carries no trainer fee - skip, never write a ₹0 row

    const prior = byKey.get(`${b.id}:${b.level}`);
    if (prior && !isRecomputable(prior.status)) {
      frozen++;
      continue;
    }

    const data = {
      trainerId: b.tutorId,
      headcount: computed.headcount,
      ratePerHeadInrMinor: computed.ratePerHeadInrMinor,
      amountInrMinor: computed.amountInrMinor,
      computedAt: new Date(),
    };

    if (prior) {
      await prisma.tutorFee.update({ where: { id: prior.id }, data });
      updated++;
    } else {
      await prisma.tutorFee.create({ data: { ...data, batchId: b.id, level: b.level } });
      created++;
    }
  }

  const summary = `${created} created · ${updated} updated · ${frozen} left frozen (approved or paid)`;
  await logActivity(session, {
    action: "tutorfee.recompute",
    section: "german-note",
    entityType: "TutorFee",
    entityId: "batch",
    summary: `Recomputed tutor fees - ${summary}`,
    meta: { created, updated, frozen },
  });

  revalidatePath("/german-note");
  revalidatePath("/console");
  return { ok: true, summary };
}

const overrideSchema = z.object({
  amountRupees: z.string().trim().min(1, "Enter an amount"),
  reason: z.string().trim().min(3, "Give a reason for the override"),
});

/**
 * Override the computed figure.
 *
 * A reason is REQUIRED, not optional: six months later an unexplained override is
 * indistinguishable from a typo, and the person who could say which has moved on.
 */
export async function setTutorFeeOverride(feeId: string, form: FormData): Promise<ActionResult> {
  const { allowed, denied, session } = await capabilityCheck("finance.write");
  if (!allowed) return denied;

  const parsed = overrideSchema.safeParse(Object.fromEntries(form));
  if (!parsed.success) return { ok: false, error: firstError(parsed.error) };

  const rupees = Number(parsed.data.amountRupees);
  if (!Number.isFinite(rupees) || rupees < 0) return { ok: false, error: "Enter a valid amount" };

  const fee = await prisma.tutorFee.findUnique({
    where: { id: feeId },
    select: { status: true, batch: { select: { name: true } } },
  });
  if (!fee) return { ok: false, error: "Fee not found" };
  if (fee.status !== "DRAFT") return { ok: false, error: "Only a draft fee can be overridden" };

  await prisma.tutorFee.update({
    where: { id: feeId },
    data: {
      overrideAmountInrMinor: BigInt(Math.round(rupees * 100)),
      overrideReason: parsed.data.reason,
    },
  });

  await logActivity(session, {
    action: "tutorfee.override",
    section: "german-note",
    entityType: "TutorFee",
    entityId: feeId,
    summary: `Overrode the tutor fee for ${fee.batch.name} to ₹${rupees.toLocaleString("en-IN")}`,
    meta: { reason: parsed.data.reason },
  });

  revalidatePath("/german-note");
  return { ok: true };
}

/**
 * Move a fee along the approval ladder, accruing to the ledger on APPROVED.
 *
 * The accrual is Dr COGS / Cr Accounts-payable - it asserts the cost is OWED, never that it
 * was paid, so approving a fee can't overstate what left the bank. Gated on
 * `financePosting.tutorFeeAccrual` (OFF by default); with it off the fee report is still
 * complete and only the posting is withheld.
 *
 * The posting is idempotent via `postEntryOnce` keyed on the fee id, so a double-click or a
 * retried request cannot accrue the same fee twice.
 */
export async function setTutorFeeStatus(feeId: string, to: TutorFeeStatus): Promise<ActionResult> {
  const { allowed, denied, session } = await capabilityCheck("finance.write");
  if (!allowed) return denied;

  const fee = await prisma.tutorFee.findUnique({
    where: { id: feeId },
    select: {
      id: true, status: true, level: true, amountInrMinor: true, overrideAmountInrMinor: true,
      postedEntryId: true,
      batch: { select: { name: true } },
      trainer: { select: { name: true } },
    },
  });
  if (!fee) return { ok: false, error: "Fee not found" };
  if (!canTransition(fee.status, to)) {
    return { ok: false, error: `Cannot move a ${fee.status.toLowerCase()} fee to ${to.toLowerCase()}` };
  }

  const now = new Date();
  const stamps =
    to === "APPROVED" ? { approvedAt: now } : to === "PAID" ? { paidAt: now } : {};

  await prisma.tutorFee.update({ where: { id: feeId }, data: { status: to, ...stamps } });

  let postedEntryId: string | null = fee.postedEntryId;
  if (to === "APPROVED") {
    const cfg = await getFinancePostingConfig();
    const payable = payableAmountInrMinor(fee);
    if (cfg.tutorFeeAccrual.enabled && payable > 0n) {
      try {
        const draft = tutorFeeAccrualDraft({
          id: fee.id,
          approvedAt: now,
          batchName: fee.batch.name,
          level: fee.level,
          trainerName: fee.trainer?.name ?? null,
          payableInrMinor: payable,
          approvedById: session.user.id,
        });
        const entryId = await prisma.$transaction((tx) => postEntryOnce(tx, { ...draft, sourceId: fee.id }));
        if (entryId) {
          postedEntryId = entryId;
          await prisma.tutorFee.update({ where: { id: feeId }, data: { postedEntryId: entryId } });
        }
      } catch (err) {
        // The approval itself has already happened and is correct. A posting failure - a
        // locked period, a missing account - must be TOLD, not silently swallowed, but it
        // must not roll back the founder's decision either.
        const message = err instanceof Error ? err.message : "Unknown posting error";
        await logActivity(session, {
          action: "tutorfee.accrual_failed",
          section: "german-note",
          entityType: "TutorFee",
          entityId: feeId,
          summary: `Approved the tutor fee for ${fee.batch.name}, but recording it as owed in the ledger failed`,
          meta: { error: message },
        });
        return { ok: false, error: `Fee approved, but recording it as owed in the ledger failed: ${message}` };
      }
    }
  }

  await logActivity(session, {
    action: `tutorfee.${to.toLowerCase()}`,
    section: "german-note",
    entityType: "TutorFee",
    entityId: feeId,
    summary: `Marked the ${fee.batch.name} tutor fee ${to.toLowerCase()}`,
    meta: { from: fee.status, to, postedEntryId },
  });

  revalidatePath("/german-note");
  revalidatePath("/ledger");
  return { ok: true };
}
