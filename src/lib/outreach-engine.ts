/**
 * Outreach SOP - the ladder, as pure functions.
 *
 * Deliberately has NO prisma, NO clock and NO IO: every function takes `now` as an argument and
 * returns a decision. That is what makes the SOP's timing rules testable at their boundaries
 * (T−36h−1min / T−36h / T−36h+1min) without a database or a fake timer, which is exactly what the
 * QA checklist's Step 2 asks for. `src/server/outreach.ts` is the thin DB shell around this.
 *
 * The one rule worth internalising: a step is MATERIALISED when its precondition becomes true, and
 * is ACTIONABLE when `now >= dueAt`. Those are different moments. Materialising early is how the
 * queue can show "Disco confirmation 1 - in 4h" instead of surprising the specialist with it.
 */

import type { OutreachPhase, OutreachStep, OutreachStepStatus, QualifiedVerdict } from "@prisma/client";
import {
  STEP_BY_KEY,
  qualifiedContinues,
  type OutreachConfig,
  type OutreachSla,
} from "./outreach-sop";

const MIN = 60_000;
const HR = 3_600_000;

// ─────────────────────────────── State in ───────────────────────────────

export type StepState = {
  status: OutreachStepStatus;
  dueAt: Date;
  actedAt: Date | null;
  /** For CALL steps: the SOP's Yes/No branch answer. */
  outcome: string | null;
};

/** Everything the ladder needs to decide. A projection of OutreachJourney + its steps. */
export type JourneyState = {
  phase: OutreachPhase;
  optInAt: Date;
  contactedAt: Date | null;
  /** The discovery appointment instant (UTC), once the lead is matched to a booking. */
  discoAt: Date | null;
  /** The SSS appointment instant (UTC), once the Discovery Specialist books it. */
  sssAt: Date | null;
  booked: boolean;
  qualified: QualifiedVerdict | null;
  whatsappConfirmed: boolean;
  salesCallConfirmed: boolean;
  highlyQualified: boolean | null;
  /**
   * The discovery call happened and the prospect did not join - a specialist recorded NO_SHOW.
   *
   * Distinct from `!whatsappConfirmed`, which only says they never replied to a reminder, and
   * from the post-call sweep, which writes off people who never confirmed. This is a human
   * saying "I was on the call and they were not", and it is what opens the Level 2 chase.
   */
  discoNoShow: boolean;
  steps: Partial<Record<OutreachStep, StepState>>;
};

export type PlannedStep = { step: OutreachStep; dueAt: Date };

export type Plan = {
  /** Rows to create (precondition met, not yet materialised). */
  materialise: PlannedStep[];
  /** Rows overtaken by events - e.g. a reminder still DUE after the prospect confirmed. */
  supersede: OutreachStep[];
  /**
   * Internal bookkeeping steps the engine closes itself: DUE (or about to be materialised) and
   * carrying no message, so there is nothing for a human to do but press a button. The shell
   * writes them SENT with no `actedById`, this outcome and this note, so the audit trail says
   * "done, by the system, and why" rather than the row silently disappearing.
   */
  complete: AutoCompletion[];
  /** The phase the journey should now be in. */
  phase: OutreachPhase;
};

export type AutoCompletion = { step: OutreachStep; outcome: string; note: string };

/** The outcome stamped on a step the engine completed itself. */
export const AUTO_COMPLETED = "AUTO_COMPLETED";

/**
 * Why Step 12 closes itself.
 *
 * OUT-09: Step 12 had no message and no working button - "Run the booking check" never touched
 * it, only "Skip" did - and while it sat DUE it pinned the queue card's next slot, hiding Step 13,
 * and held the journey out of DISCO_CONFIRMATION. Everything it "transfers" (appointment, BANT,
 * Qualified, owners) is already on the booking and the journey, and the Key Metrics tab reads it
 * from there, so the step is bookkeeping and nothing is lost by the system ticking it.
 */
export const KEY_METRICS_AUTO_NOTE =
  "Completed by the system: the booking already records the Key Metrics fields, which the Key Metrics tab reads directly.";

// ─────────────────────────────── Step 2: reaction time ───────────────────────────────

export type ReactionBranch =
  /** Contacted inside the window → SOP Step 3 (the WhatsApp intro flow). */
  | "FAST"
  /** Window blown → SOP Step 10 (skip the intro flow, go straight to the booking check). */
  | "SLOW"
  /** Not contacted yet and still inside the window - the branch is undecided. */
  | "PENDING";

export type ReactionState = {
  branch: ReactionBranch;
  elapsedMs: number;
  /** Milliseconds left before the SLA is blown. Negative once breached. */
  remainingMs: number;
  breached: boolean;
  /** True in the last quarter of the window - drives the "approaching" alert (checklist §B). */
  approaching: boolean;
};

/**
 * Step 2. The branch is decided at the moment of contact: connect inside `reactionMinutes` and the
 * SOP runs Step 3; connect later and it skips to Step 10. Before any contact the branch is
 * PENDING - it can still land either way - which is why `approaching` exists at all.
 */
