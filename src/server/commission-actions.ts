"use server";

import { revalidatePath } from "next/cache";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { capabilityCheck } from "@/lib/rbac";
import { istToday } from "@/lib/dates";
import { formatInrMinor } from "@/lib/format";
import { ACCOUNT, expenseAccountFor } from "@/lib/chart-of-accounts";
import { postEntryOnce, voidEntryForSource, type DraftEntry } from "./ledger";
import { getCommissionReport } from "./commission-metrics";
import { getExpenseCategoriesConfig, getFinancePostingConfig } from "./founder-config";
import { expenseAccountMap } from "@/lib/expense-categories";
import { logActivity } from "./activity-log";
import type { ActionResult } from "./finance-actions";

/**
 * Commission payout runs (audit §C #23).
 *
 * getCommissionReport computes the deal-team split per payment at read time, but nothing ever
 * RECORDED a run or posted the expense - the founder read a screen and paid out of band. This
 * turns "run this month's payout" into one click that:
 *   1. snapshots the month's per-person totals into a CommissionPayoutRun (unique per month), and
 *   2. optionally ACCRUES it to the ledger - Dr Team-salaries / Cr Accounts-payable - so the P&L
 *      recognises the commission and the payable is on the books.
 *
 * It is ADMIN-triggered (finance.write), never a cron: a human clicking is the sign-off, and money
 * never moves on a schedule. The accrual is Dr expense / Cr AP, NOT Cr cash - it asserts the cost
 * is owed, not that it was paid, so recording a run can't overstate the bank. The ledger half is
 * additionally gated on financePosting.commissionAccrual (OFF by default); with it off the run is
 * still recorded as a snapshot, just not posted. Idempotent per month.
 */

const ONE = new Prisma.Decimal(1);

/** "YYYY-MM" → the UTC-midnight first-of-month Date the model keys on. */
function monthKeyToDate(key: string): Date {
  const [y, m] = key.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, 1));
}

const COMMISSION_SOURCE = (monthKey: string) => `commission:${monthKey}`;

