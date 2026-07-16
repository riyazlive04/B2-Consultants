import "server-only";
import { prisma } from "@/lib/prisma";
import { istToday } from "@/lib/dates";

/** People dashboards (PRD2 §3): OKR circles, daily-log status + 7PM badge, rollups. */

export function okrCompletionPct(okr: {
  manualCompletionPct: number | null;
  currentNumeric: unknown;
  targetNumeric: unknown;
}): number {
  if (okr.manualCompletionPct !== null) return okr.manualCompletionPct;
  const cur = okr.currentNumeric === null ? null : Number(okr.currentNumeric);
  const tgt = okr.targetNumeric === null ? null : Number(okr.targetNumeric);
  if (cur === null || tgt === null || tgt === 0) return 0;
  return Math.max(0, Math.min(200, (cur / tgt) * 100));
}

function istHourNow(): number {
  return parseInt(
    new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Kolkata", hour: "2-digit", hour12: false }).format(new Date()),
    10,
  );
}

const LOG_FIELDS = [
  "discoveryCallsCompleted", "highlyQualifiedCalls", "followUpsDone", "proposalsSent", "noShows",
  "newLeadsContacted", "appointmentsSet", "followUpMessagesSent", "leadsAddedToPipeline",
  "sessionsDelivered", "studentsCheckedInOn", "assignmentsReviewed", "studentsFlaggedAtRisk",
] as const;

