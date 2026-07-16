"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { DEFAULT_COMMISSION_RULES_CONFIG, type CommissionRulesConfig } from "@/lib/config-schema";
import { Field } from "@/components/ui/form";
import { toast } from "@/components/ui/feedback";
import { saveCommissionRules } from "@/server/console-actions";
import { Card, Hint, NumInput, SaveBar } from "./kit";

/**
 * Commission rates editor (Founder Console → Commission).
 *
 * The three rates that Finance → Commission splits every student payment by. They were
 * hardcoded (5/3/4); now they're founder-editable and read live by getCommissionReport.
 * Each is a percentage of the payment ACTUALLY received — a cut of real cash in, per payment.
 */

const EXAMPLE_PAYMENT = 10_000; // ₹, the worked example the founder sees under the fields

export function CommissionPanel({ rules }: { rules: CommissionRulesConfig }) {
  const router = useRouter();
  const [draft, setDraft] = useState<CommissionRulesConfig>(rules);
  const [saved, setSaved] = useState<CommissionRulesConfig>(rules);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const dirty = JSON.stringify(draft) !== JSON.stringify(saved);
  const patch = (p: Partial<CommissionRulesConfig>) => setDraft((d) => ({ ...d, ...p }));

  const rupees = (pct: number) =>
    `₹${Math.round((EXAMPLE_PAYMENT * pct) / 100).toLocaleString("en-IN")}`;

  async function save() {
    setBusy(true);
    setError(null);
    const res = await saveCommissionRules(draft);
    setBusy(false);
    if (!res.ok) return setError(res.error);
    setSaved(draft);
    toast("Commission rates saved");
    router.refresh();
  }

  return (
    <div className="space-y-5">
      <Hint>
        How Finance → Commission splits every student payment across the deal team. Each rate is a
        percentage of the money <strong>actually received</strong> — worked out on each payment as it
        comes in, so a part payment earns a part cut. Changing a rate re-values the current month&apos;s
        report the moment you save; past payouts are re-derived, never double-counted.
      </Hint>

      <Card>
        <div className="space-y-5">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            <Field
              label="Both calls — one person (%)"
              hint="Same person did the first (lead) call AND the discovery call."
            >
              <NumInput
                ariaLabel="Both calls percentage"
                value={draft.bothCallsPct}
                onChange={(n) => patch({ bothCallsPct: n })}
                min={0}
                max={100}
              />
            </Field>
            <Field
              label="Split — two people (% each)"
              hint="First call and discovery done by different people — each earns this. Also a lone first-call or lone discovery leg."
            >
              <NumInput
                ariaLabel="Split percentage"
                value={draft.splitPct}
                onChange={(n) => patch({ splitPct: n })}
                min={0}
                max={100}
              />
            </Field>
            <Field
              label="Closer bonus (%)"
              hint="The person who ran the SSS / sales call and closed — added on top of any earlier leg they had."
            >
              <NumInput
                ariaLabel="Closer percentage"
                value={draft.closerPct}
                onChange={(n) => patch({ closerPct: n })}
                min={0}
                max={100}
              />
            </Field>
          </div>

          {/* Worked example so the numbers are tangible before saving. */}
          <div className="rounded-field border border-line bg-surface-2 px-4 py-3">
            <p className="text-caption font-semibold uppercase text-ink-3">
              On a ₹{EXAMPLE_PAYMENT.toLocaleString("en-IN")} payment
            </p>
            <ul className="mt-2 space-y-1 text-sm text-ink-2">
              <li>
                One person did both calls → <span className="font-semibold text-ink">{rupees(draft.bothCallsPct)}</span> to them
              </li>
              <li>
                Two people split the calls → <span className="font-semibold text-ink">{rupees(draft.splitPct)}</span> each
              </li>
              <li>
                Closer runs the SSS call → <span className="font-semibold text-ink">+{rupees(draft.closerPct)}</span> on top
              </li>
            </ul>
          </div>
        </div>

        <SaveBar
          dirty={dirty}
          onSave={save}
          onReset={() => setDraft(DEFAULT_COMMISSION_RULES_CONFIG)}
          busy={busy}
          error={error}
        />
      </Card>
    </div>
  );
}
