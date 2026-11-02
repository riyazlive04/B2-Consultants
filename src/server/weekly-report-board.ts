import "server-only";
import { cache } from "react";
import { prisma } from "@/lib/prisma";
import { hasCapability } from "@/lib/capabilities";
import { toDateInputValue } from "@/lib/dates";
import {
  summariseWeekly,
  weeklyThresholdsFor,
  type WeeklyFlagValue,
  type WeeklyMetricKey,
  type WeeklyRollup,
  type WeeklyThresholds,
  type WeeklyWeekInput,
} from "@/lib/weekly-flags";
import { batchRosters } from "./batch-membership";
import { getWeeklyReportConfig } from "./founder-config";
import type { WeeklyReportConfig } from "@/lib/config-schema";
import type { AppSession } from "@/lib/rbac";

/**
 * THE WEEKLY REPORT DASHBOARD - the reads.
 *
 * All of the judgement is in lib/weekly-flags.ts (pure, unit-tested). This file gathers rows
 * and hands them over, which is the same division as attendance.ts ↔ lib/attendance.ts and
 * leaderboard.ts ↔ lib/leaderboard.ts.
 *
 * ── FOUR queries, however many cohorts and weeks ──────────────────────────────────────
 * The obvious implementation is a query per cohort for the roster and another per week for
 * the answers. On a head coach's screen with a dozen cohorts and thirteen weeks that is
 * well over a hundred round trips on a page somebody opens every Monday morning. So each
 * fact is read ONCE across the whole window - cycles, responses with their answers, reviews,
 * rosters - and bucketed in memory. The same mistake, and the same fix, as the teaching
 * desk's shell, which was running seven queries to render a greeting.
 *
 * ── A batch id in a query string is not authorisation ─────────────────────────────────
 * `visibleBatchIds` decides what a viewer may read, and every function here starts from it.
 * ADMIN and HEAD see every cohort; a TUTOR sees the ones they teach; a COACH sees the ones
 * their own students sit in. That is not a new rule - it is the one already written in
 * batch-access.ts and batch-detail.ts, read from one place so it cannot drift here.
 *
 * ── Not to be confused with server/weekly-report.ts ───────────────────────────────────
 * That file derives what the RECORDS say a student did, bucketed by sprint week, and stores
 * nothing. This one reads what the STUDENT said, on a form. The two are shown beside each
 * other on the student record; see the header there.
 */

/** How much history the flag engine is given. Thirteen weeks is a full Guided sprint. */
const HISTORY_WEEKS = 13;

export type WeeklyBoardCohort = {
  batchId: string;
  name: string;
  code: string | null;
  line: string;
  level: string;
  tutorName: string | null;
  /** The question set chosen for this cohort, or null to follow the line/level default. */
  weeklyTemplateId: string | null;
};

/** The question sets a cohort may be switched to. */
export type WeeklyTemplateOption = {
  id: string;
  name: string;
  line: string;
  levelCode: string | null;
};

export type WeeklyStudentRow = {
  studentId: string;
  name: string;
  /** The human-readable Student ID. Shown beside the name because two students share one. */
  code: string | null;
  programLevel: string | null;
  submitted: boolean;
  late: boolean;
  submittedAt: Date | null;
  /** This week's answers by meaning, so a reworded question still lands in the right column. */
  metrics: Partial<Record<WeeklyMetricKey, number | null>>;
  /** The free-text answers, label → what they wrote. Blockers and anything else unscored. */
  notes: { label: string; value: string }[];
  /** Flag, reasons, streak, weeks silent - all derived from the full history. */
  rollup: WeeklyRollup;
  review: {
    flag: WeeklyFlagValue | null;
    action: string;
    followUpNeeded: boolean;
    note: string | null;
    shareWithStudent: boolean;
    reviewedByName: string | null;
    reviewedAt: Date;
  } | null;
};

export type WeeklyCycleView = {
  id: string;
  isoWeek: string;
  weekStart: Date;
  weekEnd: Date;
  batchWeekNumber: number | null;
  status: "OPEN" | "CLOSED";
  opensAt: Date;
  closesAt: Date;
  sentAt: Date | null;
};

