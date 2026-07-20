import "server-only";
import { prisma } from "@/lib/prisma";
import { istToday } from "@/lib/dates";
import { prewarmTodayFx } from "@/lib/fx";
import { getMaintenanceConfig } from "./founder-config";
import { runOverdueSweep } from "./overdue-sweep";
import { runRetentionSweep } from "./retention";
import { runScheduledReport } from "./scheduled-report";
import { backfillInvoiceIssuance } from "./invoice-posting";
import { runPaymentDueEmails } from "./payment-email-reminders";

/**
 * The once-a-day housekeeping orchestrator (audit §C #18/#19/#21/#22/#24), ticked by
 * /api/cron/daily. The app has no clock of its own, so — like every other engine here — none of
 * this runs unless an external scheduler lands an HTTP request on that route.
 *
 * Every sub-job is idempotent and independently flag-gated, and each is wrapped so one failing
 * never stops the others (a down FX API must not block the overdue sweep). The genuinely
 * destructive job (the retention SWEEP that prunes aged comms/invites) is additionally guarded to
 * run at most once per IST day; the cheap corrective jobs run every tick. Archived-record purging
 * is a separate concern owned by /api/cron/retention (runRetentionPurge) and is NOT run here.
 */

export type DailyMaintenanceRun = {
  ranAt: string;
  jobs: Record<string, unknown>;
};

/** True if `key` already marks today's IST date; otherwise stamps it and returns false. */
async function alreadyRanToday(key: string): Promise<boolean> {
  const today = istToday().toISOString().slice(0, 10);
  const row = await prisma.appSetting.findUnique({ where: { key } });
  if (row?.value === today) return true;
  await prisma.appSetting.upsert({ where: { key }, create: { key, value: today }, update: { value: today } });
  return false;
}

export async function runDailyMaintenance(): Promise<DailyMaintenanceRun> {
  const cfg = await getMaintenanceConfig();
  const jobs: Record<string, unknown> = {};

  const safe = async (name: string, fn: () => Promise<unknown>) => {
    try {
      jobs[name] = await fn();
    } catch (e) {
      jobs[name] = { error: e instanceof Error ? e.message : String(e) };
    }
  };

  // Cheap, corrective, every tick.
  if (cfg.fxPrewarm.enabled) await safe("fxPrewarm", prewarmTodayFx);
  await safe("overdueSweep", runOverdueSweep);

  // Event-driven posting handles new invoices; this mops up legacy/flag-was-off ones. Cheap
  // (postEntryOnce short-circuits already-posted), so it can run every tick.
  await safe("invoiceIssuanceBackfill", () => backfillInvoiceIssuance());

  // Destructive growth-table pruning (aged WhatsApp messages + expired invites) — once per IST day
  // only. Archived-record purging is handled separately by /api/cron/retention.
  if (cfg.retention.enabled && !(await alreadyRanToday("maintenance.retention.lastRun"))) {
    await safe("retentionSweep", runRetentionSweep);
  }

  // Payment due-date reminders by email (§8.3). Once per IST day: the engine carries its
  // own 72-hour per-recipient cooldown, but how often a student gets chased must not depend
  // on how frequently the cron happens to be wired. Fail-closed inside — sends nothing
  // unless email is armed and configured, and logs who WOULD have been mailed either way.
  if (!(await alreadyRanToday("maintenance.paymentEmails.lastRun"))) {
    await safe("paymentDueEmails", runPaymentDueEmails);
  }

  // Self-guarded to fire once per period.
  await safe("scheduledReport", runScheduledReport);

  return { ranAt: new Date().toISOString(), jobs };
}
