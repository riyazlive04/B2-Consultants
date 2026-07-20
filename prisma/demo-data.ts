/**
 * PRODUCTION-STYLE DEMO DATASET — one command, full coherent history.
 *
 *   npm run db:demo
 *
 * What it does:
 *   1. Wipes ALL business data (TRUNCATE — bypasses the append-only row triggers,
 *      which is intentional: this is a dataset reset, not a business mutation).
 *      Auth users, sessions and team profiles are KEPT.
 *   2. Seeds ~5 months of coherent history (Feb → today, dates are computed
 *      relative to "today" in IST so the demo always looks live):
 *        Finance   — income (growth trend, INR + EUR), expenses, pending payments
 *        Pipeline  — ~65 leads with full stage history, discovery outcomes + BANT
 *        Students  — 14 students, milestone journeys, signals, satisfaction
 *        People    — OKRs (3 months), daily logs with real streak runs
 *        Funnel    — 20 weekly snapshots · Cash — weekly balances, payables
 *        Bookings  — open slots + booking requests
 *        Arena     — everything above derives XP/badges/quests at read time
 *   3. Resets the four team passwords + the student portal login from .env
 *      (SEED_*_PASSWORD vars) so the demo credentials always work.
 *
 * Safety: refuses to run against a non-localhost DATABASE_URL unless --force.
 */
import { PrismaClient, Prisma } from "@prisma/client";
import { betterAuth } from "better-auth";
import { prismaAdapter } from "better-auth/adapters/prisma";

const prisma = new PrismaClient();
const FX = new Prisma.Decimal("108.7435");
const inr = (major: number) => BigInt(Math.round(major * 100));
const eur = (major: number) => BigInt(Math.round(major * 100));

// ── deterministic pseudo-random (stable across runs) ──
let rngState = 424242;
const rng = () => (rngState = (rngState * 1103515245 + 12345) % 2147483648) / 2147483648;
const pick = <T,>(arr: T[]) => arr[Math.floor(rng() * arr.length)];
const between = (lo: number, hi: number) => lo + Math.floor(rng() * (hi - lo + 1));

// ── date helpers (anchor = today in IST, stored as UTC date-only) ──
function istToday(): Date {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Kolkata", year: "numeric", month: "2-digit", day: "2-digit",
  }).format(new Date());
  const [y, m, dd] = parts.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, dd));
}
const TODAY = istToday();
const daysAgo = (n: number) => new Date(TODAY.getTime() - n * 86400000);
const daysAhead = (n: number) => new Date(TODAY.getTime() + n * 86400000);
/** timestamp on a date-only day, at hh:mm IST (stored UTC) */
const at = (d: Date, hh: number, mm = 0) =>
  new Date(d.getTime() + ((hh - 5) * 60 + (mm - 30)) * 60000);
const monthStart = (d: Date) => new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1));
const lastMonday = (d: Date) => {
  const dow = (d.getUTCDay() + 6) % 7; // Monday=0
  return new Date(d.getTime() - dow * 86400000);
};

async function resetBusinessData() {
  // Row-level append-only triggers fire on UPDATE/DELETE, not TRUNCATE — a full
  // dataset reset is the one sanctioned way to clear audit history.
  await prisma.$executeRawUnsafe(`
    TRUNCATE TABLE
      "income", "expense", "pending_payment", "monthly_target",
      "lead", "lead_stage_history", "discovery_outcome",
      "appointment_slot", "booking_request",
      "okr", "daily_log",
      "student", "enrollment", "milestone_log", "signal_change_log", "satisfaction_score",
      "gn_batch", "gn_batch_member", "gn_module", "gn_recording", "gn_recording_watch",
      "gn_event", "gn_post", "gn_comment", "gn_like", "gn_comment_like",
      "weekly_funnel_snapshot", "cash_position", "payable", "fx_rate"
    CASCADE
  `);
  console.log("· business data wiped (users, sessions, team profiles kept)");
}

type Ids = { ameen: string; karthick: string; asma: string; nilofer: string };

async function getTeam(): Promise<{ ids: Ids; pids: Record<string, string> }> {
  const users = await prisma.user.findMany();
  const uid = (n: string) => {
    const u = users.find((x) => x.name === n);
    if (!u) throw new Error(`Seed user "${n}" missing — run \`npm run db:seed\` first`);
    return u.id;
  };
  const profiles = await prisma.teamProfile.findMany();
  const pids: Record<string, string> = {};
  for (const p of profiles) pids[p.fullName] = p.id;
  return { ids: { ameen: uid("Ameen"), karthick: uid("Karthick"), asma: uid("Asma"), nilofer: uid("Nilofer") }, pids };
}

// ───────────────────────── Students + enrollments + program income ─────────────────────────

const MILESTONE_ORDER = [
  "ONBOARDING", "RESUME_BUILD", "LINKEDIN_OPTIMISATION", "APPLICATIONS", "INTERVIEWS", "OFFER_RECEIVED", "COMPLETED",
] as const;
type MilestoneT = (typeof MILESTONE_ORDER)[number];

type StudentSpec = {
  name: string; email: string; phone: string; industry: string; targetRole: string;
  leadSource: "INSTAGRAM" | "YOUTUBE" | "LINKEDIN" | "REFERRAL" | "META_ADS" | "GHOSTED_BLUEPRINT" | "WORKSHOP" | "WHATSAPP";
  level: "SOLO" | "GUIDED" | "ELITE";
  enrolledDaysAgo: number;
  milestone: MilestoneT;
  status?: "ACTIVE" | "COMPLETED" | "DROPPED" | "PAUSED";
  statusChangedDaysAgo?: number;
  signal?: "GREEN" | "AMBER" | "RED";
  signalPath?: Array<{ to: "GREEN" | "AMBER" | "RED"; daysAgo: number; note: string }>;
  nextCheckInDays?: number;       // relative to today (negative = overdue)
  sessionsDone?: number; sessionsPlanned?: number; lastSessionDaysAgo?: number;
  apps?: number; interviews?: number;
  paysEur?: boolean; paidPct?: number; // fraction of fee collected so far
  notes: string;
  lastTask?: string; lastTaskDone?: "YES" | "NO" | "PENDING";
  priorSolo?: { enrolledDaysAgo: number; completedDaysAgo: number }; // upgrade story
};

const FEES: Record<string, number> = { SOLO: 25000, GUIDED: 150000, ELITE: 250000 };
const FEES_EUR: Record<string, number> = { SOLO: 260, GUIDED: 1400, ELITE: 2300 };

