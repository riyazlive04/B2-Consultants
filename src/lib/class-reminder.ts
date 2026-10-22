/**
 * Class reminders - pure rules for "whose class is about to start, and have we said so yet".
 *
 * NO prisma, NO server-only: the WhatsApp engine (`server/class-reminders.ts`), the in-app
 * notification bell (`server/notifications.ts`) and the tests all read from here, and the first
 * two must agree about what "starting soon" means. Two definitions of soon is how a student gets
 * a WhatsApp for a class their own app is not yet showing.
 *
 * ── Why the rung logic is borrowed, not rewritten ───────────────────────────────────────
 * `dueReminderRung` in `call-notice.ts` already answers this exact question for pre-call
 * reminders: given a time, a ladder of lead windows and the attempts already made, which rung
 * is due right now. A class is the same shape with a roster instead of one prospect, so it
 * re-uses that function rather than growing a second implementation that could drift.
 */

import { dueReminderRung } from "./call-notice";
import { DAY_NAMES } from "./curriculum";

const MIN = 60_000;

/** A class, reduced to what deciding a reminder actually needs. */
export type ReminderSession = {
  id: string;
  title: string;
  startsAt: Date;
  durationMins: number | null;
  joinUrl: string | null;
  /** PRE_RECORDED modules have no clock, so they are never reminded about. */
  delivery: "LIVE" | "PRE_RECORDED";
};

/**
 * Which rung (minutes-before) is due for this class right now, or null for none.
 *
 * `attempts` is the timestamps of reminders already sent for this class to this recipient.
 * Returning the rung rather than a boolean is what lets the caller say "starting in 1 hour"
 * instead of a vague "soon".
 */
export function classReminderRung(
  session: Pick<ReminderSession, "startsAt" | "delivery">,
  leadMinutes: readonly number[],
  now: Date,
  attempts: readonly Date[],
): number | null {
  // A video module has no start time to count down to - `startsAt` carries its release DAY.
  // Reminding someone that a recording is available at 00:00 IST is noise, not a service.
  if (session.delivery === "PRE_RECORDED") return null;
  return dueReminderRung(session.startsAt, leadMinutes, now, attempts, attempts.length);
}

/** The furthest-out rung, in milliseconds - the window a query needs to look ahead over. */
export function maxLeadMs(leadMinutes: readonly number[]): number {
  const valid = leadMinutes.filter((m) => Number.isFinite(m) && m > 0);
  return valid.length ? Math.max(...valid) * MIN : 0;
}

/**
 * "in 1 hour" / "in 24 hours" / "in 20 minutes" - how a rung reads in a message.
 *
 * Rounded to whole units on purpose: a template that says "starting in 1 hour" when the cron
 * fired at 61 minutes is honest, and "starting in 1.0167 hours" is not a sentence.
 */
export function leadLabel(minutes: number): string {
  if (minutes % 1440 === 0) {
    const d = minutes / 1440;
    return d === 1 ? "tomorrow" : `in ${d} days`;
  }
  if (minutes % 60 === 0) {
    const h = minutes / 60;
    return h === 1 ? "in 1 hour" : `in ${h} hours`;
  }
  return `in ${minutes} minutes`;
}

/**
 * The class time as a student in India reads it: "Sat 4 Oct, 08:00 PM IST".
 *
 * Formatted here rather than with `toLocaleString` so the string is identical on the VPS (UTC),
 * on a founder's laptop in Germany and in a test. A reminder that names a different time than
 * the timetable is worse than no reminder.
 */
export function formatClassTime(startsAt: Date): string {
  const ist = new Date(startsAt.getTime() + 5.5 * 3_600_000);
  const day = DAY_NAMES[ist.getUTCDay()].slice(0, 3);
  const date = ist.getUTCDate();
  const month = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"][ist.getUTCMonth()];
  const h24 = ist.getUTCHours();
  const mins = String(ist.getUTCMinutes()).padStart(2, "0");
  const period = h24 < 12 ? "AM" : "PM";
  const h12 = String(h24 % 12 === 0 ? 12 : h24 % 12).padStart(2, "0");
  return `${day} ${date} ${month}, ${h12}:${mins} ${period} IST`;
}

/**
 * How far ahead the in-app bell starts showing a class.
 *
 * Deliberately shorter than the WhatsApp ladder's widest rung (a day), and deliberately ONE
 * number rather than the configured ladder. The two channels are answering different questions:
 * WhatsApp interrupts you the day before so you can plan around it, whereas the bell is read
 * when you are already in the app and wants to say "this is happening now, here is the link".
 * A bell that lit up 24 hours early would be background noise by the time it mattered.
 */
export const IN_APP_CLASS_ALERT_MINUTES = 120;

/**
 * Should the in-app bell be showing this class right now?
 *
 * Deliberately DERIVED rather than stored. An in-app alert has no delivery to prove and no
 * duplicate to avoid - the bell is recomputed on every page load - so a row recording that we
 * "showed" it would be a second source of truth that could disagree with the screen. The
 * WhatsApp ladder is the only half that needs a memory, because a message cannot be un-sent.
 *
 * The window is open-ended at the near edge: it keeps showing through the class itself (plus
 * its duration), because an alert that disappears the moment the class starts vanishes exactly
 * when the person is looking for the link.
 */
export function isClassAlertOpen(
  session: Pick<ReminderSession, "startsAt" | "durationMins" | "delivery">,
  now: Date,
  windowMinutes: number,
): boolean {
  if (session.delivery === "PRE_RECORDED") return false;
  const start = session.startsAt.getTime();
  const end = start + (session.durationMins ?? 90) * MIN;
  const t = now.getTime();
  return t >= start - windowMinutes * MIN && t <= end;
}

/** "starts in 25 minutes" / "started 10 minutes ago" / "starts tomorrow" - the bell's own line. */
export function alertCountdown(startsAt: Date, now: Date): string {
  const diffMin = Math.round((startsAt.getTime() - now.getTime()) / MIN);
  if (diffMin < 0) {
    const ago = Math.abs(diffMin);
    return ago < 60 ? `started ${ago} minute${ago === 1 ? "" : "s"} ago` : "in progress";
  }
  if (diffMin === 0) return "starting now";
  if (diffMin < 60) return `starts in ${diffMin} minute${diffMin === 1 ? "" : "s"}`;
  const hours = Math.round(diffMin / 60);
  if (hours < 24) return `starts in ${hours} hour${hours === 1 ? "" : "s"}`;
  const days = Math.round(hours / 24);
  return days === 1 ? "starts tomorrow" : `starts in ${days} days`;
}
