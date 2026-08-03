/**
 * Level 1 Outreach Specialist — the JD's service-level rules, as pure functions.
 *
 * Source: Level 1 Outreach Specialist JD, via the rebuild spec §6. The JD does not set one
 * response target; it sets FOUR, by the clock time the lead arrived:
 *
 *   • any lead      — connect within 5 minutes of arrival        (90% hit rate)
 *   • 09:00–19:59   — connect the SAME day                        (100%)
 *   • 20:00–23:59   — connect the FOLLOWING day                   (100%)
 *   • 00:00–08:59   — connect the SAME day                        (100%)
 *
 * The 5-minute rule is not a fifth window — it runs across all four, which is why
 * `slaFor` returns a window AND a separate five-minute deadline. A lead that arrives at
 * 21:00 is inside its 5-minute clock until 21:05, then waits until tomorrow's window;
 * both facts are true at once and the queue needs to show each in a different place.
 *
 * "Connected" is a conversation ending in a decision — CallLogOutcome.SPOKE. An attempted
 * call is not a connection, so `NO_ANSWER`/`BUSY` must never satisfy an SLA. That
 * distinction is the JD's, stated explicitly, and it is why the desk reads CallLog rather
 * than the self-reported DailyLog totals.
 *
 * Pure and dependency-free on purpose: this is the file the targets get argued about in,
 * so it must be runnable under `tsx --test` without a database. `server/l1-desk-metrics.ts`
 * does the querying and calls in here for every verdict.
 */

/** IST is a fixed +05:30 with no DST, so window maths is exact arithmetic. */
const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;
const DAY_MS = 86_400_000;
const FIVE_MINUTES_MS = 5 * 60 * 1000;

/** Which JD clause governs this lead, decided by its IST arrival time. */
export type SlaWindow = "DAY" | "NIGHT" | "EARLY";

export const SLA_WINDOW_LABELS: Record<SlaWindow, string> = {
  DAY: "Daytime lead (09:00–20:00)",
  NIGHT: "Night lead (20:00–24:00)",
  EARLY: "Early-hours lead (00:00–09:00)",
};

/**
 * Where a lead stands against its deadline.
 *
 * FRESH is deliberately distinct from DUE: a lead inside its 5-minute window is the single
 * most valuable thing on the desk and must not be mixed into the general "due today" pile,
 * which is the reconciliation the specialist currently does by eye.
 */
export type SlaState =
  | "FRESH" // inside the 5-minute clock, not yet connected — ring this now
  | "DUE" // 5 minutes gone, still inside the window's deadline
  | "OVERDUE" // the window's deadline has passed, never connected
  | "MET" // connected, within the 5-minute clock
  | "LATE" // connected, but after the 5-minute clock
  | "MISSED"; // connected after the window deadline entirely

export type SlaVerdict = {
  window: SlaWindow;
  state: SlaState;
  /** Instant the 5-minute clock expires. Always optInAt + 5min, whatever the window. */
  fiveMinuteBy: Date;
  /** Instant the JD's same-day / next-day obligation expires (end of the due IST day). */
  dueBy: Date;
  /** ms until `fiveMinuteBy`; negative once elapsed. Drives the countdown in the queue. */
  msToFiveMinute: number;
  /** True when this lead counted towards the 90% five-minute target — i.e. it was connected in time. */
  metFiveMinute: boolean;
  /** True when the lead was connected by `dueBy`, the 100% obligation. */
  metWindow: boolean;
};

/** IST wall-clock hour (0–23) of an instant. */
export function istHour(instant: Date): number {
  return new Date(instant.getTime() + IST_OFFSET_MS).getUTCHours();
}

/** UTC-midnight Date representing the IST calendar day an instant falls on. */
export function istDayOf(instant: Date): Date {
  const shifted = new Date(instant.getTime() + IST_OFFSET_MS);
  return new Date(Date.UTC(shifted.getUTCFullYear(), shifted.getUTCMonth(), shifted.getUTCDate()));
}

/** The instant an IST calendar day ends (i.e. 00:00 IST the next morning). */
function istEndOfDay(istDay: Date): Date {
  return new Date(istDay.getTime() + DAY_MS - IST_OFFSET_MS);
}

