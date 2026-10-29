"use client";

import { useState, useTransition } from "react";
import { ChevronsUp } from "lucide-react";
import { toast } from "@/components/ui/feedback";
import { safeAction } from "@/lib/action-guard";
import { setImprovementUrgent } from "@/server/improvement-actions";

/**
 * ESCALATE / STAND DOWN - the head coach's one lever on a report.
 *
 * Rendered for `improvements.escalate` (ADMIN + HEAD), which is deliberately NOT
 * `improvements.triage`. For a head coach this is the only control on the screen: everything
 * else - status, re-kind, developer notes, archive - stays founder-only. So it has to stand on
 * its own at the top of the report rather than sitting inside the triage panel they cannot see.
 *
 * It is a toggle, not a one-way door. An escalation that cannot be withdrawn is one nobody
 * withdraws, and a queue where nine reports are permanently urgent has no top.
 */
/**
 * Note the prop name `improvementId` and the absence of any prop called `ref`. `ref` is reserved
 * by React and a data prop of that name cannot cross the RSC boundary - it throws "Refs cannot be
 * used in Server Components", renders nothing, and is invisible to tsc. `Improvement.ref` is a
 * real field on this model, so that is a standing hazard for every component in this folder.
 */
export function EscalateButton({
  improvementId,
  urgent,
}: {
  improvementId: string;
  urgent: boolean;
}) {
  const [busy, startTransition] = useTransition();
  const [pending, setPending] = useState(false);

  function toggle() {
    setPending(true);
    startTransition(async () => {
      const res = await safeAction(() =>
        setImprovementUrgent({ id: improvementId, urgent: !urgent }),
      );
      setPending(false);
      if (!res.ok) return toast(res.error ?? "That could not be changed");
      toast(urgent ? "Stood down - it is back in date order." : "Escalated to the top of the queue.");
    });
  }

  const working = busy || pending;

  return (
    <button
      type="button"
      onClick={toggle}
      disabled={working}
      title={
        urgent
          ? "Stop treating this as urgent"
          : "Mark this urgent so it sorts to the top of the queue"
      }
      className={
        urgent
          ? "press inline-flex h-9 items-center gap-1.5 rounded-btn border border-line bg-bad-soft px-3 text-caption font-semibold text-bad transition-colors disabled:opacity-60"
          : "press inline-flex h-9 items-center gap-1.5 rounded-btn border border-line bg-surface px-3 text-caption font-semibold text-ink transition-colors hover:border-primary hover:text-primary-strong disabled:opacity-60"
      }
    >
      <ChevronsUp size={14} />
      {working ? "…" : urgent ? "Urgent" : "Escalate"}
    </button>
  );
}
