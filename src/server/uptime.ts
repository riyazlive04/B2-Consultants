import "server-only";
import { prisma } from "@/lib/prisma";
import { captureMessage } from "@/lib/observability";
import { logSystemActivity, SYSTEM_ACTORS, type SystemActor } from "@/server/activity-log";
import {
  channelForJob,
  coerceDeliveryState,
  CHANNEL_LABELS,
  foldDelivery,
  type DeliveryStateJson,
  type DeliveryTally,
} from "@/lib/delivery-health";

/**
 * Uptime monitoring - the half an external URL pinger cannot do.
 *
 * A monitor that GETs /api/health proves the web process is answering. In THIS app that is the
 * less interesting half: every engine (outreach, dunning, digest, overdue sweep, slot top-up) runs
 * only when an external scheduler lands an HTTP request on a cron route. The container can be
 * perfectly healthy for a week while nothing has actually happened - which is close to the state
 * production was already in.
 *
 * So uptime here is TWO things:
 *
 *  1. A cron heartbeat table (AppSetting "cronHeartbeat") recording, per job, when it last ran, when
 *     it last SUCCEEDED, and how many times it has failed in a row. /api/health exposes the ages;
 *     the Founder Console renders them. A job that stops being called goes stale and shows it.
 *
 *  2. A dead-man's switch: after a SUCCESSFUL run we ping `UPTIME_HEARTBEAT_URL` (the shape
 *     Healthchecks.io / BetterStack / Cronitor all use). Silence is the alert. This is the only
 *     design that catches "the scheduled task on the host died" - the failure mode where the app
 *     itself has no way to know anything is wrong, because the code that would notice is the code
 *     that isn't running.
 *
 * Both are optional and keys-off. Never throws - an observability failure must not fail the job it
 * was observing.
 */

const HEARTBEAT_KEY = "cronHeartbeat";

/** How long a job may go unheard-from before the health probe calls it stale. */
export const STALE_AFTER_MINUTES: Record<string, number> = {
  daily: 180, // hourly tick, generous margin for a slow run
  alerts: 30, // */5 tick - this one is meant to be prompt
  outreach: 30,
  // Ticks every 60s (docker/cron/entrypoint.sh), so the old 180 meant a dead reminder engine
  // took three hours to read as stale. It carries the booking confirmations.
  whatsapp: 15,
  workflows: 180,
  "daily-log": 1500, // once a day
  retention: 1500,
};

const DEFAULT_STALE_MINUTES = 180;

export type CronHeartbeat = {
  lastRunAt: string | null;
  lastOkAt: string | null;
  consecutiveFailures: number;
  lastError: string | null;
  /**
   * Delivery health for the channels this job sends on - null for a job that sends nothing, and
   * null on every row written before this field existed. `coerce()` already discards what it does
   * not recognise, so the shape grew with no migration and no backfill.
   */
  delivery: DeliveryStateJson | null;
};

export type HeartbeatMap = Record<string, CronHeartbeat>;

const EMPTY: CronHeartbeat = {
  lastRunAt: null,
  lastOkAt: null,
  consecutiveFailures: 0,
  lastError: null,
  delivery: null,
};

function coerce(raw: unknown): HeartbeatMap {
  if (!raw || typeof raw !== "object") return {};
  const out: HeartbeatMap = {};
  for (const [job, v] of Object.entries(raw as Record<string, unknown>)) {
    const r = (v && typeof v === "object" ? v : {}) as Partial<CronHeartbeat>;
    out[job] = {
      lastRunAt: typeof r.lastRunAt === "string" ? r.lastRunAt : null,
      lastOkAt: typeof r.lastOkAt === "string" ? r.lastOkAt : null,
      consecutiveFailures:
        typeof r.consecutiveFailures === "number" && Number.isFinite(r.consecutiveFailures)
          ? Math.max(0, Math.round(r.consecutiveFailures))
          : 0,
      lastError: typeof r.lastError === "string" ? r.lastError : null,
      delivery: coerceDeliveryState(r.delivery, new Date().toISOString()),
    };
  }
  return out;
}

