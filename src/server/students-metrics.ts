import "server-only";
import { prisma } from "@/lib/prisma";
import { istMonthInstantRange, istToday } from "@/lib/dates";
import { aggInrMinor } from "@/lib/money";
import { ACTIVE } from "@/lib/soft-delete";
import { computeStudentJourney, type GamificationConfig, type StudentJourney } from "@/lib/gamification";
import { getGamificationConfig } from "./founder-config";

/** Students dashboards (PRD2 §4): counts, 90/120 tracker, satisfaction, LTV. */

const dayDiff = (a: Date, b: Date) => Math.floor((a.getTime() - b.getTime()) / 86400000);
const dateKeyOf = (d: Date) => d.toISOString().slice(0, 10);
/** Timestamps → the IST business day they happened on. */
const istDayKey = (d: Date) => new Date(d.getTime() + 5.5 * 3600000).toISOString().slice(0, 10);

/** Gamified journey for one enrollment row (works with or without history rows). */
function journeyFor(
  today: Date,
  config: GamificationConfig,
  e: {
    status: string; enrollmentDate: Date; currentMilestone: string;
    totalSessionsCompleted: number; applicationsSubmitted: number; interviewsReceived: number;
    lastSessionDate: Date | null; signalColour: string | null;
  },
  milestoneLogs: Array<{ date: Date; previousMilestone: string | null; newMilestone: string }> = [],
  signalChanges: Array<{ date: Date; previousSignal: string | null; newSignal: string | null }> = [],
): StudentJourney {
  return computeStudentJourney({
    todayKey: dateKeyOf(today),
    status: e.status,
    enrollmentDateKey: dateKeyOf(e.enrollmentDate),
    currentMilestone: e.currentMilestone,
    totalSessionsCompleted: e.totalSessionsCompleted,
    applicationsSubmitted: e.applicationsSubmitted,
    interviewsReceived: e.interviewsReceived,
    lastSessionDateKey: e.lastSessionDate ? dateKeyOf(e.lastSessionDate) : null,
    signalColour: e.signalColour,
    milestoneLogs: milestoneLogs.map((l) => ({
      dateKey: istDayKey(l.date), previousMilestone: l.previousMilestone, newMilestone: l.newMilestone,
    })),
    signalChanges: signalChanges.map((c) => ({
      dateKey: istDayKey(c.date), previousSignal: c.previousSignal, newSignal: c.newSignal,
    })),
  }, config);
}

async function ltvByStudent(): Promise<Map<string, number>> {
  const incomes = await prisma.income.findMany({
    where: { ...ACTIVE, studentId: { not: null } },
    select: { studentId: true, amountInrMinor: true, amountEurMinor: true, fxRateUsed: true },
  });
  const map = new Map<string, number>();
  for (const i of incomes) {
    const v = Number(aggInrMinor(i.amountInrMinor, i.amountEurMinor, i.fxRateUsed));
    map.set(i.studentId!, (map.get(i.studentId!) ?? 0) + v);
  }
  return map;
}

