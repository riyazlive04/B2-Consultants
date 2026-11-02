import "server-only";

import { prisma } from "@/lib/prisma";
import { syncPaymentIncome } from "./finance-autopost";
import { getMaintenanceConfig } from "./founder-config";
import { logSystemActivity, SYSTEM_ACTORS } from "./activity-log";

/**
 * Data-lifecycle retention (dashboard issue 7.4): archived records are permanently purged once
 * they have sat in the Archive longer than the retention window (default 90 days, overridable via
 * the `retentionDays` AppSetting). This is the true end-of-life hard delete - cascades fire as
 * originally designed. Driven by the daily `/api/cron/retention` tick.
 */

export type RetentionResult = {
  days: number;
  cutoff: string;
  purged: Record<string, number>;
  total: number;
  /** False when the founder's pruning switch is off - nothing was deleted. */
  enabled: boolean;
  /** Why nothing ran, when it did not. */
  reason?: string;
  /** Issued invoices skipped as tax records. Reported because 0 purged is otherwise ambiguous. */
  keptAsTaxRecords?: number;
  /**
   * A value found in the retired `AppSetting("retentionDays")` row that is NOT being used.
   *
   * Present only on the installs that hand-set it before the window moved into
   * `maintenanceConfig`. Surfaced rather than obeyed so the discrepancy is visible on the cron's
   * own result instead of having to be guessed at - nothing reads the old key any more.
   */
  legacyIgnored?: number;
};

/**
 * The legacy home of this window, kept only to make sure a hand-set value is not silently ignored.
 *
 * The archive window now lives in `maintenanceConfig.retention.archiveDays`, next to the switch
 * that governs the purge and the two gentler windows beside it. Before that it was a bare
 * `AppSetting("retentionDays")` row with the hand-rolled parser this function replaced, and no
 * screen ever wrote it - so on any normal install it is absent and this returns null.
 *
 * It is READ but never obeyed. Obeying it would mean the new Console field saves a number that
 * nothing reads, which is the exact failure the config pattern exists to avoid. Instead a
 * mismatch is reported on the result and logged, so an install that really did hand-set it finds
 * out rather than having its window quietly changed underneath it.
 */
async function legacyArchiveDays(): Promise<number | null> {
  try {
    const row = await prisma.appSetting.findUnique({ where: { key: "retentionDays" } });
    const v = row?.value;
    const n = typeof v === "number" ? v : typeof v === "string" ? parseInt(v, 10) : NaN;
    return Number.isFinite(n) && n > 0 ? n : null;
  } catch {
    return null;
  }
}

