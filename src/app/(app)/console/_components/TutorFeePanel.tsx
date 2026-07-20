"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import {
  DEFAULT_TUTOR_FEE_CONFIG,
  TUTOR_FEE_LEVELS,
  type TutorFeeConfig,
  type TutorFeeLevel,
} from "@/lib/config-schema";
import { tutorRatePerHeadRupees, tutorFeeForBatchInrMinor } from "@/lib/tutor-fee";
import { Field } from "@/components/ui/form";
import { toast } from "@/components/ui/feedback";
import { saveTutorFee } from "@/server/console-actions";
import { Card, Hint, NumInput, SaveBar } from "./kit";

/**
 * Trainer-fee editor (Founder Console → Tutor Fee), spec Part 2 §5.
 *
 * The rule is a size band, not a level price: a batch at or above the threshold earns the
 * tutor the lower per-head rate. Rates are per-level because §5 says they "can differ per
 * level", but they ship flat at the only two numbers the founders actually stated — §18.2
 * left the full per-level table open, so the console is where that gets answered, not the code.
 */

/** Batch sizes the preview walks, chosen to straddle the threshold. */
const PREVIEW_SIZES = [3, 4, 5, 6, 8];

export function TutorFeePanel({ config }: { config: TutorFeeConfig }) {
  const router = useRouter();
  const [draft, setDraft] = useState<TutorFeeConfig>(config);
  const [saved, setSaved] = useState<TutorFeeConfig>(config);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const dirty = JSON.stringify(draft) !== JSON.stringify(saved);

  const patchBand = (level: TutorFeeLevel, key: "atOrAbove" | "below", n: number) =>
    setDraft((d) => ({
      ...d,
      ratesByLevel: { ...d.ratesByLevel, [level]: { ...d.ratesByLevel[level], [key]: n } },
    }));

  async function save() {
    setBusy(true);
    setError(null);
    const res = await saveTutorFee(draft);
    setBusy(false);
    if (!res.ok) return setError(res.error);
    setSaved(draft);
    toast("Tutor fee saved");
    router.refresh();
  }

  const inr = (paise: number) => `₹${Math.round(paise / 100).toLocaleString("en-IN")}`;

  return (
    <div className="space-y-5">
      <Hint>
        What a tutor earns for running a batch. The rate is driven by <strong>how many students
        are in the batch</strong>, not by which level it is — a thin batch pays more per head.
        Charged per student, per level, so a 5-student batch at ₹7,000 costs ₹35,000.
      </Hint>

      <Card>
        <div className="space-y-5">
          <Field
            label="Threshold — students needed for the lower rate"
            hint="At or above this count, the batch pays the 'at or above' rate. Below it, the higher one."
          >
            <div className="max-w-[12rem]">
              <NumInput
                ariaLabel="Tutor fee threshold students"
                value={draft.thresholdStudents}
                onChange={(n) => setDraft((d) => ({ ...d, thresholdStudents: n }))}
                min={1}
                max={100}
              />
            </div>
          </Field>

          <div className="space-y-3">
            <p className="text-caption font-semibold uppercase text-ink-3">Per-head rate by level (₹)</p>
            {TUTOR_FEE_LEVELS.map((level) => (
              <div key={level} className="grid grid-cols-1 gap-4 sm:grid-cols-[4rem_1fr_1fr] sm:items-end">
                <div className="text-sm font-semibold text-ink">{level}</div>
                <Field label={`${draft.thresholdStudents}+ students`} hint="The volume rate.">
                  <NumInput
                    ariaLabel={`${level} at or above rate`}
                    value={draft.ratesByLevel[level].atOrAbove}
                    onChange={(n) => patchBand(level, "atOrAbove", n)}
                    min={0}
                    max={10_000_000}
                  />
                </Field>
                <Field label={`Under ${draft.thresholdStudents} students`} hint="The thin-batch rate.">
                  <NumInput
                    ariaLabel={`${level} below rate`}
                    value={draft.ratesByLevel[level].below}
                    onChange={(n) => patchBand(level, "below", n)}
                    min={0}
                    max={10_000_000}
                  />
                </Field>
              </div>
            ))}
          </div>

          {/*
            The bands are abstract until you see the money. This walks real batch sizes across
            the threshold so the founder can see the step before saving — the boundary is where
            this rule is easiest to get wrong.
          */}
          <div className="overflow-x-auto rounded-field border border-line bg-surface-2 px-4 py-3">
            <p className="text-caption font-semibold uppercase text-ink-3">
              What an A1 batch costs at each size
            </p>
            <table className="mt-2 w-full text-sm text-ink-2">
              <thead>
                <tr className="text-left text-caption uppercase text-ink-3">
                  <th className="py-1 pr-4 font-medium">Students</th>
                  <th className="py-1 pr-4 font-medium">Rate / head</th>
                  <th className="py-1 font-medium">Batch total</th>
                </tr>
              </thead>
              <tbody>
                {PREVIEW_SIZES.map((n) => {
                  const crossed = n >= draft.thresholdStudents;
                  return (
                    <tr key={n} className={crossed ? "text-ink" : ""}>
                      <td className="py-1 pr-4">{n}</td>
                      <td className="py-1 pr-4">
                        ₹{tutorRatePerHeadRupees("A1", n, draft).toLocaleString("en-IN")}
                        <span className="ml-2 text-caption text-ink-3">{crossed ? "volume" : "thin"}</span>
                      </td>
                      <td className="py-1 font-semibold">{inr(tutorFeeForBatchInrMinor("A1", n, draft))}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>

        <SaveBar
          dirty={dirty}
          onSave={save}
          onReset={() => setDraft(DEFAULT_TUTOR_FEE_CONFIG)}
          busy={busy}
          error={error}
        />
      </Card>
    </div>
  );
}