const STUDENTS: StudentSpec[] = [
  { name: "Ravi Kumar", email: "ravi.kumar@example.com", phone: "+91 98111 44001", industry: "Mechanical Engineering", targetRole: "Design Engineer", leadSource: "INSTAGRAM", level: "GUIDED", enrolledDaysAgo: 70, milestone: "INTERVIEWS", signal: "GREEN",
    signalPath: [{ to: "GREEN", daysAgo: 62, note: "Strong start — resume draft in on time" }, { to: "AMBER", daysAgo: 35, note: "Missed two sessions while travelling" }, { to: "GREEN", daysAgo: 21, note: "Back on track, 12 applications out" }],
    nextCheckInDays: 4, sessionsDone: 9, sessionsPlanned: 12, lastSessionDaysAgo: 2, apps: 18, interviews: 3, paidPct: 0.5,
    notes: "Interviewing with two Mittelstand firms — prep mock scheduled", lastTask: "Prepare STAR answers for Bosch interview", lastTaskDone: "PENDING" },
  { name: "Priya Sharma", email: "priya.sharma@example.com", phone: "+91 98111 44002", industry: "IT — Fullstack", targetRole: "Senior Software Engineer", leadSource: "GHOSTED_BLUEPRINT", level: "ELITE", enrolledDaysAgo: 85, milestone: "OFFER_RECEIVED", signal: "GREEN",
    signalPath: [{ to: "GREEN", daysAgo: 78, note: "Excellent momentum from week one" }],
    nextCheckInDays: 7, sessionsDone: 14, sessionsPlanned: 16, lastSessionDaysAgo: 3, apps: 25, interviews: 5, paidPct: 1,
    notes: "Offer from SAP partner in Walldorf — negotiating start date", lastTask: "Review contract clauses with coach", lastTaskDone: "YES" },
  { name: "Anna Schmidt", email: "anna.schmidt@example.com", phone: "+49 171 555 3402", industry: "Finance", targetRole: "Financial Analyst", leadSource: "YOUTUBE", level: "GUIDED", enrolledDaysAgo: 42, milestone: "APPLICATIONS", signal: "AMBER",
    signalPath: [{ to: "GREEN", daysAgo: 35, note: "Onboarding done, engaged" }, { to: "RED", daysAgo: 18, note: "Went quiet for 10 days — no session response" }, { to: "AMBER", daysAgo: 6, note: "Re-engaged after check-in call, needs weekly nudges" }],
    nextCheckInDays: 1, sessionsDone: 5, sessionsPlanned: 12, lastSessionDaysAgo: 6, apps: 6, interviews: 0, paysEur: true, paidPct: 1,
    notes: "Germany-based (CET). Prefers evening sessions", lastTask: "Submit 5 applications via StepStone", lastTaskDone: "NO" },
  { name: "Arjun Mehta", email: "arjun.mehta@example.com", phone: "+91 98111 44004", industry: "IT — DevOps", targetRole: "Platform Engineer", leadSource: "REFERRAL", level: "GUIDED", enrolledDaysAgo: 55, milestone: "INTERVIEWS", signal: "GREEN",
    signalPath: [{ to: "GREEN", daysAgo: 48, note: "Upgrade student — already has momentum" }],
    nextCheckInDays: 5, sessionsDone: 8, sessionsPlanned: 12, lastSessionDaysAgo: 4, apps: 14, interviews: 2, paidPct: 1,
    notes: "Upgraded Solo → Guided after landing first interviews on his own",
    lastTask: "Follow up with Siemens recruiter", lastTaskDone: "YES",
    priorSolo: { enrolledDaysAgo: 130, completedDaysAgo: 60 } },
  { name: "Sneha Reddy", email: "sneha.reddy@example.com", phone: "+91 98111 44005", industry: "Data Science", targetRole: "Data Scientist", leadSource: "LINKEDIN", level: "GUIDED", enrolledDaysAgo: 105, milestone: "COMPLETED", status: "COMPLETED", statusChangedDaysAgo: 14, signal: "GREEN",
    signalPath: [{ to: "GREEN", daysAgo: 98, note: "Flying through milestones" }],
    sessionsDone: 12, sessionsPlanned: 12, lastSessionDaysAgo: 16, apps: 30, interviews: 6, paidPct: 1,
    notes: "Placed — Data Scientist at a Berlin scale-up. Case study candidate", lastTask: "Record video testimonial", lastTaskDone: "YES" },
  { name: "Vikram Nair", email: "vikram.nair@example.com", phone: "+91 98111 44006", industry: "Automotive", targetRole: "Quality Manager", leadSource: "META_ADS", level: "ELITE", enrolledDaysAgo: 58, milestone: "APPLICATIONS", signal: "GREEN",
    signalPath: [{ to: "GREEN", daysAgo: 50, note: "Good start" }, { to: "RED", daysAgo: 30, note: "Family emergency — paused all work" }, { to: "GREEN", daysAgo: 12, note: "Rescued: back with 8 applications in one week" }],
    nextCheckInDays: 3, sessionsDone: 7, sessionsPlanned: 16, lastSessionDaysAgo: 1, apps: 11, interviews: 1, paidPct: 0.5,
    notes: "Comeback story — watch workload, don't overload", lastTask: "Tailor CV for automotive QM roles", lastTaskDone: "YES" },
  { name: "Deepa Krishnan", email: "deepa.krishnan@example.com", phone: "+91 98111 44007", industry: "Pharma", targetRole: "Regulatory Affairs Specialist", leadSource: "INSTAGRAM", level: "GUIDED", enrolledDaysAgo: 28, milestone: "LINKEDIN_OPTIMISATION", signal: "GREEN",
    signalPath: [{ to: "GREEN", daysAgo: 21, note: "Consistent, quick turnarounds" }],
    nextCheckInDays: 2, sessionsDone: 4, sessionsPlanned: 12, lastSessionDaysAgo: 3, apps: 0, interviews: 0, paidPct: 1,
    notes: "Strong English, needs German A2 push for pharma roles", lastTask: "Publish 2 LinkedIn posts on GMP experience", lastTaskDone: "PENDING" },
  { name: "Mohammed Faisal", email: "mohammed.faisal@example.com", phone: "+91 98111 44008", industry: "Civil Engineering", targetRole: "Site Manager", leadSource: "WHATSAPP", level: "GUIDED", enrolledDaysAgo: 63, milestone: "APPLICATIONS", signal: "AMBER",
    signalPath: [{ to: "GREEN", daysAgo: 55, note: "Steady start" }, { to: "AMBER", daysAgo: 9, note: "Applications slowed + instalment overdue" }],
    nextCheckInDays: -2, sessionsDone: 7, sessionsPlanned: 12, lastSessionDaysAgo: 8, apps: 9, interviews: 1, paidPct: 0.5,
    notes: "Check-in overdue — chase instalment gently on the same call", lastTask: "Apply to 5 Bau companies", lastTaskDone: "NO" },
  { name: "Kavya Menon", email: "kavya.menon@example.com", phone: "+91 98111 44009", industry: "UX Design", targetRole: "Product Designer", leadSource: "INSTAGRAM", level: "ELITE", enrolledDaysAgo: 21, milestone: "RESUME_BUILD", signal: "GREEN",
    signalPath: [{ to: "GREEN", daysAgo: 14, note: "Portfolio review went well" }],
    nextCheckInDays: 6, sessionsDone: 3, sessionsPlanned: 16, lastSessionDaysAgo: 2, apps: 0, interviews: 0, paidPct: 0.5,
    notes: "Excellent portfolio — fast-track candidate", lastTask: "German-format CV v2", lastTaskDone: "PENDING" },
  { name: "Rahul Verma", email: "rahul.verma@example.com", phone: "+91 98111 44010", industry: "Sales", targetRole: "Business Development", leadSource: "META_ADS", level: "GUIDED", enrolledDaysAgo: 77, milestone: "RESUME_BUILD", status: "DROPPED", statusChangedDaysAgo: 35,
    signalPath: [{ to: "AMBER", daysAgo: 60, note: "Low engagement from week two" }, { to: "RED", daysAgo: 45, note: "Unresponsive for 2 weeks" }],
    sessionsDone: 2, sessionsPlanned: 12, lastSessionDaysAgo: 50, apps: 0, interviews: 0, paidPct: 0.5,
    notes: "Dropped — visa situation changed. Refund not applicable per T&C" },
  { name: "Ananya Das", email: "ananya.das@example.com", phone: "+91 98111 44011", industry: "HR", targetRole: "HR Business Partner", leadSource: "WORKSHOP", level: "SOLO", enrolledDaysAgo: 40, milestone: "ONBOARDING",
    paidPct: 1, notes: "Solo plan — self-paced, lifetime community access" },
  { name: "Thomas Müller", email: "thomas.mueller@example.com", phone: "+49 160 555 8811", industry: "Logistics", targetRole: "Supply Chain Manager", leadSource: "YOUTUBE", level: "ELITE", enrolledDaysAgo: 95, milestone: "INTERVIEWS", signal: "GREEN",
    signalPath: [{ to: "GREEN", daysAgo: 88, note: "Already in Germany — network advantage" }],
    nextCheckInDays: 3, sessionsDone: 12, sessionsPlanned: 16, lastSessionDaysAgo: 5, apps: 22, interviews: 4, paysEur: true, paidPct: 1,
    notes: "Career-switcher inside Germany; targeting DHL & Kühne+Nagel", lastTask: "Second-round prep — logistics KPIs deck", lastTaskDone: "YES" },
  { name: "Divya Pillai", email: "divya.pillai@example.com", phone: "+91 98111 44013", industry: "Nursing", targetRole: "Registered Nurse (Pflege)", leadSource: "REFERRAL", level: "GUIDED", enrolledDaysAgo: 10, milestone: "ONBOARDING",
    nextCheckInDays: 4, sessionsDone: 1, sessionsPlanned: 12, lastSessionDaysAgo: 7, apps: 0, interviews: 0, paidPct: 0.33,
    notes: "Kerala-based nurse — B1 German already, strong profile for Pflege track", lastTask: "Collect documents for anerkennung", lastTaskDone: "PENDING" },
  { name: "Suresh Babu", email: "suresh.babu@example.com", phone: "+91 98111 44014", industry: "Electrical Engineering", targetRole: "Commissioning Engineer", leadSource: "LINKEDIN", level: "GUIDED", enrolledDaysAgo: 115, milestone: "COMPLETED", status: "COMPLETED", statusChangedDaysAgo: 42, signal: "GREEN",
    signalPath: [{ to: "GREEN", daysAgo: 108, note: "Model student" }],
    sessionsDone: 12, sessionsPlanned: 12, lastSessionDaysAgo: 44, apps: 27, interviews: 5, paidPct: 1,
    notes: "Placed — commissioning engineer near Stuttgart. Referred Divya", lastTask: "Alumni referral intro", lastTaskDone: "YES" },
];

