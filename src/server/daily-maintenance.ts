import "server-only";
import { prisma } from "@/lib/prisma";
import { istToday } from "@/lib/dates";
import { prewarmTodayFx } from "@/lib/fx";
import { captureException } from "@/lib/observability";
import { getMaintenanceConfig } from "./founder-config";
import { runOverdueSweep } from "./overdue-sweep";
import { runRetentionSweep } from "./retention";
import { runScheduledReport } from "./scheduled-report";
import { backfillInvoiceIssuance } from "./invoice-posting";
import { runDunning } from "./dunning";
import { ensureBookingSlots } from "./slot-topup";
import { ensureSssSlots } from "./sss-topup";

/**
 * The once-a-day housekeeping orchestrator (audit §C #18/#19/#21/#22/#24), ticked by
 * /api/cron/daily. The app has no clock of its own, so - like every other engine here - none of
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
      // The isolation above is the point of this wrapper - one failing sub-job must not stop the
      // others. But storing the message in a response body that goes nowhere is how a broken job
      // stayed broken silently. Reporting it costs nothing and keeps the isolation intact.
      await captureException(e, { where: `maintenance:${name}`, fingerprint: ["maintenance", name] });
    }
  };

  // Cheap, corrective, every tick.
  if (cfg.fxPrewarm.enabled) await safe("fxPrewarm", prewarmTodayFx);
  await safe("overdueSweep", runOverdueSweep);

  // Keep the public /book calendar stocked. Additive-only (never updates or deletes a slot) and
  // idempotent, so it runs on every tick rather than once a day: a once-daily top-up would leave
  // the calendar short for up to 24h after the horizon widened. Self-gates on its own config,
  // which ships disabled.
  await safe("bookingSlotTopUp", ensureBookingSlots);

  // The same treatment for the founder's SSS diary, which has never held a single row. Same
  // additive-only guarantees, same self-gating on a config that ships disabled.
  await safe("sssSlotTopUp", ensureSssSlots);

  // Event-driven posting handles new invoices; this mops up legacy/flag-was-off ones. Cheap
  // (postEntryOnce short-circuits already-posted), so it can run every tick.
  await safe("invoiceIssuanceBackfill", () => backfillInvoiceIssuance());

  // Destructive growth-table pruning (aged WhatsApp messages + expired invites) - once per IST day
  // only. Archived-record purging is handled separately by /api/cron/retention.
  if (cfg.retention.enabled && !(await alreadyRanToday("maintenance.retention.lastRun"))) {
    await safe("retentionSweep", runRetentionSweep);
  }

  // The three-stage dunning ladder (§8.3). Once per IST day - not because the engine is unsafe
  // to run more often (a stage can only ever fire once, enforced by a unique key), but because
  // the per-run cap is a DAILY drip. Running hourly would drain the backlog 24× faster than
  // intended and undo the point of capping it.
  //
  // Ships OFF and no-ops until the founders arm it. This replaces the old single-stage
  // `runPaymentDueEmails`, which deduped by string-matching its own subject line.
  if (!(await alreadyRanToday("maintenance.dunning.lastRun"))) {
    await safe("dunning", runDunning);
  }

  // Self-guarded to fire once per period.
  await safe("scheduledReport", runScheduledReport);

  return { ranAt: new Date().toISOString(), jobs };
}
