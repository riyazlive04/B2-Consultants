import "server-only";
import { cache } from "react";
import { unstable_cache } from "next/cache";
import type { LevelKind } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import type { AdminLevel, LevelSummary } from "@/lib/levels";

/**
 * Server-only reader for the configurable level catalogue (`Level` table). The pure
 * helpers/types live in `src/lib/levels.ts`.
 */

/** Tag the level cache is stored under — busted by every level mutation (level-actions.ts). */
export const LEVELS_CACHE_TAG = "levels";

const readLevels = async (): Promise<LevelSummary[]> => {
  const rows = await prisma.level.findMany({
    orderBy: [{ kind: "asc" }, { order: "asc" }, { label: "asc" }],
  });
  return rows.map((r) => ({
    code: r.code,
    label: r.label,
    kind: r.kind,
    order: r.order,
    active: r.active,
    locked: r.locked,
    incomeAccountCode: r.incomeAccountCode,
    booksCostInrMinor: r.booksCostInrMinor === null ? null : Number(r.booksCostInrMinor),
    tutorCostInrMinor: r.tutorCostInrMinor === null ? null : Number(r.tutorCostInrMinor),
    bundleMembers: r.bundleMembers,
  }));
};

/**
 * All levels, catalogue order (kind, then order, then label).
 *
 * Two cache layers: `unstable_cache` keeps the catalogue across requests (it changes only
 * when a founder edits levels — otherwise every page re-paid a 200ms round-trip for a list
 * that's effectively static), busted immediately via `revalidateTag(LEVELS_CACHE_TAG)` on
 * any level mutation and re-validated after 5 min as a backstop; React `cache()` dedupes it
 * within a single request so a page and its helpers still share one lookup.
 */
export const getLevels = cache(
  unstable_cache(readLevels, ["levels-catalogue"], { revalidate: 300, tags: [LEVELS_CACHE_TAG] }),
);

export async function getActiveLevels(): Promise<LevelSummary[]> {
  return (await getLevels()).filter((l) => l.active);
}

/** All levels WITH their row id — for the admin CRUD panel, which targets update/delete by id. */
export async function getAdminLevels(): Promise<AdminLevel[]> {
  const rows = await prisma.level.findMany({
    orderBy: [{ kind: "asc" }, { order: "asc" }, { label: "asc" }],
  });
  return rows.map((r) => ({
    id: r.id,
    code: r.code,
    label: r.label,
    kind: r.kind,
    order: r.order,
    active: r.active,
    locked: r.locked,
    incomeAccountCode: r.incomeAccountCode,
    booksCostInrMinor: r.booksCostInrMinor === null ? null : Number(r.booksCostInrMinor),
    tutorCostInrMinor: r.tutorCostInrMinor === null ? null : Number(r.tutorCostInrMinor),
    bundleMembers: r.bundleMembers,
  }));
}

/** code → label, for the display maps client tables need. */
export async function levelLabels(): Promise<Record<string, string>> {
  return Object.fromEntries((await getLevels()).map((l) => [l.code, l.label]));
}

/**
 * code → GL income account. The authority for finance posting: it honours a per-level
 * `incomeAccountCode` override, where the pure prefix fallback in chart-of-accounts cannot.
 */
export async function levelIncomeAccounts(): Promise<Map<string, string>> {
  return new Map((await getLevels()).map((l) => [l.code, l.incomeAccountCode]));
}

/** code → kind, so finance metrics can bucket by kind rather than a "GN_" name-prefix guess. */
export async function levelKinds(): Promise<Map<string, LevelKind>> {
  return new Map((await getLevels()).map((l) => [l.code, l.kind]));
}

/**
 * Is `code` an active level? Optionally restrict to certain kinds (e.g. a batch is a single
 * GERMAN_LEVEL, never a bundle). Replaces the duplicated `z.enum([...])` level validators.
 */
export async function isKnownLevel(code: string, kinds?: LevelKind[]): Promise<boolean> {
  const l = (await getLevels()).find((x) => x.code === code && x.active);
  return !!l && (!kinds || kinds.includes(l.kind));
}
