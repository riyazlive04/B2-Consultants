"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import {
  DEFAULT_LEADERBOARD_CONFIG,
  LEADERBOARD_METRICS,
  type LeaderboardConfig,
  type LeaderboardMetricKey,
} from "@/lib/leaderboard";
import { saveLeaderboardConfig } from "@/server/maintenance-actions";
import { Field } from "@/components/ui/form";
import { toast } from "@/components/ui/feedback";
import { Card, Hint, NumInput, Picker, SaveBar, Toggle } from "./kit";
import { safeAction } from "@/lib/action-guard";

/**
 * Founder Console → Leaderboard.
 *
 * ── What is editable, and what deliberately is not ─────────────────────────────────────
 * The admin owns the ARITHMETIC: which metrics count, what each is worth, the weekly ceiling
 * on the self-reported ones, the period, the scope, and who may see the board. They cannot
 * invent a metric, because a metric exists only if something computes it - that is a code fact
 * and the catalogue in lib/leaderboard.ts is where it lives. Same two-layer split as Sections.
 *
 * ── Why the weekly cap only appears on some rows ───────────────────────────────────────
 * A cap is only meaningful where the QUANTITY is typed in by the person being ranked. You
 * cannot attend a class twice, so capping attendance could only ever lose somebody real points.
 * The self-reported four can each carry a number up to 500 in one entry, and the cap is the
 * only thing between that box and the top of a board that names people.
 */
export function LeaderboardPanel({ config }: { config: LeaderboardConfig }) {
  const router = useRouter();
  const [draft, setDraft] = useState<LeaderboardConfig>(config);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const dirty = JSON.stringify(draft) !== JSON.stringify(config);
  const patch = (p: Partial<LeaderboardConfig>) => setDraft((d) => ({ ...d, ...p }));
  const patchMetric = (key: LeaderboardMetricKey, p: Partial<LeaderboardConfig["metrics"][LeaderboardMetricKey]>) =>
    setDraft((d) => ({ ...d, metrics: { ...d.metrics, [key]: { ...d.metrics[key], ...p } } }));

  const commit = async () => {
    setBusy(true);
    setError(null);
    const res = await safeAction(() => saveLeaderboardConfig(draft));
    setBusy(false);
    if (!res.ok) return setError(res.error);
    toast("Leaderboard saved");
    router.refresh();
  };

  return (
    <Card>
      <h4 className="text-h3 text-ink">Sprint leaderboard</h4>
      <Hint>
        Four taught weeks, then a 90-day (Guided) or 120-day (Elite) sprint. The board spans
        both - a student who attended everything and applied to nothing, and one who attended
        nothing and applied to forty roles, are both in trouble, and only a number including
        both can say so.
        <br />
        Everything below is yours. The list of metrics is not: a metric exists only where
        something computes it.
      </Hint>

      <div className="mt-4 space-y-3">
        <Toggle
          checked={draft.enabled}
          onChange={(v) => patch({ enabled: v })}
          label="Show the leaderboard"
          title="Off hides the section for students and staff alike"
        />
      </div>

      <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Field
          label="Students see"
          hint="Named is a real leaderboard. Anonymised shows each student their own name and everyone else as a letter."
        >
          <Picker
            value={draft.visibility}
            onChange={(v) => patch({ visibility: v as LeaderboardConfig["visibility"] })}
            options={[
              { value: "NAMED", label: "Named - the full ranking" },
              { value: "ANONYMISED", label: "Anonymised - own name only" },
              { value: "STAFF_ONLY", label: "Staff only - students see just themselves" },
            ]}
            ariaLabel="Who students see on the board"
          />
        </Field>
        <Field
          label="Count from"
          hint="Sprint is the 90/120 days after the taught weeks. A cohort whose sprint has not started yet is counted from enrolment instead, and the page says so."
        >
          <Picker
            value={draft.period}
            onChange={(v) => patch({ period: v as LeaderboardConfig["period"] })}
            options={[
              { value: "SPRINT", label: "Sprint start" },
              { value: "PROGRAMME", label: "Enrolment - the whole programme" },
            ]}
            ariaLabel="Which period the board counts"
          />
        </Field>
        <Field
          label="Rank within"
          hint="A student in sprint week 12 and one in their first taught week are not comparable, which is why this defaults to the cohort."
        >
          <Picker
            value={draft.scope}
            onChange={(v) => patch({ scope: v as LeaderboardConfig["scope"] })}
            options={[
              { value: "BATCH", label: "Their own cohort" },
              { value: "ALL", label: "Every active student" },
            ]}
            ariaLabel="How wide the ranking is"
          />
        </Field>
        <Field label="Show top N" hint="0 shows the whole cohort. A student's own row is always shown, even below the cut.">
          <NumInput
            ariaLabel="How many rows a student sees"
            value={draft.topN}
            onChange={(n) => patch({ topN: n })}
            min={0}
            max={500}
          />
        </Field>
      </div>

      <div className="mt-6 border-t border-line pt-5">
        <h5 className="text-sm font-semibold text-ink">What counts, and for how much</h5>
        <Hint>
          Set a metric to 0 points to keep it visible but unscored, or switch it off to drop it
          from the breakdown entirely.
        </Hint>

        <div className="mt-3 space-y-2">
          {LEADERBOARD_METRICS.map((m) => {
            const rule = draft.metrics[m.key];
            return (
              <div
                key={m.key}
                className="grid grid-cols-1 items-start gap-3 rounded-field border border-line bg-surface px-3.5 py-3 sm:grid-cols-[1fr_auto_auto_auto]"
              >
                <div className="min-w-0">
                  <p className="text-sm font-medium text-ink">
                    {m.label}
                    <span
                      className="ml-2 rounded-full border border-line px-1.5 py-0.5 text-caption font-normal text-ink-2"
                      title={
                        m.source === "derived"
                          ? "Computed from a record elsewhere - nobody can type it in"
                          : "Self-reported by the student; scores at once, the coach can correct it"
                      }
                    >
                      {m.source === "derived" ? "measured" : "self-reported"}
                    </span>
                  </p>
                  <p className="text-xs text-muted">{m.from}</p>
                </div>

                <Toggle
                  checked={rule.enabled}
                  onChange={(v) => patchMetric(m.key, { enabled: v })}
                  label={`Count ${m.label}`}
                  hideLabel
                />

                <label className="block">
                  <span className="text-xs font-medium text-muted">Points each</span>
                  <NumInput
                    ariaLabel={`Points per ${m.label}`}
                    value={rule.points}
                    onChange={(n) => patchMetric(m.key, { points: n })}
                    min={0}
                    max={10_000}
                  />
                </label>

                {/* Only the self-reported metrics get a cap - see the note at the top. */}
                {m.source === "logged" ? (
                  <label className="block">
                    <span className="text-xs font-medium text-muted">Max per week</span>
                    <NumInput
                      ariaLabel={`Weekly cap for ${m.label}`}
                      value={rule.weeklyCap ?? 0}
                      onChange={(n) => patchMetric(m.key, { weeklyCap: n > 0 ? n : null })}
                      min={0}
                      max={1000}
                    />
                  </label>
                ) : (
                  <span className="hidden sm:block sm:w-24" aria-hidden />
                )}
              </div>
            );
          })}
        </div>
      </div>

      <SaveBar
        dirty={dirty}
        onSave={commit}
        onReset={() => setDraft(DEFAULT_LEADERBOARD_CONFIG)}
        busy={busy}
        error={error}
      />
    </Card>
  );
}