export function reactionState(state: JourneyState, now: Date, sla: OutreachSla): ReactionState {
  const windowMs = sla.reactionMinutes * MIN;
  const ref = state.contactedAt ?? now;
  const elapsedMs = ref.getTime() - state.optInAt.getTime();
  const remainingMs = windowMs - elapsedMs;
  const breached = elapsedMs > windowMs;

  const branch: ReactionBranch = state.contactedAt
    ? breached
      ? "SLOW"
      : "FAST"
    : breached
      ? "SLOW"
      : "PENDING";

  return {
    branch,
    elapsedMs,
    remainingMs,
    breached,
    // Only meaningful while nobody has contacted them yet - once contacted the clock has stopped.
    approaching: !state.contactedAt && !breached && remainingMs <= windowMs / 4,
  };
}

// ─────────────────────────────── Helpers ───────────────────────────────

function st(state: JourneyState, step: OutreachStep): StepState | undefined {
  return state.steps[step];
}

/** A step counts as "done" once the specialist (or the auto-sender) has acted on it. */
function acted(state: JourneyState, step: OutreachStep): boolean {
  const s = st(state, step);
  return s?.status === "SENT" || s?.status === "SKIPPED";
}

function exists(state: JourneyState, step: OutreachStep): boolean {
  return st(state, step) !== undefined;
}

function actedAt(state: JourneyState, step: OutreachStep): Date | null {
  return st(state, step)?.actedAt ?? null;
}

/** A CALL step whose logged outcome was an explicit "NO". */
function saidNo(state: JourneyState, step: OutreachStep): boolean {
  return (st(state, step)?.outcome ?? "").toUpperCase() === "NO";
}

/**
 * A CALL step whose logged outcome was an explicit "YES" - the specialist reached them.
 *
 * Note this is NOT `!saidNo`: an attempt logged with no outcome at all is neither, and must
 * count as "no answer" rather than silently reading as a reply the prospect never gave.
 */
function saidYes(state: JourneyState, step: OutreachStep): boolean {
  return (st(state, step)?.outcome ?? "").toUpperCase() === "YES";
}

/**
 * A SYSTEM booking check that ran and found no booking.
 *
 * Strictly this is belt-and-braces: the engine runs the Step 10 checks BEFORE planning, so a
 * prospect who had booked would already have `booked = true` and the whole chase block below
 * would be skipped. Testing the outcome explicitly means the rule reads the way it is meant -
 * "they were asked, and they had not booked" - rather than depending on that ordering holding
 * forever.
 */
function checkFoundNoBooking(state: JourneyState, step: OutreachStep): boolean {
  return (st(state, step)?.outcome ?? "").toUpperCase() === "NOT_BOOKED";
}

/**
 * Steps 5/7/9 anchor on "2 hours after Step 3/4" - the later of the intro message and the first
 * call, since either may be the last thing the prospect actually experienced.
 */
function laterOf(a: Date | null, b: Date | null): Date | null {
  if (!a) return b;
  if (!b) return a;
  return a.getTime() >= b.getTime() ? a : b;
}

function minus(anchor: Date, hours: number): Date {
  return new Date(anchor.getTime() - hours * HR);
}

function plus(anchor: Date, hours: number): Date {
  return new Date(anchor.getTime() + hours * HR);
}

/** The later of a due time and a floor it must never precede. */
function notBefore(due: Date, floor: Date): Date {
  return due.getTime() >= floor.getTime() ? due : floor;
}

/** The same, for the one window the SOP expresses in minutes rather than hours. */
function plusMinutes(anchor: Date, minutes: number): Date {
  return new Date(anchor.getTime() + minutes * 60_000);
}

/** Is a materialised step actionable right now? */
export function isActionable(s: StepState, now: Date): boolean {
  return s.status === "DUE" && now.getTime() >= s.dueAt.getTime();
}

/**
 * Every disco-ladder step that is about an UPCOMING call: the welcome, the confirmations, the
 * confirmation calls, the cancellation notice and the release itself. Once the call time has
 * passed none of them means anything, which is what `planJourney` uses this list for.
 */
const PRE_CALL_DISCO_STEPS: OutreachStep[] = [
  "DISCO_WELCOME",
  "DISCO_WELCOME_EMAIL",
  "DISCO_REJECT_MSG",
  "DISCO_REJECT_EMAIL",
  "DISCO_CONFIRM_1",
  "DISCO_CONFIRM_2",
  "DISCO_CONFIRM_CALL_1",
  "DISCO_CONFIRM_CALL_2",
  "DISCO_CANCEL_MSG",
  "DISCO_CANCEL_EMAIL",
  "DISCO_CANCEL",
];

// ─────────────────────────────── Terminal phases ───────────────────────────────

const TERMINAL: OutreachPhase[] = ["IGNORED", "CANCELLED", "CLOSED_NOT_HQ", "COMPLETED"];

export function isTerminal(phase: OutreachPhase): boolean {
  return TERMINAL.includes(phase);
}

// ─────────────────────────────── The ladder ───────────────────────────────

