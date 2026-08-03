import { runDueOutreach } from "@/server/outreach";
import { cronRoute } from "@/server/cron-route";
import { RATE_RULES } from "@/lib/rate-limit";

/**
 * Outreach SOP scheduler seam.
 *
 * CADENCE MATTERS HERE MORE THAN ELSEWHERE. The SOP's tightest rule is Step 2's 5-minute reaction
 * window, and this engine's timing resolution is exactly the cron's interval — a 15-minute cron
 * cannot police a 5-minute SLA. Hit this every 1–2 minutes:
 *
 *   * * * * *  curl -fsS -H "x-cron-secret: $CRON_SECRET" https://<host>/api/cron/outreach
 *
 * The 5-minute window is only ever *reported* late, never enforced wrongly: `reactionState` reads
 * the real clock, so a late tick shows a truthful "breached", just later than ideal. Everything
 * else in the SOP (2h/1h/36h/24h/12h/10h) is comfortably served by a 1–15 minute tick.
 *
 * The frequent rate rule (not the shared hourly one) is what makes the 1-minute tick legal while
 * still bounding a stuck scheduler. Auth, error capture and the heartbeat live in `cronRoute`.
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const { GET, POST } = cronRoute("outreach", runDueOutreach, RATE_RULES.cronFrequent);
