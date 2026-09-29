import { DEFAULT_DUNNING_CONFIG, type DunningConfig, type DunningChannel } from "./config-schema";

/**
 * The dunning ladder - which rung an instalment is on, as pure functions.
 *
 * WHAT IT REPLACES: one reminder email that deduped by string-matching its own subject line
 * against the Message table. That works exactly until someone rewords a subject, at which point
 * every student who ever received the old wording is chased again.
 *
 * The two decisions that make an automated chase feel like a person rather than a bug both live
 * here, so both are unit-tested:
 *
 *   1. Stages are STRICTLY ORDERED AND NON-SKIPPING. An instalment discovered already ten days
 *      overdue gets the FINAL notice only - not stage 1, 2 and 3 in the same tick. Receiving
 *      "just a reminder, due in three days", "you missed it" and "final notice" within the same
 *      minute is the single most obvious way to tell a student they are talking to a broken
 *      machine.
 *   2. A stage fires ONCE, ever, and only if it is actually due today or overdue.
 */

export type DunningStage = "UPCOMING" | "MISSED" | "FINAL";

/** Rungs, in the order they are climbed. Order is load-bearing - see `stageFor`. */
export const DUNNING_STAGES: DunningStage[] = ["UPCOMING", "MISSED", "FINAL"];

export const DUNNING_STAGE_LABELS: Record<DunningStage, string> = {
  UPCOMING: "Upcoming reminder",
  MISSED: "Missed payment",
  FINAL: "Final notice",
};

export type LadderInput = {
  /** The instalment's own due date. The ladder is anchored here, not on the parent receivable. */
  dueDate: Date;
  /** Stages already sent for this instalment. */
  sent: DunningStage[];
  /** Today, at IST midnight. */
  today: Date;
};

const DAY_MS = 86_400_000;

function utcMidnight(d: Date): number {
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
}

/** Whole days from the due date to today. Negative before it is due. */
export function daysPastDue(dueDate: Date, today: Date): number {
  return Math.floor((utcMidnight(today) - utcMidnight(dueDate)) / DAY_MS);
}

/**
 * Which single stage - if any - should fire for this instalment today.
 *
 * Returns the HIGHEST unsent stage whose offset has been reached, and never more than one. That
 * "highest" is what implements non-skipping: an instalment first seen at +10 days has all three
 * offsets satisfied, and answering FINAL means the earlier two are simply never sent rather than
 * being fired in a burst. They are dead - a stage whose moment has passed has nothing to say.
 *
 * Returns null when nothing is due, when every applicable stage has already gone, or when the
 * stage that would fire is disabled.
 */
export function stageFor(
  input: LadderInput,
  config: DunningConfig = DEFAULT_DUNNING_CONFIG,
): DunningStage | null {
  const elapsed = daysPastDue(input.dueDate, input.today);
  const sent = new Set(input.sent);

  const stageConfig: Record<DunningStage, { enabled: boolean; dayOffset: number }> = {
    UPCOMING: config.stages.upcoming,
    MISSED: config.stages.missed,
    FINAL: config.stages.final,
  };

  // Walk from the last rung backwards; the first reached-and-unsent one wins.
  for (let i = DUNNING_STAGES.length - 1; i >= 0; i--) {
    const stage = DUNNING_STAGES[i]!;
    const cfg = stageConfig[stage];
    if (!cfg.enabled) continue;
    if (elapsed < cfg.dayOffset) continue; // not yet time for this rung
    if (sent.has(stage)) {
      // This rung has already gone. Nothing BELOW it can fire either - a lower rung is by
      // definition earlier, and an earlier message arriving after a later one is nonsense.
      return null;
    }
    return stage;
  }
  return null;
}

/** The channel a stage goes out on, per config. */
export function channelFor(
  stage: DunningStage,
  config: DunningConfig = DEFAULT_DUNNING_CONFIG,
): DunningChannel {
  if (stage === "UPCOMING") return config.stages.upcoming.channel;
  if (stage === "MISSED") return config.stages.missed.channel;
  return config.stages.final.channel;
}

export type DunningCopy = { subject: string; lines: string[] };

/**
 * The message for one rung.
 *
 * The tone escalates and the CONTENT changes with it - that is the point of a ladder rather than
 * three copies of one email. Stage 1 does not mention consequences; stage 3 does, once, without
 * threatening anything the business would not actually do.
 *
 * Kept pure and here (rather than in the sender) so the wording is covered by tests: a chase
 * email that states the wrong amount or the wrong date is the whole message being wrong, and it
 * goes to someone who has paid this business money.
 */
export function dunningCopy(input: {
  stage: DunningStage;
  firstName: string;
  amountLabel: string;
  dueDateLabel: string;
  daysPastDue: number;
  studentCode: string | null;
}): DunningCopy {
  const { stage, firstName, amountLabel, dueDateLabel } = input;

  // Every rung carries this. "If you've already paid, tell us" is what stops an automated chase
  // becoming an accusation when the ledger is simply behind.
  const alreadyPaid =
    "If you've already paid, please ignore this - and do let us know so we can update our records.";

  if (stage === "UPCOMING") {
    return {
      subject: `Reminder: ${amountLabel} due on ${dueDateLabel}`,
      lines: [
        `Hi ${firstName},`,
        "",
        `A quick heads-up that your next instalment of ${amountLabel} is due on ${dueDateLabel}.`,
        "",
        "Nothing to do if it's already scheduled - this is just so it doesn't catch you out.",
        "",
        alreadyPaid,
      ],
    };
  }

  if (stage === "MISSED") {
    return {
      subject: `${amountLabel} was due on ${dueDateLabel}`,
      lines: [
        `Hi ${firstName},`,
        "",
        `Your instalment of ${amountLabel} was due on ${dueDateLabel} and we haven't received it yet.`,
        "",
        "If something's come up, reply to this email and we'll sort out a plan that works - that's a much easier conversation to have now than later.",
        "",
        alreadyPaid,
      ],
    };
  }

  return {
    subject: `Final notice: ${amountLabel} outstanding since ${dueDateLabel}`,
    lines: [
      `Hi ${firstName},`,
      "",
      `Your instalment of ${amountLabel} has now been outstanding since ${dueDateLabel}, and our earlier reminders haven't reached you.`,
      "",
      // One consequence, stated plainly, and one the business will actually act on. A threat it
      // won't follow through on is worse than none - it teaches students to ignore the next one.
      "We need to hear from you before we can carry on scheduling your sessions. Please reply to this email or call us so we can agree a way forward.",
      "",
      "This is the last automatic reminder you'll get - from here it's a conversation with us directly.",
      "",
      alreadyPaid,
    ],
  };
}