export async function runRetentionPurge(): Promise<RetentionResult> {
  /**
   * The window and the switch come from ONE config document now, read once. They are a single
   * decision - "delete aged data, and anything older than this" - and reading them from two
   * places is how the Console came to show a toggle that was off over a job that deleted anyway.
   */
  const cfg = await getMaintenanceConfig();
  const days = cfg.retention.archiveDays;
  const cutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
  const purged: Record<string, number> = {};
  const legacy = await legacyArchiveDays();
  const legacyIgnored = legacy !== null && legacy !== days ? legacy : undefined;

  /**
   * ── THE FOUNDER'S PRUNING SWITCH GOVERNS THIS TOO ────────────────────────────────────────
   *
   * This is the most destructive job in the app - it hard-deletes archived leads, invoices,
   * income and expenses, cascades included - and it was the only one with no switch: it ran
   * whenever `/api/cron/retention` was hit, while the far gentler growth-table sweep
   * (`runRetentionSweep`, which prunes old WhatsApp rows and expired invites) was gated on
   * `maintenanceConfig.retention.enabled`. So the Console showed one "Prune aged data (deletes)"
   * toggle, switched off, over a job that was deleting the founder's archive regardless.
   *
   * Same flag as the sweep, because one switch labelled "prune aged data" should mean it.
   */
  if (!cfg.retention.enabled) {
    return {
      days,
      legacyIgnored,
      cutoff: cutoff.toISOString(),
      purged,
      total: 0,
      enabled: false,
      reason: "Pruning is switched off in Console → System → Maintenance",
    };
  }

  // Invoices first, one at a time: hard-deleting an invoice cascades its payments, and each
  // payment has an auto-posted Income mirror that must be removed or it becomes phantom revenue
  // (mirrors the manual purgeInvoice). A plain deleteMany can't do that side effect.
  const invoices = await prisma.invoice.findMany({
    where: {
      deletedAt: { lt: cutoff },
      /**
       * ── AN ISSUED INVOICE IS A TAX RECORD AND IS NEVER DESTROYED ──────────────────────
       *
       * `purgeInvoice` refuses one by hand - "it was issued, so it is a tax record and must be
       * kept" (8 years in Germany), and its number must never come free. This job deleted the
       * very same rows 90 days later without a word, so the rule held only for as long as nobody
       * waited: the archive was the safe place to put an issued invoice, and it was the one place
       * it was guaranteed to be destroyed from.
       *
       * An ESTIMATE is not a tax record and is still purged; a DRAFT invoice never got a number.
       */
      NOT: { AND: [{ kind: "INVOICE" }, { issuedAt: { not: null } }] },
    },
    select: { id: true },
  });
  let invoiceCount = 0;
  for (const inv of invoices) {
    const payments = await prisma.invoicePayment.findMany({
      where: { invoiceId: inv.id },
      select: { id: true },
    });
    await prisma.invoice.delete({ where: { id: inv.id } });
    for (const p of payments) await syncPaymentIncome(null, p.id);
    invoiceCount++;
  }
  purged.invoice = invoiceCount;

  // The rest are plain deleteMany. Income/Expense ledger entries were already voided at archive,
  // so nothing else needs unwinding. Lead is LAST: its hard delete cascades any children that are
  // still around (an archived lead can't gain new active children, so this only mops up).
  purged.product = (await prisma.product.deleteMany({ where: { deletedAt: { lt: cutoff } } })).count;
  purged.pendingPayment = (await prisma.pendingPayment.deleteMany({ where: { deletedAt: { lt: cutoff } } })).count;
  purged.income = (await prisma.income.deleteMany({ where: { deletedAt: { lt: cutoff } } })).count;
  purged.expense = (await prisma.expense.deleteMany({ where: { deletedAt: { lt: cutoff } } })).count;
  purged.task = (await prisma.contactTask.deleteMany({ where: { deletedAt: { lt: cutoff } } })).count;
  purged.opportunity = (await prisma.opportunity.deleteMany({ where: { deletedAt: { lt: cutoff } } })).count;
  purged.company = (await prisma.company.deleteMany({ where: { deletedAt: { lt: cutoff } } })).count;
  purged.lead = (await prisma.lead.deleteMany({ where: { deletedAt: { lt: cutoff } } })).count;

  // Counted so a run that purged nothing can say WHY. "0 invoices" and "0 invoices, 14 kept
  // because they are tax records" are different reports, and only the second one is reassuring.
  const keptAsTaxRecords = await prisma.invoice.count({
    where: { deletedAt: { lt: cutoff }, kind: "INVOICE", issuedAt: { not: null } },
  });

  const total = Object.values(purged).reduce((a, b) => a + b, 0);
  return {
    days,
    legacyIgnored,
    cutoff: cutoff.toISOString(),
    purged,
    total,
    enabled: true,
    keptAsTaxRecords,
  };
}

/**
 * Growth-table pruning (audit §C #21) - a DIFFERENT concern from runRetentionPurge above, which
 * hard-deletes soft-deleted/archived records past their window. This prunes two tables that only
 * ever grow and are never archived: the WhatsApp message log and expired-and-unaccepted user
 * invites. Append-only audit tables are deliberately excluded (they're trigger-protected and the
 * app derives from them). Gated on maintenanceConfig.retention.enabled - OFF by default because it
 * deletes; 0 days on a line means "keep forever". Idempotent.
 */
export type RetentionSweepRun = {
  enabled: boolean;
  reason?: string;
  whatsAppMessagesDeleted: number;
  expiredInvitesDeleted: number;
};

function daysAgo(days: number): Date {
  return new Date(Date.now() - days * 24 * 60 * 60 * 1000);
}

export async function runRetentionSweep(): Promise<RetentionSweepRun> {
  const cfg = await getMaintenanceConfig();
  if (!cfg.retention.enabled) {
    return { enabled: false, reason: "Retention is switched off", whatsAppMessagesDeleted: 0, expiredInvitesDeleted: 0 };
  }

  let whatsAppMessagesDeleted = 0;
  let expiredInvitesDeleted = 0;

  if (cfg.retention.whatsAppMessageDays > 0) {
    const r = await prisma.whatsAppMessage.deleteMany({
      where: { createdAt: { lt: daysAgo(cfg.retention.whatsAppMessageDays) } },
    });
    whatsAppMessagesDeleted = r.count;
  }

  if (cfg.retention.expiredInviteDays > 0) {
    const r = await prisma.userInvite.deleteMany({
      where: { acceptedAt: null, expiresAt: { lt: daysAgo(cfg.retention.expiredInviteDays) } },
    });
    expiredInvitesDeleted = r.count;
  }

  if (whatsAppMessagesDeleted || expiredInvitesDeleted) {
    await logSystemActivity(SYSTEM_ACTORS.automation, {
      action: "maintenance.retention.sweep",
      section: "console",
      entityType: "AppSetting",
      entityId: "maintenanceConfig",
      summary: `Retention sweep removed ${whatsAppMessagesDeleted} WhatsApp message${whatsAppMessagesDeleted === 1 ? "" : "s"} and ${expiredInvitesDeleted} expired invite${expiredInvitesDeleted === 1 ? "" : "s"}`,
      meta: { whatsAppMessagesDeleted, expiredInvitesDeleted },
    });
  }

  return { enabled: true, whatsAppMessagesDeleted, expiredInvitesDeleted };
}
