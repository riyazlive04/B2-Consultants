import { runSpeedToLeadAlert } from "@/server/speed-to-lead-alert";
import { cronRoute } from "@/server/cron-route";
import { RATE_RULES } from "@/lib/rate-limit";

/**
 * Time-sensitive alerting.
 *
 * A SEPARATE ROUTE from /api/cron/daily, because cadence is the whole point. The daily route
 * ticks hourly; a rule about leads going unanswered for fifteen minutes cannot be policed by
 * something that runs every sixty. Hit this every five:
 *
 *   every 5 min  curl -fsS -H "x-cron-secret: $CRON_SECRET" https://<host>/api/cron/alerts
 *
 * The engine carries its own cooldown, so a tighter tick makes the alert more timely without
 * making it noisier - the cadence and the send frequency are independent.
 *
 * Auth, rate limiting, error capture and the run heartbeat live in `cronRoute`. The alert itself
 * ships OFF and no-ops until the founders configure recipients and arm it.
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const { GET, POST } = cronRoute("alerts", runSpeedToLeadAlert, RATE_RULES.cronFrequent);