export type WeeklyBoard = {
  config: WeeklyReportConfig;
  cohorts: WeeklyBoardCohort[];
  /** Every active question set, so a cohort can be moved to the one it is actually running. */
  templates: WeeklyTemplateOption[];
  /** The cohort being shown, or null when the viewer has none. */
  selected: WeeklyBoardCohort | null;
  /** Every week this cohort has a cycle for, newest first, for the week picker. */
  weeks: WeeklyCycleView[];
  cycle: WeeklyCycleView | null;
  rows: WeeklyStudentRow[];
  totals: {
    roster: number;
    submitted: number;
    missing: number;
    late: number;
    /**
     * Students on the roster whose record has no portal login attached.
     *
     * The form is answered in the portal and nowhere else, so a student with no account
     * cannot report at all - and the only symptom is a week with no submission, which looks
     * exactly like a student ignoring you. Counted here so the screen can say so before the
     * week is sent out rather than after it comes back empty.
     */
    withoutLogin: number;
    green: number;
    yellow: number;
    red: number;
    /** Null when nobody was asked a countable question, never 0 - see lib/weekly-flags.ts. */
    applications: number | null;
    interviews: number | null;
  };
  canManage: boolean;
};

/**
 * Which cohorts this viewer may read, and whether they may act on them.
 *
 * One query, and the same three rules as the rest of the app:
 *   ADMIN / HEAD / `batches.manage`  - every cohort, and may send.
 *   the batch's tutor               - their own cohorts, and may send.
 *   a coach                         - cohorts holding a student they coach, read only.
 */
export const visibleBatchIds = cache(
  async (session: AppSession): Promise<{ ids: string[]; manageAll: boolean }> => {
    const manageAll =
      session.role === "ADMIN" ||
      session.role === "HEAD" ||
      hasCapability(session.role as never, (session.capabilities ?? null) as never, "batches.manage");

    const batches = await prisma.batch.findMany({
      where: manageAll
        ? { status: "ACTIVE" }
        : {
            status: "ACTIVE",
            OR: [
              { tutorId: session.user.id },
              { enrollments: { some: { coachId: session.user.id } } },
            ],
          },
      select: { id: true },
      orderBy: { name: "asc" },
    });
    return { ids: batches.map((b) => b.id), manageAll };
  },
);

/** Whether this viewer may open, send or revoke for this particular cohort. */
async function canManageCohort(session: AppSession, batchId: string, manageAll: boolean): Promise<boolean> {
  if (manageAll) return true;
  const batch = await prisma.batch.findUnique({ where: { id: batchId }, select: { tutorId: true } });
  return !!batch && batch.tutorId === session.user.id;
}

type ResponseRow = {
  cycleId: string;
  studentId: string;
  submittedAt: Date;
  late: boolean;
  answers: {
    numeric: number | null;
    value: unknown;
    question: { key: string; label: string; metric: string };
  }[];
};

/** Turn one submission's answers into the metric map the flag engine reads. */
function metricsOf(row: ResponseRow | undefined): Partial<Record<WeeklyMetricKey, number | null>> {
  const out: Partial<Record<WeeklyMetricKey, number | null>> = {};
  if (!row) return out;
  for (const a of row.answers) {
    const key = a.question.metric as WeeklyMetricKey;
    // BLOCKERS and OTHER are words, not counts. Letting a multi-select's selection count
    // land in the metric map would have the flag engine comparing "2 blockers" with a target.
    if (key === "BLOCKERS" || key === "OTHER") continue;
    if (a.numeric !== null) out[key] = a.numeric;
  }
  return out;
}

/** The answers worth reading rather than counting: blockers, wins, anything free-text. */
function notesOf(row: ResponseRow | undefined): { label: string; value: string }[] {
  if (!row) return [];
  const out: { label: string; value: string }[] = [];
  for (const a of row.answers) {
    const metric = a.question.metric as WeeklyMetricKey;
    const isWords = metric === "BLOCKERS" || metric === "OTHER";
    if (!isWords) continue;
    const text = Array.isArray(a.value)
      ? a.value.map((v) => String(v)).join(", ")
      : a.value === null || a.value === undefined
        ? ""
        : String(a.value);
    if (text.trim()) out.push({ label: a.question.label, value: text });
  }
  return out;
}

