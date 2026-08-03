"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { TutorFeeStatus } from "@prisma/client";
import { Card, Hint } from "@/components/ui/kit";
import { toast } from "@/components/ui/feedback";
import { Field } from "@/components/ui/form";
import type { TutorFeeRow } from "@/server/tutor-fees";
import { recomputeTutorFees, setTutorFeeStatus, setTutorFeeOverride } from "@/server/tutor-fee-actions";

/**
 * Tutor Fee ledger (Founder Console → Tutor Fees) — ER v2 Track C.
 *
 * The `Tutor Fee` tab beside this one configures the RATE BANDS. This one is the RECORD: what
 * each batch actually owes its trainer right now, and where it is in the approval ladder.
 *
 * Two things this screen is careful to make visible rather than hide:
 *   · the BAND that produced a figure (5 students → the volume rate), because the founders'
 *     own workbook shows the tier, not just the total;
 *   · that an APPROVED fee is FROZEN, so a roster change afterwards does not silently
 *     re-price it. A frozen row that no longer matches its batch is shown as "frozen", not
 *     as "stale" — being out of date is the intent, not an error.
 */

const inr = (paise: number) => `₹${Math.round(paise / 100).toLocaleString("en-IN")}`;

const STATUS_STYLE: Record<TutorFeeStatus, string> = {
  DRAFT: "bg-surface-3 text-ink-2",
  APPROVED: "bg-accent-soft text-accent-ink",
  PAID: "bg-ok-soft text-ok-ink",
  CANCELLED: "bg-surface-3 text-ink-3 line-through",
};

