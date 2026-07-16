"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requireSection } from "@/lib/rbac";
import type { ActionResult } from "./finance-actions";

/**
 * Per-dial call logging — the fact behind the telecaller desk.
 *
 * Before this, "calls made" existed only as a DailyLog number the telecaller typed in at the
 * end of the day: an aggregate, self-reported, and unlinked to any lead. Nothing recorded that
 * a specific person rang a specific number, so "which of my leads still need a call today?"
 * had no answer. Each row here is one dial.
 *
 * Append-only, like DailyLog: a mis-logged call is corrected by logging another, never by
 * editing history — the counts a bonus is paid on must not be silently rewritable. Deletion is
 * Admin-only and exists for genuine mistakes (a test row, a double-tap), not for tidying.
 *
 * Gate: `pipeline` — the section Asma/Nilofer already have for lead work. A telecaller can log
 * a call against any lead they can see; the row stamps who they are from the session, never
 * from the form, so a call can't be logged in someone else's name.
 */

const CALL_OUTCOMES = [
  "SPOKE", "NO_ANSWER", "BUSY", "CALLBACK", "WRONG_NUMBER", "NOT_INTERESTED",
] as const;

const callSchema = z.object({
  outcome: z.enum(CALL_OUTCOMES),
  notes: z.string().trim().max(500).optional().or(z.literal("")),
});

function firstError(e: z.ZodError): string {
  return e.issues[0]?.message ?? "Invalid input";
}

/** Log one dial against a lead. `calledAt` is server-stamped — never trusted from the client. */
export async function logCall(leadId: string, form: FormData): Promise<ActionResult> {
  const session = await requireSection("pipeline");
  const parsed = callSchema.safeParse(Object.fromEntries(form));
  if (!parsed.success) return { ok: false, error: firstError(parsed.error) };
  const d = parsed.data;

  const lead = await prisma.lead.findUnique({ where: { id: leadId }, select: { id: true } });
  if (!lead) return { ok: false, error: "Lead not found" };

  await prisma.$transaction(async (tx) => {
    await tx.callLog.create({
      data: {
        leadId,
        userId: session.user.id,
        outcome: d.outcome,
        notes: d.notes || null,
      },
    });
    // Keep speed-to-lead honest: the first connected conversation IS first contact. Mirrors
    // markLeadContacted's rule — only the first one counts, so a later call can't reset the
    // clock and flatter the speed metric. Only SPOKE qualifies: a no-answer isn't contact.
    if (d.outcome === "SPOKE") {
      await tx.lead.updateMany({
        where: { id: leadId, contactedAt: null },
        data: { contactedAt: new Date() },
      });
    }
  });

  revalidatePath("/my-desk");
  revalidatePath("/pipeline");
  return { ok: true };
}

/** Remove a mis-logged call. Admin-only: history the team is paid on isn't self-serve editable. */
export async function deleteCallLog(id: string): Promise<ActionResult> {
  const session = await requireSection("pipeline");
  if (session.role !== "ADMIN") {
    return { ok: false, error: "Only an admin can remove a logged call — log a correcting call instead." };
  }
  await prisma.callLog.delete({ where: { id } }).catch(() => undefined);
  revalidatePath("/my-desk");
  revalidatePath("/pipeline");
  return { ok: true };
}
