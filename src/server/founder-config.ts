import "server-only";
import { cache } from "react";
import { revalidateTag, unstable_cache } from "next/cache";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import {
  coerceAgreementWorkflow,
  coerceCallDistribution,
  coerceBookingRulesConfig,
  coerceSlotPatternConfig,
  coerceCommissionRulesConfig,
  coerceDailyLogEod,
  coerceDailyLogTargets,
  coerceGamificationConfig,
  coerceSavedSignature,
  coerceSectionsConfig,
  coerceSssConfig,
  coerceBookOrderConfig,
  coercePipelineConfig,
  coerceTutorFeeConfig,
  coerceInstalmentPlanConfig,
  coerceWorkflowSettings,
  coerceMaintenanceConfig,
  coerceScheduledReportConfig,
  coerceFinancePostingConfig,
  coerceSpeedToLeadAlert,
  coerceDunningConfig,
  coerceAttendanceConfig,
  DEFAULT_AGREEMENT_WORKFLOW,
  DEFAULT_CALL_DISTRIBUTION,
  DEFAULT_BOOKING_RULES_CONFIG,
  DEFAULT_SLOT_PATTERN_CONFIG,
  DEFAULT_COMMISSION_RULES_CONFIG,
  DEFAULT_DAILY_LOG_EOD,
  DEFAULT_DAILY_LOG_TARGETS,
  DEFAULT_SSS_CONFIG,
  DEFAULT_BOOK_ORDER_CONFIG,
  DEFAULT_PIPELINE_CONFIG,
  DEFAULT_TUTOR_FEE_CONFIG,
  DEFAULT_INSTALMENT_PLAN_CONFIG,
  DEFAULT_WORKFLOW_SETTINGS,
  DEFAULT_MAINTENANCE_CONFIG,
  DEFAULT_SCHEDULED_REPORT_CONFIG,
  DEFAULT_FINANCE_POSTING_CONFIG,
  DEFAULT_SPEED_TO_LEAD_ALERT,
  DEFAULT_DUNNING_CONFIG,
  DEFAULT_ATTENDANCE_CONFIG,
  type AgreementWorkflowConfig,
  type CallDistributionConfig,
  type BookingRulesConfig,
  type SlotPatternConfig,
  type CommissionRulesConfig,
  type DailyLogEodConfig,
  type DailyLogTargets,
  type SavedSignature,
  type SssConfig,
  type BookOrderConfig,
  type PipelineConfig,
  type TutorFeeConfig,
  type InstalmentPlanConfig,
  type WorkflowSettings,
  type MaintenanceConfig,
  type ScheduledReportConfig,
  type FinancePostingConfig,
  type SpeedToLeadAlertConfig,
  type DunningConfig,
  type AttendanceConfig,
} from "@/lib/config-schema";
import { DEFAULT_GAMIFICATION_CONFIG, type GamificationConfig } from "@/lib/gamification";
import { resolveSections, type ResolvedSection, type SectionsConfig } from "@/lib/sections";

/**
 * The founder's two config documents, read from the AppSetting key/value store.
 *
 * Both are LAZY: no row means "the shipped defaults", so a fresh install behaves
 * exactly as it did before the console existed and nothing needs seeding. A row
 * that fails validation also falls back to defaults rather than taking the app
 * down — writes are validated, so that should only ever happen after a hand-edit.
 *
 * Wrapped in React.cache: the layout, the page and any server action in one
 * request share a single read.
 */