export async function readHeartbeats(): Promise<HeartbeatMap> {
  try {
    const row = await prisma.appSetting.findUnique({ where: { key: HEARTBEAT_KEY } });
    return coerce(row?.value);
  } catch {
    // The heartbeat lives in the database, so a database outage takes it with it. Returning {}
    // renders every job as "never run", which is the honest reading - we genuinely don't know.
    return {};
  }
}

/**
 * Records the outcome of one cron run and, on success, pings the dead-man's switch.
 *
 * `ok: false` does NOT ping. That is the entire mechanism: a failing job stops feeding the switch,
 * the external monitor's grace period expires, and someone gets paged. Pinging on every run
 * regardless of outcome - a surprisingly common mistake - turns the switch into a liveness check
 * for the scheduler and nothing more.
 */
export async function recordCronRun(
  job: string,
  outcome: { ok: boolean; error?: string; delivery?: DeliveryTally | null },
): Promise<void> {
  const now = new Date().toISOString();
  // Default to pinging on a successful run, exactly as before. Only a channel we have concluded
  // is DEAD withholds it, and only after a streak - see below.
  let shouldPing = outcome.ok;

  try {
    const map = await readHeartbeats();
    const prev = map[job] ?? EMPTY;

    /**
     * The fix for the October 2026 blind spot. An engine whose every send failed still RESOLVES,
     * so `outcome.ok` is true and this function used to ping the dead-man's switch - a total
     * WhatsApp outage was indistinguishable from a healthy minute. `foldDelivery` turns the
     * tick's tally into a streak and tells us when the channel itself is dead; from then on the
     * job counts as failing even though the code ran perfectly.
     *
     * Deliberately NOT triggered by a single bad tick: the switch answers "is the scheduler
     * alive?", and paging someone about a healthy scheduler because one recipient had a stale
     * number is the false alarm that teaches people to ignore the real one.
     */
    const fold = foldDelivery(prev.delivery, outcome.delivery ?? null, now, job);
    const effectiveOk = outcome.ok && !fold.channelDead;
    shouldPing = effectiveOk;

    const channelNote = fold.channelDead
      ? `Channel dead: 0 of ${fold.next?.window.attempted ?? 0} sends succeeded` +
        (fold.next?.lastError ? ` - "${fold.next.lastError}"` : "")
      : null;

    const next: CronHeartbeat = {
      lastRunAt: now,
      lastOkAt: effectiveOk ? now : prev.lastOkAt,
      consecutiveFailures: effectiveOk ? 0 : prev.consecutiveFailures + 1,
      lastError: effectiveOk ? null : (outcome.error ?? channelNote ?? "Unknown error").slice(0, 500),
      delivery: fold.next,
    };
    map[job] = next;
    await prisma.appSetting.upsert({
      where: { key: HEARTBEAT_KEY },
      create: { key: HEARTBEAT_KEY, value: map as object },
      update: { value: map as object },
    });

    // Escalate a job that has failed repeatedly. Once, at the threshold - not on every run after
    // it, or a permanently broken job becomes a permanent alert nobody reads.
    if (!effectiveOk && next.consecutiveFailures === 3) {
      await captureMessage(`Cron job "${job}" has failed 3 times in a row`, {
        where: `cron:${job}`,
        extra: { lastError: next.lastError },
        fingerprint: ["cron-failing", job],
      });
    }

    // The ONLY alert site for a delivery failure, anywhere in the app. Keeping it here rather
    // than on a send path is what makes "at most one event per tick" structural: Meta capping
    // forty recipients in one minute cannot produce forty events, because it cannot reach here.
    if (fold.crossedDead) await announceDelivery(job, next, "dead");
    else if (fold.recovered) await announceDelivery(job, next, "recovered");
  } catch {
    // Swallowed on purpose: see the module note. Recording that a job ran must never be the
    // reason the job is considered to have failed.
  }

  if (shouldPing) await pingHeartbeat(job);
}

/** Which engine's name the feed shows against a delivery transition. */
const JOB_ACTORS: Record<string, SystemActor> = {
  whatsapp: SYSTEM_ACTORS.reminders,
  outreach: SYSTEM_ACTORS.outreach,
  alerts: SYSTEM_ACTORS.alerts,
  daily: SYSTEM_ACTORS.dunning,
  workflows: SYSTEM_ACTORS.automation,
};

