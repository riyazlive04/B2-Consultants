"use client";

import { useRef, useState } from "react";
import { Ban, LockOpen, Play, Trash2 } from "lucide-react";
import {
  generateSlots,
  deleteSlot,
  updateBookingRules,
  setSlotBlocked,
  runBookingAutomationNow,
} from "@/server/booking-actions";
import { askConfirm, toast } from "@/components/ui/feedback";
import { CheckboxField, Field, FormError, Select, SubmitButton, TextArea, TextInput } from "@/components/ui/form";
import { SLOT_DURATION_OPTIONS, SLOT_STATUS_LABELS, slotTypeLabel } from "@/lib/labels";
import { statusTint } from "@/lib/slot-tint";
import type { SlotRow, TeamMemberOption } from "@/server/booking-metrics";
import type { BookingRulesConfig } from "@/lib/config-schema";
import { toDateInputValue } from "@/lib/dates";
import { formatDuration } from "@/lib/duration";

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
    toast(res.summary ? `Confirmation loop ran - ${res.summary}` : "Confirmation loop ran");
  };

  return (
    <form id="booking-rules" action={save} className="scroll-mt-24 rounded-card border border-line bg-surface p-5 shadow-card">
      <h3 className="font-display text-h2 font-semibold">Booking rules</h3>
      <p className="mt-0.5 text-xs text-muted">
        Applied when generating slots (buffer) and on the public booking page (notice + advance
        window).
      </p>
      <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-3">
        <Field label="Buffer between slots (min)" hint="Gap kept between consecutive generated slots. 0–240.">
          <TextInput kind="int" name="bufferMinutes" required defaultValue={rules.bufferMinutes} maxLength={3} />
        </Field>
        <Field label="Minimum notice (hours)" hint="Hides slots starting sooner than this from now. 0–240.">
          <TextInput kind="int" name="minNoticeHours" required defaultValue={rules.minNoticeHours} maxLength={3} />
        </Field>
        <Field label="Max advance booking (days)" hint="Hides slots further out than this. 1–365.">
          <TextInput kind="int" name="maxAdvanceDays" required defaultValue={rules.maxAdvanceDays} maxLength={3} />
        </Field>
      </div>

      {/* Confirmation loop (Module E) - confirm-or-cancel + promote-next */}
      <div id="confirm-loop" className="mt-5 scroll-mt-24 border-t border-line pt-4">
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
        {/*
          Durations, not whole hours: the cron ticks every minute, so "cancel it 20 minutes before"
          is a real answer. `45m` / `3h` / `1h30m`; a bare number still means hours, which is what
          every value typed in this box before minutes existed meant.
        */}
        <div className="mt-3 grid grid-cols-1 gap-4 sm:grid-cols-3">
          <Field label="Ask to confirm (before slot)" hint="Send the confirm request once the call is within this window. 0m = don't ask, and so never auto-cancel.">
            <TextInput kind="text" name="confirmRequestLead" required defaultValue={formatDuration(rules.confirmRequestLeadMinutes)} maxLength={12} />
          </Field>
          <Field label="Auto-cancel if unconfirmed (before slot)" hint="Must be shorter than the ask window, so there's time to reply.">
            <TextInput kind="text" name="autoCancelWindow" required defaultValue={formatDuration(rules.autoCancelMinutes)} maxLength={12} />
          </Field>
          <Field label="Give them at least this long to reply" hint="Counted from the moment the request goes out, so a call booked at short notice is never cancelled unanswered. Minimum 5m.">
            <TextInput kind="text" name="confirmReplyGrace" required defaultValue={formatDuration(rules.confirmReplyGraceMinutes)} maxLength={12} />
          </Field>
        </div>
        <p className="mt-2 text-caption text-muted">
          Use h or m - e.g. 3h, 45m, 1h30m. A bare number means hours. The same three windows are on
          the WhatsApp settings tab and in Console → Sales ops → Confirm-or-cancel - one rule, three
          ways in. Released slots are listed under &ldquo;Cancelled slots&rdquo; on this page.
        </p>
      </div>

      {/*
        ── Auto-disqualify + the rejection email ──────────────────────────────────────
        The rule and the template were configurable in the schema from the start, and read on
        every booking, but had no screen - so the only way to change either was a database edit.
        A setting nobody can reach is one nobody can be accountable for, which matters more than
        usual here: this decides which prospects are turned away and what they are told.
      */}
      <div id="disqualify" className="mt-5 scroll-mt-24 border-t border-line pt-4">
        <h4 className="font-display text-base font-semibold">Turn away unqualified applicants</h4>
        <p className="mt-0.5 text-xs text-muted">
          A band score below <span className="font-medium">1.6 out of 4</span> is a
          &ldquo;cancel&rdquo; verdict. The applicant never takes a slot - it stays open for
          someone who qualifies - their card moves to{" "}
          <span className="font-medium">Cancelled/Unqualified</span>, and they get the note below.
        </p>
        <div className="mt-3">
          <CheckboxField
            name="autoDisqualify"
            label="Turn away applicants who score below 1.6"
            defaultChecked={rules.autoDisqualify}
            hint="Off means every applicant keeps their slot whatever they score, and no rejection is sent. The score is still recorded either way."
          />
        </div>
        <div className="mt-3 grid grid-cols-1 gap-4">
          <Field label="Email subject" hint="What they see in their inbox. Max 200 characters.">
            <TextInput kind="text" name="rejectionSubject" required defaultValue={rules.rejectionSubject} maxLength={200} />
          </Field>
          <Field
            label="Email body"
            hint="Plain text - line breaks are kept. Tokens: {{first_name}}, {{name}}, {{email}}, {{phone}}. A token we hold no value for renders as nothing, so keep the sentence readable without it."
          >
            <TextArea name="rejectionBody" required defaultValue={rules.rejectionBody} rows={10} maxLength={4000} />
          </Field>
        </div>
        <p className="mt-2 text-xs text-muted">
          Nothing is sent while the email channel is off - the message is recorded as skipped
          instead. Check Console → System health to see whether email is armed.
        </p>
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

/**
 * Upcoming slots, grouped into the days they belong to.
 *
 * ── WHY THIS IS NOT A LIST OF ROWS ───────────────────────────────────────────────
 * It was, and forty near-identical sentences is what it looked like. Each row repeated the same
 * four facts in the same order - date, IST time, the CET string (which carries the date AGAIN),
 * and "Discovery Call (30 min)" on every single row - so there was nothing to scan: no shape, no
 * rhythm, nothing aligned. The status pill sat at a different x on every row because its position
 * depended on the width of the words before it, and the actions were flung to the far right of a
 * wide card, away from the slot they act on, where they clipped at narrower widths.
 *
 * Availability is a SCHEDULE, so it is drawn as one. The date is a heading printed once; the slots
 * under it are chips in a grid, so a day's shape ("3:00, 3:45, 4:30, 5:15") is one glance rather
 * than four sentences. The chips use the SAME tints as the week calendar on /bookings
 * (lib/slot-tint) - the same slot now looks the same on both screens, which is the point.
 */
type DayGroup = {
  key: string;
  label: string;
  /** "Today" / "Tomorrow", when it applies - the two days anyone actually acts on. */
  relative: string | null;
  slots: SlotRow[];
  counts: { open: number; booked: number; blocked: number };
  /** The call length, when every slot that day is the same. Printed once in the heading. */
  uniformDuration: number | null;
};

function groupByDay(slots: SlotRow[], todayKey: string, tomorrowKey: string): DayGroup[] {
  const byDay = new Map<string, SlotRow[]>();
  for (const s of slots) {
    const list = byDay.get(s.dayKey);
    if (list) list.push(s);
    else byDay.set(s.dayKey, [s]);
  }
  // `slots` arrives ordered by startsAt, and a Map keeps insertion order - so the days come out
  // chronologically without a second sort.
  return [...byDay.entries()].map(([key, rows]) => {
    const durations = new Set(rows.map((r) => r.durationMins));
    return {
      key,
      label: rows[0].day,
      relative: key === todayKey ? "Today" : key === tomorrowKey ? "Tomorrow" : null,
      slots: rows,
      counts: {
        open: rows.filter((r) => r.status === "OPEN").length,
        booked: rows.filter((r) => r.status === "BOOKED").length,
        blocked: rows.filter((r) => r.status === "BLOCKED").length,
      },
      uniformDuration: durations.size === 1 ? rows[0].durationMins : null,
    };
  });
}

/**
 * One slot.
 *
 * Actions are revealed on hover, AND on keyboard focus anywhere inside the chip
 * (`group-focus-within`), AND permanently on any device without a pointer
 * (`[@media(hover:none)]`) - so a hover affordance never becomes a touch or keyboard dead end.
 * Rendering both buttons on all forty chips at once was the alternative, and it just moved the
 * clutter from the sentence into the grid.
 */
function SlotChip({
  slot,
  showDuration,
  onBlock,
  onRemove,
}: {
  slot: SlotRow;
  /** Only when the day is mixed - otherwise the heading already said it. */
  showDuration: boolean;
  onBlock: (s: SlotRow) => void;
  onRemove: (s: SlotRow) => void;
}) {
  const tint = statusTint(slot.status);
  const booked = slot.status === "BOOKED";
  return (
    <div
      className="group relative rounded-field p-2.5"
      style={{ background: tint.bg, borderLeft: `3px solid ${tint.edge}` }}
      title={`${slot.day} · ${slot.time} IST · ${slot.cet} CET · ${slotTypeLabel(slot.durationMins)} · ${
        SLOT_STATUS_LABELS[slot.status] ?? slot.status
      }${slot.bookedName ? ` · ${slot.bookedName}` : ""}${slot.assignedToName ? ` · with ${slot.assignedToName}` : ""}`}
    >
      <p className="tnum text-sm font-semibold text-ink">{slot.time}</p>
      <p className="tnum text-caption text-muted">
        {slot.cetTime} CET{showDuration ? ` · ${slot.durationMins}m` : ""}
      </p>

      {booked ? (
        <p className="mt-1 truncate text-caption font-medium text-ink-2" title={slot.bookedName ?? ""}>
          {slot.bookedName ?? "Booked"}
        </p>
      ) : slot.status === "BLOCKED" ? (
        <p className="mt-1 text-caption font-medium text-muted">Blocked</p>
      ) : (
        slot.assignedToName && (
          <p className="mt-1 truncate text-caption text-muted" title={slot.assignedToName}>
            {slot.assignedToName}
          </p>
        )
      )}

      {/* A booked slot has no actions - the booking has to be cancelled first (setSlotBlocked and
          deleteSlot both refuse it), so offering the buttons would only produce a toast. */}
      {!booked && (
        <div className="absolute right-1 top-1 flex gap-0.5 opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100 [@media(hover:none)]:opacity-100">
          <button
            type="button"
            onClick={() => onBlock(slot)}
            aria-label={slot.status === "BLOCKED" ? `Unblock ${slot.day} ${slot.time}` : `Block ${slot.day} ${slot.time}`}
            title={slot.status === "BLOCKED" ? "Unblock - put it back on the booking page" : "Block - take it out of availability"}
            className="grid h-6 w-6 place-items-center rounded-btn text-ink-3 transition-colors hover:bg-surface hover:text-ink"
          >
            {slot.status === "BLOCKED" ? <LockOpen size={13} /> : <Ban size={13} />}
          </button>
          <button
            type="button"
            onClick={() => onRemove(slot)}
            aria-label={`Remove the ${slot.day} ${slot.time} slot`}
            title="Remove this slot entirely"
            className="grid h-6 w-6 place-items-center rounded-btn text-ink-3 transition-colors hover:bg-surface hover:text-risk"
          >
            <Trash2 size={13} />
          </button>
        </div>
      )}
    </div>
  );
}

/**
 * The sections of this screen, in the order they appear.
 *
 * A jump-nav rather than tabs: these are five settings you read top to bottom once and then come
 * back to one of, and tabs would hide four of them behind a click. It also gives the page the one
 * thing the old modal could not have - a URL per section, so "set the auto-cancel window" can be
 * linked to directly.
 */
const SECTIONS: { id: string; label: string }[] = [
  { id: "add-slots", label: "Add availability" },
  { id: "booking-rules", label: "Booking rules" },
  { id: "confirm-loop", label: "Confirm-or-cancel" },
  { id: "disqualify", label: "Turning applicants away" },
  { id: "upcoming", label: "Upcoming slots" },
];

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

  /**
   * Today and tomorrow in IST, so the two headings anyone acts on say so.
   *
   * `today` is already the IST-local date string the date inputs are seeded with; tomorrow is that
   * plus a day, built from the string rather than from `Date.now() + 86400000` so a DST shift or a
   * late-evening UTC/IST straddle cannot land it on the wrong date.
   */
  const tomorrowKey = toDateInputValue(
    new Date(new Date(`${today}T12:00:00Z`).getTime() + 24 * 60 * 60 * 1000),
  );
  const days = groupByDay(slots, today, tomorrowKey);

  return (
    <div className="space-y-4">
      {/* Jump-nav. The screen is five concerns tall; without this you scroll past four of them
          hunting the one you came for - which is most of what made the old dialog unusable. */}
      <nav aria-label="Sections on this page" className="flex flex-wrap gap-2">
        {SECTIONS.map((sec) => (
          <a
            key={sec.id}
            href={`#${sec.id}`}
            className="rounded-full border border-line bg-surface px-3 py-1.5 text-xs font-medium text-muted transition-colors hover:bg-surface-2 hover:text-ink"
          >
            {sec.label}
          </a>
        ))}
      </nav>

      <form
        id="add-slots"
        ref={formRef}
        action={generate}
        className="scroll-mt-24 rounded-card border border-line bg-surface p-5 shadow-card"
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
          <Field label="Every (min)"><TextInput kind="int" name="intervalMins" required defaultValue="30" maxLength={3} /></Field>
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

      <div id="upcoming" className="scroll-mt-24 rounded-card border border-line bg-surface p-5 shadow-card">
        <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
          <h3 className="font-display text-h2 font-semibold">Upcoming slots</h3>
          {slots.length > 0 && (
            <p className="text-caption text-muted">
              Times are IST, Berlin underneath. Hover a slot to block or remove it.
            </p>
          )}
        </div>

        {slots.length === 0 ? (
          <p className="mt-3 text-sm text-muted">
            No upcoming slots.{" "}
            <a href="#add-slots" className="font-medium text-accent underline">
              Add availability
            </a>{" "}
            above, or set a standing weekly pattern in Console → Availability.
          </p>
        ) : (
          <div className="mt-4 space-y-5">
            {days.map((day) => (
              <section key={day.key}>
                <div className="flex flex-wrap items-baseline gap-x-2.5 gap-y-1 border-b border-line pb-1.5">
                  <h4 className="font-display text-base font-semibold text-ink">{day.label}</h4>
                  {day.relative && (
                    <span className="rounded-full bg-accent-soft px-2 py-0.5 text-caption font-semibold text-accent">
                      {day.relative}
                    </span>
                  )}
                  {/* The counts are the reason to group at all: "4 open" answers "can anyone book
                      me on Friday?" without counting rows. Zero counts are left out rather than
                      printed as 0 - three figures per heading is the clutter we just removed. */}
                  <span className="ml-auto flex flex-wrap items-center gap-x-2.5 text-caption text-muted">
                    {day.counts.open > 0 && <span>{day.counts.open} open</span>}
                    {day.counts.booked > 0 && <span className="text-ink-2">{day.counts.booked} booked</span>}
                    {day.counts.blocked > 0 && <span>{day.counts.blocked} blocked</span>}
                    {day.uniformDuration !== null && <span>· {day.uniformDuration}-min calls</span>}
                  </span>
                </div>
                <div className="mt-2 grid grid-cols-[repeat(auto-fill,minmax(8.5rem,1fr))] gap-2">
                  {day.slots.map((s) => (
                    <SlotChip
                      key={s.id}
                      slot={s}
                      showDuration={day.uniformDuration === null}
                      onBlock={toggleBlock}
                      onRemove={remove}
                    />
                  ))}
                </div>
              </section>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
