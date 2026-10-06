/**
 * Delivery health - is an ARMED outbound channel actually delivering?
 *
 * The gap this closes: both outbound seams return a result object instead of throwing
 * (`lib/wati.ts` → `{ok:false, error}`, `lib/email.ts` → `{ok:false, error}`), so a tick in which
 * every single send failed resolves normally. `cron-route.ts` then records `{ok:true}` and
 * `uptime.ts` PINGS the dead-man's switch. A total WhatsApp outage looked like a perfectly healthy
 * cron, `consecutiveFailures` stayed 0, and the 3-strikes escalation could never fire. In October
 * 2026 a prospect's messages failed for three days and the only thing that noticed was a human
 * asking by hand.
 *
 * Design constraints that shaped this file:
 *
 *  1. NO new queries and NO new cron. Engines count their own sends in memory, the cron route
 *     harvests the tally out of the payload it already returns, and `recordCronRun` folds it into
 *     the AppSetting row it was writing anyway. A rolling `WhatsAppMessage` groupBy was rejected:
 *     the table's only usable index is `[kind, createdAt]`, so a status-by-window aggregate is a
 *     sequential scan - 2,880 of them a day, on a 1-vCPU box with no swap.
 *
 *  2. NO capture call on a send path. The only alert site is `recordCronRun`, so "at most one
 *     event per tick" is structural rather than a threshold that can be tuned wrong.
 *
 *  3. Meta's per-recipient marketing cap can NEVER raise an outage. It is classified as a
 *     `recipient` failure, and no path leads from `recipient` to a dead verdict. Forty capped
 *     sends in one tick produce exactly zero alerts. This is the difference between an alert
 *     people read and an alert people mute.
 *
 * Everything here is pure and synchronous so it can be unit-tested directly, following the
 * `lib/daily-log.ts` / `lib/instalment-plan.ts` / `lib/book-order-message.ts` precedent. No
 * `server-only`, no imports beyond the Meta-cap detector that already exists.
 */

import { isMetaQualityRestriction } from "./call-notice";

// ───────────────────────────────── Failure classes ─────────────────────────────────

/**
 * Why a send did not arrive. The three the brief cares about are `recipient` (expected and
 * self-healing), `systemic` (the channel is down for everyone) and `config` (a switch nobody
 * flipped, which `not-armed.ts` already owns). `suppressed` is local-development noise and is not
 * a failure at all.
 */
export type FailureClass = "suppressed" | "recipient" | "systemic" | "config" | "unknown";

/** Local OUTBOUND_ALLOWLIST block - `outbound-allowlist.ts` emits this exact wording. */
const RE_SUPPRESSED = /OUTBOUND_ALLOWLIST is set/i;

/**
 * A template the app cannot legitimately use yet. `not-armed.ts` is the right surface for these,
 * so they are counted and shown but never escalated.
 *
 * Every pattern here matches a string actually present in the live `whatsapp_message.error`
 * column, not a guess. In particular WATI's "typos or blank text" is a PARAM-LIST defect (the
 * mapping supplies a variable the approved template does not declare, or supplies a blank) - it is
 * fixed in WhatsApp → Settings in ten seconds and is emphatically not an outage, so misfiling it
 * as `unknown` would have paged somebody over a config typo.
 */
const RE_CONFIG = [
  /No WATI template configured/i,
  /is (REJECTED|PENDING|PAUSED|DISABLED) in WATI/i,
  /\bexpects\b.*\bcannot supply\b/i,
  /\bneeds\b.*\bhas no value for\b/i,
  /cannot have typos or blank text/i,
  /not configured|not armed|paused/i,
];

/**
 * The channel itself is refusing or unreachable - credentials, DNS, timeouts, provider 5xx.
 *
 * `not authorized to send emails from` is Resend's unverified-sender rejection, which accounted
 * for all 58 historical email failures on live. It is a true systemic outage (every send fails)
 * and the phrasing contains "not authorized", NOT "unauthorized" - so it needs its own pattern.
 */
const RE_SYSTEMIC = [
  /\b(401|403)\b|unauthor|forbidden/i,
  /\bnot authori[sz]ed\b/i,
  /invalid (authorization|api[- ]?key|token|credential)/i,
  /restricted to only send/i, // Resend's send-only-key rejection
  /timed? ?out|ETIMEDOUT|ECONNREFUSED|ECONNRESET|ENOTFOUND|EAI_AGAIN|socket hang up/i,
  /\bHTTP 5\d\d\b/,
  /network|fetch failed/i,
];