/** Which JD clause an arrival time falls under. */
export function windowFor(optInAt: Date): SlaWindow {
  const h = istHour(optInAt);
  if (h >= 20) return "NIGHT";
  if (h < 9) return "EARLY";
  return "DAY";
}

/**
 * Grade one lead against the JD.
 *
 * `connectedAt` is the first SPOKE call, or null if nobody has ever connected. Passing the
 * FIRST connection matters: a lead rung at 09:02 and again at 15:00 met the 5-minute rule,
 * and taking the latest call would wrongly mark it late.
 */
export function slaFor(optInAt: Date, connectedAt: Date | null, now: Date): SlaVerdict {
  const window = windowFor(optInAt);
  const fiveMinuteBy = new Date(optInAt.getTime() + FIVE_MINUTES_MS);

  // NIGHT leads are owed the following day; DAY and EARLY are owed the same day.
  const arrivalDay = istDayOf(optInAt);
  const dueDay = window === "NIGHT" ? new Date(arrivalDay.getTime() + DAY_MS) : arrivalDay;
  const dueBy = istEndOfDay(dueDay);

  const metFiveMinute = connectedAt !== null && connectedAt.getTime() <= fiveMinuteBy.getTime();
  const metWindow = connectedAt !== null && connectedAt.getTime() <= dueBy.getTime();

  const state: SlaState = connectedAt
    ? metFiveMinute
      ? "MET"
      : metWindow
        ? "LATE"
        : "MISSED"
    : now.getTime() <= fiveMinuteBy.getTime()
      ? "FRESH"
      : now.getTime() <= dueBy.getTime()
        ? "DUE"
        : "OVERDUE";

  return {
    window,
    state,
    fiveMinuteBy,
    dueBy,
    msToFiveMinute: fiveMinuteBy.getTime() - now.getTime(),
    metFiveMinute,
    metWindow,
  };
}

// ─────────────────────────── The priority queue ───────────────────────────

/**
 * The seven buckets of spec §6, in the order the specialist works them top-down.
 *
 * Order is the whole point — it encodes what to do next when everything is on fire, so it
 * is data here rather than a hardcoded render order that drifts from the JD.
 */
export const QUEUE_BUCKETS = [
  "FIVE_MINUTE",
  // Second only to the 5-minute clock: the prospect has already had the message, ignored it, and
  // the SOP has formally raised a call. Everything below is work the specialist chooses when to
  // do; this is work the process has decided is due now.
  "NOT_BOOKED_AFTER_MESSAGE",
  "DAY_DUE",
  "NIGHT_DUE",
  "EARLY_DUE",
  "OPTED_NOT_BOOKED",
  "OLD_LEADS",
  "WORKSHOP",
] as const;

export type QueueBucket = (typeof QUEUE_BUCKETS)[number];

export const QUEUE_BUCKET_META: Record<
  QueueBucket,
  { title: string; why: string; target: string }
> = {
  FIVE_MINUTE: {
    title: "New — under 5 minutes",
    why: "Ring these before anything else. The clock is running.",
    target: "90% connected within 5 minutes",
  },
  NOT_BOOKED_AFTER_MESSAGE: {
    title: "Messaged, didn't book — call now",
    why: "They got the booking link and haven't used it. The SOP has raised a call for you.",
    target: "30–40% of leads booked",
  },
  DAY_DUE: {
    title: "Daytime leads, not yet connected",
    why: "Arrived 09:00–20:00 and owed a connection today.",
    target: "100% same day",
  },
  NIGHT_DUE: {
    title: "Night leads",
    why: "Arrived after 20:00 — owed a connection today.",
    target: "100% the following day",
  },
  EARLY_DUE: {
    title: "Early-hours leads",
    why: "Arrived before 09:00 — owed a connection today.",
    target: "100% same day",
  },
  OPTED_NOT_BOOKED: {
    title: "Opted in, not yet booked",
    why: "Replaces reconciling the opt-in sheet against the booking sheet by hand.",
    target: "30–40% of leads booked",
  },
  OLD_LEADS: {
    title: "Old leads",
    why: "Work at least 30 a day, each closed as interested or not interested.",
    target: "≥ 30 worked per day",
  },
  WORKSHOP: {
    title: "Workshop participants",
    why: "Follow up within 5 days of the workshop finishing.",
    target: "Within 5 days",
  },
};

