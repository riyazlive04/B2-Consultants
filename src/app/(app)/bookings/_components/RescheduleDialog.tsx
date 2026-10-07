"use client";

import { useState } from "react";
import { Modal } from "@/components/ui/Modal";
import { Btn, SegmentedControl } from "@/components/ui/controls";
import { Field, Select, TextInput } from "@/components/ui/form";
import { toast } from "@/components/ui/feedback";
import { rescheduleBooking, rescheduleBookingToTime } from "@/server/booking-actions";
import { safeAction } from "@/lib/action-guard";
import { slotTypeLabel } from "@/lib/labels";
import type { BookingRow, OpenSlotOption, TeamMemberOption } from "@/server/booking-metrics";
import { CallTime } from "./booking-view";

/**
 * Give a call a new time - either an opening already on the calendar, or one typed here.
 *
 * Mounted per booking (`key={booking.id}` at the call site) so every field starts from THAT
 * booking's current time and owner instead of whatever the last one left behind.
 */

// The IST wall clock of a slot, as the date/time inputs want it: the row carries the instant as
// an ISO string, and the pickers submit "YYYY-MM-DD" + "HH:MM" in IST, the zone the whole booking
// calendar is written in (see `istWallToUtc` server-side).
const IST_YMD = new Intl.DateTimeFormat("en-CA", {
  timeZone: "Asia/Kolkata",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});
const IST_HM = new Intl.DateTimeFormat("en-GB", {
  timeZone: "Asia/Kolkata",
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
});

function istParts(iso: string | null): { date: string; time: string } {
  if (!iso) return { date: "", time: "" };
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return { date: "", time: "" };
  return { date: IST_YMD.format(d), time: IST_HM.format(d) };
}

/** 30 / 60 plus whatever length this call already is, so a legacy 45-minute call keeps its own. */
function durationOptions(current: number | null): { value: string; label: string }[] {
  const mins = [...new Set([30, 60, ...(current ? [current] : [])])].sort((a, b) => a - b);
  return mins.map((m) => ({ value: String(m), label: slotTypeLabel(m) }));
}

