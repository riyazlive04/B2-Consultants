import { runDailyLogEod } from "@/server/daily-log-eod";
import { cronRoute } from "@/server/cron-route";

/**
 * Daily-log EOD seam.
 *
 * CADENCE: unlike the outreach route, this one does NOT need a tight tick. The job is a no-op
 * until the founder's cutoff passes and is idempotent afterwards, so anything from "once, just
 * after the cutoff" to "every 15 minutes all day" produces the same rows. A ~15-minute tick is
 * the pragmatic choice - it means a laptop asleep at exactly 9:00 PM still auto-saves when it
 * wakes, instead of missing the day entirely:
 *
 *   every 15 min  curl -fsS -H "x-cron-secret: $CRON_SECRET" https://<host>/api/cron/daily-log
 *
 * The CUTOFF itself does not depend on this route: submitDailyLog reads the real clock, so the
 * deadline is enforced whether or not anything ever ticks. Only auto-save needs the cron.
 *
 * Auth, rate limiting, error capture and the run heartbeat live in `cronRoute`.
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const { GET, POST } = cronRoute("daily-log", runDailyLogEod);
