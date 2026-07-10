/**
 * Validation for everything the founder can edit.
 *
 * Read path:  coerce*(json) — a row that doesn't parse falls back to the shipped
 *             defaults rather than crashing the app. Nothing invalid can be in
 *             there anyway, because…
 * Write path: *Schema.safeParse(input) — the server action refuses to persist
 *             anything that wouldn't survive the read.
 *
 * zod lives ONLY here and in server modules. `gamification.ts` and `sections.ts`
 * stay dependency-free so client components can import them without pulling zod
 * into the browser bundle.
 */

import { z } from "zod";
import {
  DEFAULT_GAMIFICATION_CONFIG,
  EMPLOYEE_BADGE_METRICS,
  MILESTONE_ORDER,
  QUEST_FIELDS,
  STUDENT_BADGE_METRICS,
  COUNTABLE_METRICS,
  type GamificationConfig,
} from "./gamification";
import {
  APP_ROLES,
  DEFAULT_SECTIONS_CONFIG,
  SECTION_CATALOGUE,
  SECTION_GROUPS,
  SECTION_ICON_NAMES,
  type SectionsConfig,
} from "./sections";
import { GOAL_METRICS } from "./goals";
import { REWARD_WINDOWS, type RewardTrigger } from "./rewards";

const DATE_KEY = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use a YYYY-MM-DD date");
const slug = z.string().trim().min(1).max(60).regex(/^[a-zA-Z0-9._-]+$/, "Letters, numbers, dot, dash and underscore only");
const shortText = z.string().trim().min(1).max(80);
const longText = z.string().trim().min(1).max(400);
const emoji = z.string().trim().min(1).max(8);
const xp = z.number().int().min(0).max(100_000);
const count = z.number().int().min(1).max(1_000_000);

const tier = z.enum(["bronze", "silver", "gold", "legend"]);
const variant = z.enum(["ANY", "DISCOVERY_SPECIALIST", "APPOINTMENT_SETTER", "DELIVERY_COACH"]);
const milestone = z.enum(MILESTONE_ORDER);

/** `unique(rows, r => r.key)` as a zod refinement — duplicate keys silently shadow each other. */
function uniqueBy<T>(pick: (row: T) => string, label: string) {
  return (rows: T[], ctx: z.RefinementCtx) => {
    const seen = new Set<string>();
    for (const row of rows) {
      const k = pick(row);
      if (seen.has(k)) ctx.addIssue({ code: "custom", message: `Duplicate ${label}: "${k}"` });
      seen.add(k);
    }
  };
}

// ───────────────────────────── gamification ─────────────────────────────

const xpRulesSchema = z.object({
  LOG_SUBMITTED: xp,
  // JSON object keys are strings; the streak length must still be a positive integer.
  STREAK_BONUS: z.record(z.string().regex(/^[1-9]\d*$/, "Streak length must be a positive whole number"), xp),
  STAGE_MOVED: z.record(z.string().min(1), xp),
  OUTCOME_LOGGED: xp,
  OUTCOME_HQ_BONUS: xp,
  MILESTONE_ADVANCED: xp,
  MILESTONE_OFFER_BONUS: xp,
  MILESTONE_COMPLETED_BONUS: xp,
  STUDENT_RESCUED: xp,
  OKR_HIT: xp,
  OKR_NEAR: xp,
});

const levelSchema = z.object({
  level: z.number().int().min(1).max(999),
  title: shortText,
  minXp: z.number().int().min(0).max(10_000_000),
});

const levelsSchema = z
  .array(levelSchema)
  .min(1, "Keep at least one level")
  .max(50)
  .superRefine(uniqueBy((l) => String(l.level), "level number"))
  .superRefine((levels, ctx) => {
    const sorted = [...levels].sort((a, b) => a.minXp - b.minXp);
    if (sorted[0].minXp !== 0) {
      ctx.addIssue({ code: "custom", message: "The lowest level must start at 0 XP" });
    }
    // Two levels sharing a minXp makes "which level am I?" ambiguous.
    for (let i = 1; i < sorted.length; i++) {
      if (sorted[i].minXp === sorted[i - 1].minXp) {
        ctx.addIssue({ code: "custom", message: `Two levels both start at ${sorted[i].minXp} XP` });
      }
    }
    // Ranks must climb with XP, or the ladder reads backwards.
    const byXp = [...levels].sort((a, b) => a.minXp - b.minXp);
    for (let i = 1; i < byXp.length; i++) {
      if (byXp[i].level <= byXp[i - 1].level) {
        ctx.addIssue({ code: "custom", message: `Level ${byXp[i].level} needs more XP than level ${byXp[i - 1].level}` });
      }
    }
  });

const employeeBadgeSchema = z.object({
  key: slug,
  name: shortText,
  description: longText,
  icon: emoji,
  tier,
  metric: z.enum(EMPLOYEE_BADGE_METRICS),
  threshold: count,
  enabled: z.boolean(),
});

const studentBadgeSchema = z
  .object({
    key: slug,
    name: shortText,
    description: longText,
    icon: emoji,
    tier,
    metric: z.enum(STUDENT_BADGE_METRICS),
    threshold: count,
    milestone: milestone.nullable(),
    enabled: z.boolean(),
  })
  .superRefine((b, ctx) => {
    if ((b.metric === "milestoneReached" || b.metric === "milestoneWithinDays") && !b.milestone) {
      ctx.addIssue({ code: "custom", path: ["milestone"], message: `"${b.name}" must name the milestone it tracks` });
    }
  });

