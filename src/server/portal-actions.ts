"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { istToday } from "@/lib/dates";
import { requireSession } from "@/lib/rbac";
import { optionalRule, rule } from "@/lib/field-rules";
import { logActivity } from "./activity-log";
import type { ActionResult } from "./finance-actions";

/**
 * Student-portal writes (Role.STUDENT only). The one thing a student may write is
 * their own weekend sprint check-in (client notes: "every weekend → fill it") -
 * ownership is verified at the query layer, same as the portal reads.
 */

const checkInSchema = z.object({
  // Prose, so `text` (cap only) - the min(1) keeps the empty-box message the student sees.
  actual: rule("text").pipe(z.string().min(1, "Tell us what you got done this week")),
  note: optionalRule("text"),
});

/**
 * Does each side contain exactly ONE number?
 *
 * `parseNumber` takes the first number it finds, which is only a fair reading when there is
 * one to find. "15 applications" vs "12 applications" compares cleanly; "15 applications, 2
 * calls" vs "2 calls, 15 applications" does not, and silently scoring it produces a verdict
 * determined by the order the student happened to type things in.
 */
const comparableNumbers = (target: string | null, actual: string): boolean => {
  const count = (s: string) => (s.replace(/,/g, "").match(/-?\d+(\.\d+)?/g) ?? []).length;
  return !!target && count(target) === 1 && count(actual) === 1;
};

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
      target: true,
      targetNumeric: true,
      actual: true,
      weekStart: true,
      enrollment: { select: { student: { select: { userId: true } } } },
    },
  });
  if (!week || week.enrollment.student.userId !== session.user.id) {
    return { ok: false, error: "Sprint week not found" };
  }
  if (week.status !== "PENDING") {
    return { ok: false, error: "This week has already been reviewed by your coach" };
  }

  /**
   * The week has to have STARTED. The form only ever offers the current week or an overdue
   * one, but this is a server action - the UI's choice is a suggestion, and the id is a
   * parameter. Without this a student could retire a week that has not happened yet, which
   * also takes it off the coach's review queue.
   *
   * Compared as IST day keys, like every other `@db.Date` comparison in the app, so the
   * check does not flip during the 00:00-05:30 IST window.
   */
  const todayKey = istToday().toISOString().slice(0, 10);
  if (week.weekStart.toISOString().slice(0, 10) > todayKey) {
    return { ok: false, error: "That week hasn't started yet." };
  }

  /**
   * One check-in per week.
   *
   * When the coach set a prose target (no number to compare against) the verdict stays
   * PENDING - which left the week still "current and pending", so the form reopened, empty,
   * with nothing on screen saying anything had been sent. A second submission silently
   * replaced the first, and the student never saw either. The status cannot carry this
   * (PENDING is a real coach-facing state), so `actual` being filled is what says "answered".
   */
  if (week.actual) {
    return { ok: false, error: "You've already checked in for this week - your coach will review it." };
  }

  const actualNumeric = parseNumber(d.actual);
  /**
   * Numeric target + numeric actual -> the verdict is arithmetic; otherwise the coach decides.
   *
   * `comparableNumbers` is the guard that stops the arithmetic running on a number that does
   * not mean the same thing on both sides. Both strings are reduced to their FIRST number, so
   * a target of "15 applications, 2 networking calls" is 15 - and a student answering "2
   * networking calls, 15 applications" was scored 2 against 15 and recorded as MISSED, on
   * their own screen, for a week they had actually hit. The same week typed the other way
   * round passed. A verdict that depends on word order is worse than no verdict, so where the
   * two sides are not plainly comparable this now defers to the coach instead of guessing.
   */
  const status =
    week.targetNumeric !== null && actualNumeric !== null && comparableNumbers(week.target, d.actual)
      ? actualNumeric >= Number(week.targetNumeric)
        ? ("ACHIEVED" as const)
        : ("MISSED" as const)
      : ("PENDING" as const);

  await prisma.sprintWeek.update({
    where: { id: weekId },
    data: {
      actual: d.actual,
      actualNumeric,
      note: d.note || null,
      status,
      // Who wrote this. The column existed and only the COACH path was filling it, so a
      // student's own check-in was indistinguishable from an unattributed coach entry.
      enteredById: session.user.id,
    },
  });
  await logActivity(session, {
    action: "sprint.submit",
    section: "my-journey",
    entityType: "SprintWeek",
    entityId: weekId,
    summary: `Submitted their weekend sprint check-in`,
    meta: { status, actualNumeric },
  });
  revalidatePath("/my-journey");
  revalidatePath("/students");
  return { ok: true };
}