/**
 * Decide what should exist for this journey right now.
 *
 * Pure. Same inputs → same outputs, always. Call it as often as you like: it only ever proposes
 * steps that aren't materialised yet, so re-running it is a no-op once the ladder has caught up.
 * The DB's @@unique([journeyId, step]) is the second line of defence behind that.
 */
export function planJourney(
  state: JourneyState,
  now: Date,
  sla: OutreachSla,
  /**
   * Optional so every existing caller and test keeps the SOP's own behaviour without change.
   * Only the engine's config read passes it.
   */
  opts: { firstCallMode?: OutreachConfig["firstCallMode"] } = {},
): Plan {
  const firstCallMode = opts.firstCallMode ?? "immediate";
  const materialise: PlannedStep[] = [];
  const supersede: OutreachStep[] = [];
  const complete: AutoCompletion[] = [];
  const add = (step: OutreachStep, dueAt: Date) => {
    if (!exists(state, step)) materialise.push({ step, dueAt });
  };

  if (isTerminal(state.phase)) {
    return { materialise, supersede: pendingReminders(state), complete, phase: state.phase };
  }

  const reaction = reactionState(state, now, sla);

  // ═══ Steps 3–9: the booking chase. Only while unbooked. ═══
  if (!state.booked) {
    /**
     * Step 2's branch, and the one subtlety in the whole ladder: the branch is decided ONCE, and
     * the intro having been sent is itself proof the FAST path was taken. Re-deriving it from the
     * clock on every run would flip a journey onto the Step 10 path the moment 5 minutes elapse -
     * even mid-chase, with the intro already delivered - and re-anchor Check 1 to "now", silently
     * moving a deadline that was already set. So: once INTRO_WHATSAPP exists, we are committed.
     */
    const onIntroPath = exists(state, "INTRO_WHATSAPP") || reaction.branch !== "SLOW";

    if (onIntroPath) {
      add("INTRO_WHATSAPP", state.optInAt);
      // Step 1 is "welcome on WhatsApp AND email", and both halves now live in this ladder. The
      // email used to come from a separate automation workflow, which meant one requirement was
      // owned by two systems that knew nothing about each other.
      add("INTRO_EMAIL", state.optInAt);
      // Step 4 straight after Step 3 is the SOP as B2 wrote it: message, then ring, regardless of
      // whether the prospect has had any chance to act. Under "after_check" the call is deferred
      // until a booking check has actually come back empty - see the CHECK_1 branch below.
      if (firstCallMode === "immediate" && acted(state, "INTRO_WHATSAPP")) {
        add("FIRST_CALL", actedAt(state, "INTRO_WHATSAPP") ?? state.optInAt);
      }
    }

    /**
     * Step 5 - Check 1, measured from OPT-IN like every other booking check.
     *
     * It used to anchor on the later of Step 3/4, which made "check back in 5 minutes" mean
     * five minutes after whenever the intro happened to send. The founder's flow counts every
     * window from the moment the prospect opted in, so all four checks now share one origin and
     * the settings screen can be read as a single timeline.
     *
     * Still gated on the intro existing: checking whether someone booked before we have asked
     * them to is meaningless.
     */
    const chaseAnchor = laterOf(actedAt(state, "INTRO_WHATSAPP"), actedAt(state, "FIRST_CALL"));
    if (chaseAnchor) {
      add("CHECK_1", plus(state.optInAt, sla.check1Hours));
    } else if (!onIntroPath) {
      // The SOP's late-contact branch skips the intro flow and checks the booking right away.
      add("CHECK_1", now);
    }

    /**
     * Step 6 - only once Check 1 has actually run and come back "not booked", AND never before
     * Check 1's own deadline.
     *
     * The floor is the fix for a Step 6 that went out five minutes after the intro (17/09/2026).
     * Its due time was simply "whenever Check 1 was acted", and Check 1 can be acted EARLY: the
     * queue card offers "Skip" on a check that is not due yet (it falls back to the first
     * upcoming step when nothing is actionable), and a skipped check counts as acted. One press
     * pulled "you haven't booked yet" forward by nearly two hours, onto someone who had been
     * messaged minutes before. Pinning Step 6 to opt-in + `check1Hours` means no human action
     * can make it earlier than the window the settings screen shows.
     */
    const followupFloor = plus(state.optInAt, sla.check1Hours);
    if (acted(state, "CHECK_1")) {
      if (firstCallMode === "after_check" && checkFoundNoBooking(state, "CHECK_1")) {
        /**
         * THE DEFERRED FIRST CALL.
         *
         * The intro has been out for `check1Hours`, the booking check has run, and there is still
         * no booking - which is the moment a human is worth spending. This is the whole point of
         * the mode: every prospect who books off the message alone never reaches a caller at all.
         */
        add("FIRST_CALL", actedAt(state, "CHECK_1") ?? now);
        // Step 6 waits behind that call rather than racing it. Messaging someone in the same pass
        // as ringing them reads as pestering, and the SOP's own order is call, then follow-up.
        if (acted(state, "FIRST_CALL")) {
          add("FOLLOWUP_WHATSAPP", notBefore(actedAt(state, "FIRST_CALL") ?? now, followupFloor));
          add("FOLLOWUP_EMAIL", notBefore(actedAt(state, "FIRST_CALL") ?? now, followupFloor));
        }
      } else {
        add("FOLLOWUP_WHATSAPP", notBefore(actedAt(state, "CHECK_1") ?? now, followupFloor));
        add("FOLLOWUP_EMAIL", notBefore(actedAt(state, "CHECK_1") ?? now, followupFloor));
      }
    }

    /**
     * Step 7 - measured from OPT-IN, not from Step 6.
     *
     * The founder's instruction (25/08/2026): "I need the message to be sent after 2 hours of
     * optin submission". Anchoring on the follow-up made the setting mean "105 minutes after
     * whenever Step 6 happened to go out", which is a number nobody can reason about - the
     * founder thinks in "how long has this prospect been sitting there", and the box should say
     * what they mean. So `check2Hours` is now the age of the LEAD, and 120 minutes is 120
     * minutes.
     *
     * Still GATED on Step 6 having actually run: the ladder is a sequence, and checking "did
     * they book?" before the chase that asks them to book is meaningless. Only the deadline
     * moved, not the order. One consequence worth knowing: if Step 6 runs late - a stalled cron,
     * a retrofitted step - the opt-in deadline may already be in the past, and Check 2 then falls
     * due on the next tick rather than waiting out a fresh window.
     */
    const a6 = actedAt(state, "FOLLOWUP_WHATSAPP");
    if (a6) add("CHECK_2", plus(state.optInAt, sla.check2Hours));

    // Step 7b - the SECOND WhatsApp chase, once Check 2 has come back with no booking. A human
    // is not spent yet; the message gets one more turn first. Floored on Check 2's deadline for
    // the same reason Step 6 is floored on Check 1's: a check skipped early must not drag the
    // message forward with it.
    if (acted(state, "CHECK_2")) {
      add("FOLLOWUP_WHATSAPP_2", notBefore(actedAt(state, "CHECK_2") ?? now, plus(state.optInAt, sla.check2Hours)));
    }

    // Step 7c - Check 3, again from opt-in.
    if (acted(state, "FOLLOWUP_WHATSAPP_2")) {
      add("CHECK_3", plus(state.optInAt, sla.check3Hours));
    }

    // Step 8 - the telecaller rings, but only after the second message has also failed to land
    // a booking. This is the point the ladder stops being automated.
    if (acted(state, "CHECK_3")) {
      add("FOLLOWUP_CALL", actedAt(state, "CHECK_3") ?? now);
    }

    // Step 9 - measured from OPT-IN, for the same reason as Check 2 above, and kept consistent
    // with it deliberately: three boxes that look identical in the settings panel must not mean
    // two different things. Its anchor was a HUMAN action (the follow-up call), which made the
    // deadline depend on when someone got round to ringing.
    // The SOP's NO branch at Step 8 still ends the cycle outright (checklist §H), so no final
    // check is scheduled in that case.
    /**
     * Step 9 - the write-off deadline, and it is a CLOCK, not a consequence.
     *
     * It used to require Step 8 to have been acted, which made the whole ladder a chain that any
     * single link could strand. That is not theoretical: a prospect (25/08/2026) sat 44 hours at
     * "second chase due" because SOP_FOLLOWUP_2 had no approved WhatsApp template bound, so the
     * message could never send, so Check 3 never materialised, so the telecaller was never
     * raised, so this deadline never existed. Nothing was wrong with the prospect - one unbound
     * template silently switched off the founder's 300-minute rule for everybody.
     *
     * The founder's rule is "300 minutes after opt-in, if there is still no booking, close the
     * card". So it is scheduled for any live chase, whatever did or did not happen upstream.
     * `booked` already guards the whole block, and an explicit NO at Step 8 ends the cycle
     * outright (checklist §H), which is the one case that must not also get a final check.
     */
    if (!saidNo(state, "FOLLOWUP_CALL")) {
      add("FINAL_CHECK", plus(state.optInAt, sla.finalCheckHours));
    }
  }

  // ═══ Steps 11–12: qualification, the moment a booking is matched. ═══
  if (state.booked) {
    add("BANT_QUALIFICATION", now);
    if (acted(state, "BANT_QUALIFICATION")) {
      add("KEY_METRICS_TRANSFER", actedAt(state, "BANT_QUALIFICATION") ?? now);
      /**
       * Step 12 completes itself (OUT-09) - see `KEY_METRICS_AUTO_NOTE`.
       *
       * Both a row about to be materialised in this pass AND one already sitting DUE are closed,
       * so journeys stranded on Step 12 before this change are released on their next tick, not
       * only new ones. A row a human already Skipped or ticked is left exactly as they left it.
       *
       * Releasing it cannot trigger a burst of confirmations for a call that is over: nothing in
       * the disco ladder was ever gated on Step 12 (see the note above `callUpcoming`), every
       * rung is gated on the call still being ahead, and any pre-call rung still DUE once the
       * call time passes is superseded below.
       */
      const km = st(state, "KEY_METRICS_TRANSFER");
      if (!km || km.status === "DUE") {
        complete.push({ step: "KEY_METRICS_TRANSFER", outcome: AUTO_COMPLETED, note: KEY_METRICS_AUTO_NOTE });
      }
    }
  }

  // ═══ Steps 13–16: the Disco ladder. Gated on Qualified = YES/MAYBE. ═══
  const q = state.qualified;
  /**
   * NOTHING in the disco ladder may fire for a call that has already happened.
   *
   * Every message below is about an UPCOMING appointment - "your call is confirmed for [DATE]",
   * "please confirm your slot". Sent after the fact they are nonsense, and on 27/08/2026 they
   * came within five minutes of going out for real: closing the Step 11 row retroactively
   * started this ladder for two prospects whose calls had passed two days earlier and whose
   * bookings had just been written off as no-shows. `booked` does not catch that - it only asks
   * whether a booking is LINKED, not whether it is still ahead of us or still alive.
   */
  const callUpcoming = state.discoAt !== null && state.discoAt.getTime() > now.getTime();
  /**
   * ...and nothing already materialised for it may fire once it is over, either.
   *
   * `callUpcoming` only stops NEW rungs. A rung raised earlier keeps its original due time, and
   * that time is not moved when the call is rescheduled: a Step 14 set for T-36h of a Monday call
   * stays due on Sunday morning even after the call is pulled forward to Friday. Once the call
   * time has passed, every pre-call rung still DUE is moot - "please confirm your call on
   * [DATE]" for a date that is gone - so it is superseded here, before the auto-sender or a
   * specialist on the queue card can reach it. `DISCO_CANCEL` goes with them: releasing the
   * calendar for a call that already happened is the post-call sweep's decision, not this one's.
   */
  if (state.booked && state.discoAt !== null && !callUpcoming) {
    supersede.push(...PRE_CALL_DISCO_STEPS.filter((s) => st(state, s)?.status === "DUE"));
  }
  /**
   * Gated on the QUALIFICATION VERDICT, not on Step 12.
   *
   * Step 12 (Key Metrics transfer + assign owners) is a human data-entry task into a sheet this
   * app has no integration with, so it can only ever be ticked by hand. Hanging every
   * customer-facing message off it meant the whole ladder waited on admin - which is exactly how
   * two booked, qualified prospects reached their call time with nothing sent. Step 12 no longer
   * gates what the prospect receives, and since OUT-09 it completes itself (see above).
   */
  if (state.booked && callUpcoming && q && qualifiedContinues(q) && acted(state, "BANT_QUALIFICATION")) {
    /**
     * Step 13 / 13b - the welcome, on BOTH channels, after the post-booking delay.
     *
     * The SOP says "immediately on qualification" (checklist §M) and that is still the intent -
     * `postBookingDelayMinutes` is a few minutes, not a wait. It exists because BANT is scored
     * the instant the booking lands, and answering someone in the same second they finished a
     * form reads as a machine. Set it to 0 and the original behaviour is back exactly.
     */
    const qualifiedAt = actedAt(state, "BANT_QUALIFICATION") ?? now;
    const afterDelay = plusMinutes(qualifiedAt, sla.postBookingDelayMinutes);
    add("DISCO_WELCOME", afterDelay);
    add("DISCO_WELCOME_EMAIL", afterDelay);

    if (state.discoAt && !state.whatsappConfirmed) {
      // Step 14 - at least 36h before.
      add("DISCO_CONFIRM_1", minus(state.discoAt, sla.discoConfirm1LeadHours));

      // Step 15 - at least 24h before, ONLY if Step 14 drew no reply. If they already confirmed,
      // the guard above stops the whole ladder - checklist §N explicitly tests that Step 15 does
      // not also fire when the prospect has confirmed.
      if (acted(state, "DISCO_CONFIRM_1")) {
        add("DISCO_CONFIRM_2", minus(state.discoAt, sla.discoConfirm2LeadHours));
      }

      // Step 16 - two required call attempts, then the cancellation message.
      if (acted(state, "DISCO_CONFIRM_2")) {
        add("DISCO_CONFIRM_CALL_1", minus(state.discoAt, sla.discoConfirm2LeadHours));
      }
      if (acted(state, "DISCO_CONFIRM_CALL_1")) {
        add("DISCO_CONFIRM_CALL_2", minus(state.discoAt, sla.discoConfirm2LeadHours));
      }
      // The SOP is emphatic: call twice BEFORE the 12-hour cancellation goes out. Both attempts
      // must be logged (checklist §N) - this is the gate that enforces it.
      if (acted(state, "DISCO_CONFIRM_CALL_1") && acted(state, "DISCO_CONFIRM_CALL_2")) {
        add("DISCO_CANCEL_MSG", minus(state.discoAt, sla.discoCancelLeadHours));
        add("DISCO_CANCEL_EMAIL", minus(state.discoAt, sla.discoCancelLeadHours));
      }
      // Either channel is enough to proceed to the actual cancellation - see the Qualified = NO
      // branch below for why this is an OR and not an AND.
      if (acted(state, "DISCO_CANCEL_MSG") || acted(state, "DISCO_CANCEL_EMAIL")) {
        add("DISCO_CANCEL", actedAt(state, "DISCO_CANCEL_MSG") ?? actedAt(state, "DISCO_CANCEL_EMAIL") ?? now);
      }
    }
  }

  /**
   * ═══ Steps 13c/13d + 17: Qualified = NO. ═══
   *
   * The prospect booked, BANT came back under the bar, and the call is being released. They are
   * TOLD before it happens - on both channels - and only then is the slot cancelled. Doing it the
   * other way round means someone finds an empty calendar with no explanation.
   *
   * `DISCO_CANCEL` is what actually releases the slot (see the server engine), so it is gated on
   * the notice having gone out rather than firing the moment the verdict lands.
   */
  // Same clock guard: telling someone their call is cancelled is pointless once it has been
  // and gone. The post-call sweep in the server engine closes those out instead.
  if (state.booked && callUpcoming && q === "NO" && acted(state, "BANT_QUALIFICATION")) {
    const rejectedAt = plusMinutes(actedAt(state, "BANT_QUALIFICATION") ?? now, sla.postBookingDelayMinutes);
    add("DISCO_REJECT_MSG", rejectedAt);
    add("DISCO_REJECT_EMAIL", rejectedAt);
    // Either channel having reached them is enough to proceed. Requiring BOTH would strand the
    // cancellation behind the WhatsApp step, which cannot send until Meta approves a template.
    if (acted(state, "DISCO_REJECT_MSG") || acted(state, "DISCO_REJECT_EMAIL")) {
      add("DISCO_CANCEL", now);
    }
  }

  /**
   * ═══ Level 2: the prospect did not join their discovery call. ═══
   *
   * The Level 1 ladder ends at the booking and every disco step before this is measured BEFORE
   * the call. This is the only branch that runs after it, and it opens on a human judgement -
   * a specialist recording NO_SHOW - not on a clock, because only someone who sat on the call
   * knows whether anybody turned up.
   *
   * Two call attempts before the message, mirroring the confirmation ladder's insistence on the
   * same: one unanswered ring is not evidence that somebody is gone. A specialist who reaches
   * them logs the attempt as YES, and the chase stops there - what happens next is a reschedule,
   * which is a booking, not a message.
   */
  if (state.discoNoShow) {
    add("DISCO_NOSHOW_CALL_1", now);
    if (acted(state, "DISCO_NOSHOW_CALL_1") && !saidYes(state, "DISCO_NOSHOW_CALL_1")) {
      add("DISCO_NOSHOW_CALL_2", actedAt(state, "DISCO_NOSHOW_CALL_1") ?? now);
    }
    if (
      acted(state, "DISCO_NOSHOW_CALL_1") &&
      acted(state, "DISCO_NOSHOW_CALL_2") &&
      !saidYes(state, "DISCO_NOSHOW_CALL_1") &&
      !saidYes(state, "DISCO_NOSHOW_CALL_2")
    ) {
      add("DISCO_NOSHOW_MSG", actedAt(state, "DISCO_NOSHOW_CALL_2") ?? now);
    }
  }

  // ═══ Steps 19–22: the SSS ladder. Gated on Highly Qualified = YES. ═══
  if (state.highlyQualified === true && state.sssAt && !state.salesCallConfirmed) {
    add("SSS_CONFIRM_1", minus(state.sssAt, sla.sssConfirm1LeadHours));
    if (acted(state, "SSS_CONFIRM_1")) {
      add("SSS_CONFIRM_2", minus(state.sssAt, sla.sssConfirm2LeadHours));
    }
    // Step 20b - 6h before, still no reply.
    if (acted(state, "SSS_CONFIRM_2")) {
      add("SSS_CONFIRM_3", minus(state.sssAt, sla.sssConfirm3LeadHours));
    }
    // Step 20c - 3h before, a human rings. The flowchart puts a CALL here before giving up, for
    // the same reason the disco ladder does: a message that went unanswered is not a decision.
    if (acted(state, "SSS_CONFIRM_3")) {
      add("SSS_CONFIRM_CALL", minus(state.sssAt, sla.sssConfirmCallLeadHours));
    }
    // Step 21 - only once that call has been attempted and did not confirm.
    if (acted(state, "SSS_CONFIRM_CALL") && !saidYes(state, "SSS_CONFIRM_CALL")) {
      add("SSS_CANCEL_MSG", minus(state.sssAt, sla.sssCancelLeadHours));
    }
    if (acted(state, "SSS_CANCEL_MSG")) {
      add("SSS_CANCEL", actedAt(state, "SSS_CANCEL_MSG") ?? now);
    }
  }

  const phase = nextPhase(state, now, sla);

  /**
   * A journey that becomes terminal in THIS pass is handed no new work.
   *
   * `pendingReminders` only sees steps that were already DUE, so anything materialised in the
   * same plan that ended the journey survived as an orphan - and the engine's scan excludes
   * terminal phases, so nothing ever came back to clean it up. Jesheeba Fathima M (27/08/2026)
   * was written off by the final check and simultaneously handed a FOLLOWUP_CALL, which then sat
   * DUE in the telecaller's queue permanently: a caller being asked to ring someone the system
   * had already closed.
   *
   * Superseding the freshly-planned steps rather than returning them is what makes the two
   * halves of this plan agree with each other.
   */
  if (isTerminal(phase)) {
    /**
     * Every DUE step, not `pendingReminders(state)` - that reads `state.phase`, which is the
     * phase BEFORE this pass and is still live, so it reports nothing for a journey ending right
     * now. Reading the steps directly is what makes the sweep match the phase we just computed.
     */
    const stillDue = (Object.entries(state.steps) as [OutreachStep, StepState | undefined][])
      .filter(([, v]) => v?.status === "DUE")
      .map(([k]) => k);
    return {
      materialise: [],
      supersede: [...new Set([...supersede, ...stillDue, ...materialise.map((m) => m.step)])],
      // Nothing is completed on a journey that is ending: the row is superseded with the rest.
      complete: [],
      phase,
    };
  }

  return {
    materialise: materialise.slice(),
    supersede: Array.from(new Set(supersede.concat(pendingReminders(state)))),
    complete,
    phase,
  };
}

