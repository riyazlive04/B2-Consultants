import "server-only";
import { prisma } from "@/lib/prisma";
import { istToday } from "@/lib/dates";
import { getMaintenanceConfig } from "./founder-config";
import { logSystemActivity, SYSTEM_ACTORS } from "./activity-log";

/**
 * Nightly OVERDUE sweep (audit §C #19).
 *
 * Nothing in the app ever flipped a DUE instalment or a SENT invoice to OVERDUE when its date
 * passed — the status just sat, so "overdue receivables" under-reported and the OVERDUE state
 * (which EMI reminders and the red row-tint key off) was effectively unreachable without a human
 * editing each row. This is the missing clock. Set-based, idempotent, non-destructive: re-running
 * only ever touches rows that are still DUE/SENT and genuinely past due.
 *
 * `@db.Date` columns are UTC-midnight and istToday() is the UTC-midnight of the current IST day,
 * so `dueDate < today` means "due yesterday or earlier" — something due TODAY is not yet overdue.
 *
 * Deliberately does NOT sweep PARTIAL invoices: a single status column can't say "partly paid AND
 * late", and flipping it to OVERDUE would erase the more useful "someone has paid something"
 * signal. A part-paid, past-due invoice stays PARTIAL by design.
 */

export type OverdueSweepRun = {
  enabled: boolean;
  reason?: string;
  instalmentsMarked: number;
  invoicesMarked: number;
};

export async function runOverdueSweep(): Promise<OverdueSweepRun> {
  const cfg = await getMaintenanceConfig();
  if (!cfg.overdueSweep.enabled) {
    return { enabled: false, reason: "Overdue sweep is switched off", instalmentsMarked: 0, invoicesMarked: 0 };
  }

  const today = istToday();

  const [inst, inv] = await prisma.$transaction([
    prisma.instalment.updateMany({
      where: { status: "DUE", dueDate: { lt: today } },
      data: { status: "OVERDUE" },
    }),
    prisma.invoice.updateMany({
      where: { kind: "INVOICE", status: "SENT", dueDate: { lt: today }, deletedAt: null },
      data: { status: "OVERDUE" },
    }),
  ]);

  if (inst.count || inv.count) {
    await logSystemActivity(SYSTEM_ACTORS.reminders, {
      action: "finance.overdue.sweep",
      section: "finance",
      entityType: "Instalment",
      entityId: today.toISOString().slice(0, 10),
      summary: `Marked ${inst.count} instalment${inst.count === 1 ? "" : "s"} and ${inv.count} invoice${inv.count === 1 ? "" : "s"} overdue`,
      meta: { instalments: inst.count, invoices: inv.count, date: today.toISOString().slice(0, 10) },
    });
  }

  return { enabled: true, instalmentsMarked: inst.count, invoicesMarked: inv.count };
}
