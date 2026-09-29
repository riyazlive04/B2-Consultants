import "server-only";
import { Prisma } from "@prisma/client";
import { aggEurMinor, aggInrMinor } from "@/lib/money";
import {
  isPlanPaidInFull,
  pickPlanForPayment,
  settleDecision,
  studentNameKey,
} from "@/lib/instalment-plan";

/**
 * Keeps a receivable's instalment schedule in step with the incomes recorded against it
 * (FIN-06 / FIN-07 / FIN-08).
 *
 * WHY THIS EXISTS: the balance on Pending payments is computed from incomes, but the Instalment
 * rows - which drive "next due", the EMI counter, the red row and, above all, the dunning ladder -
 * were only ever changed by hand. So a student who paid instalment 2 kept an OVERDUE instalment 2,
 * and the live ladder would have sent them a final notice. Every function here runs INSIDE the
 * income's own transaction, so a payment and the schedule it settles land (or roll back) together.
 *
 * The decisions (which plan, which instalments, paid in full or not) are pure functions in
 * lib/instalment-plan.ts; this file only reads and writes around them.
 *
 * THE LINK BACK: which instalments an income settled is written into that income's hash-chained
 * audit entry (`payload.settlement`), because the schema has no income -> instalment column and
 * this fix adds no migration. Archiving or editing the income reads the latest such record to undo
 * exactly what that income did, and nothing else.
 */

type Tx = Prisma.TransactionClient;

export type SettlementOutcome =
  | "settled" // at least one instalment paid off
  | "shortfall" // less than the earliest unpaid instalment - nothing settled
  | "no-plan" // no live plan for this student at this level
  | "ambiguous" // more than one plausible plan - left for the admin
  | "no-instalments" // the plan has no unpaid instalment rows (e.g. a receivable with no schedule)
  | "created-plan" // this income STARTED the plan (it is instalment 1), so it settles nothing else
  | "not-instalment" // a full payment, or an edit that turned the income into one
  | "archived"; // the income is archived and whatever it settled has been undone

/**
 * What one income did to a schedule - stored in its audit payload as `settlement`.
 *
 * `autoSettle` says whether this income takes part in automatic settling at all. It is false for an
 * income that created its own plan, and absent (treated as false) on every income recorded before
 * this fix - so editing or restoring an old income never retro-settles a schedule the admin may
 * already have reconciled by hand. It is carried forward on every later record for the same income.
 */
export type SettlementRecord = {
  autoSettle: boolean;
  outcome: SettlementOutcome;
  planId: string | null;
  instalmentIds: string[];
  paidInFull: boolean;
};

type IncomeForSettle = {
  id: string;
  date: Date;
  studentId: string | null;
  studentName: string;
  programLevel: string;
  paymentType: "FULL_PAYMENT" | "INSTALMENT";
  amountInrMinor: bigint;
  amountEurMinor: bigint;
  fxRateUsed: Prisma.Decimal;
};

type LockedPlan = {
  id: string;
  studentId: string | null;
  studentName: string;
  status: string;
  totalFeeInrMinor: bigint;
  totalFeeEurMinor: bigint;
  planExtraInrMinor: bigint;
  planExtraEurMinor: bigint;
  fxRateUsed: Prisma.Decimal;
};

const record = (autoSettle: boolean, outcome: SettlementOutcome, planId: string | null = null): SettlementRecord => ({
  autoSettle,
  outcome,
  planId,
  instalmentIds: [],
  paidInFull: false,
});

/** The record for an income that created its own plan: it never settles anything afterwards. */
export const CREATED_PLAN_SETTLEMENT: SettlementRecord = record(false, "created-plan");

/**
 * Settle the income's plan, if - and only if - it unambiguously has one.
 *
 * Round-trips inside the transaction: 1 when there is no plan to settle; otherwise 2 reads (the
 * locked candidate plans, their instalments) + 2 writes (instalments, plan headline) = 4, plus 1
 * read of the student's incomes at this level only when the last instalment was just paid (to
 * confirm the balance agrees before writing Paid in full). All on indexed keys or the small
 * pending_payment table.
 */
