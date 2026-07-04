"use client";

import { useRef, useState } from "react";
import { Trash2 } from "lucide-react";
import { deleteSlot, generateSlots } from "@/server/booking-actions";
import { askConfirm, toast } from "@/components/ui/feedback";
import { Field, FormError, SubmitButton, TextInput } from "@/components/ui/form";
import { SLOT_STATUS_LABELS } from "@/lib/labels";
import type { SlotRow } from "@/server/booking-metrics";
import { toDateInputValue } from "@/lib/dates";

const STATUS_TINT: Record<string, string> = {
  OPEN: "bg-ok-soft text-ok",
  BOOKED: "bg-accent-soft text-accent",
  BLOCKED: "bg-surface-2 text-muted",
};

export function SlotManager({ slots }: { slots: SlotRow[] }) {
  const [error, setError] = useState<string | null>(null);
  const formRef = useRef<HTMLFormElement>(null);
  const today = toDateInputValue(new Date());

  const generate = async (form: FormData) => {
    setError(null);
    const res = await generateSlots(form);
    if (!res.ok) return setError(res.error);
    toast("Slots added");
    formRef.current?.reset();
  };

  const remove = async (s: SlotRow) => {
    if (s.status === "BOOKED") return toast("Cancel the booking first", "error");
    const ok = await askConfirm({
      title: `Remove slot ${s.day} ${s.time}?`,
      confirmLabel: "Remove slot",
      danger: true,
    });
    if (!ok) return;
    const res = await deleteSlot(s.id);
    if (!res.ok) return toast(res.error, "error");
    toast("Slot removed");
  };

  return (
    <div className="space-y-4">
      <form
        ref={formRef}
        action={generate}
        className="rounded-card border border-line bg-surface p-5 shadow-card"
      >
        <h3 className="font-display text-lg font-semibold">Add availability</h3>
        <p className="mt-0.5 text-xs text-muted">
          Generates open call slots across a window on one day. Times are IST. Re-running a day
          skips slots that already exist.
        </p>
        <div className="mt-4 grid grid-cols-2 gap-4 sm:grid-cols-5">
          <Field label="Date"><TextInput type="date" name="date" required defaultValue={today} min={today} /></Field>
          <Field label="From (IST)"><TextInput type="time" name="startTime" required defaultValue="15:00" /></Field>
          <Field label="To (IST)"><TextInput type="time" name="endTime" required defaultValue="18:00" /></Field>
          <Field label="Every (min)"><TextInput type="number" name="intervalMins" required defaultValue="30" min={15} max={240} /></Field>
          <Field label="Duration (min)"><TextInput type="number" name="durationMins" required defaultValue="30" min={15} max={240} /></Field>
        </div>
        <div className="mt-4 flex items-center gap-3">
          <SubmitButton>Add slots</SubmitButton>
          <FormError message={error} />
        </div>
      </form>

      <div className="rounded-card border border-line bg-surface p-5 shadow-card">
        <h3 className="font-display text-lg font-semibold">Upcoming slots</h3>
        {slots.length === 0 ? (
          <p className="mt-3 text-sm text-muted">No upcoming slots. Add availability above.</p>
        ) : (
          <ul className="mt-3 divide-y divide-line">
            {slots.map((s) => (
              <li key={s.id} className="flex items-center gap-3 py-2.5 text-sm">
                <span className="font-medium text-ink">{s.day}</span>
                <span className="tnum text-muted">{s.time} IST</span>
                <span className="tnum text-xs text-muted">· {s.cet} CET</span>
                <span className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${STATUS_TINT[s.status] ?? ""}`}>
                  {SLOT_STATUS_LABELS[s.status]}
                  {s.bookedName ? ` · ${s.bookedName}` : ""}
                </span>
                {s.status !== "BOOKED" && (
                  <button
                    type="button"
                    onClick={() => remove(s)}
                    className="ml-auto inline-flex items-center gap-1 text-xs text-risk hover:underline"
                  >
                    <Trash2 size={13} /> Remove
                  </button>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
