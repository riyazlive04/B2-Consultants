import "server-only";
import { prisma } from "@/lib/prisma";
import { INCOME_COUNTABLE } from "@/lib/soft-delete";
import { decideBookOrder } from "@/lib/book-order";
import { getBookOrderConfig } from "./founder-config";

/**
 * Re-evaluate every deferred book order against the cash actually collected (spec §9.2).
 *
 * This is what makes DEFERRED self-clearing: an EMI student crossing the threshold on their
 * third instalment should not depend on someone remembering to check.
 *
 * ── WHY IT MOVED OUT OF `book-order-actions.ts` ───────────────────────────────────────────
 * It lived in a `"use server"` file, which makes every export a callable server action - and this
 * one took no arguments and ran no permission check, so it was an unauthenticated door that
 * re-priced book orders across the whole business. It also had no caller at all, despite its own
 * comment saying it was "intended for the same cron tick that runs the other engines", so
 * DEFERRED was not in fact self-clearing.
 *
 * Here it is an ordinary server module, like `overdue-sweep` and `pending-sweep` beside it: the
 * only way in is `runDailyMaintenance`, which the cron route guards.
 *
 * Idempotent and non-destructive. It only ever moves DEFERRED → QUOTE_REQUESTED - asking the
 * publisher for a price is the next HUMAN step, so nothing is ordered, messaged or paid here.
 */
export async function releaseDeferredBookOrders(): Promise<{ released: number; checked: number }> {
  const config = await getBookOrderConfig();
  const deferred = await prisma.bookOrder.findMany({
    where: { status: "DEFERRED" },
    select: { id: true, studentId: true },
  });
  let released = 0;
  for (const order of deferred) {
    // Archived and reversed income excluded, so a mis-entry that was deleted cannot un-defer an
    // order - the same rule `cashCollectedInrMinor` keeps on the create path.
    const paid = await prisma.income.aggregate({
      where: { ...INCOME_COUNTABLE, studentId: order.studentId },
      _sum: { amountInrMinor: true },
    });
    const decision = decideBookOrder(Number(paid._sum.amountInrMinor ?? 0), config);
    if (!decision.order) continue;
    await prisma.bookOrder.update({
      where: { id: order.id },
      data: { status: "QUOTE_REQUESTED", deferReason: null },
    });
    released++;
  }
  return { released, checked: deferred.length };
}