const RESPONSE_SELECT = {
  cycleId: true,
  studentId: true,
  submittedAt: true,
  late: true,
  answers: {
    select: {
      numeric: true,
      value: true,
      question: { select: { key: true, label: true, metric: true } },
    },
  },
} as const;

/**
 * One cohort's week, with every student's history behind each flag.
 *
 * `isoWeek` null means "the latest week that has a cycle", which is what the founders want on
 * open: the Monday question is about the week that just closed, not about whichever week was
 * last looked at.
 */
/**
 * How many of these students have no portal login.
 *
 * One query rather than a field on the roster seam: `BatchSeat` is deliberately lossy about
 * everything that is not membership, and a German Note seat has no enrolment to hang this on.
 */
async function countWithoutLogin(studentIds: string[]): Promise<number> {
  if (studentIds.length === 0) return 0;
  return prisma.student.count({ where: { id: { in: studentIds }, userId: null } });
}

export async function getWeeklyBoard(
  session: AppSession,
  opts: { batchId?: string | null; isoWeek?: string | null } = {},
): Promise<WeeklyBoard> {
  const [config, { ids, manageAll }] = await Promise.all([
    getWeeklyReportConfig(),
    visibleBatchIds(session),
  ]);

  const templateRows = await prisma.weeklyReportTemplate.findMany({
    where: { active: true },
    select: { id: true, name: true, line: true, levelCode: true },
    orderBy: [{ line: "asc" }, { name: "asc" }],
  });

  const cohortRows = await prisma.batch.findMany({
    where: { id: { in: ids } },
    select: {
      id: true,
      name: true,
      code: true,
      line: true,
      level: true,
      startDate: true,
      weeklyTemplateId: true,
      tutor: { select: { name: true } },
    },
    orderBy: [{ line: "asc" }, { name: "asc" }],
  });

  const cohorts: WeeklyBoardCohort[] = cohortRows.map((b) => ({
    batchId: b.id,
    name: b.name,
    code: b.code,
    line: b.line,
    level: b.level,
    tutorName: b.tutor?.name ?? null,
    weeklyTemplateId: b.weeklyTemplateId,
  }));

  // A batch id from the query string is validated against what the viewer actually runs; it
  // is never trusted as authorisation. Same rule the leaderboard states out loud.
  const selected =
    cohorts.find((c) => c.batchId === opts.batchId) ?? cohorts[0] ?? null;

  if (!selected) {
    return {
      config,
      cohorts,
      templates: templateRows,
      selected: null,
      weeks: [],
      cycle: null,
      rows: [],
      totals: {
        roster: 0, submitted: 0, missing: 0, late: 0, withoutLogin: 0,
        green: 0, yellow: 0, red: 0, applications: null, interviews: null,
      },
      canManage: false,
    };
  }

  const canManage = await canManageCohort(session, selected.batchId, manageAll);

  const cycleRows = await prisma.weeklyReportCycle.findMany({
    where: { batchId: selected.batchId },
    orderBy: { weekStart: "desc" },
    take: HISTORY_WEEKS,
    select: {
      id: true, isoWeek: true, weekStart: true, weekEnd: true, batchWeekNumber: true,
      status: true, opensAt: true, closesAt: true, sentAt: true,
    },
  });

  const weeks: WeeklyCycleView[] = cycleRows.map((c) => ({
    id: c.id,
    isoWeek: c.isoWeek,
    weekStart: c.weekStart,
    weekEnd: c.weekEnd,
    batchWeekNumber: c.batchWeekNumber,
    status: c.status as "OPEN" | "CLOSED",
    opensAt: c.opensAt,
    closesAt: c.closesAt,
    sentAt: c.sentAt,
  }));

  const cycle = weeks.find((w) => w.isoWeek === opts.isoWeek) ?? weeks[0] ?? null;

  if (!cycle) {
    const seats = (await batchRosters([selected.batchId])).get(selected.batchId) ?? [];
    return {
      config,
      cohorts,
      templates: templateRows,
      selected,
      weeks,
      cycle: null,
      rows: [],
      totals: {
        roster: seats.length, submitted: 0, missing: 0, late: 0,
        withoutLogin: await countWithoutLogin(seats.map((s) => s.studentId)),
        green: 0, yellow: 0, red: 0, applications: null, interviews: null,
      },
      canManage,
    };
  }

  const cycleIds = weeks.map((w) => w.id);
  const [rosterMap, responses, reviews] = await Promise.all([
    batchRosters([selected.batchId]),
    prisma.weeklyReportResponse.findMany({
      where: { cycleId: { in: cycleIds } },
      select: RESPONSE_SELECT,
    }),
    prisma.weeklyReportReview.findMany({
      where: { cycleId: { in: cycleIds } },
      select: {
        cycleId: true, studentId: true, flag: true, action: true, followUpNeeded: true,
        note: true, shareWithStudent: true, reviewedAt: true,
        reviewedBy: { select: { name: true, email: true } },
      },
    }),
  ]);

  const seats = rosterMap.get(selected.batchId) ?? [];
  const byStudentWeek = new Map<string, ResponseRow>();
  for (const r of responses) byStudentWeek.set(`${r.cycleId}:${r.studentId}`, r);
  const reviewByKey = new Map(reviews.map((r) => [`${r.cycleId}:${r.studentId}`, r]));

  // Oldest first: the flag engine walks history forwards, and the escalation and recovery
  // rules are meaningless in any other order.
  const chronological = [...weeks].reverse();

  const rows: WeeklyStudentRow[] = seats.map((seat) => {
    const history: WeeklyWeekInput[] = chronological.map((w) => {
      const res = byStudentWeek.get(`${w.id}:${seat.studentId}`);
      const rev = reviewByKey.get(`${w.id}:${seat.studentId}`);
      return {
        isoWeek: w.isoWeek,
        weekStart: toDateInputValue(w.weekStart),
        submitted: Boolean(res),
        late: res?.late ?? false,
        metrics: metricsOf(res),
        override: (rev?.flag ?? null) as WeeklyFlagValue | null,
      };
    });

    const thresholds = weeklyThresholdsFor(
      seat.programLevel,
      config.thresholds,
      config.perLevel,
    );
    const rollup = summariseWeekly(history, thresholds);

    const thisWeek = byStudentWeek.get(`${cycle.id}:${seat.studentId}`);
    const rev = reviewByKey.get(`${cycle.id}:${seat.studentId}`);

    return {
      studentId: seat.studentId,
      name: seat.name,
      code: seat.code,
      programLevel: seat.programLevel,
      submitted: Boolean(thisWeek),
      late: thisWeek?.late ?? false,
      submittedAt: thisWeek?.submittedAt ?? null,
      metrics: metricsOf(thisWeek),
      notes: notesOf(thisWeek),
      rollup,
      review: rev
        ? {
            flag: rev.flag as WeeklyFlagValue | null,
            action: rev.action,
            followUpNeeded: rev.followUpNeeded,
            note: rev.note,
            shareWithStudent: rev.shareWithStudent,
            reviewedByName: rev.reviewedBy?.name ?? rev.reviewedBy?.email ?? null,
            reviewedAt: rev.reviewedAt,
          }
        : null,
    };
  });

  const sumMetric = (key: WeeklyMetricKey): number | null => {
    const values = rows.map((r) => r.metrics[key]).filter((v): v is number => typeof v === "number");
    return values.length > 0 ? values.reduce((a, b) => a + b, 0) : null;
  };

  return {
    config,
    cohorts,
    templates: templateRows,
    selected,
    weeks,
    cycle,
    rows,
    totals: {
      roster: rows.length,
      submitted: rows.filter((r) => r.submitted).length,
      missing: rows.filter((r) => !r.submitted).length,
      late: rows.filter((r) => r.late).length,
      withoutLogin: await countWithoutLogin(rows.map((r) => r.studentId)),
      green: rows.filter((r) => r.rollup.flag === "GREEN").length,
      yellow: rows.filter((r) => r.rollup.flag === "YELLOW").length,
      red: rows.filter((r) => r.rollup.flag === "RED").length,
      applications: sumMetric("APPLICATIONS"),
      interviews: sumMetric("INTERVIEWS"),
    },
    canManage,
  };
}

