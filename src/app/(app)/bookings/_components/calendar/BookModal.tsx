"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Modal } from "@/components/ui/Modal";
import { Btn, SegmentedControl } from "@/components/ui/controls";
import { Field, FormError, Select, TextInput } from "@/components/ui/form";
import { DatePicker } from "@/components/ui/DatePicker";
import { TimePicker } from "@/components/ui/TimePicker";
import { toast } from "@/components/ui/feedback";
import { guardAction } from "@/lib/action-guard";
import { blockRangeError } from "@/lib/calendar-book";
import { istSlot, istTimeLabel } from "@/lib/calendar-grid";
import type { CalType } from "@/lib/calendar-event";
import {
  blockTimeRange, bookDiscoveryForLead, listOpenSlotsForDay, searchBookableLeads,
  type OpenSlotOption,
} from "@/server/booking-actions";

/**
 * Synamate's "+ New" dialog: book a call for someone, or block time off. Opened from the toolbar
 * and from clicking an empty half-hour on the grid, which prefills that day and time.
 *
 * Two tabs, not two dialogs - they are the two things you come to an empty slot to do, and
 * Synamate puts them side by side for the same reason.
 *
 * Synamate's "Custom" time (a call at any minute you like) is deliberately not offered: a B2
 * booking must sit in a generated slot, because the slot is what the public page, the confirm
 * loop and the reschedule promote-next all work from.
 */

type Lead = { id: string; name: string; subtitle: string };

const hhmm = (min: number) => `${String(Math.floor(min / 60)).padStart(2, "0")}:${String(min % 60).padStart(2, "0")}`;