export async function settleInstalmentsForIncome(tx: Tx, income: IncomeForSettle): Promise<SettlementRecord> {
  if (income.paymentType !== "INSTALMENT") return record(true, "not-instalment");

  /**
   * Candidates are narrowed by the SAME programme level as the payment - a Guided payment must not
   * pay off an A1 schedule - and by the student rule below. `FOR UPDATE` locks the matched plans so
   * two payments recorded at the same moment queue up, and the second one sees the instalment the
   * first one paid instead of paying it off twice.
   */
  const plans = await tx.$queryRaw<LockedPlan[]>`
    SELECT "id", "studentId", "studentName", "status"::text AS "status",
           "totalFeeInrMinor", "totalFeeEurMinor", "planExtraInrMinor", "planExtraEurMinor", "fxRateUsed"
      FROM "pending_payment"
     WHERE "deletedAt" IS NULL
       AND "status" IN ('ACTIVE', 'OVERDUE')
       AND "programLevel" = ${income.programLevel}
       AND (
             ("studentId" IS NOT NULL AND "studentId" = ${income.studentId})
          OR ("studentId" IS NULL
              AND regexp_replace(lower(btrim("studentName")), '[[:space:]]+', ' ', 'g') = ${studentNameKey(income.studentName)})
       )
     FOR UPDATE`;

  const pick = pickPlanForPayment(income, plans);
  if ("skip" in pick) return record(true, pick.skip);
  const plan = plans.find((p) => p.id === pick.planId)!;

  const instalments = await tx.instalment.findMany({
    where: { pendingPaymentId: plan.id },
    select: {
      id: true, seq: true, dueDate: true, status: true,
      amountInrMinor: true, amountEurMinor: true, fxRateUsed: true,
    },
  });
  if (!instalments.some((i) => i.status !== "PAID")) return record(true, "no-instalments", plan.id);

  const decision = settleDecision(
    {
      inr: income.amountInrMinor,
      eur: income.amountEurMinor,
      aggInr: aggInrMinor(income.amountInrMinor, income.amountEurMinor, income.fxRateUsed),
    },
    instalments.map((i) => ({
      id: i.id,
      seq: i.seq,
      dueDate: i.dueDate,
      status: i.status,
      inr: i.amountInrMinor,
      eur: i.amountEurMinor,
      aggInr: aggInrMinor(i.amountInrMinor, i.amountEurMinor, i.fxRateUsed),
    })),
  );
  // Part of an instalment is not the instalment: nothing changes, and the ladder keeps its view.
  if (decision.settleIds.length === 0) return record(true, "shortfall", plan.id);

  await tx.instalment.updateMany({
    where: { id: { in: decision.settleIds }, status: { not: "PAID" } },
    // The day the money arrived, not the day it was typed in - a back-dated payment keeps its date.
    data: { status: "PAID", paidDate: income.date },
  });

  let paidInFull = false;
  if (decision.allPaid) {
    paidInFull = isPlanPaidInFull({
      allInstalmentsPaid: true,
      toCollect: {
        inr: aggInrMinor(plan.totalFeeInrMinor, plan.totalFeeEurMinor, plan.fxRateUsed)
          + aggInrMinor(plan.planExtraInrMinor, plan.planExtraEurMinor, plan.fxRateUsed),
        eur: aggEurMinor(plan.totalFeeInrMinor, plan.totalFeeEurMinor, plan.fxRateUsed)
          + aggEurMinor(plan.planExtraInrMinor, plan.planExtraEurMinor, plan.fxRateUsed),
      },
      paid: await paidTowardsPlan(tx, plan, income.programLevel),
    });
  }

  await tx.pendingPayment.update({
    where: { id: plan.id },
    data: {
      nextDueDate: decision.nextDueDate,
      ...(paidInFull ? { status: "PAID_IN_FULL" as const } : {}),
    },
  });

  return {
    autoSettle: true,
    outcome: "settled",
    planId: plan.id,
    instalmentIds: decision.settleIds,
    paidInFull,
  };
}

/**
 * What the student has paid towards THIS plan, for the paid-in-full check.
 *
 * Same student rule as the balance on screen (id-linked plans by id only, unlinked by name), but
 * narrowed to the plan's own level. The on-screen balance is not narrowed (FIN-12, a known
 * cross-credit of other-level payments), so this figure is never larger than what the table
 * credits: whenever this says "nothing left", the table says so too, and an old payment for a
 * different course can never be what closes a plan.
 */