/**
 * One Sentry event plus one activity row per transition. The activity row is the part that
 * answers "when did this start?" three days later, which is the question nobody could answer in
 * October - a `captureMessage` alone dies with the container when SENTRY_DSN is unset.
 */
async function announceDelivery(job: string, hb: CronHeartbeat, kind: "dead" | "recovered"): Promise<void> {
  const channel = channelForJob(job);
  const label = CHANNEL_LABELS[channel];
  const d = hb.delivery;
  const attempted = d?.window.attempted ?? 0;
  const summary =
    kind === "dead"
      ? `${label} stopped delivering - ${attempted} send${attempted === 1 ? "" : "s"} failed in a row` +
        (d?.lastError ? ` (${d.lastError})` : "")
      : `${label} is delivering again`;

  await captureMessage(summary, {
    level: kind === "dead" ? "error" : "warning",
    where: `delivery:${job}`,
    extra: { job, channel, attempted, sent: d?.window.sent ?? 0, lastError: d?.lastError ?? null },
    fingerprint: [kind === "dead" ? "delivery-dead" : "delivery-recovered", job, channel],
  }).catch(() => undefined);

  await logSystemActivity(JOB_ACTORS[job] ?? SYSTEM_ACTORS.alerts, {
    action: kind === "dead" ? "delivery.channel.dead" : "delivery.channel.recovered",
    section: job === "outreach" ? "outreach" : "whatsapp",
    entityType: "DeliveryChannel",
    entityId: `${job}:${channel}`,
    summary,
    meta: { job, channel, attempted, lastError: d?.lastError ?? null },
  }).catch(() => undefined);
}

/**
 * The outbound dead-man's-switch ping. No-ops when `UPTIME_HEARTBEAT_URL` is unset.
 *
 * `{job}` in the URL is substituted, so one variable can serve several jobs when the monitoring
 * provider uses per-check slugs (`https://hc-ping.com/<uuid>/{job}`).
 */
export async function pingHeartbeat(job: string): Promise<boolean> {
  const base = process.env.UPTIME_HEARTBEAT_URL?.trim();
  if (!base) return false;
  const url = base.includes("{job}") ? base.replace("{job}", encodeURIComponent(job)) : base;
  try {
    const res = await fetch(url, { method: "GET", signal: AbortSignal.timeout(5000), cache: "no-store" });
    return res.ok;
  } catch {
    return false;
  }
}

export type CronHealthRow = {
  job: string;
  lastRunAt: string | null;
  lastOkAt: string | null;
  ageMinutes: number | null;
  consecutiveFailures: number;
  lastError: string | null;
  stale: boolean;
  /** True when this job has NEVER been seen - i.e. nothing is calling it at all. */
  neverRun: boolean;
  /** Delivery state for the channels this job sends on; null when it sends nothing. */
  delivery: DeliveryStateJson | null;
};

/**
 * The health view. Reports every job we KNOW about (the stale-threshold table) plus anything
 * recorded that isn't in it, so a job added later still shows up without editing this file.
 */
export async function cronHealth(): Promise<CronHealthRow[]> {
  const map = await readHeartbeats();
  const jobs = Array.from(new Set([...Object.keys(STALE_AFTER_MINUTES), ...Object.keys(map)])).sort();
  const now = Date.now();

  return jobs.map((job) => {
    const hb = map[job] ?? EMPTY;
    const okAt = hb.lastOkAt ? Date.parse(hb.lastOkAt) : null;
    const ageMinutes = okAt ? Math.floor((now - okAt) / 60_000) : null;
    const threshold = STALE_AFTER_MINUTES[job] ?? DEFAULT_STALE_MINUTES;
    return {
      job,
      lastRunAt: hb.lastRunAt,
      lastOkAt: hb.lastOkAt,
      ageMinutes,
      consecutiveFailures: hb.consecutiveFailures,
      lastError: hb.lastError,
      // Never-run is reported separately from stale: "we have never heard from this" and "we
      // used to hear from this and stopped" are different problems with different fixes.
      stale: ageMinutes !== null && ageMinutes > threshold,
      neverRun: hb.lastRunAt === null,
      delivery: hb.delivery,
    };
  });
}
