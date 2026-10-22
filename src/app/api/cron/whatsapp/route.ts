import { runDueReminders } from "@/server/whatsapp";
import { runBookingConfirmations } from "@/server/booking-automation";
import { runClassReminders } from "@/server/class-reminders";
import { runAbsenceNotices } from "@/server/absence-notices";
import { cronRoute } from "@/server/cron-route";

/**
 * Scheduled reminder trigger. An external scheduler (Hostinger cron / crontab / cron-job.org) hits
 * this every ~15 min; it runs the due WhatsApp reminders AND the bookings confirmation loop
 * (confirm-or-cancel + promote-next), returning a summary of both. One cron entry drives all of the
 * app's outbound cadence - there is no long-running worker. It's also what the Admin
 * "Run reminders now" button calls (via the server action).
 *
 * Auth, rate limiting, error capture and the run heartbeat live in `cronRoute`. Fail-closed (503)
 * when CRON_SECRET is unset; the reminder engine itself no-ops when WATI is off.
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const { GET, POST } = cronRoute("whatsapp", async () => {
  const run = await runDueReminders();
  // Same tick, same seam: drive the bookings confirmation loop. Independently guarded (it no-ops
  // when the loop is off). Its failure is caught HERE rather than allowed to reach cronRoute,
  // because a broken confirmation loop must not mark the whole WhatsApp job as failed - the
  // reminders above already went out, and the heartbeat would then be lying.
  const bookings = await runBookingConfirmations().catch((e) => ({ error: String(e) }));
  // Third engine on the same tick, caught the same way and for the same reason: a class
  // reminder that throws must not mark a job as failed whose payment reminders already went
  // out. It no-ops unless Cadence arms it, and rehearses until the dry run is turned off.
  const classes = await runClassReminders().catch((e) => ({ error: String(e) }));
  // Fourth engine, caught the same way. It sweeps PUBLISHED registers for absences and for
  // recordings nobody has watched, and no-ops unless Cadence arms it.
  const absences = await runAbsenceNotices().catch((e) => ({ error: String(e) }));
  return { run, bookings, classes, absences };
});
