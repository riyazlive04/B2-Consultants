import "server-only";
import { prisma } from "@/lib/prisma";
import { ACTIVE } from "@/lib/soft-delete";
import {
  callbackVerdict,
  summariseCalls,
  CHASEABLE_STAGES,
  type CallbackChaseConfig,
} from "@/lib/callback-chase";
import { getCallDistribution } from "./founder-config";
import { readOutreachConfig } from "./outreach";
import { advanceLeadStage } from "./lead-stage-auto";
import { sendWhatsApp } from "./whatsapp";
import { logSystemActivity, SYSTEM_ACTORS } from "./activity-log";

/**
 * The end of the call-back chase (founder, 27/08/2026):
 *
 *   "Finally if the lead didnt book the meeting and telecaller called after each notification,
 *    then move the opportunity stage to cancelled/unqualified. At this stage, we also need to
 *    send WhatsApp message... system should automatically send WhatsApp message."
 *
 * The desk half of the loop lives in `l1-desk-metrics.ts`; the rules both halves share are pure,
 * in `lib/callback-chase.ts`. This file is the give-up: it finds prospects who were called the
 * agreed number of times, never booked, and whose last rest window has closed, tells them so, and
 * files the card under Cancelled/Unqualified.
 *
 * ── Why this needs a scheduler and cannot live on the desk ───────────────────────
 * The trigger is the PASSAGE OF TIME, not an action. Nobody logs "the prospect still hasn't
 * booked four hours later", so if the close-out only ran when a telecaller happened to open My
 * Desk, a prospect's file would close whenever somebody next logged in - or never, on a day off.
 * It is ticked by /api/cron/outreach alongside the SOP ladder, which is the engine it belongs
 * beside.
 *
 * ── The sweep always runs; the two Console toggles govern CONSEQUENCES, not the chase ──
 * `closeWhenExhausted` decides whether the card moves, `notifyOnClose` whether a message goes
 * out. Neither can stop a chase that has run out from being RETIRED, and that is deliberate: the
 * cap is what ends a chase, so if both toggles could switch the retirement off, a prospect who
 * had used every call-back would sit forever in a state the desk counts as exhausted, does not
 * list, and nothing ever clears - visible to the team only as a number that goes up. A founder
 * who wants a prospect chased indefinitely raises `maxCallbacks`; that is the dial for it.
 *
 * ── Three guards, and what each one is actually for ──────────────────────────────
 *
 *  1. A LEAD MUST HAVE CALLS LOGGED IN THIS SYSTEM (`callLogs: { some: {} }`).
 *     Structural, not configurable, and the important one. Synamate's book of business is
 *     migrated at go-live (scripts/reset-prelaunch-data.ts), and an imported lead arrives with an
 *     opt-in journey, no booking, and no call history - which is the exact shape this sweep acts
 *     on. Without this line, the first tick after an import would close and message thousands of
 *     people the team had never spoken to. With it, a lead can only be given up on by an engine
 *     that can point at the calls it is giving up after.
 *
 *  2. THE JOURNEY IS MARKED IGNORED ON THE WAY OUT.
 *     This is the idempotency key, and it is the SOP's own idiom for the same event (Step 9).
 *     `Lead.stage` cannot serve: DISCO_NOT_BOOKED is a stage a setter picks by hand, so keying on
 *     it would either re-close the same lead every tick or silently exclude leads a human had
 *     parked there. The phase is written whether or not the message sent and whether or not the
 *     stage moved - a chase that has run out has run out, and a retry loop that re-messages
 *     someone every minute because WATI is down is far worse than a message that did not arrive.
 *
 *  3. A PER-RUN CAP.
 *     Bounds a first run over a backlog, and bounds the damage of a rule someone mis-typed in the
 *     Console. What it drops is not lost - the next tick takes the next batch.
 */

/**
 * Most leads one tick may close.
 *
 * Sized against reality rather than round: the chase only reaches a prospect the team actually
 * spoke to, and the SOP's own per-run cap is in the same order. If a run ever hits this ceiling
 * it is reported in the result, so a genuine backlog is visible rather than inferred from the
 * sweep taking several ticks.
 */
const MAX_PER_RUN = 100;

export type CallbackChaseRun = {
  ranAt: string;
  rule: { gapHours: number; maxCallbacks: number };
  /** Candidates examined - spoken to, unbooked, in a chaseable stage. */
  scanned: number;
  /** Chases that had genuinely run out. */
  exhausted: number;
  /** Cards moved to Cancelled/Unqualified. */
  closed: number;
  /** WhatsApp messages that actually left the building. */
  notified: number;
  /** Sends that were skipped or refused - each one has a written reason on the message row. */
  notifySkipped: number;
  /** True when the per-run cap bit, so a backlog is visible rather than silently drip-fed. */
  capped: boolean;
  notes: string[];
};