/**
 * Reminder steps that events have overtaken - a confirmation ladder still sitting DUE after the
 * prospect confirmed, or anything left open once the journey reached a terminal phase. Without
 * this the queue would keep offering the specialist a cancellation message for someone who already
 * said yes.
 */
function pendingReminders(state: JourneyState): OutreachStep[] {
  const out: OutreachStep[] = [];
  const stillDue = (step: OutreachStep) => st(state, step)?.status === "DUE";

  const discoLadder: OutreachStep[] = [
    "DISCO_WELCOME",
    "DISCO_WELCOME_EMAIL",
    "DISCO_REJECT_MSG",
    "DISCO_REJECT_EMAIL",
    "DISCO_CONFIRM_1",
    "DISCO_CONFIRM_2",
    "DISCO_CONFIRM_CALL_1",
    "DISCO_CONFIRM_CALL_2",
    "DISCO_CANCEL_MSG",
    "DISCO_CANCEL_EMAIL",
  ];
  const sssLadder: OutreachStep[] = [
    "SSS_CONFIRM_1",
    "SSS_CONFIRM_2",
    "SSS_CONFIRM_3",
    "SSS_CONFIRM_CALL",
    "SSS_CANCEL_MSG",
  ];
  // The Level 2 no-show chase. Two unworked call attempts must not outlive their journey either.
  const noShowChase: OutreachStep[] = ["DISCO_NOSHOW_CALL_1", "DISCO_NOSHOW_CALL_2", "DISCO_NOSHOW_MSG"];
  const chaseLadder: OutreachStep[] = [
    "INTRO_WHATSAPP",
    "INTRO_EMAIL",
    "FIRST_CALL",
    "CHECK_1",
    "FOLLOWUP_WHATSAPP",
    "FOLLOWUP_EMAIL",
    "CHECK_2",
    "FOLLOWUP_WHATSAPP_2",
    "CHECK_3",
    "FOLLOWUP_CALL",
    "FINAL_CHECK",
  ];

  if (state.whatsappConfirmed) out.push(...discoLadder.filter(stillDue));
  if (state.salesCallConfirmed) out.push(...sssLadder.filter(stillDue));
  // Booking lands mid-chase: the SOP jumps to Step 11 and the chase is moot.
  if (state.booked) out.push(...chaseLadder.filter((s) => stillDue(s) && s !== "CHECK_1"));
  if (isTerminal(state.phase)) {
    out.push(...[...chaseLadder, ...discoLadder, ...sssLadder, ...noShowChase].filter(stillDue));
  }
  return Array.from(new Set(out));
}

