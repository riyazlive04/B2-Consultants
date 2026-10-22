import "server-only";
import { prisma } from "@/lib/prisma";
import { tallyReasons } from "@/lib/enrollment-lifecycle";
import { istMonthInstantRange, istToday } from "@/lib/dates";
import { aggInrMinor } from "@/lib/money";
import { ACTIVE } from "@/lib/soft-delete";
import { computeStudentJourney, type GamificationConfig, type StudentJourney } from "@/lib/gamification";
import { getDeliveryDefaults, getGamificationConfig } from "./founder-config";
import { levelKinds, levelLabels } from "./levels";
import { lineForKind, type BusinessLine } from "@/lib/business-line";
import { lineForLevelKind } from "@/lib/batch";
import { parseStudentCodeParts } from "@/lib/student-code";

/** Students dashboards (PRD2 §4): counts, 90/120 tracker, satisfaction, LTV. */

/**
 * `studentId → "B2-0001"`, for any screen that shows a denormalised `studentName`.
 *
 * Extracted rather than copied: Finance built this inline, and Cash Health needs the same map
 * for its age analysis (Error Log G3). A second copy of the query is how one screen ends up
 * showing codes and another silently stops - which matters because a name alone is not an
 * identifier here. Two students called "Anna Smith" is a real case and has already caused a
 * payment to be credited to the wrong one (Error Log I1).
 *
 * Students with no code yet are simply absent from the map; callers render the bare name.
 */
export async function getStudentCodeMap(): Promise<Record<string, string>> {
  const rows = await prisma.student.findMany({ select: { id: true, code: true } });
  return Object.fromEntries(rows.flatMap((s) => (s.code ? [[s.id, s.code] as const] : [])));
}

/**
 * A student as a pick-list row: who they are, how to tell them apart, and which book they are in.
 *
 * ── Why the line travels with the option ─────────────────────────────────────────
 * The receivable form asks for a student and a programme level side by side, and the level
 * decides the business. Offering the whole roster regardless meant scrolling German Note
 * students while raising a B2 receivable - and worse, picking one, since two people can share a
 * name and the only thing distinguishing them was a code the operator had no reason to read.
 */
export type StudentPickerOption = {
  value: string;
  label: string;
  /** The student code (§6.1) - shown beside the name and searchable with it. */
  hint?: string;
  /** The levels they hold, shown muted beneath the name and searchable: "Guided · GN A1". */
  meta?: string;
  /**
   * Which business(es) this student belongs to.
   *
   * EMPTY MEANS UNKNOWN, AND UNKNOWN MEANS SHOW THEM. Sixteen of the students on this install
   * have no code and no history at all; excluding them because nothing is recorded would hide
   * exactly the people a payer search exists to find, which is a far worse failure than the
   * clutter being removed. A student is only ever filtered OUT on positive evidence that they
   * belong to the other book.
   */
  lines: BusinessLine[];
};

/**
 * Every student, with their books and levels resolved.
 *
 * A student counts as belonging to a line when EITHER their code series says so (B2-0007 was
 * issued by B2) OR they hold a level sold by it - taken from enrolments, receivables and past
 * payments together. The union is deliberate: somebody who buys German classes while being
 * coached for a move to Germany is in both books, and must appear on both forms. Nobody on this
 * install is in both today, which is precisely why it would have gone unnoticed until it bit.
 */
