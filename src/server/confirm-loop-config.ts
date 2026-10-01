import "server-only";
import { revalidatePath } from "next/cache";
import type { AppSession } from "@/lib/rbac";
import { bookingRulesConfigSchema } from "@/lib/config-schema";
import { coerceDurationMinutes } from "@/lib/duration";
import { BOOKING_RULES_KEY, getBookingRulesConfig, writeBookingRulesConfig } from "./founder-config";
import { logActivity, diffFields } from "./activity-log";

/**
 * The confirm-or-cancel settings have THREE doors - WhatsApp → Settings, Bookings → Manage
 * availability, and Console → Confirm-or-cancel - and exactly one implementation, which is this.
 *
 * Three doors is the founder's call: the rule belongs beside the WhatsApp template that asks the
 * question, beside the calendar it releases slots on, and in the console where every other
 * automation is armed. Three COPIES of the parsing would be the actual mistake - these numbers
 * decide when a real prospect's booked call is cancelled, and a door that validated the pair
 * differently would be a way to store a combination the engine cannot honour.
 *
 * Two rules every door inherits:
 *  - Merged over the stored config, never built from the form alone, so a door that does not carry
 *    `bufferMinutes` cannot reset it to the shipped default.
 *  - Nothing is written until the WHOLE merged config validates, including the "ask lead must be
 *    wider than the cancel window" refinement. An invalid pair is refused with the reason; it used
 *    to be written and then silently coerced back to defaults on the next read.
 */

export type ConfirmLoopSave =
  | { ok: false; error: string }
  /** `write` is absent when nothing about the loop changed - saving then is a no-op, not a failure. */
  | { ok: true; write?: () => Promise<void> };

/**
 * Validate the confirm-loop half of a form and hand back the write rather than performing it.
 *
 * Deferred on purpose: the WhatsApp settings form saves two different configs, and it used to
 * write `watiConfig` first and validate this second - so a refused window pair reported failure on
 * a form that had already half-saved. The caller can now refuse everything before either config is
 * touched.
 *
 * `origin` only ever reaches the activity line. It is worth carrying: "who changed the auto-cancel
 * window" is a question you ask after a prospect was cancelled, and knowing which screen it came
 * from is most of the answer.
 */
export async function prepareConfirmLoopSave(
  form: FormData,
  session: AppSession,
  origin: string,
): Promise<ConfirmLoopSave> {
  const current = await getBookingRulesConfig();
  const checked = (name: string) => {
    const v = form.get(name);
    return v === "on" || v === "true";
  };
  const next = {
    ...current,
    autoCancelEnabled: checked("autoCancelEnabled"),
    promoteNext: checked("promoteNext"),
    // An unreadable duration keeps what is stored rather than snapping to a default: a typo in
    // this box must not quietly move every prospect's cancellation deadline.
    confirmRequestLeadMinutes: coerceDurationMinutes(form.get("confirmRequestLead"), current.confirmRequestLeadMinutes),
    autoCancelMinutes: coerceDurationMinutes(form.get("autoCancelWindow"), current.autoCancelMinutes),
    confirmReplyGraceMinutes: Math.max(
      5,
      coerceDurationMinutes(form.get("confirmReplyGrace"), current.confirmReplyGraceMinutes, 1440),
    ),
  };
  const valid = bookingRulesConfigSchema.safeParse(next);
  if (!valid.success) {
    return {
      ok: false,
      error: valid.error.issues[0]?.message ?? "The auto-cancel windows don't make sense together",
    };
  }
  const diff = diffFields<Record<string, unknown>>(current, valid.data);
  if (!diff.changed.length) return { ok: true };

  return {
    ok: true,
    write: async () => {
      await writeBookingRulesConfig(valid.data);
      await logActivity(session, {
        action: "booking.rules.update",
        section: "bookings",
        entityType: "AppSetting",
        entityId: BOOKING_RULES_KEY,
        summary: `Updated the confirm-or-cancel loop from ${origin} - changed ${diff.changed.join(", ")}`,
        meta: { changed: diff.changed, before: diff.before, after: diff.after, origin },
      });
      revalidatePath("/bookings");
      revalidatePath("/console");
    },
  };
}
