/**
 * DEV-ONLY Phase 2 sample data (students, OKRs, daily logs).
 * Purge: npx tsx prisma/sample-data-p2.ts --purge
 * Sample students all use @example.com emails; OKRs are matched by title — dev DB only.
 */
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();
const SAMPLE_EMAIL_DOMAIN = "@example.com";
const SAMPLE_OKR_TITLES = ["Show-up rate to 80%", "40 discovery calls", "HQ rate 50%", "120 appointments set", "Improve student engagement"];
const d = (s: string) => new Date(`${s}T00:00:00Z`);
const nameKey = (s: string) => s.trim().toLowerCase().replace(/\s+/g, " ");

function istToday(): Date {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Kolkata", year: "numeric", month: "2-digit", day: "2-digit",
  }).format(new Date());
  const [y, m, dd] = parts.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, dd));
}

async function purge() {
  const students = await prisma.student.findMany({ where: { email: { endsWith: SAMPLE_EMAIL_DOMAIN } } });
  for (const s of students) {
    await prisma.income.updateMany({ where: { studentId: s.id }, data: { studentId: null } });
  }
  // student delete cascades enrollments, satisfaction scores, milestone/signal logs
  await prisma.student.deleteMany({ where: { email: { endsWith: SAMPLE_EMAIL_DOMAIN } } });
  await prisma.oKR.deleteMany({ where: { title: { in: SAMPLE_OKR_TITLES } } });
  // daily logs are append-only by design — sample logs stay unless DB reset
  console.log("Phase 2 sample data purged (daily logs remain, append-only).");
}

