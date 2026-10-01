"use client";

import { useEffect, useRef, useState } from "react";
import { Plus, X } from "lucide-react";
import { Btn } from "@/components/ui/controls";
import { TextInput } from "@/components/ui/form";
import { DUE_DATE_SCHEME_LABELS, dueDateSeries, type DueDateScheme } from "@/lib/instalment-dates";

/**
 * The remaining due dates for an instalment plan, captured on the income entry itself.
 *
 * WHY IT LIVES HERE. Recording the first instalment and agreeing the schedule are one moment
 * in the founder's day, but they used to be two screens: the income form asked how many
 * instalments the fee was split into and then threw the answer away as a label, while the
 * actual schedule had to be rebuilt afterwards in the Pending section. Nothing chased a
 * student whose plan nobody went back to build, because a due date that was never written
 * down cannot raise a reminder.
 *
 * FILLED IN FOR YOU, BY DEFAULT. "How many instalments" already says how many dates there are,
 * and the date of this payment says where they start, so asking the operator to type four more
 * dates is asking them to repeat themselves. Tick-box on, and the dates follow one of the two
 * rules a plan is actually agreed on (lib/instalment-dates): the 1st of each month, or every 30
 * days. Untick it and the rows are yours - every box stays editable either way, because real
 * plans skip a month or land unevenly.
 *
 * The rows travel as ONE JSON field rather than repeated inputs named the same thing. The income
 * action parses with `Object.fromEntries(form)`, which keeps only the last value of a repeated
 * name, so `dueDate` × 3 would silently arrive as one date - the kind of bug that loses two
 * instalments and looks like it worked.
 */

export type ScheduleRow = { dueDate: string; amountInr: string; amountEur: string };