export function classifyFailure(error: string | null | undefined): FailureClass {
  const e = (error ?? "").trim();
  if (!e) return "unknown";
  if (RE_SUPPRESSED.test(e)) return "suppressed";
  // Checked before `config`, because a quality restriction names a template and would otherwise
  // be caught by the template-shaped patterns.
  if (isMetaQualityRestriction(e)) return "recipient";
  if (RE_SYSTEMIC.some((r) => r.test(e))) return "systemic";
  if (RE_CONFIG.some((r) => r.test(e))) return "config";
  return "unknown";
}

// ───────────────────────────────── The per-tick tally ─────────────────────────────────

export type DeliveryTally = {
  attempted: number;
  sent: number;
  failed: number;
  /**
   * Failures discovered LATER by `reconcileWhatsAppStatuses`. WATI answers `result:true` and Meta
   * rejects asynchronously, so a synchronous-only tally reports a perfectly healthy channel right
   * through a quality ban - which is exactly the 25-26 Aug 2026 failure mode.
   */
  lateFailed: number;
  byClass: Record<FailureClass, number>;
  /** First failure string of the tick, for the alert body and the Console card. */
  firstError: string | null;
};

export function emptyTally(): DeliveryTally {
  return {
    attempted: 0,
    sent: 0,
    failed: 0,
    lateFailed: 0,
    byClass: { suppressed: 0, recipient: 0, systemic: 0, config: 0, unknown: 0 },
    firstError: null,
  };
}

/** One call per send. Mutating on purpose: this sits in a loop and must not allocate. */
export function tallySend(
  t: DeliveryTally,
  outcome: { sent: boolean; failed: boolean; error?: string | null },
): void {
  if (!outcome.sent && !outcome.failed) return; // a SKIP that never reached the provider
  t.attempted++;
  if (outcome.sent) {
    t.sent++;
    return;
  }
  t.failed++;
  const cls = classifyFailure(outcome.error);
  t.byClass[cls]++;
  if (!t.firstError && outcome.error) t.firstError = outcome.error.slice(0, 300);
}

/** Late (asynchronous) failures from the reconcile pass. `detail` classifies them when known. */
export function tallyLateFailures(t: DeliveryTally, count: number, detail?: string | null): void {
  if (!Number.isFinite(count) || count <= 0) return;
  t.lateFailed += count;
  const cls = classifyFailure(detail);
  t.byClass[cls] += count;
  if (!t.firstError && detail) t.firstError = detail.slice(0, 300);
}

export function mergeTallies(...tallies: (DeliveryTally | null | undefined)[]): DeliveryTally {
  const out = emptyTally();
  for (const t of tallies) {
    if (!t) continue;
    out.attempted += t.attempted;
    out.sent += t.sent;
    out.failed += t.failed;
    out.lateFailed += t.lateFailed;
    for (const k of Object.keys(out.byClass) as FailureClass[]) out.byClass[k] += t.byClass[k] ?? 0;
    if (!out.firstError && t.firstError) out.firstError = t.firstError;
  }
  return out;
}

function looksLikeTally(v: unknown): v is DeliveryTally {
  if (!v || typeof v !== "object") return false;
  const o = v as Record<string, unknown>;
  return typeof o.attempted === "number" && typeof o.sent === "number" && typeof o.failed === "number";
}

/**
 * Pull every tally out of a cron route's JSON payload, wherever an engine put it.
 *
 * This is the seam that keeps `cron-route.ts` ignorant of engine names: `/api/cron/outreach`
 * returns `{sop, callbackChase, stageMessages}` and `/api/cron/whatsapp` returns `{run, bookings}`,
 * and a future engine gets coverage for free just by including a `delivery` field. Bounded in
 * depth and node count, and cycle-guarded, because it walks a value it does not control.
 */
export function collectDelivery(payload: unknown): DeliveryTally | null {
  const found: DeliveryTally[] = [];
  const seen = new WeakSet<object>();
  let budget = 50;

  const walk = (v: unknown, depth: number): void => {
    if (budget <= 0 || depth > 3 || !v || typeof v !== "object") return;
    if (seen.has(v as object)) return;
    seen.add(v as object);
    budget--;

    if (looksLikeTally(v)) {
      found.push(normaliseTally(v));
      return; // a tally has no nested tallies
    }
    for (const child of Object.values(v as Record<string, unknown>)) walk(child, depth + 1);
  };

  walk(payload, 0);
  return found.length ? mergeTallies(...found) : null;
}

