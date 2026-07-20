"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Clock, UserPlus, Users } from "lucide-react";
import type { BatchWithRoom, PoolRow, PoolSuggestionRow } from "@/server/pending-pool-metrics";
import type { GnStudentOption } from "@/server/german-note-metrics";
import type { LevelOption } from "@/lib/levels";
import { addPendingJoiner, removePendingJoiner, seatPendingJoiner } from "@/server/pending-pool-actions";
import { Btn, IconButton } from "@/components/ui/controls";
import { Field, FormError, Select, SubmitButton, TextInput } from "@/components/ui/form";
import { askConfirm, toast } from "@/components/ui/feedback";
import { Modal } from "@/components/ui/Modal";
import { Trash2 } from "lucide-react";

/**
 * The pending pool (spec Part 2 §2.2) — everyone who has committed but has no seat yet.
 *
 * This screen exists because the founders' rule creates a gap: a workshop with one joiner
 * opens no batch, so that person is currently remembered only by whoever ran the workshop.
 * The waiting-days column is the point — a pool you can't see the age of is just a nicer
 * place to forget people.
 */

const PREFS = [
  { value: "EITHER", label: "Either" },
  { value: "WEEKDAY", label: "Weekday" },
  { value: "WEEKEND", label: "Weekend" },
] as const;

