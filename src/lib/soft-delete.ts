/**
 * Soft-delete ("delete → Archive") helpers shared by the 10 core record types:
 * Lead, Company, Opportunity, ContactTask, Income, Expense, Invoice,
 * PendingPayment, Product, Improvement.
 *
 * `Improvement` is the newest and the clearest case for the pattern: a report declined as
 * "we are not changing this" is the most valuable row in that table six months later, when
 * somebody proposes the same change again. It leaves every queue and stays readable.
 *
 * A delete stamps `deletedAt`/`deletedById`; active list/count reads spread
 * `ACTIVE` into their `where`; the per-section "Archived" tab reads with
 * `ARCHIVED`. We filter explicitly per query (no Prisma middleware / `$extends`)
 * to match the house style - the same pattern the Automation/Workflow feature
 * already uses (it was introduced for `server/automation-metrics.ts`, since removed).
 */

/** Spread into an active list/count/dropdown `where` to exclude archived rows. */
export const ACTIVE = { deletedAt: null } as const;

/** `where` for the Archived tab and the retention sweep - archived rows only. */
export const ARCHIVED = { deletedAt: { not: null } } as const;

/**
 * ════════════════════════════════════════════════════════════════════════════════════════════
 *  MONEY THAT ACTUALLY ARRIVED  (issue C2)
 * ════════════════════════════════════════════════════════════════════════════════════════════
 *
 * `ACTIVE` is not enough for `Income`, because an income row can now fail in TWO different ways
 * and they are not the same fact:
 *
 *   `deletedAt`   archived - "this row should not have been entered". A mis-entry, a duplicate.
 *   `reversedAt`  reversed - "it was entered correctly and the money went away again". A bounced
 *                 cheque, a reversed UPI, a recalled transfer.
 *
 * Both mean the money is not there, so both must leave every total. They are stored separately
 * because only the second is a fact about the bank, and only the second re-opens the dunning
 * ladder (see `Instalment.dunningCycle`) - conflating them would either chase a student over a
 * typo or stop chasing one whose payment bounced.
 *
 * ── SPREAD THIS, NOT `ACTIVE`, INTO ANY SUM OF RECEIVED MONEY ───────────────────────────────
 * Thirty-one call sites read `income`. `src/server/__tests__/paid-so-far-excludes-archived.test.ts`
 * reads this file's source and FAILS the suite for any per-student money total that omits it -
 * which is the only reason to believe a rule spread across thirty-one queries by hand. That
 * guard was written when the same thing happened with `deletedAt` and two screens disagreed
 * about whether a student had paid; it now covers both columns.
 *
 * Reads that are not about money received - counting rows, listing the archive, the retention
 * sweep - keep using `ACTIVE`.
 */
export const INCOME_COUNTABLE = { deletedAt: null, reversedAt: null } as const;

/** `where` for the reversals list: money that appeared to arrive and then did not. */
export const INCOME_REVERSED = { deletedAt: null, reversedAt: { not: null } } as const;

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