/** A tally that crossed a JSON boundary may be missing `byClass` keys or carry junk. */
function normaliseTally(raw: DeliveryTally): DeliveryTally {
  const out = emptyTally();
  const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? Math.max(0, Math.round(v)) : 0);
  out.attempted = num(raw.attempted);
  out.sent = num(raw.sent);
  out.failed = num(raw.failed);
  out.lateFailed = num(raw.lateFailed);
  const by = (raw.byClass ?? {}) as Record<string, unknown>;
  for (const k of Object.keys(out.byClass) as FailureClass[]) out.byClass[k] = num(by[k]);
  out.firstError = typeof raw.firstError === "string" ? raw.firstError.slice(0, 300) : null;
  return out;
}

// ───────────────────────────────── The per-tick verdict ─────────────────────────────────

export type DeliveryVerdict = "idle" | "healthy" | "degraded" | "dead-candidate";

/** Sends that say something about the channel: a local allowlist block does not. */
export function effectiveCounts(t: DeliveryTally): {
  attempted: number;
  failed: number;
  recipientFailed: number;
  escalatable: number;
} {
  const suppressed = t.byClass.suppressed;
  return {
    attempted: Math.max(0, t.attempted - suppressed),
    failed: Math.max(0, t.failed + t.lateFailed - suppressed),
    recipientFailed: t.byClass.recipient,
    // Only these two can argue that the CHANNEL is broken. `recipient` is about one phone number
    // and `config` is a switch, so neither may ever escalate.
    escalatable: t.byClass.systemic + t.byClass.unknown,
  };
}

/**
 * The asymmetries here are the whole safety story:
 *  - nothing attempted is not a failure (an off channel, or simply nothing due);
 *  - ONE success proves the credentials and the provider, so it caps the verdict at `degraded`;
 *  - an all-`recipient` tick is `degraded` no matter how many failed, which is what makes a Meta
 *    cap across forty prospects produce zero alerts.
 */
export function classifyTick(t: DeliveryTally): DeliveryVerdict {
  const e = effectiveCounts(t);
  if (e.attempted === 0 && t.lateFailed === 0) return "idle";
  if (e.failed === 0) return "healthy";
  if (t.sent > 0) return "degraded";
  return e.escalatable > 0 ? "dead-candidate" : "degraded";
}

// ───────────────────────────────── Streak, window, cooldown ─────────────────────────────────

/**
 * How many consecutive all-failing ticks before we call a channel dead.
 *
 * `whatsapp` and `outreach` tick every 60s (`docker/cron/entrypoint.sh`), so 10 is ~10 minutes -
 * against the three days this incident actually took. Deliberately not 1: the dead-man's switch
 * answers "is the scheduler still running?", and letting a single unlucky recipient withhold the
 * ping would page a human about a perfectly healthy scheduler. That false alarm is worse than the
 * failure being fixed here, because it is the one that teaches people to ignore the page.
 */
export const DEAD_TICKS_THRESHOLD: Record<string, number> = {
  whatsapp: 10,
  outreach: 10,
  alerts: 3,
  workflows: 3,
  daily: 2,
};
const DEFAULT_DEAD_TICKS = 3;

export function deadTickThreshold(job: string): number {
  return DEAD_TICKS_THRESHOLD[job] ?? DEFAULT_DEAD_TICKS;
}

/** Re-state a still-dead channel this often. A 3-day outage is 12 events, not 4,320. */
export const RE_ALERT_COOLDOWN_MS = 6 * 60 * 60 * 1000;
const WINDOW_MS = 24 * 60 * 60 * 1000;
/** The window path needs enough evidence that "nothing got through" is not just a quiet day. */
const MIN_WINDOW_ATTEMPTS = 5;
const MIN_WINDOW_AGE_MS = 2 * 60 * 60 * 1000;

export type DeliveryWindow = {
  since: string;
  attempted: number;
  sent: number;
  failed: number;
  recipientFailed: number;
};

export type DeliveryStateJson = {
  lastAttemptAt: string | null;
  lastSentAt: string | null;
  /** When something last failed. Needed to age a resolved wobble out of the Console card. */
  lastFailureAt: string | null;
  deadTicks: number;
  deadSince: string | null;
  lastError: string | null;
  lastClass: FailureClass | null;
  alertedAt: string | null;
  window: DeliveryWindow;
};

function emptyWindow(nowIso: string): DeliveryWindow {
  return { since: nowIso, attempted: 0, sent: 0, failed: 0, recipientFailed: 0 };
}

