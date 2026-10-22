"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Pencil, Trash2 } from "lucide-react";
import { correctSprintEntry } from "@/server/sprint-log-actions";
import type { CoachFeedRow } from "@/server/sprint-log";
import { Btn } from "@/components/ui/controls";
import { Card, Chip, Pill, TableShell, Td, Th, Tr } from "@/components/ui/kit";
import { toast, askConfirm } from "@/components/ui/feedback";
import { formatDate } from "@/lib/format";

/**
 * THE CORRECTION SURFACE.
 *
 * The founders chose "score at once, coach can correct", and this screen is the half that makes
 * that defensible. Without somewhere a coach actually SEES new entries, "can correct" would be
 * a permission nobody ever exercises, and immediate scoring would be scoring on trust alone.
 *
 * It shows everything, not just what looks suspicious. There is no way to tell an over-claim
 * from a true entry by looking at the row - that is exactly why a human reads it - and
 * filtering to "unusual" ones would hide the realistic failure, which is nine connections
 * instead of two rather than anything wild.
 *
 * Both actions take points off a named person on a board their cohort can see, so both are
 * confirmed and both are logged with the previous value.
 */
export function CoachReviewFeed({ entries }: { entries: CoachFeedRow[] }) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);

  const run = async (
    id: string,
    payload: { entryId: string; quantity?: number; reason?: string },
    okText: string,
  ) => {
    setBusy(id);
    const res = await correctSprintEntry(payload);
    setBusy(null);
    if (!res.ok) {
      toast(res.error, "error");
      return;
    }
    toast(okText, "success");
    router.refresh();
  };

  const reduce = async (row: CoachFeedRow) => {
    const next = window.prompt(
      `How many should this be? (currently ${row.quantity})`,
      String(row.quantity),
    );
    if (next === null) return;
    const n = Number(next);
    if (!Number.isFinite(n) || n < 1 || n > 500) {
      toast("Give a number between 1 and 500.", "error");
      return;
    }
    if (n === row.quantity) return;
    await run(row.id, { entryId: row.id, quantity: n }, `Corrected to ${n}.`);
  };

  const remove = async (row: CoachFeedRow) => {
    const ok = await askConfirm({
      title: `Remove this entry from ${row.studentName}?`,
      body: `It is worth ${(row.pointsEach * row.quantity).toLocaleString("en-IN")} points and will come off the board. The removal is recorded in the activity log.`,
      confirmLabel: "Remove",
      danger: true,
    });
    if (!ok) return;
    await run(row.id, { entryId: row.id }, "Removed.");
  };

  return (
    <Card
      flush
      title="Self-reported, recently"
      subtitle="These scored the moment they were logged. Correct or remove anything that is wrong."
    >
      <TableShell
        head={
          <>
            <Th>Student</Th>
            <Th>What</Th>
            <Th>When</Th>
            <Th align="right">Worth</Th>
            <Th align="right">Fix</Th>
          </>
        }
      >
          {entries.map((e) => (
            <Tr key={e.id}>
              <Td>
                <span className="font-medium text-ink">{e.studentName}</span>
                {e.studentCode && (
                  <span className="ml-1.5 text-caption tabular-nums text-muted">{e.studentCode}</span>
                )}
              </Td>
              <Td>
                <span className="text-ink">
                  {e.kindLabel}
                  {e.quantity > 1 && <span className="ml-1 font-semibold">× {e.quantity}</span>}
                </span>
                {(e.company || e.note) && (
                  <span className="block text-caption text-muted">
                    {[e.company, e.note].filter(Boolean).join(" · ")}
                  </span>
                )}
                {/* Who wrote it. A coach's own entry is not more TRUE than a student's, but it
                    is different evidence and worth saying. */}
                {e.source === "COACH" && (
                  <Pill tone="info">Entered by {e.loggedByName ?? "a coach"}</Pill>
                )}
              </Td>
              <Td>{formatDate(e.occurredOnYmd)}</Td>
              <Td align="right">
                <Chip>+{(e.pointsEach * e.quantity).toLocaleString("en-IN")}</Chip>
              </Td>
              <Td align="right">
                <span className="flex justify-end gap-1">
                  {e.quantity > 1 && (
                    <Btn
                      size="sm"
                      variant="ghost"
                      icon={<Pencil size={13} />}
                      busy={busy === e.id}
                      onClick={() => reduce(e)}
                      title="Change the quantity"
                    >
                      Edit
                    </Btn>
                  )}
                  <Btn
                    size="sm"
                    variant="ghost"
                    icon={<Trash2 size={13} />}
                    busy={busy === e.id}
                    onClick={() => remove(e)}
                    title="Remove this entry"
                  >
                    Remove
                  </Btn>
                </span>
              </Td>
            </Tr>
          ))}
      </TableShell>
    </Card>
  );
}