async function seedStudents(ids: Ids) {
  const studentIdByName: Record<string, string> = {};
  let satisfactionCount = 0;

  for (const s of STUDENTS) {
    const enrolled = daysAgo(s.enrolledDaysAgo);
    const duration = s.level === "SOLO" ? "LIFETIME" : s.level === "GUIDED" ? "DAYS_90" : "DAYS_120";
    const endDays = s.level === "GUIDED" ? 90 : s.level === "ELITE" ? 120 : null;

    const student = await prisma.student.create({
      data: {
        fullName: s.name, email: s.email, phone: s.phone, industry: s.industry,
        targetRole: s.targetRole, leadSource: s.leadSource, internalNotes: s.notes,
        createdAt: enrolled,
      },
    });
    studentIdByName[s.name] = student.id;

    // Optional prior SOLO enrollment (upgrade story)
    if (s.priorSolo) {
      const soloStart = daysAgo(s.priorSolo.enrolledDaysAgo);
      await prisma.enrollment.create({
        data: {
          studentId: student.id, programLevel: "SOLO", enrollmentDate: soloStart,
          duration: "LIFETIME", assignedCoach: "Karthick", status: "COMPLETED",
          statusChangedAt: at(daysAgo(s.priorSolo.completedDaysAgo), 18),
          currentMilestone: "COMPLETED", totalSessionsCompleted: 0,
          milestoneLogs: { create: [
            { date: at(soloStart, 11), newMilestone: "ONBOARDING", updatedById: ids.ameen, note: "Solo plan activated" },
            { date: at(daysAgo(s.priorSolo.completedDaysAgo), 18), previousMilestone: "ONBOARDING", newMilestone: "COMPLETED", updatedById: ids.karthick, note: "Self-paced track finished — upgrading to Guided" },
          ] },
        },
      });
      const soloFee = FEES.SOLO;
      await prisma.income.create({
        data: {
          date: soloStart, studentName: s.name, studentId: student.id,
          amountInrMinor: inr(soloFee), amountEurMinor: BigInt(0), fxRateUsed: FX,
          programLevel: "SOLO", paymentType: "FULL_PAYMENT", paymentMethod: "UPI",
          notes: "Solo plan — paid upfront", enteredById: ids.ameen, createdAt: at(soloStart, 12),
        },
      });
    }

    // Main enrollment
    const milestoneIdx = MILESTONE_ORDER.indexOf(s.milestone);
    const isDropped = s.status === "DROPPED";
    const statusChangedAt = s.statusChangedDaysAgo != null ? at(daysAgo(s.statusChangedDaysAgo), 17) : at(enrolled, 10);

    // milestone logs: spaced roughly evenly from enrollment to (now or completion)
    const journeyEndDaysAgo = s.statusChangedDaysAgo ?? 2;
    const journeyDays = Math.max(s.enrolledDaysAgo - journeyEndDaysAgo, 1);
    const msLogs: Prisma.MilestoneLogCreateWithoutEnrollmentInput[] = [];
    for (let i = 0; i <= milestoneIdx; i++) {
      const when = i === 0
        ? at(enrolled, 11)
        : at(daysAgo(Math.round(s.enrolledDaysAgo - (journeyDays * i) / milestoneIdx)), between(10, 18));
      msLogs.push({
        date: when,
        previousMilestone: i === 0 ? null : MILESTONE_ORDER[i - 1],
        newMilestone: MILESTONE_ORDER[i],
        updatedBy: { connect: { id: i === 0 ? ids.ameen : ids.karthick } },
        note: i === 0 ? "Enrolled and onboarded" : pick([
          "Moved ahead after coaching session",
          "Milestone review passed — next phase unlocked",
          "Deliverables approved in weekly review",
          "Cleared checklist with coach",
        ]),
      });
    }

    const enrollment = await prisma.enrollment.create({
      data: {
        studentId: student.id, programLevel: s.level, enrollmentDate: enrolled, duration,
        programEndDate: endDays ? new Date(enrolled.getTime() + endDays * 86400000) : null,
        assignedCoach: "Karthick",
        status: s.status ?? "ACTIVE", statusChangedAt,
        currentMilestone: s.milestone,
        signalColour: isDropped ? "RED" : s.signal ?? null,
        signalNotes: s.signalPath?.length ? s.signalPath[s.signalPath.length - 1].note : null,
        nextCheckInDate: s.nextCheckInDays != null ? daysAhead(s.nextCheckInDays) : null,
        lastSessionDate: s.lastSessionDaysAgo != null ? daysAgo(s.lastSessionDaysAgo) : null,
        totalSessionsCompleted: s.sessionsDone ?? 0,
        totalSessionsPlanned: s.sessionsPlanned ?? null,
        applicationsSubmitted: s.apps ?? 0,
        interviewsReceived: s.interviews ?? 0,
        lastTaskAssigned: s.lastTask ?? null,
        lastTaskCompleted: s.lastTaskDone ?? null,
        createdAt: at(enrolled, 10),
        milestoneLogs: { create: msLogs },
        signalChanges: s.signalPath?.length
          ? { create: s.signalPath.map((sig, i) => ({
              date: at(daysAgo(sig.daysAgo), 16),
              previousSignal: i === 0 ? null : s.signalPath![i - 1].to,
              newSignal: sig.to, note: sig.note,
              changedBy: { connect: { id: ids.karthick } },
            })) }
          : undefined,
      },
    });

    // Program-fee income (instalments where paidPct < 1)
    const feeInr = FEES[s.level];
    const feeEur = FEES_EUR[s.level];
    const paidPct = s.paidPct ?? 1;
    const mk = (dayOffset: number, pct: number, type: "FULL_PAYMENT" | "INSTALMENT", note: string) =>
      prisma.income.create({
        data: {
          date: new Date(enrolled.getTime() + dayOffset * 86400000),
          studentName: s.name, studentId: student.id, enrollmentId: enrollment.id,
          amountInrMinor: s.paysEur ? BigInt(0) : inr(feeInr * pct),
          amountEurMinor: s.paysEur ? eur(feeEur * pct) : BigInt(0),
          fxRateUsed: FX, programLevel: s.level, paymentType: type,
          paymentMethod: s.paysEur ? pick(["PAYPAL", "BANK_TRANSFER_EUR"]) : pick(["UPI", "RAZORPAY", "BANK_TRANSFER_INR"]),
          notes: note, enteredById: ids.ameen,
          createdAt: at(new Date(enrolled.getTime() + dayOffset * 86400000), 12),
        },
      });

    if (paidPct >= 1) {
      if (s.level === "SOLO" || rng() < 0.5) {
        await mk(0, 1, "FULL_PAYMENT", "Paid in full at enrolment");
      } else {
        await mk(0, 0.5, "INSTALMENT", `1st of 2 instalments — ${s.paysEur ? "€" + feeEur / 2 : "₹" + (feeInr / 2).toLocaleString("en-IN")} of ${s.paysEur ? "€" + feeEur : "₹" + feeInr.toLocaleString("en-IN")}`);
        await mk(Math.min(30, s.enrolledDaysAgo), 0.5, "INSTALMENT", "2nd of 2 instalments — fee cleared");
      }
    } else if (paidPct >= 0.4) {
      await mk(0, 0.5, "INSTALMENT", `1st of 2 instalments — balance due day 30`);
    } else {
      await mk(0, paidPct, "INSTALMENT", `Booking instalment — plan is 3 parts`);
    }

    // Pending payment rows for anyone not fully paid
    if (paidPct < 1 && !isDropped) {
      const overdue = s.name === "Mohammed Faisal";
      await prisma.pendingPayment.create({
        data: {
          studentName: s.name, studentId: student.id, programLevel: s.level,
          totalFeeInrMinor: s.paysEur ? BigInt(0) : inr(feeInr),
          totalFeeEurMinor: s.paysEur ? eur(feeEur) : BigInt(0),
          fxRateUsed: FX,
          nextDueDate: overdue ? daysAgo(5) : daysAhead(between(5, 18)),
          status: overdue ? "OVERDUE" : "ACTIVE",
          notes: overdue ? "2nd instalment overdue — reminder sent on WhatsApp" : "On instalment plan — auto-reminder scheduled",
        },
      });
    }
    if (isDropped) {
      await prisma.pendingPayment.create({
        data: {
          studentName: s.name, studentId: student.id, programLevel: s.level,
          totalFeeInrMinor: inr(FEES[s.level]), totalFeeEurMinor: BigInt(0), fxRateUsed: FX,
          nextDueDate: null, status: "DROPPED", notes: "Student dropped — balance written off",
        },
      });
    }

    // Satisfaction for students far enough along
    if (["OFFER_RECEIVED", "COMPLETED", "INTERVIEWS"].includes(s.milestone) && s.status !== "DROPPED") {
      satisfactionCount++;
      await prisma.satisfactionScore.create({
        data: {
          studentId: student.id, date: daysAgo(between(3, 20)),
          satisfactionScore: between(8, 10), npsScore: between(7, 10),
          testimonialReceived: s.milestone !== "INTERVIEWS",
          outcomeAchieved: s.milestone === "INTERVIEWS" ? "INTERVIEWS_ONLY" : "JOB_OFFER_RECEIVED",
          notes: pick([
            "Loved the structured milestone approach",
            "Resume rework made the difference — more callbacks in 2 weeks than 6 months alone",
            "Would recommend to colleagues targeting Germany",
            "Coaching calls kept me accountable every week",
          ]),
        },
      });
    }
  }
  console.log(`· ${STUDENTS.length} students + enrollments + program income + ${satisfactionCount} satisfaction scores`);
  return studentIdByName;
}

// ───────────────────────── Pipeline: leads + stage history + outcomes ─────────────────────────

const LEAD_FIRST = ["Aditya", "Meera", "Rohan", "Ishita", "Karan", "Nandini", "Farhan", "Pooja", "Siddharth", "Lakshmi", "Nikhil", "Shreya", "Imran", "Gayathri", "Varun", "Aisha", "Manoj", "Ritika", "Sameer", "Anjali", "Harish", "Tanvi", "Yusuf", "Swati", "Pranav", "Neha", "Ashwin", "Fatima", "Rajesh", "Divya", "Kiran", "Sonal", "Abhishek", "Zara", "Ganesh"];
const LEAD_LAST = ["Iyer", "Bose", "Chopra", "Menon", "Sethi", "Rao", "Shaikh", "Agarwal", "Nambiar", "Kulkarni", "Reddy", "Batra", "Khan", "Pillai", "Joshi", "Fernandes", "Gupta", "Malhotra", "Ansari", "Desai"];
const CITIES = ["Bengaluru", "Chennai", "Hyderabad", "Pune", "Kochi", "Mumbai", "Coimbatore", "Delhi NCR", "Thiruvananthapuram", "Mangaluru"];
const INDUSTRIES = ["IT — Fullstack", "Mechanical Engineering", "Data Science", "Automotive", "Pharma", "Finance", "Civil Engineering", "Logistics", "UX Design", "Electrical Engineering", "Nursing", "HR"];
const LEAD_SOURCES = ["INSTAGRAM", "INSTAGRAM", "INSTAGRAM", "META_ADS", "META_ADS", "YOUTUBE", "YOUTUBE", "LINKEDIN", "REFERRAL", "WHATSAPP", "GHOSTED_BLUEPRINT", "GHOSTED_BLUEPRINT", "LANDING_PAGE", "WORKSHOP"] as const;

