import { runDueOutreach } from "@/server/outreach";
import { runCallbackChase } from "@/server/callback-chase";
import { cronRoute } from "@/server/cron-route";
import { RATE_RULES } from "@/lib/rate-limit";

/**
 * Outreach SOP scheduler seam.
 *
 * CADENCE MATTERS HERE MORE THAN ELSEWHERE. The SOP's tightest rule is Step 2's 5-minute reaction
 * window, and this engine's timing resolution is exactly the cron's interval - a 15-minute cron
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

/**
 * Two engines, one tick.
 *
 * The call-back close-out rides here rather than on /api/cron/daily because its unit is HOURS -
 * the founder's gap is four - and an hourly job cannot tell a chase that ran out at 09:05 from
 * one that ran out at 09:55. It is also the same subject matter: both engines decide when a
 * prospect who never booked has been chased enough. Its own timing tolerance is loose, so it
 * costs one bounded query on a tick that was happening anyway.
 *
 * Run in SEQUENCE, not in parallel. The SOP can mark a journey terminal and the close-out reads
 * `phase` to decide whether a chase is still live; overlapping them would let the sweep act on a
 * journey the ladder was in the middle of giving up on. Sequential also keeps the pooled Supabase
 * connection from carrying two write-heavy engines at once.
 *
 * The close-out is wrapped so it can never take the SOP's tick down with it - the ladder is the
 * time-critical half, and a failure here is reported through the returned payload and the cron
 * heartbeat rather than by losing a minute of SOP scheduling.
 */
async function runOutreachTick() {
  const sop = await runDueOutreach();
  const callbackChase = await runCallbackChase().catch((e) => ({
    error: e instanceof Error ? e.message : String(e),
  }));
  return { sop, callbackChase };
}

export const { GET, POST } = cronRoute("outreach", runOutreachTick, RATE_RULES.cronFrequent);
