"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Plus, Trash2 } from "lucide-react";
import { DEFAULT_SLOT_PATTERN_CONFIG, type BookingCalendar, type SlotPatternConfig } from "@/lib/config-schema";
import { WEEKDAY_KEYS, slotsPerRunningDay, type WeekdayKey } from "@/lib/slot-plan";
import { Field } from "@/components/ui/form";
import { toast } from "@/components/ui/feedback";
import { saveBookingCalendars, saveSssPatternConfig } from "@/server/console-actions";
import { Card, Hint, NumInput, Picker, SaveBar, TextIn, TimeIn, Toggle } from "./kit";

/**
 * Founder Console → Availability. The standing weekly patterns the cron replays forward so
 * no calendar can run dry.
 *
 * WHY THIS SCREEN EXISTS. Both top-up jobs were already written, correct and running hourly —
 * and both were unreachable. `slotPatternConfig` was read in two places and written in none, so
 * it sat on its `enabled: false` default and `ensureBookingSlots()` bailed on every tick; the
 * SSS diary had no pattern concept at all and held zero rows from the day it shipped. The result
 * was a public /book page showing an empty calendar for two weeks at the top of the funnel.
 *
 * WHY DISCOVERY CALLS ARE NOW A LIST. There used to be exactly one booking pattern with one
 * owner, which cannot describe what the funnel actually does: the VSL hands off to "Book a call
 * with Asma" and "Book a call with Ameen", and each of those pages renders a calendar scoped to
 * that person. One pattern meant one of the two pages always showed an empty calendar — in
 * production, Asma had 73 open slots and Ameen had none.
 *
 * So the panel leads with the count of slots each pattern would actually produce. A pattern that
 * silently fits nothing (a 30-minute window, a 60-minute call) is the exact failure this whole
 * feature exists to stop, and it must be visible BEFORE saving, not discovered by a prospect.
 */

const WEEKDAY_LABELS: Record<WeekdayKey, string> = {
  MON: "Mon", TUE: "Tue", WED: "Wed", THU: "Thu", FRI: "Fri", SAT: "Sat", SUN: "Sun",
};

type Person = { id: string; name: string };

/** The fields every pattern has, whether it is a named calendar or the single SSS diary. */
type PatternLike = Omit<SlotPatternConfig, "assignedToId"> & { assignedToId: string };

export function AvailabilityPanel({
  calendars,
  sss,
  people,
  sssOwnerName,
  sssDurationMins,
  bookingBufferMins,
  bookingMaxAdvanceDays,
}: {
  calendars: BookingCalendar[];
  sss: SlotPatternConfig;
  people: Person[];
  sssOwnerName: string | null;
  sssDurationMins: number;
  bookingBufferMins: number;
  bookingMaxAdvanceDays: number;
}) {
  return (
    <div className="space-y-8">
      <CalendarsSection
        calendars={calendars}
        people={people}
        bufferMins={bookingBufferMins}
        horizonCap={bookingMaxAdvanceDays}
      />

      <PatternSection
        title="Sales calls — the SSS diary"
        hint={
          <>
            The same idea for your own SSS calendar, which has never held a single slot. Owner{" "}
            {sssOwnerName ? <strong>{sssOwnerName}</strong> : <em>not set</em>} and the{" "}
            {sssDurationMins}-minute call length both come from <strong>Bookings → SSS</strong>,
            not from here — an SSS slot stores each, and two places to set one fact is how they
            end up disagreeing.
          </>
        }
        config={sss}
        onSave={saveSssPatternConfig}
        savedMessage="SSS availability saved"
        people={null}
        bufferMins={0}
        fixedDurationMins={sssDurationMins}
        blockedReason={sssOwnerName ? null : "Set an SSS owner in Bookings → SSS before switching this on."}
      />
    </div>
  );
}

// ───────────────────────────── discovery calendars ─────────────────────────────

function newCalendar(n: number): BookingCalendar {
  return {
    ...DEFAULT_SLOT_PATTERN_CONFIG,
    // `crypto.randomUUID` rather than an index: an index is reused the moment a calendar is
    // deleted, which would silently re-point the activity log's history at a different calendar.
    id: crypto.randomUUID().slice(0, 8),
    name: `Calendar ${n}`,
    weekdays: ["MON", "TUE", "WED", "THU", "FRI"],
  };
}

