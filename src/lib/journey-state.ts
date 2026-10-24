/**
 * THE ONBOARDING JOURNEY AS ONE DERIVED STATE - stranger to student, in one place.
 *
 * Isomorphic: no prisma, no server-only, primitives in and a plain object out, so the board, the
 * rail on both person pages, the wizard and the server reads all import the same truth.
 *
 * ── Why this file exists ────────────────────────────────────────────────────────────────
 * The business runs on one journey - a lead arrives, takes a discovery call, accepts, pays,
 * signs, is put in a cohort, and starts class - and the app did not have it. It had the two
 * halves and nothing joining them:
 *
 *     the sales half      `Lead.stage`, seventeen flat values ending at WON
 *     the delivery half   `Student` + `Enrollment` + a seat
 *
 * Nothing in the schema connected the two, so no screen could show where a person had got to,
 * and no screen could list the people stuck between stages. Doing it by hand meant about fifteen
 * screens across six nav groups, and six different places could bring a `Student` row into
 * existence - one of them the income form. The founder's own words: "there are too many sections
 * to add a student and I myself can't understand."
 *
 * ── Why DERIVED and not a column ────────────────────────────────────────────────────────
 * The same reasoning `agreement-state.ts` sets out, and it applies with more force here. The
 * evidence for every step already exists in the database - a CallLog, a BookingRequest, an
 * Agreement status, an Enrollment, a seat. A `journeyState` column would be a second copy of
 * facts we already hold, needing a writer on every one of those paths and a backfill for every
 * existing row, and it would be wrong the first time any of them was edited directly.
 *
 * Derived instead means: every existing person classifies correctly on day one with nothing
 * written, no migration, no cron, and the state cannot drift from the data because it IS the
 * data. Rolling the whole thing back is deleting the call sites.
 *
 * ── The two ideas that make it usable ───────────────────────────────────────────────────
 * 1. A step is REACHED when its evidence exists - independently of every other step. So the rail
 *    shows ticks rather than a gate, and the real world (someone pays before they sign; a GN
 *    learner never has a Lead at all) does not have to be lied about to fit a pipeline.
 * 2. GAPS are separate from steps. "Enrolled but no programme level", "seated but no portal
 *    login", "a student the income form minted and nothing else" are not positions on the
 *    journey - they are things missing from a person at whatever position they hold. That
 *    distinction is what makes the Needs-completing list possible: it is a gap query, not a
 *    stage query.
 */

import type { BatchReadiness } from "./batch";

/* ────────────────────────────────────────────────────────────────────────────────────────
   THE STEPS
   ──────────────────────────────────────────────────────────────────────────────────────── */

export const JOURNEY_STEPS = [
  "NEW",
  "CONTACTED",
  "CALL_BOOKED",
  "DISCOVERY_DONE",
  "WON",
  "AGREEMENT_SENT",
  "SIGNED",
  "ENROLLED",
  "SEATED",
  "IN_CLASS",
] as const;

export type JourneyStep = (typeof JOURNEY_STEPS)[number];

/** Not a step: where a journey stops. Kept out of `JOURNEY_STEPS` so the rail stays linear. */
export type JourneyExit = "LOST";

export type JourneyState = JourneyStep | JourneyExit;

/** What the founder reads on the rail. Plain language - a layman has to follow this. */
export const JOURNEY_STEP_LABELS: Record<JourneyStep, string> = {
  NEW: "New lead",
  CONTACTED: "Contacted",
  CALL_BOOKED: "Call booked",
  DISCOVERY_DONE: "Call done",
  WON: "Said yes",
  AGREEMENT_SENT: "Agreement sent",
  SIGNED: "Agreement signed",
  ENROLLED: "Enrolled",
  SEATED: "In a cohort",
  IN_CLASS: "In class",
};

export const JOURNEY_STATE_LABELS: Record<JourneyState, string> = {
  ...JOURNEY_STEP_LABELS,
  LOST: "Not going ahead",
};

