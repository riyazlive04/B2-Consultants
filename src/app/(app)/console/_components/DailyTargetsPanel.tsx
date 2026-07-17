"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { DEFAULT_DAILY_LOG_TARGETS, type DailyLogTargets } from "@/lib/config-schema";
import { Field } from "@/components/ui/form";
import { toast } from "@/components/ui/feedback";
import { saveDailyLogTargets } from "@/server/console-actions";
import { Card, Hint, NumInput, SaveBar } from "./kit";

/**
 * Daily-log targets editor (Founder Console → Daily Targets).
 *
 * One target per role, on its headline metric. The Daily Log timeline grades each entry
 * against it — hit the target and the day reads "On target", well over is "Standout", well
 * under is "Below par". Leave a target at 0 and that role's status falls back to the person's
 * own recent average, so the feature works either way.
 */

const ROWS: { key: keyof DailyLogTargets; label: string; hint: string }[] = [
  { key: "DISCOVERY_SPECIALIST", label: "Discovery Specialist — calls / day", hint: "Discovery calls completed, per working day." },
  { key: "APPOINTMENT_SETTER", label: "Appointment Setter — appointments / day", hint: "Discovery calls booked, per working day." },
  { key: "DELIVERY_COACH", label: "Delivery Coach — sessions / day", hint: "Coaching sessions delivered, per working day." },
];

export function DailyTargetsPanel({ targets }: { targets: DailyLogTargets }) {
  const router = useRouter();
  const [draft, setDraft] = useState<DailyLogTargets>(targets);
  const [saved, setSaved] = useState<DailyLogTargets>(targets);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const dirty = JSON.stringify(draft) !== JSON.stringify(saved);
  const patch = (p: Partial<DailyLogTargets>) => setDraft((d) => ({ ...d, ...p }));

  async function save() {
    setBusy(true);
    setError(null);
    const res = await saveDailyLogTargets(draft);
    setBusy(false);
    if (!res.ok) return setError(res.error);
    setSaved(draft);
    toast("Daily targets saved");
    router.refresh();
  }

  return (
    <div className="space-y-5">
      <Hint>
        The per-role daily target the <strong>Daily Log</strong> grades every entry against. Hitting it
        reads <strong>On target</strong>, comfortably over is <strong>Standout</strong>, well under is{" "}
        <strong>Below par</strong>. Set a target to <strong>0</strong> to switch that role back to grading
        against each person&apos;s own recent average.
      </Hint>

      <Card>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          {ROWS.map((row) => (
            <Field key={row.key} label={row.label} hint={row.hint}>
              <NumInput
                ariaLabel={row.label}
                value={draft[row.key]}
                onChange={(n) => patch({ [row.key]: n } as Partial<DailyLogTargets>)}
                min={0}
                max={999}
              />
            </Field>
          ))}
        </div>

        <SaveBar
          dirty={dirty}
          onSave={save}
          onReset={() => setDraft(DEFAULT_DAILY_LOG_TARGETS)}
          busy={busy}
          error={error}
        />
      </Card>
    </div>
  );
}