function CalendarsSection({
  calendars,
  people,
  bufferMins,
  horizonCap,
}: {
  calendars: BookingCalendar[];
  people: Person[];
  bufferMins: number;
  horizonCap: number;
}) {
  const router = useRouter();
  const [draft, setDraft] = useState<BookingCalendar[]>(calendars);
  const [saved, setSaved] = useState<BookingCalendar[]>(calendars);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const dirty = JSON.stringify(draft) !== JSON.stringify(saved);

  const patch = (id: string, next: Partial<BookingCalendar>) =>
    setDraft((p) => p.map((c) => (c.id === id ? { ...c, ...next } : c)));

  async function save() {
    setBusy(true);
    setError(null);
    const res = await saveBookingCalendars({ calendars: draft });
    setBusy(false);
    if (!res.ok) return setError(res.error);
    setSaved(draft);
    toast("Booking calendars saved");
    router.refresh();
  }

  /**
   * Named here rather than left to the server action alone. The action refuses the save, but by
   * then the founder has already filled the form in — telling them while they are still choosing
   * the owner is the difference between a hint and an error message.
   */
  const clash = (() => {
    const seen = new Map<string, string>();
    for (const c of draft.filter((c) => c.enabled && c.assignedToId)) {
      const who = people.find((p) => p.id === c.assignedToId)?.name ?? "that person";
      if (seen.has(c.assignedToId)) return `${seen.get(c.assignedToId)} and ${c.name} are both live for ${who}.`;
      seen.set(c.assignedToId, c.name);
    }
    return null;
  })();

  return (
    <section className="space-y-4">
      <div>
        <h4 className="text-h3 text-ink">Discovery calls — one calendar per person</h4>
        <div className="mt-0.5 max-w-3xl">
          <Hint>
            The weekly shape of each person&apos;s availability. An hourly job replays every live
            calendar forward and creates any missing <strong>OPEN</strong> slot inside the horizon —
            it never touches a booked or blocked one, so it is safe to leave running. A funnel page
            with a booking block shows only <em>its own</em> owner&apos;s times, so the person named
            on the page is the person the prospect gets. Generating a range by hand from Bookings →
            Slots still works and produces exactly the same instants.
          </Hint>
        </div>
      </div>

      {draft.length === 0 && (
        <Card>
          <p className="text-sm text-ink-2">
            No calendars yet — so no slots are generated and every booking page shows an empty
            calendar. Add one below.
          </p>
        </Card>
      )}

      <div className="space-y-4">
        {draft.map((cal) => (
          <CalendarCard
            key={cal.id}
            cal={cal}
            people={people}
            bufferMins={bufferMins}
            horizonCap={horizonCap}
            onChange={(next) => patch(cal.id, next)}
            onRemove={() => setDraft((p) => p.filter((c) => c.id !== cal.id))}
          />
        ))}
      </div>

      <button
        type="button"
        onClick={() => setDraft((p) => [...p, newCalendar(p.length + 1)])}
        disabled={draft.length >= 12}
        className="press inline-flex h-10 items-center gap-1.5 rounded-field border border-line-strong bg-surface px-3.5 text-sm text-ink-2 transition-colors hover:border-primary-tint disabled:opacity-50"
      >
        <Plus size={15} /> Add a calendar
      </button>

      {clash && (
        <p className="rounded-field border border-warn-line bg-warn-soft px-4 py-3 text-sm text-ink-2">
          {clash} Two live calendars on one person generate a single set of slots, so the second
          one will look like it is not working. Give one a different owner, or switch it off.
        </p>
      )}

      <SaveBar dirty={dirty} onSave={save} onReset={() => setDraft(saved)} busy={busy} error={error} />
    </section>
  );
}

function CalendarCard({
  cal,
  people,
  bufferMins,
  horizonCap,
  onChange,
  onRemove,
}: {
  cal: BookingCalendar;
  people: Person[];
  bufferMins: number;
  horizonCap: number;
  onChange: (next: Partial<BookingCalendar>) => void;
  onRemove: () => void;
}) {
  return (
    <Card>
      <div className="space-y-5">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div className="min-w-[16rem] flex-1">
            <Field label="Calendar name" hint="What the team calls it. Renaming is safe.">
              <TextIn
                ariaLabel="Calendar name"
                value={cal.name}
                onChange={(name) => onChange({ name })}
                placeholder="Discovery calls with …"
              />
            </Field>
          </div>
          <button
            type="button"
            onClick={onRemove}
            aria-label={`Remove ${cal.name}`}
            className="press inline-flex h-10 items-center gap-1.5 rounded-field border border-line-strong bg-surface px-3 text-sm text-ink-3 transition-colors hover:border-risk hover:text-risk"
          >
            <Trash2 size={15} /> Remove
          </button>
        </div>

        <Toggle
          checked={cal.enabled}
          onChange={(enabled) => onChange({ enabled })}
          label="Keep this calendar stocked automatically"
          title="The hourly job only runs while this is on."
        />

        <Field label="Whose calendar is this?" hint="The booking page for this person shows only these times.">
          <div className="max-w-[18rem]">
            <Picker
              ariaLabel="Assign slots to"
              value={cal.assignedToId}
              onChange={(assignedToId) => onChange({ assignedToId })}
              options={[{ value: "", label: "Unassigned (the shared /book pool)" }, ...people.map((p) => ({ value: p.id, label: p.name }))]}
            />
          </div>
        </Field>

        <PatternFields
          value={cal}
          onChange={onChange}
          bufferMins={bufferMins}
          horizonCap={horizonCap}
        />
      </div>
    </Card>
  );
}

