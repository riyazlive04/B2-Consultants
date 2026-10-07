import "server-only";
import { prisma } from "@/lib/prisma";
import { getPendingRows } from "./finance-metrics";
import { logSystemActivity, SYSTEM_ACTORS } from "./activity-log";

/**
 * Catch the `status` column up with the arithmetic (FIN-12 / issue 3).
 *
 * A receivable that had been collected in full went on reading "Active" and went on being
 * counted as open. The only code that ever wrote PAID_IN_FULL lived inside the instalment
 * settler, so it could only ever fire for a plan that HAD a schedule and whose last instalment
 * was closed by an incoming payment - a plain pending fee, however completely it was paid, stayed
 * Active forever.
 *
 * `getPendingRows` already derives `settled` and the table already SHOWS "Paid in full" from it,
 * so nothing on screen waits for this sweep. What the sweep is for is everything that reads the
 * stored column directly - the dunning candidate query (`status: { in: ["ACTIVE", "OVERDUE"] }`),
 * the scheduled report, exports - which would otherwise keep chasing a student who has paid.
 *
 * Idempotent and non-destructive. It only ever moves a live status to PAID_IN_FULL, and only
 * where the derived figure says so; it never reopens a plan an admin closed by hand, and it never
 * touches DROPPED. The reverse direction is deliberately absent: a plan that stops being settled
 * (an archived payment, an edited fee) is a human decision, not a sweep's.
 */

export type PendingSweepRun = {
  marked: number;
  /** Plan ids newly closed, for the activity trail. */
  ids: string[];
};

export async function runPendingStatusSweep(): Promise<PendingSweepRun> {
  const rows = await getPendingRows();
  // `settled` is derived; `storedStatus` is what is actually in the column. The gap between them
  // is exactly the work.
  const ids = rows
    .filter((r) => r.settled && (r.storedStatus === "ACTIVE" || r.storedStatus === "OVERDUE"))
    .map((r) => r.id);
  if (ids.length === 0) return { marked: 0, ids: [] };

  const { count } = await prisma.pendingPayment.updateMany({
    // The status is re-checked in the WHERE clause, so a plan an admin changed between the read
    // above and this write is left alone rather than overwritten.
    where: { id: { in: ids }, status: { in: ["ACTIVE", "OVERDUE"] } },
    data: { status: "PAID_IN_FULL" },
  });

  if (count) {
    await logSystemActivity(SYSTEM_ACTORS.reminders, {
      action: "finance.pendingPayment.settled",
      section: "finance",
      entityType: "PendingPayment",
      entityId: ids[0],
      summary: `Closed ${count} fully-paid receivable${count === 1 ? "" : "s"}`,
      meta: { count, ids: ids.slice(0, 50) },
    });
  }

  return { marked: count, ids };
}
