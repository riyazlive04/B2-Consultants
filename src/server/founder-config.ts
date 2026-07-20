import "server-only";
import { cache } from "react";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import {
  coerceAgreementWorkflow,
  coerceBookingRulesConfig,
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
  coerceWorkflowSettings,
  coerceMaintenanceConfig,
  coerceScheduledReportConfig,
  coerceFinancePostingConfig,
  DEFAULT_AGREEMENT_WORKFLOW,
  DEFAULT_BOOKING_RULES_CONFIG,
  DEFAULT_COMMISSION_RULES_CONFIG,
  DEFAULT_DAILY_LOG_EOD,
  DEFAULT_DAILY_LOG_TARGETS,
  DEFAULT_SSS_CONFIG,
  DEFAULT_BOOK_ORDER_CONFIG,
  DEFAULT_PIPELINE_CONFIG,
  DEFAULT_TUTOR_FEE_CONFIG,
  DEFAULT_WORKFLOW_SETTINGS,
  DEFAULT_MAINTENANCE_CONFIG,
  DEFAULT_SCHEDULED_REPORT_CONFIG,
  DEFAULT_FINANCE_POSTING_CONFIG,
  type AgreementWorkflowConfig,
  type BookingRulesConfig,
  type CommissionRulesConfig,
  type DailyLogEodConfig,
  type DailyLogTargets,
  type SavedSignature,
  type SssConfig,
  type BookOrderConfig,
  type PipelineConfig,
  type TutorFeeConfig,
  type WorkflowSettings,
  type MaintenanceConfig,
  type ScheduledReportConfig,
  type FinancePostingConfig,
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
export const WORKFLOW_SETTINGS_KEY = "workflowSettings";
export const COMMISSION_RULES_KEY = "commissionRules";
export const SSS_CONFIG_KEY = "sssConfig";
export const DAILY_LOG_TARGETS_KEY = "dailyLogTargets";
export const DAILY_LOG_EOD_KEY = "dailyLogEod";
export const AGREEMENT_WORKFLOW_KEY = "agreementWorkflow";
export const TUTOR_FEE_KEY = "tutorFee";
export const BOOK_ORDER_KEY = "bookOrders";
export const PIPELINE_KEY = "pipelineConfig";
export const MAINTENANCE_KEY = "maintenanceConfig";
export const SCHEDULED_REPORT_KEY = "scheduledReport";
export const FINANCE_POSTING_KEY = "financePosting";

export const getSectionsConfig = cache(async (): Promise<SectionsConfig | null> => {
  const row = await prisma.appSetting.findUnique({ where: { key: SECTIONS_KEY } });
  return row ? coerceSectionsConfig(row.value) : null;
});

/** The nav, as the founder arranged it: merged over the code catalogue and ordered. */
export const getResolvedSections = cache(async (): Promise<ResolvedSection[]> =>
  resolveSections(await getSectionsConfig()),
);

export const getGamificationConfig = cache(async (): Promise<GamificationConfig> => {
  const row = await prisma.appSetting.findUnique({ where: { key: GAMIFICATION_KEY } });
  return row ? coerceGamificationConfig(row.value) : DEFAULT_GAMIFICATION_CONFIG;
});

export const getBookingRulesConfig = cache(async (): Promise<BookingRulesConfig> => {
  const row = await prisma.appSetting.findUnique({ where: { key: BOOKING_RULES_KEY } });
  return row ? coerceBookingRulesConfig(row.value) : DEFAULT_BOOKING_RULES_CONFIG;
});

/** Global Workflow Settings — read by the automation engine on every trigger/resume. */
export const getWorkflowSettings = cache(async (): Promise<WorkflowSettings> => {
  const row = await prisma.appSetting.findUnique({ where: { key: WORKFLOW_SETTINGS_KEY } });
  return row ? coerceWorkflowSettings(row.value) : DEFAULT_WORKFLOW_SETTINGS;
});

/** Deal-team commission rates — read by the Finance commission report. */
export const getCommissionRulesConfig = cache(async (): Promise<CommissionRulesConfig> => {
  const row = await prisma.appSetting.findUnique({ where: { key: COMMISSION_RULES_KEY } });
  return row ? coerceCommissionRulesConfig(row.value) : DEFAULT_COMMISSION_RULES_CONFIG;
});

/** Trainer-fee bands — read by the batch P&L via lib/tutor-fee.ts. */
export const getTutorFeeConfig = cache(async (): Promise<TutorFeeConfig> => {
  const row = await prisma.appSetting.findUnique({ where: { key: TUTOR_FEE_KEY } });
  return row ? coerceTutorFeeConfig(row.value) : DEFAULT_TUTOR_FEE_CONFIG;
});

/** Book-order trigger — read when a payment lands and by the Book Orders panel. */
export const getBookOrderConfig = cache(async (): Promise<BookOrderConfig> => {
  const row = await prisma.appSetting.findUnique({ where: { key: BOOK_ORDER_KEY } });
  return row ? coerceBookOrderConfig(row.value) : DEFAULT_BOOK_ORDER_CONFIG;
});

/** Pipeline mode — rules-driven vs drag-and-drop (Part 2 §9). */
export const getPipelineConfig = cache(async (): Promise<PipelineConfig> => {
  const row = await prisma.appSetting.findUnique({ where: { key: PIPELINE_KEY } });
  return row ? coercePipelineConfig(row.value) : DEFAULT_PIPELINE_CONFIG;
});

/** Daily-maintenance housekeeping — read by server/daily-maintenance.ts on the /api/cron/daily tick. */
export const getMaintenanceConfig = cache(async (): Promise<MaintenanceConfig> => {
  const row = await prisma.appSetting.findUnique({ where: { key: MAINTENANCE_KEY } });
  return row ? coerceMaintenanceConfig(row.value) : DEFAULT_MAINTENANCE_CONFIG;
});

export async function writeMaintenanceConfig(config: MaintenanceConfig): Promise<void> {
  const value = config as unknown as Prisma.InputJsonValue;
  await prisma.appSetting.upsert({
    where: { key: MAINTENANCE_KEY },
    create: { key: MAINTENANCE_KEY, value },
    update: { value },
  });
}

/** Scheduled founder-digest config — read + sent by server/scheduled-report.ts. */
export const getScheduledReportConfig = cache(async (): Promise<ScheduledReportConfig> => {
  const row = await prisma.appSetting.findUnique({ where: { key: SCHEDULED_REPORT_KEY } });
  return row ? coerceScheduledReportConfig(row.value) : DEFAULT_SCHEDULED_REPORT_CONFIG;
});

export async function writeScheduledReportConfig(config: ScheduledReportConfig): Promise<void> {
  const value = config as unknown as Prisma.InputJsonValue;
  await prisma.appSetting.upsert({
    where: { key: SCHEDULED_REPORT_KEY },
    create: { key: SCHEDULED_REPORT_KEY, value },
    update: { value },
  });
}

/** Ledger auto-posting switches — read by invoice-posting.ts and commission-actions.ts. */
export const getFinancePostingConfig = cache(async (): Promise<FinancePostingConfig> => {
  const row = await prisma.appSetting.findUnique({ where: { key: FINANCE_POSTING_KEY } });
  return row ? coerceFinancePostingConfig(row.value) : DEFAULT_FINANCE_POSTING_CONFIG;
});

export async function writeFinancePostingConfig(config: FinancePostingConfig): Promise<void> {
  const value = config as unknown as Prisma.InputJsonValue;
  await prisma.appSetting.upsert({
    where: { key: FINANCE_POSTING_KEY },
    create: { key: FINANCE_POSTING_KEY, value },
    update: { value },
  });
}

/** SSS (sales) call config — read by the SSS slot engine and calendar. */
export const getSssConfig = cache(async (): Promise<SssConfig> => {
  const row = await prisma.appSetting.findUnique({ where: { key: SSS_CONFIG_KEY } });
  return row ? coerceSssConfig(row.value) : DEFAULT_SSS_CONFIG;
});

/** Daily-log per-variant targets — read by the Daily Log timeline to grade each entry. */
export const getDailyLogTargets = cache(async (): Promise<DailyLogTargets> => {
  const row = await prisma.appSetting.findUnique({ where: { key: DAILY_LOG_TARGETS_KEY } });
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
  const row = await prisma.appSetting.findUnique({ where: { key: DAILY_LOG_EOD_KEY } });
  return row ? coerceDailyLogEod(row.value) : DEFAULT_DAILY_LOG_EOD;
});

/** Agreement readiness prompt threshold — read by the agreement-state derivation. */
export const getAgreementWorkflow = cache(async (): Promise<AgreementWorkflowConfig> => {
  const row = await prisma.appSetting.findUnique({ where: { key: AGREEMENT_WORKFLOW_KEY } });
  return row ? coerceAgreementWorkflow(row.value) : DEFAULT_AGREEMENT_WORKFLOW;
});

export async function writeAgreementWorkflow(config: AgreementWorkflowConfig): Promise<void> {
  const value = config as unknown as Prisma.InputJsonValue;
  await prisma.appSetting.upsert({
    where: { key: AGREEMENT_WORKFLOW_KEY },
    create: { key: AGREEMENT_WORKFLOW_KEY, value },
    update: { value },
  });
}

export async function writeSectionsConfig(config: SectionsConfig): Promise<void> {
  const value = config as unknown as Prisma.InputJsonValue;
  await prisma.appSetting.upsert({
    where: { key: SECTIONS_KEY },
    create: { key: SECTIONS_KEY, value },
    update: { value },
  });
}

export async function writeGamificationConfig(config: GamificationConfig): Promise<void> {
  const value = config as unknown as Prisma.InputJsonValue;
  await prisma.appSetting.upsert({
    where: { key: GAMIFICATION_KEY },
    create: { key: GAMIFICATION_KEY, value },
    update: { value },
  });
}

export async function writeBookingRulesConfig(config: BookingRulesConfig): Promise<void> {
  const value = config as unknown as Prisma.InputJsonValue;
  await prisma.appSetting.upsert({
    where: { key: BOOKING_RULES_KEY },
    create: { key: BOOKING_RULES_KEY, value },
    update: { value },
  });
}

export async function writeWorkflowSettings(config: WorkflowSettings): Promise<void> {
  const value = config as unknown as Prisma.InputJsonValue;
  await prisma.appSetting.upsert({
    where: { key: WORKFLOW_SETTINGS_KEY },
    create: { key: WORKFLOW_SETTINGS_KEY, value },
    update: { value },
  });
}

export async function writeCommissionRulesConfig(config: CommissionRulesConfig): Promise<void> {
  const value = config as unknown as Prisma.InputJsonValue;
  await prisma.appSetting.upsert({
    where: { key: COMMISSION_RULES_KEY },
    create: { key: COMMISSION_RULES_KEY, value },
    update: { value },
  });
}

export async function writeSssConfig(config: SssConfig): Promise<void> {
  const value = config as unknown as Prisma.InputJsonValue;
  await prisma.appSetting.upsert({
    where: { key: SSS_CONFIG_KEY },
    create: { key: SSS_CONFIG_KEY, value },
    update: { value },
  });
}

export async function writeDailyLogTargets(config: DailyLogTargets): Promise<void> {
  const value = config as unknown as Prisma.InputJsonValue;
  await prisma.appSetting.upsert({
    where: { key: DAILY_LOG_TARGETS_KEY },
    create: { key: DAILY_LOG_TARGETS_KEY, value },
    update: { value },
  });
}

export async function writeDailyLogEod(config: DailyLogEodConfig): Promise<void> {
  const value = config as unknown as Prisma.InputJsonValue;
  await prisma.appSetting.upsert({
    where: { key: DAILY_LOG_EOD_KEY },
    create: { key: DAILY_LOG_EOD_KEY, value },
    update: { value },
  });
}

export async function writeTutorFeeConfig(config: TutorFeeConfig): Promise<void> {
  const value = config as unknown as Prisma.InputJsonValue;
  await prisma.appSetting.upsert({
    where: { key: TUTOR_FEE_KEY },
    create: { key: TUTOR_FEE_KEY, value },
    update: { value },
  });
}

export async function writeBookOrderConfig(config: BookOrderConfig): Promise<void> {
  const value = config as unknown as Prisma.InputJsonValue;
  await prisma.appSetting.upsert({
    where: { key: BOOK_ORDER_KEY },
    create: { key: BOOK_ORDER_KEY, value },
    update: { value },
  });
}

export async function writePipelineConfig(config: PipelineConfig): Promise<void> {
  const value = config as unknown as Prisma.InputJsonValue;
  await prisma.appSetting.upsert({
    where: { key: PIPELINE_KEY },
    create: { key: PIPELINE_KEY, value },
    update: { value },
  });
}
