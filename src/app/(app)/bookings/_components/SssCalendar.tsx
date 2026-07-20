"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import {
  Ban, CalendarPlus, ChevronLeft, ChevronRight, GripVertical, Trash2, Undo2, UserCog, X,
} from "lucide-react";
import type { SssSlotView } from "@/server/sss-slots";
import { Btn, IconButton } from "@/components/ui/controls";
import { Modal } from "@/components/ui/Modal";
import { Field, Select, TextInput } from "@/components/ui/form";
import { toast, askConfirm } from "@/components/ui/feedback";
import {
  generateSssSlotsAction, setSssOwnerAction, blockSssSlotAction, unblockSssSlotAction,
  blockSssDayAction, moveJourneyToSlotAction, bookJourneyIntoSlotAction, deleteSssSlotAction,
} from "@/server/sss-actions";

type Member = { id: string; name: string };
type NeedRow = { journeyId: string; leadId: string; name: string; sssAtIst: string | null };
type Day = { key: string; name: string; num: number };
type Pending = { journeyId: string; kind: "move" | "book"; name: string } | null;

const WEEKDAY_NAMES = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

/** Expand an inclusive YYYY-MM-DD range to the day keys whose weekday is selected. */
function expandDates(from: string, to: string, weekdays: boolean[]): string[] {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to)) return [];
  const start = new Date(`${from}T12:00:00Z`);
  const end = new Date(`${to}T12:00:00Z`);
  if (!(start <= end)) return [];
  const out: string[] = [];
  for (let d = new Date(start); d <= end && out.length < 120; d.setUTCDate(d.getUTCDate() + 1)) {
    if (weekdays[d.getUTCDay()]) out.push(d.toISOString().slice(0, 10));
  }
  return out;
}

