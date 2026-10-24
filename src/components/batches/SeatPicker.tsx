"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Search, UserPlus, Users } from "lucide-react";
import { Modal } from "@/components/ui/Modal";
import { Btn } from "@/components/ui/controls";
import { Pill } from "@/components/ui/kit";
import { askConfirm, toast } from "@/components/ui/feedback";
import { safeAction } from "@/lib/action-guard";
import { addSeats } from "@/server/batch-seats";
import { capacityBand, type SeatCandidate } from "@/lib/batch";

/**
 * ADD LEARNERS TO A COHORT, FROM THE COHORT.
 *
 * The control the cohort screen never had. Seating a B2 client used to be possible from exactly
 * one place - a dropdown on each student's own record, one enrolment at a time - so filling a
 * twelve-seat cohort meant twelve separate page loads, and the cohort's own Roster tab was
 * read-only and pointed at a board that has no such control. German Note had a second, unrelated
 * screen for the same job.
 *
 * One control now serves both lines, because `addSeats` dispatches on `Batch.line` to the
 * existing tested action for that mechanism (see server/batch-seats.ts). Nothing about capacity,
 * the over-capacity prompt, the level/line guard or the enrolment welcome changes.
 *
 * ── Multi-select, and why the result is reported per person ─────────────────────────────
 * Seating is a loop over independent writes rather than one transaction, so it can PARTIALLY
 * succeed - eight of ten land and two are refused because somebody else seated them a second
 * earlier, or a level does not fit the line. Reporting "8 seated, 2 could not be" with the
 * reasons is strictly more useful than rolling back eight good writes, so that is what this
 * shows rather than a bare success toast.
 */
export function SeatPicker({
  batchId,
  batchName,
  candidates,
  filled,
  targetStrength,
  mechanismLabel,
}: {
  batchId: string;
  batchName: string;
  candidates: SeatCandidate[];
  filled: number;
  targetStrength: number;
  /** "learners" / "students" - what this line calls the people in a cohort. */
  mechanismLabel: string;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);

  const matches = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return candidates;
    return candidates.filter(
      (c) =>
        c.name.toLowerCase().includes(q) ||
        (c.code ?? "").toLowerCase().includes(q) ||
        (c.programLevel ?? "").toLowerCase().includes(q),
    );
  }, [candidates, query]);

  const toggle = (id: string) => {
    setPicked((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const close = () => {
    setOpen(false);
    setQuery("");
    setPicked(new Set());
  };

  /**
   * `confirmed` is the over-capacity re-submit. The founders overfill on purpose when a ninth
   * person turns up and the next cohort is a month away, so going past target is a question
   * naming the real numbers, never a refusal - the same contract `seatEnrollment` already has.
   */
  const submit = async (confirmed = false): Promise<void> => {
    const ids = [...picked];
    if (ids.length === 0) return;
    setBusy(true);
    const res = await safeAction(() => addSeats(batchId, ids, confirmed));
    setBusy(false);

    if (!res.ok) {
      if (res.error.startsWith("OVER_CAPACITY:")) {
        const [, now, target] = res.error.split(":");
        const ok = await askConfirm({
          title: "That cohort is over its target size",
          body: `${batchName} already holds ${now} of a target ${target}. Seat ${ids.length === 1 ? "this person" : `these ${ids.length}`} anyway?`,
          confirmLabel: "Seat anyway",
        });
        if (ok) await submit(true);
        return;
      }
      toast(res.error, "error");
      return;
    }

    const seated = res.seated ?? ids.length;
    const failed = res.failures?.length ?? 0;
    toast(
      failed === 0
        ? `${seated} ${seated === 1 ? "person" : "people"} seated - the enrolment welcome goes out if it is armed`
        : `${seated} seated. ${failed} could not be: ${res.failures?.[0]?.error ?? ""}`,
      failed === 0 ? "success" : "error",
    );
    close();
    router.refresh();
  };

  const after = filled + picked.size;
  const band = capacityBand(after, targetStrength);

  return (
    <>
      <Btn variant="primary" size="sm" icon={<UserPlus size={15} />} onClick={() => setOpen(true)}>
        Add {mechanismLabel}
      </Btn>

      <Modal
        open={open}
        onClose={close}
        title={`Add ${mechanismLabel} to ${batchName}`}
        subtitle={
          candidates.length === 0
            ? undefined
            : `${filled} of ${targetStrength} seats taken. Pick as many as you like.`
        }
        size="md"
      >
        {candidates.length === 0 ? (
          /*
            An honest empty state, and the two lines mean different things - so it says which.
            On B2 there is genuinely nobody to seat until an enrolment exists, which is itself a
            step on the onboarding journey; on German Note every student is already a member.
          */
          <div className="rounded-field border border-dashed border-primary-tint bg-sky px-5 py-8 text-center">
            <Users size={20} className="mx-auto mb-2 text-primary-strong" aria-hidden />
            <p className="font-display text-h3 text-ink">Nobody available to add</p>
            <p className="mt-1 text-sm text-ink-2">
              {mechanismLabel === "learners"
                ? "Everyone with a matching programme is already in a cohort. Enrol someone first, then come back."
                : "Every student is already a member of this cohort."}
            </p>
          </div>
        ) : (
          <div className="space-y-3">
            <label className="relative block">
              <span className="sr-only">Search by name, student number or programme</span>
              <Search
                size={15}
                aria-hidden
                className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted"
              />
              <input
                type="search"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search by name, number or programme"
                className="w-full rounded-field border border-line bg-surface py-2 pl-9 pr-3 text-body text-ink placeholder:text-muted focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary-tint"
              />
            </label>

            <div className="max-h-[22rem] overflow-y-auto rounded-field border border-line">
              {matches.length === 0 ? (
                <p className="px-4 py-6 text-center text-sm text-muted">
                  Nobody matches &ldquo;{query}&rdquo;.
                </p>
              ) : (
                <ul>
                  {matches.map((c) => {
                    const on = picked.has(c.id);
                    return (
                      <li key={c.id} className="border-b border-line last:border-0">
                        <label className="flex cursor-pointer items-center gap-3 px-3 py-2.5 hover:bg-surface-2">
                          <input
                            type="checkbox"
                            checked={on}
                            onChange={() => toggle(c.id)}
                            className="size-4 flex-none accent-primary"
                          />
                          <span className="min-w-0 flex-1">
                            <span className="block truncate text-body font-medium text-ink">{c.name}</span>
                            {(c.code || c.programLevel) && (
                              <span className="block truncate text-caption text-muted">
                                {[c.code, c.programLevel].filter(Boolean).join(" · ")}
                              </span>
                            )}
                          </span>
                        </label>
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>

            <div className="flex items-center justify-between gap-3">
              <p className="text-caption text-muted">
                {picked.size === 0 ? (
                  "Nobody picked yet"
                ) : (
                  <>
                    {picked.size} picked ·{" "}
                    <Pill tone={band === "over" ? "warn" : band === "full" ? "good" : "neutral"}>
                      {after} / {targetStrength} after
                    </Pill>
                  </>
                )}
              </p>
              <div className="flex gap-2">
                <Btn onClick={close}>Cancel</Btn>
                <Btn
                  variant="primary"
                  onClick={() => void submit()}
                  disabled={picked.size === 0}
                  busy={busy}
                >
                  {picked.size <= 1 ? "Add to cohort" : `Add ${picked.size} to cohort`}
                </Btn>
              </div>
            </div>
          </div>
        )}
      </Modal>
    </>
  );
}
