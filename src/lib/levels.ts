/**
 * Levels — isomorphic types + pure helpers for the configurable level/tier catalogue.
 *
 * NO prisma, NO server-only: the settings UI, finance UI and pipeline forms all import from here.
 * The DB-facing reader lives in `src/server/levels.ts`; the admin CRUD in `src/server/level-actions.ts`.
 *
 * Background: levels used to be the `ProgramLevel` Postgres enum. They are now rows in the `Level`
 * table so the founders can add German levels (C1, C2, …) and bundles from the dashboard. Each
 * level column stores a `Level.code` as text (e.g. "GN_A1"). See docs/CONFIGURABLE_LEVELS_PLAN.md.
 */

import type { LevelKind } from "@prisma/client";

/** Serializable projection of a `Level` row (BigInt costs → number paise). Safe to cross to a client component. */
export type LevelSummary = {
  code: string;
  label: string;
  kind: LevelKind;
  order: number;
  active: boolean;
  locked: boolean;
  incomeAccountCode: string;
  booksCostInrMinor: number | null;
  tutorCostInrMinor: number | null;
  bundleMembers: string[];
};

/** The admin panel also needs the row id (to target update/delete). */
export type AdminLevel = LevelSummary & { id: string };

export const LEVEL_KIND_LABELS: Record<LevelKind, string> = {
  COACHING_TIER: "Coaching tier",
  GERMAN_LEVEL: "German level",
  GERMAN_BUNDLE: "German bundle",
  OTHER: "Other",
};

/** Kinds the admin UI may create/edit. Coaching tiers + OTHER are seeded and locked. */
export const EDITABLE_LEVEL_KINDS: LevelKind[] = ["GERMAN_LEVEL", "GERMAN_BUNDLE"];

export const isGermanLevel = (l: { kind: LevelKind }) => l.kind === "GERMAN_LEVEL";
export const isBundle = (l: { kind: LevelKind }) => l.kind === "GERMAN_BUNDLE";

export type LevelOption = { value: string; label: string };

/** Active levels as dropdown options, optionally restricted to given kinds, in catalogue order. */
export function levelOptions(levels: LevelSummary[], kinds?: LevelKind[]): LevelOption[] {
  return levels
    .filter((l) => l.active && (!kinds || kinds.includes(l.kind)))
    .map((l) => ({ value: l.code, label: l.label }));
}

/** code → label map for tables/CSV. Falls back to the raw code for historical/unknown values. */
export function levelLabelMap(levels: LevelSummary[]): Record<string, string> {
  return Object.fromEntries(levels.map((l) => [l.code, l.label]));
}

/**
 * Normalise a user-typed level code to the stored shape: UPPER_SNAKE, A–Z/0–9/underscore only.
 * "gn c1" → "GN_C1". Returns "" when nothing usable is left, so callers can reject it.
 */
export function normalizeLevelCode(raw: string): string {
  return raw
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}