export type WeeklyAttentionRow = {
  studentId: string;
  name: string;
  code: string | null;
  programLevel: string | null;
  cohortName: string;
  batchId: string;
  rollup: WeeklyRollup;
  /** The latest week's blockers and remarks, so the chase message can be specific. */
  notes: { label: string; value: string }[];
  /**
   * The latest week's own figures and the thresholds they were judged against.
   *
   * Carried together on purpose: the chase message quotes both ("you sent 4, the target is
   * 10"), and reading the number from one place and the target from another is how a message
   * ends up quoting a target the rule did not actually use.
   */
  latest: Partial<Record<WeeklyMetricKey, number | null>>;
  thresholds: WeeklyThresholds;
  phone: string | null;
  escalate: boolean;
};

/**
 * Every yellow and red across the cohorts this viewer runs, worst first.
 *
 * This is the tracker's "STUDENTS NEEDING ATTENTION" block, which the sheet itself asked a
 * person to fill in by hand every week ("Manually copy Yellow/Red flag students here weekly
 * for quick reference"). Deriving it is most of why this feature exists.
 */
export async function getWeeklyAttention(session: AppSession): Promise<{
  rows: WeeklyAttentionRow[];
  config: WeeklyReportConfig;
}> {
  const [config, { ids }] = await Promise.all([getWeeklyReportConfig(), visibleBatchIds(session)]);
  if (ids.length === 0) return { rows: [], config };

  const cycles = await prisma.weeklyReportCycle.findMany({
    where: { batchId: { in: ids } },
    orderBy: { weekStart: "desc" },
    select: {
      id: true, batchId: true, isoWeek: true, weekStart: true,
      batch: { select: { name: true, code: true } },
    },
  });
  if (cycles.length === 0) return { rows: [], config };

  // Keep the most recent HISTORY_WEEKS per cohort. Taking the newest N rows overall would
  // starve a cohort that reports less often of the history its flags depend on.
  const perBatch = new Map<string, typeof cycles>();
  for (const c of cycles) {
    const list = perBatch.get(c.batchId) ?? [];
    if (list.length < HISTORY_WEEKS) {
      list.push(c);
      perBatch.set(c.batchId, list);
    }
  }
  const keptIds = [...perBatch.values()].flat().map((c) => c.id);

  const [rosterMap, responses, reviews, students] = await Promise.all([
    batchRosters([...perBatch.keys()]),
    prisma.weeklyReportResponse.findMany({
      where: { cycleId: { in: keptIds } },
      select: RESPONSE_SELECT,
    }),
    prisma.weeklyReportReview.findMany({
      where: { cycleId: { in: keptIds } },
      select: { cycleId: true, studentId: true, flag: true },
    }),
    prisma.student.findMany({
      where: { gnMemberships: { some: { batchId: { in: [...perBatch.keys()] } } } },
      select: { id: true, phone: true },
    }),
  ]);

  // The enrolment side of the roster is not covered by the membership query above, so phones
  // for B2 students are read alongside it rather than per row.
  const enrolledPhones = await prisma.student.findMany({
    where: { enrollments: { some: { batchId: { in: [...perBatch.keys()] } } } },
    select: { id: true, phone: true },
  });
  const phoneById = new Map<string, string | null>(
    [...students, ...enrolledPhones].map((s) => [s.id, s.phone]),
  );

  const byKey = new Map<string, ResponseRow>();
  for (const r of responses) byKey.set(`${r.cycleId}:${r.studentId}`, r);
  const overrideByKey = new Map(reviews.map((r) => [`${r.cycleId}:${r.studentId}`, r.flag]));

  const out: WeeklyAttentionRow[] = [];

  for (const [batchId, batchCycles] of perBatch) {
    const chronological = [...batchCycles].reverse();
    const seats = rosterMap.get(batchId) ?? [];
    const cohortName = batchCycles[0]?.batch.code
      ? `${batchCycles[0].batch.code} · ${batchCycles[0].batch.name}`
      : (batchCycles[0]?.batch.name ?? "");

    for (const seat of seats) {
      const history: WeeklyWeekInput[] = chronological.map((w) => {
        const res = byKey.get(`${w.id}:${seat.studentId}`);
        return {
          isoWeek: w.isoWeek,
          weekStart: toDateInputValue(w.weekStart),
          submitted: Boolean(res),
          late: res?.late ?? false,
          metrics: metricsOf(res),
          override: (overrideByKey.get(`${w.id}:${seat.studentId}`) ?? null) as WeeklyFlagValue | null,
        };
      });

      const thresholds = weeklyThresholdsFor(seat.programLevel, config.thresholds, config.perLevel);
      const rollup = summariseWeekly(history, thresholds);
      if (rollup.flag === "GREEN") continue;

      const latest = chronological[chronological.length - 1];
      const latestResponse = latest ? byKey.get(`${latest.id}:${seat.studentId}`) : undefined;
      out.push({
        studentId: seat.studentId,
        name: seat.name,
        code: seat.code,
        programLevel: seat.programLevel,
        cohortName,
        batchId,
        rollup,
        notes: notesOf(latestResponse),
        latest: metricsOf(latestResponse),
        thresholds,
        phone: phoneById.get(seat.studentId) ?? null,
        escalate: rollup.escalateToAdmin,
      });
    }
  }

  const order: Record<WeeklyFlagValue, number> = { RED: 0, YELLOW: 1, GREEN: 2 };
  out.sort(
    (a, b) =>
      order[a.rollup.flag] - order[b.rollup.flag] ||
      b.rollup.weeksSilent - a.rollup.weeksSilent ||
      a.name.localeCompare(b.name),
  );

  return { rows: out, config };
}

