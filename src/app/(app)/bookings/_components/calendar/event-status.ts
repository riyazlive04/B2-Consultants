import { askConfirm } from "@/components/ui/feedback";
import { safeAction } from "@/lib/action-guard";
import { discoStatusWrite, FREES_THE_SLOT, type CalEvent, type CalStatus } from "@/lib/calendar-event";
import { CALENDAR_STATUS_LABELS } from "@/lib/labels";
import { setBookingConfirmed, setBookingStatus, setSlotBlocked } from "@/server/booking-actions";
import { setSalesCallConfirmed } from "@/server/outreach-actions";
import { unblockSssSlotAction } from "@/server/sss-actions";

/**
 * Changing one entry's status: asked for, written, and reported - in one place.
 *
 * The drawer and the appointment list both offer this, and they must not be two readings of what
 * "No show" means. The caller is left with only what is its own: a toast, a refresh and whether
 * to close itself.
 *
 * `null` back means the reader was asked and said no, so nothing happened and nothing is said.
 */
export type StatusResult = { ok: boolean; message: string };

export async function applyStatusChange(ev: CalEvent, next: CalStatus): Promise<StatusResult | null> {
  if (next === ev.status) return null;
  const label = CALENDAR_STATUS_LABELS[next].toLowerCase();

  if (ev.calendar.type === "SSS") {
    const journeyId = ev.source.journeyId;
    if (!journeyId) return { ok: false, message: "This session has no journey to confirm." };
    const form = new FormData();
    form.set("journeyId", journeyId);
    form.set("confirmed", next === "CONFIRMED" ? "YES" : "NO");
    const res = await safeAction(() => setSalesCallConfirmed(form));
    return { ok: res.ok, message: res.ok ? (next === "CONFIRMED" ? "Session confirmed" : "Confirmation cleared") : res.error ?? "That did not save" };
  }

  const bookingId = ev.source.bookingId;
  if (!bookingId) return { ok: false, message: "This call let its slot go - re-book it instead." };

  // Giving the slot back is the one change somebody cannot undo with the same control, so it is
  // the one that asks first.
  if (FREES_THE_SLOT.includes(next)) {
    const ok = await askConfirm({
      title: `Mark this call ${label}?`,
      body:
        `${ev.contact?.name ?? "This call"}'s slot goes back to the calendar and the booking keeps only a record of the time it held. ` +
        "Nothing is deleted, and nobody is messaged.",
      confirmLabel: `Mark ${label}`,
      danger: true,
    });
    if (!ok) return null;
  }

  const write = discoStatusWrite(next);
  const res = await safeAction(() =>
    "confirmed" in write ? setBookingConfirmed(bookingId, write.confirmed) : setBookingStatus(bookingId, write.bookingStatus),
  );
  return { ok: res.ok, message: res.ok ? `Marked ${label}` : res.error ?? "That did not save" };
}

/** Hand a blocked slot back to the calendar. */
export async function unblockEntry(ev: CalEvent): Promise<StatusResult> {
  const res = await safeAction(() =>
    ev.source.table === "sss" ? unblockSssSlotAction(ev.source.id) : setSlotBlocked(ev.source.id, false),
  );
  return { ok: res.ok, message: res.ok ? "Time freed up" : res.error ?? "That did not save" };
}
