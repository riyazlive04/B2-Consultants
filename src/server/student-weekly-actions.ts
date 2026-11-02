"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { requireSession } from "@/lib/rbac";
import { validateWeeklySubmission, weeklyAcceptance, weeklyWindowState } from "@/lib/weekly-form";
import { studentIdForUser } from "./student-lookup";
import { batchRosters } from "./batch-membership";
import { toWeeklyQuestions } from "./weekly-questions";

/**
 * A SIGNED-IN STUDENT SUBMITTING THEIR OWN WEEK.
 *
 * ── Why this exists beside the public link ───────────────────────────────────────────
 * A student with a portal login should not have to find a WhatsApp message, open a public
 * page and type their own Student ID to tell us how their week went - they are already
 * signed in, and the app already knows who they are. The public link stays because most
 * students have no login at all (`Student.userId` is optional), and a cohort link can be
 * posted once into a group.
 *
 * ── The identity check is the SESSION here, and nothing else ─────────────────────────
 * No student id and no code travel from the browser: the student is whoever
 * `studentIdForUser` says the session belongs to. That is strictly stronger than the public
 * form's name-plus-code, which is why there is no code field on this path - asking a
 * signed-in person to prove who they are again would be friction that buys nothing.
 *
 * ── Still fenced on the roster ───────────────────────────────────────────────────────
 * Being signed in says who you are, not which cohort's week you may answer. The cycle has
 * to belong to a cohort this student is actually seated in, or a student could answer
 * another cohort's week by passing its id.
 */

export type StudentWeeklyResult =
  | { ok: true; late: boolean; amended: boolean }
  | { ok: false; error: string; fieldErrors?: Record<string, string> };

export async function submitMyWeeklyReport(
  cycleId: string,
  form: FormData,
): Promise<StudentWeeklyResult> {
  const session = await requireSession();
  const studentId = await studentIdForUser(session.user.id);
  if (!studentId) {
    return { ok: false, error: "Your login isn't linked to a student record yet - ask your coach to connect it." };
  }

  const cycle = await prisma.weeklyReportCycle.findUnique({
    where: { id: String(cycleId ?? "") },
    select: {
      id: true,
      batchId: true,
      status: true,
      opensAt: true,
      closesAt: true,
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
    },
  });
  if (!cycle) return { ok: false, error: "That week no longer exists." };

  const seats = (await batchRosters([cycle.batchId])).get(cycle.batchId) ?? [];
  const seat = seats.find((s) => s.studentId === studentId);
  if (!seat) return { ok: false, error: "This week belongs to a cohort you are not in." };

  const state = weeklyWindowState(
    {
      status: cycle.status as "OPEN" | "CLOSED",
      opensAt: cycle.opensAt,
      closesAt: cycle.closesAt,
    },
    new Date(),
  );
  const acceptance = weeklyAcceptance(state);
  if (!acceptance.accept) return { ok: false, error: "This week is not open for submissions." };

  const questions = toWeeklyQuestions(cycle.template.questions);

  const input: Record<string, unknown> = {};
  for (const key of new Set(form.keys())) {
    const all = form.getAll(key).map((v) => (typeof v === "string" ? v : ""));
    input[key] = all.length > 1 ? all : all[0];
  }

  const parsed = validateWeeklySubmission(questions, input);
  if (!parsed.ok) return { ok: false, error: "Some answers need fixing.", fieldErrors: parsed.errors };

  const existing = await prisma.weeklyReportResponse.findUnique({
    where: { cycleId_studentId: { cycleId: cycle.id, studentId } },
    select: { id: true },
  });

  await prisma.$transaction(async (tx) => {
    const response = await tx.weeklyReportResponse.upsert({
      where: { cycleId_studentId: { cycleId: cycle.id, studentId } },
      create: {
        cycleId: cycle.id,
        studentId,
        enrollmentId: seat.enrollmentId,
        // STUDENT, not STAFF: they filled it in themselves, from their own account. The
        // source column exists to stop a transcribed answer being counted as a submission.
        source: "STUDENT",
        late: acceptance.late,
        submittedAt: new Date(),
      },
      // `submittedAt` and `late` stay as first recorded - see the same note on the public
      // action. When a report arrived is a fact about its arrival, not about its last edit.
      update: { enrollmentId: seat.enrollmentId },
      select: { id: true },
    });

    await tx.weeklyReportAnswer.deleteMany({ where: { responseId: response.id } });
    if (parsed.answers.length > 0) {
      await tx.weeklyReportAnswer.createMany({
        data: parsed.answers.map((a) => ({
          responseId: response.id,
          questionId: a.questionId,
          value: a.value as never,
          numeric: a.numeric,
        })),
      });
    }
  });

  revalidatePath("/my-journey");
  revalidatePath("/dashboard");
  revalidatePath("/weekly-reports");
  revalidatePath(`/batches/${cycle.batchId}`);
  revalidatePath("/coaching");

  return { ok: true, late: acceptance.late, amended: Boolean(existing) };
}
