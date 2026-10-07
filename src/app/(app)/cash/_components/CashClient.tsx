"use client";

import { useRef, useState } from "react";
import { deletePayable, saveCashPosition, savePayable, setGrowthOverride } from "@/server/cash-actions";
import type { CashOverview, PayableRow } from "@/server/cash-metrics";
import { DataTable, type Column } from "@/components/ui/DataTable";
import { askConfirm, toast } from "@/components/ui/feedback";
import { Card, Pill } from "@/components/ui/kit";
import { Btn } from "@/components/ui/controls";
import { CheckboxField, Field, FormError, Select, SubmitButton, TextArea, TextInput } from "@/components/ui/form";
import { MoneyInput } from "@/components/ui/MoneyInput";
import { AmountPair } from "@/components/ui/AmountPair";
import { formatDate, formatEurMinor, formatInrMinor } from "@/lib/format";
import { EXPENSE_CATEGORY_LABELS, optionsFrom } from "@/lib/labels";
import { safeAction } from "@/lib/action-guard";
import { useUnsavedGuard } from "@/components/ui/use-unsaved-guard";

const FREQ_LABELS: Record<string, string> = {
  MONTHLY: "Monthly", QUARTERLY: "Quarterly", ANNUAL: "Annual", ONE_TIME: "One-time",
};
const PAYABLE_STATUS_LABELS: Record<string, string> = {
  ACTIVE: "Active", PAUSED: "Paused", CANCELLED: "Cancelled",
};

/**
 * A stored minor-unit figure, as the text its box should open on.
 *
 * Zero becomes EMPTY rather than "0.00". With the price now a ₹/€ pair, one side of it is
 * routinely zero, and a euro payable that re-opened showing "₹0.00" beside its real euro figure
 * would read as a bill in both currencies - and would be saved back as one.
 */
const minorToInput = (raw: string) => {
  const v = BigInt(raw);
  return v === BigInt(0) ? "" : (Number(v) / 100).toFixed(2);
};

/**
 * The weekly cash-position entry, as its own card.
 *
 * ── Why it sits under the KPI strip rather than in a tab ──────────────────────────
 * "Cash in Hand" is the first number on this page and the one everything else is built from -
 * runway, break-even, the badge in the top bar. When it goes stale it says so, in amber, right
 * there in the strip. The only thing that fixes it was three screens down, inside a tab, behind a
 * click nobody makes until they already know what they are looking for. A warning whose remedy is
 * hidden is a warning that gets lived with.
 *
 * So the form now follows the number it corrects. Its history stays in the tab below
 * (`CashPositionHistory`), because past entries are reference and reference is what tabs are for.
 */
export function CashPositionForm({ today, stale }: { today: string; stale: boolean }) {
  const [error, setError] = useState<string | null>(null);
  const formRef = useRef<HTMLFormElement>(null);
  // A balance typed and not saved is as lost to a refresh as a finance entry is.
  useUnsavedGuard(formRef);

  return (
    <Card
      title="Weekly cash position (every Monday)"
      actions={stale ? <Pill tone="warn">⚠ Last entry is more than 7 days old</Pill> : undefined}
    >
      <form
        ref={formRef}
        action={async (form) => {
          setError(null);
          const res = await safeAction(() => saveCashPosition(form));
          if (!res.ok) return setError(res.error);
          toast("Cash position saved");
          // Clears the boxes AND disarms the unsaved guard, which listens for this very event.
          formRef.current?.reset();
        }}
      >
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <Field label="Date of entry">
            <TextInput type="date" name="date" required defaultValue={today} />
          </Field>
          <Field label="Business bank balance (₹)">
            <MoneyInput currency="INR" name="bankBalance" required />
          </Field>
          <Field label="Personal savings (₹, optional)" hint="Planning only - never counted in runway">
            <MoneyInput currency="INR" name="personalSavings" />
          </Field>
          <Field label="Notes">
            <TextInput kind="text" name="notes" placeholder="Large payment made / expected…" />
          </Field>
        </div>
        <div className="mt-4 flex items-center gap-3">
          <SubmitButton>Save position</SubmitButton>
          <FormError message={error} />
        </div>
      </form>
    </Card>
  );
}

/** Every cash position recorded so far - the "Cash position" tab, now that the form has moved up. */
export function CashPositionHistory({ positions }: { positions: CashOverview["positions"] }) {
  const columns: Column<CashOverview["positions"][number]>[] = [
    { key: "date", header: "Date", cell: (r) => formatDate(r.date), value: (r) => r.date.slice(0, 10) },
    {
      key: "balance", header: "Cash in Hand", align: "right",
      cell: (r) => formatInrMinor(r.balanceInr), value: (r) => r.balanceInr / 100,
    },
    {
      key: "savings", header: "Personal savings (planning only)", align: "right",
      cell: (r) => (r.personalSavingsInr === null ? "-" : formatInrMinor(r.personalSavingsInr)),
      value: (r) => (r.personalSavingsInr ?? 0) / 100,
    },
    { key: "notes", header: "Notes", cell: (r) => r.notes ?? "", value: (r) => r.notes ?? "" },
  ];

  return (
    <DataTable
      rows={positions}
      columns={columns}
      csvName="cash-positions"
      // "above" was true when the form sat directly over this table; it is at the top of the
      // page now, and a pointer to somewhere the reader cannot see is worse than no pointer.
      emptyMessage="No entries yet - record the first Monday balance at the top of this page."
    />
  );
}

