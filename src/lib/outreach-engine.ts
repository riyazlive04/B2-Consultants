/**
 * Outreach SOP — the ladder, as pure functions.
 *
 * Deliberately has NO prisma, NO clock and NO IO: every function takes `now` as an argument and
 * returns a decision. That is what makes the SOP's timing rules testable at their boundaries
 * (T−36h−1min / T−36h / T−36h+1min) without a database or a fake timer, which is exactly what the
 * QA checklist's Step 2 asks for. `src/server/outreach.ts` is the thin DB shell around this.
 *
 * The one rule worth internalising: a step is MATERIALISED when its precondition becomes true, and
 * is ACTIONABLE when `now >= dueAt`. Those are different moments. Materialising early is how the
 * queue can show "Disco confirmation 1 — in 4h" instead of surprising the specialist with it.
 */

import type { OutreachPhase, OutreachStep, OutreachStepStatus, QualifiedVerdict } from "@prisma/client";
import { STEP_BY_KEY, qualifiedContinues, type OutreachSla } from "./outreach-sop";

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
  /** Rows overtaken by events — e.g. a reminder still DUE after the prospect confirmed. */
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
  /** Not contacted yet and still inside the window — the branch is undecided. */
  | "PENDING";

export type ReactionState = {
  branch: ReactionBranch;
  elapsedMs: number;
  /** Milliseconds left before the SLA is blown. Negative once breached. */
  remainingMs: number;
  breached: boolean;
  /** True in the last quarter of the window — drives the "approaching" alert (checklist §B). */
  approaching: boolean;
};