/** One month on, clamped so 31 Jan + 1 month is 28/29 Feb rather than spilling into March. */
function addMonth(iso: string): string {
  const d = new Date(`${iso}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) return "";
  const day = d.getUTCDate();
  d.setUTCDate(1);
  d.setUTCMonth(d.getUTCMonth() + 1);
  const lastDay = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate();
  d.setUTCDate(Math.min(day, lastDay));
  return d.toISOString().slice(0, 10);
}

const emptyRow = (): ScheduleRow => ({ dueDate: "", amountInr: "", amountEur: "" });

export function InstalmentSchedule({
  defaultRows,
  // How wide the block sits in its form's grid. The Finance page lays income out in four
  // columns, the Record modal in two, and the schedule has to span whichever it is in.
  className = "sm:col-span-2 lg:col-span-4",
  count,
  anchorDate,
  onCompleteChange,
}: {
  defaultRows?: ScheduleRow[];
  className?: string;
  /** "Number of instalments" as typed. The schedule needs `count - 1` rows. */
  count?: number | null;
  /** The date of the payment being recorded - where the series starts. */
  anchorDate?: string;
  /**
   * Told whenever "every row has a date" changes, so the form can hold its submit button closed.
   * A plan saved with a blank date silently drops that receivable, and nothing ever chases it.
   */
  onCompleteChange?: (complete: boolean) => void;
}) {
  const [rows, setRows] = useState<ScheduleRow[]>(
    defaultRows?.length ? defaultRows : [emptyRow()],
  );
  const [autoFill, setAutoFill] = useState(true);
  const [scheme, setScheme] = useState<DueDateScheme>("MONTH_FIRST");
  const boxRef = useRef<HTMLDivElement>(null);

  /**
   * Re-fill the dates whenever the plan's shape changes - the count, the payment date, or the
   * rule. Amounts already typed are kept: only the dates are ours to decide.
   *
   * Does nothing while the box is unticked, so a hand-built schedule is never overwritten, and
   * nothing while the count is still blank or 1 - there is no series to draw yet.
   */
  useEffect(() => {
    if (!autoFill) return;
    const dates = dueDateSeries(scheme, anchorDate ?? "", count ?? 0);
    if (dates.length === 0) return;
    setRows((cur) =>
      dates.map((dueDate, i) => ({
        dueDate,
        amountInr: cur[i]?.amountInr ?? "",
        amountEur: cur[i]?.amountEur ?? "",
      })),
    );
  }, [autoFill, scheme, anchorDate, count]);

  /**
   * Report completeness upward. A row with no date is the thing that must block the save; a row
   * with no amount is recoverable later from the plan itself, so it is not gated here.
   */
  const complete = rows.length > 0 && rows.every((r) => r.dueDate.trim() !== "");
  useEffect(() => {
    onCompleteChange?.(complete);
  }, [complete, onCompleteChange]);

  /** Read a sibling field by name - the income date and the amount just received seed row 1. */
  const sibling = (name: string): string => {
    const form = boxRef.current?.closest("form");
    const el = form?.elements.namedItem(name);
    return el instanceof HTMLInputElement ? el.value : "";
  };

  const addRow = () => {
    setAutoFill(false);
    setRows((cur) => {
      const last = cur[cur.length - 1];
      const seedDate = last?.dueDate || sibling("date");
      return [
        ...cur,
        {
          dueDate: seedDate ? addMonth(seedDate) : "",
          amountInr: last?.amountInr || sibling("amountInr"),
          amountEur: last?.amountEur || sibling("amountEur"),
        },
      ];
    });
  };

  const setRow = (i: number, patch: Partial<ScheduleRow>) => {
    // Editing a DATE by hand means the operator has taken over; leaving autofill on would
    // overwrite their entry the next time the count or the payment date changed.
    if (patch.dueDate !== undefined) setAutoFill(false);
    setRows((cur) => cur.map((r, n) => (n === i ? { ...r, ...patch } : r)));
  };

  // The last row is never removable: an instalment plan with no remaining due date is what this
  // field exists to prevent, and "clear the boxes" already expresses "no schedule yet".
  const removeRow = (i: number) => {
    setAutoFill(false);
    setRows((cur) => (cur.length === 1 ? cur : cur.filter((_, n) => n !== i)));
  };

  return (
    <div ref={boxRef} className={className}>
      <p className="text-label uppercase text-ink-3">Upcoming due dates</p>
      <p className="mt-1 text-caption text-muted">
        When the rest of the fee is due. Each date becomes a receivable that is chased on its own -
        you are reminded to follow up 10 days before it, or from the start of the month it falls in,
        whichever comes first.
      </p>

      {/* ── Fill them in for me ───────────────────────────────────────────────────────
          The rule sits beside the tick-box rather than behind a second screen: which of the two
          it is changes every date below, so it has to be visible while you read them. */}
      <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-2">
        <label className="flex items-center gap-2 text-caption">
          <input
            type="checkbox"
            checked={autoFill}
            onChange={(e) => setAutoFill(e.currentTarget.checked)}
            className="h-4 w-4 rounded border-line"
          />
          <span className="font-medium text-ink">Fill the dates in for me</span>
        </label>
        <div className="flex items-center gap-1" role="group" aria-label="How the dates are spaced">
          {(Object.keys(DUE_DATE_SCHEME_LABELS) as DueDateScheme[]).map((k) => (
            <button
              key={k}
              type="button"
              aria-pressed={scheme === k}
              onClick={() => { setScheme(k); setAutoFill(true); }}
              className={`rounded-full border px-2.5 py-1 text-caption font-medium transition-colors ${
                scheme === k && autoFill
                  ? "border-primary bg-primary-soft text-primary-strong"
                  : "border-line text-muted hover:bg-surface-2 hover:text-ink"
              }`}
            >
              {DUE_DATE_SCHEME_LABELS[k]}
            </button>
          ))}
        </div>
        {autoFill && !count && (
          <span className="text-caption text-muted">Set the number of instalments above and the dates appear.</span>
        )}
      </div>

      <div className="mt-2 space-y-2">
        {rows.map((r, i) => (
          <div key={i} className="flex flex-wrap items-center gap-2">
            <span className="w-6 flex-none text-caption tnum text-muted">{i + 1}.</span>
            <TextInput
              type="date"
              aria-label={`Due date for instalment ${i + 2}`}
              className="min-w-[9rem] flex-1"
              value={r.dueDate}
              onChange={(e) => setRow(i, { dueDate: e.currentTarget.value })}
            />
            <TextInput
              kind="money"
              aria-label={`Amount due in rupees for instalment ${i + 2}`}
              placeholder="₹ amount"
              className="min-w-[7rem] flex-1"
              value={r.amountInr}
              onChange={(e) => setRow(i, { amountInr: e.currentTarget.value })}
            />
            <TextInput
              kind="money"
              aria-label={`Amount due in euros for instalment ${i + 2}`}
              placeholder="€ amount"
              className="min-w-[7rem] flex-1"
              value={r.amountEur}
              onChange={(e) => setRow(i, { amountEur: e.currentTarget.value })}
            />
            <button
              type="button"
              onClick={() => removeRow(i)}
              disabled={rows.length === 1}
              aria-label={`Remove due date ${i + 1}`}
              title={rows.length === 1 ? "A plan needs at least one date" : "Remove this due date"}
              className="press grid h-8 w-8 flex-none place-items-center rounded-btn text-muted transition-colors hover:text-risk disabled:cursor-not-allowed disabled:opacity-40"
            >
              <X size={15} />
            </button>
          </div>
        ))}
      </div>

      <Btn variant="ghost" size="sm" type="button" onClick={addRow} className="mt-2">
        <Plus size={14} /> Add due date
      </Btn>

      {/* The whole schedule, as the action reads it. */}
      <input type="hidden" name="instalmentSchedule" value={JSON.stringify(rows)} />
    </div>
  );
}
