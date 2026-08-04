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

// ───────────────────────────── booking rules ─────────────────────────────

/**
 * §9/§13 Bookings: buffer / min-notice / max-advance window, founder-configurable via
 * AppSetting (no schema field for it - same lazy-default pattern as gamification/sections
 * above). Applied when generating slots (buffer) and on the public booking page (notice +
 * advance window).
 */
/**
 * Auto-disqualify: a BANT "CANCEL" verdict at intake (weighted avg < 2) blocks the booking and
 * emails the prospect this template. Founder-editable; {{name}} / {{first_name}} tokens resolve
 * against the lead (see messaging.renderTokens).
 */
export const DEFAULT_REJECTION_SUBJECT = "Your B2 Consultants application";
export const DEFAULT_REJECTION_BODY =
  "Hi {{first_name}},\n\n" +
  "Thank you for your interest in B2 Consultants and for taking the time to share your details.\n\n" +
  "After reviewing your responses, we don't think our program is the right fit for you at this stage, " +
  "so we won't be scheduling a call at this time.\n\n" +
  "Your goals and circumstances may change over time — you're very welcome to reach out again in the " +
  "future. We wish you all the best on your journey.\n\n" +
  "Warm regards,\nThe B2 Consultants Team";

export const bookingRulesConfigSchema = z
  .object({
    bufferMinutes: z.number().int().min(0).max(240),
    minNoticeHours: z.number().int().min(0).max(240),
    maxAdvanceDays: z.number().int().min(1).max(365),
    // Optional-with-default: an existing stored row (only the three window fields) still parses,
    // and the new keys fall back to these defaults rather than resetting the whole config.
    autoDisqualify: z.boolean().default(true),
    rejectionSubject: z.string().trim().min(1).max(200).default(DEFAULT_REJECTION_SUBJECT),
    rejectionBody: z.string().trim().min(1).max(4000).default(DEFAULT_REJECTION_BODY),
    // ── Confirmation loop (Module E) — confirm-or-cancel + promote-next.
    // autoCancelEnabled is the destructive master switch (default OFF): only when it is on does the
    // engine release an unconfirmed slot. The two window fields drive the cadence; promoteNext
    // governs whether the next same-caller/same-day call is moved up into a freed slot.
    autoCancelEnabled: z.boolean().default(false),
    // Send the "please reply YES" request once the slot is within this many hours (0 disables asking).
    confirmRequestLeadHours: z.number().int().min(0).max(240).default(24),
    // Release the slot if it is still unconfirmed within this many hours of the call. Kept < the
    // request lead so there is always a window between "asked" and "cancelled".
    autoCancelHours: z.number().int().min(0).max(240).default(3),
    // On any cancel (auto or manual), move the next booked call for the same caller on the same day
    // up into the freed slot and notify them. Independent of autoCancelEnabled.
    promoteNext: z.boolean().default(true),
  })
  .refine((c) => c.confirmRequestLeadHours === 0 || c.confirmRequestLeadHours > c.autoCancelHours, {
    message: "Ask-to-confirm lead time must be greater than the auto-cancel window",
    path: ["confirmRequestLeadHours"],
  });

export type BookingRulesConfig = z.infer<typeof bookingRulesConfigSchema>;

export const DEFAULT_BOOKING_RULES_CONFIG: BookingRulesConfig = {
  bufferMinutes: 15,
  minNoticeHours: 2,
  maxAdvanceDays: 30,
  autoDisqualify: true,
  rejectionSubject: DEFAULT_REJECTION_SUBJECT,
  rejectionBody: DEFAULT_REJECTION_BODY,
  autoCancelEnabled: false,
  confirmRequestLeadHours: 24,
  autoCancelHours: 3,
  promoteNext: true,
};

export function coerceBookingRulesConfig(value: unknown): BookingRulesConfig {
  const parsed = bookingRulesConfigSchema.safeParse(value);
  return parsed.success ? parsed.data : DEFAULT_BOOKING_RULES_CONFIG;
}

// ──────────────────── rolling booking-slot pattern ────────────────────

/**
 * The founder's standing weekly availability, replayed forward by the daily cron so the public
 * /book calendar never runs dry.
 *
 * WHY THIS EXISTS: slots were only ever created by a one-off "generate for this range" form. On
 * 23 Jul 2026 the last slot was 15 Jul — the booking page, the top of the entire funnel, had
 * been showing an empty calendar for 8 days and nothing anywhere said so. A one-off batch cannot
 * fail safe; a pattern the cron replays can.
 *
 * `enabled` ships FALSE like every other engine here: turning it on is the founder's decision,
 * and an un-configured pattern must never start writing rows into a live calendar. But unlike
 * the other engines this one is INERT rather than destructive — it only ever creates OPEN slots
 * on instants that have none, and never touches a BOOKED or BLOCKED row.
 */
export const slotPatternConfigSchema = z.object({
  enabled: z.boolean().default(false),
  weekdays: z.array(z.enum(["MON", "TUE", "WED", "THU", "FRI", "SAT", "SUN"])).default([]),
  startTime: z.string().regex(/^\d{2}:\d{2}$/).default("15:00"),
  endTime: z.string().regex(/^\d{2}:\d{2}$/).default("18:00"),
  intervalMins: z.number().int().min(15).max(240).default(30),
  durationMins: z.number().int().refine((v) => v === 30 || v === 60).default(30),
  /**
   * How many days ahead to keep stocked. Capped at `maxAdvanceDays` by the job itself —
   * generating past the window the public page will show is pure waste.
   */
  horizonDays: z.number().int().min(1).max(120).default(21),
  /** Blank = unassigned, exactly as in the manual generator. */
  assignedToId: z.string().trim().max(64).default(""),
});

export type SlotPatternConfig = z.infer<typeof slotPatternConfigSchema>;