export async function getPeopleOverview(monthStr?: string) {
  const today = istToday();
  const month = monthStr
    ? new Date(`${monthStr}-01T00:00:00Z`)
    : new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), 1));

  const [profiles, okrs, todayLogs, recentLogs] = await Promise.all([
    prisma.teamProfile.findMany({ orderBy: { orderIndex: "asc" } }),
    prisma.oKR.findMany({ where: { month }, orderBy: { createdAt: "asc" } }),
    prisma.dailyLog.findMany({ where: { date: today } }),
    prisma.dailyLog.findMany({
      orderBy: { date: "desc" },
      take: 400,
      include: { user: { select: { name: true } } },
    }),
  ]);

  const submittedUserIds = new Set(todayLogs.map((l) => l.userId));
  const badgeTime = istHourNow() >= 19; // 7:00 PM IST - visual flag only (PRD2 §3.3)

  // Gamification: consecutive-day log streak per user (survives until tonight if
  // today is still pending). Computed from the logs already in memory.
  const daysByUser = new Map<string, Set<string>>();
  for (const l of recentLogs) {
    if (!daysByUser.has(l.userId)) daysByUser.set(l.userId, new Set());
    daysByUser.get(l.userId)!.add(l.date.toISOString().slice(0, 10));
  }
  const streakFor = (userId: string | null): number => {
    if (!userId) return 0;
    const days = daysByUser.get(userId);
    if (!days) return 0;
    const cursor = new Date(today);
    if (!days.has(cursor.toISOString().slice(0, 10))) cursor.setUTCDate(cursor.getUTCDate() - 1);
    let streak = 0;
    while (days.has(cursor.toISOString().slice(0, 10))) {
      streak++;
      cursor.setUTCDate(cursor.getUTCDate() - 1);
    }
    return streak;
  };

  const members = profiles.map((p) => ({
    id: p.id,
    userId: p.userId,
    fullName: p.fullName,
    roleTitle: p.roleTitle,
    dashboardRole: p.dashboardRole,
    email: p.email,
    phone: p.phone,
    dateJoined: p.dateJoined?.toISOString() ?? null,
    keyResponsibilities: p.keyResponsibilities,
    status: p.status,
    logVariant: p.logVariant,
    orderIndex: p.orderIndex,
    firstCallSharePct: p.firstCallSharePct,
    worksSaturdays: p.worksSaturdays,
    dailyCallTarget: p.dailyCallTarget,
    logsDaily: p.dashboardRole !== "ADMIN" && p.status === "ACTIVE",
    submittedToday: p.userId ? submittedUserIds.has(p.userId) : false,
    streak: streakFor(p.userId),
    missingLogBadge:
      badgeTime && p.dashboardRole !== "ADMIN" && p.status === "ACTIVE" &&
      !!p.userId && !submittedUserIds.has(p.userId),
    okrs: okrs
      .filter((o) => o.teamProfileId === p.id)
      .map((o) => ({
        id: o.id,
        title: o.title,
        targetValue: o.targetValue,
        currentProgress: o.currentProgress,
        manualCompletionPct: o.manualCompletionPct,
        notes: o.notes,
        completionPct: okrCompletionPct(o),
      })),
  }));

  // Weekly rollup: ISO-week (Mon) buckets over the last 8 weeks, summed per user.
  const weekKey = (d: Date) => {
    const dow = (d.getUTCDay() + 6) % 7;
    const monday = new Date(d);
    monday.setUTCDate(d.getUTCDate() - dow);
    return monday.toISOString().slice(0, 10);
  };
  const rollup = new Map<string, Map<string, Record<string, number>>>(); // user → week → sums
  for (const log of recentLogs) {
    const uname = log.user.name;
    const wk = weekKey(log.date);
    if (!rollup.has(uname)) rollup.set(uname, new Map());
    const weeks = rollup.get(uname)!;
    if (!weeks.has(wk)) weeks.set(wk, {});
    const sums = weeks.get(wk)!;
    for (const f of LOG_FIELDS) {
      const v = log[f];
      if (v !== null && v !== undefined) sums[f] = (sums[f] ?? 0) + v;
    }
  }
  const weeklyRollup = [...rollup.entries()].map(([user, weeks]) => ({
    user,
    weeks: [...weeks.entries()]
      .sort(([a], [b]) => b.localeCompare(a))
      .slice(0, 8)
      .map(([week, sums]) => ({ week, sums })),
  }));

  // Monthly rollup (PRD2 §3.3): same daily numbers summed into calendar-month
  // buckets (YYYY-MM), last 6 months per user.
  const monthRollup = new Map<string, Map<string, Record<string, number>>>();
  for (const log of recentLogs) {
    const uname = log.user.name;
    const mk = log.date.toISOString().slice(0, 7);
    if (!monthRollup.has(uname)) monthRollup.set(uname, new Map());
    const months = monthRollup.get(uname)!;
    if (!months.has(mk)) months.set(mk, {});
    const sums = months.get(mk)!;
    for (const f of LOG_FIELDS) {
      const v = log[f];
      if (v !== null && v !== undefined) sums[f] = (sums[f] ?? 0) + v;
    }
  }
  const monthlyRollup = [...monthRollup.entries()].map(([user, months]) => ({
    user,
    months: [...months.entries()]
      .sort(([a], [b]) => b.localeCompare(a))
      .slice(0, 6)
      .map(([month, sums]) => ({ month, sums })),
  }));

  return {
    month: month.toISOString().slice(0, 7),
    members,
    weeklyRollup,
    monthlyRollup,
    logs: recentLogs.map((l) => ({
      id: l.id,
      user: l.user.name,
      date: l.date.toISOString(),
      variant: l.variant,
      values: Object.fromEntries(
        LOG_FIELDS.map((f) => [f, l[f]]).filter(([, v]) => v !== null && v !== undefined),
      ) as Record<string, number>,
      notes: l.notes,
      correctionNote: l.correctionNote,
    })),
  };
}

