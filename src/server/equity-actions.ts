"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { capabilityCheck } from "@/lib/rbac";
import { istToday, parseDateInput } from "@/lib/dates";
import { formatDate, formatEurMinor, formatInrMinor, majorStringToMinor } from "@/lib/format";
import { optionalRule, rule } from "@/lib/field-rules";
import { getInrPerEurOn } from "@/lib/fx";
import { isMoneyAccount } from "@/lib/chart-of-accounts";
import { LedgerError, postEntry, restatedDate, voidEntryForSource } from "./ledger";
import { equityEntryDraft } from "./finance-posting";
import { logActivity, diffFields } from "./activity-log";
import type { ActionResult } from "./finance-actions";

/**
 * OWNER'S EQUITY - money the owners put into the business, and take back out.
 *
 * ── What this replaces ────────────────────────────────────────────────────────────
 * One nullable column on the weekly cash position: `personalSavingsInrMinor`, labelled "planning
 * only" and excluded from runway and from every other figure. It could not say whose money it
 * was, when it went in, whether it was still in, or whether it was a contribution at all rather
 * than a balance sitting in somebody's personal account. With a second person contributing it
 * could say nothing whatsoever.
 *
 * ── Two rules, and they are the whole design ──────────────────────────────────────
 * 1. IT IS NOT REVENUE. A contribution credits Owner's equity (3000), never an income account.
 *    Equity reaching the P&L would inflate revenue, gross and net profit, margin, commission
 *    (a percentage of payments) and every growth rate derived from them - silently, because the
 *    books would still balance.
 * 2. IT IS NOT ADDED TO CASH IN HAND. That figure is the bank balance the founder types each
 *    Monday, so contributed money is already inside it. Adding it again would double it. The
 *    ledger is where this entry has its effect.
 *
 * ── Why posting is best-effort ────────────────────────────────────────────────────
 * The entry the founder typed is the thing being recorded. A closed period or an unseeded chart
 * of accounts must not throw their entry away, so a refused posting leaves `postedEntryId` null
 * and the row stands - the same discipline the tutor-fee accrual uses. The reason is returned,
 * not swallowed, so "recorded but not posted" is something they are told rather than something
 * they discover in the trial balance.
 */

function firstError(e: z.ZodError): string {
  return e.issues[0]?.message ?? "Invalid input";
}

const money = optionalRule("money");

const entrySchema = z.object({
  date: z.string().min(10, "Pick a date"),
  // A contributor is a person, so `name` rules apply - unlike a vendor, which may be "3M".
  contributorName: rule("name"),
  kind: z.enum(["CONTRIBUTION", "DRAWING"]),
  amountInr: money,
  amountEur: money,
  accountCode: z.string().trim().min(1, "Pick where the money moved"),
  notes: optionalRule("text"),
});

/** Zero is not an amount - see the matching guard in finance-actions (issue 16). */
function requireSomeAmount(inr?: string, eur?: string): string | null {
  if (!inr?.trim() && !eur?.trim()) return "Enter an amount in INR, EUR, or both";
  const zeroish = (v?: string) => !v?.trim() || majorStringToMinor(v) === BigInt(0);
  if (zeroish(inr) && zeroish(eur)) return "Enter an amount greater than 0";
  return null;
}

const amountPhrase = (inrMinor: bigint, eurMinor: bigint): string =>
  [
    inrMinor > BigInt(0) ? formatInrMinor(inrMinor) : "",
    eurMinor > BigInt(0) ? formatEurMinor(eurMinor) : "",
  ]
    .filter(Boolean)
    .join(" + ") || formatInrMinor(BigInt(0));

/** Diff shape: amounts as strings, because `diffFields` JSON-compares. */
function diffShape(row: {
  date: Date;
  contributorName: string;
  kind: string;
  amountInrMinor: bigint;
  amountEurMinor: bigint;
  accountCode: string;
  notes: string | null;
}) {
  return {
    date: row.date,
    contributorName: row.contributorName,
    kind: row.kind,
    amountInrMinor: row.amountInrMinor.toString(),
    amountEurMinor: row.amountEurMinor.toString(),
    accountCode: row.accountCode,
    notes: row.notes,
  };
}

