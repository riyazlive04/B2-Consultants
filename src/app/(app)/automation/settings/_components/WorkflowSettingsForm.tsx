"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { ArrowLeft, Moon, Power } from "lucide-react";
import { DEFAULT_WORKFLOW_SETTINGS, type WorkflowSettings } from "@/lib/config-schema";
import { describeQuietWindow } from "@/lib/automation-quiet-hours";
import { SwitchRow, SaveBar } from "@/components/ui/controls";
import { Card, CardTitle, Divider, Hint, Pill } from "@/components/ui/kit";
import { Field, Select } from "@/components/ui/form";
import { toast } from "@/components/ui/feedback";
import { saveWorkflowSettings } from "@/server/automation-actions";

const HOUR_OPTS = Array.from({ length: 24 }, (_, h) => ({
  value: String(h),
  label: `${String(h).padStart(2, "0")}:00`,
}));

const BATCH_OPTS = [25, 50, 100, 200, 400, 800].map((n) => ({ value: String(n), label: String(n) }));

export default function WorkflowSettingsForm({ settings }: { settings: WorkflowSettings }) {
  const router = useRouter();
  const [draft, setDraft] = useState<WorkflowSettings>(settings);
  const [saved, setSaved] = useState<WorkflowSettings>(settings);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const dirty = JSON.stringify(draft) !== JSON.stringify(saved);
  const patch = (p: Partial<WorkflowSettings>) => setDraft((d) => ({ ...d, ...p }));
  const patchQuiet = (p: Partial<WorkflowSettings["quietHours"]>) =>
    setDraft((d) => ({ ...d, quietHours: { ...d.quietHours, ...p } }));

  async function save() {
    setBusy(true);
    setError(null);
    const res = await saveWorkflowSettings(draft);
    setBusy(false);
    if (!res.ok) return setError(res.error);
    setSaved(draft);
    toast("Settings saved");
    router.refresh();
  }

  return (
    <div className="space-y-5">
      <Link href="/automation" className="inline-flex items-center gap-1.5 text-sm text-ink-2 hover:text-primary">
        <ArrowLeft size={16} /> Automation
      </Link>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="font-display text-display-l font-bold text-ink">Global Workflow Settings</h1>
        <Pill tone={draft.engineEnabled ? "good" : "bad"}>{draft.engineEnabled ? "Engine on" : "Engine off"}</Pill>
      </div>
      <Hint>These apply to every workflow. The engine reads them on each trigger and each resume.</Hint>

      {/* One Card, one SaveBar: the bar saves the whole document, so splitting these into
          two cards would imply each saved separately. */}
      <Card>
        <div className="space-y-5">
          <section className="space-y-3">
            <CardTitle icon={<Power size={16} className="text-primary" />}>Engine</CardTitle>
            <SwitchRow
              title="Automation engine enabled"
              description="Off = no contact is enrolled and no workflow advances. In-flight runs freeze where they are and carry on from the same step when you switch this back on — nothing is lost or skipped."
              checked={draft.engineEnabled}
              onChange={(v) => patch({ engineEnabled: v })}
            />
            <SwitchRow
              title="Allow re-enrollment"
              description="On (default): a contact who has finished a workflow can go through it again if it re-triggers. Off: each contact may enter a given workflow only once, ever."
              checked={draft.allowReEnrollment}
              onChange={(v) => patch({ allowReEnrollment: v })}
            />
            <Field
              label="Enrollments resumed per run"
              hint="How many waiting enrollments each scheduled run picks up. Raise it if waits are firing late; lower it if runs are heavy."
            >
              <Select
                options={BATCH_OPTS}
                value={String(draft.batchSize)}
                onChange={(e) => patch({ batchSize: Number(e.target.value) })}
              />
            </Field>
          </section>

          <Divider />

          <section className="space-y-3">
            <CardTitle icon={<Moon size={16} className="text-primary" />}>Quiet hours</CardTitle>
            <SwitchRow
              title="Hold messages during quiet hours"
              description="Only email and SMS steps are held. Tags, stage moves and tasks still run, since the contact never sees those."
              checked={draft.quietHours.enabled}
              onChange={(v) => patchQuiet({ enabled: v })}
            />
            {draft.quietHours.enabled && (
              <>
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  <Field label="Quiet from (IST)">
                    <Select
                      options={HOUR_OPTS}
                      value={String(draft.quietHours.startHour)}
                      onChange={(e) => patchQuiet({ startHour: Number(e.target.value) })}
                    />
                  </Field>
                  <Field label="Quiet until (IST)">
                    <Select
                      options={HOUR_OPTS}
                      value={String(draft.quietHours.endHour)}
                      onChange={(e) => patchQuiet({ endHour: Number(e.target.value) })}
                    />
                  </Field>
                </div>
                <Hint>{describeQuietWindow(draft.quietHours.startHour, draft.quietHours.endHour)}</Hint>
              </>
            )}
          </section>
        </div>

        <SaveBar dirty={dirty} onSave={save} onReset={() => setDraft(DEFAULT_WORKFLOW_SETTINGS)} busy={busy} error={error} />
      </Card>
    </div>
  );
}