export const DEFAULT_SLOT_PATTERN_CONFIG: SlotPatternConfig = {
  enabled: false,
  weekdays: [],
  startTime: "15:00",
  endTime: "18:00",
  intervalMins: 30,
  durationMins: 30,
  horizonDays: 21,
  assignedToId: "",
};

export function coerceSlotPatternConfig(value: unknown): SlotPatternConfig {
  const parsed = slotPatternConfigSchema.safeParse(value);
  return parsed.success ? parsed.data : DEFAULT_SLOT_PATTERN_CONFIG;
}

// ──────────────────── global workflow settings (Automation) ────────────────────

/**
 * Synamate's "Global Workflow Settings", stored in AppSetting with the same lazy-default
 * pattern as the configs above: no row = the defaults below, which reproduce the engine's
 * behaviour exactly as it was before this document existed.
 *
 * Every field here is READ BY THE ENGINE (src/server/automation.ts) — see the call sites
 * named in each comment. Nothing in this document is decorative.
 */
export const workflowSettingsSchema = z.object({
  /** Master kill switch. false = no new enrollments and no resumes. `emitTrigger` + `runDueWorkflows`. */
  engineEnabled: z.boolean(),
  /**
   * false = a contact who has *ever* been enrolled in a workflow will not enroll in it again.
   * true (default) keeps the original rule: only a currently-ACTIVE enrollment blocks re-entry.
   * `emitTrigger`.
   */
  allowReEnrollment: z.boolean(),
  /**
   * Don't deliver SEND_EMAIL / SEND_SMS inside this IST window — the enrollment parks and
   * resumes when the window closes. Hours are IST (the app's business timezone, fixed +5:30).
   * A window may wrap midnight (start 21, end 9). start === end means "no quiet window".
   * `advanceEnrollment`.
   */
  quietHours: z.object({
    enabled: z.boolean(),
    startHour: z.number().int().min(0).max(23),
    endHour: z.number().int().min(0).max(23),
  }),
  /** Max enrollments resumed per cron tick / "Run due now". `runDueWorkflows`. */
  batchSize: z.number().int().min(1).max(1000),
});

export type WorkflowSettings = z.infer<typeof workflowSettingsSchema>;

export const DEFAULT_WORKFLOW_SETTINGS: WorkflowSettings = {
  engineEnabled: true,
  allowReEnrollment: true,
  quietHours: { enabled: false, startHour: 21, endHour: 9 },
  batchSize: 200,
};

export function coerceWorkflowSettings(value: unknown): WorkflowSettings {
  const parsed = workflowSettingsSchema.safeParse(value);
  return parsed.success ? parsed.data : DEFAULT_WORKFLOW_SETTINGS;
}

// ───────────────────────────── commission rates ─────────────────────────────

/**
 * The deal-team commission rates (Finance → Commission), founder-editable via AppSetting
 * with the same lazy-default pattern as the configs above. Read by
 * `server/commission-metrics.ts` on every report; a missing/invalid row falls back to the
 * shipped defaults (the rates that were hardcoded before this was configurable).
 *
 *   - bothCallsPct — one person did BOTH the first call and the discovery call.
 *   - splitPct     — first call and discovery split between two people (each earns this),
 *                    and also the rate for a lone first-call or lone discovery leg.
 *   - closerPct    — the L3 closer who ran the SSS/sales call, on top of any earlier leg.
 *
 * Decimals are allowed (e.g. 2.5%). All three are a percentage of the payment actually
 * received — the split is a cut of real cash in, calculated per payment.
 */
export const commissionRulesConfigSchema = z.object({
  bothCallsPct: z.number().min(0).max(100),
  splitPct: z.number().min(0).max(100),
  closerPct: z.number().min(0).max(100),
  /**
   * The stand-in's share of a covered leg (spec Part 2 §7.1: "the substitute keeps 20%, the
   * original owner keeps 80% of that portion — configurable"). Applies ONLY to a leg whose
   * DiscoveryOutcome names a `coveredForId`; the owner takes the remainder (100 − this).
   *
   * It splits the leg, it does not add to it: a covered discovery still costs the business
   * splitPct of the payment, just divided between two people.
   */
  substitutePct: z.number().min(0).max(100).default(20),
});

export type CommissionRulesConfig = z.infer<typeof commissionRulesConfigSchema>;

export const DEFAULT_COMMISSION_RULES_CONFIG: CommissionRulesConfig = {
  bothCallsPct: 5,
  splitPct: 3,
  closerPct: 4,
  substitutePct: 20,
};

export function coerceCommissionRulesConfig(value: unknown): CommissionRulesConfig {
  const parsed = commissionRulesConfigSchema.safeParse(value);
  return parsed.success ? parsed.data : DEFAULT_COMMISSION_RULES_CONFIG;
}

// ───────────────────────────── tutor fee ─────────────────────────────

/**
 * What we owe a tutor for running a batch (spec Part 2 §5), founder-editable via
 * AppSetting("tutorFee"). The rate is driven by BATCH SIZE, not by level:
 *
 *     rate = (students >= thresholdStudents) ? atOrAbove : below
 *
 * and it is charged PER HEAD per level, so a 5-student A1 batch costs 5 × ₹7,000. A thin
 * batch pays the tutor more per head — the founder's stated volume tradeoff, not a typo.
 *
 * Rates are per-level because Part 2 §5 says they are "configurable and can differ per
 * level"; they default flat to the only two numbers the founder actually stated (§18.2
 * left the full per-level table open, so inventing one here would be fiction).
 *
 * Rates are WHOLE RUPEES — this is what the founder types into the console. Callers in
 * lib/tutor-fee.ts convert to paise; nothing else should do that arithmetic itself.
 *
 * NOT the same thing as GN_LEVEL_COST.tutor in lib/gn-workshop-pricing.ts. That is a
 * per-conversion COGS figure reconciled against the founders' PDF workbook and answers
 * "what did this sale cost to deliver". This answers "what do we pay the tutor to run this
 * batch". They are kept apart until §18.2 is settled — merging them would silently restate
 * historical workshop P&L.
 */