async function seedPipeline(ids: Ids, studentIdByName: Record<string, string>) {
  let leadCount = 0, outcomeCount = 0;
  const usedNames = new Set<string>(STUDENTS.map((s) => s.name));

  const nextName = () => {
    for (let i = 0; i < 50; i++) {
      const n = `${pick(LEAD_FIRST)} ${pick(LEAD_LAST)}`;
      if (!usedNames.has(n)) { usedNames.add(n); return n; }
    }
    return `${pick(LEAD_FIRST)} ${pick(LEAD_LAST)} ${between(2, 99)}`;
  };

  type StagePlan = { stage: string; wonLevel?: "SOLO" | "GUIDED" | "ELITE" };

  const createLead = async (opts: {
    name: string; phone: string; source: string; dateInDaysAgo: number; plan: StagePlan;
    studentName?: string; industry?: string; email?: string;
  }) => {
    const dateIn = daysAgo(opts.dateInDaysAgo);
    const assignedTo = rng() < 0.7 ? ids.nilofer : ids.asma;

    // Build the stage path with day offsets from dateIn
    const path: Array<{ to: string; day: number; by: string }> = [{ to: "NEW_LEAD", day: 0, by: ids.nilofer }];
    const s = opts.plan.stage;
    const add = (to: string, day: number, by: string) => path.push({ to, day, by });
    const bookDay = between(1, 3);
    if (s === "DISCO_NOT_BOOKED") add("DISCO_NOT_BOOKED", bookDay, ids.nilofer);
    if (["DISCO_BOOKED", "DISCO_COMPLETED", "SSS_BOOKED", "SSS_COMPLETED", "PROPOSAL_SENT", "WON", "LOST", "NO_SHOW"].includes(s)) {
      add("DISCO_BOOKED", bookDay, ids.nilofer);
    }
    if (s === "NO_SHOW") add("NO_SHOW", bookDay + between(1, 3), ids.asma);
    const discoDay = bookDay + between(1, 4);
    if (["DISCO_COMPLETED", "SSS_BOOKED", "SSS_COMPLETED", "PROPOSAL_SENT", "WON", "LOST"].includes(s)) {
      add("DISCO_COMPLETED", discoDay, ids.asma);
    }
    const sssBookDay = discoDay + between(1, 3);
    if (["SSS_BOOKED", "SSS_COMPLETED", "PROPOSAL_SENT", "WON"].includes(s)) add("SSS_BOOKED", sssBookDay, ids.asma);
    const sssDay = sssBookDay + between(1, 4);
    if (["SSS_COMPLETED", "PROPOSAL_SENT", "WON"].includes(s)) add("SSS_COMPLETED", sssDay, ids.ameen);
    const propDay = sssDay + 1;
    if (["PROPOSAL_SENT", "WON"].includes(s)) add("PROPOSAL_SENT", propDay, ids.asma);
    if (s === "WON") add("WON", propDay + between(1, 5), rng() < 0.3 ? ids.asma : ids.ameen);
    if (s === "LOST") add("LOST", discoDay + between(2, 8), ids.asma);

    const lead = await prisma.lead.create({
      data: {
        name: opts.name, phone: opts.phone, email: opts.email ?? null,
        city: pick(CITIES), industry: opts.industry ?? pick(INDUSTRIES),
        leadSource: opts.source as never, dateIn,
        stage: s as never, wonLevel: opts.plan.wonLevel ?? null,
        notes: s === "WON" ? "Enrolled — see student record" : pick([
          "Asked detailed visa questions — serious intent",
          "Wants to move within 12 months",
          "Budget discussion pending with family",
          "Compared us with two other consultancies",
          "Saw the Ghosted Blueprint webinar replay",
          "Referred by an alumnus",
          null as never, null as never,
        ]),
        assignedToId: assignedTo,
        contactedAt: rng() < 0.85 ? at(dateIn, between(9, 20), between(0, 59)) : null,
        enteredById: rng() < 0.7 ? ids.nilofer : ids.ameen,
        createdAt: at(dateIn, 9),
        stageHistory: { create: path.map((p, i) => ({
          fromStage: i === 0 ? null : (path[i - 1].to as never),
          toStage: p.to as never,
          changedAt: at(daysAgo(opts.dateInDaysAgo - p.day), between(9, 19), between(0, 59)),
          changedById: p.by,
        })) },
      },
    });
    leadCount++;

    // Discovery outcome for anyone who completed the disco call
    if (path.some((p) => p.to === "DISCO_COMPLETED")) {
      const won = s === "WON";
      const qualified = won || rng() < 0.55;
      const hq = won ? rng() < 0.8 : qualified && rng() < 0.5;
      const bant = () => won || rng() < (qualified ? 0.75 : 0.3);
      await prisma.discoveryOutcome.create({
        data: {
          leadId: lead.id, callDate: daysAgo(opts.dateInDaysAgo - discoDay),
          outcome: qualified ? "QUALIFIED_FOR_SSS" : pick(["NOT_QUALIFIED_FOR_SSS", "FOLLOW_UP_NEEDED", "SENT_TO_WORKSHOP"]) as never,
          highlyQualified: hq,
          bantBudget: bant(), bantAuthority: bant(), bantNeed: bant(), bantTimeline: bant(),
          sssDate: ["SSS_BOOKED", "SSS_COMPLETED", "PROPOSAL_SENT", "WON"].includes(s) ? daysAgo(opts.dateInDaysAgo - sssDay) : null,
          notes: won ? "Clear budget + timeline. Family aligned. Close on value, not price"
            : qualified ? pick(["Strong need, timeline 6-9 months", "Good fit — send case studies before SSS", "Decision maker, budget confirmed verbally"])
            : pick(["Needs 1 more year of experience first", "Budget not available this year", "Exploring — nurture via newsletter"]),
          enteredById: ids.asma, createdAt: at(daysAgo(opts.dateInDaysAgo - discoDay), 19),
        },
      });
      outcomeCount++;
    }
    return lead;
  };

  // 1) WON leads that became students (linked)
  for (const s of STUDENTS) {
    if (s.status === "DROPPED") continue;
    const leadDaysAgo = s.enrolledDaysAgo + between(8, 18);
    const lead = await createLead({
      name: s.name, phone: s.phone, source: s.leadSource, dateInDaysAgo: leadDaysAgo,
      plan: { stage: "WON", wonLevel: s.level }, industry: s.industry, email: s.email,
    });
    await prisma.student.update({ where: { id: studentIdByName[s.name] }, data: { leadId: lead.id } });
  }

  // 2) The dropped student's lead (won at the time)
  const rahul = STUDENTS.find((x) => x.name === "Rahul Verma")!;
  const rahulLead = await createLead({
    name: rahul.name, phone: rahul.phone, source: rahul.leadSource,
    dateInDaysAgo: rahul.enrolledDaysAgo + 12, plan: { stage: "WON", wonLevel: "GUIDED" },
    industry: rahul.industry, email: rahul.email,
  });
  await prisma.student.update({ where: { id: studentIdByName[rahul.name] }, data: { leadId: rahulLead.id } });

  // 3) General pipeline spread — denser in recent weeks
  const buckets: Array<{ ageLo: number; ageHi: number; count: number; stages: string[] }> = [
    { ageLo: 0, ageHi: 3, count: 7, stages: ["NEW_LEAD", "NEW_LEAD", "NEW_LEAD", "DISCO_BOOKED", "DISCO_BOOKED"] },
    { ageLo: 4, ageHi: 10, count: 9, stages: ["NEW_LEAD", "DISCO_BOOKED", "DISCO_BOOKED", "DISCO_COMPLETED", "DISCO_NOT_BOOKED", "NO_SHOW"] },
    { ageLo: 11, ageHi: 21, count: 10, stages: ["DISCO_COMPLETED", "SSS_BOOKED", "SSS_COMPLETED", "PROPOSAL_SENT", "PROPOSAL_SENT", "DISCO_NOT_BOOKED", "LOST", "NO_SHOW"] },
    { ageLo: 22, ageHi: 45, count: 12, stages: ["LOST", "LOST", "DISCO_COMPLETED", "PROPOSAL_SENT", "DISCO_NOT_BOOKED", "NO_SHOW", "SSS_COMPLETED"] },
    { ageLo: 46, ageHi: 90, count: 10, stages: ["LOST", "LOST", "LOST", "NO_SHOW", "DISCO_NOT_BOOKED", "DISCO_COMPLETED"] },
    { ageLo: 91, ageHi: 140, count: 6, stages: ["LOST", "LOST", "NO_SHOW", "DISCO_NOT_BOOKED"] },
  ];
  let phoneSeq = 100;
  for (const b of buckets) {
    for (let i = 0; i < b.count; i++) {
      await createLead({
        name: nextName(), phone: `+91 98111 44${String(phoneSeq++).padStart(3, "0")}`,
        source: pick([...LEAD_SOURCES]), dateInDaysAgo: between(b.ageLo, b.ageHi),
        plan: { stage: pick(b.stages) },
      });
    }
  }

  console.log(`· ${leadCount} leads with stage history + ${outcomeCount} discovery outcomes`);
}