export const SECTIONS_KEY = "sectionsConfig";
export const GAMIFICATION_KEY = "gamificationRulesets";
export const BOOKING_RULES_KEY = "bookingRulesConfig";
export const SLOT_PATTERN_KEY = "slotPatternConfig";
export const SSS_PATTERN_KEY = "sssPatternConfig";
export const WORKFLOW_SETTINGS_KEY = "workflowSettings";
export const COMMISSION_RULES_KEY = "commissionRules";
export const SSS_CONFIG_KEY = "sssConfig";
export const DAILY_LOG_TARGETS_KEY = "dailyLogTargets";
export const DAILY_LOG_EOD_KEY = "dailyLogEod";
export const AGREEMENT_WORKFLOW_KEY = "agreementWorkflow";
export const CALL_DISTRIBUTION_KEY = "callDistribution";
export const TUTOR_FEE_KEY = "tutorFee";
export const BOOK_ORDER_KEY = "bookOrders";
export const PIPELINE_KEY = "pipelineConfig";
export const MAINTENANCE_KEY = "maintenanceConfig";
export const SCHEDULED_REPORT_KEY = "scheduledReport";
export const FINANCE_POSTING_KEY = "financePosting";
export const INSTALMENT_PLAN_KEY = "instalmentPlans";
export const SPEED_TO_LEAD_ALERT_KEY = "speedToLeadAlert";
export const DUNNING_KEY = "dunning";
export const ATTENDANCE_KEY = "attendance";

/**
 * Every config row on this page is read through ONE tagged cache entry.
 *
 * These are founder settings: they change when someone edits the Console, which is
 * roughly never, yet each getter was a fresh `findUnique` on EVERY request. Against
 * the Supabase pooler a round trip is ~200ms, and `getSectionsConfig` alone runs on
 * every authenticated page (requireSection → visibleSections), so the nav paid a
 * fifth of a second to re-read a row that hadn't changed in weeks.
 *
 * `unstable_cache` holds the value across requests; `revalidateFounderConfig()` drops
 * it the moment anything writes, so a Console save is still visible on the very next
 * render. React's `cache` stays layered on top so repeats inside ONE request don't
 * even re-enter the cache layer.
 *
 * The `{ value }` wrapper is deliberate: a row whose JSON value is literally `null` has
 * to stay distinguishable from "no row at all", because the getters below branch on
 * exactly that to decide between a coerced value and the shipped default.
 *
 * NOTE for a future scale-out: this cache lives in the app process, so `revalidateTag`
 * only clears the instance that served the write. The deploy runs a single `app`
 * container (docker-compose.prod.yml), which is why that is correct today — add a
 * replica and a Console save would go stale on every container but one.
 */
export const FOUNDER_CONFIG_TAG = "founder-config";

const readSetting = cache(
  async (key: string): Promise<{ value: Prisma.JsonValue } | null> =>
    unstable_cache(
      async () => {
        const row = await prisma.appSetting.findUnique({ where: { key } });
        return row ? { value: row.value } : null;
      },
      ["founder-config", key],
      { tags: [FOUNDER_CONFIG_TAG] },
    )(),
);

/**
 * Drop the cached config after a write.
 *
 * Wrapped because `revalidateTag` needs a request scope: the same writers are called
 * from seed/maintenance scripts that run outside one, and a housekeeping script must
 * not crash over a cache hint. In that context there is no cache to drop anyway.
 */
export function revalidateFounderConfig(): void {
  try {
    revalidateTag(FOUNDER_CONFIG_TAG);
  } catch {
    /* no request scope (script/cron context) — nothing cached to invalidate */
  }
}

export const getSectionsConfig = cache(async (): Promise<SectionsConfig | null> => {
  const row = await readSetting(SECTIONS_KEY);
  return row ? coerceSectionsConfig(row.value) : null;
});

/** The nav, as the founder arranged it: merged over the code catalogue and ordered. */
export const getResolvedSections = cache(async (): Promise<ResolvedSection[]> =>
  resolveSections(await getSectionsConfig()),
);

export const getGamificationConfig = cache(async (): Promise<GamificationConfig> => {
  const row = await readSetting(GAMIFICATION_KEY);
  return row ? coerceGamificationConfig(row.value) : DEFAULT_GAMIFICATION_CONFIG;
});

export const getBookingRulesConfig = cache(async (): Promise<BookingRulesConfig> => {
  const row = await readSetting(BOOKING_RULES_KEY);
  return row ? coerceBookingRulesConfig(row.value) : DEFAULT_BOOKING_RULES_CONFIG;
});

