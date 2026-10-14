"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { capabilityCheck } from "@/lib/rbac";
import { formatEurMinor, formatInrMinor, majorStringToMinor } from "@/lib/format";
import { optionalRule } from "@/lib/field-rules";
import { logActivity, diffFields } from "./activity-log";
import type { ActionResult } from "./finance-actions";

/**
 * What a team member is paid in a normal month, set from where the money is actually recorded.
 *
 * ── Why this is not only on the People screen ─────────────────────────────────────
 * The figure also lives on the team profile (People → Team & org chart), which is its natural
 * home - it is a fact about the person's employment, not about one payment. But the moment
 * anybody NEEDS it is the moment they are paying somebody in Finance, and sending them to
 * another section to type one number is how the field stays empty and the amount goes on being
 * re-typed from memory every month.
 *
 * Both write the same two columns, so there is one figure and no second place for it to drift.
 *
 * ── Why finance.write and not admin ───────────────────────────────────────────────
 * This is a money figure on a money screen, gated like every other money write. Creating or
 * retiring the PROFILE is still an admin act on the People screen; this only prices one.
 */

const paySchema = z.object({
  monthlyPayInr: optionalRule("money"),
  monthlyPayEur: optionalRule("money"),
});

export async function setTeamMonthlyPay(profileId: string, form: FormData): Promise<ActionResult> {
  const { allowed, denied, session } = await capabilityCheck("finance.write");
  if (!allowed) return denied;
  const parsed = paySchema.safeParse(Object.fromEntries(form));
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid amount" };
  }
  const d = parsed.data;

  const before = await prisma.teamProfile.findUnique({
    where: { id: profileId },
    select: { id: true, fullName: true, monthlyPayInrMinor: true, monthlyPayEurMinor: true },
  });
  if (!before) return { ok: false, error: "That team member no longer exists" };

  // Blank clears the figure rather than leaving the old one: "no monthly pay agreed" is a real
  // answer - a tutor paid per batch, somebody on commission - and it has to be sayable.
  const data = {
    monthlyPayInrMinor: d.monthlyPayInr?.trim() ? majorStringToMinor(d.monthlyPayInr) : BigInt(0),
    monthlyPayEurMinor: d.monthlyPayEur?.trim() ? majorStringToMinor(d.monthlyPayEur) : BigInt(0),
  };
  await prisma.teamProfile.update({ where: { id: profileId }, data });

  const diff = diffFields(
    {
      monthlyPayInrMinor: before.monthlyPayInrMinor.toString(),
      monthlyPayEurMinor: before.monthlyPayEurMinor.toString(),
    },
    {
      monthlyPayInrMinor: data.monthlyPayInrMinor.toString(),
      monthlyPayEurMinor: data.monthlyPayEurMinor.toString(),
    },
  );
  if (diff.changed.length) {
    const shown =
      [
        data.monthlyPayInrMinor > BigInt(0) ? formatInrMinor(data.monthlyPayInrMinor) : "",
        data.monthlyPayEurMinor > BigInt(0) ? formatEurMinor(data.monthlyPayEurMinor) : "",
      ]
        .filter(Boolean)
        .join(" + ") || "nothing";
    await logActivity(session, {
      action: "finance.teamPay.update",
      section: "finance",
      entityType: "TeamProfile",
      entityId: profileId,
      // Says what it changes and what it does NOT: nothing already paid is restated.
      summary: `Set ${before.fullName}'s agreed monthly pay to ${shown}`,
      meta: { ...diff },
    });
  }

  revalidatePath("/finance");
  revalidatePath("/people");
  return { ok: true };
}