/** Workshop follow-up stays on the queue for this many days after the workshop ends. */
export const WORKSHOP_FOLLOWUP_DAYS = 5;

/** A lead is "old" once it has been sitting this long without converting. */
export const OLD_LEAD_AFTER_DAYS = 30;

/**
 * Which bucket an unconnected lead belongs to. Returns null when the lead is not owed
 * anything right now — connected already, or a night lead whose day has not come round yet.
 *
 * A lead lands in exactly ONE bucket: FRESH outranks its window, so a 21:00 lead at 21:03
 * shows under "under 5 minutes" and not also under "night leads". Showing it twice would
 * inflate every count on the page and put the same person in two work piles.
 */
export function bucketForLead(verdict: SlaVerdict): QueueBucket | null {
  if (verdict.state === "FRESH") return "FIVE_MINUTE";
  if (verdict.state !== "DUE" && verdict.state !== "OVERDUE") return null;
  return verdict.window === "DAY" ? "DAY_DUE" : verdict.window === "NIGHT" ? "NIGHT_DUE" : "EARLY_DUE";
}

// ─────────────────────────── JD target cards ───────────────────────────

/**
 * The eight target cards of spec §6, each mapped to its JD threshold.
 *
 * `amber` is the band between "missing it" and "hitting it". Where the JD gives a range
 * (lead→booked 30–40%, BANT accuracy 65–75%) the LOWER bound is the pass mark and the
 * range's top is not a ceiling to be punished for exceeding — so `green` is the lower
 * bound, and there is no upper limit.
 */
export type TargetKey =
  | "fiveMinuteRate"
  | "dayConnect"
  | "nightConnect"
  | "leadToBooked"
  | "bantAccuracy"
  | "showRate"
  | "oldLeadsWorked"
  | "pipelineUpdated";

export type TargetSpec = {
  label: string;
  /** At or above this = green. */
  green: number;
  /** At or above this (but below green) = amber. Below = red. */
  amber: number;
  unit: "pct" | "count";
  tooltip: string;
};

export const L1_TARGETS: Record<TargetKey, TargetSpec> = {
  fiveMinuteRate: {
    label: "5-minute connection rate",
    green: 90, amber: 75, unit: "pct",
    tooltip: "Leads connected within 5 minutes of arriving, as a share of all leads that arrived. JD target: 90%.",
  },
  dayConnect: {
    // The window lives in the tooltip, not the label — the card truncates to one line.
    label: "Same-day connection",
    green: 100, amber: 90, unit: "pct",
    tooltip:
      "Leads arriving 09:00–20:00 that were connected before the day ended. JD target: 100%.",
  },
  nightConnect: {
    label: "Night leads, following day",
    green: 100, amber: 90, unit: "pct",
    tooltip: "Leads arriving after 20:00, connected the next day. JD target: 100%.",
  },
  leadToBooked: {
    label: "Lead → booked discovery call",
    green: 30, amber: 25, unit: "pct",
    tooltip: "Leads that became a booked discovery call. JD target: 30–40%.",
  },
  bantAccuracy: {
    label: "BANT qualification accuracy",
    green: 65, amber: 55, unit: "pct",
    tooltip: "Leads you qualified that the discovery call agreed with. JD target: 65–75%.",
  },
  showRate: {
    label: "Show rate on booked calls",
    green: 100, amber: 85, unit: "pct",
    tooltip: "Booked calls where the prospect showed up, having been sent reminders. JD target: 100%.",
  },
  oldLeadsWorked: {
    label: "Old leads worked today",
    green: 30, amber: 20, unit: "count",
    tooltip: "Leads older than 30 days closed today as interested or not interested. JD target: at least 30.",
  },
  pipelineUpdated: {
    label: "Pipeline updated by EOD",
    green: 100, amber: 90, unit: "pct",
    tooltip: "Leads you touched today whose stage reflects the outcome. JD target: 100%.",
  },
};