// ───────────────────────── Extra income: GN courses + this-month collections ─────────────────────────

async function seedExtraIncome(ids: Ids, studentIdByName: Record<string, string>) {
  const rows: Prisma.IncomeCreateManyInput[] = [];
  const add = (dAgo: number, name: string, amt: number, level: string, type: "FULL_PAYMENT" | "INSTALMENT", method: string, notes: string, studentId?: string) => {
    if (dAgo < 0) return;
    rows.push({
      date: daysAgo(dAgo), studentName: name, studentId: studentId ?? null,
      amountInrMinor: inr(amt), amountEurMinor: BigInt(0), fxRateUsed: FX,
      programLevel: level as never, paymentType: type, paymentMethod: method as never,
      notes, enteredById: ids.ameen, createdAt: at(daysAgo(dAgo), 12),
    });
  };

  // German-course income sprinkled through past months (level variety on Finance)
  add(112, "Meghna Suresh", 15000, "GN_A1", "FULL_PAYMENT", "UPI", "German A1 batch — evening cohort");
  add(84, "Joel Mathew", 18000, "GN_A2", "FULL_PAYMENT", "RAZORPAY", "German A2 batch");
  add(60, "Farida Begum", 22000, "GN_B1", "FULL_PAYMENT", "UPI", "German B1 batch — Pflege track");
  add(33, "Meghna Suresh", 18000, "GN_A2", "FULL_PAYMENT", "UPI", "A1 → A2 continuation");
  add(15, "Sandeep Rao", 45000, "GN_BUNDLE", "FULL_PAYMENT", "RAZORPAY", "A1-B1 bundle — paid upfront");

  // This month's collections so far (keeps the MTD widgets alive)
  const dom = TODAY.getUTCDate(); // day of month
  add(Math.min(dom - 1, 3), "Kavya Menon", 75000, "ELITE", "INSTALMENT", "RAZORPAY", "2nd of 3 instalments — on schedule", studentIdByName["Kavya Menon"]);
  add(Math.min(dom - 1, 2), "Joel Mathew", 22000, "GN_B1", "FULL_PAYMENT", "UPI", "A2 → B1 continuation");
  add(0, "Divya Pillai", 50000, "GUIDED", "INSTALMENT", "UPI", "2nd booking instalment collected on check-in call", studentIdByName["Divya Pillai"]);

  await prisma.income.createMany({ data: rows });
  console.log(`· ${rows.length} extra income rows (GN courses + this-month collections)`);
}

// ───────────────────────── German Note: batches, recordings, community ─────────────────────────

async function seedGermanNote(ids: Ids) {
  const auth = betterAuth({
    database: prismaAdapter(prisma, { provider: "postgresql" }),
    secret: process.env.BETTER_AUTH_SECRET,
    baseURL: process.env.BETTER_AUTH_URL ?? "http://localhost:3000",
    emailAndPassword: { enabled: true },
    user: { additionalFields: { role: { type: "string", defaultValue: "USER", input: false } } },
  });
  const ctx = await auth.$context;

  // Demo accounts survive resets (users aren't truncated) — upsert-by-email.
  const ensureUser = async (name: string, email: string, password: string, role: "TUTOR" | "STUDENT") => {
    let user = await prisma.user.findUnique({ where: { email } });
    if (!user) {
      const res = await auth.api.signUpEmail({ body: { name, email, password } });
      user = await prisma.user.findUnique({ where: { id: res.user.id } });
    } else {
      await ctx.internalAdapter.updatePassword(user.id, await ctx.password.hash(password));
    }
    await prisma.user.update({ where: { id: user!.id }, data: { role, emailVerified: true } });
    return user!.id;
  };

  const tutorEmail = process.env.SEED_TUTOR_EMAIL || "tutor.demo@b2consultants.in";
  const tutorId = await ensureUser("Lena Fischer", tutorEmail, process.env.SEED_TUTOR_PASSWORD || "deutsch-2026", "TUTOR");

  // Promote the GN income names (seedExtraIncome) into real Student records —
  // no enrollment: GN learners live in batches, not the 90/120-day tracker.
  const gnLearners: Array<[string, string, string]> = [
    ["Meghna Suresh", "meghna.s@example.com", "+91 98111 55001"],
    ["Joel Mathew", "joel.m@example.com", "+91 98111 55002"],
    ["Farida Begum", "farida.b@example.com", "+91 98111 55003"],
    ["Sandeep Rao", "sandeep.r@example.com", "+91 98111 55004"],
  ];
  const sid: Record<string, string> = {};
  for (const [fullName, email, phone] of gnLearners) {
    const s = await prisma.student.create({ data: { fullName, email, phone, leadSource: "WORKSHOP" } });
    sid[fullName] = s.id;
    await prisma.income.updateMany({ where: { studentId: null, studentName: fullName }, data: { studentId: s.id } });
  }

  // GN student portal demo login → Meghna (member of the A1 batch)
  const gnStudentEmail = process.env.SEED_GN_STUDENT_EMAIL || "gn.student.demo@b2consultants.in";
  const meghnaUserId = await ensureUser(
    "Meghna Suresh", gnStudentEmail, process.env.SEED_GN_STUDENT_PASSWORD || "hallo-2026", "STUDENT"
  );
  await prisma.student.update({ where: { id: sid["Meghna Suresh"] }, data: { userId: meghnaUserId } });

  // Two batches, both taught by Lena
  const a1 = await prisma.gnBatch.create({
    data: {
      name: "A1 Evening — July 2026", level: "GN_A1", tutorId,
      notes: "Mon/Wed/Fri 7–8:30 PM IST · Zoom link pinned in the batch discussion",
      members: { create: [{ studentId: sid["Meghna Suresh"] }, { studentId: sid["Sandeep Rao"] }] },
    },
  });
  const b1 = await prisma.gnBatch.create({
    data: {
      name: "B1 Weekend — Pflege track", level: "GN_B1", tutorId,
      notes: "Sat/Sun 10 AM–1 PM IST",
      members: { create: [{ studentId: sid["Farida Begum"] }, { studentId: sid["Joel Mathew"] }] },
    },
  });

  // Classroom modules → a structured curriculum for the A1 batch
  const mod = (batchId: string, title: string, orderIndex: number) =>
    prisma.gnModule.create({ data: { batchId, title, orderIndex } });
  const a1Grammar = await mod(a1.id, "A1 · Grammar foundations", 0);
  const a1Speaking = await mod(a1.id, "A1 · Speaking & questions", 1);

  // Class recordings (placeholder public YouTube videos so the embeds actually play)
  const rec = (batchId: string, dAgo: number, title: string, ytId: string, notes?: string, moduleId?: string) =>
    prisma.gnRecording.create({
      data: {
        batchId, moduleId: moduleId ?? null, title, classDate: daysAgo(dAgo),
        videoUrl: `https://youtu.be/${ytId}`, provider: "YOUTUBE",
        embedUrl: `https://www.youtube-nocookie.com/embed/${ytId}`,
        notes: notes ?? null, postedById: tutorId, createdAt: at(daysAgo(dAgo), 21),
      },
    });
  await rec(a1.id, 7, "Class 10 — Verben: sein & haben", "jNQXAC9IVRw", "Homework: workbook p. 32–34. Quiz on Friday!", a1Grammar.id);
  await rec(a1.id, 4, "Class 11 — Akkusativ basics", "9bZkp7q19f0", undefined, a1Grammar.id);
  await rec(a1.id, 1, "Class 12 — Fragen stellen (W-Fragen)", "dQw4w9WgXcQ", "Bring 5 questions about your day to next class.", a1Speaking.id);
  await rec(b1.id, 5, "Woche 8 — Pflegeberichte schreiben", "jNQXAC9IVRw", "Focus: documentation vocabulary for the ward.");
  await rec(b1.id, 2, "Woche 9 — Telefongespräche im Krankenhaus", "9bZkp7q19f0");

  // Calendar — next live classes (with join links) + one past class
  const evt = (batchId: string, dAgoOrAhead: number, hh: number, title: string, joinUrl: string | null, notes?: string) =>
    prisma.gnEvent.create({
      data: {
        batchId, title, startsAt: at(dAgoOrAhead >= 0 ? daysAhead(dAgoOrAhead) : daysAgo(-dAgoOrAhead), hh),
        durationMins: 90, joinUrl, notes: notes ?? null, createdById: tutorId,
      },
    });
  await evt(a1.id, 2, 19, "Class 13 — Modalverben (live)", "https://zoom.us/j/9876543210", "We'll drill Akkusativ from the homework too.");
  await evt(a1.id, 5, 19, "Class 14 — Perfekt tense intro (live)", "https://zoom.us/j/9876543210");
  await evt(b1.id, 3, 10, "Woche 10 — Rollenspiel: Visite (live)", "https://meet.google.com/abc-defg-hij", "Bring your anonymised Pflegebericht.");
  await evt(a1.id, -1, 19, "Class 12 — Fragen stellen (live)", null); // past — recording already posted

  // Community: global feed + batch discussions (authors need logins → Lena / Meghna / Ameen).
  // Skool-style: titles + categories, welcome post pinned.
  type GnCat = "GENERAL" | "ANNOUNCEMENT" | "QUESTION" | "WIN";
  // comments: [authorId, body, likerIds?] — likerIds feed comment-like points/levels
  const post = async (
    batchId: string | null, authorId: string, dAgo: number, hh: number, body: string,
    comments: Array<[string, string] | [string, string, string[]]> = [], likerIds: string[] = [],
    opts: { title?: string; category?: GnCat; pinned?: boolean; mentions?: string[] } = {}
  ) => {
    const p = await prisma.gnPost.create({
      data: {
        batchId, authorId, body, createdAt: at(daysAgo(dAgo), hh),
        title: opts.title ?? null, category: opts.category ?? "GENERAL", pinned: opts.pinned ?? false,
        mentionedUserIds: opts.mentions ?? [],
      },
    });
    for (const [cAuthor, cBody, cLikers] of comments) {
      const c = await prisma.gnComment.create({
        data: { postId: p.id, authorId: cAuthor, body: cBody, createdAt: at(daysAgo(dAgo), hh + 1) },
      });
      if (cLikers && cLikers.length) {
        await prisma.gnCommentLike.createMany({ data: cLikers.map((userId) => ({ commentId: c.id, userId })) });
      }
    }
    if (likerIds.length) {
      await prisma.gnLike.createMany({ data: likerIds.map((userId) => ({ postId: p.id, userId })) });
    }
  };

  await post(null, ids.ameen, 9, 10,
    "Willkommen! 🎉 This is the German Note community — introduce yourself and say which level you're working towards.",
    [[tutorId, "Hallo zusammen! I'm Lena, your tutor for A1 and B1. Ask me anything here between classes.", [ids.ameen, meghnaUserId]],
     [meghnaUserId, "Hi everyone! Meghna here, A1 evening batch. Goal: B1 by next summer 💪"]],
    [tutorId, meghnaUserId],
    { title: "Willkommen bei German Note! Start here 👋", category: "ANNOUNCEMENT", pinned: true });
  await post(null, tutorId, 5, 18,
    "Label 10 things in your kitchen with sticky notes — der Kühlschrank, die Pfanne, das Messer. Vocabulary sticks when you SEE it daily.",
    [[meghnaUserId, "Did this yesterday — my flatmates think I've lost it 😄", [tutorId]]],
    [ids.ameen, meghnaUserId],
    { title: "Tip of the week: sticky-note your kitchen", category: "GENERAL" });
  await post(null, meghnaUserId, 2, 20,
    "Passed my first mock test with 82%! The recording from Class 10 helped so much — danke Lena!",
    [[tutorId, "Sehr gut, Meghna! 👏", [ids.ameen, meghnaUserId]]],
    [tutorId, ids.ameen],
    { title: "82% on my first mock test 🎉", category: "WIN" });
  // @mention demo — Lena tags Meghna (drives the mention highlight + her notification)
  await post(null, tutorId, 1, 12,
    "@Meghna Suresh that mock-test result is fantastic — would you share your study routine with the group?",
    [], [ids.ameen],
    { category: "GENERAL", mentions: [meghnaUserId] });

  await post(a1.id, meghnaUserId, 3, 21,
    "Is it “Ich habe einen Hund” or “Ich habe ein Hund”? The Akkusativ endings confuse me.",
    [[tutorId, "„einen Hund“ — Hund is masculine, and the direct object takes Akkusativ: der → den/einen. We'll drill this on Friday!", [meghnaUserId]]],
    [tutorId],
    { title: "Frage zur Hausaufgabe (Akkusativ)", category: "QUESTION" });
  await post(b1.id, tutorId, 4, 9,
    "B1 group: bring one real Pflegebericht example (anonymised!) to Saturday's class — we'll rewrite them together.",
    [], [ids.ameen],
    { title: "Homework for Saturday", category: "ANNOUNCEMENT", pinned: true });

  // Meghna's watch progress → 2 of 3 A1 recordings watched (progress bar demo)
  const a1recs = await prisma.gnRecording.findMany({
    where: { batchId: a1.id }, orderBy: { classDate: "asc" }, take: 2, select: { id: true },
  });
  for (const r of a1recs) {
    await prisma.gnRecordingWatch.create({ data: { recordingId: r.id, userId: meghnaUserId } });
  }

  console.log(`· German Note: 2 batches, 2 modules, 5 recordings, 4 scheduled classes, 6 posts + likes/mention/progress (tutor: ${tutorEmail} → Lena Fischer)`);
}