async function paidTowardsPlan(tx: Tx, plan: LockedPlan, programLevel: string) {
  const incomes = await tx.income.findMany({
    where: {
      deletedAt: null,
      programLevel,
      ...(plan.studentId
        ? { studentId: plan.studentId }
        : { studentName: { equals: plan.studentName.trim(), mode: "insensitive" as const } }),
    },
    select: { studentName: true, amountInrMinor: true, amountEurMinor: true, fxRateUsed: true },
  });
  const key = studentNameKey(plan.studentName);
  let inr = BigInt(0);
  let eur = BigInt(0);
  for (const i of incomes) {
    if (!plan.studentId && studentNameKey(i.studentName) !== key) continue;
    inr += aggInrMinor(i.amountInrMinor, i.amountEurMinor, i.fxRateUsed);
    eur += aggEurMinor(i.amountInrMinor, i.amountEurMinor, i.fxRateUsed);
  }
  return { inr, eur };
}

/**
 * The latest settlement record written for an income, or null when it has none (every income
 * recorded before this fix). One indexed read on audit_entry(entityType, entityId).
 */
export async function latestSettlement(tx: Tx, incomeId: string): Promise<SettlementRecord | null> {
  const entries = await tx.auditEntry.findMany({
    where: { entityType: "Income", entityId: incomeId },
    orderBy: { seq: "desc" },
    select: { payload: true },
    take: 20,
  });
  for (const e of entries) {
    const s = (e.payload as { settlement?: SettlementRecord } | null)?.settlement;
    if (s && typeof s === "object" && Array.isArray(s.instalmentIds)) return s;
  }
  return null;
}

/**
 * Undo what an income settled, because the money it stood for is being withdrawn (archived) or
 * restated (edited). An instalment that stayed PAID after its payment was removed is a student
 * the ladder will never chase for money they have not paid.
 *
 * Only reverts rows that still look exactly as this income left them - PAID, with the income's
 * date as the paid date. If a person has since changed the row by hand, that is their call and is
 * left alone. The plan returns to ACTIVE only if THIS income was what marked it Paid in full.
 *
 * Round-trips: 0 when the income settled nothing; otherwise 2 writes (instalments back to
 * DUE/OVERDUE, split by date) + 1 read (next unpaid) + 1 write (plan headline) = 4, and 1 more
 * write when this income had marked the plan Paid in full.
 */
export async function unsettleIncome(
  tx: Tx,
  prior: SettlementRecord | null,
  incomeDate: Date,
  today: Date,
): Promise<void> {
  if (!prior || prior.instalmentIds.length === 0 || !prior.planId) return;
  const paidByThis = { id: { in: prior.instalmentIds }, status: "PAID" as const, paidDate: incomeDate };

  // Back to what the nightly sweep would have made them: OVERDUE once the date has passed
  // (`dueDate < today`, the sweep's own rule), DUE otherwise - so the ladder picks them up again.
  await tx.instalment.updateMany({
    where: { ...paidByThis, dueDate: { lt: today } },
    data: { status: "OVERDUE", paidDate: null },
  });
  await tx.instalment.updateMany({
    where: { ...paidByThis, dueDate: { gte: today } },
    data: { status: "DUE", paidDate: null },
  });

  const nextDue = await tx.instalment.findFirst({
    where: { pendingPaymentId: prior.planId, status: { not: "PAID" } },
    orderBy: [{ dueDate: "asc" }, { seq: "asc" }],
    select: { dueDate: true },
  });
  await tx.pendingPayment.updateMany({
    where: { id: prior.planId },
    data: { nextDueDate: nextDue?.dueDate ?? null },
  });
  if (prior.paidInFull) {
    await tx.pendingPayment.updateMany({
      where: { id: prior.planId, status: "PAID_IN_FULL" },
      data: { status: "ACTIVE" },
    });
  }
}

/** The record to store once an income is archived: nothing settled, eligibility carried forward. */
export function archivedSettlement(prior: SettlementRecord | null): SettlementRecord {
  return record(prior?.autoSettle ?? false, "archived");
}