export async function createEquityEntry(form: FormData): Promise<ActionResult> {
  const { allowed, denied, session } = await capabilityCheck("finance.write");
  if (!allowed) return denied;
  const parsed = entrySchema.safeParse(Object.fromEntries(form));
  if (!parsed.success) return { ok: false, error: firstError(parsed.error) };
  const d = parsed.data;
  const amountError = requireSomeAmount(d.amountInr, d.amountEur);
  if (amountError) return { ok: false, error: amountError };
  if (!isMoneyAccount(d.accountCode)) {
    return { ok: false, error: "Pick one of the bank or cash accounts" };
  }

  const date = parseDateInput(d.date);
  // The rate for the day the money moved, not today's - the same rule income and expenses use,
  // so what somebody put in never changes when the euro does.
  const fx = await getInrPerEurOn(date);

  const row = await prisma.equityContribution.create({
    data: {
      date,
      contributorName: d.contributorName,
      kind: d.kind,
      amountInrMinor: d.amountInr?.trim() ? majorStringToMinor(d.amountInr) : BigInt(0),
      amountEurMinor: d.amountEur?.trim() ? majorStringToMinor(d.amountEur) : BigInt(0),
      fxRateUsed: fx.rate,
      accountCode: d.accountCode,
      notes: d.notes || null,
      enteredById: session.user.id,
    },
  });

  const posting = await postEquity(row);

  await logActivity(session, {
    action: "cash.equity.create",
    section: "cash",
    entityType: "EquityContribution",
    entityId: row.id,
    summary: `${d.kind === "CONTRIBUTION" ? "Recorded" : "Recorded a drawing of"} ${amountPhrase(row.amountInrMinor, row.amountEurMinor)} ${
      d.kind === "CONTRIBUTION" ? `put in by ${row.contributorName}` : `taken by ${row.contributorName}`
    } on ${formatDate(row.date)}`,
    meta: {
      kind: row.kind,
      amountInrMinor: row.amountInrMinor.toString(),
      amountEurMinor: row.amountEurMinor.toString(),
      accountCode: row.accountCode,
      posted: posting === null,
      // The refusal, when there was one - so a gap in the trial balance has a reason on record.
      postingRefusedBecause: posting,
    },
  });

  revalidatePath("/cash");
  /**
   * SUCCESS EVEN IF THE LEDGER REFUSED. The entry the founder typed is recorded, and returning
   * an error for it would leave their numbers sitting in the form - where the natural next move
   * is to press Save again and create a second entry for the same money. An unposted row is
   * instead flagged "not posted" in the table, which says the same thing without risking a
   * duplicate.
   */
  return { ok: true };
}

export async function updateEquityEntry(id: string, form: FormData): Promise<ActionResult> {
  const { allowed, denied, session } = await capabilityCheck("finance.write");
  if (!allowed) return denied;
  const parsed = entrySchema.safeParse(Object.fromEntries(form));
  if (!parsed.success) return { ok: false, error: firstError(parsed.error) };
  const d = parsed.data;
  const amountError = requireSomeAmount(d.amountInr, d.amountEur);
  if (amountError) return { ok: false, error: amountError };
  if (!isMoneyAccount(d.accountCode)) {
    return { ok: false, error: "Pick one of the bank or cash accounts" };
  }

  const before = await prisma.equityContribution.findUnique({ where: { id } });
  if (!before) return { ok: false, error: "That entry no longer exists" };

  const date = parseDateInput(d.date);
  const fx = await getInrPerEurOn(date);
  const row = await prisma.equityContribution.update({
    where: { id },
    data: {
      date,
      contributorName: d.contributorName,
      kind: d.kind,
      amountInrMinor: d.amountInr?.trim() ? majorStringToMinor(d.amountInr) : BigInt(0),
      amountEurMinor: d.amountEur?.trim() ? majorStringToMinor(d.amountEur) : BigInt(0),
      fxRateUsed: fx.rate,
      accountCode: d.accountCode,
      notes: d.notes || null,
    },
  });

  // Reverse and re-post, exactly as editing an expense does: the old entry is VOIDED (never
  // deleted) and the correction is a new entry, so the ledger reads as a history of what was
  // believed and when, not as a figure that silently changed.
  const posting = await repostEquity(row, session.user.id);

  const diff = diffFields(diffShape(before), diffShape(row));
  if (diff.changed.length || posting) {
    await logActivity(session, {
      action: "cash.equity.update",
      section: "cash",
      entityType: "EquityContribution",
      entityId: id,
      summary: `Edited ${row.contributorName}'s equity entry of ${amountPhrase(row.amountInrMinor, row.amountEurMinor)}`,
      meta: { ...diff, postingRefusedBecause: posting },
    });
  }

  revalidatePath("/cash");
  // Saved either way - see the note in `createEquityEntry`. The row flags an unposted edit.
  return { ok: true };
}

