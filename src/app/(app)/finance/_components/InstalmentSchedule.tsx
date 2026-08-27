"use client";

import { useRef, useState } from "react";
import { Plus, X } from "lucide-react";
import { Btn } from "@/components/ui/controls";
import { TextInput } from "@/components/ui/form";

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
 * ONE ROW TO START, `+` FOR THE REST. A plan is usually agreed one date at a time, so the form
 * opens with a single row rather than N empty ones, and each `+` seeds the next date a month
 * after the last and the amount from the last row. Those are starting points, not rules - every
 * box is editable, because real plans skip a month or land unevenly.
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

export function InstalmentSchedule({ defaultRows }: { defaultRows?: ScheduleRow[] }) {
  const [rows, setRows] = useState<ScheduleRow[]>(
    defaultRows?.length ? defaultRows : [emptyRow()],
  );
  const boxRef = useRef<HTMLDivElement>(null);

  /** Read a sibling field by name - the income date and the amount just received seed row 1. */
  const sibling = (name: string): string => {
    const form = boxRef.current?.closest("form");
    const el = form?.elements.namedItem(name);
    return el instanceof HTMLInputElement ? el.value : "";
  };

  const addRow = () => {
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

  const setRow = (i: number, patch: Partial<ScheduleRow>) =>
    setRows((cur) => cur.map((r, n) => (n === i ? { ...r, ...patch } : r)));

  // The last row is never removable: an instalment plan with no remaining due date is what this
  // field exists to prevent, and "clear the boxes" already expresses "no schedule yet".
  const removeRow = (i: number) =>
    setRows((cur) => (cur.length === 1 ? cur : cur.filter((_, n) => n !== i)));

  return (
    <div ref={boxRef} className="sm:col-span-2 lg:col-span-4">
      <p className="text-label uppercase text-ink-3">Upcoming due dates</p>
      <p className="mt-1 text-caption text-muted">
        When the rest of the fee is due. Each date becomes a receivable that is chased on its own -
        you are reminded to follow up 10 days before it, or from the start of the month it falls in,
        whichever comes first.
      </p>

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
