import "server-only";
import { Prisma } from "@prisma/client";
import { aggEurMinor, aggInrMinor } from "@/lib/money";
import { allocatePayments } from "@/lib/payment-allocation";
import {
  isPlanPaidInFull,
  pickPlanForPayment,
  settleDecision,
  studentNameKey,
} from "@/lib/instalment-plan";
import { paymentTypeKind } from "@/lib/payment-types";
import { getPaymentTypesConfig } from "./founder-config";

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
  /** PaymentTypeConfig.code. What matters is its KIND, resolved below, not the code itself. */
  paymentType: string;
  /**
   * The plan this payment NAMES, when the operator picked one (FIN-12). Set, it removes the
   * guesswork below entirely: the money settles that plan's ladder and no other, even where the
   * student has two plans at the same level - the case `pickPlanForPayment` could only ever
   * decline to touch.
   */
  pendingPaymentId: string | null;
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
  /**
   * Only an INSTALMENT-KIND payment settles a plan, and the kind comes from the founder's
   * configured list - not from the literal code. A founder who adds their own instalment type
   * must get the same chasing behaviour, and one who adds a SUBSCRIPTION must get none of it:
   * a recurring charge has no agreed total, so there is nothing for it to pay off and marking a
   * plan settled against it would silence a chase on a debt still owed.
   *
   * The config read is cached app-wide (founder-config), so this costs no round trip.
   */
  if (paymentTypeKind(await getPaymentTypesConfig(), income.paymentType) !== "INSTALMENT") {
    return record(true, "not-instalment");
  }

  /**
   * ── The operator said which plan this is for ──────────────────────────────────────
   * Then there is nothing to infer. Locked the same way as the search below, and still required
   * to be a LIVE plan: a payment pointed at an archived or already-closed receivable settles
   * nothing rather than reopening it. The level is deliberately NOT re-checked here - the person
   * recording the money chose this plan, and second-guessing them is what the ambiguity skip did.
   */
  if (income.pendingPaymentId) {
    const named = await tx.$queryRaw<LockedPlan[]>`
      SELECT "id", "studentId", "studentName", "status"::text AS "status",
             "totalFeeInrMinor", "totalFeeEurMinor", "planExtraInrMinor", "planExtraEurMinor", "fxRateUsed"
        FROM "pending_payment"
       WHERE "id" = ${income.pendingPaymentId}
         AND "deletedAt" IS NULL
         AND "status" IN ('ACTIVE', 'OVERDUE')
       FOR UPDATE`;
    if (named.length === 0) return record(true, "no-plan");
    return settleAgainst(tx, income, named[0]);
  }

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
  return settleAgainst(tx, income, plan);
}

/**
 * Pay off as much of one plan's ladder as this money covers.
 *
 * Split out of the function above so the named-plan path and the inferred-plan path cannot drift:
 * whichever way the plan was chosen, what happens to its instalments is this code.
 */