/** Green / amber / red for any target spec, in the app's shared signal vocabulary. */
export function signalForSpec(spec: TargetSpec, value: number | null): "ok" | "watch" | "risk" | null {
  if (value === null) return null; // nothing to measure yet — a 0% would be a lie, not a verdict
  if (value >= spec.green) return "ok";
  if (value >= spec.amber) return "watch";
  return "risk";
}

/** Green / amber / red for an L1 target. */
export function signalForTarget(key: TargetKey, value: number | null): "ok" | "watch" | "risk" | null {
  return signalForSpec(L1_TARGETS[key], value);
}

// ───────────────────── Level 2 — Discovery Specialist ─────────────────────

/**
 * Spec §7's target cards, from the Level 2 JD.
 *
 * The show rate is the one that matters: the JD sets 80% and the six-month actual is 62%,
 * which the rebuild doc calls the largest single leak in the funnel. It is deliberately
 * given the widest amber band so the card stops reading as a flat failure and starts
 * showing movement — a specialist climbing from 62% to 74% is doing the right thing and
 * should be able to see it.
 */
export type L2TargetKey =
  | "callsToday"
  | "showRate"
  | "discoveryToSss"
  | "confirmationsSent"
  | "pipelineUpdated";

export const L2_TARGETS: Record<L2TargetKey, TargetSpec> = {
  callsToday: {
    label: "Discovery calls conducted today",
    green: 6, amber: 4, unit: "count",
    tooltip: "Discovery calls you completed today. JD target: at least 6.",
  },
  showRate: {
    label: "Show rate",
    green: 80, amber: 65, unit: "pct",
    tooltip:
      "Booked calls where the prospect turned up. JD target: 80%. The six-month actual is 62% — the largest single leak in the funnel.",
  },
  discoveryToSss: {
    label: "Discovery → Solution Strategy Call",
    green: 35, amber: 28, unit: "pct",
    tooltip: "Completed discovery calls you routed on to Level 3. JD target: 35%.",
  },
  confirmationsSent: {
    label: "Confirmations sent to L3",
    green: 100, amber: 90, unit: "pct",
    tooltip:
      "Prospects routed to Level 3 who were sent a confirmation. Every one protects L3's show rate. JD target: 100%.",
  },
  pipelineUpdated: {
    label: "Pipeline updated by EOD",
    green: 100, amber: 90, unit: "pct",
    tooltip: "Calls you ran today that have their outcome recorded. JD target: 100%.",
  },
};

/**
 * Where a discovery call sends the prospect next (§7's routing panel).
 *
 * Three destinations, each with its own follow-up, mapped onto the existing `CallOutcome`
 * enum rather than a new one — the column already exists and already feeds the funnel
 * metrics, so a parallel vocabulary would split the same fact across two fields.
 */
export const DISCOVERY_ROUTES = [
  {
    outcome: "QUALIFIED_FOR_SSS",
    label: "Ready — route to Level 3",
    detail: "A confirmation goes out automatically, which is what protects Level 3's show rate.",
    tone: "good",
  },
  {
    outcome: "SENT_TO_WORKSHOP",
    label: "Needs more understanding — workshop",
    detail: "Enrolled in the next workshop, then handed back to Level 1 for re-engagement.",
    tone: "warn",
  },
  {
    outcome: "NOT_QUALIFIED_FOR_SSS",
    label: "Not qualified — close",
    detail: "Closed with a reason, so the funnel shows why rather than just losing the lead.",
    tone: "neutral",
  },
] as const;

export type DiscoveryRoute = (typeof DISCOVERY_ROUTES)[number]["outcome"];

/**
 * Percentage helper that refuses to invent a denominator.
 *
 * Returns null rather than 0 when nothing happened: a specialist who received no leads
 * before 09:00 has not missed a 100% target, and colouring that card red would train
 * everyone to ignore the colours.
 */
export function rate(hit: number, total: number): number | null {
  return total > 0 ? (hit / total) * 100 : null;
}
