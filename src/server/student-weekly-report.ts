import "server-only";
import { cache } from "react";
import { prisma } from "@/lib/prisma";
import { studentIdForUser } from "./student-lookup";
import { batchIdsForStudent } from "./batch-membership";
import { weeklyWindowState, type WeeklyQuestion, type WeeklyWindowState } from "@/lib/weekly-form";
import { toWeeklyQuestions } from "./weekly-questions";

/**
 * A STUDENT'S OWN WEEKLY REPORTS - what they said, and what their coach let them see.
 *
 * ── What this deliberately does NOT return ────────────────────────────────────────────
 * No flag, no streak, no weeks-silent count, and no review note that has not been marked
 * shareable. The flags are an internal instrument for the delivery team: "you are a red
 * flag" is a thing a coach says in a conversation, having read the reasons, not a label a
 * student discovers on a page at 11pm. The same reasoning the leaderboard's `viewFor`
 * applies to other students' names - the stripping happens HERE, on the server, rather
 * than by a component choosing not to render something it was handed.
 *
 * ── Why the open week is included ─────────────────────────────────────────────────────
 * The single most useful thing this card can do is tell a student their report is due and
 * hand them the link. Without it the only route to the form is a WhatsApp message they have
 * to go and find.
 */

export type MyWeeklyAnswer = { label: string; value: string };

export type MyWeeklyWeek = {
  cycleId: string;
  isoWeek: string;
  weekStart: Date;
  weekEnd: Date;
  batchWeekNumber: number | null;
  cohortName: string;
  state: WeeklyWindowState;
  submittedAt: Date | null;
  late: boolean;
  answers: MyWeeklyAnswer[];
  /** The coach's remark, ONLY when they marked it as shareable. */
  remark: string | null;
  /**
   * The questions, so a student answers in the portal - the only place a weekly report is
   * ever filled in. Carried only for a week they can still answer: there is nothing to
   * render a form for on a closed one.
   */
  questions: WeeklyQuestion[];
  /** What they already answered, keyed by question key, so an edit starts from it. */
  answered: Record<string, string | string[]>;
};

export const getMyWeeklyReports = cache(async (userId: string): Promise<MyWeeklyWeek[]> => {
  const studentId = await studentIdForUser(userId);
  if (!studentId) return [];

  /**
   * The weeks this student was actually asked about: cycles on a cohort they are seated in,
   * by either mechanism. Read from the cycle side rather than from their responses, so a week
   * they MISSED still appears - a history that showed only the weeks they answered would
   * quietly flatter them, and would hide the open week they still have time to fill in.
   */
  // Through the seam: which cohorts this student sits in is the membership fork's question,
  // and server/batch-membership.ts is the one place that answers it.
  const batchIds = await batchIdsForStudent(studentId);
  if (batchIds.length === 0) return [];

  const cycles = await prisma.weeklyReportCycle.findMany({
    where: { batchId: { in: batchIds } },
    orderBy: { weekStart: "desc" },
    take: 13,
    select: {
      id: true,
      isoWeek: true,
      weekStart: true,
      weekEnd: true,
      batchWeekNumber: true,
      status: true,
      opensAt: true,
      closesAt: true,
      batch: { select: { name: true, code: true } },
      template: {
        select: {
          questions: {
            where: { active: true },
            select: {
              id: true, key: true, version: true, kind: true, metric: true, label: true,
              helpText: true, required: true, orderIndex: true, options: true,
              allowOther: true, min: true, max: true, targetNumeric: true,
            },
          },
        },
      },
      responses: {
        where: { studentId },
        select: {
          submittedAt: true,
          late: true,
          answers: {
            select: {
              value: true,
              question: { select: { key: true, label: true, orderIndex: true } },
            },
          },
        },
      },
      reviews: {
        where: { studentId },
        select: { note: true, shareWithStudent: true },
      },
    },
  });

  const now = new Date();

  return cycles.map((c) => {
    const response = c.responses[0] ?? null;
    const review = c.reviews[0] ?? null;
    /**
     * The window the reader is judged against has to be the one the WRITER uses, or the
     * form would be withheld from a submission `submitMyWeeklyReport` would have accepted.
     */
    const state = weeklyWindowState(
      { status: c.status as "OPEN" | "CLOSED", opensAt: c.opensAt, closesAt: c.closesAt },
      now,
    );

    const open = state === "OPEN" || state === "LATE";

    const answered: Record<string, string | string[]> = {};
    for (const a of response?.answers ?? []) {
      const v = a.value;
      if (Array.isArray(v)) answered[a.question.key] = v.map((x) => String(x));
      else if (v === null || v === undefined) continue;
      else answered[a.question.key] = typeof v === "boolean" ? (v ? "yes" : "no") : String(v);
    }

    const answers = [...(response?.answers ?? [])]
      .sort((a, b) => a.question.orderIndex - b.question.orderIndex)
      .map((a) => ({
        label: a.question.label,
        value: Array.isArray(a.value)
          ? a.value.map((v) => String(v)).join(", ")
          : typeof a.value === "boolean"
            ? a.value
              ? "Yes"
              : "No"
            : String(a.value ?? ""),
      }))
      .filter((a) => a.value.trim() !== "");

    return {
      cycleId: c.id,
      isoWeek: c.isoWeek,
      weekStart: c.weekStart,
      weekEnd: c.weekEnd,
      batchWeekNumber: c.batchWeekNumber,
      cohortName: c.batch.code ?? c.batch.name,
      state,
      submittedAt: response?.submittedAt ?? null,
      late: response?.late ?? false,
      answers,
      remark: review?.shareWithStudent ? (review.note?.trim() || null) : null,
      questions: open ? toWeeklyQuestions(c.template.questions) : [],
      answered,
    };
  });
});