/** Data for /daily-log - the member's own form, submissions, streak and OKRs. */
export async function getMyDailyLogView(userId: string) {
  const today = istToday();
  const [profile, todayLog, myLogs] = await Promise.all([
    prisma.teamProfile.findUnique({ where: { userId } }),
    prisma.dailyLog.findUnique({ where: { userId_date: { userId, date: today } } }),
    prisma.dailyLog.findMany({ where: { userId }, orderBy: { date: "desc" }, take: 120 }),
  ]);

  // streak: consecutive days ending today (or yesterday while today is pending)
  const days = new Set(myLogs.map((l) => l.date.toISOString().slice(0, 10)));
  const cursor = new Date(today);
  if (!days.has(cursor.toISOString().slice(0, 10))) cursor.setUTCDate(cursor.getUTCDate() - 1);
  let streak = 0;
  while (days.has(cursor.toISOString().slice(0, 10))) {
    streak++;
    cursor.setUTCDate(cursor.getUTCDate() - 1);
  }
  const month = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), 1));
  const okrs = profile
    ? await prisma.oKR.findMany({ where: { teamProfileId: profile.id, month }, orderBy: { createdAt: "asc" } })
    : [];

  // Auto activity-capture (report §3.A P1): pre-fill today's numbers from what this
  // user ACTUALLY entered in the pipeline today - kills re-keying, keeps data honest.
  // The member can still adjust before submitting; the log stays the human record.
  const istDayStartUtc = new Date(today.getTime() - 5.5 * 3600000); // IST midnight in UTC
  const istDayEndUtc = new Date(istDayStartUtc.getTime() + 86400000);
  const tsRange = { gte: istDayStartUtc, lt: istDayEndUtc };
  const autoCaptured: Record<string, number> = {};
  if (profile?.logVariant === "DISCOVERY_SPECIALIST") {
    const [outcomes, proposals, followUps] = await Promise.all([
      prisma.discoveryOutcome.findMany({ where: { enteredById: userId, callDate: today } }),
      prisma.leadStageHistory.count({
        where: { changedById: userId, toStage: "PROPOSAL_SENT", changedAt: tsRange },
      }),
      // follow-ups done today = outcomes this user marked "follow up needed" today
      prisma.discoveryOutcome.count({
        where: { enteredById: userId, outcome: "FOLLOW_UP_NEEDED", callDate: today },
      }),
    ]);
    autoCaptured.discoveryCallsCompleted = outcomes.length;
    autoCaptured.highlyQualifiedCalls = outcomes.filter((o) => o.highlyQualified).length;
    autoCaptured.noShows = outcomes.filter((o) => o.outcome === "NO_SHOW").length;
    autoCaptured.proposalsSent = proposals;
    autoCaptured.followUpsDone = followUps;
  } else if (profile?.logVariant === "APPOINTMENT_SETTER") {
    const [leadsAdded, appointments, contacted] = await Promise.all([
      prisma.lead.count({ where: { enteredById: userId, createdAt: tsRange } }),
      prisma.leadStageHistory.count({
        where: { changedById: userId, toStage: "DISCO_BOOKED", changedAt: tsRange },
      }),
      // new leads contacted today = leads this setter owns whose first-contact was stamped
      // today (speed-to-lead: markLeadContacted). Follow-up MESSAGES have no source until
      // the Wave-2 WhatsApp channel - that field stays manual.
      prisma.lead.count({
        where: {
          OR: [{ assignedToId: userId }, { enteredById: userId }],
          contactedAt: tsRange,
        },
      }),
    ]);
    autoCaptured.leadsAddedToPipeline = leadsAdded;
    autoCaptured.appointmentsSet = appointments;
    autoCaptured.newLeadsContacted = contacted;
  } else if (profile?.logVariant === "DELIVERY_COACH") {
    // Karthick is the sole coach, so student-level activity today attributes to him.
    const [sessions, atRisk] = await Promise.all([
      prisma.enrollment.count({ where: { lastSessionDate: today } }),
      prisma.signalChangeLog.count({ where: { changedById: userId, newSignal: "RED", date: tsRange } }),
    ]);
    autoCaptured.sessionsDelivered = sessions;
    autoCaptured.studentsFlaggedAtRisk = atRisk;
    // check-ins + assignments reviewed have no clean per-event source yet - manual.
  }

  return {
    autoCaptured,
    variant: profile?.logVariant ?? null,
    fullName: profile?.fullName ?? "",
    submittedToday: !!todayLog,
    streak,
    today: today.toISOString(),
    okrs: okrs.map((o) => ({
      id: o.id,
      title: o.title,
      targetValue: o.targetValue,
      currentProgress: o.currentProgress,
      completionPct: okrCompletionPct(o),
      notes: o.notes,
    })),
    myLogs: myLogs.slice(0, 30).map((l) => ({
      id: l.id,
      date: l.date.toISOString(),
      values: Object.fromEntries(
        LOG_FIELDS.map((f) => [f, l[f]]).filter(([, v]) => v !== null && v !== undefined),
      ) as Record<string, number>,
      notes: l.notes,
      correctionNote: l.correctionNote,
    })),
  };
}

export type PeopleOverview = Awaited<ReturnType<typeof getPeopleOverview>>;
export type MemberRow = PeopleOverview["members"][number];
export type MyDailyLogView = Awaited<ReturnType<typeof getMyDailyLogView>>;
