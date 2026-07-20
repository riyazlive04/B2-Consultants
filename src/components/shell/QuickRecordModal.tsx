"use client";

import { useEffect, useRef, useState } from "react";
import { Modal } from "@/components/ui/Modal";
import { Tabs } from "@/components/ui/Tabs";
import { SkeletonBlock } from "@/components/ui/Skeleton";
import { AmountPair } from "@/components/ui/AmountPair";
import { ComboBox } from "@/components/ui/ComboBox";
import { CheckboxField, Field, FormError, Select, SubmitButton, TextInput } from "@/components/ui/form";
import { celebrate, toast } from "@/components/ui/feedback";
import { createExpense, createIncome } from "@/server/finance-actions";
import { getRecordFormData, type RecordFormData } from "@/server/record-form-data";
import {
  optionsFrom,
  PAYMENT_METHOD_LABELS,
  PAYMENT_TYPE_LABELS,
  EXPENSE_CATEGORY_LABELS,
  EXPENSE_BUSINESS_LINE_LABELS,
} from "@/lib/labels";

/**
 * The Record CTA's popup (this replaces the old menu that navigated to /finance): an Income and an
 * Expense tab, each with the SAME entry form the Finance page uses, so a payment or a cost can be
 * logged from anywhere without leaving the current screen.
 *
 * Create-only on purpose — a global quick-add records a NEW entry; editing an existing one belongs
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
  const { error, formRef, submit } = useQuickSubmit(
    async (fd) => {
      const res = await createIncome(fd);
      if (res.ok) toast("Payment recorded");
      return res;
    },
    onClose,
    keepOpen,
  );

  return (
    <form ref={formRef} action={submit} className="space-y-4">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Field label="Date">
          <TextInput type="date" name="date" required defaultValue={data.today} />
        </Field>
        <Field label="Student name" hint={data.studentOptions.length > 0 ? "Search to link a student — feeds their LTV" : undefined}>
          {data.studentOptions.length > 0 ? (
            <ComboBox options={data.studentOptions} nameText="studentName" nameValue="studentId" required placeholder="Search or type who paid" />
          ) : (
            <TextInput kind="name" name="studentName" required placeholder="Who paid" />
          )}
        </Field>
        <AmountPair
          fxRate={data.fxRate}
          fxStale={data.fxStale}
          fxDate={data.fxDate}
          inrName="amountInr"
          eurName="amountEur"
          inrLabel="Amount received (₹)"
          eurLabel="Amount received (€)"
          baseHint="INR, EUR, or both"
        />
        <Field label="Programme level">
          <Select name="programLevel" options={data.levelOptions} defaultValue="GUIDED" />
        </Field>
        <Field label="Payment type">
          <Select name="paymentType" options={optionsFrom(PAYMENT_TYPE_LABELS)} defaultValue="FULL_PAYMENT" />
        </Field>
        <Field label="Payment method">
          <Select name="paymentMethod" options={optionsFrom(PAYMENT_METHOD_LABELS)} defaultValue="UPI" />
        </Field>
        <div className="sm:col-span-2">
          <Field label="Notes (optional)">
            <TextInput kind="text" name="notes" placeholder="Any extra info" />
          </Field>
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-3 border-t border-line pt-4">
        <SubmitButton>Add income</SubmitButton>
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
          <TextInput type="date" name="date" required defaultValue={data.today} />
        </Field>
        <AmountPair
          fxRate={data.fxRate}
          fxStale={data.fxStale}
          fxDate={data.fxDate}
          inrName="amountInr"
          eurName="amountEur"
          inrLabel="Amount paid (₹)"
          eurLabel="Amount paid (€)"
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
