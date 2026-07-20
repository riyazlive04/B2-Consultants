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
 * Every rate the deal-team split uses lives here and nowhere else. They were hardcoded
 * (5/3/4); they are now founder-editable and read live by getCommissionReport, which is the
 * whole point — the founders change these without a deploy, so the spec's example numbers are
 * a starting position, never something the code should assert.
 *
 * Each is a percentage of the payment ACTUALLY received — a cut of real cash in, per payment.
 *
 * If you add a rate to commissionRulesConfigSchema, it MUST get a field here. The panel posts
 * its whole draft, so a rate with no input is a value the founder can see the effect of but
 * never change — the exact "code change = blocker" problem this panel exists to remove.
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

  /**
   * The cover split, shown as real money on both sides.
   *
   * Mirrors commission-metrics exactly: the stand-in's share is rounded and the owner takes
   * the REMAINDER, so the two always sum to the leg. Rounding each independently would show
   * the founder a total that the payout report never actually pays.
   */
  const cover = (() => {
    const leg = Math.round((EXAMPLE_PAYMENT * draft.splitPct) / 100);
    const substitute = Math.round((leg * draft.substitutePct) / 100);
    const owner = leg - substitute;
    const fmt = (n: number) => `₹${n.toLocaleString("en-IN")}`;
    return { substitute: fmt(substitute), owner: fmt(owner) };
  })();

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
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
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
            <Field
              label="Substitute's share when covering (%)"
              hint="Someone ran a discovery call in another person's slot. The stand-in keeps this share of that leg; the slot's owner keeps the rest. It splits the leg — it does not cost extra."
            >
              <NumInput
                ariaLabel="Substitute share percentage"
                value={draft.substitutePct}
                onChange={(n) => patch({ substitutePct: n })}
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
              <li>
                A stand-in covers a discovery slot → that{" "}
                <span className="font-semibold text-ink">{rupees(draft.splitPct)}</span> leg becomes{" "}
                <span className="font-semibold text-ink">{cover.substitute}</span> to the stand-in and{" "}
                <span className="font-semibold text-ink">{cover.owner}</span> to the slot&apos;s owner
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
