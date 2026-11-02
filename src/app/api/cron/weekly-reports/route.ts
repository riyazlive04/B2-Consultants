import { cronRoute } from "@/server/cron-route";
import { runWeeklyReports } from "@/server/weekly-report-cycles";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Opens each cohort's weekly report, sends the link, chases whoever has not answered, and
 * closes the week. Ticks every 15 minutes so the configured open and close times land within
 * a quarter of an hour of the minute the founder asked for; the engine itself is idempotent,
 * so a tick that has nothing to do costs one query.
 */
export const { GET, POST } = cronRoute("weekly-reports", runWeeklyReports);