/**
 * The phase the journey should be in, derived from facts rather than stored transitions - so a
 * journey can never get stranded in a phase that contradicts its own data.
 */
export function nextPhase(state: JourneyState, now: Date, sla: OutreachSla): OutreachPhase {
  if (isTerminal(state.phase)) return state.phase;

  if (state.salesCallConfirmed) return "COMPLETED";
  /**
   * Step 22 - the SSS was released because the prospect never confirmed.
   *
   * Read BEFORE the Highly Qualified branch below, and for the same reason the disco ladder reads
   * `DISCO_CANCEL` before its own: the verdict that opened the ladder is still true, so without
   * this the journey would sit in SSS_CONFIRMATION for ever with its slot already given away -
   * which is exactly how the engine kept re-scanning a prospect whose call no longer exists.
   */
  if (acted(state, "SSS_CANCEL")) return "CANCELLED";
  if (state.highlyQualified === false) return "CLOSED_NOT_HQ";
  if (state.highlyQualified === true) return "SSS_CONFIRMATION";

  if (state.booked) {
    if (state.qualified === "NO") return acted(state, "DISCO_CANCEL") ? "CANCELLED" : "QUALIFICATION";
    if (acted(state, "DISCO_CANCEL")) return "CANCELLED";
    if (state.whatsappConfirmed) return "AWAITING_DISCO";
    /**
     * Gated on Step 11, not Step 12 (OUT-09). Step 12 used to be the gate, and as a step only a
     * "Skip" could close it held journeys in QUALIFICATION indefinitely - and the WhatsApp YES
     * handler only accepts a confirmation in DISCO_CONFIRMATION. Step 12 now completes itself,
     * so it is acted whenever Step 11 is; reading Step 11 directly means the phase follows in the
     * same pass rather than one tick later.
     */
    if (state.qualified && qualifiedContinues(state.qualified) && acted(state, "BANT_QUALIFICATION")) {
      return "DISCO_CONFIRMATION";
    }
    return "QUALIFICATION";
  }

  // Step 9's terminal branch: the final check ran and the prospect still hasn't booked.
  if (acted(state, "FINAL_CHECK")) return "IGNORED";
  // Step 8's NO branch ends the active follow-up cycle (checklist §H).
  if (saidNo(state, "FOLLOWUP_CALL")) return "IGNORED";

  return exists(state, "INTRO_WHATSAPP") || reactionState(state, now, sla).branch === "SLOW"
    ? "BOOKING_CHASE"
    : "OPT_IN";
}

