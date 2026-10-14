"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "@/components/ui/feedback";
import { TextInput } from "@/components/ui/form";
import { saveDeliveryDefaults } from "@/server/console-actions";
import { Card, Hint, SaveBar } from "./kit";
import { safeAction } from "@/lib/action-guard";

/**
 * The coach a new enrolment is assigned to when the operator leaves the field blank.
 *
 * ── Why this is a screen and not a constant ─────────────────────────────────────
 * It was a constant: the literal string "Karthick", written into four places in
 * students-actions.ts. Two things made that worth moving. It was wrong the moment anybody else
 * took a student on, and nothing on any screen said where the name was coming from - so the
 * only way to find out was to read the server action.
 *
 * Then the enrolment welcome made it load-bearing. That message names the student's tutor, and
 * falls back to the assigned coach when their batch has no tutor set - so the hardcoded name
 * was one armed switch away from being WhatsApped to students as the person looking after them.
 *
 * ── What it is not ──────────────────────────────────────────────────────────────
 * Still a NAME, not a link to a user account. `Enrollment.assignedCoach` is a free-text column
 * and changing that is a migration plus a backfill of every historic enrolment, which is a
 * bigger decision than this panel. What this buys is that the default is the founder's, and
 * visible.
 */
export function DeliveryDefaultsPanel({ config }: { config: { defaultCoach: string } }) {
  const router = useRouter();
  const [draft, setDraft] = useState(config);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const dirty = draft.defaultCoach !== config.defaultCoach;

  const save = async () => {
    setBusy(true);
    setError(null);
    const res = await safeAction(() => saveDeliveryDefaults(draft));
    setBusy(false);
    if (!res.ok) return setError(res.error);
    toast("Delivery defaults saved");
    router.refresh();
  };

  return (
    <div className="space-y-4">
      <Card title="Default coach">
        <Hint>
          Used when someone creates an enrolment and leaves the coach field empty. Leave this
          blank to have it stay empty instead — an unassigned student is a truer record than one
          assigned to whoever was hardcoded.
        </Hint>
        <div className="mt-3 max-w-sm">
          <TextInput
            kind="name"
            name="defaultCoach"
            value={draft.defaultCoach}
            placeholder="e.g. Karthick"
            onChange={(e) => setDraft({ defaultCoach: e.target.value })}
            aria-label="Default coach for new enrolments"
          />
        </div>
        <Hint>
          This name reaches students. The enrolment welcome introduces their tutor, and falls back
          to this coach when their batch has no tutor assigned — so put a real person here, or
          nobody.
        </Hint>
        <SaveBar
          dirty={dirty}
          onSave={save}
          onReset={() => setDraft(config)}
          busy={busy}
          error={error}
        />
      </Card>
    </div>
  );
}
