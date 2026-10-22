"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Plus, X } from "lucide-react";
import {
  DEFAULT_STUDENT_LIFECYCLE_CONFIG,
  type StudentLifecycleConfig,
} from "@/lib/config-schema";
import { saveStudentLifecycleConfig } from "@/server/maintenance-actions";
import { TextInput } from "@/components/ui/form";
import { toast } from "@/components/ui/feedback";
import { Card, Hint, SaveBar, Toggle } from "./kit";
import { safeAction } from "@/lib/action-guard";

/**
 * Founder Console → Why students stop.
 *
 * ── Why this is a config and not a code list ───────────────────────────────────────────
 * The discontinue button is useless without a reason, and the reason is useless unless it
 * totals - which is why the coach picks from a list rather than typing into a box. But "why do
 * students leave us" has a different answer every quarter, and a list in the code means a
 * deploy to find out that the real answer this quarter is "visa".
 *
 * ── What editing it does, and does not do ──────────────────────────────────────────────
 * Removing a reason stops it being OFFERED. It does not rewrite the enrolments already carrying
 * it, and the breakdown keeps totalling them - the history of why students left is not something
 * a dropdown edit should be able to rewrite. A coach picking a reason that has since been
 * removed is refused and asked for another, which is the only case where the two halves differ.
 */
export function StudentLifecyclePanel({ config }: { config: StudentLifecycleConfig }) {
  const router = useRouter();
  const [draft, setDraft] = useState<StudentLifecycleConfig>(config);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const dirty = JSON.stringify(draft) !== JSON.stringify(config);
  const patch = (p: Partial<StudentLifecycleConfig>) => setDraft((d) => ({ ...d, ...p }));

  const setReason = (i: number, value: string) =>
    patch({ discontinueReasons: draft.discontinueReasons.map((r, j) => (j === i ? value : r)) });
  const removeReason = (i: number) =>
    patch({ discontinueReasons: draft.discontinueReasons.filter((_, j) => j !== i) });

  const commit = async () => {
    setBusy(true);
    setError(null);
    // Blank rows are the reader's problem, not the founder's: an empty box left behind after a
    // mistyped entry should not be a validation error they have to hunt for.
    const cleaned = {
      ...draft,
      discontinueReasons: draft.discontinueReasons.map((r) => r.trim()).filter(Boolean),
    };
    const res = await safeAction(() => saveStudentLifecycleConfig(cleaned));
    setBusy(false);
    if (!res.ok) return setError(res.error);
    toast("Saved");
    router.refresh();
  };

  return (
    <Card>
      <h4 className="text-h3 text-ink">Why students stop</h4>
      <Hint>
        The list a coach picks from when they discontinue a student, and what the churn breakdown
        on the Students board totals.
        <br />
        Taking a reason off this list stops it being offered. It does not change the enrolments
        already recorded against it - that history stays exactly as it was.
      </Hint>

      <div className="mt-4 space-y-2">
        {draft.discontinueReasons.map((reason, i) => (
          <div key={i} className="flex items-center gap-2">
            <TextInput
              kind="text"
              value={reason}
              onChange={(e) => setReason(i, e.target.value)}
              aria-label={`Reason ${i + 1}`}
              placeholder="e.g. Visa refused"
            />
            <button
              type="button"
              onClick={() => removeReason(i)}
              aria-label={`Remove "${reason}"`}
              disabled={draft.discontinueReasons.length <= 1}
              title={draft.discontinueReasons.length <= 1 ? "Keep at least one reason" : undefined}
              className="press inline-flex h-10 w-10 flex-none items-center justify-center rounded-field border border-line text-ink-2 hover:border-risk hover:text-risk disabled:opacity-40"
            >
              <X size={15} aria-hidden />
            </button>
          </div>
        ))}

        <button
          type="button"
          onClick={() => patch({ discontinueReasons: [...draft.discontinueReasons, ""] })}
          className="press inline-flex h-9 items-center gap-1.5 rounded-field border border-line-strong px-3 text-sm font-semibold text-ink hover:border-primary hover:text-primary"
        >
          <Plus size={14} aria-hidden /> Add a reason
        </button>
      </div>

      <div className="mt-5 space-y-3 border-t border-line pt-5">
        <Toggle
          checked={draft.allowOtherReason}
          onChange={(v) => patch({ allowOtherReason: v })}
          label="Let a coach type a reason that is not on the list"
          title="A list with no escape hatch gets one anyway - everybody picks the nearest wrong option, which is worse, because it is indistinguishable from a real answer"
        />
        <Toggle
          checked={draft.coachMayDiscontinue}
          onChange={(v) => patch({ coachMayDiscontinue: v })}
          label="A coach may discontinue their own students"
          title="Off keeps the button with Admin and Head. The coach is still the one who knows, and every press is logged and reversible"
        />
      </div>

      {/*
        Stated here because it is the question a founder reading this panel will have, and the
        answer is a clause in the agreement rather than a setting on this screen.
      */}
      <p className="mt-4 rounded-field border border-line bg-surface-2 px-3 py-2 text-caption text-ink-2">
        Discontinuing never touches money. §8 of the agreement is explicit that withdrawal earns
        no refund, so the instalments stay owed and the payment reminders keep running - a refund
        is a separate decision, taken in Finance.
      </p>

      <SaveBar
        dirty={dirty}
        onSave={commit}
        onReset={() => setDraft(DEFAULT_STUDENT_LIFECYCLE_CONFIG)}
        busy={busy}
        error={error}
      />
    </Card>
  );
}
