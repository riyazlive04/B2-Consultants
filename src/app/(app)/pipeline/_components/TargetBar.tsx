"use client";

import { useState } from "react";
import { setMonthlyTarget } from "@/server/pipeline-actions";
import { SIGNAL_META, signalForPercent } from "@/lib/signals";
import { formatInrMinor, formatPct } from "@/lib/format";
import { toast } from "@/components/ui/feedback";
import { FormError, SubmitButton, TextInput } from "@/components/ui/form";

/**
 * Monthly revenue target bar (PRD1 §5.4 banding: red <50%, amber 50-80%, green >80%)
 * — but judged against TODAY, not month-end. Mid-month the honest question is
 * "am I on pace?", so when `expectedPct` (the % of target the calendar says should
 * be in by now) is passed, the colour follows pace and a tick marks the expected spot.
 */
export function TargetBar({
  month,
  targetInrMinor,
  revenueInrMinor,
  pct,
  expectedPct,
  isAdmin,
}: {
  month: string; // YYYY-MM
  targetInrMinor: number;
  revenueInrMinor: number;
  pct: number;
  expectedPct?: number; // % of target expected by today (day-of-month ÷ days-in-month)
  isAdmin: boolean;
}) {
  const [editing, setEditing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const pacePct = expectedPct && expectedPct > 0 ? (pct / expectedPct) * 100 : null;
  const level =
    pacePct === null
      ? signalForPercent(pct)
      : pacePct >= 100 ? "ok" : pacePct >= 75 ? "watch" : "risk";
  const meta = SIGNAL_META[level];

  const submit = async (form: FormData) => {
    setError(null);
    const res = await setMonthlyTarget(form);
    if (!res.ok) return setError(res.error);
    toast("Monthly target updated");
    setEditing(false);
  };

  return (
    <div className="rounded-card border border-line bg-surface p-5 shadow-card">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <p className="text-sm font-medium text-muted">Monthly revenue target</p>
        <p className="tnum text-sm">
          {pacePct !== null && (
            <span
              className="mr-2 rounded-full px-2 py-0.5 text-[11px] font-semibold align-middle"
              style={{ background: meta.soft, color: meta.color }}
            >
              {pacePct >= 100 ? "on pace" : `${Math.round(pacePct)}% of pace`}
            </span>
          )}
          <span className="font-display text-lg font-semibold">{formatInrMinor(revenueInrMinor, { compact: true })}</span>
          <span className="text-muted"> of {formatInrMinor(targetInrMinor, { compact: true })} · {formatPct(pct)}</span>
        </p>
      </div>
      <div className="relative mt-3">
        <div className="h-3 overflow-hidden rounded-full" style={{ background: meta.soft }}>
          <div
            className="h-full rounded-full transition-all"
            style={{ width: `${Math.min(pct, 100)}%`, background: meta.color }}
          />
        </div>
        {/* milestone ticks - the game board: red zone ends at 50, green begins at 80 */}
        {[50, 80].map((m) => (
          <span
            key={m}
            className="absolute top-1/2 h-4 w-px -translate-y-1/2 bg-ink/25"
            style={{ left: `${m}%` }}
            title={`${m}% milestone`}
            aria-hidden
          />
        ))}
        {/* where the calendar says the bar should reach today */}
        {expectedPct !== undefined && expectedPct > 0 && expectedPct < 100 && (
          <span
            className="absolute top-1/2 h-5 w-0.5 -translate-y-1/2 rounded-full bg-ink/60"
            style={{ left: `${expectedPct}%` }}
            title={`Expected by today: ${formatPct(expectedPct)}`}
            aria-label={`Expected by today: ${formatPct(expectedPct)}`}
          />
        )}
      </div>
      <div className="mt-1 flex justify-between text-[11px] text-muted" aria-hidden>
        <span>0</span><span className={pct >= 50 ? "font-semibold text-watch" : ""}>50%</span>
        <span className={pct >= 80 ? "font-semibold text-ok" : ""}>80%</span>
        <span className={pct >= 100 ? "font-semibold text-ok" : ""}>100%</span>
      </div>
      {expectedPct !== undefined && expectedPct > 0 && (
        <p className="tnum mt-1.5 text-[11px] text-muted">
          ▎expected by today: {formatPct(expectedPct)} of target ({formatInrMinor((targetInrMinor * expectedPct) / 100, { compact: true })})
        </p>
      )}
      {pct >= 100 && (
        <p className="mt-2 rounded-field px-3 py-2 text-sm font-semibold" style={{ background: "var(--ok-soft)", color: "var(--ok)" }}>
          🎉 Target smashed - {formatPct(pct)} of {formatInrMinor(targetInrMinor, { compact: true })}. New month, new high score?
        </p>
      )}
      {isAdmin && (
        <div className="mt-3">
          {editing ? (
            <form action={submit} className="flex flex-wrap items-center gap-2">
              <input type="hidden" name="month" value={month} />
              <div className="w-40">
                <TextInput name="targetInr" inputMode="decimal" defaultValue={(targetInrMinor / 100).toFixed(0)} aria-label="Target (₹)" />
              </div>
              <SubmitButton>Set target</SubmitButton>
              <button type="button" className="text-sm text-muted hover:underline" onClick={() => setEditing(false)}>
                Cancel
              </button>
              <FormError message={error} />
            </form>
          ) : (
            <button type="button" className="text-sm text-accent hover:underline" onClick={() => setEditing(true)}>
              Change target for this month
            </button>
          )}
        </div>
      )}
    </div>
  );
}
