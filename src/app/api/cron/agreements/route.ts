import { runAgreementRemindersJob } from "@/server/agreement-reminders";
import { cronRoute } from "@/server/cron-route";

/**
 * Chases unsigned agreements, on the schedule the founder set in Console → Agreements.
 *
 *   daily  curl -fsS -H "x-cron-secret: $CRON_SECRET" https://<host>/api/cron/agreements
 *
 * Idempotent and safe to run often: every nudge is recorded on the agreement's append-only trail
 * with the day it was for, and a day already recorded is never sent again. Running it twice in one
 * morning therefore sends nothing twice.
 *
 * Auth, rate limiting, error capture and the run heartbeat live in `cronRoute`. Fail-closed (503)
 * when CRON_SECRET is unset. The reminder engine is OFF until a reminder day is switched on.
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const { GET, POST } = cronRoute("agreements", runAgreementRemindersJob);