// ─────────────────────────────── Booking cross-check (Step 10) ───────────────────────────────

/**
 * Normalize an email for identity comparison.
 *
 * Checklist §J asks specifically for the false-negative case: "confirm a booked lead is never
 * reported as 'not booked' due to formatting mismatches (trailing spaces, case, email aliasing)".
 *
 * Trailing space and case are unambiguous and we fix both. **Aliasing is deliberately NOT
 * stripped**: `+` sub-addressing and dot-insensitivity are Gmail conventions, not standards -
 * `a.b@yahoo.com` and `ab@yahoo.com` are genuinely different mailboxes. Folding them would turn a
 * false negative into a false positive, which is the worse failure here: it would cross-check one
 * prospect's booking against another prospect's lead. The SOP's own Ctrl+F is a literal match, so
 * case + whitespace folding already makes us strictly more reliable than the manual process.
 */
export function normalizeEmail(email: string | null | undefined): string | null {
  const v = (email ?? "").trim().toLowerCase();
  return v.length ? v : null;
}

/** Do these two emails identify the same mailbox, for Step 10 purposes? */
export function emailsMatch(a: string | null | undefined, b: string | null | undefined): boolean {
  const na = normalizeEmail(a);
  const nb = normalizeEmail(b);
  return na !== null && nb !== null && na === nb;
}

