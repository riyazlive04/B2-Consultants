import { runRetentionPurge } from "@/server/retention";
import { cronRoute } from "@/server/cron-route";

/**
 * Retention purge seam (dashboard issue 7.4). Permanently deletes archived records older than the
 * retention window (default 90 days). The job is idempotent and safe to run often — "once a day"
 * is the intended cadence:
 *
 *   daily  curl -fsS -H "x-cron-secret: $CRON_SECRET" https://<host>/api/cron/retention
 *
 * Auth, rate limiting, error capture and the run heartbeat live in `cronRoute`. Fail-closed (503)
 * when CRON_SECRET is unset.
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const { GET, POST } = cronRoute("retention", runRetentionPurge);
