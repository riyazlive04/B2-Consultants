"use client";

import { useState } from "react";
import { Flame, ClipboardList, Target, Sparkles } from "lucide-react";
import { submitDailyLog, updateOwnOkrProgress } from "@/server/people-actions";
import type { MyDailyLogView } from "@/server/people-metrics";
import { type QuestProgress } from "@/lib/gamification";
import { QuestCard } from "@/components/ui/gamification";
import { DataTable, type Column } from "@/components/ui/DataTable";
import { celebrate, toast } from "@/components/ui/feedback";
import { Field, FormError, SubmitButton, TextArea, TextInput } from "@/components/ui/form";
import { SIGNAL_META, signalForPercent } from "@/lib/signals";
import { formatDate, formatPct } from "@/lib/format";
import { DAILY_LOG_FIELDS, LOG_FIELD_SHORT } from "@/lib/labels";

type LogRow = MyDailyLogView["myLogs"][number];

/** Compact donut ring for a single percentage. */
function Donut({ pct, color, label }: { pct: number; color: string; label: string }) {
  const R = 32;
  const C = 2 * Math.PI * R;
  const p = Math.max(0, Math.min(100, pct));
  return (
    <div className="relative grid place-items-center">
      <svg width={84} height={84} viewBox="0 0 84 84" className="-rotate-90">
        <circle cx="42" cy="42" r={R} fill="none" stroke="var(--surface-2)" strokeWidth="9" />
        <circle
          cx="42"
          cy="42"
          r={R}
          fill="none"
          stroke={color}
          strokeWidth="9"
          strokeLinecap="round"
          strokeDasharray={C}
          strokeDashoffset={C * (1 - p / 100)}
          style={{ transition: "stroke-dashoffset 500ms ease" }}
        />
      </svg>
      <span className="absolute font-display text-sm font-bold tabular-nums">{label}</span>
    </div>
  );
}

