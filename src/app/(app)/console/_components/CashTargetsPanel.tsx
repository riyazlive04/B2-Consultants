"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { DEFAULT_CASH_TARGETS_CONFIG, type CashTargetsConfig } from "@/lib/config-schema";
import { Field } from "@/components/ui/form";
import { toast } from "@/components/ui/feedback";
import { saveCashTargetsConfig } from "@/server/console-actions";
import { formatInrMinor } from "@/lib/format";
import { SIGNAL_META, signalForRunway } from "@/lib/signals";
import { safeAction } from "@/lib/action-guard";
import { Card, Hint, NumInput, SaveBar } from "./kit";

/**
 * Cash Health's targets (Founder Console → Money → Cash targets).
 *
 * ── Why this panel exists ─────────────────────────────────────────────────────────
 * Every number on this screen used to be a literal in the source. "Months to ₹8L / month" came
 * from `TARGET_INR = 80_000_000` in `server/cash-metrics.ts`, so reaching ₹8L made the card read
 * "Reached" forever and raising the bar meant a deploy. The runway verdict's ≥6 / 3-6 / <3 bands
 * were in `lib/signals.ts`; burn averaged three months because a `-3` was written into a query;
 * and a bill due this week was flagged red at "less than twice it in the bank".
 *
 * None of those is an engineering constant - they are this business's definition of healthy.
 *
 * ── The preview is the point ──────────────────────────────────────────────────────
 * Thresholds are abstract until you see which verdict a given runway gets, and the one mistake
 * this panel must not allow is bands that disagree with the caption describing them (which is
 * exactly what the old hardcoded "Green ≥ 6 mo" caption became the moment anyone wanted 9). So
 * the ladder below is computed with the SAME `signalForRunway` the pages call, on the draft
 * values, before anything is saved.
 */

/** The runways the preview grades - enough spread to show both edges of either band. */
const PREVIEW_MONTHS = [0.5, 1, 2, 3, 4.5, 6, 9, 12];