export const TUTOR_FEE_LEVELS = ["A1", "A2", "B1"] as const;
export type TutorFeeLevel = (typeof TUTOR_FEE_LEVELS)[number];

const tutorFeeBandSchema = z.object({
  atOrAbove: z.number().int().min(0).max(10_000_000),
  below: z.number().int().min(0).max(10_000_000),
});

export const tutorFeeConfigSchema = z.object({
  thresholdStudents: z.number().int().min(1).max(100),
  ratesByLevel: z.object({
    A1: tutorFeeBandSchema,
    A2: tutorFeeBandSchema,
    B1: tutorFeeBandSchema,
  }),
});

export type TutorFeeConfig = z.infer<typeof tutorFeeConfigSchema>;

export const DEFAULT_TUTOR_FEE_CONFIG: TutorFeeConfig = {
  thresholdStudents: 5,
  ratesByLevel: {
    A1: { atOrAbove: 7000, below: 8000 },
    A2: { atOrAbove: 7000, below: 8000 },
    B1: { atOrAbove: 7000, below: 8000 },
  },
};

export function coerceTutorFeeConfig(value: unknown): TutorFeeConfig {
  const parsed = tutorFeeConfigSchema.safeParse(value);
  return parsed.success ? parsed.data : DEFAULT_TUTOR_FEE_CONFIG;
}

// ─────────────────────────── instalment plans ───────────────────────────

/**
 * What paying in instalments COSTS, and how far apart the instalments fall — founder-editable
 * via AppSetting("instalmentPlans"), read by the EMI generator on the Finance → Pending tab.
 *
 * One row per plan length: "3 instalments → ₹600" means a 3-part plan adds ₹600 ONCE to the
 * agreed fee (not ₹600 per instalment). A length with no row, or a row at 0, adds nothing —
 * which is the default for every length except the one the founder named, because a surcharge
 * that appears without being typed is the one mistake this table must not make.
 *
 * Amounts are minor units (paise / cents) like every other money field in the app, and both
 * currencies are configurable: a €-billed student's plan can't inherit a rupee surcharge.
 */
export const INSTALMENT_COUNT_MIN = 2; // 1 instalment is a full payment
export const INSTALMENT_COUNT_MAX = 24;

const instalmentTierSchema = z.object({
  count: z.number().int().min(INSTALMENT_COUNT_MIN).max(INSTALMENT_COUNT_MAX),
  extraInrMinor: z.number().int().min(0).max(100_000_000), // ≤ ₹10,00,000
  extraEurMinor: z.number().int().min(0).max(100_000_000), // ≤ €10,00,000
});

export type InstalmentTier = z.infer<typeof instalmentTierSchema>;

export const instalmentPlanConfigSchema = z.object({
  /** Days between instalments when a plan is generated. Overridable per plan. */
  defaultIntervalDays: z.number().int().min(1).max(180),
  tiers: z
    .array(instalmentTierSchema)
    .max(INSTALMENT_COUNT_MAX - INSTALMENT_COUNT_MIN + 1)
    // Two rows for the same length would make the surcharge depend on array order —
    // silently, and differently for whoever read it last.
    .superRefine((tiers, ctx) => {
      const seen = new Set<number>();
      for (const t of tiers) {
        if (seen.has(t.count)) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: `There are two rows for ${t.count} instalments — keep one`,
          });
          return;
        }
        seen.add(t.count);
      }
    }),
});

export type InstalmentPlanConfig = z.infer<typeof instalmentPlanConfigSchema>;

export const DEFAULT_INSTALMENT_PLAN_CONFIG: InstalmentPlanConfig = {
  defaultIntervalDays: 30,
  tiers: [
    { count: 2, extraInrMinor: 0, extraEurMinor: 0 },
    // The one figure the founder stated: a 3-part plan costs ₹600 extra.
    { count: 3, extraInrMinor: 60_000, extraEurMinor: 0 },
    { count: 4, extraInrMinor: 0, extraEurMinor: 0 },
    { count: 6, extraInrMinor: 0, extraEurMinor: 0 },
  ],
};

export function coerceInstalmentPlanConfig(value: unknown): InstalmentPlanConfig {
  const parsed = instalmentPlanConfigSchema.safeParse(value);
  return parsed.success ? parsed.data : DEFAULT_INSTALMENT_PLAN_CONFIG;
}

// ───────────────────────────── book orders ─────────────────────────────

/**
 * When to place a book order with the publisher (spec §9.2, Part 2 §4.4), founder-editable
 * via AppSetting("bookOrders").
 *
 *   pay ≥ orderThreshold up front  → order now
 *   anything less (i.e. on EMI)    → defer until they've paid enough
 *
 * The threshold is config rather than a constant because ₹30,000 was an EXAMPLE the founders
 * gave on the call, and Part 2 §18.3 lists the precise figure as still open. Encoding the
 * example as law would quietly make an unconfirmed number authoritative.
 *
 * `orderThresholdInrMinor` is paise, like every other amount.
 */
export const bookOrderConfigSchema = z.object({
  orderThresholdInrMinor: z.number().int().min(0),
  /** Order A1's books first and re-quote before each later level (§19.3). */
  requireFreshQuotePerLevel: z.boolean().default(true),
});

export type BookOrderConfig = z.infer<typeof bookOrderConfigSchema>;

export const DEFAULT_BOOK_ORDER_CONFIG: BookOrderConfig = {
  orderThresholdInrMinor: 3_000_000, // ₹30,000 — the spec's example, pending §18.3
  requireFreshQuotePerLevel: true,
};