export function DailyLogClient({
  view,
  quests = [],
  logXp,
  streakMilestones,
}: {
  view: MyDailyLogView;
  quests?: QuestProgress[];
  /** XP a log is worth under today's rules — the toast must not quote a stale number */
  logXp: number;
  /** streak lengths that pay a bonus today; hitting one earns confetti */
  streakMilestones: number[];
}) {
  const [error, setError] = useState<string | null>(null);
  const [okrError, setOkrError] = useState<string | null>(null);

  const fields = view.variant ? DAILY_LOG_FIELDS[view.variant] : [];
  const autoCount = fields.filter(([name]) => view.autoCaptured[name] !== undefined).length;

  const avgOkr = view.okrs.length
    ? Math.round(view.okrs.reduce((a, o) => a + o.completionPct, 0) / view.okrs.length)
    : 0;
  const onTrack = view.okrs.filter((o) => signalForPercent(o.completionPct) === "ok").length;

  const submit = async (form: FormData) => {
    setError(null);
    const res = await submitDailyLog(form);
    if (!res.ok) return setError(res.error);
    const newStreak = view.streak + 1;
    toast(
      view.streak > 0
        ? `Log submitted · +${logXp} XP - ${newStreak}-day streak! 🔥`
        : `Log submitted · +${logXp} XP ✓`,
    );
    if (streakMilestones.includes(newStreak)) celebrate(); // milestone streaks get confetti
  };

  const columns: Column<LogRow>[] = [
    { key: "date", header: "Date", cell: (r) => formatDate(r.date), value: (r) => r.date.slice(0, 10) },
    ...fields.map(([name, label]) => ({
      key: name,
      header: LOG_FIELD_SHORT[name] ?? label,
      align: "right" as const,
      cell: (r: LogRow) => r.values[name] ?? "-",
      value: (r: LogRow) => r.values[name] ?? null,
    })),
    { key: "notes", header: "Notes / blockers", cell: (r) => r.notes ?? "", value: (r) => r.notes ?? "" },
    {
      key: "correction", header: "Admin correction",
      cell: (r) => (r.correctionNote ? <span className="text-watch">{r.correctionNote}</span> : ""),
      value: (r) => r.correctionNote ?? "",
    },
  ];

  const nextMilestone = [7, 14, 30, 60, 90].find((m) => view.streak < m) ?? 90;

  return (
    <div className="space-y-6">
      {/* Stat row */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {/* Streak with milestone progress */}
        <div className="rise-in card-hover rounded-card border border-line bg-surface p-5 shadow-card">
          <div className="flex items-center justify-between">
            <p className="flex items-center gap-1.5 text-label text-muted">
              <Flame size={15} /> Logging streak
            </p>
            {view.streak > 0 && <span className="text-xl" aria-hidden>🔥</span>}
          </div>
          <p className="mt-1 font-display text-3xl font-bold tracking-tight">
            {view.streak}
            <span className="ml-1 text-h3 text-muted">days</span>
          </p>
          <div className="mt-3 h-2 w-full overflow-hidden rounded-full bg-surface-2">
            <div
              className="h-full rounded-full bg-accent transition-all"
              style={{ width: `${Math.min(100, (view.streak / nextMilestone) * 100)}%` }}
            />
          </div>
          <p className="mt-1.5 text-xs text-muted">
            {view.submittedToday ? "Logged today - chain alive." : `Log today to reach ${nextMilestone} days.`}
          </p>
        </div>

        {/* OKR average completion ring */}
        <div className="rise-in card-hover flex items-center gap-4 rounded-card border border-line bg-surface p-5 shadow-card">
          <Donut pct={avgOkr} color={SIGNAL_META[signalForPercent(avgOkr)].color} label={`${avgOkr}%`} />
          <div>
            <p className="flex items-center gap-1.5 text-label text-muted">
              <Target size={15} /> OKR completion
            </p>
            <p className="mt-1 font-display text-2xl font-bold tracking-tight">{onTrack}/{view.okrs.length}</p>
            <p className="text-xs text-muted">objectives on track</p>
          </div>
        </div>

        {/* Logs recorded */}
        <div className="rise-in card-hover rounded-card border border-line bg-surface p-5 shadow-card">
          <p className="flex items-center gap-1.5 text-label text-muted">
            <ClipboardList size={15} /> Logs recorded
          </p>
          <p className="mt-1 font-display text-3xl font-bold tracking-tight">{view.myLogs.length}</p>
          <p className="mt-2 text-xs text-muted">
            {view.submittedToday ? "Today is in ✓" : "Today is still pending"}
          </p>
        </div>
      </div>

      {/* This week's quests — auto-tracked from the logs below */}
      {quests.length > 0 && (
        <section>
          <div className="mb-3 flex items-baseline justify-between">
            <h3 className="font-display text-h2 font-semibold">This week&apos;s quests</h3>
            <span className="text-xs text-muted">
              {quests.filter((q) => q.done).length}/{quests.length} complete · auto-tracked from your logs
            </span>
          </div>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            {quests.map((q) => (
              <QuestCard key={q.key} quest={q} />
            ))}
          </div>
        </section>
      )}

      {/* My OKRs as progress bars */}
      {view.okrs.length > 0 && (
        <section className="rounded-card border border-line bg-surface p-5 shadow-card">
          <h3 className="font-display text-h2 font-semibold">My OKRs this month</h3>
          <div className="mt-4 space-y-5">
            {view.okrs.map((o) => {
              const meta = SIGNAL_META[signalForPercent(o.completionPct)];
              return (
                <form
                  key={o.id}
                  action={async (form) => {
                    setOkrError(null);
                    const res = await updateOwnOkrProgress(o.id, form);
                    if (!res.ok) return setOkrError(res.error);
                    toast("OKR progress updated");
                  }}
                  className="border-b border-line pb-5 last:border-b-0 last:pb-0"
                >
                  <div className="flex flex-wrap items-baseline justify-between gap-2">
                    <p className="text-sm font-semibold">{o.title}</p>
                    <span className="text-sm font-bold tnum" style={{ color: meta.color }}>
                      {formatPct(o.completionPct)}
                    </span>
                  </div>
                  <p className="text-xs text-muted">Target: {o.targetValue}</p>
                  <div className="mt-2 h-2.5 w-full overflow-hidden rounded-full bg-surface-2">
                    <div
                      className="h-full rounded-full transition-all"
                      style={{ width: `${Math.max(2, Math.min(100, o.completionPct))}%`, background: meta.color }}
                    />
                  </div>
                  <div className="mt-3 flex flex-wrap items-end gap-3">
                    <div className="w-40">
                      <Field label="Update progress">
                        <TextInput name="currentProgress" defaultValue={o.currentProgress ?? ""} placeholder="e.g. 62%" />
                      </Field>
                    </div>
                    <SubmitButton>Save</SubmitButton>
                  </div>
                </form>
              );
            })}
            <FormError message={okrError} />
          </div>
        </section>
      )}

      {/* Today's log */}
      {view.submittedToday ? (
        <div className="rounded-card border border-line bg-ok-soft p-5 text-sm shadow-card">
          <p className="font-semibold text-ok">Today's log is in. ✓</p>
          <p className="mt-1 text-muted">
            One log per day - if something needs changing, ask Admin to add a correction note.
          </p>
        </div>
      ) : (
        <form action={submit} className="rounded-card border border-line bg-surface p-5 shadow-card">
          <h3 className="font-display text-h2 font-semibold">Daily log - {formatDate(view.today)}</h3>
          <p className="mb-4 mt-1 text-xs text-muted">
            Date is fixed to today. Submit once per day, before 7:00 PM.
          </p>
          <input type="hidden" name="variant" value={view.variant ?? ""} />
          {autoCount > 0 && (
            <div className="mb-4 flex items-start gap-2 rounded-field bg-accent-soft px-3 py-2 text-xs text-accent">
              <Sparkles size={14} className="mt-0.5 flex-none" />
              <span>
                {autoCount} of these are <strong>auto-filled from today's activity</strong> - check them,
                fix anything the system couldn't see, add your notes, and submit.
              </span>
            </div>
          )}
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {fields.map(([name, label]) => {
              const auto = view.autoCaptured[name];
              const isAuto = auto !== undefined;
              return (
                <Field
                  key={name}
                  label={isAuto ? `${label}  ·  Auto` : label}
                  hint={isAuto ? "Auto-filled from your activity today - edit if needed" : "Manual entry"}
                >
                  <TextInput name={name} inputMode="numeric" placeholder="0" defaultValue={isAuto ? String(auto) : ""} />
                </Field>
              );
            })}
            <div className="sm:col-span-2 lg:col-span-3">
              <Field label="Notes / blockers" hint="What stopped you from doing more today?">
                <TextArea name="notes" />
              </Field>
            </div>
          </div>
          <div className="mt-4 flex items-center gap-3">
            <SubmitButton>Submit today's log</SubmitButton>
            <FormError message={error} />
          </div>
        </form>
      )}

      {/* My recent logs */}
      <section>
        <h3 className="mb-3 font-display text-h2 font-semibold">My recent logs</h3>
        <DataTable rows={view.myLogs} columns={columns} emptyMessage="No logs yet - submit your first above." />
      </section>
    </div>
  );
}