export function CashTargetsPanel({ config }: { config: CashTargetsConfig }) {
  const router = useRouter();
  const [draft, setDraft] = useState<CashTargetsConfig>(config);
  const [saved, setSaved] = useState<CashTargetsConfig>(config);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const dirty = JSON.stringify(draft) !== JSON.stringify(saved);
  const patch = (next: Partial<CashTargetsConfig>) => setDraft((d) => ({ ...d, ...next }));

  /**
   * The one rule the schema refuses, said BEFORE the save rather than as a server error: green
   * below amber would make the same runway two colours depending on which test ran first.
   */
  const bandsInverted = draft.runwayGreenMonths < draft.runwayAmberMonths;

  async function save() {
    // Refused here as well as by the schema, so the founder is told by the field they typed in
    // rather than by a server error after the round trip.
    if (bandsInverted) {
      return setError("The green threshold must be at or above the amber one");
    }
    setBusy(true);
    setError(null);
    const res = await safeAction(() => saveCashTargetsConfig(draft));
    setBusy(false);
    if (!res.ok) return setError(res.error);
    setSaved(draft);
    toast("Cash targets saved");
    router.refresh();
  }

  return (
    <div className="space-y-4">
      <Card
        title="Revenue target"
        subtitle="The monthly revenue Cash Health counts towards - it drives the “Months to … / month” card."
      >
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Field
            label="Monthly revenue target (₹)"
            hint={`Currently ${formatInrMinor(BigInt(draft.monthlyRevenueTargetInrMinor))} a month. 0 hides the card's verdict rather than claiming it is reached.`}
          >
            {/* Typed in RUPEES and stored in paise. Every money column in the app is minor
                units, but asking the founder for 80000000 is asking to be mistyped by a
                factor of ten - which on this field would silently retire the target. */}
            <NumInput
              value={Math.round(draft.monthlyRevenueTargetInrMinor / 100)}
              onChange={(n) => patch({ monthlyRevenueTargetInrMinor: Math.max(0, Math.round(n)) * 100 })}
              min={0}
              ariaLabel="Monthly revenue target in rupees"
            />
          </Field>
        </div>
      </Card>

      <Card
        title="Runway verdict"
        subtitle="When the runway pill, the gauge and the home KPI call the business safe, watchful or at risk."
      >
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          <Field label="Green at or above (months)">
            <NumInput
              value={draft.runwayGreenMonths}
              onChange={(n) => patch({ runwayGreenMonths: Math.max(0, n) })}
              min={0}
              max={60}
              ariaLabel="Green runway threshold in months"
            />
          </Field>
          <Field label="Amber at or above (months)" hint="Below this is red.">
            <NumInput
              value={draft.runwayAmberMonths}
              onChange={(n) => patch({ runwayAmberMonths: Math.max(0, n) })}
              min={0}
              max={60}
              ariaLabel="Amber runway threshold in months"
            />
          </Field>
          <Field
            label="Gauge horizon (months)"
            hint="What a full dial means. Scale only - it changes no verdict."
          >
            <NumInput
              value={draft.runwayHorizonMonths}
              onChange={(n) => patch({ runwayHorizonMonths: Math.max(1, n) })}
              min={1}
              max={60}
              ariaLabel="Runway gauge horizon in months"
            />
          </Field>
        </div>

        {bandsInverted && (
          <p className="mt-3 rounded-field bg-risk-soft px-3 py-2 text-caption text-risk">
            Green ({draft.runwayGreenMonths} mo) is below amber ({draft.runwayAmberMonths} mo) - the
            two bands would overlap. Raise green, or lower amber.
          </p>
        )}

        {/* Graded by the real function, so what this ladder says is what every screen will say. */}
        <div className="mt-4">
          <p className="text-label uppercase text-ink-3">How a runway would read</p>
          <div className="mt-2 flex flex-wrap gap-2">
            {PREVIEW_MONTHS.map((m) => {
              const meta =
                SIGNAL_META[
                  signalForRunway(m, { green: draft.runwayGreenMonths, amber: draft.runwayAmberMonths })
                ];
              return (
                <span
                  key={m}
                  className="tnum rounded-full px-2.5 py-1 text-caption font-semibold"
                  style={{ background: meta.soft, color: meta.color }}
                >
                  {m.toFixed(1)} mo · {meta.label}
                </span>
              );
            })}
          </div>
        </div>
      </Card>

      <Card
        title="Burn and buffer"
        subtitle="How the burn rate is averaged, and when a bill due this week counts as underfunded."
      >
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Field
            label="Burn averaging window (complete months)"
            hint="Runway is cash ÷ this average. Months with no expenses recorded are skipped, so a young business is not diluted."
          >
            <NumInput
              value={draft.burnWindowMonths}
              onChange={(n) => patch({ burnWindowMonths: Math.max(1, Math.round(n)) })}
              min={1}
              max={24}
              ariaLabel="Burn averaging window in months"
            />
          </Field>
          <Field
            label="Minimum cash buffer (× the bill)"
            hint="A payable due within 7 days turns red when the cash in hand is below this many times it. 2 = “paying it would halve the account”."
          >
            <NumInput
              value={draft.payableBufferMultiple}
              onChange={(n) => patch({ payableBufferMultiple: Math.max(0, n) })}
              min={0}
              max={10}
              ariaLabel="Minimum cash buffer as a multiple of the payable"
            />
          </Field>
        </div>
        <Hint>
          Nothing here changes a recorded figure - these are the bars the page measures against.
          Existing cash positions, payables and expenses are untouched.
        </Hint>
      </Card>

      {/* Wrapped in a Card so the sticky bar's negative insets land on a real card edge -
          SaveBar is written to sit inside Card's p-6 body. */}
      <Card>
        <SaveBar
          dirty={dirty}
          busy={busy}
          error={error}
          onSave={save}
          onReset={() => setDraft(DEFAULT_CASH_TARGETS_CONFIG)}
          resetLabel="Reset to shipped defaults"
        />
      </Card>
    </div>
  );
}