export function coerceBookOrderConfig(value: unknown): BookOrderConfig {
  const parsed = bookOrderConfigSchema.safeParse(value);
  return parsed.success ? parsed.data : DEFAULT_BOOK_ORDER_CONFIG;
}

// ───────────────────────────── pipeline mode ─────────────────────────────

/**
 * Rules-driven vs drag-and-drop pipeline (spec Part 2 §9, §18.6 — the founders were offered
 * both and hadn't picked). Config, not a schema change: the same Pipeline data renders either
 * way, so this only decides who moves a card — a rule, or a hand.
 */
export const pipelineConfigSchema = z.object({
  mode: z.enum(["rules", "drag_drop"]),
  /**
   * File every newly captured lead onto the default Opportunity board.
   *
   * Defaults ON, which is a deliberate exception to this file's usual off-by-default rule. The
   * previous behaviour was not a considered "off" — nothing created an opportunity from an
   * inbound lead at all, which is why production ran with 23,545 leads and one card. Shipping
   * this switched off would preserve a bug behind a toggle.
   *
   * It is a switch rather than unconditional because the board renders every card at once and is
   * capped at 300 per column; a business with a very high lead volume and a small sales team may
   * genuinely want the board to hold only hand-picked deals.
   */
  autoCreateOpportunity: z.boolean().default(true),
});

export type PipelineConfig = z.infer<typeof pipelineConfigSchema>;

/** Rules is the shipped behaviour, so it stays the default — the mode toggle is opt-in. */
export const DEFAULT_PIPELINE_CONFIG: PipelineConfig = { mode: "rules", autoCreateOpportunity: true };

export function coercePipelineConfig(value: unknown): PipelineConfig {
  const parsed = pipelineConfigSchema.safeParse(value);
  return parsed.success ? parsed.data : DEFAULT_PIPELINE_CONFIG;
}

// ───────────────────────────── saved countersignature ─────────────────────────────

/**
 * The founder's stored countersignature, so issuing an agreement is one tap instead of redrawing
 * the same squiggle every time. Kept per-user in AppSetting("agreement.signature.<userId>").
 *
 * WHAT IS AND ISN'T REUSED: only the ink. The device our server OBSERVES (IP + User-Agent) is
 * captured fresh on every issue, and the ISSUED event records `signature: "saved"` plus this
 * `savedAt` — so the audit trail states plainly that stored ink was stamped at issue time rather
 * than implying a live draw. `savedDevice` records the session the signature was originally
 * captured in, which is the other half of that sentence.
 *
 * The cap mirrors MAX_SIGNATURE_BYTES (400 KB) in agreement-core.ts, inflated by base64's ~4/3.
 */
export const savedSignatureSchema = z.object({
  dataUrl: z
    .string()
    .max(600_000)
    .refine((v) => v.startsWith("data:image/png;base64,"), "Signature must be a PNG data URL"),
  savedAt: z.string().min(1),
  /** StoredDevice from the capture session; re-parsed by readStoredDevice on read. */
  savedDevice: z.unknown().nullable().optional(),
});

export type SavedSignature = z.infer<typeof savedSignatureSchema>;

export function coerceSavedSignature(value: unknown): SavedSignature | null {
  const parsed = savedSignatureSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}

// ───────────────────────────── agreement workflow ─────────────────────────────

/**
 * When the Agreement module should start PROMPTING "Ready to send" for a client. Founder-editable
 * via AppSetting("agreementWorkflow"), same lazy-default pattern as the configs above. Read by the
 * agreement-state derivation (`lib/agreement-state.ts` via `server/agreement-state.ts`).
 *
 * This is a nudge threshold, NOT a gate: the founder can always draft an agreement for anyone from
 * the picker regardless of this setting. It only decides which clients get the "Agreement pending"
 * card / dashboard task before a draft exists.
 *
 *   - DEPOSIT — prompt once the deposit is paid (stage DEPOSIT_PAID) or the deal is won.
 *   - WON     — prompt only when the deal is fully won.
 *   - EITHER  — prompt at deposit, won, OR "agreed but no deposit yet" (confirmed intention). Default.
 */
export const agreementWorkflowSchema = z.object({
  readiness: z.enum(["DEPOSIT", "WON", "EITHER"]),
});

export type AgreementWorkflowConfig = z.infer<typeof agreementWorkflowSchema>;

export const DEFAULT_AGREEMENT_WORKFLOW: AgreementWorkflowConfig = {
  readiness: "EITHER",
};

export function coerceAgreementWorkflow(value: unknown): AgreementWorkflowConfig {
  const parsed = agreementWorkflowSchema.safeParse(value);
  return parsed.success ? parsed.data : DEFAULT_AGREEMENT_WORKFLOW;
}

// ───────────────────────────── daily-log targets ─────────────────────────────

/**
 * Founder-set daily targets for each log variant's HEADLINE metric (calls / appointments /
 * sessions). Read by the Daily Log timeline to colour each entry's status badge:
 * hit the target → "On target", well over → "Standout", well under → "Below par".
 *
 * A target of 0 means "no target set" — the timeline then falls back to the person's own
 * rolling average, so the feature works out of the box and only gets sharper once set.
 */
const dailyTarget = z.number().int().min(0).max(999);

export const dailyLogTargetsSchema = z.object({
  DISCOVERY_SPECIALIST: dailyTarget, // discovery calls / day
  APPOINTMENT_SETTER: dailyTarget, // appointments set / day
  DELIVERY_COACH: dailyTarget, // sessions delivered / day
});

export type DailyLogTargets = z.infer<typeof dailyLogTargetsSchema>;

export const DEFAULT_DAILY_LOG_TARGETS: DailyLogTargets = {
  DISCOVERY_SPECIALIST: 5,
  APPOINTMENT_SETTER: 3,
  DELIVERY_COACH: 4,
};