export async function runCommissionPayout(): Promise<ActionResult> {
  const { allowed, denied, session } = await capabilityCheck("finance.write");
  if (!allowed) return denied;

  const report = await getCommissionReport();
  const monthKey = report.month; // "YYYY-MM"
  const monthDate = monthKeyToDate(monthKey);
  const totalInrMinor = BigInt(report.totals.reduce((s, t) => s + t.amountInrMinor, 0));
  const lines = report.totals.map((t) => ({ name: t.name, amountInrMinor: t.amountInrMinor, deals: t.deals }));

  // What the snapshot said BEFORE this run - the figure the ledger was posted against, if it
  // was. Read ahead of the upsert because the upsert overwrites it.
  const before = await prisma.commissionPayoutRun.findUnique({
    where: { month: monthDate },
    select: { totalInrMinor: true, postedEntryId: true },
  });

  // 1. Record the snapshot first - it is the primary artefact and must survive even if the
  //    optional ledger posting later fails (e.g. an unseeded chart of accounts).
  const run = await prisma.commissionPayoutRun.upsert({
    where: { month: monthDate },
    create: {
      month: monthDate,
      totalInrMinor,
      lines: lines as unknown as Prisma.InputJsonValue,
      createdById: session.user.id,
    },
    update: {
      totalInrMinor,
      lines: lines as unknown as Prisma.InputJsonValue,
      createdById: session.user.id,
    },
  });

  /**
   * ── RE-RECORDING A RUN HAS TO RESTATE THE LEDGER, NOT JUST THE SNAPSHOT ──────────────────
   *
   * This action is idempotent per month by `upsert`, so running it again after a late payment or
   * a rate change rewrites the snapshot with a new total. The ledger did not follow:
   * `postEntryOnce` is idempotent on `sourceId` and returns null when a live entry already
   * exists, so the second run updated `lines` and `totalInrMinor` while the books kept the FIRST
   * amount. The screen and the accounts then disagreed about what the team was owed, with
   * nothing saying which was right.
   *
   * So a changed total voids the old entry before posting the new one - the same
   * `voidEntryForSource` the explicit void path uses, which keeps the reversal inside the
   * original's own period (see `voidEntry`). An unchanged total touches nothing: re-recording an
   * identical run must not churn the journal.
   */
  const totalChanged = before !== undefined && before !== null && before.totalInrMinor !== totalInrMinor;
  if (totalChanged && before.postedEntryId) {
    try {
      await prisma.$transaction((tx) =>
        voidEntryForSource(tx, "MANUAL", COMMISSION_SOURCE(monthKey), {
          reason: `commission payout run re-recorded - ${formatInrMinor(before.totalInrMinor)} → ${formatInrMinor(totalInrMinor)}`,
          actorId: session.user.id,
          on: istToday(),
        }),
      );
      // The snapshot's pointer goes with it, so the re-post below is not mistaken for a no-op.
      await prisma.commissionPayoutRun.update({ where: { id: run.id }, data: { postedEntryId: null } });
      run.postedEntryId = null;
    } catch {
      // Leave the old entry standing rather than losing the new snapshot. The post below will
      // find a live entry and decline, which is the same state as before this fix - not worse.
    }
  }

  // 2. Optionally accrue to the ledger.
  const cfg = await getFinancePostingConfig();
  let postedEntryId: string | null = run.postedEntryId;
  if (cfg.commissionAccrual.enabled && totalInrMinor > 0n) {
    try {
      const draft: DraftEntry = {
        date: istToday(),
        narration: `Commission owed - ${monthKey}`,
        sourceType: "MANUAL",
        sourceId: COMMISSION_SOURCE(monthKey),
        postedById: session.user.id,
        lines: [
          // Through the founder's mapping, so commission accrues to whichever P&L line team pay
          // posts to - re-pointing the category must move both halves or they would disagree.
          { accountCode: expenseAccountFor("TEAM_SALARIES", expenseAccountMap(await getExpenseCategoriesConfig())), side: "debit", amountMinor: totalInrMinor, currency: "INR", fxRate: ONE, isCogs: false },
          { accountCode: ACCOUNT.PAYABLE, side: "credit", amountMinor: totalInrMinor, currency: "INR", fxRate: ONE },
        ],
      };
      const entryId = await prisma.$transaction((tx) => postEntryOnce(tx, { ...draft, sourceId: COMMISSION_SOURCE(monthKey) }));
      if (entryId) {
        postedEntryId = entryId;
        await prisma.commissionPayoutRun.update({ where: { id: run.id }, data: { postedEntryId: entryId } });
      }
    } catch {
      // Leave the snapshot recorded, posting withheld - never fail the run over an accounting hiccup.
    }
  }

  await logActivity(session, {
    action: "finance.commission.payout",
    section: "finance",
    entityType: "CommissionPayoutRun",
    entityId: run.id,
    summary: `${before ? "Re-recorded" : "Recorded"} the ${monthKey} commission payout - ${formatInrMinor(totalInrMinor)} across ${lines.length} ${lines.length === 1 ? "person" : "people"}${postedEntryId ? " (recorded as owed in the ledger)" : ""}`,
    meta: {
      month: monthKey,
      totalInrMinor: totalInrMinor.toString(),
      people: lines.length,
      posted: Boolean(postedEntryId),
      // A re-record that moved the figure is the case worth being able to find afterwards.
      ...(totalChanged ? { restatedFromInrMinor: before.totalInrMinor.toString() } : {}),
    },
  });

  revalidatePath("/finance");
  revalidatePath("/console");
  return { ok: true };
}

/** Reverse a payout run: void its accrual (if any) and drop the snapshot. */
export async function voidCommissionPayout(runId: string): Promise<ActionResult> {
  const { allowed, denied, session } = await capabilityCheck("finance.write");
  if (!allowed) return denied;

  const run = await prisma.commissionPayoutRun.findUnique({ where: { id: runId } });
  if (!run) return { ok: false, error: "Payout run not found" };
  const monthKey = run.month.toISOString().slice(0, 7);

  if (run.postedEntryId) {
    try {
      await prisma.$transaction((tx) =>
        voidEntryForSource(tx, "MANUAL", COMMISSION_SOURCE(monthKey), {
          reason: "commission payout run voided",
          actorId: session.user.id,
          on: istToday(),
        }),
      );
    } catch {
      // best-effort - proceed to drop the snapshot regardless
    }
  }
  await prisma.commissionPayoutRun.delete({ where: { id: runId } });

  await logActivity(session, {
    action: "finance.commission.void",
    section: "finance",
    entityType: "CommissionPayoutRun",
    entityId: runId,
    summary: `Voided the ${monthKey} commission payout run`,
    meta: { month: monthKey },
  });

  revalidatePath("/finance");
  revalidatePath("/console");
  return { ok: true };
}