export function TutorFeeLedgerPanel({ fees, accrualOn }: { fees: TutorFeeRow[]; accrualOn: boolean }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [busyId, setBusyId] = useState<string | null>(null);
  const [editing, setEditing] = useState<string | null>(null);

  const totals = fees.reduce(
    (acc, f) => {
      if (f.status === "DRAFT") acc.draft += f.payableInrMinor;
      if (f.status === "APPROVED") acc.approved += f.payableInrMinor;
      if (f.status === "PAID") acc.paid += f.payableInrMinor;
      return acc;
    },
    { draft: 0, approved: 0, paid: 0 },
  );

  async function recompute() {
    setBusyId("recompute");
    const res = await recomputeTutorFees();
    setBusyId(null);
    if (!res.ok) return toast(res.error);
    toast(res.summary ?? "Recomputed");
    startTransition(() => router.refresh());
  }

  async function move(id: string, to: TutorFeeStatus) {
    setBusyId(id);
    const res = await setTutorFeeStatus(id, to);
    setBusyId(null);
    if (!res.ok) return toast(res.error);
    toast(`Fee ${to.toLowerCase()}`);
    startTransition(() => router.refresh());
  }

  async function saveOverride(id: string, form: FormData) {
    setBusyId(id);
    const res = await setTutorFeeOverride(id, form);
    setBusyId(null);
    if (!res.ok) return toast(res.error);
    setEditing(null);
    toast("Override saved");
    startTransition(() => router.refresh());
  }

  return (
    <div className="space-y-5">
      <Hint>
        What each batch owes its trainer, computed from the rate bands and the batch&apos;s{" "}
        <strong>current headcount</strong>. Approving a fee <strong>freezes</strong> it — a
        student joining afterwards will not re-price work you have already signed off.
        {accrualOn ? (
          <> Approved fees also post <strong>Dr COGS / Cr Accounts payable</strong> to the ledger.</>
        ) : (
          <>
            {" "}Recording fees as money owed is <strong>off</strong>; approving records the decision without
            posting. Turn it on in Operations → Finance posting.
          </>
        )}
      </Hint>

      <Card>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap gap-5 text-sm">
            <Total label="Draft" value={totals.draft} />
            <Total label="Approved" value={totals.approved} />
            <Total label="Paid" value={totals.paid} />
          </div>
          <button
            type="button"
            onClick={recompute}
            disabled={busyId !== null || pending}
            className="rounded-field border border-line px-3 py-1.5 text-sm font-medium text-ink hover:bg-surface-2 disabled:opacity-50"
          >
            {busyId === "recompute" ? "Recomputing…" : "Recompute from rosters"}
          </button>
        </div>

        {fees.length === 0 ? (
          <p className="mt-4 text-sm text-ink-3">
            No tutor fees yet. Only German levels (A1 / A2 / B1) carry a trainer fee — coaching
            tiers are delivered by a salaried coach. Add a batch, then recompute.
          </p>
        ) : (
          <div className="mt-4 overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-caption uppercase text-ink-3">
                  <th className="py-2 pr-4 font-medium">Batch</th>
                  <th className="py-2 pr-4 font-medium">Trainer</th>
                  <th className="py-2 pr-4 font-medium">Band</th>
                  <th className="py-2 pr-4 text-right font-medium">Owed</th>
                  <th className="py-2 pr-4 font-medium">Status</th>
                  <th className="py-2 font-medium">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {fees.map((f) => (
                  <tr key={f.id} className="align-top">
                    <td className="py-2 pr-4">
                      <div className="font-medium text-ink">{f.batchCode ?? f.batchName}</div>
                      <div className="text-caption text-ink-3">{f.level}</div>
                    </td>
                    <td className="py-2 pr-4 text-ink-2">{f.trainerName ?? "— unassigned —"}</td>
                    <td className="py-2 pr-4 text-ink-2">
                      {f.headcount} × {inr(f.ratePerHeadInrMinor)}
                      {/* Only a DRAFT can be actionably out of date; a frozen row is
                          out of date BY DESIGN, and saying "stale" there would read as a fault. */}
                      {f.stale && (
                        <div className="text-caption text-warn-ink">
                          roster is now {f.currentHeadcount} — recompute
                        </div>
                      )}
                      {!f.stale && f.status !== "DRAFT" && f.currentHeadcount !== f.headcount && (
                        <div className="text-caption text-ink-3">
                          frozen at {f.headcount} (roster now {f.currentHeadcount})
                        </div>
                      )}
                      {/* The fee is priced off the ROSTER — that is the founders' rule and this
                          does not change it. It shows heads PRESENT beside heads enrolled because
                          the gap was previously invisible: the business paid per enrolment with
                          no record of attendance at all. Whether the basis should move is a
                          pricing decision, and this is the number for that conversation. */}
                      {f.attendedAverage !== null && (
                        <div
                          className={`text-caption ${f.attendedAverage < f.headcount ? "text-ink-2" : "text-ink-3"}`}
                          title={`Averaged over ${f.markedSessions} class${f.markedSessions === 1 ? "" : "es"} with a register taken`}
                        >
                          ~{f.attendedAverage} actually attending
                        </div>
                      )}
                    </td>
                    <td className="py-2 pr-4 text-right">
                      <div className="font-semibold text-ink">{inr(f.payableInrMinor)}</div>
                      {f.overrideAmountInrMinor !== null && (
                        <div className="text-caption text-ink-3">
                          overridden from {inr(f.amountInrMinor)}
                          {f.overrideReason ? ` — ${f.overrideReason}` : ""}
                        </div>
                      )}
                    </td>
                    <td className="py-2 pr-4">
                      <span className={`inline-block rounded-full px-2 py-0.5 text-caption font-medium ${STATUS_STYLE[f.status]}`}>
                        {f.statusLabel}
                      </span>
                      {f.postedEntryId && <div className="text-caption text-ink-3">recorded as owed</div>}
                    </td>
                    <td className="py-2">
                      <div className="flex flex-wrap gap-2">
                        {f.status === "DRAFT" && (
                          <>
                            <Act busy={busyId === f.id} onClick={() => move(f.id, "APPROVED")}>Approve</Act>
                            <Act busy={false} onClick={() => setEditing(editing === f.id ? null : f.id)}>
                              {editing === f.id ? "Cancel" : "Override"}
                            </Act>
                          </>
                        )}
                        {f.status === "APPROVED" && (
                          <Act busy={busyId === f.id} onClick={() => move(f.id, "PAID")}>Mark paid</Act>
                        )}
                        {(f.status === "DRAFT" || f.status === "APPROVED") && (
                          <Act busy={busyId === f.id} onClick={() => move(f.id, "CANCELLED")}>Cancel</Act>
                        )}
                      </div>

                      {editing === f.id && (
                        <form
                          action={(fd) => saveOverride(f.id, fd)}
                          className="mt-3 grid gap-2 rounded-field border border-line bg-surface-2 p-3 sm:grid-cols-[8rem_1fr_auto] sm:items-end"
                        >
                          <Field label="Amount (₹)">
                            <input
                              name="amountRupees"
                              inputMode="decimal"
                              defaultValue={Math.round(f.payableInrMinor / 100)}
                              className="w-full rounded-field border border-line bg-surface px-2 py-1 text-sm"
                            />
                          </Field>
                          {/* A reason is REQUIRED by the action, not optional: six months on,
                              an unexplained override is indistinguishable from a typo. */}
                          <Field label="Reason (required)">
                            <input
                              name="reason"
                              required
                              placeholder="Why this differs from the computed figure"
                              className="w-full rounded-field border border-line bg-surface px-2 py-1 text-sm"
                            />
                          </Field>
                          <button
                            type="submit"
                            className="rounded-field bg-accent px-3 py-1.5 text-sm font-medium text-on-accent"
                          >
                            Save
                          </button>
                        </form>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}

function Total({ label, value }: { label: string; value: number }) {
  return (
    <div>
      <div className="text-caption uppercase text-ink-3">{label}</div>
      <div className="font-semibold text-ink">{inr(value)}</div>
    </div>
  );
}

function Act({ children, onClick, busy }: { children: React.ReactNode; onClick: () => void; busy: boolean }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={busy}
      className="rounded-field border border-line px-2 py-1 text-caption font-medium text-ink hover:bg-surface-2 disabled:opacity-50"
    >
      {busy ? "…" : children}
    </button>
  );
}
