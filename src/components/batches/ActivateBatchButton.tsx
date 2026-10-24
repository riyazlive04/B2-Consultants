"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Play } from "lucide-react";
import { Btn } from "@/components/ui/controls";
import { askConfirm, toast } from "@/components/ui/feedback";
import { safeAction } from "@/lib/action-guard";
import { activateBatch } from "@/server/batch-actions";
import { describeBlockers, type BatchPrerequisite } from "@/lib/batch";

/**
 * START THIS COHORT - the moment a cohort stops being a draft (refactor step C3).
 *
 * ── Why the button is DISABLED rather than hidden when the cohort is not ready ──────────
 * The founders' complaint was never that the app let them do the wrong thing - it was that they
 * could not tell what was missing. A hidden button answers nothing. A disabled one carrying
 * "Needs a plan to teach from and at least one learner" in its tooltip and its `aria-describedby`
 * says exactly what to go and do, and the checklist underneath links to each remedy.
 *
 * The reason text comes from the SAME function the server refuses with (`describeBlockers` over
 * `activationBlockers`), so the two can never drift into disagreeing about why.
 */
export function ActivateBatchButton({
  batchId,
  batchName,
  ok,
  blockers,
}: {
  batchId: string;
  batchName: string;
  /** `canActivate.ok` from the detail view - a plan, a teacher and at least one learner. */
  ok: boolean;
  blockers: BatchPrerequisite[];
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const reason = ok ? "" : `${describeBlockers(blockers)} before this cohort can start.`;

  async function run() {
    const confirmed = await askConfirm({
      title: `Start ${batchName}?`,
      body: "Today becomes the cohort's start date, and it will read as running on every board and report. You can change the date later on the batch form.",
      confirmLabel: "Start the cohort",
    });
    if (!confirmed) return;

    setBusy(true);
    const res = await safeAction(() => activateBatch(batchId));
    setBusy(false);
    if (!res.ok) {
      toast(res.error ?? "Could not start this cohort", "error");
      return;
    }
    toast(`${batchName} is running from today`);
    router.refresh();
  }

  return (
    <>
      <Btn
        variant="primary"
        size="sm"
        icon={<Play size={14} />}
        disabled={!ok}
        busy={busy}
        onClick={run}
        title={reason || `Set today as the start date for ${batchName}`}
        describedBy={ok ? undefined : `activate-why-${batchId}`}
      >
        Start cohort
      </Btn>
      {/* A `title` is invisible to a keyboard user who never hovers, so the reason is also in
          the accessibility tree - the same mistake the custom pickers made with aria-required. */}
      {!ok && (
        <span id={`activate-why-${batchId}`} className="sr-only">
          {reason}
        </span>
      )}
    </>
  );
}
