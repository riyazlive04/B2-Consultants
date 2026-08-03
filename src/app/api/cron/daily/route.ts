import { runDailyMaintenance } from "@/server/daily-maintenance";
import { cronRoute } from "@/server/cron-route";

/**
 * Daily-maintenance seam (audit §C). Runs the once-a-day housekeeping orchestrator: FX prewarm,
 * OVERDUE sweep, invoice issuance backfill, retention purge/sweep (once/day), the dunning ladder
 * and the scheduled founder digest.
 *
 * CADENCE: an hourly tick is the pragmatic choice — every sub-job is idempotent, and the hourly
 * cadence lets the scheduled-report send fire close to its configured IST time while the
 * once-per-day guards keep the destructive work to a single run:
 *
 *   0 * * * *  curl -fsS -H "x-cron-secret: $CRON_SECRET" https://<host>/api/cron/daily
 *
 * Auth (CRON_SECRET, three presentations, constant-time), rate limiting, error capture and the run
 * heartbeat all live in `cronRoute` — see server/cron-route.ts. Fail-closed (503) when the secret
 * is unset; each engine inside no-ops when disabled in settings.
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const { GET, POST } = cronRoute("daily", runDailyMaintenance);
