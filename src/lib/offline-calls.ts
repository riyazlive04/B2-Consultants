/**
 * Offline call capture — the rules for trusting a device's clock.
 *
 * A telecaller loses signal mid-shift, keeps working, and the outcomes queue on the phone
 * until the connection returns. The call happened at a moment the server never witnessed, so
 * `calledAt` has to come from the device. This is the ONLY place in the app where a
 * client-supplied timestamp is written to a column that metrics read, and everything here
 * exists to keep that bounded and visible.
 *
 * Why it needs bounding at all: `calledAt` drives the 5-minute connection rate on the L1
 * desk — a JD target people are reviewed against. A phone whose clock is an hour slow (or
 * deliberately set back) would otherwise report a "connected in 4 minutes" that nobody could
 * disprove weeks later. So a claimed time is CLAMPED into a possible window, and the row
 * carries `syncedAt` recording when it really reached us.
 *
 * CLAMP, DO NOT REJECT. A rejected call is a call that never happened as far as the record is
 * concerned, and the telecaller has no way to get it back — the queue is already flushed and
 * they've moved on. Silently losing someone's work to defend a metric is the worse trade, so
 * an impossible timestamp is pulled to the nearest possible one and flagged, never dropped.
 *
 * Pure and dependency-free: no prisma, no browser APIs. The device queues against these rules
 * and the server re-applies them on arrival, because anything the client checks is a
 * suggestion — the server's copy is the one that decides.
 */

const MINUTE_MS = 60_000;
const DAY_MS = 86_400_000;

/**
 * Tolerance for honest clock drift. Phones are routinely a few seconds to a couple of minutes
 * off NTP, and treating that as tampering would flag ordinary calls. Anything beyond it is not
 * drift — a call cannot be completed in the future.
 */
export const CLOCK_SKEW_TOLERANCE_MS = 2 * MINUTE_MS;

/**
 * How far back a queued call may claim to be. Long enough to cover a genuinely bad stretch —
 * a rural weekend, a phone left off over a holiday — without letting a stale queue rewrite
 * last quarter's numbers.
 */
export const MAX_QUEUE_AGE_MS = 7 * DAY_MS;

export type ClampReason = "future" | "too-old";

export type ClampedTime = {
  /** The instant to store in `calledAt`. */
  calledAt: Date;
  /** What the device claimed, kept so the adjustment is auditable. */
  claimed: Date;
  /** Null when the claim was accepted as-is. */
  adjusted: ClampReason | null;
};

/**
 * Pull a device-claimed call time into the window it could possibly have happened in.
 *
 * `receivedAt` is the server's own clock at the moment of arrival — always passed in rather
 * than read here, so this stays pure and the same call can be replayed in a test.
 */
export function clampCalledAt(claimed: Date, receivedAt: Date): ClampedTime {
  const claimedMs = claimed.getTime();
  const receivedMs = receivedAt.getTime();

  // A call cannot have happened after we heard about it. Small drift is forgiven and kept
  // as-claimed; beyond tolerance the only defensible value is "when it arrived".
  if (claimedMs > receivedMs + CLOCK_SKEW_TOLERANCE_MS) {
    return { calledAt: new Date(receivedMs), claimed, adjusted: "future" };
  }

  const oldest = receivedMs - MAX_QUEUE_AGE_MS;
  if (claimedMs < oldest) {
    return { calledAt: new Date(oldest), claimed, adjusted: "too-old" };
  }

  return { calledAt: new Date(claimedMs), claimed, adjusted: null };
}

/** How late a queued call was, in ms. Never negative — a clamped future claim reads as 0. */
export function syncLagMs(calledAt: Date, syncedAt: Date): number {
  return Math.max(0, syncedAt.getTime() - calledAt.getTime());
}

/**
 * Human phrasing for the "synced late" marker on a call row.
 *
 * Deliberately coarse: the point is "this did not arrive live", not a stopwatch. Anything
 * under a minute is not worth a badge — that is a flaky connection recovering, not offline
 * work — so it returns null and the row renders like any other.
 */
export function syncLagLabel(lagMs: number): string | null {
  if (lagMs < MINUTE_MS) return null;
  const mins = Math.floor(lagMs / MINUTE_MS);
  if (mins < 60) return `synced ${mins}m late`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `synced ${hours}h late`;
  return `synced ${Math.floor(hours / 24)}d late`;
}

/** One call waiting on the device. Serialised straight into the queue and the sync payload. */
export type QueuedCall = {
  /** Device-generated idempotency key — the server's UNIQUE index dedupes on it. */
  clientKey: string;
  leadId: string;
  outcome: string;
  notes: string;
  /** ISO of when the telecaller recorded it, from the device clock. */
  recordedAt: string;
  /** Flush attempts so far, so a permanently-failing entry can be reported not retried forever. */
  attempts: number;
};

/**
 * Entries the server refused for a reason that will never change (a deleted lead, an outcome
 * the enum no longer has). Retrying these forever would block the queue behind a row that can
 * never land, so the sync treats them as terminal and surfaces them instead.
 */
export const MAX_SYNC_ATTEMPTS = 5;

export function isExhausted(entry: QueuedCall): boolean {
  return entry.attempts >= MAX_SYNC_ATTEMPTS;
}