/** Standing weekly availability, replayed forward nightly by `ensureBookingSlots`. */
export const getSlotPatternConfig = cache(async (): Promise<SlotPatternConfig> => {
  const row = await readSetting(SLOT_PATTERN_KEY);
  return row ? coerceSlotPatternConfig(row.value) : DEFAULT_SLOT_PATTERN_CONFIG;
});

export async function writeSlotPatternConfig(config: SlotPatternConfig): Promise<void> {
  const value = config as unknown as Prisma.InputJsonValue;
  await prisma.appSetting.upsert({
    where: { key: SLOT_PATTERN_KEY },
    create: { key: SLOT_PATTERN_KEY, value },
    update: { value },
  });
  revalidateFounderConfig();
}

/**
 * The same standing-availability shape, for the founder's SSS (sales) calendar.
 *
 * It reuses `SlotPatternConfig` rather than inventing a parallel one, with two fields ignored:
 * the owner comes from `sssConfig.ownerId` and the call length from `sssConfig.slotDurationMins`,
 * because an SSS slot already stores both and they must not be able to disagree.
 */
export const getSssPatternConfig = cache(async (): Promise<SlotPatternConfig> => {
  const row = await readSetting(SSS_PATTERN_KEY);
  return row ? coerceSlotPatternConfig(row.value) : DEFAULT_SLOT_PATTERN_CONFIG;
});

export async function writeSssPatternConfig(config: SlotPatternConfig): Promise<void> {
  const value = config as unknown as Prisma.InputJsonValue;
  await prisma.appSetting.upsert({
    where: { key: SSS_PATTERN_KEY },
    create: { key: SSS_PATTERN_KEY, value },
    update: { value },
  });
  revalidateFounderConfig();
}

/** Global Workflow Settings — read by the automation engine on every trigger/resume. */
export const getWorkflowSettings = cache(async (): Promise<WorkflowSettings> => {
  const row = await readSetting(WORKFLOW_SETTINGS_KEY);
  return row ? coerceWorkflowSettings(row.value) : DEFAULT_WORKFLOW_SETTINGS;
});

/** Deal-team commission rates — read by the Finance commission report. */
export const getCommissionRulesConfig = cache(async (): Promise<CommissionRulesConfig> => {
  const row = await readSetting(COMMISSION_RULES_KEY);
  return row ? coerceCommissionRulesConfig(row.value) : DEFAULT_COMMISSION_RULES_CONFIG;
});

/** Trainer-fee bands — read by the batch P&L via lib/tutor-fee.ts. */
export const getTutorFeeConfig = cache(async (): Promise<TutorFeeConfig> => {
  const row = await readSetting(TUTOR_FEE_KEY);
  return row ? coerceTutorFeeConfig(row.value) : DEFAULT_TUTOR_FEE_CONFIG;
});

/** Instalment-plan pricing + default gap — read by the EMI generator on Finance → Pending. */
export const getInstalmentPlanConfig = cache(async (): Promise<InstalmentPlanConfig> => {
  const row = await readSetting(INSTALMENT_PLAN_KEY);
  return row ? coerceInstalmentPlanConfig(row.value) : DEFAULT_INSTALMENT_PLAN_CONFIG;
});

export async function writeInstalmentPlanConfig(config: InstalmentPlanConfig): Promise<void> {
  const value = config as unknown as Prisma.InputJsonValue;
  await prisma.appSetting.upsert({
    where: { key: INSTALMENT_PLAN_KEY },
    create: { key: INSTALMENT_PLAN_KEY, value },
    update: { value },
  });
  revalidateFounderConfig();
}

/** Book-order trigger — read when a payment lands and by the Book Orders panel. */
export const getBookOrderConfig = cache(async (): Promise<BookOrderConfig> => {
  const row = await readSetting(BOOK_ORDER_KEY);
  return row ? coerceBookOrderConfig(row.value) : DEFAULT_BOOK_ORDER_CONFIG;
});

/** Pipeline mode — rules-driven vs drag-and-drop (Part 2 §9). */
export const getPipelineConfig = cache(async (): Promise<PipelineConfig> => {
  const row = await readSetting(PIPELINE_KEY);
  return row ? coercePipelineConfig(row.value) : DEFAULT_PIPELINE_CONFIG;
});