async function main() {
  if (process.argv.includes("--purge")) return purge();
  const today = istToday();
  const yesterday = new Date(today); yesterday.setUTCDate(today.getUTCDate() - 1);
  const twoDaysAgo = new Date(today); twoDaysAgo.setUTCDate(today.getUTCDate() - 2);

  const users = await prisma.user.findMany();
  const uid = (n: string) => users.find((u) => u.name === n)?.id ?? null;
  const profiles = await prisma.teamProfile.findMany();
  const pid = (n: string) => profiles.find((p) => p.fullName === n)?.id;

  // ── Students (PRD2 §4) ──
  const mk = async (opts: {
    fullName: string; email: string; industry: string; internalNotes: string; leadSource?: "GHOSTED_BLUEPRINT" | "INSTAGRAM" | "YOUTUBE" | "REFERRAL";
    enrollments: Array<{
      level: "SOLO" | "GUIDED" | "ELITE"; date: string; status?: "ACTIVE" | "COMPLETED";
      signal?: "GREEN" | "AMBER" | "RED"; milestone?: "ONBOARDING" | "RESUME_BUILD" | "APPLICATIONS";
      lastSession?: string; sessionsDone?: number; sessionsPlanned?: number; nextCheckIn?: string;
    }>;
  }) => {
    const student = await prisma.student.create({
      data: {
        fullName: opts.fullName, email: opts.email, industry: opts.industry,
        leadSource: opts.leadSource ?? null, internalNotes: opts.internalNotes,
      },
    });
    for (const e of opts.enrollments) {
      const start = d(e.date);
      const days = e.level === "GUIDED" ? 90 : e.level === "ELITE" ? 120 : null;
      const end = days ? new Date(start.getTime() + days * 86400000) : null;
      await prisma.enrollment.create({
        data: {
          studentId: student.id, programLevel: e.level, enrollmentDate: start,
          duration: e.level === "SOLO" ? "LIFETIME" : e.level === "GUIDED" ? "DAYS_90" : "DAYS_120",
          programEndDate: end, assignedCoach: "Karthick",
          status: e.status ?? "ACTIVE", statusChangedAt: new Date(),
          signalColour: e.signal ?? null, signalNotes: e.signal ? "Set during weekly delivery review" : null,
          currentMilestone: e.milestone ?? "ONBOARDING",
          lastSessionDate: e.lastSession ? d(e.lastSession) : null,
          totalSessionsCompleted: e.sessionsDone ?? 0,
          totalSessionsPlanned: e.sessionsPlanned ?? null,
          nextCheckInDate: e.nextCheckIn ? d(e.nextCheckIn) : null,
          milestoneLogs: {
            create: e.milestone && e.milestone !== "ONBOARDING"
              ? [
                  { newMilestone: "ONBOARDING", updatedById: uid("Ameen") },
                  { previousMilestone: "ONBOARDING", newMilestone: e.milestone, note: "Moved ahead after coaching session", updatedById: uid("Karthick") },
                ]
              : [{ newMilestone: "ONBOARDING", updatedById: uid("Ameen") }],
          },
          signalChanges: e.signal
            ? { create: [{ newSignal: e.signal, note: "Weekly review", changedById: uid("Karthick") }] }
            : undefined,
        },
      });
    }
    // auto-link income by name (same rule as createStudent action)
    const candidates = await prisma.income.findMany({ where: { studentId: null } });
    const ids = candidates.filter((i) => nameKey(i.studentName) === nameKey(opts.fullName)).map((i) => i.id);
    if (ids.length) await prisma.income.updateMany({ where: { id: { in: ids } }, data: { studentId: student.id } });
    return student;
  };

  await mk({
    fullName: "Ravi Kumar", email: "ravi@example.com", industry: "Mechanical Engineer",
    internalNotes: "Needs weekly nudges — slow to submit resume draft",
    enrollments: [{ level: "GUIDED", date: "2026-07-01", signal: "AMBER", milestone: "ONBOARDING", lastSession: "2026-07-01", sessionsDone: 1, sessionsPlanned: 12, nextCheckIn: "2026-07-08" }],
  });
  const priya = await mk({
    fullName: "Priya Sharma", email: "priya@example.com", industry: "IT", leadSource: "GHOSTED_BLUEPRINT",
    internalNotes: "Strong momentum — targeting product-based companies",
    enrollments: [{ level: "ELITE", date: "2026-06-15", signal: "GREEN", milestone: "RESUME_BUILD", lastSession: "2026-06-30", sessionsDone: 3, sessionsPlanned: 16, nextCheckIn: "2026-07-05" }],
  });
  await mk({
    fullName: "Anna Schmidt", email: "anna@example.com", industry: "Finance", leadSource: "YOUTUBE",
    internalNotes: "Germany-based, CET timezone — gone quiet since 22 Jun, needs check-in",
    enrollments: [{ level: "GUIDED", date: "2026-06-20", signal: "RED", milestone: "ONBOARDING", lastSession: "2026-06-22", sessionsDone: 1, sessionsPlanned: 12, nextCheckIn: "2026-07-03" }],
  });
  const arjun = await mk({
    fullName: "Arjun Mehta", email: "arjun@example.com", industry: "IT", leadSource: "REFERRAL",
    internalNotes: "Upgraded Solo → Guided after landing interviews",
    enrollments: [
      { level: "SOLO", date: "2026-06-15", status: "COMPLETED" },
      { level: "GUIDED", date: "2026-07-01", signal: "GREEN", milestone: "ONBOARDING", sessionsPlanned: 12 },
    ],
  });

  // ── Satisfaction (PRD2 §4.5) ──
  await prisma.satisfactionScore.createMany({
    data: [
      { studentId: arjun.id, date: d("2026-07-01"), satisfactionScore: 9, npsScore: 9, testimonialReceived: true, outcomeAchieved: "INTERVIEWS_ONLY", notes: "Loved the resume rework — gave video testimonial" },
      { studentId: priya.id, date: d("2026-07-02"), satisfactionScore: 8, npsScore: 7, testimonialReceived: false, outcomeAchieved: "APPLICATIONS_STAGE", notes: "Happy overall — wants more mock interviews" },
    ],
  });

  // ── OKRs (PRD2 §3.2) — spread of green/amber/red ──
  const month = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), 1));
  await prisma.oKR.createMany({
    data: [
      { teamProfileId: pid("Asma")!, month, title: "Show-up rate to 80%", targetValue: "80", targetNumeric: 80, currentProgress: "72", currentNumeric: 72, notes: "Reminder sequence revamped mid-month" }, // 90% → green
      { teamProfileId: pid("Asma")!, month, title: "40 discovery calls", targetValue: "40 calls", targetNumeric: 40, currentProgress: "25 calls", currentNumeric: 25, notes: "Pacing behind — needs 5/day in final week" }, // 62.5% → amber
      { teamProfileId: pid("Asma")!, month, title: "HQ rate 50%", targetValue: "50", targetNumeric: 50, currentProgress: "20", currentNumeric: 20, notes: "Lead quality dipped after ad creative change" }, // 40% → red
      { teamProfileId: pid("Nilofer")!, month, title: "120 appointments set", targetValue: "120", targetNumeric: 120, currentProgress: "70", currentNumeric: 70, notes: "Instagram DMs converting best this month" }, // 58% → amber
      { teamProfileId: pid("Karthick")!, month, title: "Improve student engagement", targetValue: "Qualitative", manualCompletionPct: 85, notes: "Manual % — based on session attendance" }, // 85% → green
    ],
  });

  // ── Daily logs: Asma logged today; Nilofer/Karthick have history but not today ──
  const mkLog = (userName: string, date: Date, variant: "DISCOVERY_SPECIALIST" | "APPOINTMENT_SETTER" | "DELIVERY_COACH", vals: Record<string, number>) => ({
    userId: uid(userName)!, date, variant,
    notes: "Steady day — no blockers", ...vals,
  });
  await prisma.dailyLog.createMany({
    data: [
      mkLog("Asma", today, "DISCOVERY_SPECIALIST", { discoveryCallsCompleted: 4, highlyQualifiedCalls: 2, followUpsDone: 6, proposalsSent: 1, noShows: 1 }),
      mkLog("Asma", yesterday, "DISCOVERY_SPECIALIST", { discoveryCallsCompleted: 5, highlyQualifiedCalls: 3, followUpsDone: 4, proposalsSent: 2, noShows: 0 }),
      mkLog("Nilofer", yesterday, "APPOINTMENT_SETTER", { newLeadsContacted: 35, appointmentsSet: 6, followUpMessagesSent: 20, leadsAddedToPipeline: 8 }),
      mkLog("Nilofer", twoDaysAgo, "APPOINTMENT_SETTER", { newLeadsContacted: 28, appointmentsSet: 4, followUpMessagesSent: 15, leadsAddedToPipeline: 5 }),
      mkLog("Karthick", yesterday, "DELIVERY_COACH", { sessionsDelivered: 3, studentsCheckedInOn: 5, assignmentsReviewed: 4, studentsFlaggedAtRisk: 1 }),
    ],
    skipDuplicates: true,
  });

  console.log(`Phase 2 sample data created.
EXPECTED:
  Students — active 4 · by level 0/3/1 (Solo/Guided/Elite) · completed this month 1 · all-time 4
             LTV: Ravi 75k · Priya 1.2L · Anna ~54.4k · Arjun 25k → highest = Priya
             Avg LTV Solo 25k · Guided ~51.5k · Elite 1.2L · upgrade rate 25%
             Tracker: Anna RED (red-first sort) · Ravi Day 2/90 · Priya Day 18/120
  People   — Asma circles G/A/R · Nilofer A · Karthick G (manual 85%)
             Today: Asma ✓ · Nilofer/Karthick pending (⚠ after 7 PM IST)
             Avg satisfaction 8.5 · avg NPS 8.0`);
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());
