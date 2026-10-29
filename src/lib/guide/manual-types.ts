import type { AppRole, SectionKey } from "../sections";
import type { EngineKey } from "../engines";

/**
 * THE APP MANUAL - the deep half of the App Guide.
 *
 * `guide-content.ts` answers "what is this screen for, in thirty seconds". This answers the three
 * questions people come back with once they use it: how do I use each part of it, WHY does it
 * behave the way it does, and if the rule is wrong, WHERE do I change or reset it.
 *
 * One `GuideManual` per sidebar section, one `GuideFeature` per tab / sub-area of that screen.
 */

/**
 * Founder Console deep links. ids are stable slugs, so reordering a tab never breaks a link.
 *
 * THE CONSOLE PAGE READS ITS TAB IDS FROM HERE, so a guide link and the panel it opens cannot
 * disagree: rename a slug and both move together; drop a panel and every guide entry still
 * pointing at it fails to typecheck.
 */
export const CONSOLE_AREA_LABELS = {
  access: "Access",
  money: "Money",
  sales: "Sales ops",
  delivery: "Delivery & team",
  system: "System",
} as const;

export const CONSOLE_PANELS = {
  access: ["sections", "access-matrix", "per-person"],
  money: [
    "commission", "instalment-plans", "payment-types", "expense-categories",
    "invoicing", "cash-targets", "tutor-fee", "tutor-fees",
  ],
  sales: [
    "qualification", "call-distribution", "availability", "zoom",
    "confirm-loop", "operations", "lead-webhook",
  ],
  delivery: ["agreements", "delivery-defaults", "daily-targets", "gamification", "goals", "rewards"],
  system: ["not-armed", "alerts", "leaderboard", "student-lifecycle", "improvements", "maintenance"],
} as const;
export type ConsoleArea = keyof typeof CONSOLE_PANELS;
export type ConsolePanel<A extends ConsoleArea = ConsoleArea> = (typeof CONSOLE_PANELS)[A][number];

/** `/console?area=money&panel=payment-types` - opens the exact panel. */
export function consoleHref<A extends ConsoleArea>(area: A, panel: ConsolePanel<A>): string {
  return `/console?area=${area}&panel=${panel}`;
}

/** WHERE A RULE IS CHANGED - the "fix it here" half of every feature. */
export type GuideControl = {
  /** The rule, in plain words: "Commission rate when one person ran both calls". */
  setting: string;
  /** Click path as breadcrumb chips: ["Sidebar", "Admin", "Founder Console", "Money", "Commission"]. */
  where: string[];
  /** Deep link. Console panels MUST use consoleHref(area, panel). */
  href: string;
  /** Roles that can change it by default. */
  who: AppRole[];
  /** The shipped default, when there is one ("5%", "Off", "9:00 PM"). */
  default?: string;
  /**
   * What changing it does to what ALREADY exists - the question that matters before you touch it.
   * "Forward only: payments already recorded keep the rate they were split at." / "Re-computes
   * every open receivable on next load."
   */
  effect: string;
  /** How to put it back, if that is not obvious from `default`. */
  reset?: string;
};

/**
 * A SCREENSHOT TO CAPTURE - not a picture yet, a recipe for one.
 *
 * `scripts/capture-guide-shots.ts` opens `route` on the LOCAL seeded app, finds `highlight.text`
 * on the screen, measures its box in percent and writes both the PNG and the box. So nobody
 * measures a coordinate by hand, and a re-capture after a redesign moves the box with the button.
 */
export type GuideShotSpec = {
  /** File name under public/guide/manual/, `<section>-<feature-id>.png`. */
  file: string;
  /** Route to open, including the query that selects the tab: "/payments?tab=3". */
  route: string;
  /** What the reader is looking at, one sentence. */
  caption: string;
  /** Visible text of the ONE thing to box (a button, tab or heading) and the label on the box. */
  highlight?: { text: string; label: string };
};

export type GuideFeature = {
  /** URL anchor, kebab-case, unique within its section. */
  id: string;
  /** The tab / sub-area name exactly as the screen labels it: "Subscriptions". */
  name: string;
  /** Click path to this part of the screen. */
  where: string[];
  /** Deep link to the exact tab when the page supports one (`?tab=N`). */
  href?: string;
  /** One sentence: what it is for. */
  what: string;
  /** HOW TO USE IT - numbered, imperative steps. 2-7 items. */
  use: string[];
  /**
   * THE LOGIC BEHIND IT - how numbers are calculated, what triggers what, what it reads from and
   * writes to, what is derived vs stored, what is automatic vs manual. 2-8 items. Every item is
   * grounded in the code.
   */
  logic: string[];
  /** WHERE TO CHANGE OR RESET THE LOGIC. Omit only when nothing about this feature is configurable. */
  controls?: GuideControl[];
  /** Traps that cost people time. */
  watchOut?: string[];
  /** The screenshot for this part of the screen. Every feature with its own tab or screen has one. */
  shot?: GuideShotSpec;
};

export type GuideManual = {
  section: SectionKey;
  /** Two or three sentences: what the section is, who uses it, how it fits the business. */
  overview: string;
  /** Engines (lib/engines.ts) whose OFF state stops this section doing its automatic work.
   *  The page shows each one's LIVE on/off state next to the manual. */
  engines?: EngineKey[];
  features: GuideFeature[];
  /** Sections this one reads from or feeds, and why. */
  related?: { section: SectionKey; why: string }[];
  faq?: { q: string; a: string }[];
};

/** How a role is named to a reader - the same words the top bar uses for the signed-in person. */
export const ROLE_NAMES: Record<AppRole, string> = {
  ADMIN: "Admin (founder)",
  HEAD: "Head coach",
  USER: "Telecaller",
  STUDENT: "Student",
  TUTOR: "Tutor",
  COACH: "Coach",
};
