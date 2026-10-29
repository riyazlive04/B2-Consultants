import "server-only";
import { CAPABILITIES, hasCapability } from "@/lib/capabilities";
import { observabilityRuntime, recentErrors, scrubContext } from "@/lib/observability";
import { IST_ZONE } from "@/lib/dates";
import { formatDateTimeInZone } from "@/lib/format";
import type { AppSession } from "@/lib/rbac";
import { enginesOff, type ScreenEngineKey } from "./engine-status";
import { deliveryHealth } from "./delivery-health";
import { getResolvedSections } from "./founder-config";

/**
 * WHAT THE APP WAS DOING WHEN SOMEBODY REPORTED A PROBLEM.
 *
 * ── Why this file is the point of the whole module ──────────────────────────────────────────
 * This app ships almost every engine OFF, and live has most of them at that default. So the
 * single most likely report in any given week is *"this section does nothing"* about a section
 * that is working exactly as configured. Answering that by hand costs a conversation per report,
 * forever; answering it here costs one cached read and happens before a human looks.
 *
 * The same applies one rung down: "I can't see X" is unanswerable without the reporter's role and
 * grants, and "the WhatsApp never arrived" is unanswerable without the delivery verdict. All
 * three are facts the app already knows and has never once written down next to the complaint.
 *
 * ── Captured on the SERVER, never accepted from the client ──────────────────────────────────
 * A browser cannot be trusted about its own permissions and does not know what is armed. Taking
 * `role` from a POST body would let anyone file a report claiming to be an admin, and taking the
 * arming state from the client would mean trusting the thing that is complaining.
 *
 * ── Cheap by construction ──────────────────────────────────────────────────────────────────
 * Every read here is one this codebase already performs on some screen. `enginesOff` is React-
 * `cache`d over `founder-config`, whose `readSetting` is `unstable_cache`d with a tag, so a warm
 * request pays nothing; `recentErrors()` is an in-process ring; the capability list is pure. Only
 * `deliveryHealth()` is a real query, and it runs only for the screens where a send is the point.
 */

/**
 * WHICH ENGINE BELONGS TO WHICH SCREEN.
 *
 * Mirrors the `enginesOff([...])` calls the eight feature pages already make, so a report from
 * `/payments` carries the same dunning verdict the page itself shows.
 *
 * ── Why a second copy, and what stops it drifting ───────────────────────────────────────────
 * The pages hold this knowledge inline, one `enginesOff` call each, and a server action cannot
 * read a page's local argument list. So this map restates it - and
 * `src/server/__tests__/improvement-context-engines.test.ts` reads those eight page files as text and
 * fails if any page names an engine this map does not. That is the same device
 * `cron-stale-thresholds.test.ts` uses to keep the crontab and the staleness table in step, and
 * it is the only reason to believe a restated list.
 *
 * Sections absent from here report no engine, which is correct: most screens have none.
 */
export const SECTION_ENGINES: Partial<Record<string, readonly ScreenEngineKey[]>> = {
  agreements: ["agreementReminders"],
  attendance: ["classReminders"],
  bookings: ["confirmLoop"],
  finance: ["commissionAccrual", "tutorFeeAccrual", "invoicePosting"],
  payments: ["dunning"],
  pipeline: ["speedToLead", "autoCreateOpportunity"],
  students: ["studentWelcome"],
  whatsapp: ["whatsapp", "studentWelcome", "classReminders", "confirmLoop"],
};

/** Engines whose OFF state means "a message did not go out", so the delivery verdict is relevant. */
const SENDING_ENGINES: readonly ScreenEngineKey[] = [
  "whatsapp",
  "email",
  "studentWelcome",
  "classReminders",
  "confirmLoop",
  "dunning",
  "agreementReminders",
];