// ───────────────────────── Finance: expenses, targets, payables, cash ─────────────────────────

async function seedFinanceOps(ids: Ids) {
  // Monthly expense template over the last 6 calendar months (skip future days this month)
  const months: Date[] = [];
  for (let i = 5; i >= 0; i--) {
    months.push(new Date(Date.UTC(TODAY.getUTCFullYear(), TODAY.getUTCMonth() - i, 1)));
  }
  const expenses: Prisma.ExpenseCreateManyInput[] = [];
  const push = (date: Date, amt: number, category: string, isCogs: boolean, vendor: string, notes: string) => {
    if (date.getTime() > TODAY.getTime()) return;
    expenses.push({
      date, amountInrMinor: inr(amt), amountEurMinor: BigInt(0), fxRateUsed: FX,
      category: category as never, isCogs, vendor, notes, enteredById: ids.ameen,
    });
  };
  months.forEach((m, i) => {
    const day = (d: number) => new Date(Date.UTC(m.getUTCFullYear(), m.getUTCMonth(), d));
    const label = m.toLocaleString("en-GB", { month: "long", timeZone: "UTC" });
    push(day(1), 50000, "TEAM_SALARIES", true, "Karthick", `Delivery coach salary — ${label}`);
    push(day(1), 18000, "TEAM_SALARIES", false, "Nilofer", `Appointment setter retainer — ${label}`);
    push(day(1), 22000, "TEAM_SALARIES", false, "Asma", `Discovery specialist retainer — ${label}`);
    push(day(2), 32000 + i * 2500, "MARKETING", false, "Meta Ads", `${label} lead-gen campaigns`);
    push(day(3), 8000, "TOOLS_SOFTWARE", false, "WATI", "WhatsApp automation — monthly");
    // NOT COGS: the community platform is billed monthly whether or not anyone
    // enrols, so it is Tools & Software (same treatment as WATI above).
    push(day(4), 4000, "TOOLS_SOFTWARE", false, "Skool", "Student community platform — monthly");
    push(day(5), 28000, "OPERATIONS", false, "Sirah Workspace", `${label} — rent, utilities, internet`);
    push(day(12), 15000, "CONTENT_CREATION", false, "FrameCraft Studio", `${label} reels + YouTube edit batch`);
    push(day(18), 6500, "COGS_DIRECT_DELIVERY", true, "PrintWorks", "Student welcome kits + workbooks");
  });
  // One-off event in a middle month
  const eventMonth = months[2];
  push(new Date(Date.UTC(eventMonth.getUTCFullYear(), eventMonth.getUTCMonth(), 21)), 45000, "EVENTS_OFFLINE", false, "Taj Conference Hall", "Offline career workshop — Bengaluru (62 attendees)");
  await prisma.expense.createMany({ data: expenses });

  // Monthly revenue targets
  await prisma.monthlyTarget.createMany({
    data: months.map((m, i) => ({ month: m, targetInrMinor: inr(600000 + i * 40000) })),
  });

  // Payables → break-even + "due this month"
  await prisma.payable.createMany({
    data: [
      { name: "Karthick salary", category: "TEAM_SALARIES", amountInrMinor: inr(50000), frequency: "MONTHLY", nextDueDate: monthStartNext(1), isCogs: true, status: "ACTIVE" },
      { name: "Asma retainer", category: "TEAM_SALARIES", amountInrMinor: inr(22000), frequency: "MONTHLY", nextDueDate: monthStartNext(1), isCogs: false, status: "ACTIVE" },
      { name: "Nilofer retainer", category: "TEAM_SALARIES", amountInrMinor: inr(18000), frequency: "MONTHLY", nextDueDate: monthStartNext(1), isCogs: false, status: "ACTIVE" },
      { name: "Meta Ads budget", category: "MARKETING", amountInrMinor: inr(45000), frequency: "MONTHLY", nextDueDate: daysAhead(6), isCogs: false, status: "ACTIVE" },
      { name: "Office rent + utilities", category: "OPERATIONS", amountInrMinor: inr(28000), frequency: "MONTHLY", nextDueDate: daysAhead(1), isCogs: false, status: "ACTIVE" },
      { name: "WATI subscription", category: "TOOLS_SOFTWARE", amountInrMinor: inr(8000), frequency: "MONTHLY", nextDueDate: daysAhead(3), isCogs: false, status: "ACTIVE" },
      { name: "Skool subscription", category: "TOOLS_SOFTWARE", amountInrMinor: inr(4000), frequency: "MONTHLY", nextDueDate: daysAhead(11), isCogs: false, status: "ACTIVE" },
      { name: "Professional indemnity insurance", category: "OPERATIONS", amountInrMinor: inr(21000), frequency: "QUARTERLY", nextDueDate: daysAhead(40), isCogs: false, status: "ACTIVE" },
      { name: "Zoom annual plan", category: "TOOLS_SOFTWARE", amountInrMinor: inr(24000), frequency: "ANNUAL", nextDueDate: daysAhead(120), isCogs: false, status: "ACTIVE" },
      { name: "Canva Pro (paused trial)", category: "TOOLS_SOFTWARE", amountInrMinor: inr(6000), frequency: "MONTHLY", nextDueDate: null, isCogs: false, status: "PAUSED" },
    ],
  });

  // Weekly cash positions — 18 Mondays, dip then recovery
  const mondays: Date[] = [];
  let cursor = lastMonday(TODAY);
  for (let i = 0; i < 18; i++) { mondays.unshift(cursor); cursor = new Date(cursor.getTime() - 7 * 86400000); }
  const base = 640000;
  const shape = [0, -12, -25, -32, -44, -58, -70, -85, -96, -104, -110, -98, -88, -74, -60, -42, -20, 5]; // ×1000
  await prisma.cashPosition.createMany({
    data: mondays.map((m, i) => ({
      date: m,
      bankBalanceInrMinor: inr(base + shape[i] * 1000),
      personalSavingsInrMinor: inr(300000),
      notes: i === mondays.length - 1 ? "Monday balance check — June collections landed" : "Monday morning balance check",
    })),
  });

  // FX cache row for today (keeps the demo deterministic offline)
  await prisma.fxRate.upsert({
    where: { date: TODAY }, update: {},
    create: { date: TODAY, inrPerEur: FX, provider: "frankfurter.app" },
  });

  console.log(`· ${expenses.length} expenses, 6 monthly targets, 10 payables, 18 cash positions`);
}

