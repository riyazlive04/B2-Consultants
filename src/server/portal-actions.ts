"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { istToday } from "@/lib/dates";
import { checkInState } from "@/lib/sprint-check-in";
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
      weekEnd: true,
      enrollment: { select: { student: { select: { userId: true } } } },
    },
  });
  if (!week || week.enrollment.student.userId !== session.user.id) {
    return { ok: false, error: "Sprint week not found" };
  }

  /**
   * ONE guard, from `checkInState`, where there were three.
   *
   * This was a status test, then a date test, then an `actual` test, each with its own message
   * - and that triple is exactly what lib/sprint-check-in.ts was extracted to end: the UI
   * decides which week to offer with one rule and the server decided whether to accept it with
   * another, so the two could disagree about the same week. They now ask the same function.
   *
   * It is still checked HERE and not trusted from the form: this is a server action, the id is
   * a parameter, and the UI's choice is a suggestion. Without the check a student could retire
   * a week that has not happened yet, which also takes it off the coach's review queue.
   *
   * Compared as IST day keys, like every other `@db.Date` comparison in the app, so nothing
   * flips during the 00:00-05:30 IST window.
   */
  const todayKey = istToday().toISOString().slice(0, 10);
  const state = checkInState(
    {
      status: week.status,
      actual: week.actual,
      weekStartYmd: week.weekStart.toISOString().slice(0, 10),
      weekEndYmd: week.weekEnd.toISOString().slice(0, 10),
    },
    todayKey,
  );

  // Each refusal says which of the four situations it is, because "you can't do that" on a form
  // a student was just shown is the least useful sentence available.
  if (state === "JUDGED") {
    return { ok: false, error: "This week has already been reviewed by your coach" };
  }
  if (state === "AWAITING_COACH") {
    return { ok: false, error: "You've already checked in for this week - your coach will review it." };
  }
  if (state === "NOT_STARTED") {
    return { ok: false, error: "That week hasn't started yet." };
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
