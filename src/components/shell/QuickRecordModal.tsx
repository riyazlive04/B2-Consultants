"use client";

import { useEffect, useRef, useState } from "react";
import { Modal } from "@/components/ui/Modal";
import { Tabs } from "@/components/ui/Tabs";
import { SkeletonBlock } from "@/components/ui/Skeleton";
import { AmountPair } from "@/components/ui/AmountPair";
import {
  firstShare, planShares, remainingShares, type MoneyText,
} from "@/lib/instalment-amounts";
import { ComboBox } from "@/components/ui/ComboBox";
import { CheckboxField, Field, FormError, Select, SubmitButton, TextInput } from "@/components/ui/form";
import { celebrate, toast } from "@/components/ui/feedback";
import { createExpense, createIncome } from "@/server/finance-actions";
import { getRecordFormData, type RecordFormData } from "@/server/record-form-data";
// The very schedule field the Finance page uses, not a second copy of it: the due dates travel
// as one JSON payload that createIncome parses, and two implementations of that contract is how
// one of them quietly stops creating receivables.
import { InstalmentSchedule } from "@/app/(app)/finance/_components/InstalmentSchedule";
import {
  optionsFrom,
  PAYMENT_METHOD_LABELS,
  EXPENSE_CATEGORY_LABELS,
  EXPENSE_BUSINESS_LINE_LABELS,
} from "@/lib/labels";
import {
  paymentTypeKind, paymentTypeOptions, RECURRENCE_INTERVAL_LABELS, suggestNextBillingDate,
} from "@/lib/payment-types";
import { currenciesInPlay, defaultMethodFor, methodsForCurrencies } from "@/lib/payment-methods";
import { instalmentExtraFor } from "@/lib/instalment-plan";
import { minorToMajorString } from "@/lib/format";

/**
 * The Record CTA's popup (this replaces the old menu that navigated to /finance): an Income and an
 * Expense tab, each with the SAME entry form the Finance page uses, so a payment or a cost can be
 * logged from anywhere without leaving the current screen.
 *
 * Create-only on purpose - a global quick-add records a NEW entry; editing an existing one belongs
 * on the Finance page next to its row. Both tabs post to the very same server actions
 * (`createIncome` / `createExpense`), so validation, FX stamping and ledger posting are identical
 * whether you record here or there; only the surrounding chrome differs.
 *
 * Form dependencies (FX rate, students, levels) load lazily the first time the modal opens.
 */
export function QuickRecordModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [data, setData] = useState<RecordFormData | null>(null);
  const [loadState, setLoadState] = useState<"idle" | "loading" | "error">("idle");

  useEffect(() => {
    if (!open || data || loadState === "loading") return;
    setLoadState("loading");
    getRecordFormData()
      .then((d) => {
        if (d) {
          setData(d);
          setLoadState("idle");
        } else {
          setLoadState("error");
        }
      })
      .catch(() => setLoadState("error"));
  }, [open, data, loadState]);

  return (
    <Modal open={open} onClose={onClose} title="Record" subtitle="Add an income entry or an expense" size="md">
      {loadState === "error" ? (
        <p className="py-6 text-center text-sm text-muted">
          Couldn&apos;t load the form. You may not have permission to record finance entries.
        </p>
      ) : !data ? (
        <div className="space-y-3 py-2">
          <SkeletonBlock className="h-10 w-full" />
          <SkeletonBlock className="h-24 w-full" />
          <SkeletonBlock className="h-10 w-1/3" />
        </div>
      ) : (
        <Tabs
          tabs={[
            { label: "Income", content: <IncomeForm data={data} onClose={onClose} /> },
            { label: "Expense", content: <ExpenseForm data={data} onClose={onClose} /> },
          ]}
        />
      )}
    </Modal>
  );
}

/**
 * Recording money often comes in bursts (a day's payments entered together), so a "Keep open to
 * add another" toggle lets the founder log several without the modal closing between each. Off by
 * default: a single record saves and closes, which is the common case.
 */
function useQuickSubmit(
  action: (fd: FormData) => Promise<{ ok: boolean; error?: string }>,
  onClose: () => void,
  keepOpen: boolean,
) {
  const [error, setError] = useState<string | null>(null);
  const formRef = useRef<HTMLFormElement>(null);

  const submit = async (fd: FormData) => {
    setError(null);
    const res = await action(fd);
    if (!res.ok) return setError(res.error ?? "Something went wrong");
    celebrate();
    if (keepOpen) formRef.current?.reset();
    else onClose();
  };

  return { error, formRef, submit };
}

