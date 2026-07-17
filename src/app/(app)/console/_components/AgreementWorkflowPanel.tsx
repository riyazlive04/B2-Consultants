"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { DEFAULT_AGREEMENT_WORKFLOW, type AgreementWorkflowConfig } from "@/lib/config-schema";
import { LEAD_STAGE_LABELS } from "@/lib/labels";
import { toast } from "@/components/ui/feedback";
import { saveAgreementWorkflow } from "@/server/console-actions";
import { Card, Hint, SaveBar } from "./kit";

/**
 * When the Agreement module starts nudging (Founder Console → Agreements).
 *
 * Deliberately the ONLY agreement setting: everything else about the workflow is derived, not
 * configured. This one number decides who shows up as "Agreement pending — ready to send" on the
 * dashboard and on a contact's profile before a draft exists.
 *
 * It is a prompt threshold, never a gate — whatever is picked here, the founder can still draft and
 * send an agreement for anyone, any time, from the picker. That is the point: the system suggests,
 * the founder decides.
 */

type Readiness = AgreementWorkflowConfig["readiness"];

const OPTIONS: Array<{ value: Readiness; title: string; body: string; stages: string[] }> = [
  {
    value: "EITHER",
    title: "As soon as they've agreed",
    body: "Prompts the moment a deal is agreed — even before the deposit lands. The earliest nudge, and the one that keeps a contract from being the bottleneck.",
    stages: ["DEPOSIT_FOLLOWUP", "DEPOSIT_PAID", "WON"],
  },
  {
    value: "DEPOSIT",
    title: "Once the deposit is paid",
    body: "Waits for money to actually arrive before prompting. Fewer cards, and every one of them is backed by a payment.",
    stages: ["DEPOSIT_PAID", "WON"],
  },
  {
    value: "WON",
    title: "Only when the deal is won",
    body: "The strictest setting. Nothing is prompted until the deal is fully closed.",
    stages: ["WON"],
  },
];

export function AgreementWorkflowPanel({ config }: { config: AgreementWorkflowConfig }) {
  const router = useRouter();
  const [draft, setDraft] = useState<AgreementWorkflowConfig>(config);
  const [saved, setSaved] = useState<AgreementWorkflowConfig>(config);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const dirty = JSON.stringify(draft) !== JSON.stringify(saved);

  async function save() {
    setBusy(true);
    setError(null);
    const res = await saveAgreementWorkflow(draft);
    setBusy(false);
    if (!res.ok) return setError(res.error);
    setSaved(draft);
    toast("Agreement workflow saved");
    router.refresh();
  }

  return (
    <div className="space-y-5">
      <Hint>
        When should the app start telling you an agreement is <strong>ready to send</strong>? This
        only controls the <em>prompt</em> — the action card on a contact and the task on your
        dashboard. You can always draft and send an agreement for anyone, at any time, from the
        client picker. Nothing here ever blocks you.
      </Hint>

      <Card>
        <fieldset className="space-y-3">
          <legend className="sr-only">Agreement readiness prompt</legend>
          {OPTIONS.map((o) => {
            const active = draft.readiness === o.value;
            return (
              <label
                key={o.value}
                className={`flex cursor-pointer gap-3 rounded-card border p-4 transition-colors ${
                  active ? "border-primary bg-primary-soft" : "border-line hover:border-primary-tint"
                }`}
              >
                <input
                  type="radio"
                  name="readiness"
                  value={o.value}
                  checked={active}
                  onChange={() => setDraft({ readiness: o.value })}
                  className="mt-1 h-4 w-4 flex-none accent-[var(--primary)]"
                />
                <span className="min-w-0">
                  <span className="block text-sm font-semibold text-ink">{o.title}</span>
                  <span className="mt-0.5 block text-sm text-ink-2">{o.body}</span>
                  <span className="mt-2 flex flex-wrap gap-1.5">
                    {o.stages.map((s) => (
                      <span
                        key={s}
                        className="rounded-full bg-surface-2 px-2 py-0.5 text-caption font-medium text-ink-2"
                      >
                        {LEAD_STAGE_LABELS[s] ?? s}
                      </span>
                    ))}
                  </span>
                </span>
              </label>
            );
          })}
        </fieldset>

        <SaveBar
          dirty={dirty}
          onSave={save}
          onReset={() => setDraft(DEFAULT_AGREEMENT_WORKFLOW)}
          busy={busy}
          error={error}
        />
      </Card>
    </div>
  );
}