export function PendingPoolPanel({
  rows,
  suggestions,
  batchesWithRoom,
  students,
  levelOptions,
}: {
  rows: PoolRow[];
  suggestions: PoolSuggestionRow[];
  batchesWithRoom: BatchWithRoom[];
  students: GnStudentOption[];
  levelOptions: LevelOption[];
}) {
  const router = useRouter();
  const [adding, setAdding] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  async function add(form: FormData) {
    setError(null);
    const res = await addPendingJoiner(form);
    if (!res.ok) return setError(res.error);
    setAdding(false);
    toast("Held in the pending pool");
    router.refresh();
  }

  async function seat(joinerId: string, batchId: string) {
    if (!batchId) return;
    setBusyId(joinerId);
    const res = await seatPendingJoiner(joinerId, batchId);
    setBusyId(null);
    if (!res.ok) return toast(res.error);
    toast("Seated into the batch");
    router.refresh();
  }

  async function remove(row: PoolRow) {
    const ok = await askConfirm({
      title: `Remove ${row.fullName} from the pool?`,
      body: "They'll no longer be waiting for a seat. This doesn't touch their student record or payments.",
      confirmLabel: "Remove",
      danger: true,
    });
    if (!ok) return;
    const res = await removePendingJoiner(row.id);
    if (!res.ok) return toast(res.error);
    toast("Removed from the pool");
    router.refresh();
  }

  const openable = suggestions.filter((s) => s.openable);
  const holding = suggestions.filter((s) => !s.openable);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="max-w-2xl text-sm text-muted">
          People who&apos;ve committed but have no seat yet. A workshop that yields a single joiner
          opens no batch — they wait here until enough people accumulate. This is why batch
          numbers legitimately have gaps.
        </p>
        <Btn onClick={() => { setAdding(true); setError(null); }}>
          <UserPlus size={15} /> Hold someone
        </Btn>
      </div>

      {/* What the pool says to do next. Shown before the list because it's the reason to look. */}
      {suggestions.length > 0 && (
        <div className="grid gap-3 sm:grid-cols-2">
          {openable.map((s) => (
            <div key={`${s.level}-${s.slot}`} className="rounded-field border border-accent/40 bg-accent-soft px-4 py-3">
              <p className="text-caption font-semibold uppercase text-ink-3">Ready to open</p>
              <p className="mt-1 text-sm font-semibold text-ink">
                {s.level} · {s.slot.toLowerCase()} — {s.count} waiting
              </p>
              <p className="mt-0.5 text-xs text-muted">{s.reason}</p>
            </div>
          ))}
          {holding.map((s) => (
            <div key={`${s.level}-${s.slot}`} className="rounded-field border border-line bg-surface-2 px-4 py-3">
              <p className="text-caption font-semibold uppercase text-ink-3">Holding</p>
              <p className="mt-1 text-sm font-semibold text-ink">
                {s.level} · {s.slot.toLowerCase()} — {s.count} waiting
              </p>
              <p className="mt-0.5 text-xs text-muted">{s.reason}</p>
            </div>
          ))}
        </div>
      )}

      {rows.length === 0 ? (
        <div className="rounded-field border border-line bg-surface-2 px-4 py-8 text-center">
          <Users size={20} className="mx-auto text-ink-3" />
          <p className="mt-2 text-sm text-muted">Nobody is waiting. Everyone who&apos;s committed has a seat.</p>
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-line text-left text-caption uppercase text-ink-3">
                <th className="py-2 pr-4 font-medium">Student</th>
                <th className="py-2 pr-4 font-medium">Level</th>
                <th className="py-2 pr-4 font-medium">Prefers</th>
                <th className="py-2 pr-4 font-medium">Waiting</th>
                <th className="py-2 pr-4 font-medium">From</th>
                <th className="py-2 pr-4 font-medium">Seat into</th>
                <th className="py-2 font-medium" />
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => {
                // Only offer batches at this joiner's level — the action re-checks anyway,
                // but offering an impossible choice is a UI that lies.
                const options = batchesWithRoom.filter((b) => b.level === r.level);
                return (
                  <tr key={r.id} className="border-b border-line/60">
                    <td className="py-2 pr-4">
                      <div className="font-medium text-ink">{r.fullName}</div>
                      {r.email && <div className="text-xs text-muted">{r.email}</div>}
                    </td>
                    <td className="py-2 pr-4 text-ink-2">{r.level}</td>
                    <td className="py-2 pr-4 text-ink-2">
                      {r.preference.toLowerCase()}
                      {r.preferredTime && <span className="text-muted"> · {r.preferredTime}</span>}
                    </td>
                    <td className="py-2 pr-4">
                      <span
                        className={`inline-flex items-center gap-1 ${r.waitingDays >= 30 ? "font-semibold text-ink" : "text-ink-2"}`}
                        title={`Waiting since ${new Date(r.createdAt).toLocaleDateString()}`}
                      >
                        <Clock size={13} /> {r.waitingDays}d
                      </span>
                    </td>
                    <td className="py-2 pr-4 text-xs text-muted">{r.workshopName ?? "—"}</td>
                    <td className="py-2 pr-4">
                      {options.length === 0 ? (
                        <span className="text-xs text-muted">No {r.level} batch with room</span>
                      ) : (
                        <select
                          aria-label={`Seat ${r.fullName} into a batch`}
                          disabled={busyId === r.id}
                          defaultValue=""
                          onChange={(e) => seat(r.id, e.target.value)}
                          className="rounded-btn border border-line bg-surface px-2 py-1 text-xs text-ink"
                        >
                          <option value="">Choose…</option>
                          {options.map((b) => (
                            <option key={b.id} value={b.id}>
                              {b.name} ({b.filled}/{b.targetStrength})
                            </option>
                          ))}
                        </select>
                      )}
                    </td>
                    <td className="py-2">
                      <IconButton label={`Remove ${r.fullName}`} size="sm" onClick={() => remove(r)}>
                        <Trash2 size={15} />
                      </IconButton>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      <Modal open={adding} onClose={() => setAdding(false)} title="Hold someone in the pool">
          <form action={add} className="space-y-4">
            <Field label="Student" hint="They must already exist as a student.">
              <Select
                name="studentId"
                options={students.map((s) => ({ value: s.id, label: s.fullName }))}
              />
            </Field>
            <Field label="Level">
              <Select name="level" options={levelOptions} />
            </Field>
            <Field label="Timetable" hint="'Either' keeps them available for whichever batch opens first.">
              <Select name="preference" options={PREFS.map((p) => ({ value: p.value, label: p.label }))} />
            </Field>
            <Field label="Preferred time" hint="As they said it on the confirmation call — e.g. 'evening', 'after 7pm'.">
              <TextInput name="preferredTime" />
            </Field>
            <Field label="Notes">
              <TextInput name="notes" />
            </Field>
            <FormError message={error} />
            <div className="flex justify-end gap-2">
              <Btn variant="ghost" onClick={() => setAdding(false)}>Cancel</Btn>
              <SubmitButton>Hold in pool</SubmitButton>
            </div>
          </form>
      </Modal>
    </div>
  );
}
