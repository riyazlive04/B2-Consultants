import "server-only";

import { prisma } from "@/lib/prisma";
import { syncPaymentIncome } from "./finance-autopost";
import { RETENTION_DAYS } from "@/lib/soft-delete";
import { getMaintenanceConfig } from "./founder-config";
import { logSystemActivity, SYSTEM_ACTORS } from "./activity-log";

/**
 * Data-lifecycle retention (dashboard issue 7.4): archived records are permanently purged once
 * they have sat in the Archive longer than the retention window (default 90 days, overridable via
 * the `retentionDays` AppSetting). This is the true end-of-life hard delete — cascades fire as
 * originally designed. Driven by the daily `/api/cron/retention` tick.
 */

export type RetentionResult = {
  days: number;
  cutoff: string;
  purged: Record<string, number>;
  total: number;
};

async function retentionDays(): Promise<number> {
  try {
    const row = await prisma.appSetting.findUnique({ where: { key: "retentionDays" } });
    const v = row?.value;
    const n = typeof v === "number" ? v : typeof v === "string" ? parseInt(v, 10) : NaN;
    return Number.isFinite(n) && n > 0 ? n : RETENTION_DAYS;
  } catch {
    return RETENTION_DAYS;
  }
}

export async function runRetentionPurge(): Promise<RetentionResult> {
  const days = await retentionDays();
  const cutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
  const purged: Record<string, number> = {};

  // Invoices first, one at a time: hard-deleting an invoice cascades its payments, and each
  // payment has an auto-posted Income mirror that must be removed or it becomes phantom revenue
  // (mirrors the manual purgeInvoice). A plain deleteMany can't do that side effect.
  const invoices = await prisma.invoice.findMany({
    where: { deletedAt: { lt: cutoff } },
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

  const total = Object.values(purged).reduce((a, b) => a + b, 0);
  return { days, cutoff: cutoff.toISOString(), purged, total };
}

/**
 * Growth-table pruning (audit §C #21) — a DIFFERENT concern from runRetentionPurge above, which
 * hard-deletes soft-deleted/archived records past their window. This prunes two tables that only
 * ever grow and are never archived: the WhatsApp message log and expired-and-unaccepted user
 * invites. Append-only audit tables are deliberately excluded (they're trigger-protected and the
 * app derives from them). Gated on maintenanceConfig.retention.enabled — OFF by default because it
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