export type WeeklyPulseWeek = {
  isoWeek: string;
  weekStart: Date;
  submitted: number;
  missing: number;
  applications: number | null;
  interviews: number | null;
};

/**
 * The tracker's "WEEKLY PULSE" block - one row per calendar week across every visible cohort.
 *
 * Grouped by ISO week rather than by cohort week, which is the whole reason the key is the
 * ISO week: two cohorts that started months apart both contribute to the same Monday.
 */
export async function getWeeklyPulse(session: AppSession): Promise<WeeklyPulseWeek[]> {
  const { ids } = await visibleBatchIds(session);
  if (ids.length === 0) return [];

  const cycles = await prisma.weeklyReportCycle.findMany({
    where: { batchId: { in: ids } },
    orderBy: { weekStart: "desc" },
    select: { id: true, batchId: true, isoWeek: true, weekStart: true },
  });
  if (cycles.length === 0) return [];

  const weekKeys = [...new Set(cycles.map((c) => c.isoWeek))].slice(0, HISTORY_WEEKS);
  const kept = cycles.filter((c) => weekKeys.includes(c.isoWeek));

  const [responses, rosterMap] = await Promise.all([
    prisma.weeklyReportResponse.findMany({
      where: { cycleId: { in: kept.map((c) => c.id) } },
      select: RESPONSE_SELECT,
    }),
    batchRosters([...new Set(kept.map((c) => c.batchId))]),
  ]);

  const cycleById = new Map(kept.map((c) => [c.id, c]));
  const byWeek = new Map<string, WeeklyPulseWeek & { apps: number[]; ints: number[] }>();

  for (const c of kept) {
    const existing = byWeek.get(c.isoWeek);
    const roster = (rosterMap.get(c.batchId) ?? []).length;
    if (existing) {
      existing.missing += roster;
    } else {
      byWeek.set(c.isoWeek, {
        isoWeek: c.isoWeek,
        weekStart: c.weekStart,
        submitted: 0,
        // Starts as the whole roster and is decremented per submission below, so "missing"
        // counts the people who were asked rather than the people who answered.
        missing: roster,
        applications: null,
        interviews: null,
        apps: [],
        ints: [],
      });
    }
  }

  for (const r of responses) {
    const cycle = cycleById.get(r.cycleId);
    if (!cycle) continue;
    const bucket = byWeek.get(cycle.isoWeek);
    if (!bucket) continue;
    bucket.submitted += 1;
    bucket.missing = Math.max(0, bucket.missing - 1);
    const m = metricsOf(r);
    if (typeof m.APPLICATIONS === "number") bucket.apps.push(m.APPLICATIONS);
    if (typeof m.INTERVIEWS === "number") bucket.ints.push(m.INTERVIEWS);
  }

  return [...byWeek.values()]
    .map(({ apps, ints, ...rest }) => ({
      ...rest,
      // Null, not 0, for a week nobody was asked a countable question in - a zero here would
      // draw a chart line through the floor and read as a collapse in activity.
      applications: apps.length > 0 ? apps.reduce((a, b) => a + b, 0) : null,
      interviews: ints.length > 0 ? ints.reduce((a, b) => a + b, 0) : null,
    }))
    .sort((a, b) => a.weekStart.getTime() - b.weekStart.getTime());
}

