import type { SectionKey } from "../sections";
import type { GuideControl, GuideFeature, GuideManual } from "./manual-types";
import { MANUAL_FINANCE } from "./manual-finance";
import { MANUAL_PAYMENTS } from "./manual-payments";
import { MANUAL_SALES } from "./manual-sales";
import { MANUAL_MARKETING } from "./manual-marketing";
import { MANUAL_STUDENTS } from "./manual-students";
import { MANUAL_CLASSROOM } from "./manual-classroom";
import { MANUAL_CONSOLE } from "./manual-console";
import { MANUAL_ADMIN } from "./manual-admin";

/**
 * Every section's manual, in one list. Split across files by sidebar group only so no single file
 * is thousands of lines; nothing reads the files individually.
 *
 * `sections-structure.test.ts` holds this to the catalogue: every section has exactly one manual,
 * every Console link names a real panel, and no visible string carries a long dash.
 */
export const MANUALS: GuideManual[] = [
  ...MANUAL_FINANCE,
  ...MANUAL_PAYMENTS,
  ...MANUAL_SALES,
  ...MANUAL_MARKETING,
  ...MANUAL_STUDENTS,
  ...MANUAL_CLASSROOM,
  ...MANUAL_CONSOLE,
  ...MANUAL_ADMIN,
];

const BY_SECTION = new Map(MANUALS.map((m) => [m.section, m]));

export function manualFor(section: SectionKey): GuideManual | undefined {
  return BY_SECTION.get(section);
}

/** One configurable rule, and every part of the app that answers to it. */
export type RuleRow = GuideControl & {
  usedBy: { section: SectionKey; feature: GuideFeature["name"]; featureId: string }[];
};

/**
 * THE RULES MAP - every "change or reset this rule" in every manual, folded by destination.
 *
 * Derived, never written by hand: a second hand-kept list of settings would drift from the
 * manuals the first time somebody added a control to one and not the other. Two manuals that
 * point at the same setting on the same screen collapse into one row with both listed under
 * "used by", which is the point of the page - it answers "if I change this, what moves?".
 */
export function rulesMap(manuals: GuideManual[] = MANUALS): { destination: string; href: string; rows: RuleRow[] }[] {
  const groups = new Map<string, { destination: string; href: string; rows: Map<string, RuleRow> }>();
  for (const m of manuals) {
    for (const f of m.features) {
      for (const c of f.controls ?? []) {
        // Group by the screen the rule lives on: the path minus nothing - Console panels already
        // end in the panel name, and an on-screen setting ends in its tab.
        const destination = c.where.filter((p) => p !== "Sidebar").join(" › ");
        const g = groups.get(destination) ?? { destination, href: c.href, rows: new Map() };
        groups.set(destination, g);
        const key = c.setting.trim().toLowerCase();
        const row: RuleRow = g.rows.get(key) ?? { ...c, usedBy: [] };
        if (!row.usedBy.some((u) => u.section === m.section && u.featureId === f.id)) {
          row.usedBy.push({ section: m.section, feature: f.name, featureId: f.id });
        }
        g.rows.set(key, row);
      }
    }
  }
  return [...groups.values()]
    .map((g) => ({ destination: g.destination, href: g.href, rows: [...g.rows.values()] }))
    .sort((a, b) => a.destination.localeCompare(b.destination));
}