export function emptyDeliveryState(nowIso: string): DeliveryStateJson {
  return {
    lastAttemptAt: null,
    lastSentAt: null,
    lastFailureAt: null,
    deadTicks: 0,
    deadSince: null,
    lastError: null,
    lastClass: null,
    alertedAt: null,
    window: emptyWindow(nowIso),
  };
}

/** Tolerant of anything the AppSetting row happens to hold, including `undefined` from an old row. */
export function coerceDeliveryState(raw: unknown, nowIso: string): DeliveryStateJson | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const str = (v: unknown) => (typeof v === "string" ? v : null);
  const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? Math.max(0, Math.round(v)) : 0);
  const w = (r.window && typeof r.window === "object" ? r.window : {}) as Record<string, unknown>;
  const classes: FailureClass[] = ["suppressed", "recipient", "systemic", "config", "unknown"];
  const lastClass = str(r.lastClass);
  return {
    lastAttemptAt: str(r.lastAttemptAt),
    lastSentAt: str(r.lastSentAt),
    lastFailureAt: str(r.lastFailureAt),
    deadTicks: num(r.deadTicks),
    deadSince: str(r.deadSince),
    lastError: str(r.lastError),
    lastClass: lastClass && classes.includes(lastClass as FailureClass) ? (lastClass as FailureClass) : null,
    alertedAt: str(r.alertedAt),
    window: {
      since: str(w.since) ?? nowIso,
      attempted: num(w.attempted),
      sent: num(w.sent),
      failed: num(w.failed),
      recipientFailed: num(w.recipientFailed),
    },
  };
}

export type FoldResult = {
  next: DeliveryStateJson | null;
  /** Raise one alert now (first dead tick, or the cooldown has elapsed while still dead). */
  crossedDead: boolean;
  /** Was dead, is not any more, and we had alerted - so close the loop. */
  recovered: boolean;
  /** The channel is currently dead. This is what withholds the dead-man's-switch ping. */
  channelDead: boolean;
  verdict: DeliveryVerdict;
};

/**
 * Fold one tick's tally into the stored state. The entire streak + window + cooldown decision,
 * as one pure function, so the test suite can drive it a tick at a time.
 */
export function foldDelivery(
  prev: DeliveryStateJson | null,
  tally: DeliveryTally | null,
  nowIso: string,
  job: string,
): FoldResult {
  const wasDead = Boolean(prev?.deadSince);

  // A tick that reported nothing must not move anything - but it also must not resurrect a
  // channel that is already dead. Only a successful send does that.
  if (!tally) {
    return { next: prev, crossedDead: false, recovered: false, channelDead: wasDead, verdict: "idle" };
  }

  const verdict = classifyTick(tally);
  const nowMs = Date.parse(nowIso);
  const state: DeliveryStateJson = prev
    ? { ...prev, window: { ...prev.window } }
    : emptyDeliveryState(nowIso);

  // Roll the 24h window before adding to it.
  const windowAge = nowMs - Date.parse(state.window.since);
  if (!Number.isFinite(windowAge) || windowAge > WINDOW_MS) state.window = emptyWindow(nowIso);

  const e = effectiveCounts(tally);
  state.window.attempted += e.attempted;
  state.window.sent += tally.sent;
  state.window.failed += e.failed;
  state.window.recipientFailed += e.recipientFailed;

  if (e.attempted > 0 || tally.lateFailed > 0) state.lastAttemptAt = nowIso;
  if (tally.sent > 0) state.lastSentAt = nowIso;
  if (e.failed > 0) state.lastFailureAt = nowIso;
  if (tally.firstError) {
    state.lastError = tally.firstError;
    state.lastClass = classifyFailure(tally.firstError);
  }

  if (verdict === "dead-candidate") state.deadTicks += 1;
  else if (tally.sent > 0) state.deadTicks = 0;
  // `idle` and `degraded` leave the streak untouched: a recipient cap is not evidence either way.

  // Second route to dead, for an engine that cannot build a streak because it only acts once a
  // day (dunning rides the hourly `daily` tick but runs once per IST day, so 23 of 24 ticks are
  // idle). Recipient-only failures are excluded here too.
  const w = state.window;
  const windowDead =
    w.attempted - w.recipientFailed >= MIN_WINDOW_ATTEMPTS &&
    w.sent === 0 &&
    nowMs - Date.parse(w.since) > MIN_WINDOW_AGE_MS;

  const isDead = state.deadTicks >= deadTickThreshold(job) || windowDead;

  if (isDead && !state.deadSince) state.deadSince = nowIso;
  if (!isDead) state.deadSince = null;

  const alertedMs = state.alertedAt ? Date.parse(state.alertedAt) : NaN;
  const cooldownElapsed = !Number.isFinite(alertedMs) || nowMs - alertedMs >= RE_ALERT_COOLDOWN_MS;
  const crossedDead = isDead && cooldownElapsed;
  if (crossedDead) state.alertedAt = nowIso;

  const recovered = wasDead && !isDead && Boolean(prev?.alertedAt);
  if (!isDead) state.alertedAt = null;

  return { next: state, crossedDead, recovered, channelDead: isDead, verdict };
}

