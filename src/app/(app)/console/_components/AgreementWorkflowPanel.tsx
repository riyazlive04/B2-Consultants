"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { DEFAULT_AGREEMENT_WORKFLOW, type AgreementWorkflowConfig } from "@/lib/config-schema";
import { LEAD_STAGE_LABELS } from "@/lib/labels";
import { toast } from "@/components/ui/feedback";
import { saveAgreementWorkflow } from "@/server/console-actions";
import { Card, Hint, SaveBar } from "./kit";
import { safeAction } from "@/lib/action-guard";

/**
 * The Agreement module's settings (Founder Console → Agreements).
 *
 * Four things, and the first is different in kind from the other three:
 *
 *   READINESS is a PROMPT THRESHOLD, never a gate. It decides who shows up as "Agreement pending -
 *   ready to send" on the dashboard and on a contact's profile before a draft exists. Whatever is
 *   picked, the founder can still draft and send an agreement for anyone, at any time, from the
 *   picker. The system suggests; the founder decides.
 *
 *   DELIVERY, the SIGNING WINDOW and the REMINDER SCHEDULE are operational: they decide how a link
 *   reaches the counterparty, how long it stays live, and when an unsigned agreement gets nudged.
 *   Delivery in particular is the one that keeps the module working when WhatsApp cannot - see the
 *   note on `AGREEMENT_DELIVERY_CHANNELS`.
 */

type Readiness = AgreementWorkflowConfig["readiness"];

const OPTIONS: Array<{ value: Readiness; title: string; body: string; stages: string[] }> = [
  {
    value: "EITHER",
    title: "As soon as they've agreed",
    body: "Prompts the moment a deal is agreed - even before the deposit lands. The earliest nudge, and the one that keeps a contract from being the bottleneck.",
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
    const res = await safeAction(() => saveAgreementWorkflow(draft));
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
        only controls the <em>prompt</em> - the action card on a contact and the task on your
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
                  // Spread, not a fresh object: this used to replace the whole config, which
                  // silently reset the delivery and reminder settings whenever the prompt changed.
                  onChange={() => setDraft({ ...draft, readiness: o.value })}
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

      <Hint>
        How a signing link <strong>reaches</strong> the person, how long it stays live, and when an
        unsigned agreement gets chased. A reminder carries no link - only the hash of a signing
        token is stored, so there is nothing to rebuild one from - it points them at the message
        they already have.
      </Hint>

      <Card>
        <div className="space-y-5">
          <fieldset className="space-y-2">
            <legend className="text-sm font-semibold text-ink">Send the signing link by</legend>
            <p className="text-sm text-ink-2">
              WhatsApp needs an approved template and a number that has not opted out. Email needs an
              address on the agreement. <strong>Both</strong> tries each and tells you what happened to
              either - which is why it is the default.
            </p>
            <div className="flex flex-wrap gap-2 pt-1">
              {(
                [
                  ["BOTH", "WhatsApp and email"],
                  ["WHATSAPP", "WhatsApp only"],
                  ["EMAIL", "Email only"],
                ] as const
              ).map(([value, label]) => (
                <label
                  key={value}
                  className={`cursor-pointer rounded-btn border px-3 py-2 text-sm transition-colors ${
                    draft.deliverBy === value
                      ? "border-primary bg-primary-soft font-semibold text-primary"
                      : "border-line hover:border-primary-tint"
                  }`}
                >
                  <input
                    type="radio"
                    name="deliverBy"
                    value={value}
                    checked={draft.deliverBy === value}
                    onChange={() => setDraft({ ...draft, deliverBy: value })}
                    className="sr-only"
                  />
                  {label}
                </label>
              ))}
            </div>
          </fieldset>

          <div>
            <label htmlFor="agreement-ttl" className="text-sm font-semibold text-ink">
              Signing window
            </label>
            <p className="mt-1 text-sm text-ink-2">
              How many days a signing link stays live. A contract deserves a re-read, so this is
              longer than an invite; past it, the agreement has to be voided and cloned.
            </p>
            <div className="mt-2 flex items-center gap-2">
              <input
                id="agreement-ttl"
                type="number"
                min={1}
                max={90}
                value={draft.ttlDays}
                onChange={(e) => {
                  const n = Number(e.target.value);
                  setDraft({ ...draft, ttlDays: Number.isFinite(n) ? Math.min(90, Math.max(1, Math.round(n))) : 14 });
                }}
                className="h-10 w-24 rounded-field border border-line-strong bg-surface px-3 text-body text-ink outline-none focus:border-primary focus:ring-2 focus:ring-primary-soft"
              />
              <span className="text-sm text-ink-2">days</span>
            </div>
          </div>

          <div>
            <span className="text-sm font-semibold text-ink">Chase an unsigned agreement</span>
            <p className="mt-1 text-sm text-ink-2">
              Days after it was sent. Needs the daily cron to be running
              (<code className="font-mono text-caption">/api/cron/agreements</code>); turn every day
              off to stop chasing entirely.
            </p>
            <div className="mt-2 flex flex-wrap gap-1.5">
              {[1, 2, 3, 5, 7, 10, 12, 14, 21].map((day) => {
                const on = draft.reminderDays.includes(day);
                return (
                  <button
                    key={day}
                    type="button"
                    aria-pressed={on}
                    onClick={() =>
                      setDraft({
                        ...draft,
                        // Sorted on the way in, so the sweep can take the LAST due day without
                        // caring what order the founder clicked in.
                        reminderDays: (on
                          ? draft.reminderDays.filter((d) => d !== day)
                          : [...draft.reminderDays, day]
                        )
                          .slice(0, 5)
                          .sort((a, b) => a - b),
                      })
                    }
                    className={`h-9 rounded-btn border px-3 text-sm transition-colors ${
                      on
                        ? "border-primary bg-primary-soft font-semibold text-primary"
                        : "border-line text-ink-2 hover:border-primary-tint"
                    }`}
                  >
                    Day {day}
                  </button>
                );
              })}
            </div>
            <p className="mt-2 text-caption text-faint">
              {draft.reminderDays.length === 0
                ? "No automatic reminders. You can still nudge by hand from the agreement."
                : `Nudges on day ${draft.reminderDays.join(", ")} - at most five, and never after the link has expired.`}
            </p>
          </div>
        </div>

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