export function RescheduleDialog({
  booking,
  openSlots,
  teamMembers,
  onClose,
}: {
  booking: BookingRow;
  openSlots: OpenSlotOption[];
  teamMembers: TeamMemberOption[];
  onClose: () => void;
}) {
  // Slots offered: future OPEN slots of the SAME call length, so a 60-minute strategy call is
  // never dropped into a 30-minute opening. A booking holding no slot has no length to match, so
  // it sees them all.
  const slotChoices = openSlots.filter(
    (s) => !booking.slotDurationMins || s.durationMins === booking.slotDurationMins,
  );

  /**
   * Two ways to land the same move. "Open slot" takes an opening already on the calendar; "Pick a
   * date & time" is typed here, which is what the prospect on the phone actually asks for - there
   * is rarely a published slot at the hour they can do, and generating one from the Availability
   * screen would publish that hour on the public booking page to everybody.
   */
  const [mode, setMode] = useState<"slot" | "time">(slotChoices.length > 0 ? "slot" : "time");
  const [targetSlot, setTargetSlot] = useState("");
  // Pre-filled with the time it has now (or today at 15:00, for a call that has lost its slot),
  // so the common move - same time, different day - is two taps.
  const now = istParts(booking.slotStartsAt);
  const [newDate, setNewDate] = useState(now.date || istParts(new Date().toISOString()).date);
  const [newTime, setNewTime] = useState(now.time || "15:00");
  const [newDuration, setNewDuration] = useState(String(booking.slotDurationMins ?? 30));
  const [newOwner, setNewOwner] = useState(booking.assignedToId ?? "");
  const [busy, setBusy] = useState(false);

  const live = booking.status === "BOOKED";
  const ready = mode === "slot" ? !!targetSlot : !!newDate && !!newTime;

  const submit = async () => {
    if (!ready || busy) return;
    setBusy(true);
    const res = await safeAction(() =>
      mode === "slot"
        ? rescheduleBooking(booking.id, targetSlot)
        : rescheduleBookingToTime({
            bookingId: booking.id,
            date: newDate,
            time: newTime,
            durationMins: newDuration,
            assignedToId: newOwner,
          }),
    );
    setBusy(false);
    if (!res.ok) return toast(res.error, "error");
    toast(live ? "Call moved - prospect notified" : "Call re-booked - prospect notified");
    onClose();
  };

  return (
    <Modal
      open
      onClose={onClose}
      title={live ? "Reschedule call" : "Re-book call"}
      subtitle={booking.name}
      size="md"
    >
      <div className="space-y-5">
        <div className="rounded-field border border-line bg-surface-2 px-3 py-2">
          <p className="text-label uppercase text-ink-2">{live ? "Currently" : "Previously"}</p>
          <CallTime row={booking} />
        </div>

        <SegmentedControl
          value={mode}
          onChange={setMode}
          ariaLabel="How to pick the new time"
          grow
          options={[
            { value: "slot", label: "Open slot" },
            // Short enough to stay on one line inside its segment at 320px - the longer
            // "Pick a date & time" wrapped to two lines and overflowed the 40px button.
            { value: "time", label: "Pick a time" },
          ]}
        />

        {mode === "slot" ? (
          slotChoices.length === 0 ? (
            <p className="text-sm text-muted">
              No open slots of the same length are on the calendar. Use{" "}
              <strong className="font-semibold text-ink">Pick a time</strong> to set one yourself,
              or publish more in Manage availability.
            </p>
          ) : (
            <Field label="Move to" hint={`${slotChoices.length} open slot${slotChoices.length === 1 ? "" : "s"} of this length`}>
              <Select
                value={targetSlot}
                onChange={(e) => setTargetSlot(e.target.value)}
                aria-label="Move to"
                placeholder="Pick an open slot…"
                options={slotChoices.map((s) => ({
                  value: s.id,
                  label: `${s.day} · ${s.time} IST${s.assignedToName ? ` · ${s.assignedToName}` : ""}`,
                }))}
              />
            </Field>
          )
        ) : (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Field label="Date">
              <TextInput
                type="date"
                value={newDate}
                onChange={(e) => setNewDate(e.target.value)}
                aria-label="Date"
              />
            </Field>
            <Field label="Time (IST)">
              <TextInput
                type="time"
                value={newTime}
                onChange={(e) => setNewTime(e.target.value)}
                aria-label="Time (IST)"
              />
            </Field>
            <Field label="Call length">
              <Select
                value={newDuration}
                onChange={(e) => setNewDuration(e.target.value)}
                aria-label="Call length"
                options={durationOptions(booking.slotDurationMins)}
              />
            </Field>
            <Field label="Who takes it">
              <Select
                value={newOwner}
                onChange={(e) => setNewOwner(e.target.value)}
                aria-label="Who takes it"
                placeholder="Unassigned"
                options={teamMembers.map((u) => ({ value: u.id, label: u.name ?? "Unnamed" }))}
              />
            </Field>
          </div>
        )}

        <p className="text-caption text-muted">
          {live
            ? "The old slot is freed, and the prospect is told their call moved and asked to confirm the new time."
            : "Re-booking puts this call back on the calendar, frees whatever slot it was holding, and moves the prospect's card back onto the board."}
          {mode === "time" &&
            " A time you type is held for this prospect alone - it is never published on the booking page."}
        </p>

        <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <Btn variant="ghost" onClick={onClose} className="w-full sm:w-auto">
            Cancel
          </Btn>
          <Btn variant="primary" onClick={submit} disabled={!ready} busy={busy} className="w-full sm:w-auto">
            {live ? "Move call" : "Re-book call"}
          </Btn>
        </div>
      </div>
    </Modal>
  );
}
