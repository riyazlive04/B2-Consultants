"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { DEFAULT_SLOT_PATTERN_CONFIG, type SlotPatternConfig } from "@/lib/config-schema";
import { WEEKDAY_KEYS, slotsPerRunningDay, type WeekdayKey } from "@/lib/slot-plan";
import { Field } from "@/components/ui/form";
import { toast } from "@/components/ui/feedback";
import { saveSlotPatternConfig, saveSssPatternConfig } from "@/server/console-actions";
import { Card, Hint, NumInput, Picker, SaveBar, TimeIn, Toggle } from "./kit";

/**
 * Founder Console → Availability. The standing weekly patterns the cron replays forward so
 * neither calendar can run dry.
 *
 * WHY THIS SCREEN EXISTS. Both top-up jobs were already written, correct and running hourly —
 * and both were unreachable. `slotPatternConfig` was read in two places and written in none, so
 * it sat on its `enabled: false` default and `ensureBookingSlots()` bailed on every tick; the
 * SSS diary had no pattern concept at all and held zero rows from the day it shipped. The result
 * was a public /book page showing an empty calendar for two weeks at the top of the funnel.
 *
 * So the panel leads with the count of slots the pattern would actually produce. A pattern that
 * silently fits nothing (a 30-minute window, a 60-minute call) is the exact failure this whole
 * feature exists to stop, and it must be visible BEFORE saving, not discovered by a prospect.
 */

const WEEKDAY_LABELS: Record<WeekdayKey, string> = {
  MON: "Mon", TUE: "Tue", WED: "Wed", THU: "Thu", FRI: "Fri", SAT: "Sat", SUN: "Sun",
};

type Person = { id: string; name: string };

export function AvailabilityPanel({
  booking,
  sss,
  people,
  sssOwnerName,
  sssDurationMins,
  bookingBufferMins,
  bookingMaxAdvanceDays,
}: {
  booking: SlotPatternConfig;
  sss: SlotPatternConfig;
  people: Person[];
  sssOwnerName: string | null;
  sssDurationMins: number;
  bookingBufferMins: number;
  bookingMaxAdvanceDays: number;
}) {
  return (
    <div className="space-y-8">
      <PatternSection
        title="Discovery calls — the public /book calendar"
        hint={
          <>
            The weekly shape of your availability. An hourly job replays it forward and creates
            any missing <strong>OPEN</strong> slot inside the horizon — it never touches a booked
            or blocked one, so it is safe to leave running. Generating a range by hand from
            Bookings → Slots still works and produces exactly the same instants.
          </>
        }
        config={booking}
        onSave={saveSlotPatternConfig}
        savedMessage="Booking availability saved"
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

function PatternSection({
  title,
  hint,
  config,
  onSave,
  savedMessage,
  people,
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
  const durationMins = fixedDurationMins ?? draft.durationMins;

  // Straight from `slot-plan.ts` — the same module the manual generator and the cron use, so the
  // preview cannot drift from what actually gets created.
  const perDay = useMemo(
    () =>
      slotsPerRunningDay(
        {
          startTime: draft.startTime,
          endTime: draft.endTime,
          intervalMins: draft.intervalMins,
          durationMins,
        },
        bufferMins,
      ),
    [draft.startTime, draft.endTime, draft.intervalMins, durationMins, bufferMins],
  );

  const effectiveHorizon = horizonCap ? Math.min(draft.horizonDays, horizonCap) : draft.horizonDays;
  const daysPerWeek = draft.weekdays.length;
  const totalInHorizon = Math.round((perDay * daysPerWeek * effectiveHorizon) / 7);

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

  const toggleDay = (d: WeekdayKey) =>
    setDraft((p) => ({
      ...p,
      weekdays: p.weekdays.includes(d) ? p.weekdays.filter((x) => x !== d) : [...p.weekdays, d],
    }));

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

          <Field label="Days of the week" hint="IST. The pattern repeats on these days, every week.">
            <div className="flex flex-wrap gap-2">
              {WEEKDAY_KEYS.map((d) => {
                const on = draft.weekdays.includes(d);
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
              <TimeIn
                ariaLabel="Window start time"
                value={draft.startTime}
                onChange={(startTime) => setDraft((p) => ({ ...p, startTime }))}
              />
            </Field>
            <Field label="Window closes" hint="No call may still be running after this.">
              <TimeIn
                ariaLabel="Window end time"
                value={draft.endTime}
                onChange={(endTime) => setDraft((p) => ({ ...p, endTime }))}
              />
            </Field>
            <Field
              label="Minutes between starts"
              hint={bufferMins > 0 ? `Your ${bufferMins}-minute buffer is added on top.` : "Back-to-back."}
            >
              <NumInput
                ariaLabel="Interval minutes"
                value={draft.intervalMins}
                onChange={(n) => setDraft((p) => ({ ...p, intervalMins: n }))}
                min={15}
                max={240}
              />
            </Field>
            {fixedDurationMins === undefined ? (
              <Field label="Call length" hint="What one discovery call runs for.">
                <Picker
                  ariaLabel="Call duration"
                  value={String(draft.durationMins) as "30" | "60"}
                  // The schema admits exactly 30 or 60, so narrow rather than widen to `number`.
                  onChange={(v) => setDraft((p) => ({ ...p, durationMins: v === "60" ? 60 : 30 }))}
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
                value={draft.horizonDays}
                onChange={(n) => setDraft((p) => ({ ...p, horizonDays: n }))}
                min={1}
                max={120}
              />
            </div>
          </Field>

          {people && (
            <Field label="Assign the calls to" hint="Optional — leave unassigned to decide per booking.">
              <div className="max-w-[18rem]">
                <Picker
                  ariaLabel="Assign slots to"
                  value={draft.assignedToId}
                  onChange={(assignedToId) => setDraft((p) => ({ ...p, assignedToId }))}
                  options={[{ value: "", label: "Unassigned" }, ...people.map((p) => ({ value: p.id, label: p.name }))]}
                />
              </div>
            </Field>
          )}

          {/* The number that would have made the eight-day outage obvious on day one. */}
          <div className="rounded-field border border-line bg-surface-2 px-4 py-3">
            <p className="text-caption font-semibold uppercase text-ink-3">What this produces</p>
            {perDay === 0 ? (
              <p className="mt-1 text-sm text-risk">
                Nothing — a {durationMins}-minute call doesn&apos;t fit between {draft.startTime} and{" "}
                {draft.endTime}. Widen the window or shorten the call.
              </p>
            ) : daysPerWeek === 0 ? (
              <p className="mt-1 text-sm text-risk">Nothing — no weekday is selected.</p>
            ) : (
              <p className="mt-1 text-sm text-ink-2">
                <strong className="text-ink tnum">{perDay}</strong> slot{perDay === 1 ? "" : "s"} on each
                running day · <strong className="text-ink tnum">{daysPerWeek}</strong> day
                {daysPerWeek === 1 ? "" : "s"} a week · about{" "}
                <strong className="text-ink tnum">{totalInHorizon}</strong> live across the next{" "}
                {effectiveHorizon} days.
                {!draft.enabled && (
                  <span className="text-ink-3"> Nothing is created while the switch above is off.</span>
                )}
              </p>
            )}
          </div>
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