const STEP_INDEX = new Map<JourneyStep, number>(JOURNEY_STEPS.map((s, i) => [s, i]));

/** Position on the rail, 1-based, for a progress bar. `LOST` has no position. */
export function stepNumber(step: JourneyStep): number {
  return (STEP_INDEX.get(step) ?? 0) + 1;
}

export const JOURNEY_STEP_COUNT = JOURNEY_STEPS.length;

/* ────────────────────────────────────────────────────────────────────────────────────────
   THE GAPS
   ──────────────────────────────────────────────────────────────────────────────────────── */

/**
 * Something missing from a person, independent of how far along they are.
 *
 * `NO_ENROLMENT` is the one that matters most: three of the six ways a `Student` can be created
 * - converting a lead, enrolling off a signed agreement, and the income form minting one - all
 * produce a student with no enrolment. They have bought nothing, are in no cohort, have no
 * programme level and no login, and before this list existed no screen anywhere named them.
 */
export type JourneyGap =
  | "NO_ENROLMENT"
  | "NO_PROGRAMME_LEVEL"
  | "NO_PAYMENT"
  | "NOT_SEATED"
  | "NO_PORTAL_LOGIN"
  | "COHORT_NOT_READY"
  | "AGREEMENT_EXPIRED";

export const JOURNEY_GAP_LABELS: Record<JourneyGap, string> = {
  NO_ENROLMENT: "No programme bought yet",
  NO_PROGRAMME_LEVEL: "No programme level set",
  NO_PAYMENT: "No payment or payment plan",
  NOT_SEATED: "Not in a cohort",
  NO_PORTAL_LOGIN: "No portal login",
  COHORT_NOT_READY: "Their cohort is not ready to teach",
  AGREEMENT_EXPIRED: "Signing link expired unsigned",
};

/* ────────────────────────────────────────────────────────────────────────────────────────
   WHAT TO DO NEXT
   ──────────────────────────────────────────────────────────────────────────────────────── */

/**
 * Where the next action lives, as a KIND rather than a URL.
 *
 * This file stays free of route strings on purpose: the caller already holds the ids, and a pure
 * function that built `/students/${id}` would make every href in the app a thing to keep in step
 * with a library. The rail maps a target plus its ids to a link; this decides which one.
 */
export type JourneyTarget =
  | "LOG_CONTACT"
  | "BOOK_CALL"
  | "RECORD_OUTCOME"
  | "MOVE_DEAL"
  | "SEND_AGREEMENT"
  | "AWAIT_SIGNATURE"
  | "ENROL"
  | "SET_PROGRAMME_LEVEL"
  | "TAKE_PAYMENT"
  | "SEAT_IN_COHORT"
  | "READY_COHORT"
  | "CREATE_LOGIN"
  | "NOTHING";

export type JourneyNext = {
  /** The step this action completes. `null` once the journey is done or lost. */
  step: JourneyStep | null;
  /** The button's words. Imperative, plain - "Book the discovery call". */
  action: string;
  target: JourneyTarget;
};

/* ────────────────────────────────────────────────────────────────────────────────────────
   INPUT
   ──────────────────────────────────────────────────────────────────────────────────────── */

/**
 * Every fact the journey reads, as primitives.
 *
 * Strings rather than prisma enums so this file imports no generated client and can be used from
 * a client component - the same choice `agreement-state.ts` makes for `AgreementStatus`.
 */
