"use client";

import { useRef, useState, useTransition } from "react";
import { Ban, LockOpen, Play, Trash2 } from "lucide-react";
import {
  generateSlots,
  deleteSlot,
  updateBookingRules,
  setSlotBlocked,
  runBookingAutomationNow,
} from "@/server/booking-actions";
import { askConfirm, toast } from "@/components/ui/feedback";
import { CheckboxField, Field, FormError, Select, SubmitButton, TextInput } from "@/components/ui/form";
import { SLOT_DURATION_OPTIONS, SLOT_STATUS_LABELS, slotTypeLabel } from "@/lib/labels";
import type { SlotRow, TeamMemberOption } from "@/server/booking-metrics";
import type { BookingRulesConfig } from "@/lib/config-schema";
import { toDateInputValue } from "@/lib/dates";

const STATUS_TINT: Record<string, string> = {
  OPEN: "bg-ok-soft text-ok",
  BOOKED: "bg-accent-soft text-accent",
  BLOCKED: "bg-surface-2 text-muted",
};

const WEEKDAY_OPTIONS: { value: string; label: string; defaultOn: boolean }[] = [
  { value: "MON", label: "Mon", defaultOn: true },
  { value: "TUE", label: "Tue", defaultOn: true },
  { value: "WED", label: "Wed", defaultOn: true },
  { value: "THU", label: "Thu", defaultOn: true },
  { value: "FRI", label: "Fri", defaultOn: true },
  { value: "SAT", label: "Sat", defaultOn: false },
  { value: "SUN", label: "Sun", defaultOn: false },
];

function BookingRulesForm({ rules }: { rules: BookingRulesConfig }) {
  const [error, setError] = useState<string | null>(null);
  const [runningEngine, setRunningEngine] = useState(false);

  const save = async (form: FormData) => {
    setError(null);
    const res = await updateBookingRules(form);
    if (!res.ok) return setError(res.error);
    toast("Booking rules saved");
  };

  const runNow = async () => {
    if (runningEngine) return;
    setRunningEngine(true);
    const res = await runBookingAutomationNow();
    setRunningEngine(false);
    if (!res.ok) return toast(res.error, "error");
    toast(res.summary ? `Confirmation loop ran — ${res.summary}` : "Confirmation loop ran");
  };

  return (
    <form action={save} className="rounded-card border border-line bg-surface p-5 shadow-card">
      <h3 className="font-display text-h2 font-semibold">Booking rules</h3>
      <p className="mt-0.5 text-xs text-muted">
        Applied when generating slots (buffer) and on the public booking page (notice + advance
        window).
      </p>
      <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-3">
        <Field label="Buffer between slots (min)" hint="Gap kept between consecutive generated slots">
          <TextInput type="number" name="bufferMinutes" required defaultValue={rules.bufferMinutes} min={0} max={240} />
        </Field>
        <Field label="Minimum notice (hours)" hint="Hides slots starting sooner than this from now">
          <TextInput type="number" name="minNoticeHours" required defaultValue={rules.minNoticeHours} min={0} max={240} />
        </Field>
        <Field label="Max advance booking (days)" hint="Hides slots further out than this">
          <TextInput type="number" name="maxAdvanceDays" required defaultValue={rules.maxAdvanceDays} min={1} max={365} />
        </Field>
      </div>

      {/* Confirmation loop (Module E) — confirm-or-cancel + promote-next */}
      <div className="mt-5 border-t border-line pt-4">
        <h4 className="font-display text-base font-semibold">Auto-cancel unconfirmed calls</h4>
        <p className="mt-0.5 text-xs text-muted">
          As a booked call nears, the prospect is asked to reply <span className="font-medium">YES</span>. If they
          never confirm, the slot is released and the next call for the same caller that day is moved up into it.
          A WhatsApp &ldquo;yes&rdquo; confirms automatically; you can also confirm by hand from the Bookings tab.
        </p>
        <div className="mt-3 grid grid-cols-1 gap-x-4 sm:grid-cols-2">
          <CheckboxField
            name="autoCancelEnabled"
            label="Enable the confirmation loop"
            defaultChecked={rules.autoCancelEnabled}
            hint="Master switch. Off by default: when off, no confirm requests are sent and nothing is auto-cancelled. Manual controls (block, postpone, mark-confirmed) always work."
          />
          <CheckboxField
            name="promoteNext"
            label="Promote the next person into a freed slot"
            defaultChecked={rules.promoteNext}
            hint="Same caller, same day. Also applies when you cancel a booking by hand."
          />
        </div>
        <div className="mt-3 grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Field label="Ask to confirm (hours before)" hint="Send the confirm request once the call is within this window. 0 = don't ask.">
            <TextInput type="number" name="confirmRequestLeadHours" required defaultValue={rules.confirmRequestLeadHours} min={0} max={240} />
          </Field>
          <Field label="Auto-cancel if unconfirmed (hours before)" hint="Must be less than the ask window, so there's time to reply.">
            <TextInput type="number" name="autoCancelHours" required defaultValue={rules.autoCancelHours} min={0} max={240} />
          </Field>
        </div>
      </div>

      <div className="mt-4 flex flex-wrap items-center gap-3">
        <SubmitButton>Save rules</SubmitButton>
        <button
          type="button"
          onClick={runNow}
          disabled={runningEngine}
          className="inline-flex h-10 items-center gap-1.5 rounded-btn border border-line bg-surface-2 px-3.5 text-sm font-medium text-ink transition-colors hover:bg-surface disabled:opacity-60"
        >
          <Play size={14} /> {runningEngine ? "Running…" : "Run confirmation loop now"}
        </button>
        <FormError message={error} />
      </div>
    </form>
  );
}

