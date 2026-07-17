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
});

export type CommissionRulesConfig = z.infer<typeof commissionRulesConfigSchema>;

export const DEFAULT_COMMISSION_RULES_CONFIG: CommissionRulesConfig = {
  bothCallsPct: 5,
  splitPct: 3,
  closerPct: 4,
};

export function coerceCommissionRulesConfig(value: unknown): CommissionRulesConfig {
  const parsed = commissionRulesConfigSchema.safeParse(value);
  return parsed.success ? parsed.data : DEFAULT_COMMISSION_RULES_CONFIG;
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
