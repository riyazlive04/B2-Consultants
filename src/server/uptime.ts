import "server-only";
import { prisma } from "@/lib/prisma";
import { captureMessage } from "@/lib/observability";

/**
 * Uptime monitoring — the half an external URL pinger cannot do.
 *
 * A monitor that GETs /api/health proves the web process is answering. In THIS app that is the
 * less interesting half: every engine (outreach, dunning, digest, overdue sweep, slot top-up) runs
 * only when an external scheduler lands an HTTP request on a cron route. The container can be
 * perfectly healthy for a week while nothing has actually happened — which is close to the state
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
 *     design that catches "the scheduled task on the host died" — the failure mode where the app
 *     itself has no way to know anything is wrong, because the code that would notice is the code
 *     that isn't running.
 *
 * Both are optional and keys-off. Never throws — an observability failure must not fail the job it
 * was observing.
 */

const HEARTBEAT_KEY = "cronHeartbeat";

/** How long a job may go unheard-from before the health probe calls it stale. */
export const STALE_AFTER_MINUTES: Record<string, number> = {
  daily: 180, // hourly tick, generous margin for a slow run
  alerts: 30, // */5 tick — this one is meant to be prompt
  outreach: 30,
  whatsapp: 180,
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
};

export type HeartbeatMap = Record<string, CronHeartbeat>;

const EMPTY: CronHeartbeat = { lastRunAt: null, lastOkAt: null, consecutiveFailures: 0, lastError: null };

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
    // renders every job as "never run", which is the honest reading — we genuinely don't know.
    return {};
  }
}

/**
 * Records the outcome of one cron run and, on success, pings the dead-man's switch.
 *
 * `ok: false` does NOT ping. That is the entire mechanism: a failing job stops feeding the switch,
 * the external monitor's grace period expires, and someone gets paged. Pinging on every run
 * regardless of outcome — a surprisingly common mistake — turns the switch into a liveness check
 * for the scheduler and nothing more.
 */
export async function recordCronRun(
  job: string,
  outcome: { ok: boolean; error?: string },
): Promise<void> {
  const now = new Date().toISOString();
  try {
    const map = await readHeartbeats();
    const prev = map[job] ?? EMPTY;
    const next: CronHeartbeat = {
      lastRunAt: now,
      lastOkAt: outcome.ok ? now : prev.lastOkAt,
      consecutiveFailures: outcome.ok ? 0 : prev.consecutiveFailures + 1,
      lastError: outcome.ok ? null : (outcome.error ?? "Unknown error").slice(0, 500),
    };
    map[job] = next;
    await prisma.appSetting.upsert({
      where: { key: HEARTBEAT_KEY },
      create: { key: HEARTBEAT_KEY, value: map as object },
      update: { value: map as object },
    });

    // Escalate a job that has failed repeatedly. Once, at the threshold — not on every run after
    // it, or a permanently broken job becomes a permanent alert nobody reads.
    if (!outcome.ok && next.consecutiveFailures === 3) {
      await captureMessage(`Cron job "${job}" has failed 3 times in a row`, {
        where: `cron:${job}`,
        extra: { lastError: next.lastError },
        fingerprint: ["cron-failing", job],
      });
    }
  } catch {
    // Swallowed on purpose: see the module note. Recording that a job ran must never be the
    // reason the job is considered to have failed.
  }

  if (outcome.ok) await pingHeartbeat(job);
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
  /** True when this job has NEVER been seen — i.e. nothing is calling it at all. */
  neverRun: boolean;
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
    };
  });
}