export async function getStudentsOverview() {
  const today = istToday();
  const config = await getGamificationConfig();
  // only compared against statusChangedAt (a timestamp) → use IST instants
  const month = istMonthInstantRange(today);

  const [students, enrollments, trackerRows, satisfaction, ltv] = await Promise.all([
    // A student belongs on this coaching dashboard unless they are EXCLUSIVELY a German Note member
    // (a GN membership but no B2 enrollment) — those live on /german-note. The old filter assumed
    // "no enrollment ⟹ GN member", which silently hid every bulk-imported student (no enrollment,
    // no GN membership yet). Show them: they are coaching students.
    prisma.student.findMany({
      where: { OR: [{ enrollments: { some: {} } }, { gnMemberships: { none: {} } }] },
      orderBy: { createdAt: "desc" },
    }),
    // Lean pass: every enrollment, scalars only. Powers the count tiles, the LTV
    // roll-ups and the list rows — none of which look at journey history.
    prisma.enrollment.findMany({
      select: {
        id: true, studentId: true, programLevel: true, status: true,
        statusChangedAt: true, enrollmentDate: true, programEndDate: true, assignedCoach: true,
      },
    }),
    // Rich pass: ONLY the active Guided/Elite rows the 90/120 tracker actually
    // renders. Previously the three journey collections were joined onto every
    // enrollment ever — completed and dropped ones included — and thrown away.
    prisma.enrollment.findMany({
      where: { status: "ACTIVE", programLevel: { in: ["GUIDED", "ELITE"] } },
      include: {
        student: { select: { id: true, fullName: true } },
        milestoneLogs: { select: { date: true, previousMilestone: true, newMilestone: true } },
        signalChanges: { select: { date: true, previousSignal: true, newSignal: true } },
        sprintWeeks: { select: { weekIndex: true, weekEnd: true, status: true, target: true } },
      },
    }),
    // PRD2 §4.5: averages are across COMPLETED students only — a student is
    // "completed" once any of their enrollments reaches COMPLETED status.
    prisma.satisfactionScore.findMany({
      where: { student: { enrollments: { some: { status: "COMPLETED" } } } },
    }),
    ltvByStudent(),
  ]);

  // ── Count dashboard (PRD2 §4.2) ──
  const active = enrollments.filter((e) => e.status === "ACTIVE");
  const activeStudentIds = new Set(active.map((e) => e.studentId));
  const counts = {
    totalActive: activeStudentIds.size,
    activeSolo: active.filter((e) => e.programLevel === "SOLO").length,
    activeGuided: active.filter((e) => e.programLevel === "GUIDED").length,
    activeElite: active.filter((e) => e.programLevel === "ELITE").length,
    completedThisMonth: enrollments.filter(
      (e) => e.status === "COMPLETED" && e.statusChangedAt >= month.start && e.statusChangedAt < month.end,
    ).length,
    droppedThisMonth: enrollments.filter(
      (e) => e.status === "DROPPED" && e.statusChangedAt >= month.start && e.statusChangedAt < month.end,
    ).length,
    totalAllTime: students.length,
  };

  // ── Satisfaction averages (always visible, PRD2 §4.5) ──
  const avg = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);
  const avgSatisfaction = avg(satisfaction.map((s) => s.satisfactionScore));
  const avgNps = avg(satisfaction.map((s) => s.npsScore));

  // ── 90/120 tracker rows: ACTIVE Guided + Elite only (PRD2 §4.3) ──
  const tracker = trackerRows
    .map((e) => {
      const totalDays = e.programLevel === "GUIDED" ? 90 : 120;
      const dayNumber = Math.min(Math.max(dayDiff(today, e.enrollmentDate) + 1, 1), totalDays);
      // Gamified journey (post-P3 layer): XP, stage title, momentum — derived, never stored
      const journey = journeyFor(today, config, e, e.milestoneLogs, e.signalChanges);
      return {
        enrollmentId: e.id,
        studentId: e.studentId,
        studentName: e.student.fullName,
        programLevel: e.programLevel,
        dayNumber,
        totalDays,
        pctComplete: (dayNumber / totalDays) * 100,
        currentMilestone: e.currentMilestone,
        signalColour: e.signalColour,
        daysSinceLastSession: e.lastSessionDate ? dayDiff(today, e.lastSessionDate) : null,
        nextCheckInDate: e.nextCheckInDate?.toISOString() ?? null,
        programEndDate: e.programEndDate?.toISOString() ?? null,
        journeyXp: journey.xp,
        journeyPct: journey.journeyPct,
        stageTitle: journey.stageTitle,
        stageIndex: journey.stageIndex,
        momentum: journey.momentum,
        badgeCount: journey.unlockedCount,
      };
    });

  // ── Momentum board: who's moving fastest right now (gamified showcase) ──
  const momentumBoard = [...tracker]
    .sort((a, b) => b.journeyXp - a.journeyXp)
    .slice(0, 3);

  // ── Early-warning at-risk radar (report §3.B - rule-based, no AI) ──
  // Detects disengagement BEFORE churn. Suggestions only: the manual G/A/R signal
  // stays the human decision (PRD2 §4.3); this is the machine tapping a shoulder.
  const MILESTONE_INDEX: Record<string, number> = {
    ONBOARDING: 0, RESUME_BUILD: 1, LINKEDIN_OPTIMISATION: 2, APPLICATIONS: 3,
    INTERVIEWS: 4, OFFER_RECEIVED: 5, COMPLETED: 6,
  };
  const atRiskRadar = tracker
    .map((t) => {
      const e = trackerRows.find((x) => x.id === t.enrollmentId)!;
      const flags: string[] = [];
      if (t.daysSinceLastSession !== null && t.daysSinceLastSession > 14) {
        flags.push(`${t.daysSinceLastSession} days since last session`);
      } else if (t.daysSinceLastSession === null && t.dayNumber > 10) {
        flags.push("No session recorded yet");
      }
      if (t.nextCheckInDate && new Date(t.nextCheckInDate) < today) {
        flags.push("Check-in overdue");
      }
      if (e.lastTaskCompleted === "NO") flags.push("Last task not done");
      // pace: >50% of program elapsed but still in the first two milestones
      if (t.pctComplete > 50 && MILESTONE_INDEX[t.currentMilestone] <= 1) {
        flags.push(`${Math.round(t.pctComplete)}% elapsed, still ${t.currentMilestone === "ONBOARDING" ? "onboarding" : "on resume"}`);
      }
      // guarantee window: <3 weeks left without interview-stage progress
      if (t.programEndDate) {
        const daysLeft = Math.floor((new Date(t.programEndDate).getTime() - today.getTime()) / 86400000);
        if (daysLeft <= 21 && daysLeft >= 0 && MILESTONE_INDEX[t.currentMilestone] < 4) {
          flags.push(`${daysLeft} days left, not yet at interviews`);
        }
      }
      // sprint tracker (client notes): a missed weekly target = ask why / take action;
      // a week whose weekend passed without a check-in is a silent miss in the making.
      const recentMissed = e.sprintWeeks.filter(
        (w) => w.status === "MISSED" && dayDiff(today, w.weekEnd) <= 14 && dayDiff(today, w.weekEnd) >= 0,
      );
      if (recentMissed.length) {
        flags.push(`Missed week-${recentMissed.map((w) => w.weekIndex).join("/")} sprint target`);
      }
      const overdueCheckIn = e.sprintWeeks.find(
        (w) => w.status === "PENDING" && !!w.target && dayDiff(today, w.weekEnd) > 2,
      );
      if (overdueCheckIn) flags.push(`Week ${overdueCheckIn.weekIndex} check-in not recorded`);
      return { ...t, flags, alreadyRed: t.signalColour === "RED" };
    })
    .filter((t) => t.flags.length > 0)
    .sort((a, b) => b.flags.length - a.flags.length);

  // ── LTV (PRD2 §4.6) ──
  const byId = new Map(students.map((s) => [s.id, s]));
  const levelStudentIds = { SOLO: new Set<string>(), GUIDED: new Set<string>(), ELITE: new Set<string>() };
  const enrollCount = new Map<string, number>();
  for (const e of enrollments) {
    enrollCount.set(e.studentId, (enrollCount.get(e.studentId) ?? 0) + 1);
    if (e.programLevel === "SOLO" || e.programLevel === "GUIDED" || e.programLevel === "ELITE") {
      levelStudentIds[e.programLevel].add(e.studentId);
    }
  }
  const avgLtvFor = (ids: Set<string>) =>
    ids.size ? [...ids].reduce((sum, id) => sum + (ltv.get(id) ?? 0), 0) / ids.size : 0;

  const upgraded = [...enrollCount.values()].filter((n) => n > 1).length;
  const upgradeRatePct = students.length ? (upgraded / students.length) * 100 : 0;

  let highest: { name: string; ltvInr: number } | null = null;
  for (const [sid, v] of ltv) {
    const s = byId.get(sid);
    if (s && (!highest || v > highest.ltvInr)) highest = { name: s.fullName, ltvInr: v };
  }

  const studentRows = students.map((s) => {
    const es = enrollments.filter((e) => e.studentId === s.id);
    // Latest program end date across this student's enrollments (Solo has none).
    const endDates = es.map((e) => e.programEndDate).filter((d): d is Date => !!d);
    return {
      id: s.id,
      code: s.code,
      fullName: s.fullName,
      email: s.email,
      phone: s.phone,
      leadSource: s.leadSource,
      industry: s.industry,
      targetRole: s.targetRole,
      internalNotes: s.internalNotes,
      assignedCoach: [...new Set(es.map((e) => e.assignedCoach).filter((c): c is string => !!c))].join(" / ") || null,
      programEndDate: endDates.length
        ? new Date(Math.max(...endDates.map((d) => d.getTime()))).toISOString()
        : null,
      levels: es.map((e) => e.programLevel).join(" + ") || "-",
      statuses: [...new Set(es.map((e) => e.status))].join(", ") || "-",
      enrollmentsCount: es.length,
      firstEnrollment: es.length
        ? es.reduce((min, e) => (e.enrollmentDate < min ? e.enrollmentDate : min), es[0].enrollmentDate).toISOString()
        : null,
      ltvInr: ltv.get(s.id) ?? 0,
    };
  });

  return {
    counts,
    avgSatisfaction,
    avgNps,
    tracker,
    momentumBoard,
    atRiskRadar,
    ltvSummary: {
      avgSolo: avgLtvFor(levelStudentIds.SOLO),
      avgGuided: avgLtvFor(levelStudentIds.GUIDED),
      avgElite: avgLtvFor(levelStudentIds.ELITE),
      upgradeRatePct,
      highest,
    },
    students: studentRows,
  };
}

