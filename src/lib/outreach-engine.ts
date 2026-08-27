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
  steps: Partial<Record<OutreachStep, StepState>>;
};

export type PlannedStep = { step: OutreachStep; dueAt: Date };

export type Plan = {
  /** Rows to create (precondition met, not yet materialised). */
  materialise: PlannedStep[];
  /** Rows overtaken by events - e.g. a reminder still DUE after the prospect confirmed. */
  supersede: OutreachStep[];
  /** The phase the journey should now be in. */
  phase: OutreachPhase;
};

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

/** The same, for the one window the SOP expresses in minutes rather than hours. */
function plusMinutes(anchor: Date, minutes: number): Date {
  return new Date(anchor.getTime() + minutes * 60_000);
}

/** Is a materialised step actionable right now? */
export function isActionable(s: StepState, now: Date): boolean {
  return s.status === "DUE" && now.getTime() >= s.dueAt.getTime();
}

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
  const add = (step: OutreachStep, dueAt: Date) => {
    if (!exists(state, step)) materialise.push({ step, dueAt });
  };

  if (isTerminal(state.phase)) {
    return { materialise, supersede: pendingReminders(state), phase: state.phase };
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

    // Step 6 - only once Check 1 has actually run and come back "not booked".
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
          add("FOLLOWUP_WHATSAPP", actedAt(state, "FIRST_CALL") ?? now);
          add("FOLLOWUP_EMAIL", actedAt(state, "FIRST_CALL") ?? now);
        }
      } else {
        add("FOLLOWUP_WHATSAPP", actedAt(state, "CHECK_1") ?? now);
        add("FOLLOWUP_EMAIL", actedAt(state, "CHECK_1") ?? now);
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
    // is not spent yet; the message gets one more turn first.
    if (acted(state, "CHECK_2")) {
      add("FOLLOWUP_WHATSAPP_2", actedAt(state, "CHECK_2") ?? now);
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
   * Gated on the QUALIFICATION VERDICT, not on Step 12.
   *
   * Step 12 (Key Metrics transfer + assign owners) is a human data-entry task into a sheet this
   * app has no integration with, so it can only ever be ticked by hand. Hanging every
   * customer-facing message off it meant the whole ladder waited on admin - which is exactly how
   * two booked, qualified prospects reached their call time with nothing sent. Step 12 remains a
   * to-do in the queue; it just no longer gates what the prospect receives.
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

  // ═══ Steps 19–22: the SSS ladder. Gated on Highly Qualified = YES. ═══
  if (state.highlyQualified === true && state.sssAt && !state.salesCallConfirmed) {
    add("SSS_CONFIRM_1", minus(state.sssAt, sla.sssConfirm1LeadHours));
    if (acted(state, "SSS_CONFIRM_1")) {
      add("SSS_CONFIRM_2", minus(state.sssAt, sla.sssConfirm2LeadHours));
    }
    if (acted(state, "SSS_CONFIRM_2")) {
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
      phase,
    };
  }

  return {
    materialise: materialise.slice(),
    supersede: supersede.concat(pendingReminders(state)),
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
  const sssLadder: OutreachStep[] = ["SSS_CONFIRM_1", "SSS_CONFIRM_2", "SSS_CANCEL_MSG"];
  const chaseLadder: OutreachStep[] = [
    "INTRO_WHATSAPP",
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
    out.push(...[...chaseLadder, ...discoLadder, ...sssLadder].filter(stillDue));
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
  if (state.highlyQualified === false) return "CLOSED_NOT_HQ";
  if (state.highlyQualified === true) return "SSS_CONFIRMATION";

  if (state.booked) {
    if (state.qualified === "NO") return acted(state, "DISCO_CANCEL") ? "CANCELLED" : "QUALIFICATION";
    if (acted(state, "DISCO_CANCEL")) return "CANCELLED";
    if (state.whatsappConfirmed) return "AWAITING_DISCO";
    if (state.qualified && qualifiedContinues(state.qualified) && acted(state, "KEY_METRICS_TRANSFER")) {
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
