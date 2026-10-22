/**
 * DEMO COHORT for the student / coach / tutor flows.
 *
 *   npx tsx prisma/demo-coaching.ts
 *
 * Builds one coherent B2 coaching cohort so the new screens have something real to show:
 * a curriculum, a batch running on it, a dated timetable with classes both behind and ahead
 * of now, a register already taken on the past ones, coursework, and logins for a coach and
 * a student.
 *
 * LOCAL ONLY, and it refuses to run anywhere else. The connection string is checked before a
 * single write, because the production database is one environment variable away and this
 * script creates users.
 *
 * Idempotent: re-running updates the same rows rather than stacking a second cohort.
 */
import { PrismaClient } from "@prisma/client";
import { betterAuth } from "better-auth";
import { prismaAdapter } from "better-auth/adapters/prisma";
import { GUIDED_CURRICULUM_SEED, planTimetable, type CurriculumRow } from "../src/lib/curriculum";

const DB = process.env.DATABASE_URL ?? "";
// The guard. `localhost:5435` is the project-local Postgres (scripts/local-db.mjs); anything
// else - above all a pooler.supabase.com host - is refused outright.
if (!/localhost:5435|127\.0\.0\.1:5435/.test(DB)) {
  console.error(
    "REFUSING TO RUN.\n" +
      "  This script creates users and a cohort, and is for the local database only.\n" +
      `  DATABASE_URL points at: ${DB.replace(/:[^:@/]+@/, ":***@") || "(unset)"}\n` +
      "  Expected a host of localhost:5435.",
  );
  process.exit(1);
}

const prisma = new PrismaClient();

const portalAuth = betterAuth({
  database: prismaAdapter(prisma, { provider: "postgresql" }),
  secret: process.env.BETTER_AUTH_SECRET,
  baseURL: process.env.BETTER_AUTH_URL ?? "http://localhost:3000",
  emailAndPassword: { enabled: true },
  user: { additionalFields: { role: { type: "string", defaultValue: "USER", input: false } } },
});

const COACH = { name: "Karthick Raman", email: "coach.demo@b2consultants.in", password: "coach-2026" };
const STUDENT_LOGIN = { email: "student.demo@b2consultants.in", password: "journey-2026" };

/** Six students, so the roster reads like a real batch rather than a list of Test Users. */
const STUDENTS = [
  { code: "B2-9001", fullName: "Priya Nair", phone: "+919840000001", targetRole: "Process Engineer" },
  { code: "B2-9002", fullName: "Arjun Mehta", phone: "+919840000002", targetRole: "Mechanical Design Engineer" },
  { code: "B2-9003", fullName: "Sneha Iyer", phone: "+919840000003", targetRole: "QA Engineer" },
  { code: "B2-9004", fullName: "Rahul Verma", phone: "+919840000004", targetRole: "Data Analyst" },
  { code: "B2-9005", fullName: "Divya Krishnan", phone: "+919840000005", targetRole: "Supply Chain Analyst" },
  { code: "B2-9006", fullName: "Vikram Sundar", phone: "+919840000006", targetRole: "Embedded Engineer" },
];

const DAY = 86_400_000;
const ymd = (d: Date) => d.toISOString().slice(0, 10);

/** Create a login, or reset the password if one already exists. Returns the user id. */
async function ensureLogin(opts: {
  name: string;
  email: string;
  password: string;
  role: "COACH" | "STUDENT";
}): Promise<string> {
  const existing = await prisma.user.findUnique({ where: { email: opts.email }, select: { id: true } });
  if (existing) {
    const ctx = await portalAuth.$context;
    await ctx.internalAdapter.updatePassword(existing.id, await ctx.password.hash(opts.password));
    await prisma.user.update({
      where: { id: existing.id },
      // `mustChangePassword: false` ON PURPOSE, unlike the real admin flow. This is a demo
      // login handed over in a chat - bouncing it to /change-password on first sign-in would
      // make the credentials below wrong the moment they are used once.
      data: { role: opts.role, status: "ACTIVE", emailVerified: true, mustChangePassword: false },
    });
    return existing.id;
  }
  const res = await portalAuth.api.signUpEmail({
    body: { name: opts.name, email: opts.email, password: opts.password },
  });
  await prisma.user.update({
    where: { id: res.user.id },
    data: { role: opts.role, emailVerified: true, mustChangePassword: false },
  });
  return res.user.id;
}