export function BookModal({
  dayKey, min, team, onClose,
}: {
  /** The day the grid was showing, or the lane that was clicked. */
  dayKey: string;
  /** Minutes past IST midnight of the clicked lane; null when opened from the toolbar. */
  min: number | null;
  team: { id: string; name: string | null }[];
  onClose: () => void;
}) {
  const router = useRouter();
  const [tab, setTab] = useState<"appointment" | "blocked">("appointment");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // ── Who, and when ────────────────────────────────────────────────────────────
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<Lead[]>([]);
  const [lead, setLead] = useState<Lead | null>(null);
  const [date, setDate] = useState(dayKey);
  const [slots, setSlots] = useState<OpenSlotOption[] | null>(null);
  const [slotId, setSlotId] = useState("");
  const [confirmed, setConfirmed] = useState<"yes" | "no">("yes");
  /** Only the FIRST slot load honours the clicked lane; after that the reader is choosing. */
  const wantMin = useRef(min);

  // ── Blocking ─────────────────────────────────────────────────────────────────
  const [calendar, setCalendar] = useState<CalType>("DISCO");
  const [ownerId, setOwnerId] = useState(team[0]?.id ?? "");
  const [from, setFrom] = useState(hhmm(min ?? 9 * 60));
  const [to, setTo] = useState(hhmm((min ?? 9 * 60) + 60));

  // Typing searches, but not on every keystroke: a quarter of a second of quiet first.
  useEffect(() => {
    if (query.trim().length < 2) return setResults([]);
    const id = setTimeout(async () => {
      const res = await guardAction(() => searchBookableLeads(query));
      if (res.ok) setResults(res.value);
    }, 250);
    return () => clearTimeout(id);
  }, [query]);

  useEffect(() => {
    let live = true;
    setSlots(null);
    guardAction(() => listOpenSlotsForDay(date)).then((res) => {
      if (!live || !res.ok) return;
      setSlots(res.value);
      const wanted = wantMin.current;
      wantMin.current = null;
      const hit = wanted === null ? undefined : res.value.find((s) => istSlot(s.startsAt).min === wanted);
      setSlotId(hit?.id ?? "");
    });
    return () => {
      live = false;
    };
  }, [date]);

  const book = async () => {
    setError(null);
    if (!lead) return setError("Pick who the call is for.");
    if (!slotId) return setError("Pick a time.");
    setBusy(true);
    const res = await guardAction(() => bookDiscoveryForLead({ leadId: lead.id, slotId, confirmed: confirmed === "yes" }));
    setBusy(false);
    const out = res.ok ? res.value : { ok: false as const, error: res.error };
    if (!out.ok) return setError(out.error ?? "That did not save");
    toast(`Call booked for ${lead.name}`);
    router.refresh();
    onClose();
  };

  const block = async () => {
    setError(null);
    const bad = blockRangeError(from, to);
    if (bad) return setError(bad);
    setBusy(true);
    const res = await guardAction(() => blockTimeRange({ calendar, ownerId, dayKey: date, from, to }));
    setBusy(false);
    const out = res.ok ? res.value : { ok: false as const, error: res.error, summary: undefined };
    if (!out.ok) return setError(out.error ?? "That did not save");
    toast(out.summary ?? "Time blocked");
    router.refresh();
    onClose();
  };

  const slotOptions = (slots ?? []).map((s) => ({
    value: s.id,
    label: `${istTimeLabel(s.startsAt)} · ${s.ownerName ?? "Unassigned"} · ${s.durationMins} min`,
  }));

  return (
    <Modal open onClose={onClose} title="New entry" subtitle="GMT +05:30 Asia/Kolkata (IST)">
      <div className="space-y-5">
        <SegmentedControl
          value={tab}
          onChange={setTab}
          ariaLabel="What to add"
          options={[
            { value: "appointment", label: "Appointment" },
            { value: "blocked", label: "Blocked off time" },
          ]}
        />

        {tab === "appointment" ? (
          <div className="space-y-4">
            <Field label="Contact" required hint="Search an existing contact by name, phone or email.">
              {lead ? (
                <div className="flex items-center justify-between gap-3 rounded-field border border-line bg-surface-2 px-3 py-2">
                  <span className="min-w-0">
                    <span className="block truncate text-sm font-semibold text-ink">{lead.name}</span>
                    <span className="block truncate text-caption text-muted">{lead.subtitle}</span>
                  </span>
                  <Btn variant="ghost" size="sm" onClick={() => { setLead(null); setQuery(""); }}>
                    Change
                  </Btn>
                </div>
              ) : (
                <div className="space-y-1">
                  <TextInput
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                    aria-label="Search contacts"
                    placeholder="Name, phone or email"
                  />
                  {results.length > 0 && (
                    <ul className="max-h-48 overflow-auto rounded-field border border-line bg-surface">
                      {results.map((r) => (
                        <li key={r.id}>
                          <button
                            type="button"
                            onClick={() => setLead(r)}
                            className="block w-full px-3 py-2 text-left hover:bg-surface-2"
                          >
                            <span className="block truncate text-sm font-medium text-ink">{r.name}</span>
                            <span className="block truncate text-caption text-muted">{r.subtitle}</span>
                          </button>
                        </li>
                      ))}
                    </ul>
                  )}
                  {query.trim().length >= 2 && results.length === 0 && (
                    <p className="text-caption text-muted">Nobody matches. A new prospect books through /book.</p>
                  )}
                </div>
              )}
            </Field>

            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Date">
                <DatePicker value={date} onChange={(e) => setDate(e.target.value)} aria-label="Date" />
              </Field>
              <Field
                label="Time"
                required
                hint={slots === null ? "Loading the open times..." : slots.length === 0 ? "No open slots that day - generate some under Availability." : undefined}
              >
                <Select
                  value={slotId}
                  aria-label="Time"
                  disabled={!slots?.length}
                  placeholder="Pick an open slot"
                  onChange={(e) => setSlotId(e.target.value)}
                  options={slotOptions}
                />
              </Field>
            </div>

            <Field
              label="Status"
              hint={
                lead && lead.subtitle === "No phone or email"
                  ? "This contact has no phone or email, so no confirmation can be sent to them."
                  : "Confirmed means they have already agreed to this time, so the confirmation loop leaves them alone."
              }
            >
              <SegmentedControl
                value={confirmed}
                onChange={setConfirmed}
                ariaLabel="Status"
                options={[
                  { value: "yes", label: "Confirmed" },
                  { value: "no", label: "Unconfirmed" },
                ]}
              />
            </Field>

            <FormError message={error} />
            <div className="flex flex-col gap-2 border-t border-line pt-4 sm:flex-row sm:justify-end">
              <Btn variant="ghost" onClick={onClose}>Cancel</Btn>
              <Btn variant="primary" onClick={book} busy={busy}>Book appointment</Btn>
            </div>
          </div>
        ) : (
          <div className="space-y-4">
            <p className="text-caption text-muted">
              Open times in this range stop being bookable. Calls already booked in it keep their
              time - blocking a diary never cancels anybody.
            </p>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Calendar">
                <Select
                  value={calendar}
                  aria-label="Calendar"
                  onChange={(e) => setCalendar(e.target.value as CalType)}
                  options={[
                    { value: "DISCO", label: "Discovery calls" },
                    { value: "SSS", label: "Strategy sessions" },
                  ]}
                />
              </Field>
              <Field label="Team member">
                <Select
                  value={ownerId}
                  aria-label="Team member"
                  onChange={(e) => setOwnerId(e.target.value)}
                  options={[
                    ...team.map((u) => ({ value: u.id, label: u.name ?? "Unnamed" })),
                    { value: "", label: "Unassigned" },
                  ]}
                />
              </Field>
              <Field label="Date">
                <DatePicker value={date} onChange={(e) => setDate(e.target.value)} aria-label="Block date" />
              </Field>
              <div className="grid grid-cols-2 gap-3">
                <Field label="From">
                  <TimePicker value={from} onChange={(e) => setFrom(e.target.value)} aria-label="From" />
                </Field>
                <Field label="To">
                  <TimePicker value={to} onChange={(e) => setTo(e.target.value)} aria-label="To" />
                </Field>
              </div>
            </div>

            <FormError message={error} />
            <div className="flex flex-col gap-2 border-t border-line pt-4 sm:flex-row sm:justify-end">
              <Btn variant="ghost" onClick={onClose}>Cancel</Btn>
              <Btn variant="primary" onClick={block} busy={busy}>Block the time</Btn>
            </div>
          </div>
        )}
      </div>
    </Modal>
  );
}