function KeepOpenToggle({ on, onChange }: { on: boolean; onChange: (v: boolean) => void }) {
  return (
    <label className="ml-auto inline-flex cursor-pointer items-center gap-1.5 text-caption text-muted">
      <input type="checkbox" checked={on} onChange={(e) => onChange(e.currentTarget.checked)} className="accent-[var(--primary)]" />
      Keep open to add another
    </label>
  );
}

function IncomeForm({ data, onClose }: { data: RecordFormData; onClose: () => void }) {
  const [keepOpen, setKeepOpen] = useState(false);
  // Mirrors IncomeSection: INSTALMENT reveals the plan questions - how many instalments, the
  // surcharge, and WHEN the rest is due. createIncome requires the count for instalments, so
  // the quick form must ask too.
  //
  // The due dates are not optional polish (FIN-05). Without them this form recorded a part
  // payment and nothing else: no receivable, no instalment rows, so nobody was reminded to
  // follow up and the chasing ladder had nothing to chase. A payment plan agreed here is the
  // same plan agreed on the Finance page, and it has to be written down the same way.
  const [paymentType, setPaymentType] = useState("FULL_PAYMENT");
  // The chosen type's KIND is what the form branches on - see IncomeSection / lib/payment-types.
  const typeKind = paymentTypeKind(data.paymentTypes, paymentType);
  // Same three pieces as the Finance form: the plan's shape, where it starts, and whether every
  // due date is in. Kept in step so a plan agreed here is written down the same way.
  const [instalmentCount, setInstalmentCount] = useState<number | null>(null);
  const [entryDate, setEntryDate] = useState<string>(data.today);
  const [scheduleComplete, setScheduleComplete] = useState(false);
  const blockSave = typeKind === "INSTALMENT" && !scheduleComplete;
  // The fee and the plan surcharge, divided - exactly as on the Finance page, because a plan
  // agreed here is the same plan. See lib/instalment-amounts.
  const [feeAmount, setFeeAmount] = useState<MoneyText>({ inr: "", eur: "" });
  const [extraAmount, setExtraAmount] = useState<MoneyText>({ inr: "", eur: "" });
  const planMode = typeKind === "INSTALMENT";
  const shares = planMode ? planShares(feeAmount, extraAmount, instalmentCount) : [];
  const banked = firstShare(shares);
  /** The Console price for this plan length, filled in as you type - see IncomeSection. */
  const feeCurrencies = currenciesInPlay(feeAmount);
  const pricedExtra = instalmentExtraFor(instalmentCount ?? 0, data.instalmentPlans);
  const extraDefaults = {
    inr: feeCurrencies.includes("INR") && pricedExtra.inr > BigInt(0) ? minorToMajorString(pricedExtra.inr) : "",
    eur: feeCurrencies.includes("EUR") && pricedExtra.eur > BigInt(0) ? minorToMajorString(pricedExtra.eur) : "",
  };
  const extraKey = `extra-${instalmentCount ?? 0}-${feeCurrencies.join("+") || "none"}`;
  /** The method list narrows to the rails the entered currency can arrive by. */
  const [methodChoice, setMethodChoice] = useState<string | null>(null);
  const methodOptions = methodsForCurrencies(feeCurrencies).map((m) => ({
    value: m,
    label: PAYMENT_METHOD_LABELS[m] ?? m,
  }));
  const paymentMethod = defaultMethodFor(feeCurrencies, methodChoice ?? "UPI");
  const [interval, setInterval] = useState("MONTHLY");
  const [nextBilling, setNextBilling] = useState("");
  const { error, formRef, submit } = useQuickSubmit(
    async (fd) => {
      const res = await createIncome(fd);
      if (res.ok) toast("Payment recorded");
      return res;
    },
    onClose,
    keepOpen,
  );

  // "Keep open" saves then resets the form to defaults - fold the instalment fields away with it.
  useEffect(() => {
    const form = formRef.current;
    if (!form) return;
    // Every one of these is React state fed by `onChange`, and `reset()` fires no change event -
    // without this the next payment opened on the last one's plan, schedule and all.
    const onReset = () => {
      setPaymentType("FULL_PAYMENT");
      setInstalmentCount(null);
      setEntryDate(data.today);
      setScheduleComplete(false);
      setFeeAmount({ inr: "", eur: "" });
      setExtraAmount({ inr: "", eur: "" });
      setMethodChoice(null);
      setInterval("MONTHLY");
      setNextBilling("");
    };
    form.addEventListener("reset", onReset);
    return () => form.removeEventListener("reset", onReset);
  }, [formRef, data.today]);

  return (
    <form ref={formRef} action={submit} className="space-y-4">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Field label="Date">
          {/* `data.today` is India's date, fetched when the modal opened; the browser then
              fills in its own today so a late-evening entry from Germany is not dated
              tomorrow (FIN-02). Create-only form, so this is always a new record. */}
          <TextInput
            type="date"
            name="date"
            required
            defaultValue={data.today}
            defaultToday
            onChange={(e) => setEntryDate(e.currentTarget.value)}
          />
        </Field>
        {/* Searchable even with an empty roster - see the same field on the Finance page for why
            a silent fallback to a plain box is worse than an empty list that says so. */}
        <Field label="Student name" hint="Search to link a student - feeds their total paid">
          <ComboBox
            options={data.studentOptions}
            nameText="studentName"
            nameValue="studentId"
            required
            placeholder={data.studentOptions.length > 0 ? "Search or type who paid" : "Type who paid"}
            emptyHint={
              data.studentOptions.length > 0
                ? undefined
                : "No students on file yet - the payment saves under this name; create the student under Finance or Students to start their history."
            }
          />
        </Field>
        {/* Renamed, not just relabelled, on a plan - the hidden pair below carries the first
            instalment, which is what actually gets banked. See the Finance page for why. */}
        <AmountPair
          fxRate={data.fxRate}
          fxStale={data.fxStale}
          fxDate={data.fxDate}
          inrName={planMode ? "planTotalInr" : "amountInr"}
          eurName={planMode ? "planTotalEur" : "amountEur"}
          inrLabel={planMode ? "Total price (₹)" : "Price received (₹)"}
          eurLabel={planMode ? "Total price (€)" : "Price received (€)"}
          baseHint={planMode ? "The whole fee - divided across the instalments below" : "INR, EUR, or both"}
          onAmountsChange={setFeeAmount}
        />
        {planMode && (
          <>
            <input type="hidden" name="amountInr" value={banked.inr} />
            <input type="hidden" name="amountEur" value={banked.eur} />
          </>
        )}
        <Field label="Programme level">
          <Select name="programLevel" options={data.levelOptions} defaultValue="GUIDED" />
        </Field>
        <Field label="Payment type">
          <Select
            name="paymentType"
            options={paymentTypeOptions(data.paymentTypes)}
            value={paymentType}
            onChange={(e) => setPaymentType(e.currentTarget.value)}
          />
        </Field>
        {typeKind === "SUBSCRIPTION" && (
          <>
            <Field label="Bills every" hint="How often this payment repeats">
              <Select
                name="recurrenceInterval"
                options={optionsFrom(RECURRENCE_INTERVAL_LABELS)}
                value={interval}
                onChange={(e) => {
                  const next = e.currentTarget.value;
                  setInterval(next);
                  setNextBilling((cur) => cur || suggestNextBillingDate(entryDate, next));
                }}
              />
            </Field>
            <Field label="Next payment due" hint="Suggested from the interval - change it freely">
              <TextInput
                type="date"
                name="recurrenceNextDate"
                required
                value={nextBilling || suggestNextBillingDate(entryDate, interval)}
                onChange={(e) => setNextBilling(e.currentTarget.value)}
              />
            </Field>
          </>
        )}
        {typeKind === "INSTALMENT" && (
          <>
            <Field label="Number of instalments" hint="How many instalments the fee is split into">
              <TextInput
                kind="int"
                name="instalmentCount"
                required
                placeholder="e.g. 3"
                onChange={(e) => {
                  const n = Number.parseInt(e.currentTarget.value, 10);
                  setInstalmentCount(Number.isFinite(n) && n > 0 ? n : null);
                }}
              />
            </Field>
            <AmountPair
              key={extraKey}
              fxRate={data.fxRate}
              fxStale={data.fxStale}
              fxDate={data.fxDate}
              inrName="instalmentExtraInr"
              eurName="instalmentExtraEur"
              inrLabel="Extra price (₹)"
              eurLabel="Extra price (€)"
              baseHint={
                extraDefaults.inr || extraDefaults.eur
                  ? `The Console price for a ${instalmentCount}-part plan - change it if this one was agreed differently`
                  : "Added to the fee for paying in instalments"
              }
              defaultInr={extraDefaults.inr}
              defaultEur={extraDefaults.eur}
              onAmountsChange={setExtraAmount}
            />
            <InstalmentSchedule
              className="sm:col-span-2"
              count={instalmentCount}
              anchorDate={entryDate}
              shares={remainingShares(shares)}
              bankedToday={banked}
              onCompleteChange={setScheduleComplete}
            />
          </>
        )}
        {/* Narrowed to the rails the entered currency can arrive by - lib/payment-methods. */}
        <Field
          label="Payment method"
          hint={
            feeCurrencies.length === 1
              ? `${feeCurrencies[0] === "EUR" ? "Euro" : "Rupee"} payment methods`
              : undefined
          }
        >
          <Select
            name="paymentMethod"
            options={methodOptions}
            value={paymentMethod}
            onChange={(e) => setMethodChoice(e.currentTarget.value)}
          />
        </Field>
        {paymentMethod === "OTHER" && (
          <Field label="How did it arrive?" hint="Named on the row instead of “Other”">
            <TextInput
              kind="text"
              name="paymentMethodOther"
              required
              maxLength={60}
              placeholder="e.g. Wise, Revolut, demand draft"
            />
          </Field>
        )}
        <div className="sm:col-span-2">
          <Field label="Notes (optional)">
            <TextInput kind="text" name="notes" placeholder="Any extra info" />
          </Field>
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-3 border-t border-line pt-4">
        <SubmitButton
          disabled={blockSave}
          title="Every instalment needs a due date before this can be saved"
        >
          Add income
        </SubmitButton>
        <FormError message={error} />
        <KeepOpenToggle on={keepOpen} onChange={setKeepOpen} />
      </div>
    </form>
  );
}

