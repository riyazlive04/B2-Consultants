"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import type { LeadStage } from "@prisma/client";
import { ArrowLeft, Power } from "lucide-react";
import {
  DEFAULT_STAGE_MESSAGES,
  STAGE_MESSAGE_STAGES,
  type StageMessage,
  type StageMessagesConfig,
} from "@/lib/stage-messages";
import { LEAD_STAGE_LABELS } from "@/lib/labels";
import { SwitchRow, SaveBar } from "@/components/ui/controls";
import { Card, CardTitle, Hint, Pill } from "@/components/ui/kit";
import { Field, TextArea, TextInput } from "@/components/ui/form";
import { toast } from "@/components/ui/feedback";
import { saveStageMessages } from "@/server/stage-messages-actions";

export default function StageMessagesForm({
  config,
  boundTemplates,
}: {
  config: StageMessagesConfig;
  boundTemplates: Record<string, string | null>;
}) {
  const router = useRouter();
  const [draft, setDraft] = useState<StageMessagesConfig>(config);
  const [saved, setSaved] = useState<StageMessagesConfig>(config);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const dirty = JSON.stringify(draft) !== JSON.stringify(saved);
  const patchStage = (s: LeadStage, p: Partial<StageMessage>) =>
    setDraft((d) => ({ ...d, stages: { ...d.stages, [s]: { ...d.stages[s], ...p } } }));

  async function save() {
    setBusy(true);
    setError(null);
    const res = await saveStageMessages(draft);
    setBusy(false);
    if (!res.ok) return setError(res.error);
    setSaved(draft);
    toast("Stage messages saved");
    router.refresh();
  }

  return (
    <div className="space-y-5">
      <Link href="/automation" className="inline-flex items-center gap-1.5 text-sm text-ink-2 hover:text-primary">
        <ArrowLeft size={16} /> Automation
      </Link>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="font-display text-display-l font-bold text-ink">Stage messages</h1>
        <Pill tone={draft.enabled ? "good" : "bad"}>{draft.enabled ? "Sending" : "Off"}</Pill>
      </div>
      <Hint>
        Every time a lead enters a stage, manually or automatically and however old the lead is, it gets that
        stage&apos;s email and WhatsApp, including new opt-ins and moves that happen alongside another
        message. WhatsApp needs an approved WATI template
        bound to the stage&apos;s &quot;Stage · …&quot; touchpoint in WhatsApp → Settings, with {"{{name}}"} as
        its only variable. Email tokens: {"{{first_name}}"}, {"{{name}}"}, {"{{email}}"}, {"{{phone}}"}.
      </Hint>

      <Card>
        <div className="space-y-5">
          <section className="space-y-3">
            <CardTitle icon={<Power size={16} className="text-primary" />}>Master switch</CardTitle>
            <SwitchRow
              title="Send stage messages"
              description="Off = no stage message is sent. Moves made while it is off are not replayed when you switch it back on."
              checked={draft.enabled}
              onChange={(v) => setDraft((d) => ({ ...d, enabled: v }))}
            />
          </section>

          {STAGE_MESSAGE_STAGES.map((s) => {
            const m = draft.stages[s];
            const template = boundTemplates[s];
            return (
              <section key={s} className="space-y-3 border-t border-line pt-5">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <CardTitle>{LEAD_STAGE_LABELS[s] ?? s}</CardTitle>
                  <Pill tone={template ? "good" : "warn"}>
                    {template ? `WhatsApp template: ${template}` : "No WhatsApp template bound"}
                  </Pill>
                </div>
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  <SwitchRow
                    title="Email"
                    description="Sent when the lead has an email address."
                    checked={m.email}
                    onChange={(v) => patchStage(s, { email: v })}
                  />
                  <SwitchRow
                    title="WhatsApp"
                    description="Sent when the lead has a phone number and a template is bound."
                    checked={m.whatsapp}
                    onChange={(v) => patchStage(s, { whatsapp: v })}
                  />
                </div>
                {m.email && (
                  <>
                    <Field label="Email subject">
                      <TextInput value={m.subject} onChange={(e) => patchStage(s, { subject: e.target.value })} />
                    </Field>
                    <Field label="Email body">
                      <TextArea rows={7} value={m.body} onChange={(e) => patchStage(s, { body: e.target.value })} />
                    </Field>
                  </>
                )}
              </section>
            );
          })}
        </div>

        <SaveBar dirty={dirty} onSave={save} onReset={() => setDraft(DEFAULT_STAGE_MESSAGES)} busy={busy} error={error} />
      </Card>
    </div>
  );
}
