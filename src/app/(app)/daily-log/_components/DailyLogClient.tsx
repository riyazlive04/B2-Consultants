"use client";

import { useState } from "react";
import { Flame, Target, Sparkles, TrendingUp, CheckCircle2, Lock } from "lucide-react";
import { submitDailyLog, updateOwnOkrProgress } from "@/server/people-actions";
import type { MyDailyLogView } from "@/server/people-metrics";
import { type QuestProgress } from "@/lib/gamification";
import { QuestCard } from "@/components/ui/gamification";
import { ActivityTimeline } from "@/components/ui/activity";
import { celebrate, toast } from "@/components/ui/feedback";
import { Field, FormError, SubmitButton, TextArea, TextInput } from "@/components/ui/form";
import { SIGNAL_META, signalForPercent } from "@/lib/signals";
import { formatPct } from "@/lib/format";
import { DAILY_LOG_FIELDS, LOG_FIELD_UNIT } from "@/lib/labels";

/** Compact donut ring for a single percentage. */
function Donut({ pct, color, label }: { pct: number; color: string; label: string }) {
  const R = 30;
  const C = 2 * Math.PI * R;
  const p = Math.max(0, Math.min(100, pct));
  return (
    <div className="relative grid flex-none place-items-center">
      <svg width={76} height={76} viewBox="0 0 76 76" className="-rotate-90">
        <circle cx="38" cy="38" r={R} fill="none" stroke="var(--surface-2)" strokeWidth="8" />
        <circle
          cx="38" cy="38" r={R} fill="none" stroke={color} strokeWidth="8" strokeLinecap="round"
          strokeDasharray={C} strokeDashoffset={C * (1 - p / 100)}
          style={{ transition: "stroke-dashoffset 500ms ease" }}
        />
      </svg>
      <span className="absolute font-display text-sm font-bold tabular-nums">{label}</span>
    </div>
  );
}

