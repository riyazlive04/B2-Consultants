/**
 * Soft-delete ("delete → Archive") helpers shared by the 9 core record types:
 * Lead, Company, Opportunity, ContactTask, Income, Expense, Invoice,
 * PendingPayment, Product.
 *
 * A delete stamps `deletedAt`/`deletedById`; active list/count reads spread
 * `ACTIVE` into their `where`; the per-section "Archived" tab reads with
 * `ARCHIVED`. We filter explicitly per query (no Prisma middleware / `$extends`)
 * to match the house style — the same pattern the Automation/Workflow feature
 * already uses (`src/server/automation-metrics.ts`).
 */

/** Spread into an active list/count/dropdown `where` to exclude archived rows. */
export const ACTIVE = { deletedAt: null } as const;

/** `where` for the Archived tab and the retention sweep — archived rows only. */
export const ARCHIVED = { deletedAt: { not: null } } as const;

/** `data` payload that archives (soft-deletes) a row, recording who did it. */
export function archiveData(userId?: string | null) {
  return { deletedAt: new Date(), deletedById: userId ?? null };
}

/** `data` payload that restores an archived row to active. */
export const restoreData = { deletedAt: null, deletedById: null } as const;

/**
 * Default retention window (issue 7.4): archived rows older than this are
 * permanently purged by the retention cron. Overridable via the `retentionDays`
 * AppSetting at run time.
 */
export const RETENTION_DAYS = 90;

/** Rows archived before this cutoff are eligible for permanent purge. */
export function retentionCutoff(days: number = RETENTION_DAYS): Date {
  return new Date(Date.now() - days * 24 * 60 * 60 * 1000);
}