export function coerceDailyLogTargets(value: unknown): DailyLogTargets {
  const parsed = dailyLogTargetsSchema.safeParse(value);
  return parsed.success ? parsed.data : DEFAULT_DAILY_LOG_TARGETS;
}

// ───────────────────────── daily-log EOD (end of day) ─────────────────────────

/**
 * "Every telecaller's log is saved by EOD." Founder-editable via AppSetting("dailyLogEod").
 * Read by the submit action, the EOD job (`server/daily-log-eod.ts`) and the notification centre.
 *
 * Times are MINUTES since IST midnight (0..1439), matching `istMinutesOfDay` in lib/dates.ts —
 * an hour-only field couldn't express 9:30pm, and IST is a fixed +05:30 with no DST, so the
 * arithmetic is exact.
 *
 * The day already hard-locked at IST midnight before this existed (submitDailyLog stamps
 * `istToday()`, so a missed day can never be logged late). What this adds is making the deadline
 * EXPLICIT and making the rule actually happen:
 *
 *   nudgeMinutes  — from here, an unlogged member sees a "log before cutoff" notification.
 *   cutoffMinutes — the deadline. After it, no NEW log for today (see submitDailyLog).
 *   autoSave      — at cutoff, write what activity we can derive for anyone who didn't log,
 *                   stamped EOD_AUTO, so no day is ever blank. Needs the cron to tick.
 *   amendWindowDays — how long an EOD_AUTO row stays amendable by its owner. This is the
 *                   counterweight to autoSave: auto-capture cannot see every field, so an
 *                   unamended EOD_AUTO row reads LOW on the Telecaller Pay board. 1 = the
 *                   member can still fix it the next morning. 0 = auto rows are final.
 *   founderSummary — after cutoff, Admin's notification centre reports who logged and who didn't.
 *
 * `enabled` gates ALL of the above and ships FALSE, like every other engine in this app: it
 * both writes rows and refuses submissions, so it should never switch itself on at install.
 */
const istMinuteOfDay = z.number().int().min(0).max(1439);

export const dailyLogEodSchema = z
  .object({
    enabled: z.boolean(),
    nudgeMinutes: istMinuteOfDay,
    cutoffMinutes: istMinuteOfDay,
    autoSave: z.boolean(),
    amendWindowDays: z.number().int().min(0).max(7),
    founderSummary: z.boolean(),
  })
  // A nudge at or after the cutoff could never fire — the window it belongs to is already shut.
  .refine((c) => c.nudgeMinutes < c.cutoffMinutes, {
    message: "The nudge time must be before the cutoff",
    path: ["nudgeMinutes"],
  });

export type DailyLogEodConfig = z.infer<typeof dailyLogEodSchema>;

export const DEFAULT_DAILY_LOG_EOD: DailyLogEodConfig = {
  enabled: false,
  nudgeMinutes: 18 * 60, // 6:00 PM IST
  cutoffMinutes: 21 * 60, // 9:00 PM IST
  autoSave: true,
  amendWindowDays: 1,
  founderSummary: true,
};

export function coerceDailyLogEod(value: unknown): DailyLogEodConfig {
  const parsed = dailyLogEodSchema.safeParse(value);
  return parsed.success ? parsed.data : DEFAULT_DAILY_LOG_EOD;
}

/** "9:00 PM" for an IST minute-of-day — used by the config UI and the deadline copy. */
export function formatIstMinutes(minutes: number): string {
  const h24 = Math.floor(minutes / 60);
  const m = minutes % 60;
  const suffix = h24 < 12 ? "AM" : "PM";
  const h12 = h24 % 12 === 0 ? 12 : h24 % 12;
  return `${h12}:${String(m).padStart(2, "0")} ${suffix}`;
}

/** "21:00" — the <input type="time"> encoding for an IST minute-of-day. */
export function istMinutesToTimeInput(minutes: number): string {
  return `${String(Math.floor(minutes / 60)).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`;
}

/** Parse an <input type="time"> value back to an IST minute-of-day; null if unparseable. */
export function timeInputToIstMinutes(value: string): number | null {
  const m = /^(\d{1,2}):(\d{2})$/.exec(value.trim());
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (h > 23 || min > 59) return null;
  return h * 60 + min;
}

// ───────────────────────────── SSS (sales) call ─────────────────────────────

/**
 * Success Strategy Session config — the founder-run sales/closing call. Founder-editable via
 * AppSetting("sssConfig"), same lazy-default pattern as the configs above. Read by the SSS slot
 * engine (`server/sss-slots.ts`).
 *
 *   - ownerId              — the User who runs the SSS by default (e.g. Ameen). New slots default
 *                            to this owner; null = unset (the founder must pick one before slots
 *                            can be generated). Set on the Founder Console → SSS Calendar.
 *   - slotDurationMins     — default length of a generated SSS slot.
 *   - rescheduleWithinDays — when a booked slot/day is blocked, how far ahead to search for the
 *                            next OPEN slot to auto-move the prospect into. Past this window they're
 *                            flagged for manual rebooking rather than moved.
 */
export const sssConfigSchema = z.object({
  ownerId: z.string().min(1).nullable(),
  slotDurationMins: z.number().int().min(5).max(240),
  rescheduleWithinDays: z.number().int().min(1).max(90),
});

export type SssConfig = z.infer<typeof sssConfigSchema>;

export const DEFAULT_SSS_CONFIG: SssConfig = {
  ownerId: null,
  slotDurationMins: 45,
  rescheduleWithinDays: 7,
};

export function coerceSssConfig(value: unknown): SssConfig {
  const parsed = sssConfigSchema.safeParse(value);
  return parsed.success ? parsed.data : DEFAULT_SSS_CONFIG;
}

// ───────────────────────────── goals ─────────────────────────────

