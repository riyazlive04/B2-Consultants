"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { capabilityCheck } from "@/lib/rbac";
import { getTodayInrPerEur } from "@/lib/fx";
import { majorStringToMinor } from "@/lib/format";

/** Telecaller Pay is Admin-only (Ameen). Every action re-checks. */

const moneyInput = z
  .string()
  .trim()
  .regex(/^\d{0,12}(\.\d{0,2})?$/, "Enter a plain amount like 5000 or 5000.50")
  .optional()
  .or(z.literal(""));

const payoutSchema = z.object({
  teamProfileId: z.string().min(1, "Choose a telecaller"),
  month: z.string().regex(/^\d{4}-\d{2}$/, "Pick a month"),
  bonusInr: moneyInput,
  bonusEur: moneyInput,
  commInr: moneyInput,
  commEur: moneyInput,
  reason: z.string().trim().min(1, "Add a short reason / criteria"),
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
  await prisma.telecallerPayout.create({
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
  revalidatePath("/telecaller");
  return { ok: true };
}

export async function updatePayout(id: string, form: FormData): Promise<ActionResult> {
  const { allowed, denied } = await capabilityCheck("rewards.approve");
  if (!allowed) return denied;
  const parsed = payoutSchema.safeParse(Object.fromEntries(form));
  if (!parsed.success) return { ok: false, error: firstError(parsed.error) };
  const d = parsed.data;
  const amountError = requireSomeAmount(d);
  if (amountError) return { ok: false, error: amountError };

  const existing = await prisma.telecallerPayout.findUnique({ where: { id } });
  if (!existing) return { ok: false, error: "Payout not found" };

  await prisma.telecallerPayout.update({
    where: { id },
    data: {
      teamProfileId: d.teamProfileId,
      month: monthToDate(d.month),
      bonusInrMinor: minor(d.bonusInr),
      bonusEurMinor: minor(d.bonusEur),
      commInrMinor: minor(d.commInr),
      commEurMinor: minor(d.commEur),
      // keep the original stamped rate: edits fix typos, they don't re-price history
      reason: d.reason,
      status: d.status,
    },
  });
  revalidatePath("/telecaller");
  return { ok: true };
}

export async function setPayoutStatus(id: string, status: "PENDING" | "PAID"): Promise<ActionResult> {
  const { allowed, denied } = await capabilityCheck("rewards.approve");
  if (!allowed) return denied;
  await prisma.telecallerPayout.update({ where: { id }, data: { status } });
  revalidatePath("/telecaller");
  return { ok: true };
}

export async function deletePayout(id: string): Promise<ActionResult> {
  const { allowed, denied } = await capabilityCheck("rewards.approve");
  if (!allowed) return denied;
  await prisma.telecallerPayout.delete({ where: { id } });
  revalidatePath("/telecaller");
  return { ok: true };
}
