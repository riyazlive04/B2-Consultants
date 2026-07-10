import "server-only";
import { cache } from "react";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { coerceGamificationConfig, coerceSectionsConfig } from "@/lib/config-schema";
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