/**
 * Archive, not delete. A capital entry is evidence of where the money came from, and the 90-day
 * retention cron deliberately does not reach this table - `deletedAt` here means "withdrawn from
 * the books", and the ledger entry is voided with it so the trial balance agrees.
 */
export async function archiveEquityEntry(id: string): Promise<ActionResult> {
  const { allowed, denied, session } = await capabilityCheck("finance.write");
  if (!allowed) return denied;
  const row = await prisma.equityContribution.findUnique({ where: { id } });
  if (!row) return { ok: false, error: "That entry no longer exists" };
  if (row.deletedAt) return { ok: true };

  try {
    await prisma.$transaction(async (tx) => {
      await voidEntryForSource(tx, "EQUITY", id, {
        reason: "equity entry archived",
        actorId: session.user.id,
        on: istToday(),
      });
      await tx.equityContribution.update({
        where: { id },
        data: { deletedAt: new Date(), deletedById: session.user.id, postedEntryId: null },
      });
    });
  } catch (err) {
    if (err instanceof LedgerError) return { ok: false, error: err.message };
    throw err;
  }

  await logActivity(session, {
    action: "cash.equity.archive",
    section: "cash",
    entityType: "EquityContribution",
    entityId: id,
    summary: `Archived ${row.contributorName}'s equity entry of ${amountPhrase(row.amountInrMinor, row.amountEurMinor)}`,
    meta: { kind: row.kind, amountInrMinor: row.amountInrMinor.toString() },
  });

  revalidatePath("/cash");
  return { ok: true };
}

export async function restoreEquityEntry(id: string): Promise<ActionResult> {
  const { allowed, denied, session } = await capabilityCheck("finance.write");
  if (!allowed) return denied;
  const row = await prisma.equityContribution.findUnique({ where: { id } });
  if (!row) return { ok: false, error: "That entry no longer exists" };

  const restored = await prisma.equityContribution.update({
    where: { id },
    data: { deletedAt: null, deletedById: null },
  });
  // Back on the books means back in the ledger - an entry restored without re-posting would show
  // in the section's totals and nowhere in the trial balance.
  const posting = await postEquity(restored);

  await logActivity(session, {
    action: "cash.equity.restore",
    section: "cash",
    entityType: "EquityContribution",
    entityId: id,
    summary: `Restored ${row.contributorName}'s equity entry of ${amountPhrase(row.amountInrMinor, row.amountEurMinor)}`,
    meta: { kind: row.kind, postingRefusedBecause: posting },
  });

  revalidatePath("/cash");
  return { ok: true };
}

type EquityRow = {
  id: string;
  date: Date;
  contributorName: string;
  kind: "CONTRIBUTION" | "DRAWING";
  amountInrMinor: bigint;
  amountEurMinor: bigint;
  fxRateUsed: import("@prisma/client").Prisma.Decimal;
  accountCode: string;
  enteredById: string | null;
};

/**
 * Post an entry, returning the REASON it could not be posted (null on success).
 *
 * A LedgerError is a refusal the founder can act on - a closed period, an unseeded chart of
 * accounts - and must not undo the row. Anything else is a real fault and is rethrown rather
 * than reported as a tidy "not posted".
 */
async function postEquity(row: EquityRow): Promise<string | null> {
  try {
    await prisma.$transaction(async (tx) => {
      const entryId = await postEntry(tx, equityEntryDraft(row));
      await tx.equityContribution.update({ where: { id: row.id }, data: { postedEntryId: entryId } });
    });
    return null;
  } catch (err) {
    if (err instanceof LedgerError) return err.message;
    // Anything else is a real fault, not a refusal - let it surface rather than reporting a
    // half-truth about the ledger. The row itself is already saved.
    throw err;
  }
}

/** Void the previous entry and post the corrected one, keeping a closed month's date (restatedDate). */
async function repostEquity(row: EquityRow, actorId: string): Promise<string | null> {
  try {
    await prisma.$transaction(async (tx) => {
      const voided = await voidEntryForSource(tx, "EQUITY", row.id, {
        reason: "equity entry edited",
        actorId,
        on: istToday(),
      });
      const draft = equityEntryDraft(row);
      const entryId = await postEntry(tx, { ...draft, date: restatedDate(voided, draft.date) });
      await tx.equityContribution.update({ where: { id: row.id }, data: { postedEntryId: entryId } });
    });
    return null;
  } catch (err) {
    if (err instanceof LedgerError) return err.message;
    throw err;
  }
}

