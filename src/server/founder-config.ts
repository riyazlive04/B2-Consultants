import "server-only";
import { cache } from "react";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import {
  coerceBookingRulesConfig,
  coerceCommissionRulesConfig,
  coerceGamificationConfig,
  coerceSectionsConfig,
  coerceSssConfig,
  coerceWorkflowSettings,
  DEFAULT_BOOKING_RULES_CONFIG,
  DEFAULT_COMMISSION_RULES_CONFIG,
  DEFAULT_SSS_CONFIG,
  DEFAULT_WORKFLOW_SETTINGS,
  type BookingRulesConfig,
  type CommissionRulesConfig,
  type SssConfig,
  type WorkflowSettings,
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

/** SSS (sales) call config — read by the SSS slot engine and calendar. */
export const getSssConfig = cache(async (): Promise<SssConfig> => {
  const row = await prisma.appSetting.findUnique({ where: { key: SSS_CONFIG_KEY } });
  return row ? coerceSssConfig(row.value) : DEFAULT_SSS_CONFIG;
});

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