/** Daily-maintenance housekeeping — read by server/daily-maintenance.ts on the /api/cron/daily tick. */
export const getMaintenanceConfig = cache(async (): Promise<MaintenanceConfig> => {
  const row = await readSetting(MAINTENANCE_KEY);
  return row ? coerceMaintenanceConfig(row.value) : DEFAULT_MAINTENANCE_CONFIG;
});

export async function writeMaintenanceConfig(config: MaintenanceConfig): Promise<void> {
  const value = config as unknown as Prisma.InputJsonValue;
  await prisma.appSetting.upsert({
    where: { key: MAINTENANCE_KEY },
    create: { key: MAINTENANCE_KEY, value },
    update: { value },
  });
  revalidateFounderConfig();
}

/** Scheduled founder-digest config — read + sent by server/scheduled-report.ts. */
export const getScheduledReportConfig = cache(async (): Promise<ScheduledReportConfig> => {
  const row = await readSetting(SCHEDULED_REPORT_KEY);
  return row ? coerceScheduledReportConfig(row.value) : DEFAULT_SCHEDULED_REPORT_CONFIG;
});

export async function writeScheduledReportConfig(config: ScheduledReportConfig): Promise<void> {
  const value = config as unknown as Prisma.InputJsonValue;
  await prisma.appSetting.upsert({
    where: { key: SCHEDULED_REPORT_KEY },
    create: { key: SCHEDULED_REPORT_KEY, value },
    update: { value },
  });
  revalidateFounderConfig();
}

/** Speed-to-lead alerting — read + sent by server/speed-to-lead-alert.ts on the alerts tick. */
export const getSpeedToLeadAlertConfig = cache(async (): Promise<SpeedToLeadAlertConfig> => {
  const row = await readSetting(SPEED_TO_LEAD_ALERT_KEY);
  return row ? coerceSpeedToLeadAlert(row.value) : DEFAULT_SPEED_TO_LEAD_ALERT;
});

export async function writeSpeedToLeadAlertConfig(config: SpeedToLeadAlertConfig): Promise<void> {
  const value = config as unknown as Prisma.InputJsonValue;
  await prisma.appSetting.upsert({
    where: { key: SPEED_TO_LEAD_ALERT_KEY },
    create: { key: SPEED_TO_LEAD_ALERT_KEY, value },
    update: { value },
  });
  revalidateFounderConfig();
}

/** The three-stage payment-chase ladder — read by server/dunning.ts on the daily tick. */
export const getDunningConfig = cache(async (): Promise<DunningConfig> => {
  const row = await readSetting(DUNNING_KEY);
  return row ? coerceDunningConfig(row.value) : DEFAULT_DUNNING_CONFIG;
});

export async function writeDunningConfig(config: DunningConfig): Promise<void> {
  const value = config as unknown as Prisma.InputJsonValue;
  await prisma.appSetting.upsert({
    where: { key: DUNNING_KEY },
    create: { key: DUNNING_KEY, value },
    update: { value },
  });
  revalidateFounderConfig();
}

/** Attendance risk thresholds — read by server/attendance.ts. */
export const getAttendanceConfig = cache(async (): Promise<AttendanceConfig> => {
  const row = await readSetting(ATTENDANCE_KEY);
  return row ? coerceAttendanceConfig(row.value) : DEFAULT_ATTENDANCE_CONFIG;
});

export async function writeAttendanceConfig(config: AttendanceConfig): Promise<void> {
  const value = config as unknown as Prisma.InputJsonValue;
  await prisma.appSetting.upsert({
    where: { key: ATTENDANCE_KEY },
    create: { key: ATTENDANCE_KEY, value },
    update: { value },
  });
  revalidateFounderConfig();
}

/** Ledger auto-posting switches — read by invoice-posting.ts and commission-actions.ts. */
export const getFinancePostingConfig = cache(async (): Promise<FinancePostingConfig> => {
  const row = await readSetting(FINANCE_POSTING_KEY);
  return row ? coerceFinancePostingConfig(row.value) : DEFAULT_FINANCE_POSTING_CONFIG;
});

