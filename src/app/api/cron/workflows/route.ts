import { runDueWorkflows } from "@/server/automation";
import { cronRoute } from "@/server/cron-route";

/**
 * Scheduled automation runner. An external scheduler hits this every ~5–15 min; it resumes every
 * workflow enrollment whose WAIT has elapsed (and any freshly-created ones).
 *
 * Auth, rate limiting, error capture and the run heartbeat live in `cronRoute`. Fail-closed (503)
 * when CRON_SECRET is unset.
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const { GET, POST } = cronRoute("workflows", runDueWorkflows);
