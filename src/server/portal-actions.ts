"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requireSession } from "@/lib/rbac";
import type { ActionResult } from "./finance-actions";

/**
 * Student-portal writes (Role.STUDENT only). The one thing a student may write is
 * their own weekend sprint check-in (client notes: "every weekend → fill it") -
 * ownership is verified at the query layer, same as the portal reads.
 */

const checkInSchema = z.object({
  actual: z.string().trim().min(1, "Tell us what you got done this week"),
  note: z.string().trim().optional(),
});

const parseNumber = (s: string | undefined | null): number | null => {
  if (!s) return null;
  const m = s.replace(/,/g, "").match(/-?\d+(\.\d+)?/);
  return m ? parseFloat(m[0]) : null;
};

export async function submitMySprintCheckIn(weekId: string, form: FormData): Promise<ActionResult> {
  const session = await requireSession();
  if (session.role !== "STUDENT") return { ok: false, error: "Not allowed" };
  const parsed = checkInSchema.safeParse(Object.fromEntries(form));
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input" };
  const d = parsed.data;

  const week = await prisma.sprintWeek.findUnique({
    where: { id: weekId },
    select: {
      status: true,
      targetNumeric: true,
      enrollment: { select: { student: { select: { userId: true } } } },
    },
  });
  if (!week || week.enrollment.student.userId !== session.user.id) {
    return { ok: false, error: "Sprint week not found" };
  }
  if (week.status !== "PENDING") {
    return { ok: false, error: "This week has already been reviewed by your coach" };
  }

  const actualNumeric = parseNumber(d.actual);
  // Numeric target + numeric actual → the verdict is arithmetic; otherwise the coach decides.
  const status =
    week.targetNumeric !== null && actualNumeric !== null
      ? actualNumeric >= Number(week.targetNumeric)
        ? ("ACHIEVED" as const)
        : ("MISSED" as const)
      : ("PENDING" as const);

  await prisma.sprintWeek.update({
    where: { id: weekId },
    data: { actual: d.actual, actualNumeric, note: d.note || null, status },
  });
  revalidatePath("/my-journey");
  revalidatePath("/students");
  return { ok: true };
}