export type WeeklyTemplateDetail = {
  id: string;
  name: string;
  description: string | null;
  line: string;
  levelCode: string | null;
  active: boolean;
  cohortCount: number;
  questions: {
    id: string;
    key: string;
    version: number;
    kind: string;
    metric: string;
    label: string;
    helpText: string | null;
    required: boolean;
    orderIndex: number;
    options: { value: string; label: string; numeric?: number | null }[] | null;
    allowOther: boolean;
    min: number | null;
    max: number | null;
    targetNumeric: number | null;
    answerCount: number;
  }[];
};

/**
 * Every question set and its questions, for the Console builder.
 *
 * Inactive sets are included: a founder needs to see what they switched off in order to
 * switch it back on. Inactive QUESTIONS are not - a retired version is history, and listing
 * every superseded wording would make the editor unreadable within a month. The answer
 * count comes along because it decides what "Remove" does, and the editor says so before
 * the press rather than after.
 */
export const getWeeklyTemplateDetails = cache(async (): Promise<WeeklyTemplateDetail[]> => {
  const rows = await prisma.weeklyReportTemplate.findMany({
    orderBy: [{ line: "asc" }, { name: "asc" }],
    select: {
      id: true,
      name: true,
      description: true,
      line: true,
      levelCode: true,
      active: true,
      _count: { select: { batches: true } },
      questions: {
        where: { active: true },
        orderBy: { orderIndex: "asc" },
        select: {
          id: true, key: true, version: true, kind: true, metric: true, label: true,
          helpText: true, required: true, orderIndex: true, options: true, allowOther: true,
          min: true, max: true, targetNumeric: true,
          _count: { select: { answers: true } },
        },
      },
    },
  });

  return rows.map((t) => ({
    id: t.id,
    name: t.name,
    description: t.description,
    line: t.line,
    levelCode: t.levelCode,
    active: t.active,
    cohortCount: t._count.batches,
    questions: t.questions.map((q) => ({
      id: q.id,
      key: q.key,
      version: q.version,
      kind: q.kind,
      metric: q.metric,
      label: q.label,
      helpText: q.helpText,
      required: q.required,
      orderIndex: q.orderIndex,
      options: readTemplateOptions(q.options),
      allowOther: q.allowOther,
      min: q.min,
      max: q.max,
      targetNumeric: q.targetNumeric,
      answerCount: q._count.answers,
    })),
  }));
});

/** The same tolerant read the public form uses - a malformed row yields no options, not a crash. */
function readTemplateOptions(raw: unknown): { value: string; label: string; numeric?: number | null }[] | null {
  if (!Array.isArray(raw)) return null;
  const out: { value: string; label: string; numeric?: number | null }[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const rec = item as Record<string, unknown>;
    if (typeof rec.value !== "string" || typeof rec.label !== "string") continue;
    out.push({
      value: rec.value,
      label: rec.label,
      numeric: typeof rec.numeric === "number" ? rec.numeric : null,
    });
  }
  return out.length > 0 ? out : null;
}