export type JourneyInput = {
  /** `Lead.stage`. Null for a Student who never was a lead - a walk-in, or a GN learner. */
  leadStage: string | null;
  /** A CallLog or an outbound WhatsApp exists for this person. */
  hasContact: boolean;
  /** A BookingRequest exists. */
  hasBooking: boolean;
  /** A DiscoveryOutcome has been recorded. */
  hasDiscoveryOutcome: boolean;
  /** `Agreement.status` for the agreement that represents them now, or null if none drafted. */
  agreementStatus: string | null;
  /** A `Student` row exists. */
  hasStudent: boolean;
  /** `Enrollment` exists at all - the thing three of the six creation doors skip. */
  hasEnrolment: boolean;
  /** `Enrollment.programLevel`, when set. */
  programLevel: string | null;
  /** Money received, or a payment plan agreed. Either satisfies the payment step. */
  payment: { received: boolean; planned: boolean };
  /** The seat, if they have one - either mechanism. */
  seat: { batchId: string | null; readiness: BatchReadiness | null };
  /** `Student.userId` is set, so they can actually sign in. */
  hasPortalLogin: boolean;
  /** A class on their cohort has started. */
  firstClassStarted: boolean;
};

/* ────────────────────────────────────────────────────────────────────────────────────────
   THE RULES
   ──────────────────────────────────────────────────────────────────────────────────────── */

/**
 * Stages where the deal is live enough to count as "said yes".
 *
 * `DEPOSIT_PAID` is in here beside `WON` for the same reason `agreement-state.ts` treats it as
 * eligible: a confirmed signup with a deposit has accepted, whatever the board says next.
 */
const WON_STAGES = new Set(["DEPOSIT_PAID", "WON"]);

/**
 * Terminal-lost, matching `agreement-state.ts`'s reading of the same two values so the two
 * derived states never disagree about whether a deal is dead.
 */
const LOST_STAGES = new Set(["LOST", "NO_SHOW"]);

/** Stages that prove a discovery call happened, for a lead whose outcome row was never written. */
const POST_DISCOVERY_STAGES = new Set([
  "DISCO_COMPLETED",
  "SSS_BOOKED",
  "SSS_COMPLETED",
  "PROPOSAL_SENT",
  "SENT_TO_WORKSHOP",
  "WORKSHOP_FOLLOWUP",
  "OFFER_FOLLOWUP",
  "DEPOSIT_FOLLOWUP",
  "DEPOSIT_PAID",
  "WON",
]);

/** Stages that prove a call was booked. */
const BOOKED_STAGES = new Set(["STRATEGY_CALL_BOOKED", "DISCO_BOOKED", ...POST_DISCOVERY_STAGES]);

/** Stages that prove somebody reached out. */
const CONTACTED_STAGES = new Set(["WHATSAPP_SENT", "DISCO_NOT_BOOKED", ...BOOKED_STAGES]);

export type Journey = {
  /** The furthest step whose evidence exists, or `LOST`. */
  state: JourneyState;
  /** Every step reached, in rail order - which may have holes. */
  reached: JourneyStep[];
  /** What is missing from this person, whatever their state. */
  gaps: JourneyGap[];
  /** The one thing to do now. */
  next: JourneyNext;
  /** Reached ÷ total, 0-1, for a progress bar. `LOST` reports what it got to. */
  progress: number;
  /** True once they are in class with no gaps - the journey is finished. */
  complete: boolean;
};

/**
 * Which steps this person has evidence for.
 *
 * Each test is independent, and that is deliberate: a GN learner with no Lead row has no NEW,
 * CONTACTED or WON and is still legitimately SEATED, while a student who paid before signing
 * has WON and SIGNED out of order. A strictly sequential reading would have to call both of
 * those broken.
 *
 * `hasStudent` implies the sales steps are moot rather than missing - a paying student plainly
 * said yes - so ENROLLED upward is reachable without any lead evidence at all.
 */
