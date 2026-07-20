"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { capabilityCheck } from "@/lib/rbac";
import { getTodayInrPerEur } from "@/lib/fx";
import {
  majorStringToMinor,
  minorToMajorString,
  formatInrMinor,
  formatEurMinor,
  formatMonth,
} from "@/lib/format";
import { PAYOUT_STATUS_LABELS } from "@/lib/labels";
import { optionalRule, rule } from "@/lib/field-rules";
import { logActivity, diffFields } from "./activity-log";
import { syncPayoutExpense, type PayoutForSync } from "./finance-autopost";

/** Telecaller Pay is Admin-only (Ameen). Every action re-checks. */

/** Shape a payout row + its person's name into the finance auto-post argument. */
function payoutSyncArg(
  row: {
    id: string; month: Date; bonusInrMinor: bigint; bonusEurMinor: bigint;
    commInrMinor: bigint; commEurMinor: bigint; fxRateUsed: PayoutForSync["fxRateUsed"];
    status: "PENDING" | "PAID";
  },
  vendorName: string,
): PayoutForSync {
  return {
    id: row.id, month: row.month, bonusInrMinor: row.bonusInrMinor, bonusEurMinor: row.bonusEurMinor,
    commInrMinor: row.commInrMinor, commEurMinor: row.commEurMinor, fxRateUsed: row.fxRateUsed,
    status: row.status, vendorName,
  };
}

/** Shared with the browser via lib/field-rules; an empty box is caught by requireSomeAmount below. */
const moneyInput = optionalRule("money");

const payoutSchema = z.object({
  teamProfileId: z.string().min(1, "Choose a telecaller"),
  month: z.string().regex(/^\d{4}-\d{2}$/, "Pick a month"),
  bonusInr: moneyInput,
  bonusEur: moneyInput,
  commInr: moneyInput,
  commEur: moneyInput,
  // Free text: the reason is prose that contains numbers ("hit 40 appointments").
  reason: rule("text").pipe(z.string().min(1, "Add a short reason / criteria")),
  status: z.enum(["PENDING", "PAID"]),
});

export type ActionResult = { ok: true } | { ok: false; error: string };

function firstError(e: z.ZodError): string {
  return e.issues[0]?.message ?? "Invalid input";
}

const minor = (v?: string) => (v?.trim() ? majorStringToMinor(v) : BigInt(0));

/** First day of the given YYYY-MM as a UTC-midnight date (the @db.Date encoding). */
function monthToDate(month: string): Date {
  const [y, m] = month.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, 1));
}

function requireSomeAmount(d: z.infer<typeof payoutSchema>): string | null {
  if (!d.bonusInr?.trim() && !d.bonusEur?.trim() && !d.commInr?.trim() && !d.commEur?.trim()) {
    return "Enter a bonus and/or commission amount";
  }
  return null;
}

type PayoutAmounts = {
  teamProfileId: string;
  month: Date;
  bonusInrMinor: bigint;
  bonusEurMinor: bigint;
  commInrMinor: bigint;
  commEurMinor: bigint;
  reason: string;
  status: string;
};

/** "bonus ₹5,000, commission €120" — what was actually paid, for the feed sentence. */
function amountPhrase(p: PayoutAmounts): string {
  const money = (inr: bigint, eur: bigint) =>
    [inr ? formatInrMinor(inr) : null, eur ? formatEurMinor(eur) : null].filter(Boolean).join(" + ");
  const bonus = money(p.bonusInrMinor, p.bonusEurMinor);
  const comm = money(p.commInrMinor, p.commEurMinor);
  return [bonus ? `bonus ${bonus}` : null, comm ? `commission ${comm}` : null].filter(Boolean).join(", ");
}

/** BigInt and Date have no JSON representation — the diff and meta compare plain strings instead. */
function payoutShape(p: PayoutAmounts) {
  return {
    teamProfileId: p.teamProfileId,
    month: p.month.toISOString().slice(0, 10),
    bonusInr: minorToMajorString(p.bonusInrMinor),
    bonusEur: minorToMajorString(p.bonusEurMinor),
    commInr: minorToMajorString(p.commInrMinor),
    commEur: minorToMajorString(p.commEurMinor),
    reason: p.reason,
    status: p.status,
  };
}

const PAYOUT_FIELD_LABELS: Record<string, string> = {
  teamProfileId: "Telecaller", month: "Month", bonusInr: "Bonus (INR)", bonusEur: "Bonus (EUR)",
  commInr: "Commission (INR)", commEur: "Commission (EUR)", reason: "Reason", status: "Status",
};

function fieldList(changed: string[]): string {
  return changed.map((k) => PAYOUT_FIELD_LABELS[k] ?? k).join(", ");
}