function emptyRun(cfg: CallbackChaseConfig): CallbackChaseRun {
  return {
    ranAt: new Date().toISOString(),
    rule: { gapHours: cfg.gapHours, maxCallbacks: cfg.maxCallbacks },
    scanned: 0,
    exhausted: 0,
    closed: 0,
    notified: 0,
    notifySkipped: 0,
    capped: false,
    notes: [],
  };
}

/**
 * Close out every chase that has run out.
 *
 * Fail-soft per lead: one prospect whose WhatsApp number is unparseable, or whose card someone
 * archived mid-run, must not stop the other ninety-nine from being filed. Each failure is noted
 * in the result, which the cron heartbeat carries.
 */
export async function runCallbackChase(): Promise<CallbackChaseRun> {
  const { callbackChase: cfg } = await getCallDistribution();
  const run = emptyRun(cfg);
  const now = new Date();

  /**
   * The candidate set, narrowed in the database rather than in JS.
   *
   * Every clause is a fact about whether a chase can even be running:
   *   · not archived, in a chaseable stage - see CHASEABLE_STAGES
   *   · has an opt-in journey that is neither booked nor already given up on
   *   · has no booking of its own either. `journey.bookingId` is set by the SOP's cross-check,
   *     which matches on normalised email/phone and can miss - so a prospect who booked under a
   *     different number would otherwise be told we never heard from them.
   *   · has been called at least once IN THIS SYSTEM (guard 1 above)
   */
  const candidates = await prisma.lead.findMany({
    where: {
      ...ACTIVE,
      stage: { in: [...CHASEABLE_STAGES] },
      outreachJourney: {
        is: {
          bookingId: null,
          phase: { notIn: ["IGNORED", "CANCELLED", "CLOSED_NOT_HQ", "COMPLETED"] },
        },
      },
      bookings: { none: {} },
      callLogs: { some: {} },
    },
    select: {
      id: true,
      name: true,
      phone: true,
      stage: true,
      assignedTo: { select: { name: true } },
      outreachJourney: { select: { id: true } },
      callLogs: { select: { calledAt: true, outcome: true } },
    },
    // Oldest first, so a backlog drains in the order the prospects were left waiting rather than
    // in whatever order the database happens to return.
    orderBy: { createdAt: "asc" },
    take: MAX_PER_RUN * 5,
  });

  run.scanned = candidates.length;

  // Resolved once, not per lead: it is one config read backing a template variable.
  const defaultSender = await readOutreachConfig()
    .then((c) => c.defaultSpecialistName)
    .catch(() => "B2 Consultants");

  for (const lead of candidates) {
    if (run.closed + run.notified >= MAX_PER_RUN * 2 || run.exhausted >= MAX_PER_RUN) {
      run.capped = true;
      break;
    }

    const verdict = callbackVerdict(summariseCalls(lead.callLogs), cfg, now);
    if (verdict.state !== "EXHAUSTED") continue;
    run.exhausted++;

    try {
      /**
       * The message goes FIRST, while the lead is still in an open stage.
       *
       * Order matters for one reason: `sendWhatsApp` re-reads the lead to apply the domain gate
       * and the opt-out list, and a courtesy note explaining that we are closing someone's file
       * reads very differently after the file is closed. If the send is skipped - no template
       * bound, opted out, no valid number - the row it writes says exactly why, and the close-out
       * below still happens. The chase is over either way.
       */
      if (cfg.notifyOnClose && lead.phone) {
        const firstName = (lead.name ?? "").trim().split(/\s+/)[0] || lead.name;
        const res = await sendWhatsApp({
          /**
           * The founder's choice (27/08/2026): reuse the SOP Step 7b template rather than wait on
           * a dedicated one clearing Meta review, so the loop works the day it ships.
           *
           * KNOWN TRADE, recorded here so nobody rediscovers it as a bug: the wording is a
           * booking nudge, not a we-are-closing-your-file notice, and these sends land in the
           * SOP_FOLLOWUP_2 column of the WhatsApp report mixed in with the SOP ladder's own. When
           * a dedicated template is approved, add a kind for it in lib/whatsapp.ts and change
           * this one line - `sendWhatsApp` already skips an unbound kind with a written reason
           * rather than falling back to another template.
           */
          kind: "SOP_FOLLOWUP_2",
          to: lead.phone,
          leadId: lead.id,
          vars: { name: firstName, sender: lead.assignedTo?.name ?? defaultSender },
          bodySummary: `Call-back chase exhausted after ${verdict.callbacksMade} call-back${verdict.callbacksMade === 1 ? "" : "s"} - final follow-up`,
          // No human pressed send, so a system that is switched off stays quiet rather than
          // writing a SKIPPED row per lead per tick. Same convention as the SOP auto-sender.
          logSkips: false,
        });
        if (res.sent) run.notified++;
        else {
          run.notifySkipped++;
          if (res.error) run.notes.push(`${lead.name}: ${res.error}`);
        }
      }

      /**
       * The card moves to Cancelled/Unqualified.
       *
       * `DISCO_NOT_BOOKED` is the LIFECYCLE stage; the board files it into the "Cancelled/
       * Unqualified" column and marks the opportunity LOST (lib/pipeline-stages.ts,
       * lib/opportunity-status.ts). Going through `advanceLeadStage` rather than writing the
       * column directly is what gets the append-only stage-history row and the opportunity
       * write-through - without both, the move is invisible to the funnel and ageing reports and
       * the board drifts out of step with the lead.
       *
       * The `from` whitelist is the chaseable set: a lead someone moved on while this tick was
       * running is left exactly where they put it.
       */
      if (cfg.closeWhenExhausted) {
        const moved = await advanceLeadStage(lead.id, "DISCO_NOT_BOOKED", CHASEABLE_STAGES);
        if (moved) run.closed++;
      }

      /**
       * Mark the journey dormant LAST, and unconditionally.
       *
       * Last, so a crash mid-lead leaves the chase live and retryable rather than silently
       * swallowing a prospect. Unconditional, because this is the idempotency key: without it the
       * next tick finds the same lead exhausted and messages them again.
       */
      if (lead.outreachJourney) {
        const journeyId = lead.outreachJourney.id;
        await prisma.outreachJourney.update({
          where: { id: journeyId },
          data: { phase: "IGNORED", ignoredAt: now },
        });
        /**
         * Retire whatever the SOP had still waiting on this prospect.
         *
         * `runDueOutreach` skips IGNORED journeys, so once the phase is written the ladder will
         * never look at this journey again - and a DUE step it left behind would be stranded
         * rather than resolved. That is not cosmetic: the L1 desk builds its "Messaged, didn't
         * book - call now" bucket straight from DUE CALL steps, scoped only by the lead not being
         * WON or LOST. A closed-out lead sits at DISCO_NOT_BOOKED, which is neither, so a leftover
         * step would keep asking a telecaller to ring someone the system had already given up on,
         * with no way to clear it.
         *
         * SUPERSEDED, not SKIPPED: nobody chose to pass this step over, it was overtaken by
         * events. That is the same word the planner uses when a booking lands mid-chase, and the
         * step log is read as an audit trail of what happened to each step, not just its state.
         */
        await prisma.outreachStepLog.updateMany({
          where: { journeyId, status: "DUE" },
          data: { status: "SUPERSEDED", actedAt: now },
        });
      }

      await logSystemActivity(SYSTEM_ACTORS.outreach, {
        action: "outreach.journey.ignore",
        section: "pipeline",
        entityType: "Lead",
        entityId: lead.id,
        summary:
          `Gave up chasing ${lead.name} - spoken to and called back ${verdict.callbacksMade} time` +
          `${verdict.callbacksMade === 1 ? "" : "s"} without a booking, so the card moved to Cancelled/Unqualified`,
        meta: {
          reason: "callback-chase-exhausted",
          callbacksMade: verdict.callbacksMade,
          maxCallbacks: cfg.maxCallbacks,
          gapHours: cfg.gapHours,
          lastCallAt: verdict.lastCallAt?.toISOString() ?? null,
          notified: cfg.notifyOnClose,
          closed: cfg.closeWhenExhausted,
        },
      });
    } catch (e) {
      // One prospect's failure must not strand the rest of the batch. The journey is untouched in
      // this path, so the next tick retries this lead and only this lead.
      run.notes.push(`${lead.name}: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  return run;
}

/**
 * How many chases would close on the next tick, without closing any.
 *
 * Read-only twin of the sweep, for the Console's "N leads would be closed by this rule" line.
 * Sharing `callbackVerdict` with the sweep is the point: a preview computed a different way is a
 * preview that can disagree with what actually runs, which is worse than no preview.
 */
export async function previewCallbackChase(): Promise<{ exhausted: number; scanned: number }> {
  const { callbackChase: cfg } = await getCallDistribution();
  const now = new Date();
  const candidates = await prisma.lead.findMany({
    where: {
      ...ACTIVE,
      stage: { in: [...CHASEABLE_STAGES] },
      outreachJourney: {
        is: {
          bookingId: null,
          phase: { notIn: ["IGNORED", "CANCELLED", "CLOSED_NOT_HQ", "COMPLETED"] },
        },
      },
      bookings: { none: {} },
      callLogs: { some: {} },
    },
    select: { id: true, callLogs: { select: { calledAt: true, outcome: true } } },
    take: 2000,
  });
  const exhausted = candidates.filter(
    (l) => callbackVerdict(summariseCalls(l.callLogs), cfg, now).state === "EXHAUSTED",
  ).length;
  return { exhausted, scanned: candidates.length };
}
