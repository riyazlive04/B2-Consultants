import "server-only";
import { cache } from "react";
import { prisma } from "@/lib/prisma";
import { istToday } from "@/lib/dates";
import {
  computeStudentJourney,
  STUDENT_NEXT_STEPS,
  type StudentJourney,
} from "@/lib/gamification";

/**
 * Student portal (Role.STUDENT): everything the signed-in student may see about
 * THEMSELVES — journey XP, badges, milestones, next steps. Hard privacy line,
 * enforced here at the query layer, not in the UI:
 *  - NO money (fees, payments, LTV), NO satisfaction/NPS records,
 *  - NO internal notes, NO manual G/A/R signal or its history,
 *  - NO signal-derived badges (they would leak the internal signal),
 *  - milestone timeline WITHOUT coach notes.
 */

const dateKeyOf = (d: Date) => d.toISOString().slice(0, 10);
const istDayKey = (d: Date) => new Date(d.getTime() + 5.5 * 3600000).toISOString().slice(0, 10);
const dayDiff = (a: Date, b: Date) => Math.floor((a.getTime() - b.getTime()) / 86400000);

/** Badges that reveal the internal signal system — hidden from the student's own view. */
const INTERNAL_BADGE_KEYS = new Set(["green-zone", "comeback"]);

function portalJourney(journey: StudentJourney): StudentJourney {
  const badges = journey.badges.filter((b) => !INTERNAL_BADGE_KEYS.has(b.key));
  return { ...journey, badges, unlockedCount: badges.filter((b) => b.unlockedAt).length };
}

export const getMyStudentPortal = cache(async (userId: string) => {
  const student = await prisma.student.findUnique({
    where: { userId },
    include: {
      enrollments: {
        orderBy: { enrollmentDate: "asc" },
        include: {
          milestoneLogs: {
            orderBy: { date: "asc" },
            select: { id: true, date: true, previousMilestone: true, newMilestone: true },
          },
          // loaded ONLY to feed journey momentum/badge math — never exposed below
          signalChanges: { select: { date: true, previousSignal: true, newSignal: true } },
          // sprint plan: targets/actuals/status only — who entered it stays internal
          sprintWeeks: {
            orderBy: { weekIndex: "asc" },
            select: {
              id: true, weekIndex: true, weekStart: true, weekEnd: true,
              target: true, actual: true, status: true, note: true,
            },
          },
        },
      },
    },
  });
  if (!student) return null;

  const today = istToday();
  const todayKey = dateKeyOf(today);

  const enrollments = student.enrollments.map((e) => {
    const totalDays = e.programLevel === "GUIDED" ? 90 : e.programLevel === "ELITE" ? 120 : null;
    const journey = computeStudentJourney({
      todayKey,
      status: e.status,
      enrollmentDateKey: dateKeyOf(e.enrollmentDate),
      currentMilestone: e.currentMilestone,
      totalSessionsCompleted: e.totalSessionsCompleted,
      applicationsSubmitted: e.applicationsSubmitted,
      interviewsReceived: e.interviewsReceived,
      lastSessionDateKey: e.lastSessionDate ? dateKeyOf(e.lastSessionDate) : null,
      signalColour: e.signalColour,
      milestoneLogs: e.milestoneLogs.map((l) => ({
        dateKey: istDayKey(l.date),
        previousMilestone: l.previousMilestone,
        newMilestone: l.newMilestone,
      })),
      signalChanges: e.signalChanges.map((c) => ({
        dateKey: istDayKey(c.date),
        previousSignal: c.previousSignal,
        newSignal: c.newSignal,
      })),
    });

    return {
      id: e.id,
      programLevel: e.programLevel,
      status: e.status,
      enrollmentDate: e.enrollmentDate.toISOString(),
      programEndDate: e.programEndDate?.toISOString() ?? null,
      daysLeft: e.programEndDate ? Math.max(0, dayDiff(e.programEndDate, today)) : null,
      dayNumber: totalDays ? Math.min(Math.max(dayDiff(today, e.enrollmentDate) + 1, 1), totalDays) : null,
      totalDays,
      assignedCoach: e.assignedCoach,
      currentMilestone: e.currentMilestone,
      totalSessionsCompleted: e.totalSessionsCompleted,
      totalSessionsPlanned: e.totalSessionsPlanned,
      applicationsSubmitted: e.applicationsSubmitted,
      interviewsReceived: e.interviewsReceived,
      lastSessionDate: e.lastSessionDate?.toISOString() ?? null,
      nextCheckInDate: e.nextCheckInDate?.toISOString() ?? null,
      journey: portalJourney(journey),
      // dates + stages only — the coach's session notes stay internal
      milestoneTimeline: e.milestoneLogs.map((l) => ({
        id: l.id,
        date: l.date.toISOString(),
        previousMilestone: l.previousMilestone,
        newMilestone: l.newMilestone,
      })),
      nextSteps: STUDENT_NEXT_STEPS[e.currentMilestone] ?? null,
      // Week-wise sprint plan (client notes): the weekend check-in happens HERE.
      sprintWeeks: e.sprintWeeks.map((w) => ({
        id: w.id,
        weekIndex: w.weekIndex,
        weekStart: w.weekStart.toISOString(),
        weekEnd: w.weekEnd.toISOString(),
        target: w.target,
        actual: w.actual,
        status: w.status,
        note: w.note,
        isCurrent:
          todayKey >= dateKeyOf(w.weekStart) && todayKey <= dateKeyOf(w.weekEnd),
      })),
    };
  });

  // the enrollment the portal leads with: latest ACTIVE, else latest overall
  const primary =
    [...enrollments].reverse().find((e) => e.status === "ACTIVE") ??
    enrollments[enrollments.length - 1] ??
    null;

  return {
    studentId: student.id,
    fullName: student.fullName,
    targetRole: student.targetRole,
    industry: student.industry,
    enrollments,
    primary,
  };
});

export type StudentPortal = NonNullable<Awaited<ReturnType<typeof getMyStudentPortal>>>;
export type PortalEnrollment = StudentPortal["enrollments"][number];