// ───────────────────────────── shared pattern editor ─────────────────────────────

/**
 * The weekday/hours/interval/horizon block, shared by every calendar card and the SSS diary.
 * Factored out when discovery calls became a list: the preview arithmetic below is the whole
 * point of the screen, and two copies of it is two chances for the preview to stop matching what
 * the job creates.
 */
function PatternFields({
  value,
  onChange,
  bufferMins,
  horizonCap,
  fixedDurationMins,
}: {
  value: PatternLike;
  onChange: (next: Partial<PatternLike>) => void;
  bufferMins: number;
  horizonCap?: number;
  fixedDurationMins?: number;
}) {
  const durationMins = fixedDurationMins ?? value.durationMins;

  // Straight from `slot-plan.ts` — the same module the manual generator and the cron use, so the
  // preview cannot drift from what actually gets created.
  const perDay = useMemo(
    () =>
      slotsPerRunningDay(
        { startTime: value.startTime, endTime: value.endTime, intervalMins: value.intervalMins, durationMins },
        bufferMins,
      ),
    [value.startTime, value.endTime, value.intervalMins, durationMins, bufferMins],
  );

  const effectiveHorizon = horizonCap ? Math.min(value.horizonDays, horizonCap) : value.horizonDays;
  const daysPerWeek = value.weekdays.length;
  const totalInHorizon = Math.round((perDay * daysPerWeek * effectiveHorizon) / 7);

  const toggleDay = (d: WeekdayKey) =>
    onChange({
      weekdays: value.weekdays.includes(d) ? value.weekdays.filter((x) => x !== d) : [...value.weekdays, d],
    });

  return (
    <>
      <Field label="Days of the week" hint="IST. The pattern repeats on these days, every week.">
        <div className="flex flex-wrap gap-2">
          {WEEKDAY_KEYS.map((d) => {
            const on = value.weekdays.includes(d);
            return (
              <button
                key={d}
                type="button"
                aria-pressed={on}
                onClick={() => toggleDay(d)}
                className={`press h-10 min-w-[3.5rem] rounded-field border px-3 text-sm transition-colors duration-150 ease-out ${
                  on
                    ? "border-primary bg-primary text-on-accent"
                    : "border-line-strong bg-surface text-ink-2 hover:border-primary-tint"
                }`}
              >
                {WEEKDAY_LABELS[d]}
              </button>
            );
          })}
        </div>
      </Field>

      <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
        <Field label="First slot starts" hint="IST wall clock.">
          <TimeIn ariaLabel="Window start time" value={value.startTime} onChange={(startTime) => onChange({ startTime })} />
        </Field>
        <Field label="Window closes" hint="No call may still be running after this.">
          <TimeIn ariaLabel="Window end time" value={value.endTime} onChange={(endTime) => onChange({ endTime })} />
        </Field>
        <Field
          label="Minutes between starts"
          hint={bufferMins > 0 ? `Your ${bufferMins}-minute buffer is added on top.` : "Back-to-back."}
        >
          <NumInput
            ariaLabel="Interval minutes"
            value={value.intervalMins}
            onChange={(n) => onChange({ intervalMins: n })}
            min={15}
            max={240}
          />
        </Field>
        {fixedDurationMins === undefined ? (
          <Field label="Call length" hint="What one discovery call runs for.">
            <Picker
              ariaLabel="Call duration"
              value={String(value.durationMins) as "30" | "60"}
              // The schema admits exactly 30 or 60, so narrow rather than widen to `number`.
              onChange={(v) => onChange({ durationMins: v === "60" ? 60 : 30 })}
              options={[
                { value: "30", label: "30 minutes" },
                { value: "60", label: "60 minutes" },
              ]}
            />
          </Field>
        ) : (
          <Field label="Call length" hint="Set in Bookings → SSS.">
            <div className="flex h-10 items-center rounded-field border border-line bg-surface-2 px-3 text-sm text-ink-3">
              {fixedDurationMins} minutes
            </div>
          </Field>
        )}
      </div>

      <Field
        label="Days to keep stocked ahead"
        hint={
          horizonCap
            ? `Capped at your ${horizonCap}-day "how far ahead may someone book" rule — slots beyond it would never be shown.`
            : "How far ahead the rolling window reaches."
        }
      >
        <div className="max-w-[14rem]">
          <NumInput
            ariaLabel="Horizon days"
            value={value.horizonDays}
            onChange={(n) => onChange({ horizonDays: n })}
            min={1}
            max={120}
          />
        </div>
      </Field>

      {/* The number that would have made the eight-day outage obvious on day one. */}
      <div className="rounded-field border border-line bg-surface-2 px-4 py-3">
        <p className="text-caption font-semibold uppercase text-ink-3">What this produces</p>
        {perDay === 0 ? (
          <p className="mt-1 text-sm text-risk">
            Nothing — a {durationMins}-minute call doesn&apos;t fit between {value.startTime} and {value.endTime}. Widen
            the window or shorten the call.
          </p>
        ) : daysPerWeek === 0 ? (
          <p className="mt-1 text-sm text-risk">Nothing — no weekday is selected.</p>
        ) : (
          <p className="mt-1 text-sm text-ink-2">
            <strong className="text-ink tnum">{perDay}</strong> slot{perDay === 1 ? "" : "s"} on each running day ·{" "}
            <strong className="text-ink tnum">{daysPerWeek}</strong> day{daysPerWeek === 1 ? "" : "s"} a week · about{" "}
            <strong className="text-ink tnum">{totalInHorizon}</strong> live across the next {effectiveHorizon} days.
            {!value.enabled && <span className="text-ink-3"> Nothing is created while the switch above is off.</span>}
          </p>
        )}
      </div>
    </>
  );
}