// ─────────────────────────────── Step labels for the UI ───────────────────────────────

export function stepLabel(step: OutreachStep): string {
  return STEP_BY_KEY[step]?.label ?? step;
}

export function stepSop(step: OutreachStep): string {
  return STEP_BY_KEY[step]?.sopStep ?? "";
}

// ─────────────────────────────── Who reminds about the call ───────────────────────────────

export type ReminderOwnerJourney = {
  phase: OutreachPhase;
  optInAt: Date;
  qualified: QualifiedVerdict | null;
};

/**
 * Does the SOP ladder own the reminders for this booking, so the Bookings pre-call reminder
 * (`BOOKING_REMINDER`, the WhatsApp cron) must stand down?
 *
 * Two systems used to remind about the same call: Steps 14/15 at T-36h/T-24h and the booking
 * reminders at their own offsets, each unaware of the other. The SOP ladder is the founder's
 * documented process and carries the confirm-or-cancel logic, so it wins wherever it is actually
 * going to run. The booking reminder stays the reminder for every booking the SOP is NOT going to
 * handle, so this is true only when ALL of these hold:
 *   · the engine is armed and this journey is inside its `maxAgeDays` scan window - otherwise the
 *     ladder never advances it and nothing would remind them at all,
 *   · the journey is live (not terminal),
 *   · and either the verdict is NO - the SOP is releasing this call, and "see you at 6 pm" would
 *     contradict the notice telling them it is cancelled - or the verdict continues AND at least
 *     one confirmation rung auto-sends. A ladder that only raises queue tasks for a human is not
 *     an automatic reminder, and silencing the one that is would leave the prospect with none.
 * No verdict yet (Step 11 open) keeps the booking reminder: nothing on the SOP side is due.
 *
 * Once the prospect confirms, the ladder stops by design and this stays true: the SOP's process
 * ends there, and restarting a second system's reminders is exactly the doubling this removes.
 */
export function sopOwnsCallReminders(
  journey: ReminderOwnerJourney | null,
  cfg: Pick<OutreachConfig, "enabled" | "maxAgeDays" | "autoSend">,
  now: Date,
): boolean {
  if (!journey || !cfg.enabled) return false;
  if (isTerminal(journey.phase)) return false;
  if (journey.optInAt.getTime() < now.getTime() - cfg.maxAgeDays * 24 * HR) return false;
  if (journey.qualified === "NO") return true;
  if (!journey.qualified || !qualifiedContinues(journey.qualified)) return false;
  return cfg.autoSend.DISCO_CONFIRM_1 === true || cfg.autoSend.DISCO_CONFIRM_2 === true;
}
