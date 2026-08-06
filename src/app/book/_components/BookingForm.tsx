"use client";

import { useEffect, useMemo, useState } from "react";
import { CalendarCheck, CheckCircle2 } from "lucide-react";
import { submitBooking } from "@/server/booking-actions";
import { BookingIntakeFields } from "@/components/booking/BookingIntakeFields";
import { FormError, SubmitButton } from "@/components/ui/form";
import { slotTypeLabel } from "@/lib/labels";

const IST_ZONE = "Asia/Kolkata";

export type SlotOption = {
  id: string;
  day: string;
  time: string;
  cet: string;
  durationMins: number;
  /** UTC instant, ISO - the raw value the static IST/CET strings above were formatted from.
   *  Needed client-side to convert to the visitor's own detected timezone. */
  startsAtIso: string;
};

export function BookingForm({ slots }: { slots: SlotOption[] }) {
  const [slotId, setSlotId] = useState<string>("");
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<SlotOption | null>(null);
  // Visitor timezone, detected client-side only (browser API - unavailable during SSR).
  // Shown ALONGSIDE the static IST/CET times, never replacing them.
  const [visitorTz, setVisitorTz] = useState<string | null>(null);
  useEffect(() => {
    try {
      const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
      if (tz) setVisitorTz(tz);
    } catch {
      // Intl unavailable/blocked - fall back to the static IST/CET display only.
    }
  }, []);
  const showLocalTz = !!visitorTz && visitorTz !== IST_ZONE;

  const localTimeFmt = useMemo(() => {
    if (!visitorTz) return null;
    try {
      return new Intl.DateTimeFormat(undefined, { hour: "2-digit", minute: "2-digit", hour12: true, timeZone: visitorTz });
    } catch {
      return null;
    }
  }, [visitorTz]);
  const localFullFmt = useMemo(() => {
    if (!visitorTz) return null;
    try {
      return new Intl.DateTimeFormat(undefined, {
        weekday: "short", day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit", hour12: true,
        timeZone: visitorTz,
      });
    } catch {
      return null;
    }
  }, [visitorTz]);
  const localTime = (s: SlotOption) => (localTimeFmt ? localTimeFmt.format(new Date(s.startsAtIso)) : null);
  const localFull = (s: SlotOption) => (localFullFmt ? localFullFmt.format(new Date(s.startsAtIso)) : null);

  const byDay = useMemo(() => {
    const map = new Map<string, SlotOption[]>();
    for (const s of slots) {
      const arr = map.get(s.day) ?? [];
      arr.push(s);
      map.set(s.day, arr);
    }
    return [...map.entries()];
  }, [slots]);

  const chosen = slots.find((s) => s.id === slotId) ?? null;

  const submit = async (form: FormData) => {
    setError(null);
    if (!slotId) return setError("Please choose an available time for your call.");
    const res = await submitBooking(form);
    if (!res.ok) return setError(res.error);
    setDone(chosen);
  };

  if (done) {
    return (
      <div className="rounded-card border border-line bg-surface p-8 text-center shadow-card">
        <CheckCircle2 className="mx-auto text-ok" size={40} />
        <h2 className="mt-3 font-display text-xl font-semibold">You're booked in 🎉</h2>
        <p className="mx-auto mt-2 max-w-sm text-sm text-muted">
          Your {slotTypeLabel(done.durationMins).toLowerCase()} is confirmed for{" "}
          <strong className="text-ink">{done.day}</strong> at{" "}
          <strong className="text-ink">{done.time} IST</strong> ({done.cet} CET)
          {showLocalTz && localTime(done) && (
            <> · <strong className="text-ink">{localTime(done)}</strong> ({visitorTz})</>
          )}
          . Our team will be in touch with the joining details.
        </p>
      </div>
    );
  }

  if (slots.length === 0) {
    return (
      <div className="rounded-card border border-line bg-surface p-8 text-center shadow-card">
        <CalendarCheck className="mx-auto text-muted" size={36} />
        <p className="mt-3 text-sm text-muted">
          No call times are open right now. Please check back shortly - we release new slots
          regularly.
        </p>
      </div>
    );
  }

  return (
    <form action={submit} className="space-y-6">
      {/* ── Slot picker ── */}
      <section className="rounded-card border border-line bg-surface p-5 shadow-card">
        <h2 className="font-display text-h2 font-semibold">1. Pick a time</h2>
        <p className="mt-0.5 text-xs text-muted">
          Times shown in IST.
          {showLocalTz && ` Also shown in your detected timezone (${visitorTz}).`}
        </p>
        <div className="mt-4 space-y-4">
          {byDay.map(([day, daySlots]) => (
            <div key={day}>
              <p className="text-sm font-semibold text-ink">{day}</p>
              <div className="mt-2 flex flex-wrap gap-2">
                {daySlots.map((s) => (
                  <button
                    type="button"
                    key={s.id}
                    onClick={() => setSlotId(s.id)}
                    title={localFull(s) ? `${slotTypeLabel(s.durationMins)} · ${localFull(s)} your time` : slotTypeLabel(s.durationMins)}
                    className={`rounded-field border px-3 py-1.5 text-sm transition-colors ${
                      slotId === s.id
                        ? "border-accent bg-accent text-on-accent"
                        : "border-line bg-surface-2 text-ink hover:border-accent"
                    }`}
                    aria-pressed={slotId === s.id}
                  >
                    <span className="block">{s.time}</span>
                    {showLocalTz && localTime(s) && (
                      <span className="mt-0.5 block text-[10px] font-normal opacity-75">{localTime(s)} your time</span>
                    )}
                  </button>
                ))}
              </div>
            </div>
          ))}
        </div>
        <input type="hidden" name="slotId" value={slotId} />
        {chosen && (
          <p className="mt-3 text-xs text-muted">
            Selected: <strong className="text-ink">{chosen.day}, {chosen.time} IST</strong> · {chosen.cet} CET
            {showLocalTz && localTime(chosen) && (
              <> · <strong className="text-ink">{localTime(chosen)}</strong> ({visitorTz})</>
            )}
            {" · "}{slotTypeLabel(chosen.durationMins)}
          </p>
        )}
      </section>

      <BookingIntakeFields />

      <div className="flex flex-col items-center gap-3">
        <SubmitButton>Confirm my call</SubmitButton>
        <FormError message={error} />
      </div>
    </form>
  );
}