function monthStartNext(n: number): Date {
  return new Date(Date.UTC(TODAY.getUTCFullYear(), TODAY.getUTCMonth() + n, 1));
}

// ───────────────────────── Funnel snapshots ─────────────────────────

async function seedFunnel() {
  const mondays: Date[] = [];
  let cursor = lastMonday(TODAY);
  for (let i = 0; i < 20; i++) { mondays.unshift(cursor); cursor = new Date(cursor.getTime() - 7 * 86400000); }
  const rows = mondays.map((m, i) => {
    const growth = i / 19; // 0 → 1
    const awareness = Math.round(6000 + growth * 8000 + between(-600, 600));
    const leads = Math.round(5 + growth * 7 + between(-1, 1));
    const calls = Math.max(2, Math.round(leads * 0.55) + between(-1, 1));
    const proposals = Math.max(0, Math.round(calls * 0.4) + between(-1, 0));
    const enr = between(0, 2);
    const workshopWeek = i % 6 === 4;
    return {
      weekStart: m,
      awarenessReach: awareness, leadsCaptured: leads, callsCompleted: calls, proposalsSent: proposals,
      enrollmentsSolo: enr > 1 ? 1 : 0,
      enrollmentsGuided: enr >= 1 ? 1 : 0,
      enrollmentsElite: rng() < 0.3 ? 1 : 0,
      ghostedDownloads: Math.round(8 + growth * 14 + between(-2, 2)),
      workshopAttendees: workshopWeek ? between(40, 80) : 0,
      notes: i === 19 ? "Current week — auto-pulls will keep updating" : "Logged in Monday weekly review",
    };
  });
  for (const r of rows) {
    await prisma.weeklyFunnelSnapshot.upsert({ where: { weekStart: r.weekStart }, update: r, create: r });
  }
  console.log(`· 20 weekly funnel snapshots`);
}

// ───────────────────────── People: OKRs + daily logs (streak-aware) ─────────────────────────

async function seedPeople(ids: Ids, pids: Record<string, string>) {
  // OKRs for this month and the two before it
  const m0 = monthStart(TODAY);
  const m1 = new Date(Date.UTC(m0.getUTCFullYear(), m0.getUTCMonth() - 1, 1));
  const m2 = new Date(Date.UTC(m0.getUTCFullYear(), m0.getUTCMonth() - 2, 1));
  const dayOfMonth = TODAY.getUTCDate();
  const mtdPace = Math.min(dayOfMonth / 30, 1);

  const okrs: Prisma.OKRCreateManyInput[] = [
    // two months ago — settled, mostly green (feeds settled-OKR XP)
    { teamProfileId: pids["Asma"], month: m2, title: "40 discovery calls", targetValue: "40 calls", targetNumeric: 40, currentProgress: "43 calls", currentNumeric: 43, notes: "Beat target in week 4" },
    { teamProfileId: pids["Asma"], month: m2, title: "Show-up rate to 80%", targetValue: "80", targetNumeric: 80, currentProgress: "82", currentNumeric: 82, notes: "Reminder sequence working" },
    { teamProfileId: pids["Nilofer"], month: m2, title: "120 appointments set", targetValue: "120", targetNumeric: 120, currentProgress: "112", currentNumeric: 112, notes: "Just short — Insta DM slump week 2" },
    { teamProfileId: pids["Karthick"], month: m2, title: "Session completion 90%", targetValue: "90", targetNumeric: 90, currentProgress: "93", currentNumeric: 93, notes: "No missed sessions after reschedule policy" },
    // last month — settled
    { teamProfileId: pids["Asma"], month: m1, title: "45 discovery calls", targetValue: "45 calls", targetNumeric: 45, currentProgress: "46 calls", currentNumeric: 46, notes: "New booking page helped" },
    { teamProfileId: pids["Asma"], month: m1, title: "HQ rate 50%", targetValue: "50", targetNumeric: 50, currentProgress: "44", currentNumeric: 44, notes: "Lead quality dipped mid-month with new ad set" },
    { teamProfileId: pids["Nilofer"], month: m1, title: "130 appointments set", targetValue: "130", targetNumeric: 130, currentProgress: "135", currentNumeric: 135, notes: "Best month yet" },
    { teamProfileId: pids["Nilofer"], month: m1, title: "Speed-to-lead under 2h", targetValue: "Qualitative", manualCompletionPct: 90, notes: "Avg first touch 1h 40m" },
    { teamProfileId: pids["Karthick"], month: m1, title: "Zero RED students", targetValue: "Qualitative", manualCompletionPct: 80, notes: "One RED (Vikram) rescued to GREEN" },
    // this month — in progress
    { teamProfileId: pids["Asma"], month: m0, title: "45 discovery calls", targetValue: "45 calls", targetNumeric: 45, currentProgress: `${Math.round(45 * mtdPace + 2)} calls`, currentNumeric: Math.round(45 * mtdPace + 2), notes: "Slightly ahead of pace" },
    { teamProfileId: pids["Asma"], month: m0, title: "HQ rate 50%", targetValue: "50", targetNumeric: 50, currentProgress: "48", currentNumeric: 48, notes: "Better after BANT screening on the booking form" },
    { teamProfileId: pids["Asma"], month: m0, title: "Show-up rate to 85%", targetValue: "85", targetNumeric: 85, currentProgress: "71", currentNumeric: 71, notes: "Testing WhatsApp reminder at T-2h" },
    { teamProfileId: pids["Nilofer"], month: m0, title: "130 appointments set", targetValue: "130", targetNumeric: 130, currentProgress: `${Math.round(130 * mtdPace - 4)}`, currentNumeric: Math.round(130 * mtdPace - 4), notes: "Pacing just behind — pushing referral asks" },
    { teamProfileId: pids["Nilofer"], month: m0, title: "25 referral conversations", targetValue: "25", targetNumeric: 25, currentProgress: `${Math.round(25 * mtdPace)}`, currentNumeric: Math.round(25 * mtdPace), notes: "Alumni outreach list built" },
    { teamProfileId: pids["Karthick"], month: m0, title: "Improve student engagement", targetValue: "Qualitative", manualCompletionPct: 70, notes: "Manual % — based on session attendance + task completion" },
    { teamProfileId: pids["Karthick"], month: m0, title: "All check-ins within 7 days", targetValue: "Qualitative", manualCompletionPct: 85, notes: "One overdue (Mohammed) — scheduled" },
  ];
  await prisma.oKR.createMany({ data: okrs });

  // ── Daily logs with deliberate streak structure (consecutive CALENDAR days) ──
  type Variant = "DISCOVERY_SPECIALIST" | "APPOINTMENT_SETTER" | "DELIVERY_COACH";
  const logs: Prisma.DailyLogCreateManyInput[] = [];
  const NOTES = [
    "Steady day — no blockers",
    "Good energy on calls today",
    "Follow-ups piling up, need a batching slot",
    "Two promising conversations — flagged to Ameen",
    "Slow day on DMs, doubled down on follow-ups",
    "Blocked 2h for pipeline hygiene",
    null, null, null,
  ];
  const addRun = (userId: string, variant: Variant, fromDaysAgo: number, toDaysAgo: number, mk: () => Record<string, number>) => {
    for (let d = fromDaysAgo; d >= toDaysAgo; d--) {
      logs.push({
        userId, variant, date: daysAgo(d),
        notes: pick(NOTES), createdAt: at(daysAgo(d), between(18, 21), between(0, 59)),
        ...mk(),
      });
    }
  };
  const asmaVals = () => ({
    discoveryCallsCompleted: between(2, 6), highlyQualifiedCalls: between(0, 3),
    followUpsDone: between(3, 9), proposalsSent: between(0, 2), noShows: between(0, 1),
  });
  const niloVals = () => ({
    newLeadsContacted: between(22, 42), appointmentsSet: between(3, 8),
    followUpMessagesSent: between(12, 28), leadsAddedToPipeline: between(3, 9),
  });
  const karVals = () => ({
    sessionsDelivered: between(2, 4), studentsCheckedInOn: between(3, 7),
    assignmentsReviewed: between(2, 6), studentsFlaggedAtRisk: between(0, 1),
  });

  // Asma: 32-day run (30-badge), gap, 16-day run (14-badge), gap, current 17-day streak incl. today
  addRun(ids.asma, "DISCOVERY_SPECIALIST", 74, 43, asmaVals);
  addRun(ids.asma, "DISCOVERY_SPECIALIST", 40, 25, asmaVals);
  addRun(ids.asma, "DISCOVERY_SPECIALIST", 16, 0, asmaVals);
  // Nilofer: 15-day run (14-badge), scattered week, current 5-day streak NOT incl. today (pending state)
  addRun(ids.nilofer, "APPOINTMENT_SETTER", 70, 56, niloVals);
  addRun(ids.nilofer, "APPOINTMENT_SETTER", 50, 44, niloVals);
  addRun(ids.nilofer, "APPOINTMENT_SETTER", 38, 30, niloVals);
  addRun(ids.nilofer, "APPOINTMENT_SETTER", 20, 12, niloVals);
  addRun(ids.nilofer, "APPOINTMENT_SETTER", 5, 1, niloVals);
  // Karthick: 33-day run (30-badge), 1-day gap, current 32-day streak incl. today
  addRun(ids.karthick, "DELIVERY_COACH", 65, 33, karVals);
  addRun(ids.karthick, "DELIVERY_COACH", 31, 0, karVals);

  await prisma.dailyLog.createMany({ data: logs, skipDuplicates: true });
  console.log(`· ${okrs.length} OKRs across 3 months + ${logs.length} daily logs (streaks: Asma 17d live, Nilofer 5d pending today, Karthick 32d live)`);
}