export async function createPayout(form: FormData): Promise<ActionResult> {
  const { allowed, denied, session } = await capabilityCheck("rewards.approve");
  if (!allowed) return denied;
  const parsed = payoutSchema.safeParse(Object.fromEntries(form));
  if (!parsed.success) return { ok: false, error: firstError(parsed.error) };
  const d = parsed.data;
  const amountError = requireSomeAmount(d);
  if (amountError) return { ok: false, error: amountError };

  // Guard the FK so a stale/forged id can't 500 the action.
  const profile = await prisma.teamProfile.findUnique({ where: { id: d.teamProfileId } });
  if (!profile) return { ok: false, error: "That telecaller no longer exists" };

  const fx = await getTodayInrPerEur();
  const row = await prisma.telecallerPayout.create({
    data: {
      teamProfileId: d.teamProfileId,
      month: monthToDate(d.month),
      bonusInrMinor: minor(d.bonusInr),
      bonusEurMinor: minor(d.bonusEur),
      commInrMinor: minor(d.commInr),
      commEurMinor: minor(d.commEur),
      fxRateUsed: fx.rate,
      reason: d.reason,
      status: d.status,
      enteredById: session.user.id,
    },
  });

  await logActivity(session, {
    action: "payout.create",
    section: "telecaller",
    entityType: "TelecallerPayout",
    entityId: row.id,
    summary: `Recorded a ${PAYOUT_STATUS_LABELS[d.status].toLowerCase()} ${formatMonth(row.month)} payout for ${profile.fullName} — ${amountPhrase(row)}`,
    meta: { ...payoutShape(row), teamProfile: profile.fullName, fxRateUsed: String(fx.rate) },
  });

  // Auto-post to Finance: a PAID payout becomes a TEAM_SALARIES expense (user request).
  await syncPayoutExpense(session.user.id, payoutSyncArg(row, profile.fullName), row.id);

  revalidatePath("/telecaller");
  revalidatePath("/finance");
  revalidatePath("/ledger");
  return { ok: true };
}

export async function updatePayout(id: string, form: FormData): Promise<ActionResult> {
  const { allowed, denied, session } = await capabilityCheck("rewards.approve");
  if (!allowed) return denied;
  const parsed = payoutSchema.safeParse(Object.fromEntries(form));
  if (!parsed.success) return { ok: false, error: firstError(parsed.error) };
  const d = parsed.data;
  const amountError = requireSomeAmount(d);
  if (amountError) return { ok: false, error: amountError };

  const existing = await prisma.telecallerPayout.findUnique({
    where: { id },
    include: { teamProfile: { select: { fullName: true } } },
  });
  if (!existing) return { ok: false, error: "Payout not found" };

  const data = {
    teamProfileId: d.teamProfileId,
    month: monthToDate(d.month),
    bonusInrMinor: minor(d.bonusInr),
    bonusEurMinor: minor(d.bonusEur),
    commInrMinor: minor(d.commInr),
    commEurMinor: minor(d.commEur),
    // keep the original stamped rate: edits fix typos, they don't re-price history
    reason: d.reason,
    status: d.status,
  };

  const row = await prisma.telecallerPayout.update({
    where: { id },
    data,
    include: { teamProfile: { select: { fullName: true } } },
  });

  const diff = diffFields(payoutShape(existing), payoutShape(data));
  if (diff.changed.length) {
    await logActivity(session, {
      action: "payout.update",
      section: "telecaller",
      entityType: "TelecallerPayout",
      entityId: id,
      summary: `Edited ${existing.teamProfile.fullName}'s ${formatMonth(existing.month)} payout — changed ${fieldList(diff.changed)}`,
      meta: diff,
    });
  }

  // Keep the auto-posted expense in step with the edit (amount / paid-status / person).
  await syncPayoutExpense(session.user.id, payoutSyncArg(row, row.teamProfile.fullName), id);

  revalidatePath("/telecaller");
  revalidatePath("/finance");
  revalidatePath("/ledger");
  return { ok: true };
}

export async function setPayoutStatus(id: string, status: "PENDING" | "PAID"): Promise<ActionResult> {
  const { allowed, denied, session } = await capabilityCheck("rewards.approve");
  if (!allowed) return denied;
  const before = await prisma.telecallerPayout.findUnique({ where: { id }, select: { status: true } });
  const row = await prisma.telecallerPayout.update({
    where: { id },
    data: { status },
    include: { teamProfile: { select: { fullName: true } } },
  });

  const diff = diffFields({ status: before?.status ?? null }, { status: row.status });
  if (diff.changed.length) {
    await logActivity(session, {
      action: "payout.update",
      section: "telecaller",
      entityType: "TelecallerPayout",
      entityId: row.id,
      summary: `Marked ${row.teamProfile.fullName}'s ${formatMonth(row.month)} payout as ${PAYOUT_STATUS_LABELS[status]}`,
      meta: { ...diff, amounts: amountPhrase(row) },
    });
  }

  // PAID ⇒ post the expense; back to PENDING ⇒ remove it. syncPayoutExpense handles both.
  await syncPayoutExpense(session.user.id, payoutSyncArg(row, row.teamProfile.fullName), row.id);

  revalidatePath("/telecaller");
  revalidatePath("/finance");
  revalidatePath("/ledger");
  return { ok: true };
}

export async function deletePayout(id: string): Promise<ActionResult> {
  const { allowed, denied, session } = await capabilityCheck("rewards.approve");
  if (!allowed) return denied;
  const row = await prisma.telecallerPayout.delete({
    where: { id },
    include: { teamProfile: { select: { fullName: true } } },
  });
  // Remove the auto-posted expense that mirrored this payout.
  await syncPayoutExpense(session.user.id, null, row.id);
  await logActivity(session, {
    action: "payout.delete",
    section: "telecaller",
    entityType: "TelecallerPayout",
    entityId: row.id,
    summary: `Deleted ${row.teamProfile.fullName}'s ${formatMonth(row.month)} payout — ${amountPhrase(row)}`,
    meta: payoutShape(row),
  });
  revalidatePath("/telecaller");
  revalidatePath("/finance");
  revalidatePath("/ledger");
  return { ok: true };
}