export const goalMetricSchema = z.enum(GOAL_METRICS as unknown as [string, ...string[]]);
export const goalScopeSchema = z.enum(["COMPANY", "USER"]);
export const goalPeriodSchema = z.enum(["MONTH", "QUARTER", "YEAR"]);

// ───────────────────────── daily maintenance (housekeeping cron) ─────────────────────────

/**
 * The once-a-day housekeeping the app never had a clock to run (audit §C #18/#19/#21).
 * Founder-editable via AppSetting("maintenanceConfig"), same lazy-default pattern as every
 * config above. Read by `server/daily-maintenance.ts`, ticked by /api/cron/daily.
 *
 *   fxPrewarm     — warm the day's INR/EUR rate before a user request pays the fetch latency
 *                   (lib/fx.getTodayInrPerEur). Purely a cache-warm; ships ON because it can
 *                   never do anything but avoid a stall.
 *   overdueSweep  — flip SENT invoices and DUE instalments to OVERDUE once their due date has
 *                   passed. Non-destructive status correctness; ships ON. PARTIAL invoices are
 *                   left alone on purpose — the status column can't hold "partly-paid AND late".
 *   retention     — hard-delete aged growth rows older than the window. This DELETES data, so it
 *                   ships OFF and every window defaults generously. 0 days on any line means
 *                   "keep forever" (that line is skipped). Append-only audit tables (daily logs,
 *                   stage/milestone/signal history, the hash-chained audit trail) are NEVER
 *                   touched — only WhatsApp message rows and expired, unaccepted user invites.
 */
const retentionDays = z.number().int().min(0).max(3650);

export const maintenanceConfigSchema = z.object({
  fxPrewarm: z.object({ enabled: z.boolean() }),
  overdueSweep: z.object({ enabled: z.boolean() }),
  retention: z.object({
    enabled: z.boolean(),
    whatsAppMessageDays: retentionDays,
    expiredInviteDays: retentionDays,
  }),
});

export type MaintenanceConfig = z.infer<typeof maintenanceConfigSchema>;

export const DEFAULT_MAINTENANCE_CONFIG: MaintenanceConfig = {
  fxPrewarm: { enabled: true },
  overdueSweep: { enabled: true },
  retention: { enabled: false, whatsAppMessageDays: 365, expiredInviteDays: 30 },
};

export function coerceMaintenanceConfig(value: unknown): MaintenanceConfig {
  const parsed = maintenanceConfigSchema.safeParse(value);
  return parsed.success ? parsed.data : DEFAULT_MAINTENANCE_CONFIG;
}

// ───────────────────────── scheduled report email ─────────────────────────

/**
 * "Email me the numbers" — a founder digest delivered on a cadence over the existing Resend
 * seam (lib/email.ts). Founder-editable via AppSetting("scheduledReport"). Read + sent by
 * `server/scheduled-report.ts` from the daily cron, guarded so it fires exactly once per period.
 *
 * Ships OFF (it sends real email). recipients are validated as addresses; an empty list is a
 * no-op even when enabled, so turning it on without a recipient can't blast anyone. sendAtMinutes
 * is an IST minute-of-day: the digest goes out on the first cron tick at/after that time on the
 * due day. weekday is 1..7 (Mon..Sun, ISO) for WEEKLY; monthday is 1..28 for MONTHLY.
 */
const emailAddress = z
  .string()
  .trim()
  .regex(/^[^@\s]+@[^@\s]+\.[^@\s]+$/, "Enter a valid email address");

export const scheduledReportConfigSchema = z.object({
  enabled: z.boolean(),
  cadence: z.enum(["WEEKLY", "MONTHLY"]),
  recipients: z.array(emailAddress).max(10),
  weekday: z.number().int().min(1).max(7),
  monthday: z.number().int().min(1).max(28),
  sendAtMinutes: istMinuteOfDay,
  /**
   * WhatsApp numbers to also send the digest to (E.164-ish, country code required).
   *
   * WHY THIS IS A SEPARATE LIST AND NOT A "channel" SWITCH: the founders read WhatsApp and not
   * email, so this is the delivery that actually gets read — but it comes with a real constraint.
   * Meta only permits a business-initiated WhatsApp message via a PRE-APPROVED TEMPLATE, and no
   * template exists for a six-number digest (drafting and submitting one is its own piece of
   * work). So this send goes out as a free-form SESSION message, which only lands if the
   * recipient has messaged the business in the last 24 hours.
   *
   * That makes it genuinely useful for a founder who chats with the business number regularly,
   * and useless otherwise — which is why email is never turned off in exchange for it. Both go.
   */
  whatsappRecipients: z.array(z.string().trim().min(8).max(20)).max(5),
});

export type ScheduledReportConfig = z.infer<typeof scheduledReportConfigSchema>;

export const DEFAULT_SCHEDULED_REPORT_CONFIG: ScheduledReportConfig = {
  enabled: false,
  cadence: "WEEKLY",
  recipients: [],
  weekday: 1, // Monday
  monthday: 1,
  sendAtMinutes: 9 * 60, // 9:00 AM IST
  whatsappRecipients: [],
};

export function coerceScheduledReportConfig(value: unknown): ScheduledReportConfig {
  const parsed = scheduledReportConfigSchema.safeParse(value);
  return parsed.success ? parsed.data : DEFAULT_SCHEDULED_REPORT_CONFIG;
}

// ───────────────────────── finance posting (ledger) ─────────────────────────