/**
 * Frequency + the due date that only some frequencies have (Error Log H3).
 *
 * A ONE-TIME payable has no NEXT due date - there is no next one. The field was shown and
 * required-looking regardless, so a one-off invoice could not be recorded without inventing a
 * recurrence date that then drove the "due this month" figures.
 *
 * The input is REMOVED, not merely disabled, when the frequency is one-time: an absent field
 * submits nothing, and `savePayable` already maps a missing/blank value to `null`, so the
 * stored row correctly carries no schedule. A stale date from before the switch cannot survive
 * either, because the element carrying it no longer exists.
 */
function PayableSchedule({
  defaultFrequency,
  defaultDueDate,
}: {
  defaultFrequency: string;
  defaultDueDate: string;
}) {
  const [frequency, setFrequency] = useState(defaultFrequency);
  const oneTime = frequency === "ONE_TIME";

  return (
    <>
      <Field label="Frequency">
        <Select
          name="frequency"
          options={optionsFrom(FREQ_LABELS)}
          value={frequency}
          onChange={(e) => setFrequency(e.currentTarget.value)}
        />
      </Field>
      {/* Distinct keys: without them React reconciles these two inputs as the SAME element
          (same type, same position) and the switch flips it controlled↔uncontrolled, which it
          warns about. Keyed, each branch mounts fresh - which is also what guarantees the
          placeholder carries no stale date. */}
      {oneTime ? (
        <Field key="one-time" label="Next due date" hint="Not scheduled - a one-time payable recurs only once.">
          <TextInput type="date" disabled defaultValue="" />
        </Field>
      ) : (
        <Field key="recurring" label="Next due date">
          <TextInput type="date" name="nextDueDate" defaultValue={defaultDueDate} />
        </Field>
      )}
    </>
  );
}

/**
 * Payables list + form (PRD3 §4.3).
 *
 * ── The price is now a ₹/€ pair ───────────────────────────────────────────────────
 * It was a single rupee box, which made a euro bill - a tool billed from Europe, a German Note
 * cost - unenterable as what it is: you converted it in your head, typed rupees, and the record
 * then claimed a rupee price had been agreed. Every other money form in the app offers both
 * sides with the live rate between them, and `payable` now stores both with the rate stamped on
 * the row (see the migration), so this one can too.
 *
 * THE TABLE SHOWS WHAT WAS AGREED, not a conversion. A payable entered in euro reads in euro,
 * with the rupee equivalent beneath it; a rupee one reads in rupees. The totals above and around
 * it stay in rupees, because every other figure on Cash Health does - the cash position and the
 * runway it drives are rupee-only columns, and a page where half the numbers answered a toggle
 * the other half ignored would be worse than one that is honestly single-currency.
 */
