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
import { getFinancePostingConfig } from "./founder-config";
import { logActivity } from "./activity-log";
import type { ActionResult } from "./finance-actions";

/**
 * Commission payout runs (audit §C #23).
 *
 * getCommissionReport computes the deal-team split per payment at read time, but nothing ever
 * RECORDED a run or posted the expense — the founder read a screen and paid out of band. This
 * turns "run this month's payout" into one click that:
 *   1. snapshots the month's per-person totals into a CommissionPayoutRun (unique per month), and
 *   2. optionally ACCRUES it to the ledger — Dr Team-salaries / Cr Accounts-payable — so the P&L
 *      recognises the commission and the payable is on the books.
 *
 * It is ADMIN-triggered (finance.write), never a cron: a human clicking is the sign-off, and money
 * never moves on a schedule. The accrual is Dr expense / Cr AP, NOT Cr cash — it asserts the cost
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

  // 1. Record the snapshot first — it is the primary artefact and must survive even if the
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

  // 2. Optionally accrue to the ledger.
  const cfg = await getFinancePostingConfig();
  let postedEntryId: string | null = run.postedEntryId;
  if (cfg.commissionAccrual.enabled && totalInrMinor > 0n) {
    try {
      const draft: DraftEntry = {
        date: istToday(),
        narration: `Commission accrual — ${monthKey}`,
        sourceType: "MANUAL",
        sourceId: COMMISSION_SOURCE(monthKey),
        postedById: session.user.id,
        lines: [
          { accountCode: expenseAccountFor("TEAM_SALARIES"), side: "debit", amountMinor: totalInrMinor, currency: "INR", fxRate: ONE, isCogs: false },
          { accountCode: ACCOUNT.PAYABLE, side: "credit", amountMinor: totalInrMinor, currency: "INR", fxRate: ONE },
        ],
      };
      const entryId = await prisma.$transaction((tx) => postEntryOnce(tx, { ...draft, sourceId: COMMISSION_SOURCE(monthKey) }));
      if (entryId) {
        postedEntryId = entryId;
        await prisma.commissionPayoutRun.update({ where: { id: run.id }, data: { postedEntryId: entryId } });
      }
    } catch {
      // Leave the snapshot recorded, posting withheld — never fail the run over an accounting hiccup.
    }
  }

  await logActivity(session, {
    action: "finance.commission.payout",
    section: "finance",
    entityType: "CommissionPayoutRun",
    entityId: run.id,
    summary: `Recorded the ${monthKey} commission payout — ${formatInrMinor(totalInrMinor)} across ${lines.length} ${lines.length === 1 ? "person" : "people"}${postedEntryId ? " (accrued to the ledger)" : ""}`,
    meta: { month: monthKey, totalInrMinor: totalInrMinor.toString(), people: lines.length, posted: Boolean(postedEntryId) },
  });

  revalidatePath("/finance");
  revalidatePath("/ledger");
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
      // best-effort — proceed to drop the snapshot regardless
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
  revalidatePath("/ledger");
  revalidatePath("/console");
  return { ok: true };
}