// ───────────────────────── Bookings (Wave-1: slots + requests) ─────────────────────────

async function seedBookings(ids: Ids) {
  // Open slots across the next 5 working days, 10:00 / 15:00 / 18:00 IST
  const slots: Array<{ startsAt: Date; status: "OPEN" | "BOOKED" | "BLOCKED" }> = [];
  let added = 0, offset = 1;
  while (added < 5) {
    const day = daysAhead(offset++);
    if (day.getUTCDay() === 0) continue; // skip Sunday
    for (const hh of [10, 15, 18]) slots.push({ startsAt: at(day, hh), status: "OPEN" });
    added++;
  }
  // Two of tomorrow's slots get booked; one blocked
  slots[0].status = "BOOKED";
  slots[1].status = "BOOKED";
  slots[2].status = "BLOCKED";

  const created = [];
  for (const s of slots) {
    created.push(await prisma.appointmentSlot.create({
      data: { startsAt: s.startsAt, durationMins: 30, status: s.status, assignedToId: ids.asma },
    }));
  }

  const mkRequest = (slotId: string | null, name: string, email: string, phone: string, opts: Partial<Prisma.BookingRequestUncheckedCreateInput> = {}) =>
    prisma.bookingRequest.create({
      data: {
        slotId, name, email, phone, whatsapp: phone, city: pick(CITIES),
        currentJobTitle: pick(["Senior Engineer", "Analyst", "Team Lead", "Consultant"]),
        prospectIndustry: pick(INDUSTRIES),
        highestEducation: pick(["B.Tech", "M.Tech", "MBA", "M.Sc"]),
        yearsExperience: pick(["3-5", "5-8", "8+"]),
        whyGermany: "Better career growth and quality of life",
        reasonForCall: "Want a clear roadmap for moving to Germany in my field",
        whenStartGermany: pick(["Within 6 months", "6-12 months"]),
        germanLevel: pick(["None", "A1", "A2"]),
        willingnessLearnGerman: "Yes",
        currentIncome: pick(["8-12 LPA", "12-18 LPA", "18+ LPA"]),
        readyToInvest: "Yes, if the plan is right",
        decisionMaking: "Myself, with family input",
        commitment: "Fully committed",
        howKnowUs: pick(["Instagram", "YouTube", "Referral"]),
        bantBudget: true, bantAuthority: true, bantNeed: true,
        bantTimeline: rng() < 0.7, bantScore: rng() < 0.7 ? 4 : 3,
        status: "BOOKED",
        ...opts,
      },
    });

  await mkRequest(created[0].id, "Akhil Ramesh", "akhil.r@example.com", "+91 98111 44201");
  await mkRequest(created[1].id, "Sofia D'Souza", "sofia.d@example.com", "+91 98111 44202");
  // one completed request from last week (no slot link — slot already past)
  await mkRequest(null, "Vishnu Prasad", "vishnu.p@example.com", "+91 98111 44203", { status: "COMPLETED", createdAt: at(daysAgo(6), 12) });

  console.log(`· ${slots.length} appointment slots + 3 booking requests`);
}

// ───────────────────────── Auth: reset demo passwords + student portal ─────────────────────────

async function resetPasswordsAndPortal(ids: Ids, studentIdByName: Record<string, string>) {
  const auth = betterAuth({
    database: prismaAdapter(prisma, { provider: "postgresql" }),
    secret: process.env.BETTER_AUTH_SECRET,
    baseURL: process.env.BETTER_AUTH_URL ?? "http://localhost:3000",
    emailAndPassword: { enabled: true },
    user: { additionalFields: { role: { type: "string", defaultValue: "USER", input: false } } },
  });
  const ctx = await auth.$context;

  const resets: Array<[string, string | undefined]> = [
    [ids.ameen, process.env.SEED_ADMIN_PASSWORD],
    [ids.karthick, process.env.SEED_HEAD_PASSWORD],
    [ids.asma, process.env.SEED_USER1_PASSWORD],
    [ids.nilofer, process.env.SEED_USER2_PASSWORD],
  ];
  for (const [userId, pw] of resets) {
    if (!pw) continue;
    await ctx.internalAdapter.updatePassword(userId, await ctx.password.hash(pw));
  }

  // Student portal demo login → Ravi Kumar (INTERVIEWS stage = rich journey page)
  const email = process.env.SEED_STUDENT_EMAIL || "student.demo@b2consultants.in";
  const password = process.env.SEED_STUDENT_PASSWORD || "journey-2026";
  const raviId = studentIdByName["Ravi Kumar"];
  let portalUser = await prisma.user.findUnique({ where: { email } });
  if (!portalUser) {
    const res = await auth.api.signUpEmail({ body: { name: "Ravi Kumar", email, password } });
    portalUser = await prisma.user.findUnique({ where: { id: res.user.id } });
  } else {
    await ctx.internalAdapter.updatePassword(portalUser.id, await ctx.password.hash(password));
  }
  await prisma.user.update({ where: { id: portalUser!.id }, data: { role: "STUDENT", emailVerified: true } });
  await prisma.student.update({ where: { id: raviId }, data: { userId: portalUser!.id } });

  console.log(`· team + portal passwords reset from .env (portal: ${email} → Ravi Kumar)`);
}

// ───────────────────────── main ─────────────────────────

async function main() {
  const url = process.env.DATABASE_URL ?? "";
  const isLocal = /localhost|127\.0\.0\.1|@db:/.test(url);
  if (!isLocal && !process.argv.includes("--force")) {
    throw new Error("DATABASE_URL is not local. Re-run with --force if you really mean to reset this database.");
  }

  console.log(`Seeding production-style demo data (anchor date: ${TODAY.toISOString().slice(0, 10)})…`);
  const { ids, pids } = await getTeam();
  await resetBusinessData();
  const studentIdByName = await seedStudents(ids);
  await seedPipeline(ids, studentIdByName);
  await seedExtraIncome(ids, studentIdByName);
  await seedGermanNote(ids);
  await seedFinanceOps(ids);
  await seedFunnel();
  await seedPeople(ids, pids);
  await seedBookings(ids);
  await resetPasswordsAndPortal(ids, studentIdByName);

  // Quick cross-check numbers for the UI
  const [income, leads, students, logs] = await Promise.all([
    prisma.income.aggregate({ _sum: { amountInrMinor: true, amountEurMinor: true }, _count: true }),
    prisma.lead.count(), prisma.student.count(), prisma.dailyLog.count(),
  ]);
  const totalInr = Number(income._sum.amountInrMinor ?? 0) / 100;
  const totalEur = Number(income._sum.amountEurMinor ?? 0) / 100;
  console.log(`
DEMO DATASET READY
  income rows ${income._count} — ₹${totalInr.toLocaleString("en-IN")} + €${totalEur.toLocaleString("en-IN")}
  leads ${leads} · students ${students} · daily logs ${logs}
Logins (passwords in .env):
  Ameen (Admin)  ${process.env.SEED_ADMIN_EMAIL}
  Karthick (Head) ${process.env.SEED_HEAD_EMAIL}
  Asma / Nilofer (Users) ${process.env.SEED_USER1_EMAIL} / ${process.env.SEED_USER2_EMAIL}
  Student portal  ${process.env.SEED_STUDENT_EMAIL} → Ravi Kumar
  GN tutor        ${process.env.SEED_TUTOR_EMAIL || "tutor.demo@b2consultants.in"} → Lena Fischer
  GN student      ${process.env.SEED_GN_STUDENT_EMAIL || "gn.student.demo@b2consultants.in"} → Meghna Suresh`);
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());