async function main() {
  console.log(`→ local database: ${DB.replace(/:[^:@/]+@/, ":***@")}\n`);

  // ── 1. The coach, with the team profile the class reminder reads a phone from ──
  const coachId = await ensureLogin({ ...COACH, role: "COACH" });
  await prisma.teamProfile.upsert({
    where: { userId: coachId },
    update: { phone: "+919840000100", status: "ACTIVE" },
    create: {
      userId: coachId,
      fullName: COACH.name,
      roleTitle: "Head Coach",
      dashboardRole: "COACH",
      email: COACH.email,
      phone: "+919840000100",
      status: "ACTIVE",
      logVariant: "DELIVERY_COACH",
    },
  });
  console.log(`✓ coach            ${COACH.email}`);

  // ── 2. The curriculum - exactly the eight sessions of the Guided agreement ──
  const template = await prisma.curriculumTemplate.upsert({
    where: { id: "demo-guided-curriculum" },
    update: { name: "Guided Mode - 4 weeks + 90-day sprint", active: true, sprintDays: 90 },
    create: {
      id: "demo-guided-curriculum",
      line: "B2",
      name: "Guided Mode - 4 weeks + 90-day sprint",
      levelCode: "GUIDED",
      description: "The Phase 1 group sessions exactly as Annexure A of the Guided agreement lists them.",
      sprintDays: 90,
    },
  });
  await prisma.curriculumItem.deleteMany({ where: { templateId: template.id } });
  await prisma.curriculumItem.createMany({
    data: GUIDED_CURRICULUM_SEED.map((r) => ({
      ...r,
      type: r.type as never,
      delivery: r.delivery as never,
      templateId: template.id,
    })),
  });
  const items = await prisma.curriculumItem.findMany({
    where: { templateId: template.id },
    orderBy: [{ weekNumber: "asc" }, { orderIndex: "asc" }],
  });
  console.log(`✓ curriculum       ${items.length} sessions across 4 weeks`);

  /**
   * ── 3. The start date, chosen so the cohort is MID-FLIGHT ──
   * The point of the demo is that some classes are behind us (registers taken, recordings due)
   * and some are ahead (join links, reminders). So anchor three weeks back, on the Saturday the
   * curriculum's first session wants.
   */
  const start = new Date(Date.now() - 21 * DAY);
  while (start.getUTCDay() !== 6) start.setUTCDate(start.getUTCDate() - 1);
  const plan = planTimetable(items as unknown as CurriculumRow[], ymd(start), { sprintDays: 90 });

  // ── 4. The batch ──
  const batch = await prisma.batch.upsert({
    where: { code: "B14" },
    update: {
      name: "Guided - Batch 14",
      tutorId: coachId,
      curriculumTemplateId: template.id,
      startDate: new Date(`${ymd(start)}T00:00:00Z`),
      sprintStartDate: plan.sprintStartYmd ? new Date(`${plan.sprintStartYmd}T00:00:00Z`) : null,
      status: "ACTIVE",
    },
    create: {
      code: "B14",
      line: "B2",
      name: "Guided - Batch 14",
      level: "GUIDED",
      tutorId: coachId,
      targetStrength: 8,
      curriculumTemplateId: template.id,
      startDate: new Date(`${ymd(start)}T00:00:00Z`),
      sprintStartDate: plan.sprintStartYmd ? new Date(`${plan.sprintStartYmd}T00:00:00Z`) : null,
    },
  });
  console.log(`✓ batch            ${batch.name} (${batch.code}) from ${ymd(start)}`);

  // ── 5. Students + enrollments, seated and coached ──
  const studentIds: string[] = [];
  for (const s of STUDENTS) {
    const student = await prisma.student.upsert({
      where: { code: s.code },
      update: { fullName: s.fullName, phone: s.phone, targetRole: s.targetRole },
      create: { ...s, email: `${s.code.toLowerCase()}@example.com` },
    });
    studentIds.push(student.id);
    const existing = await prisma.enrollment.findFirst({ where: { studentId: student.id, batchId: batch.id } });
    if (!existing) {
      await prisma.enrollment.create({
        data: {
          studentId: student.id,
          batchId: batch.id,
          programLevel: "GUIDED",
          enrollmentDate: new Date(`${ymd(start)}T00:00:00Z`),
          duration: "DAYS_90",
          programEndDate: new Date(start.getTime() + 90 * DAY),
          assignedCoach: COACH.name,
          coachId,
          currentMilestone: "APPLICATIONS",
          milestoneLogs: { create: { newMilestone: "ONBOARDING" } },
        },
      });
    } else {
      await prisma.enrollment.update({ where: { id: existing.id }, data: { coachId, assignedCoach: COACH.name } });
    }
  }
  console.log(`✓ roster           ${studentIds.length} students seated and coached`);

  // ── 6. The timetable ──
  await prisma.classSession.deleteMany({ where: { batchId: batch.id } });
  for (const s of plan.sessions) {
    await prisma.classSession.create({
      data: {
        batchId: batch.id,
        curriculumItemId: s.curriculumItemId,
        title: s.title,
        framework: s.framework,
        type: s.type as never,
        delivery: s.delivery as never,
        weekNumber: s.weekNumber,
        orderIndex: s.orderIndex,
        durationMins: s.durationMins,
        startsAt: s.startsAt,
        notes: s.notes,
        joinUrl: s.delivery === "LIVE" ? "https://zoom.us/j/98412345678" : "https://community.b2consultants.de/modules/interviews",
        createdById: coachId,
      },
    });
  }
  const sessions = await prisma.classSession.findMany({
    where: { batchId: batch.id },
    orderBy: { startsAt: "asc" },
  });
  console.log(`✓ timetable        ${sessions.length} sessions, sprint from ${plan.sprintStartYmd}`);

  /**
   * ── 7. One class 75 minutes from now ──
   * So the in-app bell, the "Next up" card and the join button are all actually in their
   * interesting state when the app is opened, rather than pointing at something next weekend.
   */
  const upcoming = sessions.find((s) => s.startsAt.getTime() > Date.now() && s.delivery === "LIVE");
  if (upcoming) {
    await prisma.classSession.update({
      where: { id: upcoming.id },
      data: { startsAt: new Date(Date.now() + 75 * 60_000) },
    });
    console.log(`✓ next class        "${upcoming.title}" moved to 75 minutes from now`);
  }

  // ── 8. Registers on the past classes - one student drifting, so the signals have something
  //       to say. The last past class is left UNMARKED on purpose: that is the coach's to-do.
  const past = sessions.filter((s) => s.startsAt.getTime() < Date.now() && s.delivery === "LIVE");
  const toMark = past.slice(0, Math.max(0, past.length - 1));
  for (const [i, s] of toMark.entries()) {
    for (const [j, studentId] of studentIds.entries()) {
      // Vikram (last in the list) misses the later sessions - the drop-risk signal needs a
      // reason to fire, and an all-present register teaches the colour nothing.
      const absent =
        (j === studentIds.length - 1 && i >= 1) ||
        /**
         * The student with the portal login (first in the list) misses ONE class - the one
         * whose recording is overdue below.
         *
         * Without this the only absent student was Vikram, who has no login, so the whole
         * student-facing half of this feature - the absence notice, the catch-up nudge, the
         * "you are 40% through it" line - was unreachable in the preview. A demo that cannot
         * show the student's side of a student-facing feature is not a demo of it.
         */
        (j === 0 && i === 1);
      const late = j === 2 && i === 1;
      await prisma.sessionAttendance.upsert({
        where: { sessionId_studentId: { sessionId: s.id, studentId } },
        update: {},
        create: {
          sessionId: s.id,
          studentId,
          status: absent ? "ABSENT" : late ? "LATE" : "PRESENT",
          markedById: coachId,
        },
      });
    }
  }
  console.log(`✓ registers        ${toMark.length} of ${past.length} past classes marked (one left to take)`);

  /**
   * ── 8b. Publish all but the newest register ──
   * The publish gate means an unpublished register is invisible to the student, so a demo that
   * marked everything and published nothing would show a cohort three weeks in with no
   * attendance history at all - which looks like the feature is broken rather than like a gate
   * doing its job. The newest one is left unpublished on purpose, so the coach's "Not shown to
   * students" list has something in it.
   */
  const toPublish = toMark.slice(0, Math.max(0, toMark.length - 1));
  for (const s of toPublish) {
    await prisma.classSession.update({
      where: { id: s.id },
      data: { attendancePublishedAt: new Date(s.startsAt.getTime() + 2 * 3_600_000), attendancePublishedById: coachId },
    });
  }
  console.log(`✓ published        ${toPublish.length} of ${toMark.length} registers shown to the batch`);

  /**
   * ── 8c. ONE CLASS IN PROGRESS, WITH THE REGISTER OPEN ──
   * The whole point of the window is a state that only exists for fifteen minutes a week, so a
   * preview that never shows it cannot be used to judge the feature. This moves the last
   * unmarked past class to ten minutes ago, opens a window for fifteen, and checks two of the
   * roster in - so the coach's board is live, the sheet is filling, and the remaining students
   * still see a working button to press.
   */
  const inProgress = past[past.length - 1];
  if (inProgress) {
    const startedAt = new Date(Date.now() - 10 * 60_000);
    await prisma.classSession.update({
      where: { id: inProgress.id },
      data: {
        startsAt: startedAt,
        attendanceOpensAt: startedAt,
        attendanceClosesAt: new Date(Date.now() + 15 * 60_000),
        attendanceGraceMins: 10,
        attendanceOpenedById: coachId,
        attendancePublishedAt: null,
        attendancePublishedById: null,
      },
    });
    // Two arrivals, one of them after the grace ran out - so LATE is visible on the sheet
    // without anybody having to wait ten minutes to produce one.
    for (const [j, studentId] of studentIds.slice(0, 2).entries()) {
      await prisma.sessionAttendance.upsert({
        where: { sessionId_studentId: { sessionId: inProgress.id, studentId } },
        update: {},
        create: {
          sessionId: inProgress.id,
          studentId,
          status: j === 1 ? "LATE" : "PRESENT",
          source: "SELF",
          checkedInAt: new Date(startedAt.getTime() + (j === 1 ? 12 : 2) * 60_000),
          markedById: null,
        },
      });
    }
    console.log(`✓ live register    "${inProgress.title}" is in progress, open for 15 more minutes`);
  }

  /**
   * ── 8d. RECORDINGS, in every state the catch-up list can report ──
   * The list is only judgeable against a cohort that actually has videos, and each row on it
   * means a different action - so the demo produces one of each rather than six identical ones:
   *
   *   · an old recording with an open window that an absent student has not watched → OVERDUE
   *   · one whose window has already closed, still unwatched            → WINDOW_CLOSED
   *   · one posted an hour ago                                          → still in grace
   *   · a class left with no recording at all                           → NO_RECORDING
   */
  const recordable = toPublish.length >= 3 ? toPublish : toMark;
  const EMBED = "https://www.youtube.com/embed/dQw4w9WgXcQ";
  const WATCH = "https://www.youtube.com/watch?v=dQw4w9WgXcQ";
  for (const [i, s] of recordable.entries()) {
    // The last of them is deliberately left WITHOUT a recording - that row is the coach's own
    // chore, and a list that never shows it hides our failures and blames students for them.
    if (i === recordable.length - 1) continue;

    /**
     * The states are pinned to the classes people were actually ABSENT from, not to the first
     * three recordings. An expired window on a class with a full register produces no row at
     * all, which is correct behaviour and a useless demo.
     */
    const postedAt =
      i === 1
        ? new Date(Date.now() - 3 * DAY) // past the 24h grace, window still open → OVERDUE
        : i === 2
          ? new Date(Date.now() - 5 * DAY) // window since expired → WINDOW_CLOSED
          : new Date(Date.now() - 10 * DAY); // old, no limit - a full register, so no row

    const availableUntil =
      i === 1
        ? new Date(postedAt.getTime() + 14 * DAY)
        : i === 2
          ? new Date(postedAt.getTime() + 2 * DAY) // closed three days before today
          : null; // no limit

    const rec = await prisma.gnRecording.create({
      data: {
        batchId: batch.id,
        title: s.title,
        classDate: new Date(`${ymd(s.startsAt)}T00:00:00Z`),
        videoUrl: WATCH,
        provider: "YOUTUBE",
        embedUrl: EMBED,
        postedById: coachId,
        availableUntil,
        createdAt: postedAt,
      },
    });
    await prisma.classSession.update({ where: { id: s.id }, data: { recordingId: rec.id } });

    /**
     * One student HAS watched the middle one, and only to 40% while ticking it done.
     *
     * That is the disputed case `resolveWatchTruth` exists for (spec §10.3) and the one the
     * coach's list has to get right: the tick says finished, the tracking says not, and the
     * tracking wins. A demo where every watch row is either absent or 100% never shows it.
     */
    if (i === 1) {
      // The absent student WITH a login - i.e. the one the register seed above marks absent
      // from this very class. A watch row on anyone who attended would never show here.
      const watcher = await prisma.student.findUnique({
        where: { id: studentIds[0] },
        select: { userId: true },
      });
      if (watcher?.userId) {
        await prisma.gnRecordingWatch.upsert({
          where: { recordingId_userId: { recordingId: rec.id, userId: watcher.userId } },
          update: {},
          create: {
            recordingId: rec.id,
            userId: watcher.userId,
            selfReported: true,
            watchedPct: 40,
            positionSecs: 240,
            durationSecs: 600,
            lastHeartbeatAt: new Date(),
          },
        });
      }
    }
  }
  console.log(`✓ recordings       ${Math.max(0, recordable.length - 1)} posted (one expired, one in grace, one class left bare)`);

  /**
   * ── 8e. ONE ABSENCE QUESTION, ASKED ──
   * The reason box only exists once a coach has pressed "Ask why", so a preview with no asked
   * question cannot show the student's side of it at all. Asked on the login-holder's absence.
   */
  const askable = await prisma.sessionAttendance.findFirst({
    where: { studentId: studentIds[0], status: "ABSENT" },
    select: { id: true, session: { select: { title: true } } },
  });
  if (askable) {
    await prisma.sessionAttendance.update({
      where: { id: askable.id },
      // Deliberately left UNANSWERED: the point of the demo is the prompt on the student's
      // dashboard, and seeding an answer would skip straight past it.
      data: { reasonAskedAt: new Date(Date.now() - 2 * 3_600_000), reasonAskedById: coachId, reason: null },
    });
    console.log(`✓ absence question asked about "${askable.session.title}" - unanswered on purpose`);
  }

  /**
   * ── 8f. LEADERBOARD FUEL ──
   * The board reads mostly from records that already exist (the register, watch rows, coursework
   * ticks), and this fills the two it cannot invent: job applications and the self-reported
   * sprint log. Spread unevenly on purpose - a board where everyone scores the same ranks
   * nobody, and the tie handling is only visible when there IS a tie.
   */
  const APPS = [
    { company: "Siemens Energy", role: "Process Engineer", status: "INTERVIEW" as const },
    { company: "Bosch", role: "Manufacturing Engineer", status: "APPLIED" as const },
    { company: "ThyssenKrupp", role: "Project Engineer", status: "REJECTED" as const },
    { company: "Linde", role: "Process Engineer", status: "SELECTED" as const },
    { company: "BASF", role: "Production Engineer", status: "APPLIED" as const },
  ];
  const enrollmentsForLog = await prisma.enrollment.findMany({
    where: { studentId: { in: studentIds }, status: "ACTIVE" },
    select: { id: true, studentId: true, enrollmentDate: true },
  });
  await prisma.jobApplication.deleteMany({ where: { enrollmentId: { in: enrollmentsForLog.map((e) => e.id) } } });
  await prisma.sprintLogEntry.deleteMany({ where: { enrollmentId: { in: enrollmentsForLog.map((e) => e.id) } } });

  const LOG_KINDS = ["HR_CONNECTION", "APPLICATION_REVIEWED", "HR_INTERVIEW", "WIN"] as const;
  for (const [j, e] of enrollmentsForLog.entries()) {
    const effort = Math.max(0, enrollmentsForLog.length - j); // the first names try hardest
    for (let k = 0; k < Math.min(effort, APPS.length); k++) {
      const a = APPS[k];
      await prisma.jobApplication.create({
        data: {
          enrollmentId: e.id,
          company: a.company,
          role: a.role,
          status: a.status,
          // Inside the scored window, and never before they enrolled.
          appliedAt: new Date(Math.max(e.enrollmentDate.getTime(), Date.now() - (k + 2) * DAY)),
        },
      });
    }
    for (let k = 0; k < effort; k++) {
      await prisma.sprintLogEntry.create({
        data: {
          enrollmentId: e.id,
          kind: LOG_KINDS[k % LOG_KINDS.length],
          // A quantity above 1 on one entry, so the weekly cap has something to bite on and
          // the "25 of 60" line in the breakdown is reachable in the preview.
          quantity: k === 0 ? 1 + effort * 6 : 1,
          occurredOn: new Date(
            new Date(Math.max(e.enrollmentDate.getTime(), Date.now() - (k + 1) * DAY))
              .toISOString()
              .slice(0, 10) + "T00:00:00Z",
          ),
          company: k % 2 === 0 ? "Siemens Energy" : null,
          note: LOG_KINDS[k % LOG_KINDS.length] === "WIN" ? "Recruiter replied to my InMail" : null,
          source: "STUDENT",
          loggedById: null,
        },
      });
    }
  }
  console.log(`✓ leaderboard      applications + sprint log seeded for ${enrollmentsForLog.length} students`);

  // ── 9. Coursework on a past class, fanned out to the roster ──
  const homeworkOn = past[past.length - 1] ?? sessions[0];
  if (homeworkOn) {
    await prisma.sessionTask.deleteMany({ where: { sessionId: homeworkOn.id } });
    const task = await prisma.sessionTask.create({
      data: {
        sessionId: homeworkOn.id,
        type: "APPLY_JOB",
        title: "Apply to 10 roles on StepStone and log them",
        description: "Use the O.P.E.N. framework from the session. Record each application in your tracker.",
        dueAt: new Date(Date.now() + 3 * DAY),
        createdById: coachId,
      },
    });
    await prisma.sessionTaskCompletion.createMany({
      data: studentIds.map((studentId, j) => ({
        taskId: task.id,
        studentId,
        // Half the batch has done it - so the coach's "outstanding" column is not all zeros
        // and the student's own progress bar is not at 0% or 100%.
        status: j % 2 === 0 ? ("YES" as const) : ("PENDING" as const),
        completedAt: j % 2 === 0 ? new Date() : null,
      })),
      skipDuplicates: true,
    });
    console.log(`✓ coursework       set on "${homeworkOn.title}", ${Math.ceil(studentIds.length / 2)} done`);
  }

  // ── 10. Course material at all three scopes, so the shelves are not empty ──
  //
  // One of each on purpose: a curriculum-level worksheet (every cohort inherits it), a
  // batch-level group link, a class-level deck, and one staged resource that students cannot
  // see yet - which is the case a screenshot of a working feature usually misses.
  const kickOff = items.find((i) => i.title === "Kick Off");
  const resumeItem = items.find((i) => i.title === "Resume Building");
  const openMarket = sessions.find((s) => s.title === "Open Job Market");

  await prisma.resource.deleteMany({
    where: {
      OR: [
        { batchId: batch.id },
        { sessionId: { in: sessions.map((s) => s.id) } },
        { curriculumItemId: { in: items.map((i) => i.id) } },
      ],
    },
  });

  const resources: { title: string; url: string; kind: "DOCUMENT" | "VIDEO" | "TEMPLATE" | "TOOL" | "LINK"; description?: string; visible?: boolean; where: Record<string, string> }[] = [
    {
      title: "German-format CV template",
      url: "https://docs.google.com/document/d/1kickoff-cv-template/edit",
      kind: "TEMPLATE",
      description: "Make a copy before you start. Do not change the section order.",
      where: { curriculumItemId: resumeItem?.id ?? "" },
    },
    {
      title: "Programme handbook",
      url: "https://drive.google.com/file/d/1handbook/view",
      kind: "DOCUMENT",
      description: "What the 4 weeks and the sprint cover, week by week.",
      where: { curriculumItemId: kickOff?.id ?? "" },
    },
    {
      title: "Batch 14 WhatsApp group",
      url: "https://chat.whatsapp.com/BatchFourteenDemo",
      kind: "TOOL",
      description: "Day-to-day questions and announcements.",
      where: { batchId: batch.id },
    },
    {
      title: "Shared drive - Batch 14",
      url: "https://drive.google.com/drive/folders/batch-14-demo",
      kind: "DOCUMENT",
      description: "Everything handed out in class.",
      where: { batchId: batch.id },
    },
    {
      title: "O.P.E.N. framework slides",
      url: "https://drive.google.com/file/d/1open-framework-deck/view",
      kind: "DOCUMENT",
      description: "The deck from the session.",
      where: { sessionId: openMarket?.id ?? "" },
    },
    {
      title: "StepStone search presets",
      url: "https://www.stepstone.de/jobs",
      kind: "TOOL",
      where: { sessionId: openMarket?.id ?? "" },
    },
    {
      title: "Week 4 mock interview brief (release after class)",
      url: "https://drive.google.com/file/d/1mock-brief/view",
      kind: "DOCUMENT",
      description: "Staged - students cannot see this one yet.",
      visible: false,
      where: { batchId: batch.id },
    },
  ];

  let posted = 0;
  for (const [i, r] of resources.entries()) {
    const scopeId = Object.values(r.where)[0];
    if (!scopeId) continue;
    await prisma.resource.create({
      data: {
        title: r.title,
        url: r.url,
        kind: r.kind,
        description: r.description ?? null,
        visibleToStudents: r.visible ?? true,
        orderIndex: i,
        createdById: coachId,
        ...r.where,
      },
    });
    posted += 1;
  }
  console.log(`✓ resources        ${posted} posted (curriculum, batch and class level; 1 staged)`);

  // ── 11. A student login, on the first student ──
  const studentUserId = await ensureLogin({
    name: STUDENTS[0].fullName,
    email: STUDENT_LOGIN.email,
    password: STUDENT_LOGIN.password,
    role: "STUDENT",
  });
  /**
   * `Student.userId` is UNIQUE, and this demo email may already be linked to whichever student
   * an earlier run of `provision-portal-demo.ts` picked. Unlink it there first - otherwise a
   * second run of this script dies on the constraint instead of being idempotent.
   */
  await prisma.student.updateMany({
    where: { userId: studentUserId, NOT: { id: studentIds[0] } },
    data: { userId: null },
  });
  await prisma.student.update({ where: { id: studentIds[0] }, data: { userId: studentUserId } });
  console.log(`✓ student login    ${STUDENT_LOGIN.email} → ${STUDENTS[0].fullName}`);

  console.log("\n─────────── sign in at http://localhost:3000 ───────────");
  console.log(`  Coach    ${COACH.email}          / ${COACH.password}        → /coaching`);
  console.log(`  Student  ${STUDENT_LOGIN.email}  / ${STUDENT_LOGIN.password}  → /classroom`);
  console.log("────────────────────────────────────────────────────────");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
