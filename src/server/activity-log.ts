import "server-only";

import { prisma } from "@/lib/prisma";
import type { AppSession } from "@/lib/rbac";
import type { SectionKey } from "@/lib/sections";
import type { ActivityAction } from "@/lib/activity-actions";
import { sanitiseMeta } from "@/lib/activity-diff";

/**
 * The write half of the activity log — "who did what, when", for every action in the app.
 *
 * WHY THIS EXISTS SEPARATELY FROM appendAudit()
 * `appendAudit` (ledger-core) writes the hash-chained `AuditEntry`: tamper-evident, but it
 * takes a global advisory lock per append and the Ledger page verifies the whole chain on
 * load. That's the right price for money, and the wrong price for a row per dial — every
 * writer in the app would serialise on one lock, and the verify would grow without bound.
 * So finance writes to BOTH: the chain for proof, this for the founder's feed.
 *
 * TWO RULES THIS FILE ENFORCES, SO CALL SITES CAN'T GET THEM WRONG
 *
 * 1. The actor comes from the session, never from an argument. You pass the session you
 *    already got from your guard; there is no `actorId` parameter to pass the wrong id to.
 *    An action can't be logged in someone else's name because there's no way to say a name.
 *
 * 2. Logging NEVER breaks the action. A failure here is swallowed and reported to the
 *    server console. The alternative — a logging bug rolling back a telecaller's call log —
 *    is strictly worse than a missing row. For the same reason this runs OUTSIDE the
 *    caller's transaction: an activity row is a record that the attempt happened, and
 *    joining the transaction would erase exactly the failed attempts worth reviewing.
 *
 * WHERE TO CALL IT
 * After the write has succeeded, before `return { ok: true }`. Compose `summary` where the
 * human names are already loaded — the founder reads the sentence, never the id:
 *
 *   await logActivity(session, {
 *     action: "call.log",
 *     section: "pipeline",
 *     entityType: "CallLog",
 *     entityId: row.id,
 *     summary: `Logged a call with ${lead.name} — ${outcomeLabel(d.outcome)}`,
 *     meta: { outcome: d.outcome, leadId },
 *   });
 */

export type ActivityInput = {
  /**
   * Dotted verb: `<subject>.<verb>` or `<area>.<subject>.<verb>` — `call.log`,
   * `finance.income.create`. The trailing verb drives colour (activity-actions.ts), and the
   * founder's filter list is derived from the distinct values actually in the table, so a
   * new verb needs no registration anywhere. Match the existing vocabulary when one fits.
   */
  action: ActivityAction;
  /** Section key, so the founder can filter to "Pipeline" without knowing the verbs. */
  section: SectionKey;
  entityType: string;
  entityId: string;
  /** One sentence, names not ids. Shown verbatim in the feed and the table. */
  summary: string;
  meta?: Record<string, unknown>;
};

/** The session fields we need — structurally typed so tests don't have to fake a whole session. */
type Actor = Pick<AppSession, "role"> & { user: { id: string; name?: string | null; email?: string | null } };

export async function logActivity(session: Actor, input: ActivityInput): Promise<void> {
  try {
    await prisma.activityLog.create({
      data: {
        actorId: session.user.id,
        // Snapshot, not a join: `actor` is SetNull on delete, so a live lookup would blank
        // a departed person's whole history. This is also what was true AT THE TIME, which
        // is the honest answer once someone's name or role changes.
        actorName: session.user.name?.trim() || session.user.email || "Unknown user",
        actorRole: session.role,
        action: input.action,
        section: input.section,
        entityType: input.entityType,
        entityId: input.entityId,
        summary: input.summary,
        // Centrally sanitised: a BigInt amount anywhere in `meta` would make this write throw,
        // and the catch below would then lose the entry silently. See sanitiseMeta.
        meta: (input.meta === undefined ? undefined : sanitiseMeta(input.meta)) as never,
      },
    });
  } catch (err) {
    // Never surface to the caller — see rule 2 above.
    console.error("[activity-log] failed to record", input.action, err);
  }
}

/**
 * The same log, for someone who acted WITHOUT a staff session — a student signing an
 * agreement through a token link, say.
 *
 * Why this exists rather than just skipping those actions: they are real actions by real,
 * identified people, and "who signed, and when" is exactly the sort of question this page
 * is for. Why it's a separate function rather than an `actorId?` on `logActivity`: an
 * optional actor would let any ordinary call site quietly omit one, which is precisely the
 * hole `logActivity` closes by taking the session and nothing else. Making the sessionless
 * path a different function keeps it deliberate and greppable.
 *
 * `actorId` is null here — the signer has no user row — so the founder can't filter by them
 * in the "Who" dropdown; their name still shows on the row. Callers must have VERIFIED the
 * person first (a valid token, an accepted OTP). Never call this on the strength of an
 * unverified form field: an unauthenticated `name` input would let anyone write any name
 * into the founder's audit trail.
 */
export async function logPublicActivity(
  actor: { name: string; role: "STUDENT" | "PUBLIC" },
  input: ActivityInput,
): Promise<void> {
  try {
    await prisma.activityLog.create({
      data: {
        actorId: null,
        actorName: actor.name.trim() || "Unknown",
        actorRole: actor.role,
        action: input.action,
        section: input.section,
        entityType: input.entityType,
        entityId: input.entityId,
        summary: input.summary,
        // Centrally sanitised: a BigInt amount anywhere in `meta` would make this write throw,
        // and the catch below would then lose the entry silently. See sanitiseMeta.
        meta: (input.meta === undefined ? undefined : sanitiseMeta(input.meta)) as never,
      },
    });
  } catch (err) {
    console.error("[activity-log] failed to record public", input.action, err);
  }
}

/**
 * The engines' own writes — a reminder the cadence sent, a booking it auto-cancelled.
 *
 * Nobody pressed a button for these, and that is exactly why they get their own function
 * rather than borrowing the session of whoever last pressed "Run now". The engine runs on a
 * cron far more often than a human triggers it, so attributing its sends to that person
 * would put words in their mouth: "Ameen messaged 40 leads at 3am" is a lie the founder
 * would have no way to spot. Here the actor IS the engine, and the row says so.
 *
 * `actorId` is null (an engine has no user row); `actorRole` is SYSTEM, which the feed
 * renders as "Automation" and the Who filter offers as a real choice — see the `name:`
 * sentinel in activity-metrics.ts.
 */
export const SYSTEM_ACTORS = {
  reminders: "Reminder engine",
  automation: "Automation engine",
  bookings: "Booking engine",
  outreach: "Outreach engine",
  dailyLog: "Daily log engine",
} as const;

export type SystemActor = (typeof SYSTEM_ACTORS)[keyof typeof SYSTEM_ACTORS];

export async function logSystemActivity(actor: SystemActor, input: ActivityInput): Promise<void> {
  try {
    await prisma.activityLog.create({
      data: {
        actorId: null,
        actorName: actor,
        actorRole: "SYSTEM",
        action: input.action,
        section: input.section,
        entityType: input.entityType,
        entityId: input.entityId,
        summary: input.summary,
        meta: (input.meta === undefined ? undefined : sanitiseMeta(input.meta)) as never,
      },
    });
  } catch (err) {
    console.error("[activity-log] failed to record system", input.action, err);
  }
}

// `diffFields` is pure, so it lives in lib/ where a test can reach it without dragging in
// prisma and `server-only`. Re-exported here so a call site imports one module.
export { diffFields } from "@/lib/activity-diff";
export type { ActivityAction };