async function settleAgainst(tx: Tx, income: IncomeForSettle, plan: LockedPlan): Promise<SettlementRecord> {

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
      paid: await paidTowardsPlan(tx, plan),
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
 * What has been paid towards THIS plan, for the paid-in-full check.
 *
 * ── Why this reads every plan, not just the one being settled (FIN-12) ─────────────
 * It used to sum the student's payments AT THIS LEVEL and call that the plan's own total, which
 * was the same per-student cross-credit the on-screen balance had: a second plan at the same
 * level was closed by the first one's money. It now runs the SHARED allocator - the identical
 * function `getPendingRows` uses - over all of that student's live plans, and takes this plan's
 * share. So the figure that closes a plan here and the figure the table shows are one figure,
 * by construction rather than by agreement.
 */
async function paidTowardsPlan(tx: Tx, plan: LockedPlan) {
  const [plans, incomes] = await Promise.all([
    tx.pendingPayment.findMany({
      where: {
        deletedAt: null,
        ...(plan.studentId
          ? { studentId: plan.studentId }
          : { studentId: null, studentName: { equals: plan.studentName.trim(), mode: "insensitive" as const } }),
      },
      select: {
        id: true, studentName: true, createdAt: true,
        totalFeeInrMinor: true, totalFeeEurMinor: true,
        planExtraInrMinor: true, planExtraEurMinor: true, fxRateUsed: true,
      },
    }),
    tx.income.findMany({
      where: {
        deletedAt: null,
        ...(plan.studentId
          ? { studentId: plan.studentId }
          : { studentId: null, studentName: { equals: plan.studentName.trim(), mode: "insensitive" as const } }),
      },
      select: {
        studentName: true, pendingPaymentId: true,
        amountInrMinor: true, amountEurMinor: true, fxRateUsed: true,
      },
    }),
  ]);

  // A name-matched set is re-filtered in JS: `mode: "insensitive"` folds case but not the
  // repeated whitespace that `studentNameKey` folds, so "Anna  Smith" would slip through.
  const key = studentNameKey(plan.studentName);
  const mine = <T extends { studentName: string }>(rows: T[]) =>
    plan.studentId ? rows : rows.filter((r) => studentNameKey(r.studentName) === key);

  const result = allocatePayments(
    mine(plans).map((p) => ({
      id: p.id,
      createdAt: p.createdAt.getTime(),
      toCollect: {
        inr:
          Number(aggInrMinor(p.totalFeeInrMinor, p.totalFeeEurMinor, p.fxRateUsed)) +
          Number(aggInrMinor(p.planExtraInrMinor, p.planExtraEurMinor, p.fxRateUsed)),
        eur:
          Number(aggEurMinor(p.totalFeeInrMinor, p.totalFeeEurMinor, p.fxRateUsed)) +
          Number(aggEurMinor(p.planExtraInrMinor, p.planExtraEurMinor, p.fxRateUsed)),
      },
    })),
    mine(incomes).map((i) => ({
      pendingPaymentId: i.pendingPaymentId,
      amount: {
        inr: Number(aggInrMinor(i.amountInrMinor, i.amountEurMinor, i.fxRateUsed)),
        eur: Number(aggEurMinor(i.amountInrMinor, i.amountEurMinor, i.fxRateUsed)),
      },
    })),
  );

  const share = result.byPlan.get(plan.id);
  return {
    inr: BigInt(Math.round(share?.paid.inr ?? 0)),
    eur: BigInt(Math.round(share?.paid.eur ?? 0)),
  };
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

  /**
   * ════════════════════════════════════════════════════════════════════════════════════════
   *  RE-OPEN THE CHASE LADDER  (issue C1)
   * ════════════════════════════════════════════════════════════════════════════════════════
   *
   * Putting an instalment back to DUE was only HALF of letting the ladder pick it up again, and
   * the comment above has been describing the other half as done since it was written: "an
   * instalment that stayed PAID after its payment was removed is a student the ladder will never
   * chase for money they have not paid." It stayed un-chased either way.
   *
   * `stageFor` fires each rung ONCE, ever, from the `DunningEvent` rows - so an instalment that
   * had already been chased to FINAL before it was settled came back DUE with every stage
   * recorded as sent, and `stageFor` returned null for it for the rest of time. Silently, and on
   * no list.
   *
   * Bumping the cycle starts a new pass: the old cycle's rows stay exactly where they are (the
   * trail is still append-only and still answers "what did we send this student, and when"), and
   * UPCOMING / MISSED / FINAL are all available again.
   *
   * ── Why on EVERY unsettle, not only on a reversal ───────────────────────────────────────
   * This runs for an archive and an edit as well as for a reversal, and all three leave the same
   * situation: an instalment that is open and that nobody is going to chase. Whether the payment
   * was a typo or a bounced cheque changes what the money means; it does not change that the
   * student still owes this instalment and that the ladder is the only thing that will ask.
   *
   * `increment` rather than a read-then-write: two reversals landing together must not settle on
   * the same cycle number, which is the one way this could re-create the bug it fixes.
   */
  await tx.instalment.updateMany({
    where: { id: { in: prior.instalmentIds } },
    data: { dunningCycle: { increment: 1 } },
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