export async function getStudentDetail(id: string) {
  const student = await prisma.student.findUnique({
    where: { id },
    include: {
      enrollments: {
        orderBy: { enrollmentDate: "asc" },
        include: {
          milestoneLogs: { orderBy: { date: "desc" }, include: { updatedBy: { select: { name: true } } } },
          signalChanges: { orderBy: { date: "desc" }, include: { changedBy: { select: { name: true } } } },
          sprintWeeks: { orderBy: { weekIndex: "asc" }, include: { enteredBy: { select: { name: true } } } },
          closer: { select: { id: true, name: true } },
          jobApplications: { orderBy: [{ status: "asc" }, { appliedAt: "desc" }] },
        },
      },
      satisfactionScores: { orderBy: { date: "desc" } },
      incomes: { where: ACTIVE, orderBy: { date: "desc" } },
      user: { select: { email: true } }, // portal login, when provisioned
    },
  });
  if (!student) return null;

  const today = istToday();
  const config = await getGamificationConfig();
  const ltvInr = student.incomes.reduce(
    (sum, i) => sum + Number(aggInrMinor(i.amountInrMinor, i.amountEurMinor, i.fxRateUsed)),
    0,
  );
  const unlinkedIncomes = await prisma.income.findMany({
    where: { studentId: null },
    orderBy: { date: "desc" },
    take: 100,
    select: { id: true, studentName: true, date: true, amountInrMinor: true },
  });
  // Active team accounts (not students) — the closer picker for the commission split.
  const teamMembers = await prisma.user.findMany({
    where: { status: "ACTIVE", role: { not: "STUDENT" } },
    orderBy: { name: "asc" },
    select: { id: true, name: true },
  });

  return {
    id: student.id,
    fullName: student.fullName,
    email: student.email,
    phone: student.phone,
    industry: student.industry,
    targetRole: student.targetRole,
    leadSource: student.leadSource,
    internalNotes: student.internalNotes,
    portalEmail: student.user?.email ?? null,
    ltvInr,
    enrollments: student.enrollments.map((e) => {
      const totalDays = e.programLevel === "GUIDED" ? 90 : e.programLevel === "ELITE" ? 120 : null;
      return {
        id: e.id,
        // full gamified journey (XP, stage, momentum, badges) — Solo included, tracker aside
        journey: journeyFor(today, config, e, e.milestoneLogs, e.signalChanges),
        programLevel: e.programLevel,
        enrollmentDate: e.enrollmentDate.toISOString(),
        duration: e.duration,
        programEndDate: e.programEndDate?.toISOString() ?? null,
        assignedCoach: e.assignedCoach,
        closerId: e.closerId,
        closerName: e.closer?.name ?? null,
        status: e.status,
        dayNumber: totalDays ? Math.min(Math.max(dayDiff(today, e.enrollmentDate) + 1, 1), totalDays) : null,
        totalDays,
        lastSessionDate: e.lastSessionDate?.toISOString() ?? null,
        daysSinceLastSession: e.lastSessionDate ? dayDiff(today, e.lastSessionDate) : null,
        totalSessionsCompleted: e.totalSessionsCompleted,
        totalSessionsPlanned: e.totalSessionsPlanned,
        lastTaskAssigned: e.lastTaskAssigned,
        lastTaskCompleted: e.lastTaskCompleted,
        applicationsSubmitted: e.applicationsSubmitted,
        interviewsReceived: e.interviewsReceived,
        currentMilestone: e.currentMilestone,
        signalColour: e.signalColour,
        signalNotes: e.signalNotes,
        nextCheckInDate: e.nextCheckInDate?.toISOString() ?? null,
        sprintWeeks: e.sprintWeeks.map((w) => ({
          id: w.id,
          weekIndex: w.weekIndex,
          weekStart: w.weekStart.toISOString(),
          weekEnd: w.weekEnd.toISOString(),
          target: w.target,
          actual: w.actual,
          status: w.status,
          note: w.note,
          enteredBy: w.enteredBy?.name ?? null,
        })),
        milestoneLogs: e.milestoneLogs.map((m) => ({
          id: m.id,
          date: m.date.toISOString(),
          updatedBy: m.updatedBy?.name ?? "-",
          previousMilestone: m.previousMilestone,
          newMilestone: m.newMilestone,
          note: m.note,
        })),
        signalChanges: e.signalChanges.map((c) => ({
          id: c.id,
          date: c.date.toISOString(),
          changedBy: c.changedBy?.name ?? "-",
          previousSignal: c.previousSignal,
          newSignal: c.newSignal,
          note: c.note,
        })),
        jobApplications: e.jobApplications.map((a) => ({
          id: a.id,
          company: a.company,
          role: a.role,
          jobUrl: a.jobUrl,
          location: a.location,
          status: a.status,
          appliedAt: a.appliedAt.toISOString(),
          statusAt: a.statusAt.toISOString(),
          notes: a.notes,
        })),
      };
    }),
    satisfaction: student.satisfactionScores.map((s) => ({
      id: s.id,
      date: s.date.toISOString(),
      satisfactionScore: s.satisfactionScore,
      npsScore: s.npsScore,
      testimonialReceived: s.testimonialReceived,
      outcomeAchieved: s.outcomeAchieved,
      notes: s.notes,
    })),
    incomes: student.incomes.map((i) => ({
      id: i.id,
      date: i.date.toISOString(),
      aggInr: Number(aggInrMinor(i.amountInrMinor, i.amountEurMinor, i.fxRateUsed)),
      programLevel: i.programLevel,
    })),
    unlinkedIncomes: unlinkedIncomes.map((i) => ({
      value: i.id,
      label: `${i.studentName} · ${i.date.toISOString().slice(0, 10)} · ₹${(Number(i.amountInrMinor) / 100).toLocaleString("en-IN")}`,
    })),
    teamMembers: teamMembers.map((m) => ({ id: m.id, name: m.name })),
  };
}

export type StudentsOverview = Awaited<ReturnType<typeof getStudentsOverview>>;
export type TrackerRow = StudentsOverview["tracker"][number];
export type StudentListRow = StudentsOverview["students"][number];
export type StudentDetail = NonNullable<Awaited<ReturnType<typeof getStudentDetail>>>;