function ExpenseForm({ data, onClose }: { data: RecordFormData; onClose: () => void }) {
  const [keepOpen, setKeepOpen] = useState(false);
  const { error, formRef, submit } = useQuickSubmit(
    async (fd) => {
      const res = await createExpense(fd);
      if (res.ok) toast("Expense added");
      return res;
    },
    onClose,
    keepOpen,
  );

  return (
    <form ref={formRef} action={submit} className="space-y-4">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Field label="Date">
          {/* Browser's today, same as the Income tab above (FIN-02). */}
          <TextInput type="date" name="date" required defaultValue={data.today} defaultToday />
        </Field>
        <AmountPair
          fxRate={data.fxRate}
          fxStale={data.fxStale}
          fxDate={data.fxDate}
          inrName="amountInr"
          eurName="amountEur"
          inrLabel="Price paid (₹)"
          eurLabel="Price paid (€)"
          baseHint="INR, EUR, or both"
        />
        <Field label="Expense category">
          <Select name="category" options={optionsFrom(EXPENSE_CATEGORY_LABELS)} defaultValue="TOOLS_SOFTWARE" />
        </Field>
        <Field label="Business line" hint="Tag a cost that belongs to one business; leave Shared for rent, ads and tools.">
          <Select name="businessLine" options={optionsFrom(EXPENSE_BUSINESS_LINE_LABELS)} defaultValue="SHARED" />
        </Field>
        <Field label="Paid to (vendor)">
          <TextInput kind="text" name="vendor" required placeholder="Who received this payment" />
        </Field>
        <Field label="Notes (optional)">
          <TextInput kind="text" name="notes" placeholder="Any extra info" />
        </Field>
      </div>
      <div className="flex items-center gap-2">
        <CheckboxField
          name="isCogs"
          label="Is this COGS?"
          hint="A cost you'd avoid if nobody enrolled (tutor salary, books, delivery tools). Platform subscriptions are Tools & Software, not COGS."
        />
      </div>
      <div className="flex flex-wrap items-center gap-3 border-t border-line pt-4">
        <SubmitButton>Add expense</SubmitButton>
        <FormError message={error} />
        <KeepOpenToggle on={keepOpen} onChange={setKeepOpen} />
      </div>
    </form>
  );
}