// ───────────────────────────── the SSS diary (single pattern) ─────────────────────────────

function PatternSection({
  title,
  hint,
  config,
  onSave,
  savedMessage,
  bufferMins,
  horizonCap,
  fixedDurationMins,
  blockedReason,
}: {
  title: string;
  hint: React.ReactNode;
  config: SlotPatternConfig;
  onSave: (input: unknown) => Promise<{ ok: true } | { ok: false; error: string }>;
  savedMessage: string;
  /** null = this calendar has a single fixed owner, so there is nothing to assign. */
  people: Person[] | null;
  bufferMins: number;
  horizonCap?: number;
  /** Set when the call length is owned elsewhere and must be shown read-only. */
  fixedDurationMins?: number;
  blockedReason?: string | null;
}) {
  const router = useRouter();
  const [draft, setDraft] = useState<SlotPatternConfig>(config);
  const [saved, setSaved] = useState<SlotPatternConfig>(config);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const dirty = JSON.stringify(draft) !== JSON.stringify(saved);

  async function save() {
    setBusy(true);
    setError(null);
    const res = await onSave(draft);
    setBusy(false);
    if (!res.ok) return setError(res.error);
    setSaved(draft);
    toast(savedMessage);
    router.refresh();
  }

  return (
    <section className="space-y-4">
      <div>
        <h4 className="text-h3 text-ink">{title}</h4>
        <div className="mt-0.5 max-w-3xl">
          <Hint>{hint}</Hint>
        </div>
      </div>

      <Card>
        <div className="space-y-5">
          <Toggle
            checked={draft.enabled}
            onChange={(b) => setDraft((p) => ({ ...p, enabled: b }))}
            label="Keep this calendar stocked automatically"
            disabled={!!blockedReason}
            title={blockedReason ?? "The hourly job only runs while this is on."}
          />
          {blockedReason && (
            <p className="rounded-field border border-warn-line bg-warn-soft px-4 py-3 text-sm text-ink-2">
              {blockedReason}
            </p>
          )}

          <PatternFields
            value={draft}
            onChange={(next) => setDraft((p) => ({ ...p, ...next }))}
            bufferMins={bufferMins}
            horizonCap={horizonCap}
            fixedDurationMins={fixedDurationMins}
          />
        </div>

        <SaveBar
          dirty={dirty}
          onSave={save}
          onReset={() => setDraft(DEFAULT_SLOT_PATTERN_CONFIG)}
          busy={busy}
          error={error}
        />
      </Card>
    </section>
  );
}