/**
 * Two accounting-correctness switches, both OFF by default because they post to the real
 * double-entry ledger (audit §C #22/#23). Founder-editable via AppSetting("financePosting").
 *
 *   invoiceIssuancePosting — post Dr Accounts-receivable / Cr Income when an invoice is issued,
 *     so AR is two-sided instead of only ever being credited by payments (finance-posting.ts's
 *     documented gap). Read by `server/invoice-posting.ts`.
 *   commissionAccrual — when a commission payout run is recorded, also post Dr Team-salaries /
 *     Cr Accounts-payable for the month's total (an accrual, NOT a cash payment — so it never
 *     asserts money left the bank). Read by `server/commission-actions.ts`. With this OFF the
 *     payout run is still recorded as a snapshot; only the ledger posting is withheld.
 *   tutorFeeAccrual — when a tutor fee is APPROVED, post Dr COGS-Tutor-fees / Cr
 *     Accounts-payable (ER v2 Track C). Also an accrual: the CASH leg is the Expense row the
 *     founder records when they actually pay the trainer, which hits a different account —
 *     that separation is what stops the fee being counted twice. Read by
 *     `server/tutor-fee-actions.ts`. With this OFF the fee report is still complete and
 *     correct; only the ledger posting is withheld.
 */
export const financePostingConfigSchema = z.object({
  invoiceIssuancePosting: z.object({ enabled: z.boolean() }),
  commissionAccrual: z.object({ enabled: z.boolean() }),
  tutorFeeAccrual: z.object({ enabled: z.boolean() }).default({ enabled: false }),
});

export type FinancePostingConfig = z.infer<typeof financePostingConfigSchema>;

export const DEFAULT_FINANCE_POSTING_CONFIG: FinancePostingConfig = {
  invoiceIssuancePosting: { enabled: false },
  commissionAccrual: { enabled: false },
  tutorFeeAccrual: { enabled: false },
};

export function coerceFinancePostingConfig(value: unknown): FinancePostingConfig {
  const parsed = financePostingConfigSchema.safeParse(value);
  return parsed.success ? parsed.data : DEFAULT_FINANCE_POSTING_CONFIG;
}

// ───────────────────────────── call distribution ─────────────────────────────

/**
 * How work is shared out, and which lead is worked first — the founder's two dials.
 *
 * WHAT LIVES HERE vs ON THE PERSON. Each individual's SHARE stays on `TeamProfile`
 * (`firstCallSharePct`), because it belongs to them and follows them through the org chart. What
 * lives here is everything that was previously hardcoded in `server/assignment.ts` and
 * `server/pipeline-metrics.ts`: the fairness window, the daily ceiling, whether the bulk hand-out
 * honours the shares at all, and the ranking weights.
 *
 * The distinction matters when someone leaves: their share vanishes with their profile, but the
 * rules the team runs under do not.
 */
export const callDistributionSchema = z.object({
  /**
   * Rolling window the fairness maths looks back over when deciding who is furthest behind.
   *
   * Short windows react fast and swing hard after one person's day off; long ones are stable but
   * take weeks to correct a drift. 30 days is what the engine used before this was configurable.
   */
  lookbackDays: z.number().int().min(1).max(365),
  /**
   * Most leads one person may be AUTO-assigned in an IST day. 0 = no ceiling.
   *
   * Distinct from `TeamProfile.dailyCallTarget`, which is an expectation shown on their desk.
   * This is a hard stop on intake: past it, the rotation skips them and the lead goes to the next
   * eligible person rather than piling onto a queue that cannot be worked.
   */
  dailyCapPerPerson: z.number().int().min(0).max(500),
  /**
   * Whether "Hand out leads" splits the batch across the rotation by share.
   *
   * Off = the historical behaviour: everything goes to one named person. That is where the volume
   * actually is — the backlog dwarfs live intake — so leaving this off means the configured
   * weighting governs only a trickle.
   */
  handOutSplitsByShare: z.boolean(),
  /** Ranking weights. Shape mirrors `PriorityWeights` in lib/lead-priority.ts. */
  priority: z.object({
    bantPerPoint: z.number().min(0).max(50),
    highlyQualifiedBonus: z.number().min(0).max(100),
    freshWithinDays: z.number().int().min(0).max(90),
    freshBonus: z.number().min(0).max(100),
    idleAfterDays: z.number().int().min(0).max(365),
    idlePenaltyPerDay: z.number().min(0).max(20),
    idlePenaltyMax: z.number().min(0).max(200),
  }),
});

export type CallDistributionConfig = z.infer<typeof callDistributionSchema>;

/**
 * Shipped defaults = today's behaviour exactly.
 *
 * `lookbackDays: 30` is `assignment.ts`'s old `LOOKBACK_DAYS`; the priority block equals the old
 * hardcoded pipeline formula; the hand-out split is OFF so nothing about the existing button
 * changes until the founder asks for it.
 */
export const DEFAULT_CALL_DISTRIBUTION: CallDistributionConfig = {
  lookbackDays: 30,
  dailyCapPerPerson: 0,
  handOutSplitsByShare: false,
  priority: {
    bantPerPoint: 10,
    highlyQualifiedBonus: 15,
    freshWithinDays: 7,
    freshBonus: 10,
    idleAfterDays: 7,
    idlePenaltyPerDay: 1,
    idlePenaltyMax: 20,
  },
};

export function coerceCallDistribution(value: unknown): CallDistributionConfig {
  const parsed = callDistributionSchema.safeParse(value);
  return parsed.success ? parsed.data : DEFAULT_CALL_DISTRIBUTION;
}

// ───────────────────────── speed-to-lead alert ─────────────────────────

