"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { UserPlus } from "lucide-react";
import { Field } from "@/components/ui/form";
import { toast } from "@/components/ui/feedback";
import { Btn } from "@/components/ui/controls";
import { SelectMenu } from "@/components/ui/SelectMenu";
import { assignLeadBatch } from "@/server/pipeline-actions";

/**
 * Hand a day's calling to someone.
 *
 * THE PROBLEM IT SOLVES: on 29 Jul 2026, 23,430 of the 23,435 leads in this database had no
 * owner, and My Desk scopes its queue to `assignedToId`. Nilofer's desk held 3 leads; Asma's
 * held 2. Every other part of the loop worked — the desk branches correctly by variant, the
 * queue is bounded and ordered, logging a call already stamps `contactedAt` — and none of it
 * could matter, because assignment was a per-row dropdown and nobody was going to use it 23,000
 * times.
 *
 * Two choices worth keeping:
 *   · **Newest first by default.** 12,904 of the backlog are untouched `NEW_LEAD` rows and 8,095
 *     are already `LOST`. A lead from yesterday is worth calling; one from March is archaeology.
 *   · **A day at a time, capped.** Handing someone all 23,430 would be one click and would
 *     destroy the queue's meaning. The server refuses more than 200 regardless of what is sent.
 */

const SIZES = [10, 25, 50, 100, 200] as const;

export function HandOutLeads({
  assignees,
  available,
}: {
  /** Same list the per-row assignee picker uses; the leading "unassigned" entry is dropped. */
  assignees: { value: string; label: string }[];
  available: number;
}) {
  const router = useRouter();
  const people = assignees.filter((a) => a.value);
  const [userId, setUserId] = useState(people[0]?.value ?? "");
  const [count, setCount] = useState<string>("50");
  const [order, setOrder] = useState<"newest" | "oldest">("newest");
  const [busy, setBusy] = useState(false);

  if (!people.length) return null;

  const n = Number(count);
  const willAssign = Math.min(n, available);

  async function handOut() {
    setBusy(true);
    const res = await assignLeadBatch({ userId, count: n, oldestFirst: order === "oldest" });
    setBusy(false);
    if (!res.ok) return toast(res.error, "error");
    const who = people.find((p) => p.value === userId)?.label ?? "them";
    toast(`Handed ${res.assigned} lead${res.assigned === 1 ? "" : "s"} to ${who}`);
    router.refresh();
  }

  return (
    <div className="rounded-card border border-line bg-surface p-5 shadow-card">
      <div className="flex items-start gap-3">
        <span className="mt-0.5 grid h-9 w-9 flex-none place-items-center rounded-field bg-primary-soft text-primary">
          <UserPlus size={17} />
        </span>
        <div className="min-w-0 flex-1">
          <h3 className="text-h3 text-ink">Hand out leads</h3>
          <p className="mt-0.5 text-sm text-ink-2">
            {available === 0 ? (
              "Every callable lead already has an owner."
            ) : (
              <>
                <strong className="tnum text-ink">{available.toLocaleString("en-IN")}</strong> unassigned
                lead{available === 1 ? "" : "s"} with a phone number and an open stage. Give someone a
                day&apos;s worth — not the whole pile.
              </>
            )}
          </p>

          {available > 0 && (
            <>
              <div className="mt-4 grid gap-4 sm:grid-cols-3">
                <Field label="To">
                  <SelectMenu
                    aria-label="Assign leads to"
                    value={userId}
                    onChange={(e) => setUserId(e.target.value)}
                    options={people}
                  />
                </Field>
                <Field label="How many">
                  <SelectMenu
                    aria-label="How many leads"
                    value={count}
                    onChange={(e) => setCount(e.target.value)}
                    options={SIZES.map((s) => ({ value: String(s), label: String(s) }))}
                  />
                </Field>
                <Field label="Which ones" hint="Newest convert best.">
                  <SelectMenu
                    aria-label="Which leads"
                    value={order}
                    onChange={(e) => setOrder(e.target.value as "newest" | "oldest")}
                    options={[
                      { value: "newest", label: "Newest first" },
                      { value: "oldest", label: "Oldest first (clear the backlog)" },
                    ]}
                  />
                </Field>
              </div>

              <div className="mt-4 flex items-center gap-3">
                <Btn onClick={handOut} disabled={busy || !userId}>
                  {busy ? "Assigning…" : `Hand out ${willAssign}`}
                </Btn>
                {n > available && (
                  <span className="text-sm text-ink-3">Only {available} left to give.</span>
                )}
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
