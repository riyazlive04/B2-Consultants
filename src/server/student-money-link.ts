import "server-only";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { nameKey } from "@/lib/name-key";

/**
 * ATTACH THE MONEY ALREADY RECORDED UNDER THIS NAME (P0b).
 *
 * ── Why a student arrives with history behind them ──────────────────────────────────────
 * Money is recorded as it comes in, by name, often weeks before anybody creates a student
 * record. So the moment a record exists, the payments and receivables typed under that name have
 * to join it - otherwise a student's payment history starts at today's receipt and the beginning
 * of it is simply missing.
 *
 * ── The drift this closes ───────────────────────────────────────────────────────────────
 * Six screens can create a student, and four of them ran this backfill by hand. Three linked
 * INCOME only. The fourth - the income form itself - also linked the PENDING PAYMENT, because
 * whoever wrote that path noticed the receivable is the other half of the same history.
 *
 * So the same student got a different amount of their own history depending on which door
 * created them: converted from a lead, or added as a German Note member, and their instalment
 * plan stayed detached, with "paid so far" reading zero against a plan they had been paying for
 * months. Nobody would have reported that as a bug; it reads as a data-entry mistake.
 *
 * One function, both tables, every door.
 *
 * ── What it will never do ───────────────────────────────────────────────────────────────
 * Touch a row that already belongs to somebody. `studentId: null` is in every filter, so a
 * payment attributed to another student is never moved, however well the name matches. Linking
 * is additive and safe to repeat; re-attributing is not, and is a human decision.
 */

/** Either the client or an open transaction - callers are usually mid-transaction already. */
type Db = Pick<Prisma.TransactionClient, "income" | "pendingPayment">;

export type MoneyLinked = {
  /** Payments that joined the record. */
  incomes: number;
  /** Instalment plans / receivables that joined it. */
  pendingPayments: number;
};

/**
 * Link every unattached payment and receivable typed under `fullName` to this student.
 *
 * `db` defaults to the client, so a caller outside a transaction needs no argument. Pass the
 * `tx` when the student was created inside one: the link has to commit with the record, or a
 * rolled-back creation leaves somebody else's money pointing at a student that does not exist.
 */
export async function linkOrphanMoneyToStudent(
  args: { studentId: string; fullName: string },
  db: Db = prisma,
): Promise<MoneyLinked> {
  const key = nameKey(args.fullName);

  /*
    Matched in JS rather than in SQL, and deliberately.

    `Income.studentName` is free text with inconsistent spacing and casing - "  anita  rao " is
    the same person as "Anita Rao" - and Postgres cannot answer that with an index-friendly
    predicate anyway. The unattached set is small (every payment ever linked leaves it, for good)
    so reading it and comparing keys is both correct and cheap, where a `LIKE` would be neither.
  */
  const orphans = await db.income.findMany({
    where: { studentId: null },
    select: { id: true, studentName: true },
  });
  const incomeIds = orphans.filter((i) => nameKey(i.studentName) === key).map((i) => i.id);
  if (incomeIds.length > 0) {
    await db.income.updateMany({
      where: { id: { in: incomeIds } },
      data: { studentId: args.studentId },
    });
  }

  /*
    The receivable half. `PendingPayment.studentName` is also free text, so the same key match
    applies - the income form's original version of this compared the raw string, which missed
    a plan typed with a double space.
  */
  const plans = await db.pendingPayment.findMany({
    where: { studentId: null },
    select: { id: true, studentName: true },
  });
  const planIds = plans.filter((p) => nameKey(p.studentName) === key).map((p) => p.id);
  if (planIds.length > 0) {
    await db.pendingPayment.updateMany({
      where: { id: { in: planIds } },
      data: { studentId: args.studentId },
    });
  }

  return { incomes: incomeIds.length, pendingPayments: planIds.length };
}