export async function getStudentPickerOptions(): Promise<StudentPickerOption[]> {
  const [students, enrollments, pendings, incomes, kinds, labels] = await Promise.all([
    prisma.student.findMany({
      orderBy: { fullName: "asc" },
      select: { id: true, fullName: true, code: true },
    }),
    prisma.enrollment.findMany({ select: { studentId: true, programLevel: true } }),
    prisma.pendingPayment.findMany({
      where: { ...ACTIVE, studentId: { not: null } },
      select: { studentId: true, programLevel: true },
    }),
    prisma.income.findMany({
      where: { ...ACTIVE, studentId: { not: null } },
      select: { studentId: true, programLevel: true },
      distinct: ["studentId", "programLevel"],
    }),
    levelKinds(),
    levelLabels(),
  ]);

  /** studentId → the level codes they hold anywhere, in first-seen order. */
  const levelsOf = new Map<string, string[]>();
  for (const r of [...enrollments, ...pendings, ...incomes]) {
    if (!r.studentId) continue;
    const list = levelsOf.get(r.studentId) ?? [];
    if (!list.includes(r.programLevel)) list.push(r.programLevel);
    levelsOf.set(r.studentId, list);
  }

  return students.map((s) => {
    const levels = levelsOf.get(s.id) ?? [];
    const lines = new Set<BusinessLine>();
    // The series that issued the code is evidence on its own - a GN-0001 with no history yet is
    // still a German Note student, and is exactly the row somebody is about to raise a fee for.
    const fromCode = parseStudentCodeParts(s.code);
    if (fromCode) lines.add(fromCode.line);
    for (const code of levels) lines.add(lineForKind(kinds.get(code)));

    return {
      value: s.id,
      label: s.fullName,
      hint: s.code ?? undefined,
      meta: levels.length ? levels.map((c) => labels[c] ?? c).join(" · ") : undefined,
      lines: [...lines],
    };
  });
}

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
    // (a GN membership but no B2 enrollment) - those live on /german-note. The old filter assumed
    // "no enrollment ⟹ GN member", which silently hid every bulk-imported student (no enrollment,
    // no GN membership yet). Show them: they are coaching students.
    prisma.student.findMany({
      where: { OR: [{ enrollments: { some: {} } }, { gnMemberships: { none: {} } }] },
      orderBy: { createdAt: "desc" },
    }),
    // Lean pass: every enrollment, scalars only. Powers the count tiles, the LTV
    // roll-ups and the list rows - none of which look at journey history.
    prisma.enrollment.findMany({
      select: {
        id: true, studentId: true, programLevel: true, status: true,
        statusChangedAt: true, enrollmentDate: true, programEndDate: true, assignedCoach: true,
        // The churn breakdown (@39:42) rides along on the pass that was already reading every
        // enrolment. A grouped query would have been a second round trip to answer a question
        // this one already has the rows for.
        discontinueReason: true,
      },
    }),
    // Rich pass: ONLY the active Guided/Elite rows the 90/120 tracker actually
    // renders. Previously the three journey collections were joined onto every
    // enrollment ever - completed and dropped ones included - and thrown away.
    prisma.enrollment.findMany({
      where: { status: "ACTIVE", programLevel: { in: ["GUIDED", "ELITE"] } },
      include: {
        student: { select: { id: true, fullName: true } },
        milestoneLogs: { select: { date: true, previousMilestone: true, newMilestone: true } },
        signalChanges: { select: { date: true, previousSignal: true, newSignal: true } },
        sprintWeeks: { select: { weekIndex: true, weekEnd: true, status: true, target: true } },
      },
    }),
    // PRD2 §4.5: averages are across COMPLETED students only - a student is
    // "completed" once any of their enrollments reaches COMPLETED status.
    prisma.satisfactionScore.findMany({
      where: { student: { enrollments: { some: { status: "COMPLETED" } } } },
    }),
    ltvByStudent(),
  ]);

  // ── Count dashboard (PRD2 §4.2) ──
  const active = enrollments.filter((e) => e.status === "ACTIVE");
  const activeStudentIds = new Set(active.map((e) => e.studentId));
  const completedThisMonthRows = enrollments.filter(
    (e) => e.status === "COMPLETED" && e.statusChangedAt >= month.start && e.statusChangedAt < month.end,
  );
  const droppedThisMonthRows = enrollments.filter(
    (e) => e.status === "DROPPED" && e.statusChangedAt >= month.start && e.statusChangedAt < month.end,
  );
  const byLevel = (rows: typeof enrollments) => ({
    SOLO: rows.filter((e) => e.programLevel === "SOLO").length,
    GUIDED: rows.filter((e) => e.programLevel === "GUIDED").length,
    ELITE: rows.filter((e) => e.programLevel === "ELITE").length,
  });
  const counts = {
    totalActive: activeStudentIds.size,
    activeSolo: active.filter((e) => e.programLevel === "SOLO").length,
    activeGuided: active.filter((e) => e.programLevel === "GUIDED").length,
    activeElite: active.filter((e) => e.programLevel === "ELITE").length,
    completedThisMonth: completedThisMonthRows.length,
    completedThisMonthByLevel: byLevel(completedThisMonthRows),
    droppedThisMonth: droppedThisMonthRows.length,
    droppedThisMonthByLevel: byLevel(droppedThisMonthRows),
    totalAllTime: students.length,
    totalCompletedAllTime: enrollments.filter((e) => e.status === "COMPLETED").length,
    totalDroppedAllTime: enrollments.filter((e) => e.status === "DROPPED").length,
    /**
     * WHY THEY STOPPED - the breakdown the founders asked for in the same breath as the button
     * (@39:42). Pure arithmetic in lib/enrollment-lifecycle.ts, over rows this pass already had.
     *
     * Both windows, because they answer different questions: the month is "what is happening
     * now", and all-time is the only one with enough rows to be a pattern. Every dropped
     * enrolment that predates the reason column tallies as "Not recorded" rather than being
     * dropped from the denominator, which would overstate whichever reason was logged first.
     */
    droppedThisMonthReasons: tallyReasons(
      droppedThisMonthRows.map((e) => ({ reason: e.discontinueReason })),
    ),
    droppedAllTimeReasons: tallyReasons(
      enrollments.filter((e) => e.status === "DROPPED").map((e) => ({ reason: e.discontinueReason })),
    ),
  };

  // ── Satisfaction averages (always visible, PRD2 §4.5) ──
  const avg = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);
  const avgSatisfaction = avg(satisfaction.map((s) => s.satisfactionScore));
  const avgNps = avg(satisfaction.map((s) => s.npsScore));
  const satisfactionBreakdown = {
    sampleSize: satisfaction.length,
    testimonialsReceived: satisfaction.filter((s) => s.testimonialReceived).length,
    jobOffersReceived: satisfaction.filter((s) => s.outcomeAchieved === "JOB_OFFER_RECEIVED").length,
  };
  const npsBreakdown = {
    promoters: satisfaction.filter((s) => s.npsScore >= 9).length,
    passives: satisfaction.filter((s) => s.npsScore >= 7 && s.npsScore <= 8).length,
    detractors: satisfaction.filter((s) => s.npsScore <= 6).length,
  };

  // ── 90/120 tracker rows: ACTIVE Guided + Elite only (PRD2 §4.3) ──
  const tracker = trackerRows
    .map((e) => {
      const totalDays = e.programLevel === "GUIDED" ? 90 : 120;
      const dayNumber = Math.min(Math.max(dayDiff(today, e.enrollmentDate) + 1, 1), totalDays);
      // Gamified journey (post-P3 layer): XP, stage title, momentum - derived, never stored
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
    satisfactionBreakdown,
    npsBreakdown,
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
    // The coach picker on the "add student" form: real team accounts plus the founder's
    // default, replacing a hardcoded two-name list. Same source the detail page uses.
    coaches: await prisma.user
      .findMany({ where: { status: "ACTIVE", role: { not: "STUDENT" } }, orderBy: { name: "asc" }, select: { id: true, name: true } }),
    defaultCoach: (await getDeliveryDefaults()).defaultCoach,
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
          batch: { select: { id: true, name: true, line: true } },
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
  /**
   * Batches an enrolment on this page could be seated into - the options behind the new batch
   * picker on each enrolment card.
   *
   * ACTIVE only: seating someone into an archived cohort is never the intent, and `seatEnrollment`
   * refuses it anyway, so offering it would only produce an error the operator cannot act on.
   *
   * The `line` rides along because the picker filters per ENROLMENT, not per student: the one-table
   * batch design lets a coaching client and a German Note learner share this list, and
   * `levelFitsBatchLine` is the rule that stops a Guided client being seated in an A1 cohort. The
   * same rule is re-applied server-side in the action - this filter is the courtesy, not the guard.
   */
  const kinds = await levelKinds();
  // The founder's default coach, so the picker pre-selects it instead of a hardcoded name.
  const { defaultCoach } = await getDeliveryDefaults();
  const seatableBatches = await prisma.batch.findMany({
    where: { status: "ACTIVE" },
    orderBy: [{ line: "asc" }, { name: "asc" }],
    select: {
      id: true,
      name: true,
      line: true,
      level: true,
      targetStrength: true,
      _count: { select: { members: true, enrollments: true } },
    },
  });

  // Active team accounts (not students) - the closer picker for the commission split.
  const teamMembers = await prisma.user.findMany({
    where: { status: "ACTIVE", role: { not: "STUDENT" } },
    orderBy: { name: "asc" },
    select: { id: true, name: true },
  });

  return {
    id: student.id,
    fullName: student.fullName,
    // "B2-0042" - shown beside the name in the profile header. The detail page is where
    // someone confirms they have the right person before ringing them, so the identifier
    // that distinguishes two "Anna Smith"s belongs here most of all (Error Log I1).
    code: student.code,
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
        // full gamified journey (XP, stage, momentum, badges) - Solo included, tracker aside
        journey: journeyFor(today, config, e, e.milestoneLogs, e.signalChanges),
        programLevel: e.programLevel,
        enrollmentDate: e.enrollmentDate.toISOString(),
        duration: e.duration,
        programEndDate: e.programEndDate?.toISOString() ?? null,
        assignedCoach: e.assignedCoach,
        closerId: e.closerId,
        closerName: e.closer?.name ?? null,
        batchId: e.batchId,
        batchName: e.batch?.name ?? null,
        /**
         * Which batch line this enrolment may be seated on - resolved HERE rather than in the
         * picker, so the client never has to re-implement `lineForLevelKind`. `null` means the
         * level is OTHER and genuinely belongs to neither line, in which case the rule is "do
         * not enforce" rather than "reject", and every batch is offered.
         */
        allowedBatchLine: (() => {
          const kind = kinds.get(e.programLevel);
          return kind ? lineForLevelKind(kind) : null;
        })(),
        status: e.status,
        /**
         * Why they stopped, and when - read straight through to the record.
         *
         * The coaching desk's "Recently stopped" list only holds 30 days, on purpose; after
         * that this is where the answer lives, which is also where whoever is asking already is.
         * `statusChangedAt` is the one clock (there is no `discontinuedAt` to disagree with it).
         */
        discontinueReason: e.discontinueReason,
        discontinueNote: e.discontinueNote,
        statusChangedAt: e.statusChangedAt.toISOString(),
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
    defaultCoach,
    seatableBatches: seatableBatches.map((b) => ({
      id: b.id,
      name: b.name,
      line: b.line,
      level: b.level,
      // "Evening A1 (6/8)" - the operator needs to see a full cohort BEFORE picking it, not as
      // a confirm dialog after. Both seating routes count, same as the capacity check itself.
      filled: b._count.members + b._count.enrollments,
      targetStrength: b.targetStrength,
    })),
  };
}

export type StudentsOverview = Awaited<ReturnType<typeof getStudentsOverview>>;
export type TrackerRow = StudentsOverview["tracker"][number];
export type StudentListRow = StudentsOverview["students"][number];
export type StudentDetail = NonNullable<Awaited<ReturnType<typeof getStudentDetail>>>;