export function SssCalendar({
  slots, needsScheduling, config, teamMembers, days, weekLabel, nav, canConfigure,
}: {
  slots: SssSlotView[];
  needsScheduling: NeedRow[];
  config: { ownerId: string | null; slotDurationMins: number; rescheduleWithinDays: number };
  teamMembers: Member[];
  days: Day[];
  weekLabel: string;
  nav: { prev: string; next: string; today: string };
  canConfigure: boolean;
}) {
  const router = useRouter();
  const [genOpen, setGenOpen] = useState(false);
  const [pending, setPending] = useState<Pending>(null);
  const [busy, setBusy] = useState(false);

  const ownerName = teamMembers.find((m) => m.id === config.ownerId)?.name ?? null;

  async function run(fn: () => Promise<{ ok: boolean; error?: string; message?: string }>) {
    if (busy) return;
    setBusy(true);
    const res = await fn();
    setBusy(false);
    if (res.ok) { if (res.message) toast(res.message); router.refresh(); }
    else toast(res.error ?? "Something went wrong", "error");
  }

  async function placeInto(slot: SssSlotView) {
    if (!pending || slot.status !== "OPEN") return;
    const p = pending;
    setPending(null);
    await run(() =>
      p.kind === "move"
        ? moveJourneyToSlotAction(p.journeyId, slot.id)
        : bookJourneyIntoSlotAction(p.journeyId, slot.id),
    );
  }

  async function setOwner(id: string) {
    await run(() => setSssOwnerAction({ ...config, ownerId: id || null }));
  }

  const slotsByDay = (key: string) => slots.filter((s) => s.dayKey === key).sort((a, b) => a.timeIst.localeCompare(b.timeIst));

  return (
    <div className="space-y-4" onDragEnd={() => setPending(null)}>
      {/* Toolbar: owner, window, generate, week nav */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-3">
          <div className="flex items-center gap-2 text-sm">
            <UserCog size={16} className="text-accent" />
            {canConfigure ? (
              <Select
                aria-label="SSS owner"
                value={config.ownerId ?? ""}
                onChange={(e) => setOwner(e.target.value)}
                options={[{ value: "", label: "— pick who runs the SSS —" }, ...teamMembers.map((m) => ({ value: m.id, label: m.name }))]}
              />
            ) : (
              <span className="font-semibold text-ink">{ownerName ? `SSS run by ${ownerName}` : "SSS owner not set"}</span>
            )}
          </div>
          <span className="text-caption text-ink-3">Auto-reschedule window: {config.rescheduleWithinDays} days</span>
        </div>
        <div className="flex items-center gap-2">
          <Btn icon={<CalendarPlus size={15} />} onClick={() => setGenOpen(true)} disabled={!config.ownerId}>
            Generate slots
          </Btn>
          <div className="flex items-center gap-1">
            <Link href={nav.prev} className="grid h-8 w-8 place-items-center rounded-field border border-line text-muted hover:bg-surface-2" aria-label="Previous week"><ChevronLeft size={16} /></Link>
            <Link href={nav.today} className="rounded-field border border-line px-3 py-1.5 text-xs font-medium text-muted hover:bg-surface-2">Today</Link>
            <Link href={nav.next} className="grid h-8 w-8 place-items-center rounded-field border border-line text-muted hover:bg-surface-2" aria-label="Next week"><ChevronRight size={16} /></Link>
          </div>
        </div>
      </div>

      {!config.ownerId && (
        <p className="rounded-field border border-dashed border-line bg-surface-2 px-4 py-3 text-sm text-ink-3">
          Pick who runs the Success Strategy Session {canConfigure ? "above" : "(an admin sets this)"} to start laying out SSS slots.
        </p>
      )}

      {pending && (
        <div className="flex items-center gap-2 rounded-field border border-primary bg-primary-soft px-4 py-2 text-sm text-primary-strong">
          Placing <strong>{pending.name}</strong> — click an open slot, or drop them on one.
          <button onClick={() => setPending(null)} className="ml-auto inline-flex items-center gap-1 text-xs font-semibold hover:underline"><X size={13} /> Cancel</button>
        </div>
      )}

      {/* Week label */}
      <h3 className="font-display text-h2 font-semibold">{weekLabel}</h3>

      {/* Week grid */}
      <div className="overflow-x-auto">
        <div className="grid min-w-[760px] grid-cols-7 gap-2">
          {days.map((d) => {
            const daySlots = slotsByDay(d.key);
            const hasSlots = daySlots.length > 0;
            return (
              <div key={d.key} className="min-w-0">
                <div className="mb-2 flex items-center justify-between rounded-field bg-surface-2 px-2 py-1.5 text-xs">
                  <span className="font-medium text-ink-2">{d.name} <span className="font-display font-bold">{d.num}</span></span>
                  {hasSlots && config.ownerId && (
                    <IconButton
                      label={`Block ${d.name}`}
                      size="sm"
                      onClick={() => run(async () => {
                        if (!(await askConfirm({ title: `Block all of ${d.name} ${d.num}?`, body: "Booked prospects are moved to the next open slot and notified." }))) return { ok: true };
                        return blockSssDayAction(config.ownerId!, d.key);
                      })}
                    >
                      <Ban size={13} />
                    </IconButton>
                  )}
                </div>
                <div className="space-y-1.5">
                  {daySlots.map((s) => (
                    <SlotCell
                      key={s.id}
                      slot={s}
                      pendingActive={!!pending}
                      onArmMove={() => setPending({ journeyId: s.journeyId!, kind: "move", name: s.prospectName ?? "prospect" })}
                      onPlace={() => placeInto(s)}
                      onDropPlace={() => placeInto(s)}
                      onDragStartMove={() => s.journeyId && setPending({ journeyId: s.journeyId, kind: "move", name: s.prospectName ?? "prospect" })}
                      onBlock={() => run(() => blockSssSlotAction(s.id))}
                      onUnblock={() => run(() => unblockSssSlotAction(s.id))}
                      onDelete={() => run(async () => {
                        if (!(await askConfirm({ title: "Delete this slot?", danger: true }))) return { ok: true };
                        return deleteSssSlotAction(s.id);
                      })}
                    />
                  ))}
                  {!hasSlots && <p className="rounded-field border border-dashed border-line py-4 text-center text-caption text-ink-3">—</p>}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Needs an SSS time */}
      <div className="rounded-card border border-line bg-surface p-4">
        <h4 className="text-sm font-semibold text-ink">Needs an SSS time ({needsScheduling.length})</h4>
        <p className="mt-0.5 text-caption text-ink-3">Highly-qualified prospects with no SSS slot — including anyone bumped off a blocked slot. Drag one onto an open slot, or click “Book”.</p>
        {needsScheduling.length === 0 ? (
          <p className="mt-3 text-sm text-ink-3">Everyone qualified is scheduled. 🎉</p>
        ) : (
          <div className="mt-3 flex flex-wrap gap-2">
            {needsScheduling.map((n) => (
              <div
                key={n.journeyId}
                draggable
                onDragStart={() => setPending({ journeyId: n.journeyId, kind: "book", name: n.name })}
                className="flex items-center gap-2 rounded-field border border-line bg-surface-2 px-3 py-1.5 text-sm"
              >
                <GripVertical size={13} className="text-ink-3" />
                <span className="font-medium text-ink">{n.name}</span>
                <button
                  onClick={() => setPending({ journeyId: n.journeyId, kind: "book", name: n.name })}
                  className="rounded-full bg-primary px-2 py-0.5 text-caption font-semibold text-on-accent hover:opacity-90"
                >
                  Book
                </button>
              </div>
            ))}
          </div>
        )}
      </div>

      {config.ownerId && (
        <GenerateModal
          open={genOpen}
          onClose={() => setGenOpen(false)}
          defaultDuration={config.slotDurationMins}
          startKey={days[0]?.key ?? ""}
          endKey={days[6]?.key ?? ""}
          onSubmit={async (payload) => {
            await run(() => generateSssSlotsAction({ ownerId: config.ownerId, ...payload }));
            setGenOpen(false);
          }}
        />
      )}
    </div>
  );
}

function SlotCell({
  slot, pendingActive, onArmMove, onPlace, onDropPlace, onDragStartMove, onBlock, onUnblock, onDelete,
}: {
  slot: SssSlotView;
  pendingActive: boolean;
  onArmMove: () => void;
  onPlace: () => void;
  onDropPlace: () => void;
  onDragStartMove: () => void;
  onBlock: () => void;
  onUnblock: () => void;
  onDelete: () => void;
}) {
  const tint =
    slot.status === "BOOKED" ? { bg: "color-mix(in srgb, var(--chart-1) 10%, white)", edge: "var(--chart-1)" }
    : slot.status === "OPEN" ? { bg: "color-mix(in srgb, var(--ok) 10%, white)", edge: "var(--ok)" }
    : { bg: "var(--surface-2)", edge: "var(--muted)" };

  const droppable = slot.status === "OPEN" && pendingActive;

  return (
    <div
      className={`group/cell rounded-field p-2 ${droppable ? "cursor-pointer ring-2 ring-primary ring-offset-1" : ""}`}
      style={{ background: tint.bg, borderLeft: `3px solid ${tint.edge}` }}
      onClick={droppable ? onPlace : undefined}
      onDragOver={slot.status === "OPEN" ? (e) => e.preventDefault() : undefined}
      onDrop={slot.status === "OPEN" ? (e) => { e.preventDefault(); onDropPlace(); } : undefined}
    >
      <div className="flex items-center justify-between">
        <p className="text-caption font-medium text-muted">{slot.timeIst} · {slot.durationMins}m</p>
        <div className="flex items-center gap-0.5 opacity-0 transition-opacity group-hover/cell:opacity-100">
          {slot.status === "BOOKED" && <IconButton label="Reschedule (block this slot)" size="sm" onClick={onBlock}><Ban size={12} /></IconButton>}
          {slot.status === "OPEN" && <>
            <IconButton label="Block slot" size="sm" onClick={onBlock}><Ban size={12} /></IconButton>
            <IconButton label="Delete slot" size="sm" onClick={onDelete}><Trash2 size={12} /></IconButton>
          </>}
          {slot.status === "BLOCKED" && <>
            <IconButton label="Unblock slot" size="sm" onClick={onUnblock}><Undo2 size={12} /></IconButton>
            <IconButton label="Delete slot" size="sm" onClick={onDelete}><Trash2 size={12} /></IconButton>
          </>}
        </div>
      </div>
      {slot.status === "BOOKED" ? (
        <div
          draggable
          onDragStart={onDragStartMove}
          onClick={onArmMove}
          title="Drag onto an open slot to reschedule, or click to pick a slot"
          className="mt-0.5 flex cursor-grab items-center gap-1 truncate text-xs font-semibold text-ink active:cursor-grabbing"
        >
          <GripVertical size={12} className="flex-none text-ink-3" />
          <span className="truncate">{slot.prospectName ?? "Booked"}</span>
        </div>
      ) : (
        <p className="mt-0.5 truncate text-xs font-semibold text-muted">{slot.status === "OPEN" ? "Open" : "Blocked"}</p>
      )}
    </div>
  );
}

function GenerateModal({
  open, onClose, defaultDuration, startKey, endKey, onSubmit,
}: {
  open: boolean;
  onClose: () => void;
  defaultDuration: number;
  startKey: string;
  endKey: string;
  onSubmit: (payload: { dates: string[]; times: string[]; durationMins: number }) => void;
}) {
  const [from, setFrom] = useState(startKey);
  const [to, setTo] = useState(endKey);
  const [weekdays, setWeekdays] = useState<boolean[]>([false, true, true, true, true, true, false]); // Mon–Fri
  const [times, setTimes] = useState<string[]>([]);
  const [timeDraft, setTimeDraft] = useState("11:00");
  const [duration, setDuration] = useState(defaultDuration);

  const dates = expandDates(from, to, weekdays);
  const canSubmit = dates.length > 0 && times.length > 0;

  function addTime() {
    if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(timeDraft)) return;
    setTimes((t) => (t.includes(timeDraft) ? t : [...t, timeDraft].sort()));
  }

  return (
    <Modal open={open} onClose={onClose} title="Generate SSS slots" size="md">
      <div className="space-y-4">
        <div className="grid grid-cols-2 gap-3">
          <Field label="From"><TextInput type="date" value={from} onChange={(e) => setFrom(e.target.value)} /></Field>
          <Field label="To"><TextInput type="date" value={to} onChange={(e) => setTo(e.target.value)} /></Field>
        </div>
        <Field label="Days of the week">
          <div className="flex flex-wrap gap-1.5">
            {WEEKDAY_NAMES.map((n, i) => (
              <button
                key={n}
                type="button"
                onClick={() => setWeekdays((w) => w.map((v, j) => (j === i ? !v : v)))}
                className={`rounded-full px-3 py-1 text-sm font-semibold ${weekdays[i] ? "bg-primary text-on-accent" : "bg-surface-2 text-ink-2"}`}
              >
                {n}
              </button>
            ))}
          </div>
        </Field>
        <Field label="Times (IST)">
          <div className="flex items-center gap-2">
            <TextInput type="time" value={timeDraft} onChange={(e) => setTimeDraft(e.target.value)} className="w-36" />
            <Btn type="button" variant="soft" size="sm" onClick={addTime}>Add time</Btn>
          </div>
          {times.length > 0 && (
            <div className="mt-2 flex flex-wrap gap-1.5">
              {times.map((t) => (
                <span key={t} className="inline-flex items-center gap-1 rounded-full bg-surface-2 px-2.5 py-1 text-sm">
                  {t}
                  <button type="button" onClick={() => setTimes((ts) => ts.filter((x) => x !== t))} aria-label={`Remove ${t}`}><X size={12} /></button>
                </span>
              ))}
            </div>
          )}
        </Field>
        <Field label="Duration (minutes)">
          <TextInput kind="int" maxLength={3} value={String(duration)} onChange={(e) => setDuration(Number(e.target.value) || defaultDuration)} className="w-36" />
        </Field>
        <p className="text-caption text-ink-3">
          {canSubmit ? `Will create up to ${dates.length * times.length} slot${dates.length * times.length === 1 ? "" : "s"} (${dates.length} day${dates.length === 1 ? "" : "s"} × ${times.length} time${times.length === 1 ? "" : "s"}). Existing slots are skipped.` : "Pick a date range with at least one weekday selected, and add at least one time."}
        </p>
        <div className="flex justify-end gap-2 pt-1">
          <Btn variant="ghost" type="button" onClick={onClose}>Cancel</Btn>
          <Btn type="button" disabled={!canSubmit} onClick={() => onSubmit({ dates, times, durationMins: duration })}>Generate</Btn>
        </div>
      </div>
    </Modal>
  );
}