export async function writeFinancePostingConfig(config: FinancePostingConfig): Promise<void> {
  const value = config as unknown as Prisma.InputJsonValue;
  await prisma.appSetting.upsert({
    where: { key: FINANCE_POSTING_KEY },
    create: { key: FINANCE_POSTING_KEY, value },
    update: { value },
  });
  revalidateFounderConfig();
}

/** SSS (sales) call config — read by the SSS slot engine and calendar. */
export const getSssConfig = cache(async (): Promise<SssConfig> => {
  const row = await readSetting(SSS_CONFIG_KEY);
  return row ? coerceSssConfig(row.value) : DEFAULT_SSS_CONFIG;
});

/** Daily-log per-variant targets — read by the Daily Log timeline to grade each entry. */
export const getDailyLogTargets = cache(async (): Promise<DailyLogTargets> => {
  const row = await readSetting(DAILY_LOG_TARGETS_KEY);
  return row ? coerceDailyLogTargets(row.value) : DEFAULT_DAILY_LOG_TARGETS;
});

/**
 * The founder's stored countersignature, per user. Not a `cache()` read: it is only ever fetched
 * inside an issue action, and caching a ~500 KB data URL across a request buys nothing.
 */
export const savedSignatureKey = (userId: string) => `agreement.signature.${userId}`;

export async function getSavedSignature(userId: string): Promise<SavedSignature | null> {
  const row = await prisma.appSetting.findUnique({ where: { key: savedSignatureKey(userId) } });
  return row ? coerceSavedSignature(row.value) : null;
}

export async function writeSavedSignature(userId: string, sig: SavedSignature): Promise<void> {
  const key = savedSignatureKey(userId);
  const value = sig as unknown as Prisma.InputJsonValue;
  await prisma.appSetting.upsert({ where: { key }, create: { key, value }, update: { value } });
}

export async function clearSavedSignature(userId: string): Promise<void> {
  await prisma.appSetting.deleteMany({ where: { key: savedSignatureKey(userId) } });
}

/**
 * Daily-log EOD rules — read by the submit action (cutoff + amend window), the EOD job and
 * the notification centre. Ships disabled, so an install with no row behaves exactly as it
 * did before this engine existed.
 */
export const getDailyLogEod = cache(async (): Promise<DailyLogEodConfig> => {
  const row = await readSetting(DAILY_LOG_EOD_KEY);
  return row ? coerceDailyLogEod(row.value) : DEFAULT_DAILY_LOG_EOD;
});

/** Agreement readiness prompt threshold — read by the agreement-state derivation. */
export const getAgreementWorkflow = cache(async (): Promise<AgreementWorkflowConfig> => {
  const row = await readSetting(AGREEMENT_WORKFLOW_KEY);
  return row ? coerceAgreementWorkflow(row.value) : DEFAULT_AGREEMENT_WORKFLOW;
});

export async function writeAgreementWorkflow(config: AgreementWorkflowConfig): Promise<void> {
  const value = config as unknown as Prisma.InputJsonValue;
  await prisma.appSetting.upsert({
    where: { key: AGREEMENT_WORKFLOW_KEY },
    create: { key: AGREEMENT_WORKFLOW_KEY, value },
    update: { value },
  });
  revalidateFounderConfig();
}

/**
 * Call distribution + lead-ranking weights.
 *
 * Read on every lead capture (the rotation) and on every desk/pipeline render (the ranking), so
 * the cross-request `unstable_cache` behind `readSetting` matters more here than for most config —
 * without it this would be an extra round trip on the hottest paths in the app.
 */
export const getCallDistribution = cache(async (): Promise<CallDistributionConfig> => {
  const row = await readSetting(CALL_DISTRIBUTION_KEY);
  return row ? coerceCallDistribution(row.value) : DEFAULT_CALL_DISTRIBUTION;
});

export async function writeCallDistribution(config: CallDistributionConfig): Promise<void> {
  const value = config as unknown as Prisma.InputJsonValue;
  await prisma.appSetting.upsert({
    where: { key: CALL_DISTRIBUTION_KEY },
    create: { key: CALL_DISTRIBUTION_KEY, value },
    update: { value },
  });
  revalidateFounderConfig();
}

