"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import {
  DEFAULT_DAILY_LOG_EOD,
  formatIstMinutes,
  istMinutesToTimeInput,
  timeInputToIstMinutes,
  type DailyLogEodConfig,
} from "@/lib/config-schema";
import { Field } from "@/components/ui/form";
import { toast } from "@/components/ui/feedback";
import { saveDailyLogEod } from "@/server/console-actions";
import { Card, Hint, NumInput, SaveBar, TimeIn, Toggle } from "./kit";

/**
 * End-of-day rules editor (Founder Console → Daily Targets → EOD).
 *
 * The honest framing, kept in the copy below: the day ALREADY hard-locked at IST midnight
 * before this existed — a log is stamped with today's date, so a missed day could never be
 * filled in late. What these rules add is an explicit deadline and, crucially, something that
 * makes the rule actually happen instead of silently not happening.
 */
export function DailyLogEodPanel({ config, cronArmed }: { config: DailyLogEodConfig; cronArmed: boolean }) {
  const router = useRouter();
  const [draft, setDraft] = useState<DailyLogEodConfig>(config);
  const [saved, setSaved] = useState<DailyLogEodConfig>(config);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const dirty = JSON.stringify(draft) !== JSON.stringify(saved);
  const patch = (p: Partial<DailyLogEodConfig>) => setDraft((d) => ({ ...d, ...p }));

  async function save() {
    setBusy(true);
    setError(null);
    const res = await saveDailyLogEod(draft);
    setBusy(false);
    if (!res.ok) return setError(res.error);
    setSaved(draft);
    toast("EOD rules saved");
    router.refresh();
  }

  const nudgeAfterCutoff = draft.nudgeMinutes >= draft.cutoffMinutes;

  return (
    <div className="space-y-5">
      <Hint>
        &ldquo;Every log is saved by the end of the day.&rdquo; A log is always stamped with{" "}
        <strong>today&apos;s</strong> date, so the day already locks itself at IST midnight — nobody can
        fill in a day they missed. These rules make the deadline <strong>explicit</strong>, and make
        someone actually notice: a reminder before the cutoff, a hard close at it, and a row saved from
        real activity for anyone who still didn&apos;t log.
      </Hint>

      <Card>
        <div className="mb-4">
          <Toggle
            checked={draft.enabled}
            onChange={(b) => patch({ enabled: b })}
            label="Enforce end-of-day rules"
            title="Off = the app behaves exactly as it did before this engine existed."
          />
          <p className="mt-1.5 text-caption text-muted">
            While this is off, nothing below applies: no cutoff, no auto-save, no reminder.
          </p>
        </div>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <Field label="Remind at" hint="When an unlogged member starts getting nudged.">
            <TimeIn
              ariaLabel="Reminder time"
              value={istMinutesToTimeInput(draft.nudgeMinutes)}
              onChange={(s) => {
                const m = timeInputToIstMinutes(s);
                if (m !== null) patch({ nudgeMinutes: m });
              }}
            />
          </Field>

          <Field label="Cutoff" hint="The deadline. After it, no new log for today.">
            <TimeIn
              ariaLabel="Cutoff time"
              value={istMinutesToTimeInput(draft.cutoffMinutes)}
              onChange={(s) => {
                const m = timeInputToIstMinutes(s);
                if (m !== null) patch({ cutoffMinutes: m });
              }}
            />
          </Field>

          <Field
            label="Amend window (days)"
            hint="How long an auto-saved log stays editable by its owner. 0 = final."
          >
            <NumInput
              ariaLabel="Amend window in days"
              value={draft.amendWindowDays}
              onChange={(n) => patch({ amendWindowDays: n })}
              min={0}
              max={7}
            />
          </Field>

          <div className="flex flex-col justify-center gap-3">
            <Toggle
              checked={draft.autoSave}
              onChange={(b) => patch({ autoSave: b })}
              label="Auto-save at cutoff"
              disabled={!draft.enabled}
            />
            <Toggle
              checked={draft.founderSummary}
              onChange={(b) => patch({ founderSummary: b })}
              label="EOD summary to me"
              disabled={!draft.enabled}
            />
          </div>
        </div>

        {nudgeAfterCutoff && (
          <p className="mt-4 rounded-field bg-bad-soft px-3 py-2 text-xs font-medium text-bad">
            The reminder must be before the cutoff — a nudge at {formatIstMinutes(draft.nudgeMinutes)} could
            never fire when the day closes at {formatIstMinutes(draft.cutoffMinutes)}.
          </p>
        )}

        {/* Auto-save is the one rule that cannot enforce itself: the app has no clock. Saying
            "on" while nothing ticks would be the most misleading thing this panel could do. */}
        {draft.enabled && draft.autoSave && !cronArmed && (
          <p className="mt-4 rounded-field bg-warn-soft px-3 py-2 text-xs font-medium text-warn">
            Auto-save needs a scheduler and <code>CRON_SECRET</code> isn&apos;t set, so{" "}
            <code>/api/cron/daily-log</code> returns 503 and nothing will ever fire. The cutoff and the
            reminder still work — they read the real clock.
          </p>
        )}

        {draft.enabled && draft.autoSave && draft.amendWindowDays === 0 && (
          <p className="mt-4 rounded-field bg-warn-soft px-3 py-2 text-xs font-medium text-warn">
            With a 0-day amend window, auto-saved logs are final. Auto-capture can&apos;t see every field
            (follow-up messages have no source), so those days will read <strong>low</strong> on the
            Telecaller Pay board and nobody can correct them.
          </p>
        )}

        <SaveBar
          dirty={dirty && !nudgeAfterCutoff}
          onSave={save}
          onReset={() => setDraft(DEFAULT_DAILY_LOG_EOD)}
          busy={busy}
          error={error}
        />
      </Card>
    </div>
  );
}