export type ImprovementContext = {
  capturedAt: string;
  /** Readable IST, because every cron in this app is scheduled in it. */
  ist: string;
  environment: string;
  release: string | null;
  sentryArmed: boolean;
  role: string;
  /** The section as the founder has it labelled, which is what the reporter saw on the rail. */
  sectionLabel: string | null;
  /** Per-user section overrides, if any. Answers "why could they open this?". */
  sectionOverrides: Record<string, boolean> | null;
  /** Capability keys this person actually holds right now. */
  capabilities: string[];
  /**
   * The engines behind this screen that are OFF. EMPTY IS THE INTERESTING CASE: it means the
   * screen really should have been doing something.
   */
  enginesOff: { key: string; name: string; consequence: string; where: string }[];
  /** Only populated for screens where a send is the point. */
  delivery?: {
    job: string;
    channel: string;
    state: string;
    sent24h: number;
    failed24h: number;
    skippedConfig24h: number;
    silent: boolean;
    lastError: string | null;
  }[];
  /** Server errors this process has seen recently. Per-process and lost on restart. */
  recentErrors: { at: string; message: string; where: string | null }[];
  userAgent: string | null;
};

/**
 * Build the context block for one report.
 *
 * NEVER THROWS. A failure to describe the app's state must not stop someone reporting that the
 * app is broken - which is precisely when these reads are most likely to fail. Each group is
 * guarded separately, so a dead delivery query still leaves the arming verdict intact, and the
 * reason the group is missing is recorded in its place rather than silently omitted.
 */
export async function captureImprovementContext(
  session: AppSession,
  input: { sectionKey?: string | null; userAgent?: string | null },
): Promise<ImprovementContext> {
  const runtime = observabilityRuntime();
  const engineKeys = (input.sectionKey && SECTION_ENGINES[input.sectionKey]) || [];

  const context: ImprovementContext = {
    capturedAt: new Date().toISOString(),
    ist: formatDateTimeInZone(new Date(), IST_ZONE),
    environment: runtime.environment,
    release: runtime.release,
    sentryArmed: runtime.armed,
    role: session.role,
    sectionLabel: null,
    sectionOverrides: (session.overrides as Record<string, boolean> | null) ?? null,
    capabilities: CAPABILITIES.map((c) => c.key).filter((key) =>
      hasCapability(session.role, session.capabilities, key),
    ),
    enginesOff: [],
    recentErrors: [],
    userAgent: input.userAgent?.slice(0, 300) ?? null,
  };

  if (input.sectionKey) {
    try {
      const sections = await getResolvedSections();
      context.sectionLabel = sections.find((s) => s.key === input.sectionKey)?.label ?? null;
    } catch {
      /* a label is a nicety; the key is already on the row */
    }
  }

  if (engineKeys.length) {
    try {
      context.enginesOff = (await enginesOff(engineKeys)).map((e) => ({
        key: e.key,
        name: e.name,
        consequence: e.consequence,
        where: e.where,
      }));
    } catch {
      context.enginesOff = [];
    }
  }

  if (engineKeys.some((k) => SENDING_ENGINES.includes(k))) {
    try {
      context.delivery = (await deliveryHealth()).map((r) => ({
        job: r.job,
        channel: r.channel,
        state: r.state,
        sent24h: r.sent24h,
        failed24h: r.failed24h,
        skippedConfig24h: r.skippedConfig24h,
        silent: r.silent,
        lastError: r.lastError,
      }));
    } catch {
      /* leave it absent rather than claiming a healthy channel */
    }
  }

  try {
    // Five is enough to recognise a pattern and short enough to read in the detail panel.
    context.recentErrors = recentErrors()
      .slice(0, 5)
      .map((e) => ({ at: e.at, message: e.message, where: e.where }));
  } catch {
    context.recentErrors = [];
  }

  /**
   * One scrub over the whole block before it is stored.
   *
   * `scrubContext` is the function the error reporter already uses, and it exists because a
   * Prisma connection failure embeds `postgres://user:password@host/db` in its message - which
   * is exactly the sort of message `recentErrors()` and `lastError` carry. Re-deriving scrubbing
   * for this module is how the next leak would happen, so this module does not have its own.
   */
  return scrubContext(context) as ImprovementContext;
}

/** The running build, for `Improvement.appVersion`. Same source the health endpoint reports. */
export function appVersion(): string | null {
  return (
    process.env.SENTRY_RELEASE?.trim() ||
    process.env.GIT_SHA?.trim() ||
    process.env.NEXT_PUBLIC_BUILD_SHA?.trim() ||
    null
  );
}
