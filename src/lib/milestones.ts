/**
 * Program milestones - pure progress + schedule rules (ER v2 Track I).
 *
 * The `Milestone` enum stays as the stable key and `MilestoneLog` stays as the append-only
 * audit trail; nothing here weakens either. What this adds is the diagram's `target_day`, so
 * "is this student on track for day 45" is answerable without replaying the log.
 *
 * Pure: no prisma, no session.
 */

import type { Milestone, MilestoneProgressStatus, ProgramDuration } from "@prisma/client";

export const MILESTONE_PROGRESS_LABELS: Record<MilestoneProgressStatus, string> = {
  NOT_STARTED: "Not started",
  IN_PROGRESS: "In progress",
  ACHIEVED: "Achieved",
};

/** The programme's length in days. LIFETIME (Solo) has no clock, so no deadline can exist. */
export function programDays(duration: ProgramDuration): number | null {
  switch (duration) {
    case "DAYS_90":
      return 90;
    case "DAYS_120":
      return 120;
    case "LIFETIME":
      return null;
  }
}

/**
 * The default milestone ladder, expressed as a FRACTION of the programme rather than fixed
 * days - so the same ladder seeds correctly for a 90-day Guided and a 120-day Elite without
 * two hand-maintained lists that will drift.
 *
 * ONBOARDING is day 1, not day 0: the founders count the enrolment day as day one, and the
 * tracker elsewhere in the app (`batchDayNumber`) already does.
 */
const LADDER: { key: Milestone; name: string; fraction: number }[] = [
  { key: "ONBOARDING", name: "Onboarding complete", fraction: 0 },
  { key: "RESUME_BUILD", name: "Resume built", fraction: 0.15 },
  { key: "LINKEDIN_OPTIMISATION", name: "LinkedIn optimised", fraction: 0.25 },
  { key: "APPLICATIONS", name: "Applications started", fraction: 0.4 },
  { key: "INTERVIEWS", name: "Interviews reached", fraction: 0.7 },
  { key: "OFFER_RECEIVED", name: "Offer received", fraction: 0.9 },
  { key: "COMPLETED", name: "Programme complete", fraction: 1 },
];

export type MilestoneSeed = { key: Milestone; name: string; targetDay: number; orderIndex: number };

/**
 * The default ladder for a programme of `days` length.
 *
 * Returns [] for a null length (Solo/LIFETIME): a milestone with no deadline is not a
 * milestone, and seeding day-0 rows for it would put every Solo student permanently "overdue"
 * on the at-risk radar - the precise false alarm that makes a radar get ignored.
 */
export function defaultMilestoneLadder(days: number | null): MilestoneSeed[] {
  if (days === null || days <= 0) return [];
  return LADDER.map((m, i) => ({
    key: m.key,
    name: m.name,
    targetDay: Math.max(1, Math.round(m.fraction * days)),
    orderIndex: i,
  }));
}

/** 1-based day of the programme that `on` falls on; null before the start. */
export function programDayNumber(enrolledAt: Date, on: Date): number | null {
  const MS_PER_DAY = 86_400_000;
  const floor = (d: Date) => Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
  const days = Math.floor((floor(on) - floor(enrolledAt)) / MS_PER_DAY);
  return days < 0 ? null : days + 1;
}

export type MilestoneHealth = "ahead" | "on_track" | "due" | "overdue" | "done";

/**
 * How a single milestone is doing.
 *
 * ACHIEVED short-circuits to "done" BEFORE the deadline is consulted: a milestone hit late is
 * still hit, and colouring it red forever would punish the student for history they cannot
 * change - and would train the coach to ignore red.
 */
export function milestoneHealth(
  status: MilestoneProgressStatus,
  targetDay: number,
  currentDay: number | null,
): MilestoneHealth {
  if (status === "ACHIEVED") return "done";
  if (currentDay === null) return "on_track"; // not started yet - nothing can be late
  if (currentDay > targetDay) return "overdue";
  if (currentDay === targetDay) return "due";
  if (status === "IN_PROGRESS") return "on_track";
  // Untouched but the deadline is still comfortably ahead.
  return currentDay < targetDay * 0.5 ? "ahead" : "on_track";
}

/**
 * Is this enrollment at risk on its milestones?
 *
 * Deliberately a COUNT of overdue milestones rather than a boolean: one slipped milestone in
 * a seven-step ladder is normal, and a radar that fires on it is noise. The caller applies
 * the threshold, so the founders can tune "at risk" without a code change.
 */
export function overdueCount(
  items: { status: MilestoneProgressStatus; targetDay: number }[],
  currentDay: number | null,
): number {
  return items.filter((i) => milestoneHealth(i.status, i.targetDay, currentDay) === "overdue").length;
}

/** Percentage of the ladder achieved, 0–100. An empty ladder is 0, never NaN. */
export function ladderCompletionPct(items: { status: MilestoneProgressStatus }[]): number {
  if (items.length === 0) return 0;
  const done = items.filter((i) => i.status === "ACHIEVED").length;
  return Math.round((done / items.length) * 100);
}