/**
 * Step 2. The branch is decided at the moment of contact: connect inside `reactionMinutes` and the
 * SOP runs Step 3; connect later and it skips to Step 10. Before any contact the branch is
 * PENDING — it can still land either way — which is why `approaching` exists at all.
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
    // Only meaningful while nobody has contacted them yet — once contacted the clock has stopped.
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
 * Steps 5/7/9 anchor on "2 hours after Step 3/4" — the later of the intro message and the first
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
export function planJourney(state: JourneyState, now: Date, sla: OutreachSla): Plan {
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
     * clock on every run would flip a journey onto the Step 10 path the moment 5 minutes elapse —
     * even mid-chase, with the intro already delivered — and re-anchor Check 1 to "now", silently
     * moving a deadline that was already set. So: once INTRO_WHATSAPP exists, we are committed.
     */
    const onIntroPath = exists(state, "INTRO_WHATSAPP") || reaction.branch !== "SLOW";

    if (onIntroPath) {
      add("INTRO_WHATSAPP", state.optInAt);
      if (acted(state, "INTRO_WHATSAPP")) {
        add("FIRST_CALL", actedAt(state, "INTRO_WHATSAPP") ?? state.optInAt);
      }
    }

    // Step 5 — Check 1, two hours after Step 3/4 (the later of them: either may be the last thing
    // the prospect actually experienced).
    const chaseAnchor = laterOf(actedAt(state, "INTRO_WHATSAPP"), actedAt(state, "FIRST_CALL"));
    if (chaseAnchor) {
      add("CHECK_1", plus(chaseAnchor, sla.check1Hours));
    } else if (!onIntroPath) {
      // The SOP's late-contact branch skips the intro flow and checks the booking right away.
      add("CHECK_1", now);
    }

    // Step 6 — only once Check 1 has actually run and come back "not booked".
    if (acted(state, "CHECK_1")) {
      add("FOLLOWUP_WHATSAPP", actedAt(state, "CHECK_1") ?? now);
    }

    // Step 7 — one hour after Step 6.
    const a6 = actedAt(state, "FOLLOWUP_WHATSAPP");
    if (a6) add("CHECK_2", plus(a6, sla.check2Hours));

    // Step 8 — only once Check 2 has run.
    if (acted(state, "CHECK_2")) {
      add("FOLLOWUP_CALL", actedAt(state, "CHECK_2") ?? now);
    }

    // Step 9 — two hours after Step 8. The SOP's NO branch at Step 8 ends the cycle outright
    // (checklist §H), so no final check is scheduled in that case.
    const a8 = actedAt(state, "FOLLOWUP_CALL");
    if (a8 && !saidNo(state, "FOLLOWUP_CALL")) {
      add("FINAL_CHECK", plus(a8, sla.finalCheckHours));
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
  if (state.booked && q && qualifiedContinues(q) && acted(state, "KEY_METRICS_TRANSFER")) {
    // Step 13 — "sent immediately on qualification", not delayed (checklist §M).
    add("DISCO_WELCOME", actedAt(state, "KEY_METRICS_TRANSFER") ?? now);

    if (state.discoAt && !state.whatsappConfirmed) {
      // Step 14 — at least 36h before.
      add("DISCO_CONFIRM_1", minus(state.discoAt, sla.discoConfirm1LeadHours));

      // Step 15 — at least 24h before, ONLY if Step 14 drew no reply. If they already confirmed,
      // the guard above stops the whole ladder — checklist §N explicitly tests that Step 15 does
      // not also fire when the prospect has confirmed.
      if (acted(state, "DISCO_CONFIRM_1")) {
        add("DISCO_CONFIRM_2", minus(state.discoAt, sla.discoConfirm2LeadHours));
      }

      // Step 16 — two required call attempts, then the cancellation message.
      if (acted(state, "DISCO_CONFIRM_2")) {
        add("DISCO_CONFIRM_CALL_1", minus(state.discoAt, sla.discoConfirm2LeadHours));
      }
      if (acted(state, "DISCO_CONFIRM_CALL_1")) {
        add("DISCO_CONFIRM_CALL_2", minus(state.discoAt, sla.discoConfirm2LeadHours));
      }
      // The SOP is emphatic: call twice BEFORE the 12-hour cancellation goes out. Both attempts
      // must be logged (checklist §N) — this is the gate that enforces it.
      if (acted(state, "DISCO_CONFIRM_CALL_1") && acted(state, "DISCO_CONFIRM_CALL_2")) {
        add("DISCO_CANCEL_MSG", minus(state.discoAt, sla.discoCancelLeadHours));
      }
      if (acted(state, "DISCO_CANCEL_MSG")) {
        add("DISCO_CANCEL", actedAt(state, "DISCO_CANCEL_MSG") ?? now);
      }
    }
  }

  // ═══ Step 17: Qualified = NO diverts straight to cancellation, skipping Step 13 entirely. ═══
  if (state.booked && q === "NO" && acted(state, "KEY_METRICS_TRANSFER")) {
    add("DISCO_CANCEL", now);
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

  return {
    materialise: materialise.slice(),
    supersede: supersede.concat(pendingReminders(state)),
    phase: nextPhase(state, now, sla),
  };
}

/**
 * Reminder steps that events have overtaken — a confirmation ladder still sitting DUE after the
 * prospect confirmed, or anything left open once the journey reached a terminal phase. Without
 * this the queue would keep offering the specialist a cancellation message for someone who already
 * said yes.
 */
function pendingReminders(state: JourneyState): OutreachStep[] {
  const out: OutreachStep[] = [];
  const stillDue = (step: OutreachStep) => st(state, step)?.status === "DUE";

  const discoLadder: OutreachStep[] = [
    "DISCO_CONFIRM_1",
    "DISCO_CONFIRM_2",
    "DISCO_CONFIRM_CALL_1",
    "DISCO_CONFIRM_CALL_2",
    "DISCO_CANCEL_MSG",
  ];
  const sssLadder: OutreachStep[] = ["SSS_CONFIRM_1", "SSS_CONFIRM_2", "SSS_CANCEL_MSG"];
  const chaseLadder: OutreachStep[] = [
    "INTRO_WHATSAPP",
    "FIRST_CALL",
    "CHECK_1",
    "FOLLOWUP_WHATSAPP",
    "CHECK_2",
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
 * The phase the journey should be in, derived from facts rather than stored transitions — so a
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
 * stripped**: `+` sub-addressing and dot-insensitivity are Gmail conventions, not standards —
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
