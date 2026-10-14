"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Modal } from "@/components/ui/Modal";
import { Tabs } from "@/components/ui/Tabs";
import { SkeletonBlock } from "@/components/ui/Skeleton";
import { AmountPair } from "@/components/ui/AmountPair";
import { CheckboxField, Field, FormError, NotesField, Select, SubmitButton, TextInput } from "@/components/ui/form";
import { askConfirm, celebrate, toast } from "@/components/ui/feedback";
import { createExpense, createIncome } from "@/server/finance-actions";
import { getRecordFormData, type RecordFormData } from "@/server/record-form-data";
/**
 * The very fields the Finance page uses, not a second copy of them.
 *
 * This file used to carry its own income form - its own state, its own surcharge pricing, its
 * own method narrowing - under a comment that said it "mirrors IncomeSection". It also carried
 * a warning, about the one field it had correctly shared: "two implementations of that contract
 * is how one of them quietly stops creating receivables." That is precisely what then happened
 * to the plan link, the offline guard and the duplicate-payment check, none of which reached
 * this form. So now there is one implementation, and the expense tab below is all that is left
 * of this file's own markup.
 */
import { IncomeFields } from "@/components/finance/IncomeFields";
import { useIncomeDraft } from "@/components/finance/useIncomeDraft";
import type { IncomeFormCatalogues } from "@/lib/income-form";
import { safeAction } from "@/lib/action-guard";
import {
  optionsFrom,
  EXPENSE_BUSINESS_LINE_LABELS,
} from "@/lib/labels";
import { activeExpenseCategories, expenseCategoryOptions } from "@/lib/expense-categories";
import { ACCOUNT, MONEY_ACCOUNTS } from "@/lib/chart-of-accounts";

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

  /**
   * ── The SAME fields and the SAME rules as the Finance page ──────────────────────
   * This function used to be a second income form: its own thirteen pieces of state, its own
   * copy of the surcharge pricing, the method narrowing and the plan-mode division, under a
   * comment that said "Mirrors IncomeSection". Mirrors drift. By October this form had none of
   * the plan link (FIN-12), the offline guard, the duplicate-payment warning or the notes
   * counter - and since the Record button lives in the shell on every page, the door most
   * payments come through was the one that could not say which receivable they paid off.
   *
   * It now renders `components/finance/IncomeFields` over `useIncomeDraft`, which is exactly
   * what the Finance page renders. What remains below is the only thing that was ever genuinely
   * different: the modal chrome and "keep open to add another".
   */
  const catalogues: IncomeFormCatalogues = useMemo(
    () => ({
      levelOptions: data.levelOptions,
      levelLines: data.levelLines,
      paymentTypes: data.paymentTypes,
      instalmentPlans: data.instalmentPlans,
      studentOptions: data.studentOptions,
      openPlans: data.openPlans,
      nextStudentCodes: data.nextStudentCodes,
      today: data.today,
      // The business-line switch is a cookie, so it is in force here too - see record-form-data.
      defaultLine: data.defaultLine,
    }),
    [data],
  );
  // Create-only: editing an existing entry belongs on the Finance page, next to its row.
  const { draft, patch, reset, derived } = useIncomeDraft(null, catalogues);
  const nameOptions = useMemo(
    () => [...data.studentOptions, ...data.payerOptions],
    [data.studentOptions, data.payerOptions],
  );

  const { error, formRef, submit } = useQuickSubmit(
    async (fd) => {
      const res = await safeAction(() => createIncome(fd));
      if (res.ok) toast("Payment recorded");
      return res;
    },
    onClose,
    keepOpen,
  );

  /**
   * "Keep open" saves then resets the form. `reset()` fires no change event, so the draft has to
   * be cleared alongside it or the next payment opens on the last one's plan, schedule and all.
   * One call now, where there were nine setters that had to be kept in step by hand.
   */
  useEffect(() => {
    const form = formRef.current;
    if (!form) return;
    const onReset = () => reset();
    form.addEventListener("reset", onReset);
    return () => form.removeEventListener("reset", onReset);
  }, [formRef, reset]);

  return (
    <form
      ref={formRef}
      action={async (fd) => {
        /**
         * Minting a student is confirmed here too (issue 13). The tick defaults to on, which is
         * right for a first payment from somebody new and wrong for a typo - and a typo here
         * burns a student number as readily as one on the Finance page.
         */
        if (draft.mintStudent && derived.newStudentName) {
          const ok = await askConfirm({
            title: `Create a new student called "${derived.newStudentName}"?`,
            body: `Nobody on the roster matches that name, so a new student record will be created with ID ${derived.suggestedCode}. If this is somebody who already exists, close this and pick them from the list instead.`,
            confirmLabel: "Create and record",
          });
          if (!ok) return;
        }
        await submit(fd);
      }}
      className="space-y-4"
    >
      <IncomeFields
        draft={draft}
        patch={patch}
        derived={derived}
        editing={null}
        catalogues={catalogues}
        nameOptions={nameOptions}
        // Quick Record is reached by anyone with `finance.write`; minting a Student is an admin
        // act, and the server ignores the tick for a non-admin either way. The modal's data
        // loader runs the same capability check, so the offer follows it.
        canCreateStudent={data.canCreateStudent}
        fxRate={data.fxRate}
        fxStale={data.fxStale}
        fxDate={data.fxDate}
      />
      <div className="flex flex-wrap items-center gap-3 border-t border-line pt-4">
        {/* The reason comes from the shared derivation, so this button and the Finance page's
            agree about what is missing. */}
        <SubmitButton disabled={derived.blockSave} title={derived.blockSaveReason ?? undefined}>
          Add income
        </SubmitButton>
        {derived.blockSaveReason && (
          <p className="text-caption text-muted">{derived.blockSaveReason}</p>
        )}
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
      const res = await safeAction(() => createExpense(fd));
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
          <Select
            name="category"
            options={expenseCategoryOptions(data.expenseCategories)}
            defaultValue={
              activeExpenseCategories(data.expenseCategories).some((c) => c.code === "TOOLS_SOFTWARE")
                ? "TOOLS_SOFTWARE"
                : activeExpenseCategories(data.expenseCategories)[0]?.code ?? "OTHER"
            }
          />
        </Field>
        {/* Which account the money left. Defaulted to the INR bank, which is where every expense
            was posted before the row could say otherwise - so leaving it alone changes nothing. */}
        <Field label="Paid from" hint="The account the money actually left">
          <Select
            name="paidFromAccount"
            options={MONEY_ACCOUNTS.map((a) => ({ value: a.code, label: a.label }))}
            defaultValue={ACCOUNT.BANK_INR}
          />
        </Field>
        <Field label="Business line" hint="Tag a cost that belongs to one business; leave Shared for rent, ads and tools.">
          <Select name="businessLine" options={optionsFrom(EXPENSE_BUSINESS_LINE_LABELS)} defaultValue="SHARED" />
        </Field>
        <Field label="Paid to (vendor)">
          <TextInput kind="text" name="vendor" required placeholder="Who received this payment" />
        </Field>
        <NotesField label="Notes (optional)" placeholder="Any extra info" />
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