export function PayablesSection({
  payables,
  fxRate,
  fxStale,
  fxDate,
}: {
  payables: PayableRow[];
  /** INR per EUR, as the server will stamp it - so the preview matches what gets saved. */
  fxRate: number;
  fxStale?: boolean;
  fxDate?: string;
}) {
  const [editing, setEditing] = useState<PayableRow | null>(null);
  const [adding, setAdding] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const showForm = adding || editing;

  const columns: Column<PayableRow>[] = [
    { key: "name", header: "Payable", cell: (r) => r.name, value: (r) => r.name },
    { key: "category", header: "Category", cell: (r) => EXPENSE_CATEGORY_LABELS[r.category], value: (r) => r.category },
    {
      key: "amount", header: "Price", align: "right",
      // The side that was typed leads; the other sits beneath, muted. `amountInr` is the
      // aggregate, so sorting puts a €300 bill in its true place among the rupee ones.
      cell: (r) => {
        const euroQuoted = BigInt(r.amountEurRaw) > 0n && BigInt(r.amountInrRaw) === 0n;
        return (
          <span className="whitespace-nowrap">
            <span className="tnum">{euroQuoted ? formatEurMinor(r.amountEur) : formatInrMinor(r.amountInr)}</span>
            <span className="block text-caption text-muted">
              {euroQuoted ? formatInrMinor(r.amountInr) : formatEurMinor(r.amountEur)}
            </span>
          </span>
        );
      },
      value: (r) => r.amountInr / 100,
    },
    { key: "freq", header: "Frequency", cell: (r) => FREQ_LABELS[r.frequency], value: (r) => r.frequency },
    { key: "due", header: "Next due", cell: (r) => (r.nextDueDate ? formatDate(r.nextDueDate) : "-"), value: (r) => r.nextDueDate?.slice(0, 10) ?? "" },
    { key: "cogs", header: "COGS", cell: (r) => (r.isCogs ? "Yes" : "No"), value: (r) => (r.isCogs ? "Yes" : "No") },
    { key: "status", header: "Status", cell: (r) => PAYABLE_STATUS_LABELS[r.status], value: (r) => r.status },
    {
      key: "actions", header: "", sortable: false,
      cell: (r) => (
        <span className="flex gap-2 whitespace-nowrap">
          <Btn variant="ghost" size="sm" onClick={() => { setEditing(r); setAdding(false); }}>Edit</Btn>
          <Btn
            variant="danger"
            size="sm"
            onClick={async () => {
              const ok = await askConfirm({ title: `Delete payable ${r.name}?`, confirmLabel: "Delete", danger: true });
              if (ok) {
                await deletePayable(r.id);
                toast("Payable deleted");
              }
            }}
          >
            Delete
          </Btn>
        </span>
      ),
      value: () => null,
    },
  ];

  return (
    <section className="space-y-4">
      <div className="flex justify-end">
        <Btn variant="soft" onClick={() => { setAdding((v) => !v); setEditing(null); }}>
          {showForm ? "Close" : "Add payable"}
        </Btn>
      </div>
      {showForm && (
        <Card title={editing ? `Edit - ${editing.name}` : "New payable"}>
        <form
          action={async (form) => {
            setError(null);
            const res = await safeAction(() => savePayable(editing?.id ?? null, form));
            if (!res.ok) return setError(res.error);
            toast(editing ? "Payable updated" : "Payable added");
            setEditing(null);
            setAdding(false);
          }}
          key={editing?.id ?? "new"}
        >
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {/* Free text, not kind="name": "WATI subscription" / "Karthick salary" are labels, not people. */}
            <Field label="Payable name" hint="e.g. WATI subscription, Karthick salary">
              <TextInput kind="text" name="name" required defaultValue={editing?.name ?? ""} />
            </Field>
            <Field label="Category">
              <Select name="category" options={optionsFrom(EXPENSE_CATEGORY_LABELS)} defaultValue={editing?.category ?? "TOOLS_SOFTWARE"} />
            </Field>
            <AmountPair
              fxRate={fxRate}
              fxStale={fxStale}
              fxDate={fxDate}
              inrName="amountInr"
              eurName="amountEur"
              inrLabel="Price (₹)"
              eurLabel="Price (€)"
              baseHint="INR, EUR, or both"
              defaultInr={editing ? minorToInput(editing.amountInrRaw) : ""}
              defaultEur={editing ? minorToInput(editing.amountEurRaw) : ""}
            />
            {/* Keyed so switching which payable is being edited resets the schedule state
                along with the rest of the form, rather than carrying the last one's frequency. */}
            <PayableSchedule
              key={editing?.id ?? "new"}
              defaultFrequency={editing?.frequency ?? "MONTHLY"}
              defaultDueDate={editing?.nextDueDate?.slice(0, 10) ?? ""}
            />
            <Field label="Status">
              <Select name="status" options={optionsFrom(PAYABLE_STATUS_LABELS)} defaultValue={editing?.status ?? "ACTIVE"} />
            </Field>
            <div className="flex items-end pb-1">
              <CheckboxField name="isCogs" label="Is this COGS?" defaultChecked={editing?.isCogs ?? false} />
            </div>
          </div>
          <div className="mt-4 flex items-center gap-3">
            <SubmitButton>{editing ? "Save payable" : "Add payable"}</SubmitButton>
            <FormError message={error} />
          </div>
        </form>
        </Card>
      )}
      <DataTable
        rows={payables}
        columns={columns}
        csvName="payables"
        rowClassName={(r) => (r.dueSoonUnderfunded ? "bg-risk-soft" : undefined)}
        emptyMessage="No payables yet - add fixed costs to compute break-even."
        // The query already returns these by nextDueDate ascending (cash-metrics.ts) - this
        // makes the table SAY so. The list read as arbitrary (Error Log H1) because no header
        // carried a sort arrow, so soonest-first looked like insertion order.
        defaultSort="due"
      />
    </section>
  );
}

/** Growth override for months-to-₹8L (PRD3 §4.4). */
export function GrowthOverrideForm({ overridePct }: { overridePct: number | null }) {
  const [error, setError] = useState<string | null>(null);
  return (
    <form
      action={async (form) => {
        setError(null);
        const res = await safeAction(() => setGrowthOverride(form));
        if (!res.ok) setError(res.error);
      }}
      className="flex flex-wrap items-center gap-2"
    >
      <label className="text-xs text-muted" htmlFor="growthPct">Growth % override</label>
      {/* NOT kind="rate": setGrowthOverride accepts -50…200, and `rate` both strips the leading
          "-" as you type and caps at 100 - it would silently make a shrinking forecast unenterable.
          Left as a plain decimal input; the -50…200 bound is enforced server-side. */}
      <input
        id="growthPct"
        name="growthPct"
        inputMode="decimal"
        defaultValue={overridePct ?? ""}
        placeholder="auto"
        className="w-20 rounded-field border border-line bg-surface-2 px-2 py-1 text-sm"
      />
      <button type="submit" className="text-xs text-accent hover:underline">Set</button>
      <FormError message={error} />
    </form>
  );
}