export function reachedSteps(i: JourneyInput): JourneyStep[] {
  const stage = i.leadStage;
  const agreement = i.agreementStatus;
  const out: JourneyStep[] = [];

  // A person is on the journey at all if they are a lead or already a student.
  if (stage !== null || i.hasStudent) out.push("NEW");

  if (i.hasContact || (stage !== null && CONTACTED_STAGES.has(stage))) out.push("CONTACTED");
  if (i.hasBooking || (stage !== null && BOOKED_STAGES.has(stage))) out.push("CALL_BOOKED");
  if (i.hasDiscoveryOutcome || (stage !== null && POST_DISCOVERY_STAGES.has(stage))) {
    out.push("DISCOVERY_DONE");
  }

  // Said yes: the board says so, or they are a student with a programme, which is stronger
  // evidence than any stage - you do not enrol somebody who refused.
  if ((stage !== null && WON_STAGES.has(stage)) || i.hasEnrolment) out.push("WON");

  if (agreement === "SENT" || agreement === "VIEWED" || agreement === "SIGNED") {
    out.push("AGREEMENT_SENT");
  }
  if (agreement === "SIGNED") out.push("SIGNED");

  // Enrolled means they bought a named programme. A Student row with no enrolment is NOT
  // enrolled - that is the half-built state the Needs-completing list exists to surface.
  if (i.hasStudent && i.hasEnrolment && i.programLevel) out.push("ENROLLED");
  if (i.seat.batchId) out.push("SEATED");
  if (i.firstClassStarted) out.push("IN_CLASS");

  return JOURNEY_STEPS.filter((s) => out.includes(s));
}

/**
 * What is missing from this person.
 *
 * Only asked once there is something to be missing from - there is no point telling a brand new
 * lead they have no portal login. Each gap therefore has a precondition, and they read in the
 * order a founder would close them.
 */
export function journeyGaps(i: JourneyInput): JourneyGap[] {
  const gaps: JourneyGap[] = [];

  if (i.agreementStatus === "EXPIRED") gaps.push("AGREEMENT_EXPIRED");

  // A student record with nothing bought. The headline gap: three of the six creation paths
  // land here, including the income form.
  if (i.hasStudent && !i.hasEnrolment) gaps.push("NO_ENROLMENT");
  if (i.hasEnrolment && !i.programLevel) gaps.push("NO_PROGRAMME_LEVEL");

  // Payment is only a gap once they have actually bought something.
  if (i.hasEnrolment && !i.payment.received && !i.payment.planned) gaps.push("NO_PAYMENT");

  // Seating is only a gap once there is an enrolment to seat.
  if (i.hasEnrolment && !i.seat.batchId) gaps.push("NOT_SEATED");

  // A seat they cannot be taught in is its own problem, and not theirs to fix.
  if (i.seat.batchId && (i.seat.readiness === "DRAFT" || i.seat.readiness === null)) {
    gaps.push("COHORT_NOT_READY");
  }

  // No login once they are seated: until then there is nothing for them to sign in and see.
  if (i.seat.batchId && !i.hasPortalLogin) gaps.push("NO_PORTAL_LOGIN");

  return gaps;
}

const NEXT_BY_STEP: Record<JourneyStep, JourneyNext> = {
  NEW: { step: "CONTACTED", action: "Log the first contact", target: "LOG_CONTACT" },
  CONTACTED: { step: "CALL_BOOKED", action: "Book the discovery call", target: "BOOK_CALL" },
  CALL_BOOKED: { step: "DISCOVERY_DONE", action: "Record the call outcome", target: "RECORD_OUTCOME" },
  DISCOVERY_DONE: { step: "WON", action: "Move the deal to won", target: "MOVE_DEAL" },
  WON: { step: "AGREEMENT_SENT", action: "Send the agreement", target: "SEND_AGREEMENT" },
  AGREEMENT_SENT: { step: "SIGNED", action: "Waiting for their signature", target: "AWAIT_SIGNATURE" },
  SIGNED: { step: "ENROLLED", action: "Enrol them", target: "ENROL" },
  ENROLLED: { step: "SEATED", action: "Put them in a cohort", target: "SEAT_IN_COHORT" },
  SEATED: { step: "IN_CLASS", action: "Waiting for their first class", target: "AWAIT_SIGNATURE" },
  IN_CLASS: { step: null, action: "Nothing - they are in class", target: "NOTHING" },
};

/**
 * The one thing to do now.
 *
 * GAPS OUTRANK PROGRESS, and this is the rule that makes the rail honest. Somebody seated in a
 * cohort has got further than somebody merely enrolled - but if their programme level was never
 * set, telling them to wait for their first class is useless advice. So a blocking gap is
 * answered first, in the order they have to be closed, and only then does the rail suggest the
 * next step forward.
 */
