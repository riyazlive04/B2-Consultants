/**
 * "Was this prospect actually told when their call is?" - and the pre-call reminder cadence that
 * depends on the same facts. Pure: no prisma, no clock, so the rules can be tested at their edges.
 *
 * Why this exists (17-18/09/2026): a discovery call was moved to a new time, the "rescheduled"
 * WhatsApp FAILED on Meta's per-user marketing cap, every pre-call reminder FAILED the same way,
 * and two hours after the new slot the no-show sweep wrote the booking off as NO_SHOW and the
 * lead as LOST. She was never told the new time. The sweep asked "did they confirm?" and never
 * "did we ever reach them about THIS time?".
 */

import type { WhatsAppKind, WhatsAppStatus } from "@prisma/client";

const HR = 3_600_000;

/**
 * Statuses that mean the message left WATI and was not rejected afterwards.
 *
 * SENT counts: it is "accepted by WATI", and a later rejection by Meta is written back as FAILED
 * by the status webhook and by `reconcileWhatsAppStatuses`. QUEUED does not count - nothing has
 * confirmed it left - and neither do FAILED and SKIPPED, which are exactly the case this module
 * exists for.
 */
const DELIVERED: ReadonlySet<WhatsAppStatus> = new Set<WhatsAppStatus>(["SENT", "DELIVERED", "READ", "REPLIED"]);

export function isDeliveredStatus(status: WhatsAppStatus): boolean {
  return DELIVERED.has(status);
}

/**
 * Every outbound kind whose text names the discovery call's date and time. The Bookings kinds
 * carry it as `slot_time`, the SOP kinds as `date` + `time`; both come from the same IST
 * formatter, which is what makes them comparable with `slotLabel` below.
 */
export const CALL_TIME_KINDS: readonly WhatsAppKind[] = [
  "BOOKING_CONFIRMATION",
  "BOOKING_CONFIRM_REQUEST",
  "BOOKING_RESCHEDULED",
  "BOOKING_REMINDER",
  "SOP_DISCO_WELCOME",
  "SOP_DISCO_CONFIRM_1",
  "SOP_DISCO_CONFIRM_2",
];

/**
 * The call time a logged message named, read back from the variables it was sent with
 * (`WhatsAppMessage.params = { template, vars }`). Null when it named none, or the row predates
 * the params log - which the callers treat as "not about this time", the fail-closed reading.
 */
export function namedCallTime(params: unknown): string | null {
  const vars = (params as { vars?: Record<string, unknown> } | null)?.vars;
  if (!vars || typeof vars !== "object") return null;
  if (typeof vars.slot_time === "string" && vars.slot_time) return vars.slot_time;
  // `whatsappVarsFor` splits "Sat 18 Jul, 07:00 PM" at its LAST ", " - rejoining the halves the
  // same way gives back exactly the string `formatDateTimeInZone` produced.
  if (typeof vars.date === "string" && typeof vars.time === "string" && vars.date && vars.time) {
    return `${vars.date}, ${vars.time}`;
  }
  return null;
}

export type NoticeRow = { kind: WhatsAppKind; status: WhatsAppStatus; params: unknown; createdAt: Date };

export type CallNotice =
  | { told: true }
  | { told: false; reason: "never-told" | "last-notice-undelivered" };

/**
 * Was the prospect told the call's CURRENT time, and did the latest word about it reach them?
 *
 * `slotLabel` is the current slot formatted exactly as the senders format it
 * (`formatDateTimeInZone(startsAt, "Asia/Kolkata")`). A message naming an OLD time - the booking
 * confirmation before a reschedule - says nothing about whether they know the new one, so only
 * messages naming this exact label count.
 *
 * Two ways to be "not told":
 *   · nothing naming this time was ever delivered, or
 *   · the MOST RECENT message naming it did not deliver. A confirmation that landed followed by a
 *     reminder that bounced is not proof they have the time in mind; it is a reason for a human
 *     to look before the prospect is written off.
 */