/**
 * "Tell someone when leads are sitting unanswered." Founder-editable via
 * AppSetting("speedToLeadAlert"); read + sent by server/speed-to-lead-alert.ts on the
 * /api/cron/alerts tick.
 *
 * Ships OFF — it sends real email.
 *
 * THE DEFAULTS ARE SHAPED BY THE BACKLOG. Production holds ~23,435 leads, essentially none ever
 * contacted. An alert defined as "any lead past its deadline" would fire on all of them, on every
 * tick, forever — and be muted within two days, which is worse than no alert because it also
 * carries the false assurance of having been configured. So:
 *
 *   lookbackMinutes  only leads that arrived in the last N minutes are alertable. The standing
 *                    backlog is reported as a number in the digest, never as an alert. 120 min.
 *   thresholdMinutes how late is late. 15, not 5: the JD's five-minute clock is a TARGET to be
 *                    measured against, and alerting exactly on it would page someone about a
 *                    lead a caller is very likely already dialling.
 *   minBreaches      one late lead is a Tuesday; several at once is a situation. 3.
 *   cooldownMinutes  how long after an alert before another may go out. 60.
 */
export const speedToLeadAlertSchema = z.object({
  enabled: z.boolean(),
  thresholdMinutes: z.number().int().min(1).max(1440),
  lookbackMinutes: z.number().int().min(5).max(10080),
  minBreaches: z.number().int().min(1).max(500),
  cooldownMinutes: z.number().int().min(5).max(1440),
  recipients: z.array(emailAddress).max(10),
});

export type SpeedToLeadAlertConfig = z.infer<typeof speedToLeadAlertSchema>;

export const DEFAULT_SPEED_TO_LEAD_ALERT: SpeedToLeadAlertConfig = {
  enabled: false,
  thresholdMinutes: 15,
  lookbackMinutes: 120,
  minBreaches: 3,
  cooldownMinutes: 60,
  recipients: [],
};

export function coerceSpeedToLeadAlert(value: unknown): SpeedToLeadAlertConfig {
  const parsed = speedToLeadAlertSchema.safeParse(value);
  return parsed.success ? parsed.data : DEFAULT_SPEED_TO_LEAD_ALERT;
}

// ───────────────────────── dunning ladder ─────────────────────────

/** Which channel a dunning stage goes out on. */
export const dunningChannelSchema = z.enum(["EMAIL", "WHATSAPP", "BOTH"]);
export type DunningChannel = z.infer<typeof dunningChannelSchema>;

/**
 * The three-stage payment-chase ladder, keyed off each instalment's own due date.
 * Founder-editable via AppSetting("dunning"); run by server/dunning.ts from the daily cron.
 *
 * Ships OFF: it emails and WhatsApps paying students, which is the highest-consequence outbound
 * this app has.
 *
 * `dayOffset` is relative to the due date — NEGATIVE is before it. The defaults (-3 / +1 / +7)
 * are a nudge, a miss and a final notice.
 *
 * `perRunCap` is not a performance setting. The first armed run faces the entire standing
 * backlog at once; without a cap that is a mailbomb with the founders' name on it. 50 turns it
 * into a queue that drains over days, which is also simply how a human would have done it.
 */
export const dunningStageSchema = z.object({
  enabled: z.boolean(),
  dayOffset: z.number().int().min(-60).max(180),
  channel: dunningChannelSchema,
});

export const dunningConfigSchema = z.object({
  enabled: z.boolean(),
  stages: z.object({
    upcoming: dunningStageSchema,
    missed: dunningStageSchema,
    final: dunningStageSchema,
  }),
  /** Copied on the final stage so the founder sees the escalation without being the sender. */
  founderCc: z.union([emailAddress, z.literal("")]),
  perRunCap: z.number().int().min(1).max(1000),
});

export type DunningConfig = z.infer<typeof dunningConfigSchema>;

export const DEFAULT_DUNNING_CONFIG: DunningConfig = {
  enabled: false,
  stages: {
    upcoming: { enabled: true, dayOffset: -3, channel: "EMAIL" },
    missed: { enabled: true, dayOffset: 1, channel: "EMAIL" },
    final: { enabled: true, dayOffset: 7, channel: "EMAIL" },
  },
  founderCc: "",
  perRunCap: 50,
};

export function coerceDunningConfig(value: unknown): DunningConfig {
  const parsed = dunningConfigSchema.safeParse(value);
  return parsed.success ? parsed.data : DEFAULT_DUNNING_CONFIG;
}

// ───────────────────────── attendance ─────────────────────────

/**
 * When a student's attendance becomes a concern. Founder-editable via AppSetting("attendance");
 * read by lib/attendance.ts (pure) through server/attendance.ts.
 *
 * These are thresholds on a RECORDED fact, so unlike the engines above there is nothing to ship
 * "off" — the signal is a read, not a send. What ships off is acting on it.
 *
 * `amberRatePct` / `redRatePct` are attendance percentages, so LOWER is worse. `consecutiveMissed`
 * is the separate alarm: a student at 80% overall who has missed the last three classes in a row
 * is the one about to drop, and an average cannot see that.
 */
export const attendanceConfigSchema = z
  .object({
    amberRatePct: z.number().int().min(0).max(100),
    redRatePct: z.number().int().min(0).max(100),
    consecutiveMissedForRed: z.number().int().min(1).max(20),
    /** Sessions attended below this count leave the signal UNKNOWN rather than green. */
    minSessionsForSignal: z.number().int().min(1).max(20),
  })
  .refine((c) => c.redRatePct <= c.amberRatePct, {
    message: "The red threshold must be at or below the amber one",
    path: ["redRatePct"],
  });

export type AttendanceConfig = z.infer<typeof attendanceConfigSchema>;

export const DEFAULT_ATTENDANCE_CONFIG: AttendanceConfig = {
  amberRatePct: 80,
  redRatePct: 60,
  consecutiveMissedForRed: 3,
  // Two sessions is the smallest sample where a rate means anything. Below it the honest
  // answer is "we don't know yet", not "green".
  minSessionsForSignal: 2,
};

export function coerceAttendanceConfig(value: unknown): AttendanceConfig {
  const parsed = attendanceConfigSchema.safeParse(value);
  return parsed.success ? parsed.data : DEFAULT_ATTENDANCE_CONFIG;
}