/** One insight tile in the top strip. */
function Tile({ icon, label, children }: { icon: React.ReactNode; label: string; children: React.ReactNode }) {
  return (
    <div className="rise-in rounded-card border border-line bg-surface p-4 shadow-card sm:p-5">
      <p className="flex items-center gap-1.5 text-label font-semibold uppercase text-muted">
        {icon} {label}
      </p>
      {children}
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
  const autoKeys = Object.keys(view.autoCaptured);
  const autoCount = autoKeys.length;

  const avgOkr = view.okrs.length
    ? Math.round(view.okrs.reduce((a, o) => a + o.completionPct, 0) / view.okrs.length)
    : 0;
  const onTrack = view.okrs.filter((o) => signalForPercent(o.completionPct) === "ok").length;

  // This week vs last, on the headline metric — a quick "am I trending up?" read.
  const primaryUnit = view.primaryMetricKey ? LOG_FIELD_UNIT[view.primaryMetricKey] ?? "" : "";
  const sumPrimary = (from: number, to: number) =>
    view.entries
      .filter((e) => e.relDays >= from && e.relDays <= to)
      .reduce((a, e) => a + (e.metrics.find((m) => m.primary)?.value ?? 0), 0);
  const thisWeek = sumPrimary(0, 6);
  const lastWeek = sumPrimary(7, 13);
  const weekDeltaPct = lastWeek > 0 ? Math.round(((thisWeek - lastWeek) / lastWeek) * 100) : null;

  const nextMilestone = [7, 14, 30, 60, 90].find((m) => view.streak < m) ?? 90;

  // ── EOD state ──
  // Amending takes precedence over every other state: an EOD_AUTO row means a day exists but
  // nobody has stood behind it, and the window to fix that is short.
  const amend = view.amendable;
  const amending = !!amend;
  const deadlineLabel = view.eod.enabled ? `the ${view.eod.cutoffLabel} cutoff` : "7:00 PM";
  // Closed = past cutoff, nothing logged, nothing to amend.
  const closed = view.eod.enabled && view.eod.pastCutoff && !view.submittedToday;
  const amendDateLabel = amend
    ? new Date(amend.date).toLocaleDateString("en-GB", {
        weekday: "short",
        day: "numeric",
        month: "short",
        timeZone: "UTC", // the date is a UTC-midnight @db.Date — local tz would shift it a day
      })
    : "";

  const submit = async (form: FormData) => {
    setError(null);
    const res = await submitDailyLog(form);
    if (!res.ok) return setError(res.error);
    // Amending an auto-saved row isn't a new log — it doesn't extend a streak or pay XP again,
    // so a streak toast here would be a lie the Arena would then contradict.
    if (amending) {
      toast("Log confirmed — it's yours now ✓");
      return;
    }
    const newStreak = view.streak + 1;
    toast(
      view.streak > 0
        ? `Log submitted · +${logXp} XP - ${newStreak}-day streak! 🔥`
        : `Log submitted · +${logXp} XP ✓`,
    );
    if (streakMilestones.includes(newStreak)) celebrate();
  };

  return (
    <div className="space-y-6">
      {/* Insight strip */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {/* Today's status */}
        <Tile icon={<CheckCircle2 size={14} />} label="Today's log">
          {view.todayIsAuto ? (
            <>
              <p className="mt-1 font-display text-h1 font-bold tracking-tight text-warn">Auto</p>
              <p className="mt-1 text-caption text-muted">Saved from activity — confirm it below.</p>
            </>
          ) : view.submittedToday ? (
            <>
              <p className="mt-1 font-display text-h1 font-bold tracking-tight text-good">In ✓</p>
              <p className="mt-1 text-caption text-muted">Locked for today — one per day.</p>
            </>
          ) : closed ? (
            <>
              <p className="mt-1 font-display text-h1 font-bold tracking-tight text-bad">Closed</p>
              <p className="mt-1 text-caption text-muted">{view.eod.cutoffLabel} cutoff has passed.</p>
            </>
          ) : (
            <>
              <p className="mt-1 font-display text-h1 font-bold tracking-tight text-watch">Pending</p>
              <p className="mt-1 text-caption text-muted">Submit below, before {deadlineLabel}.</p>
            </>
          )}
        </Tile>

        {/* Streak */}
        <Tile icon={<Flame size={14} />} label="Logging streak">
          <p className="mt-1 font-display text-h1 font-bold tracking-tight">
            {view.streak}
            <span className="ml-1 text-h3 text-muted">days</span>
          </p>
          <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-surface-2">
            <div className="h-full rounded-full bg-primary transition-all" style={{ width: `${Math.min(100, (view.streak / nextMilestone) * 100)}%` }} />
          </div>
          <p className="mt-1.5 text-caption text-muted">
            {view.submittedToday ? "Chain alive today." : `Log today to reach ${nextMilestone} days.`}
          </p>
        </Tile>

        {/* This week vs last */}
        <Tile icon={<TrendingUp size={14} />} label="This week vs last">
          <p className="mt-1 font-display text-h1 font-bold tracking-tight tnum">
            {thisWeek}
            {primaryUnit && <span className="ml-1 text-h3 text-muted">{primaryUnit}</span>}
          </p>
          <p className="mt-1 text-caption text-muted">
            {weekDeltaPct === null ? (
              "Building your baseline"
            ) : weekDeltaPct >= 0 ? (
              <span className="font-semibold text-good">▲ {weekDeltaPct}% </span>
            ) : (
              <span className="font-semibold text-bad">▼ {Math.abs(weekDeltaPct)}% </span>
            )}
            {weekDeltaPct !== null && "vs last week"}
          </p>
        </Tile>

        {/* OKRs */}
        <div className="rise-in flex items-center gap-4 rounded-card border border-line bg-surface p-4 shadow-card sm:p-5">
          <Donut pct={avgOkr} color={SIGNAL_META[signalForPercent(avgOkr)].color} label={`${avgOkr}%`} />
          <div className="min-w-0">
            <p className="flex items-center gap-1.5 text-label font-semibold uppercase text-muted">
              <Target size={14} /> OKRs on track
            </p>
            <p className="mt-1 font-display text-h1 font-bold tracking-tight tnum">
              {onTrack}<span className="text-muted">/{view.okrs.length}</span>
            </p>
            <p className="text-caption text-muted">objectives healthy</p>
          </div>
        </div>
      </div>

      {/* This week's quests — auto-tracked from the logs below */}
      {quests.length > 0 && (
        <section>
          <div className="mb-3 flex items-baseline justify-between">
            <h3 className="font-display text-h2 font-semibold">This week&apos;s quests</h3>
            <span className="text-caption text-muted">
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
      {amending ? (
        /* An EOD_AUTO row: the job's account of a day nobody logged. Amendable precisely
           because auto-capture is partial — the fields it can't see are blank below, and
           they're the ones the pay board counts. */
        <form action={submit} className="rounded-card border border-warn bg-surface p-5 shadow-card">
          <h3 className="font-display text-h2 font-semibold">
            {amend.isToday ? "Amend today's auto-saved log" : `Amend your auto-saved log — ${amendDateLabel}`}
          </h3>
          <p className="mb-4 mt-1 text-xs text-muted">
            Nobody logged {amend.isToday ? "today" : "that day"}, so the {view.eod.cutoffLabel} job saved what your
            activity showed. It couldn&apos;t see everything — fill in the rest and it becomes your log.
          </p>
          <input type="hidden" name="variant" value={view.variant ?? ""} />
          <input type="hidden" name="logId" value={amend.id} />
          <input type="hidden" name="autoCapturedKeys" value={JSON.stringify(Object.keys(amend.values))} />
          <div className="mb-4 flex items-start gap-2 rounded-field bg-warn-soft px-3 py-2 text-xs text-warn">
            <Sparkles size={14} className="mt-0.5 flex-none" />
            <span>
              These numbers were <strong>derived from your activity</strong>, not typed by you. Anything the
              system has no record of is blank — check every field, then submit to make it yours.
            </span>
          </div>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {fields.map(([name, label]) => {
              const captured = amend.values[name];
              const isAuto = captured !== undefined;
              return (
                <Field
                  key={name}
                  label={isAuto ? `${label}  ·  Auto` : label}
                  hint={isAuto ? "Derived from your activity - correct it if it's wrong" : "Never captured - enter it"}
                >
                  <TextInput
                    name={name}
                    inputMode="numeric"
                    placeholder="0"
                    defaultValue={isAuto ? String(captured) : ""}
                  />
                </Field>
              );
            })}
            <div className="sm:col-span-2 lg:col-span-3">
              <Field label="Notes / blockers" hint="Anything that held the day back?">
                <TextArea name="notes" />
              </Field>
            </div>
          </div>
          <div className="mt-4 flex items-center gap-3">
            <SubmitButton>Confirm as my log</SubmitButton>
            <FormError message={error} />
          </div>
        </form>
      ) : view.submittedToday ? (
        <div className="flex items-start gap-3 rounded-card border border-line bg-ok-soft p-5 text-sm shadow-card">
          <CheckCircle2 size={18} className="mt-0.5 flex-none text-ok" />
          <div>
            <p className="font-semibold text-ok">Today&apos;s log is in.</p>
            <p className="mt-1 text-muted">
              One log per day — if something needs changing, ask Admin to add a correction note.
            </p>
          </div>
        </div>
      ) : closed ? (
        /* Past the cutoff with no log and no auto-save to fall back on. Saying "submit below"
           here would be a lie — the action will refuse it. */
        <div className="flex items-start gap-3 rounded-card border border-line bg-bad-soft p-5 text-sm shadow-card">
          <Lock size={18} className="mt-0.5 flex-none text-bad" />
          <div>
            <p className="font-semibold text-bad">Today&apos;s log is closed.</p>
            <p className="mt-1 text-muted">
              The {view.eod.cutoffLabel} cutoff has passed.{" "}
              {view.eod.autoSave
                ? "Your numbers will be auto-saved from your activity shortly — come back to check and amend them."
                : "Ask Admin if today still needs to be recorded."}
            </p>
          </div>
        </div>
      ) : (
        <form action={submit} className="rounded-card border border-line bg-surface p-5 shadow-card">
          <h3 className="font-display text-h2 font-semibold">Log today</h3>
          <p className="mb-4 mt-1 text-xs text-muted">
            Date is fixed to today. Submit once per day, before {deadlineLabel}.
          </p>
          <input type="hidden" name="variant" value={view.variant ?? ""} />
          <input type="hidden" name="autoCapturedKeys" value={JSON.stringify(autoKeys)} />
          {autoCount > 0 && (
            <div className="mb-4 flex items-start gap-2 rounded-field bg-accent-soft px-3 py-2 text-xs text-accent">
              <Sparkles size={14} className="mt-0.5 flex-none" />
              <span>
                {autoCount} of these are <strong>auto-filled from today&apos;s activity</strong> - check them,
                fix anything the system couldn&apos;t see, add your notes, and submit.
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
            <SubmitButton>Submit today&apos;s log</SubmitButton>
            <FormError message={error} />
          </div>
        </form>
      )}

      {/* My log history — the activity timeline */}
      <section>
        <div className="mb-3 flex items-baseline justify-between gap-3">
          <h3 className="font-display text-h2 font-semibold">My log history</h3>
          <span className="text-caption text-muted tnum">
            {view.logCount} {view.logCount === 1 ? "entry" : "entries"}
          </span>
        </div>
        <ActivityTimeline
          entries={view.entries}
          mode="personal"
          emptyTitle="No logs yet"
          emptyBody="Submit your first above — your calls, proposals and follow-ups become a track record here."
        />
      </section>
    </div>
  );
}