export async function writeSectionsConfig(config: SectionsConfig): Promise<void> {
  const value = config as unknown as Prisma.InputJsonValue;
  await prisma.appSetting.upsert({
    where: { key: SECTIONS_KEY },
    create: { key: SECTIONS_KEY, value },
    update: { value },
  });
  revalidateFounderConfig();
}

export async function writeGamificationConfig(config: GamificationConfig): Promise<void> {
  const value = config as unknown as Prisma.InputJsonValue;
  await prisma.appSetting.upsert({
    where: { key: GAMIFICATION_KEY },
    create: { key: GAMIFICATION_KEY, value },
    update: { value },
  });
  revalidateFounderConfig();
}

export async function writeBookingRulesConfig(config: BookingRulesConfig): Promise<void> {
  const value = config as unknown as Prisma.InputJsonValue;
  await prisma.appSetting.upsert({
    where: { key: BOOKING_RULES_KEY },
    create: { key: BOOKING_RULES_KEY, value },
    update: { value },
  });
  revalidateFounderConfig();
}

export async function writeWorkflowSettings(config: WorkflowSettings): Promise<void> {
  const value = config as unknown as Prisma.InputJsonValue;
  await prisma.appSetting.upsert({
    where: { key: WORKFLOW_SETTINGS_KEY },
    create: { key: WORKFLOW_SETTINGS_KEY, value },
    update: { value },
  });
  revalidateFounderConfig();
}

export async function writeCommissionRulesConfig(config: CommissionRulesConfig): Promise<void> {
  const value = config as unknown as Prisma.InputJsonValue;
  await prisma.appSetting.upsert({
    where: { key: COMMISSION_RULES_KEY },
    create: { key: COMMISSION_RULES_KEY, value },
    update: { value },
  });
  revalidateFounderConfig();
}

export async function writeSssConfig(config: SssConfig): Promise<void> {
  const value = config as unknown as Prisma.InputJsonValue;
  await prisma.appSetting.upsert({
    where: { key: SSS_CONFIG_KEY },
    create: { key: SSS_CONFIG_KEY, value },
    update: { value },
  });
  revalidateFounderConfig();
}

export async function writeDailyLogTargets(config: DailyLogTargets): Promise<void> {
  const value = config as unknown as Prisma.InputJsonValue;
  await prisma.appSetting.upsert({
    where: { key: DAILY_LOG_TARGETS_KEY },
    create: { key: DAILY_LOG_TARGETS_KEY, value },
    update: { value },
  });
  revalidateFounderConfig();
}

export async function writeDailyLogEod(config: DailyLogEodConfig): Promise<void> {
  const value = config as unknown as Prisma.InputJsonValue;
  await prisma.appSetting.upsert({
    where: { key: DAILY_LOG_EOD_KEY },
    create: { key: DAILY_LOG_EOD_KEY, value },
    update: { value },
  });
  revalidateFounderConfig();
}

export async function writeTutorFeeConfig(config: TutorFeeConfig): Promise<void> {
  const value = config as unknown as Prisma.InputJsonValue;
  await prisma.appSetting.upsert({
    where: { key: TUTOR_FEE_KEY },
    create: { key: TUTOR_FEE_KEY, value },
    update: { value },
  });
  revalidateFounderConfig();
}

export async function writeBookOrderConfig(config: BookOrderConfig): Promise<void> {
  const value = config as unknown as Prisma.InputJsonValue;
  await prisma.appSetting.upsert({
    where: { key: BOOK_ORDER_KEY },
    create: { key: BOOK_ORDER_KEY, value },
    update: { value },
  });
  revalidateFounderConfig();
}

export async function writePipelineConfig(config: PipelineConfig): Promise<void> {
  const value = config as unknown as Prisma.InputJsonValue;
  await prisma.appSetting.upsert({
    where: { key: PIPELINE_KEY },
    create: { key: PIPELINE_KEY, value },
    update: { value },
  });
  revalidateFounderConfig();
}