export function callTimeNotice(rows: readonly NoticeRow[], slotLabel: string): CallNotice {
  const aboutThisTime = rows
    .filter((r) => CALL_TIME_KINDS.includes(r.kind) && namedCallTime(r.params) === slotLabel)
    .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
  if (!aboutThisTime.some((r) => isDeliveredStatus(r.status))) return { told: false, reason: "never-told" };
  if (!isDeliveredStatus(aboutThisTime[0].status)) return { told: false, reason: "last-notice-undelivered" };
  return { told: true };
}

/**
 * Which pre-call reminder rung, if any, should go out for this booking right now.
 *
 * `leadHours` are the configured offsets ("24, 2" = T-24h and T-2h). A rung OPENS at
 * `slot - h`, and the rung that matters is the most recent one to open. It is sent at most ONCE:
 * any earlier attempt at or after the rung opened - SENT, FAILED or SKIPPED alike - closes it.
 *
 * This replaces "send on the first tick inside the widest window, then every `min(leadHours)`
 * hours until `maxCount` succeed, plus two retries". That cadence never honoured the offsets (with
 * "24, 2" the second reminder went out at T-22h, not T-2h), and because only SUCCESSES counted
 * toward the cap, a number Meta had restricted was retried every spacing interval until the call
 * passed: six failed reminders to one prospect on 17-18/09/2026, each one deepening the very
 * restriction that stopped them. A rung that failed now waits for the next rung.
 *
 * `attempts` should include every message about this booking's time (the confirmation and the
 * reschedule notice too), so a booking made at T-20h is not "reminded" minutes after its own
 * confirmation just because the T-24h rung is technically open.
 *
 * `remindersSoFar` - every BOOKING_REMINDER attempt this booking has ever had - caps the total
 * at one per configured offset. That keeps the change strictly "same or fewer": a booking already
 * reminded twice under the old cadence (T-24h and T-22h) is not reminded a third time at T-2h
 * just because the new rule would have spaced them differently.
 *
 * Returns the rung in hours, or null when nothing is due.
 */
export function dueReminderRung(
  slotAt: Date,
  leadHours: readonly number[],
  now: Date,
  attempts: readonly Date[],
  remindersSoFar = 0,
): number | null {
  const slot = slotAt.getTime();
  const t = now.getTime();
  if (t >= slot) return null;
  if (remindersSoFar >= leadHours.length) return null;
  const open = leadHours.filter((h) => Number.isFinite(h) && h > 0 && slot - h * HR <= t);
  if (open.length === 0) return null;
  const rung = Math.min(...open);
  const opensAt = slot - rung * HR;
  if (attempts.some((a) => a.getTime() >= opensAt)) return null;
  return rung;
}

/**
 * Meta's per-user marketing cap, as WATI reports it: "Message undeliverable as Meta has
 * restricted it for higher quality messaging". It is a statement about this RECIPIENT's recent
 * marketing volume, so an immediate retry cannot succeed and only adds to the count Meta is
 * already holding against the number.
 */
export function isMetaQualityRestriction(error: string | null | undefined): boolean {
  return /restricted it for higher quality|higher quality messaging/i.test(error ?? "");
}

/**
 * May the SOP auto-sender try this step again after earlier attempts failed?
 *
 * A DUE step whose send FAILED used to be re-attempted on every engine tick, for as long as it
 * stayed due. That is right for a blip (WATI briefly down, a timeout), which is why one retry is
 * still allowed, and wrong for everything else: after two provider failures, or after one Meta
 * quality restriction, the step stays DUE for the specialist to send by hand or skip. Only
 * FAILED attempts are passed in - a SKIPPED row means nothing left the app and is already
 * de-duplicated by the send layer.
 */
export function mayRetryAutoSend(failures: readonly { error: string | null }[]): boolean {
  if (failures.some((f) => isMetaQualityRestriction(f.error))) return false;
  return failures.length < 2;
}
