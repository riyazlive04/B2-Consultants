"use client";

import { useState } from "react";
import { setMonthlyTarget, setPipelineAvgFee } from "@/server/pipeline-actions";
import { SIGNAL_META, signalForPercent } from "@/lib/signals";
import { formatInrMinor, formatPct } from "@/lib/format";
import { toast } from "@/components/ui/feedback";
import { Card, Pill } from "@/components/ui/kit";
import { FormError, SubmitButton, TextInput } from "@/components/ui/form";

/**
 * Monthly revenue target bar. Bar colour follows the PRD1 §5.4 banding on % of
 * target: red <50%, amber 50-80%, green >80%. `expectedPct` (the % of target the
 * calendar says should be in by now) is still shown as a tick + an informational
 * "on pace" pill, but no longer overrides the fixed colour banding.
 */
export function TargetBar({
  month,
  targetInrMinor,
  revenueInrMinor,
  pct,
  expectedPct,
  isAdmin,
  avgFeeInrMajor,
  avgFeeFromIncome,
}: {
  month: string; // YYYY-MM
  targetInrMinor: number;
  revenueInrMinor: number;
  pct: number;
  expectedPct?: number; // % of target expected by today (day-of-month ÷ days-in-month)
  isAdmin: boolean;
  avgFeeInrMajor?: number; // effective avg program fee used to value open pipeline (₹)
  avgFeeFromIncome?: boolean; // true = learned from income; false = founder fallback / unset
}) {
  const [editing, setEditing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [feeError, setFeeError] = useState<string | null>(null);
  const pacePct = expectedPct && expectedPct > 0 ? (pct / expectedPct) * 100 : null;
  // PRD1 §5.4: the bar colour is fixed banding on % of target — Red <50, Amber
  // 50-80, Green >80. Month-pace is surfaced separately as the informational pill.
  const level = signalForPercent(pct);
  const meta = SIGNAL_META[level];

  const submit = async (form: FormData) => {
    setError(null);
    const res = await setMonthlyTarget(form);
    if (!res.ok) return setError(res.error);
    toast("Monthly target updated");
    setEditing(false);
  };

  const submitFee = async (form: FormData) => {
    setFeeError(null);
    const res = await setPipelineAvgFee(form);
    if (!res.ok) return setFeeError(res.error);
    toast("Average program fee updated");
  };

  return (
    <Card
      title="Monthly revenue target"
      actions={
        <p className="tnum flex items-center gap-2 text-sm">
          {pacePct !== null && (
            <Pill tone={level === "ok" ? "good" : level === "watch" ? "warn" : "bad"}>
              {pacePct >= 100 ? "on pace" : `${Math.round(pacePct)}% of pace`}
            </Pill>
          )}
          <span>
            <span className="font-display text-h2 font-semibold">{formatInrMinor(revenueInrMinor, { compact: true })}</span>
            <span className="text-muted"> of {formatInrMinor(targetInrMinor, { compact: true })} · {formatPct(pct)}</span>
          </span>
        </p>
      }
    >
      <div className="relative">
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
      <div className="mt-1 flex justify-between text-caption text-muted" aria-hidden>
        <span>0</span><span className={pct >= 50 ? "font-semibold text-watch" : ""}>50%</span>
        <span className={pct >= 80 ? "font-semibold text-ok" : ""}>80%</span>
        <span className={pct >= 100 ? "font-semibold text-ok" : ""}>100%</span>
      </div>
      {expectedPct !== undefined && expectedPct > 0 && (
        <p className="tnum mt-1.5 text-caption text-muted">
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

          {/* PRD1 §5.4: fallback average program fee for valuing the open pipeline —
              only relevant until real income defines the fee per level. */}
          {editing && (
            <form action={submitFee} className="mt-2 flex flex-wrap items-center gap-2">
              <span className="text-caption text-muted">Fallback avg fee (₹)</span>
              <div className="w-40">
                <TextInput
                  name="avgFeeInr"
                  inputMode="numeric"
                  placeholder="e.g. 75000"
                  defaultValue={avgFeeFromIncome ? "" : (avgFeeInrMajor ? String(avgFeeInrMajor) : "")}
                  aria-label="Fallback average program fee (₹)"
                />
              </div>
              <SubmitButton>Save fee</SubmitButton>
              {avgFeeFromIncome && (
                <span className="text-caption text-muted">Currently learned from income; used only if that history is cleared.</span>
              )}
              <FormError message={feeError} />
            </form>
          )}
        </div>
      )}
    </Card>
  );
}