const questSchema = z.object({
  key: slug,
  title: shortText,
  description: longText,
  icon: emoji,
  field: z.enum(QUEST_FIELDS),
  target: count,
  xp,
  variant,
  enabled: z.boolean(),
});

const studentJourneySchema = z.object({
  milestoneXp: z.record(milestone, z.number().int().min(0).max(100_000)),
  stageTitles: z.array(shortText).length(MILESTONE_ORDER.length, `Give exactly ${MILESTONE_ORDER.length} stage titles`),
  bonusXp: z.object({
    perSession: xp,
    perApplication: xp,
    perInterview: xp,
  }),
  momentumDays: z
    .object({
      hot: z.number().int().min(1).max(365),
      steady: z.number().int().min(1).max(365),
      cooling: z.number().int().min(1).max(365),
    })
    .refine((m) => m.hot < m.steady && m.steady < m.cooling, {
      message: "Momentum bands must widen: hot < steady < cooling",
    }),
  nextSteps: z.record(
    milestone,
    z.object({ focus: shortText, steps: z.array(longText).min(1).max(8) }),
  ),
});

export const rulesetSchema = z.object({
  id: slug,
  label: shortText,
  effectiveFrom: DATE_KEY,
  xpRules: xpRulesSchema,
  levels: levelsSchema,
  employeeBadges: z.array(employeeBadgeSchema).max(80).superRefine(uniqueBy((b) => b.key, "badge key")),
  studentBadges: z.array(studentBadgeSchema).max(80).superRefine(uniqueBy((b) => b.key, "badge key")),
  quests: z.array(questSchema).max(40).superRefine(uniqueBy((q) => q.key, "quest key")),
  student: studentJourneySchema,
});

export const gamificationConfigSchema = z.object({
  rulesets: z
    .array(rulesetSchema)
    .min(1, "Keep at least one ruleset")
    .max(50)
    .superRefine(uniqueBy((r) => r.id, "ruleset id"))
    .superRefine(uniqueBy((r) => r.effectiveFrom, "effective date")),
});

export function coerceGamificationConfig(value: unknown): GamificationConfig {
  const parsed = gamificationConfigSchema.safeParse(value);
  return parsed.success ? (parsed.data as GamificationConfig) : DEFAULT_GAMIFICATION_CONFIG;
}

// ───────────────────────────── sections ─────────────────────────────

const CATALOGUE_KEYS = SECTION_CATALOGUE.map((s) => s.key) as [string, ...string[]];

const sectionSettingSchema = z.object({
  key: z.enum(CATALOGUE_KEYS),
  label: shortText,
  icon: z.enum(SECTION_ICON_NAMES),
  group: z.enum(SECTION_GROUPS),
  order: z.number().int().min(0).max(10_000),
  enabled: z.boolean(),
  roles: z.array(z.enum(APP_ROLES as [string, ...string[]])).max(APP_ROLES.length),
});

export const sectionsConfigSchema = z.object({
  entries: z.array(sectionSettingSchema).max(SECTION_CATALOGUE.length).superRefine(uniqueBy((e) => e.key, "section")),
});

export function coerceSectionsConfig(value: unknown): SectionsConfig {
  const parsed = sectionsConfigSchema.safeParse(value);
  return parsed.success ? (parsed.data as SectionsConfig) : DEFAULT_SECTIONS_CONFIG;
}

// ───────────────────────────── reward triggers ─────────────────────────────

const rewardWindow = z.enum(REWARD_WINDOWS as [string, ...string[]]);

export const rewardTriggerSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("STREAK_DAYS"), days: z.number().int().min(1).max(3650) }),
  z.object({ kind: z.literal("LEVEL_REACHED"), level: z.number().int().min(1).max(999) }),
  z.object({ kind: z.literal("BADGE_EARNED"), badgeKey: slug }),
  z.object({ kind: z.literal("QUEST_COMPLETED"), questKey: slug }),
  z.object({ kind: z.literal("XP_THRESHOLD"), xp: z.number().int().min(1).max(10_000_000), window: rewardWindow }),
  z.object({
    kind: z.literal("METRIC_THRESHOLD"),
    metric: z.enum(COUNTABLE_METRICS as unknown as [string, ...string[]]),
    target: count,
    window: rewardWindow,
  }),
  z.object({ kind: z.literal("GOAL_MET"), goalId: z.string().min(1).max(60) }),
]);

/** A trigger that no longer parses (a metric was renamed in code) disables its rule
 *  rather than throwing — the founder sees it flagged in the console instead. */
export function parseRewardTrigger(value: unknown): RewardTrigger | null {
  const parsed = rewardTriggerSchema.safeParse(value);
  return parsed.success ? (parsed.data as RewardTrigger) : null;
}

// ───────────────────────────── goals ─────────────────────────────

export const goalMetricSchema = z.enum(GOAL_METRICS as unknown as [string, ...string[]]);
export const goalScopeSchema = z.enum(["COMPANY", "USER"]);
export const goalPeriodSchema = z.enum(["MONTH", "QUARTER", "YEAR"]);