// ───────────────────────────────── Presentation ─────────────────────────────────

/** Which channel a job's sends go out on, for the alert fingerprint and the card title. */
export function channelForJob(job: string): "whatsapp" | "email" | "mixed" {
  if (job === "whatsapp") return "whatsapp";
  if (job === "alerts") return "email";
  if (job === "outreach" || job === "daily") return "mixed";
  return "mixed";
}

export const CHANNEL_LABELS: Record<"whatsapp" | "email" | "mixed", string> = {
  whatsapp: "WhatsApp (WATI)",
  email: "Email (Resend)",
  mixed: "WhatsApp + email",
};

export function formatDuration(ms: number): string {
  if (!Number.isFinite(ms) || ms < 0) return "just now";
  const mins = Math.floor(ms / 60_000);
  if (mins < 1) return "under a minute";
  if (mins < 60) return `${mins} m`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 48) return `${hrs} h ${mins % 60} m`;
  return `${Math.floor(hrs / 24)} d ${hrs % 24} h`;
}

export type DeliveryState = "healthy" | "idle" | "degraded" | "dead";

/**
 * What makes a channel "degraded" rather than just imperfect.
 *
 * A first cut called it degraded on ANY failure in the 24h window, which was wrong in exactly the
 * way this whole feature is meant to avoid: with 23,400 leads and Meta's cap a routine fact of
 * life, one stale phone number would pin a card to the Console for a full day. A list that never
 * empties is a list nobody reads - the same argument that kept this out of `not-armed.ts`.
 *
 * So a degraded verdict needs the trouble to be both MATERIAL (enough failures, and enough of the
 * traffic) and CURRENT (something failed recently). A resolved wobble ages out on its own.
 */
const MIN_DEGRADED_FAILURES = 3;
const MIN_DEGRADED_RATE = 0.1;
const DEGRADED_RECENCY_MS = 6 * 60 * 60 * 1000;

export function degradedVerdict(
  w: { attempted: number; failed: number },
  lastFailureAt: string | null,
  nowMs: number,
): boolean {
  if (w.failed < MIN_DEGRADED_FAILURES) return false;
  if (w.attempted > 0 && w.failed / w.attempted < MIN_DEGRADED_RATE) return false;
  if (!lastFailureAt) return false;
  const age = nowMs - Date.parse(lastFailureAt);
  return Number.isFinite(age) && age <= DEGRADED_RECENCY_MS;
}

/**
 * The copy, in one place, so the home-page card, the Console card and the tests all read the same
 * words. Consequence first and fix second, matching `not-armed.ts` - and the degraded variant
 * deliberately offers no fix, because for Meta's cap there isn't one.
 */
export function describeDelivery(row: {
  job: string;
  channel: "whatsapp" | "email" | "mixed";
  state: DeliveryState;
  deadSinceMs: number | null;
  attempted: number;
  sent: number;
  failed: number;
  recipientFailed: number;
  lastError: string | null;
}): { title: string; body: string } | null {
  const label = CHANNEL_LABELS[row.channel];
  if (row.state === "dead") {
    const since = row.deadSinceMs === null ? "" : ` for ${formatDuration(row.deadSinceMs)}`;
    const err = row.lastError ? ` - "${row.lastError}"` : "";
    return {
      title: `${label} has sent nothing${since}`,
      body:
        `${row.attempted} message${row.attempted === 1 ? "" : "s"} attempted and every one failed${err}. ` +
        `No confirmation, reminder or nudge is reaching anyone, while the outreach ladder keeps advancing. ` +
        `Check the credentials at Console → System, then WhatsApp → History to see who was missed.`,
    };
  }
  if (row.state === "degraded") {
    const cap = row.recipientFailed > 0 ? ` Meta's per-recipient cap on ${row.recipientFailed} of them.` : "";
    return {
      title: `${label} is refusing some messages`,
      body:
        `${row.failed} of ${row.attempted} sends failed in the last 24 h.${cap} ` +
        `Those prospects were not reached and are not retried automatically. History shows who.`,
    };
  }
  return null;
}