export function SlotManager({
  slots,
  teamMembers,
  rules,
}: {
  slots: SlotRow[];
  teamMembers: TeamMemberOption[];
  rules: BookingRulesConfig;
}) {
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

  const toggleBlock = async (s: SlotRow) => {
    if (s.status === "BOOKED") return toast("Cancel the booking first", "error");
    const block = s.status !== "BLOCKED";
    const res = await setSlotBlocked(s.id, block);
    if (!res.ok) return toast(res.error, "error");
    toast(block ? "Slot blocked" : "Slot unblocked");
  };

  const assignedOptions = [
    { value: "", label: "Unassigned" },
    ...teamMembers.map((u) => ({ value: u.id, label: u.name })),
  ];

  return (
    <div className="space-y-4">
      <form
        ref={formRef}
        action={generate}
        className="rounded-card border border-line bg-surface p-5 shadow-card"
      >
        <h3 className="font-display text-h2 font-semibold">Add availability</h3>
        <p className="mt-0.5 text-xs text-muted">
          Generates open call slots across a date range, on the weekdays you pick, inside a daily
          time window. Times are IST. Re-running a range skips slots that already exist.
        </p>
        <div className="mt-4 grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-6">
          <Field label="Start date"><TextInput type="date" name="startDate" required defaultValue={today} min={today} /></Field>
          <Field label="End date"><TextInput type="date" name="endDate" required defaultValue={today} min={today} /></Field>
          <Field label="From (IST)"><TextInput type="time" name="startTime" required defaultValue="15:00" /></Field>
          <Field label="To (IST)"><TextInput type="time" name="endTime" required defaultValue="18:00" /></Field>
          <Field label="Every (min)"><TextInput type="number" name="intervalMins" required defaultValue="30" min={15} max={240} /></Field>
          <Field label="Call type">
            <Select name="durationMins" options={SLOT_DURATION_OPTIONS} defaultValue="30" />
          </Field>
        </div>
        <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Field label="Repeat on">
            <div className="flex flex-wrap gap-2 pt-0.5">
              {WEEKDAY_OPTIONS.map((w) => (
                <label
                  key={w.value}
                  className="flex h-9 cursor-pointer items-center gap-1.5 rounded-field border border-line bg-surface-2 px-2.5 text-xs font-medium text-ink"
                >
                  <input
                    type="checkbox"
                    name="weekdays"
                    value={w.value}
                    defaultChecked={w.defaultOn}
                    className="h-3.5 w-3.5 accent-[var(--primary)]"
                  />
                  {w.label}
                </label>
              ))}
            </div>
          </Field>
          <Field label="Team member" hint="Optional - leave blank to leave the slots unassigned">
            <Select name="assignedToId" options={assignedOptions} defaultValue="" />
          </Field>
        </div>
        <div className="mt-4 flex items-center gap-3">
          <SubmitButton>Add slots</SubmitButton>
          <FormError message={error} />
        </div>
      </form>

      <BookingRulesForm rules={rules} />

      <div className="rounded-card border border-line bg-surface p-5 shadow-card">
        <h3 className="font-display text-h2 font-semibold">Upcoming slots</h3>
        {slots.length === 0 ? (
          <p className="mt-3 text-sm text-muted">No upcoming slots. Add availability above.</p>
        ) : (
          <ul className="mt-3 divide-y divide-line">
            {slots.map((s) => (
              <li key={s.id} className="flex flex-wrap items-center gap-3 py-2.5 text-sm">
                <span className="font-medium text-ink">{s.day}</span>
                <span className="tnum text-muted">{s.time} IST</span>
                <span className="tnum text-xs text-muted">· {s.cet} CET</span>
                <span className="text-xs text-muted">· {slotTypeLabel(s.durationMins)}</span>
                {s.assignedToName && (
                  <span className="rounded-full bg-surface-2 px-2 py-0.5 text-caption font-medium text-muted">
                    {s.assignedToName}
                  </span>
                )}
                <span className={`rounded-full px-2 py-0.5 text-caption font-medium ${STATUS_TINT[s.status] ?? ""}`}>
                  {SLOT_STATUS_LABELS[s.status]}
                  {s.bookedName ? ` · ${s.bookedName}` : ""}
                </span>
                {s.status !== "BOOKED" && (
                  <span className="ml-auto flex items-center gap-3">
                    <button
                      type="button"
                      onClick={() => toggleBlock(s)}
                      className="inline-flex items-center gap-1 text-xs text-muted hover:text-ink hover:underline"
                    >
                      {s.status === "BLOCKED" ? <><LockOpen size={13} /> Unblock</> : <><Ban size={13} /> Block</>}
                    </button>
                    <button
                      type="button"
                      onClick={() => remove(s)}
                      className="inline-flex items-center gap-1 text-xs text-risk hover:underline"
                    >
                      <Trash2 size={13} /> Remove
                    </button>
                  </span>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