export function journeyNext(i: JourneyInput, state: JourneyState, gaps: JourneyGap[]): JourneyNext {
  if (state === "LOST") return { step: null, action: "Nothing - not going ahead", target: "NOTHING" };

  if (gaps.includes("AGREEMENT_EXPIRED")) {
    return { step: "AGREEMENT_SENT", action: "Void and re-issue the agreement", target: "SEND_AGREEMENT" };
  }
  if (gaps.includes("NO_ENROLMENT")) {
    return { step: "ENROLLED", action: "Set their programme and enrol them", target: "ENROL" };
  }
  if (gaps.includes("NO_PROGRAMME_LEVEL")) {
    return { step: "ENROLLED", action: "Set the programme level", target: "SET_PROGRAMME_LEVEL" };
  }
  if (gaps.includes("NOT_SEATED")) {
    return { step: "SEATED", action: "Put them in a cohort", target: "SEAT_IN_COHORT" };
  }
  if (gaps.includes("COHORT_NOT_READY")) {
    return { step: "IN_CLASS", action: "Finish setting up their cohort", target: "READY_COHORT" };
  }
  if (gaps.includes("NO_PAYMENT")) {
    return { step: "ENROLLED", action: "Record the payment or set a plan", target: "TAKE_PAYMENT" };
  }
  if (gaps.includes("NO_PORTAL_LOGIN")) {
    return { step: "IN_CLASS", action: "Create their portal login", target: "CREATE_LOGIN" };
  }
  return NEXT_BY_STEP[state];
}

/**
 * The whole journey for one person.
 *
 * `LOST` is read from the board and never inferred: a lead nobody has touched for six months is
 * stalled, not lost, and guessing otherwise would quietly write off deals the founders are still
 * working. It also does not apply once somebody is a student - a signed, enrolled client whose
 * lead row still says NO_SHOW from an earlier attempt is not lost, and that row genuinely exists
 * in the data.
 */
export function deriveJourney(i: JourneyInput): Journey {
  const reached = reachedSteps(i);
  const gaps = journeyGaps(i);

  const lost =
    !i.hasStudent &&
    ((i.leadStage !== null && LOST_STAGES.has(i.leadStage)) || i.agreementStatus === "DECLINED");

  const furthest = reached.length > 0 ? reached[reached.length - 1] : "NEW";
  const state: JourneyState = lost ? "LOST" : furthest;

  return {
    state,
    reached,
    gaps,
    next: journeyNext(i, state, gaps),
    progress: reached.length / JOURNEY_STEP_COUNT,
    complete: state === "IN_CLASS" && gaps.length === 0,
  };
}

/* ────────────────────────────────────────────────────────────────────────────────────────
   GROUPING FOR THE BOARD
   ──────────────────────────────────────────────────────────────────────────────────────── */

/**
 * Is this person still being onboarded?
 *
 * Done means in class with nothing missing. Lost means stopped. Everything else is in flight,
 * including a student who reached class but has no login - they still need something.
 */
export function isInFlight(j: Journey): boolean {
  return j.state !== "LOST" && !j.complete;
}

/** Does this person belong on the Needs-completing list? */
export function needsCompleting(j: Journey): boolean {
  return j.state !== "LOST" && j.gaps.length > 0;
}

/**
 * How many days a person has sat at their current step, given when it was reached.
 *
 * Returns null rather than 0 when the date is unknown, so the board can say nothing instead of
 * claiming "0 days" about a row it cannot date.
 */
export function daysInStep(since: Date | null, on: Date): number | null {
  if (!since) return null;
  const MS_PER_DAY = 86_400_000;
  const floor = (d: Date) => Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
  const days = Math.floor((floor(on) - floor(since)) / MS_PER_DAY);
  return days < 0 ? 0 : days;
}
