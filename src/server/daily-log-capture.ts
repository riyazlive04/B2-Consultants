import "server-only";
import { prisma } from "@/lib/prisma";
import { ACTIVE } from "@/lib/soft-delete";
import type { LogVariant } from "@/lib/daily-log";

/**
 * Auto activity-capture (report §3.A P1): derive a member's daily-log numbers from what they
 * ACTUALLY did in the app that day, rather than asking them to re-key it.
 *
 * Extracted from getMyDailyLogView so the EOD job can call it for ANY user, not just the one
 * holding the session. Both callers MUST share this one implementation: the form pre-fills from
 * it and the EOD job writes rows from it, and if those two ever drifted, an auto-saved row would
 * silently disagree with what the member saw on screen an hour earlier.
 *
 * WHAT IT CANNOT SEE — this is load-bearing, not a footnote. Several fields have no event source
 * anywhere in the schema and are always absent from the result:
 *     followUpMessagesSent   (APPOINTMENT_SETTER) — no per-message record until WATI logs one
 *     studentsCheckedInOn    (DELIVERY_COACH)     — no check-in event
 *     assignmentsReviewed    (DELIVERY_COACH)     — no review event
 * The Telecaller Pay board sums followUpMessagesSent into "calls", so a row built only from this
 * function reads LOW against a hand-entered one. That is why EOD_AUTO rows stay amendable
 * (see submitDailyLog) instead of being final like a HUMAN submission.
 */

const IST_OFFSET_MS = 5.5 * 3600000;

/**
 * Numbers derivable for `variant` on `date`. Keys absent from the result have no activity
 * source — never coerce those to 0, or "nobody reported it" becomes "they did none".
 *
 * `date` is a UTC-midnight @db.Date value (the DailyLog.date encoding).
 */
export async function computeAutoCapture(
  userId: string,
  variant: LogVariant | string | null,
  date: Date,
): Promise<Record<string, number>> {
  // The IST day as real instants — createdAt/changedAt are TIMESTAMPs, so a raw UTC-midnight
  // boundary would shift the window 5.5h late (lib/dates.ts istBoundaryToInstant).
  const istDayStartUtc = new Date(date.getTime() - IST_OFFSET_MS);
  const istDayEndUtc = new Date(istDayStartUtc.getTime() + 86400000);
  const tsRange = { gte: istDayStartUtc, lt: istDayEndUtc };
  const auto: Record<string, number> = {};

  if (variant === "DISCOVERY_SPECIALIST") {
    const [outcomes, proposals, followUps] = await Promise.all([
      prisma.discoveryOutcome.findMany({ where: { enteredById: userId, callDate: date } }),
      prisma.leadStageHistory.count({
        where: { changedById: userId, toStage: "PROPOSAL_SENT", changedAt: tsRange },
      }),
      // follow-ups done today = outcomes this user marked "follow up needed" today
      prisma.discoveryOutcome.count({
        where: { enteredById: userId, outcome: "FOLLOW_UP_NEEDED", callDate: date },
      }),
    ]);
    auto.discoveryCallsCompleted = outcomes.length;
    auto.highlyQualifiedCalls = outcomes.filter((o) => o.highlyQualified).length;
    auto.noShows = outcomes.filter((o) => o.outcome === "NO_SHOW").length;
    auto.proposalsSent = proposals;
    auto.followUpsDone = followUps;
  } else if (variant === "APPOINTMENT_SETTER") {
    const [leadsAdded, appointments, contacted] = await Promise.all([
      prisma.lead.count({ where: { ...ACTIVE, enteredById: userId, createdAt: tsRange } }),
      prisma.leadStageHistory.count({
        where: { changedById: userId, toStage: "DISCO_BOOKED", changedAt: tsRange },
      }),
      // new leads contacted today = leads this setter owns whose first-contact was stamped
      // today (speed-to-lead: markLeadContacted). Follow-up MESSAGES have no source until
      // the Wave-2 WhatsApp channel - that field stays manual.
      prisma.lead.count({
        where: {
          ...ACTIVE,
          OR: [{ assignedToId: userId }, { enteredById: userId }],
          contactedAt: tsRange,
        },
      }),
    ]);
    auto.leadsAddedToPipeline = leadsAdded;
    auto.appointmentsSet = appointments;
    auto.newLeadsContacted = contacted;
  } else if (variant === "DELIVERY_COACH") {
    // Karthick is the sole coach, so student-level activity today attributes to him.
    const [sessions, atRisk] = await Promise.all([
      prisma.enrollment.count({ where: { lastSessionDate: date } }),
      prisma.signalChangeLog.count({ where: { changedById: userId, newSignal: "RED", date: tsRange } }),
    ]);
    auto.sessionsDelivered = sessions;
    auto.studentsFlaggedAtRisk = atRisk;
    // check-ins + assignments reviewed have no clean per-event source yet - manual.
  }

  return auto;
}
