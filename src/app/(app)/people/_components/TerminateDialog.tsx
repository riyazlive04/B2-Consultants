"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { AlertTriangle, Download, UserMinus } from "lucide-react";
import { Modal } from "@/components/ui/Modal";
import { Btn } from "@/components/ui/controls";
import { Field, FormError, TextInput } from "@/components/ui/form";
import { SelectMenu } from "@/components/ui/SelectMenu";
import { toast } from "@/components/ui/feedback";
import { formatInrMinor } from "@/lib/format";
import { terminateUser } from "@/server/users-actions";
import type { TerminationReport } from "@/server/termination-report";

/**
 * Offboarding, in three steps: what they did, what they still hold, then confirm.
 *
 * ── Why it is a review before a button, not a button with a confirm ──────────────
 * The destructive part of terminating someone is not closing their login - it is that their open
 * work silently stops being anybody's. So the dialog is built around answering "what happens to
 * their queue" BEFORE asking whether to proceed, and it refuses to continue while anything is
 * outstanding and no successor has been chosen.
 *
 * The performance figures are here for a different reason: this is the last moment the founder
 * will have a reason to look at them, so the record gets made while there is still a prompt to
 * make it.
 */

export type SuccessorOption = { value: string; label: string };

export function TerminateDialog({
  report,
  successors,
  onClose,
}: {
  report: TerminationReport;
  successors: SuccessorOption[];
  onClose: () => void;
}) {
  const router = useRouter();
  const [step, setStep] = useState<1 | 2 | 3>(1);
  const [successorProfileId, setSuccessorProfileId] = useState(successors[0]?.value ?? "");
  const [reason, setReason] = useState("");
  /**
   * Where their open leads go. Defaults to the successor, which is what this dialog always did.
   *
   * The choice exists because "hand everything to one person" stops being a handover at volume:
   * a departing setter who carried most of the rotation leaves thousands of open leads, and
   * dropping them on a colleague buries their own queue without anyone deciding to. Releasing to
   * the pool keeps them visible and lets the hand-out flow drain them at a workable pace.
   */
  const [leadDestination, setLeadDestination] = useState<"successor" | "pool">("successor");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const holds = report.holds;
  const held = holds.categories.filter((c) => c.count > 0);
  const leadCount = holds.categories.find((c) => c.key === "leads")?.count ?? 0;
  // Releasing leads to the pool is a destination, not an omission - so those leads stop counting
  // towards "somebody must take this over". Everything else still needs a named person.
  const holdsNeedingOwner = leadDestination === "pool" ? holds.total - leadCount : holds.total;
  const needsSuccessor = holdsNeedingOwner > 0;

  async function confirm() {
    setBusy(true);
    setError(null);
    const res = await terminateUser({
      profileId: report.profile.id,
      successorProfileId: needsSuccessor ? successorProfileId : successorProfileId || null,
      reason,
      leadDestination,
    });
    setBusy(false);
    if (!res.ok) return setError(res.error);
    toast(`${report.profile.name} has been offboarded`);
    onClose();
    router.refresh();
  }

  return (
    <Modal
      open
      onClose={onClose}
      title={`Offboard ${report.profile.name}`}
      subtitle={`${report.profile.roleTitle} · step ${step} of 3`}
    >
      <div className="space-y-4">
        {step === 1 && (
          <>
            <p className="text-sm text-muted">
              Their record for the file. Nothing has changed yet.
            </p>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              <Stat label="Calls logged" value={report.work.callsLogged} />
              <Stat label="Conversations" value={report.work.conversationsHad} />
              <Stat label="Leads owned" value={report.work.leadsOwnedEver} />
              <Stat label="Leads won" value={report.work.leadsWon} />
              <Stat label="Discovery calls" value={report.work.discoveryOutcomes} />
              <Stat label="Highly qualified" value={report.work.highlyQualified} />
              <Stat label="Calls attended" value={report.work.bookingsAttended} />
              <Stat label="Daily logs" value={report.work.dailyLogsSubmitted} />
            </div>
            <div className="rounded-card bg-surface-2 p-3 text-caption text-muted">
              {report.tenure.months !== null ? (
                <>Tenure <strong className="text-ink">{report.tenure.months} months</strong> · </>
              ) : null}
              Paid <strong className="text-ink">{formatInrMinor(report.earnings.commissionInrMinor)}</strong> across{" "}
              {report.earnings.payouts} payout{report.earnings.payouts === 1 ? "" : "s"}
            </div>

            <div>
              <p className="text-caption font-semibold uppercase text-muted">Roles &amp; responsibilities</p>
              <p className="mt-1 whitespace-pre-wrap text-sm text-ink">
                {report.profile.keyResponsibilities?.trim() || (
                  <span className="text-muted">
                    Nothing was recorded on their profile. What they actually held is on the next step.
                  </span>
                )}
              </p>
            </div>

            <a
              href={`/api/people/${report.profile.id}/termination-report`}
              className="inline-flex items-center gap-1.5 text-sm font-medium text-primary hover:underline"
            >
              <Download size={14} /> Download the full report (PDF)
            </a>
          </>
        )}

        {step === 2 && (
          <>
            {held.length === 0 ? (
              <p className="rounded-card bg-ok-soft p-3 text-sm text-ok-ink">
                <strong>Nothing outstanding.</strong> They hold no open leads, calls or tasks, so
                there is nothing to hand over.
              </p>
            ) : (
              <>
                <p className="text-sm text-muted">
                  These move to whoever takes over. Their call history, recorded outcomes and past
                  commission stay with them - those are a record of what happened, not work.
                </p>
                <ul className="divide-y divide-line rounded-card border border-line">
                  {held.map((c) => (
                    <li key={c.key} className="flex items-start gap-3 px-3 py-2.5">
                      <span className="tnum w-10 flex-none text-right font-semibold text-ink">{c.count}</span>
                      <span className="min-w-0">
                        <span className="block text-sm font-medium text-ink">{c.label}</span>
                        <span className="block text-caption text-muted">{c.detail}</span>
                      </span>
                    </li>
                  ))}
                </ul>
              </>
            )}

            {leadCount > 0 && (
              <div className="rounded-card border border-line p-3">
                <p className="text-caption font-semibold uppercase text-muted">
                  Their {leadCount.toLocaleString("en-IN")} open lead{leadCount === 1 ? "" : "s"}
                </p>
                <div className="mt-2 space-y-2">
                  <DestinationChoice
                    checked={leadDestination === "successor"}
                    onChange={() => setLeadDestination("successor")}
                    label="Give them to the successor"
                    detail="They land in that person's queue straight away. Right for a small handover."
                  />
                  <DestinationChoice
                    checked={leadDestination === "pool"}
                    onChange={() => setLeadDestination("pool")}
                    label="Return them to the unassigned pool"
                    detail="They become unowned and are handed out from Pipeline → Leads → Hand out leads, at whatever pace the team can absorb. Right when the pile is bigger than one person's queue."
                  />
                </div>
                {leadDestination === "pool" && (
                  <p className="mt-2 text-caption text-muted">
                    Nothing is lost - unassigned leads are counted and visible. Only the leads move
                    this way; calls, slots and tasks still need a named owner.
                  </p>
                )}
              </div>
            )}

            <Field
              label="Who takes this over?"
              hint={
                needsSuccessor
                  ? "Required - open work cannot be left ownerless."
                  : leadDestination === "pool" && leadCount > 0
                    ? "Not needed - the leads are going to the pool and nothing else is outstanding."
                    : "Optional."
              }
            >
              <SelectMenu
                aria-label="Successor"
                value={successorProfileId}
                onChange={(e) => setSuccessorProfileId(e.target.value)}
                options={
                  needsSuccessor
                    ? successors
                    : [{ value: "", label: "Nobody - nothing to hand over" }, ...successors]
                }
              />
            </Field>
          </>
        )}

        {step === 3 && (
          <>
            <p className="flex items-start gap-2 rounded-card bg-warn-soft p-3 text-sm text-warn-ink">
              <AlertTriangle size={15} className="mt-0.5 flex-none" />
              <span>
                <strong>{report.profile.name} will be signed out immediately</strong> and will not
                be able to sign in again. Their history stays intact and attributed to them, and
                this can be reversed from the Former team members list.
              </span>
            </p>
            {holdsNeedingOwner > 0 && (
              <p className="text-sm text-muted">
                {holdsNeedingOwner} open item{holdsNeedingOwner === 1 ? "" : "s"} will move to{" "}
                <strong className="text-ink">
                  {successors.find((s) => s.value === successorProfileId)?.label ?? "-"}
                </strong>
                .
              </p>
            )}
            {leadDestination === "pool" && leadCount > 0 && (
              <p className="text-sm text-muted">
                <strong className="text-ink">{leadCount.toLocaleString("en-IN")} open lead
                {leadCount === 1 ? "" : "s"}</strong> will be returned to the unassigned pool, ready
                to hand out.
              </p>
            )}
            <Field label="Reason (optional)" hint="Recorded on their record and in the activity log.">
              <TextInput
                kind="text"
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                maxLength={500}
                placeholder="Resigned, contract ended, …"
              />
            </Field>
          </>
        )}

        <div className="flex items-center justify-between gap-3 border-t border-line pt-3">
          <FormError message={error} />
          <div className="ml-auto flex items-center gap-2">
            {step > 1 && (
              <Btn variant="ghost" onClick={() => setStep((s) => (s === 3 ? 2 : 1))} disabled={busy}>
                Back
              </Btn>
            )}
            {step < 3 ? (
              <Btn
                onClick={() => setStep((s) => (s === 1 ? 2 : 3))}
                // The one gate that matters: you cannot reach the confirm step leaving work
                // ownerless, which is the failure this whole dialog exists to prevent.
                disabled={step === 2 && needsSuccessor && !successorProfileId}
              >
                Continue
              </Btn>
            ) : (
              <Btn variant="danger" onClick={confirm} disabled={busy}>
                <UserMinus size={14} /> {busy ? "Offboarding…" : `Offboard ${report.profile.name}`}
              </Btn>
            )}
          </div>
        </div>
      </div>
    </Modal>
  );
}

function DestinationChoice({
  checked,
  onChange,
  label,
  detail,
}: {
  checked: boolean;
  onChange: () => void;
  label: string;
  detail: string;
}) {
  return (
    <label className="flex cursor-pointer items-start gap-2.5">
      <input
        type="radio"
        name="lead-destination"
        checked={checked}
        onChange={onChange}
        className="mt-1 flex-none accent-[var(--primary)]"
      />
      <span className="min-w-0">
        <span className="block text-sm font-medium text-ink">{label}</span>
        <span className="block text-caption text-muted">{detail}</span>
      </span>
    </label>
  );
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-card border border-line p-2.5">
      <div className="tnum text-h3 text-ink">{value.toLocaleString("en-IN")}</div>
      <div className="text-caption text-muted">{label}</div>
    </div>
  );
}
