import "server-only";
import type { Source } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { STEP_BY_KEY, isInstantIntroSource } from "@/lib/outreach-sop";
import { logSystemActivity, SYSTEM_ACTORS } from "./activity-log";
import { readOutreachConfig, renderStep, getJourney, markSent, sopWhatsAppSend } from "./outreach";

/**
 * Step 3, sent the instant a lead is captured.
 *
 * ── Why this exists when the engine already auto-sends ───────────────────────────
 * The engine's `autoSendDue()` runs on the cron, so the earliest it can send is the next tick.
 * That is fine for a 36-hour confirmation ladder and wrong for this one message: the SOP's Step 2
 * gives the team a FIVE MINUTE reaction window, and the whole point of automating the intro is to
 * stop that window being spent waiting for a human - or for a scheduler. So this runs inline at
 * capture, exactly as `sendBookingConfirmation` already does the moment a booking is created.
 *
 * The cron path is deliberately left in place rather than replaced. If an instant send is skipped
 * - WATI briefly down, the hourly cap hit - the step stays DUE and the engine retries it. Every
 * failure mode here degrades to "the existing system handles it slightly later", never to
 * "the prospect was never contacted".
 *
 * ── The rule that keeps this safe ────────────────────────────────────────────────
 * This messages REAL people with no human in the loop, so every gate fails closed and the caller
 * gets told which one stopped it. In particular it will not fire for a lead that merely appeared
 * in the database - only for one that arrived through a live capture webhook. That is what stands
 * between this feature and a spreadsheet import WhatsApping 23,500 people.
 */

/** Why an instant intro did not go out. Every value is a normal outcome, not an error. */
export type InstantIntroSkip =
  | "disabled" // the founder has not switched it on
  | "source-not-eligible" // an import or a back-office entry, not a live capture
  | "no-journey" // the lead has no OutreachJourney (should be impossible - logged loudly)
  | "no-phone" // nothing to message
  | "already-sent" // the step is already SENT/SKIPPED - a redelivery, not a second message
  | "hourly-cap" // circuit breaker tripped
  | "unresolved-vars" // the body would render with a blank - never send that
  | "send-skipped"; // WATI off, template unmapped, opted out… the row stays DUE

export type InstantIntroResult = { sent: boolean; skipped: InstantIntroSkip | null };

const HOUR_MS = 3_600_000;

/**
 * Send the intro for a just-captured lead.
 *
 * NEVER THROWS and never rejects. The caller is a lead-capture webhook mid-transaction-commit;
 * a lead that arrives unmessaged is recoverable by the cron, a lead that fails to arrive is not.
 */
export async function sendIntroNow(leadId: string, source: Source): Promise<InstantIntroResult> {
  const skip = (s: InstantIntroSkip): InstantIntroResult => ({ sent: false, skipped: s });
  try {
    if (!isInstantIntroSource(source)) return skip("source-not-eligible");

    const cfg = await readOutreachConfig();
    if (!cfg.instantIntro.enabled) return skip("disabled");

    const journey = await prisma.outreachJourney.findUnique({
      where: { leadId },
      select: { id: true, lead: { select: { phone: true } } },
    });
    if (!journey) {
      // `upsertIntakeLead` creates the journey inside the same transaction as the lead, so this
      // means that invariant broke. Loud, because the SOP queue is blind to a journey-less lead.
      console.error(`[outreach-instant] lead ${leadId} has no outreach journey - cannot send the intro`);
      return skip("no-journey");
    }
    if (!journey.lead.phone) return skip("no-phone");

    /**
     * The circuit breaker, checked BEFORE materialising anything.
     *
     * Counted from `OutreachStepLog` rather than the WhatsApp log because that is the SOP's own
     * record of "the intro went out", and it is the same table the write below touches - one
     * source of truth for the thing being limited.
     */
    const sentLastHour = await prisma.outreachStepLog.count({
      where: {
        step: "INTRO_WHATSAPP",
        status: "SENT",
        actedAt: { gte: new Date(Date.now() - HOUR_MS) },
      },
    });
    if (sentLastHour >= cfg.instantIntro.maxPerHour) {
      // Loud on purpose: at normal volume this can only mean something is wrong upstream.
      console.error(
        `[outreach-instant] hourly cap reached (${sentLastHour}/${cfg.instantIntro.maxPerHour}) - ` +
          `not sending to lead ${leadId}. Steps stay DUE for a human. Check for a looping webhook or a bulk import.`,
      );
      return skip("hourly-cap");
    }

    /**
     * Materialise Step 3 up front, before any send is attempted.
     *
     * Deliberately not left to the engine: the row is what makes the message visible in the queue
     * and, if the send fails, what a specialist picks up. Creating it first means a crash between
     * here and the send leaves a DUE step rather than nothing at all. The `@@unique([journeyId,
     * step])` makes the create idempotent, so a webhook redelivery cannot produce two.
     */
    try {
      await prisma.outreachStepLog.create({
        data: {
          journeyId: journey.id,
          step: "INTRO_WHATSAPP",
          dueAt: new Date(),
          channel: STEP_BY_KEY.INTRO_WHATSAPP.channel,
        },
      });
    } catch {
      /* already materialised - fine, fall through and check its status */
    }

    const row = await getJourney(journey.id);
    const step = row?.steps.find((s) => s.step === "INTRO_WHATSAPP");
    if (!row || !step) return skip("no-journey");
    // A redelivered webhook must not send a second copy. Only a DUE step is sendable.
    if (step.status !== "DUE") return skip("already-sent");

    const specialist = row.respTouchpoint?.name ?? cfg.defaultSpecialistName;
    const { body, unresolved } = renderStep(row, "INTRO_WHATSAPP", specialist);
    if (!body) return skip("send-skipped");
    if (unresolved.length) {
      // An unresolved placeholder renders "Hi ," - the house rule is to leave it for a human
      // rather than send something broken.
      console.warn(`[outreach-instant] lead ${leadId}: intro needs ${unresolved.join(", ")} - left DUE`);
      return skip("unresolved-vars");
    }

    const res = await sopWhatsAppSend(row, "INTRO_WHATSAPP", specialist, body);
    if (!res.sent) {
      // WATI off, template unmapped, prospect opted out. The row stays DUE and the cron will try
      // again if `autoSend.INTRO_WHATSAPP` is on; otherwise a specialist sends it by hand.
      return skip("send-skipped");
    }

    await markSent(step.id, body, null, res.messageId);
    await logSystemActivity(SYSTEM_ACTORS.outreach, {
      action: "outreach.intro.instant",
      section: "outreach",
      entityType: "OutreachJourney",
      entityId: row.id,
      summary: `Sent ${row.lead.name} the discovery-call invite the moment they opted in`,
      meta: { step: "INTRO_WHATSAPP", source, messageId: res.messageId },
    });
    return { sent: true, skipped: null };
  } catch (err) {
    // Swallowed by contract - see the header. The step, if it was created, is DUE for a human.
    console.error(`[outreach-instant] sending the intro for lead ${leadId} failed:`, err);
    return { sent: false, skipped: null };
  }
}
