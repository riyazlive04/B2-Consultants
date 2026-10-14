"use client";

import { useRef, useState } from "react";
import { createExpense, deleteExpense, updateExpense } from "@/server/finance-actions";
import type { ExpenseRow } from "@/server/finance-metrics";
import { DataTable, type Column } from "@/components/ui/DataTable";
import { Card } from "@/components/ui/kit";
import { Btn } from "@/components/ui/controls";
import { askConfirm, toast } from "@/components/ui/feedback";
import { guardAction } from "@/lib/action-guard";
import { CheckboxField, Field, FormError, NotesField, Select, SubmitButton, TextInput } from "@/components/ui/form";
import { useUnsavedGuard } from "@/components/ui/use-unsaved-guard";
import { formatDate, formatEurMinor, formatInrMinor } from "@/lib/format";
import { moneyInline, moneyValue } from "@/lib/money-display";
import { EXPENSE_BUSINESS_LINE_LABELS, optionsFrom } from "@/lib/labels";
import {
  activeExpenseCategories,
  expenseCategoryLabel,
  expenseCategoryOptions,
} from "@/lib/expense-categories";
import type { ExpenseCategoriesConfig } from "@/lib/config-schema";
import { ACCOUNT, MONEY_ACCOUNTS } from "@/lib/chart-of-accounts";
import { AmountPair } from "@/components/ui/AmountPair";
import { useFinanceCcy } from "./FinanceCurrency";
import { TeamPayPanel } from "./TeamPayPanel";
import type { TeamPayOverview } from "@/server/team-pay-metrics";
import { safeAction } from "@/lib/action-guard";

const minorToInput = (raw: string) => {
  const v = BigInt(raw);
  return v === BigInt(0) ? "" : (Number(v) / 100).toFixed(2);
};

export function ExpenseSection({
  rows,
  today,
  fxRate,
  fxStale,
  fxDate,
  teamPay,
  categories,
  defaultBusinessLine = "SHARED",
}: {
  rows: ExpenseRow[];
  today: string;
  fxRate: number;
  fxStale?: boolean;
  fxDate?: string;
  /**
   * The team, what each is paid in a normal month, and what has actually gone out in this
   * period - for the Team payments panel between this form and the expenses table, and for the
   * payee picker the form grows when the category is team pay.
   *
   * Handed down rather than fetched here: a dropdown that waits for a round trip is a dropdown
   * people type past, and the panel below needs the same figures.
   */
  teamPay?: TeamPayOverview;
  /**
   * The founder's expense categories (Console → Money → Expense categories).
   *
   * Handed down rather than read here for the same reason as the roster: it travels with the
   * page already, and a picker that waits for a round trip is a picker people type past. It is
   * also what NAMES a category in the table below - the labels are the founder's words now, not
   * a constant in lib/labels.
   */
  categories: ExpenseCategoriesConfig;
  /**
   * What a new cost is tagged with when nobody says otherwise - the page's business-line switch,
   * or "SHARED" on the Combined view.
   *
   * An expense carries its line as a STORED column (unlike income, which derives it from the
   * level), so this is the whole of the fix here: filter the page to German Note and the next
   * cost you type is already a German Note cost. "Shared" remains the honest default for
   * Combined, because rent and tools genuinely do belong to both.
   */
  defaultBusinessLine?: string;
}) {
  const { ccy } = useFinanceCcy();
  const [editing, setEditing] = useState<ExpenseRow | null>(null);
  /**
   * -- WHO, when the cost is team pay ------------------------------------------------
   * "Paid to (vendor)" is free text, which is right for a supplier and wrong for a colleague:
   * one month's "Karthik" and the next month's "Karthick salary" are two payees to every total
   * in the app. So choosing the Team salaries category turns that box into a picker, and
   * picking somebody fills in their agreed monthly pay.
   *
   * Tracked as state (not read off the select) because two other fields follow it.
   */
  /**
   * Tools and Software if the founder still offers it - it is what most daily costs are, and
   * changing somebody's habitual first choice is not an improvement. Otherwise the first
   * category on their list, because a form cannot open on an option that is not there.
   */
  const offered = activeExpenseCategories(categories);
  const openingCategory = offered.some((c) => c.code === "TOOLS_SOFTWARE")
    ? "TOOLS_SOFTWARE"
    : offered[0]?.code ?? "OTHER";
  const [category, setCategory] = useState<string>(openingCategory);
  const [profileId, setProfileId] = useState<string>("");
  /**
   * WHICH ACCOUNT THE MONEY LEFT FROM. Tracked as state only so the picker can be re-keyed
   * alongside the row being edited; the default is the INR bank, which is where the ledger put
   * every expense ever recorded before the row could say otherwise.
   */
  const [paidFrom, setPaidFrom] = useState<string>(ACCOUNT.BANK_INR);
  const isTeamPay = category === "TEAM_SALARIES";
  /** The roster as the picker needs it: name, and the agreed figure as the box's opening text. */
  const team = (teamPay?.people ?? []).map((t) => ({
    profileId: t.profileId,
    name: t.name,
    active: t.active,
    payInr: t.monthlyPay.inr > 0 ? (t.monthlyPay.inr / 100).toFixed(2) : "",
    payEur: t.monthlyPay.eur > 0 ? (t.monthlyPay.eur / 100).toFixed(2) : "",
  }));
  const payee = team.find((t) => t.profileId === profileId) ?? null;

  /**
   * "Pay" in the panel below loads that person into THIS form - the one form on the tab.
   *
   * Deliberately not a second form of its own: a team payment is an expense, writes the same
   * row through the same action, and two money forms on one screen is an invitation to wonder
   * which one is the real one.
   */
  const payPerson = (id: string) => {
    setError(null);
    setEditing(null);
    setCategory("TEAM_SALARIES");
    setProfileId(id);
    setPaidFrom(ACCOUNT.BANK_INR);
    formRef.current?.scrollIntoView({ behavior: "smooth", block: "center" });
  };
  const [error, setError] = useState<string | null>(null);
  const formRef = useRef<HTMLFormElement>(null);
  // Warn before a refresh or a tab close throws away a half-typed entry.
  useUnsavedGuard(formRef);
  // Optimistic delete: hide the row immediately, put it back if the archive fails. Survives the
  // server action's revalidatePath (the row is simply gone from `rows` by then).
  const [removedIds, setRemovedIds] = useState<Set<string>>(new Set());
  const visibleRows = rows.filter((r) => !removedIds.has(r.id));

  /** Load a row into the form and take the eye there too (issue 21). */
  const startEdit = (row: ExpenseRow) => {
    setEditing(row);
    // Follow the row being edited, or the form opens showing another cost's category and payee
    // while claiming to be editing this one.
    setCategory(row.category);
    setProfileId(row.teamProfileId ?? "");
    setPaidFrom(row.paidFromAccount);
    formRef.current?.scrollIntoView({ behavior: "smooth", block: "center" });
  };

  const submit = async (form: FormData) => {
    setError(null);
    // Guarded so an offline submit keeps what was typed instead of taking the page down with
    // it (issue 10) - see lib/action-guard.
    const guarded = await guardAction(() =>
      editing ? updateExpense(editing.id, form) : createExpense(form),
    );
    if (!guarded.ok) return setError(guarded.error);
    const res = guarded.value;
    if (!res.ok) return setError(res.error);
    toast(editing ? "Expense updated" : "Expense added");
    setEditing(null);
    setCategory(openingCategory);
    setProfileId("");
    setPaidFrom(ACCOUNT.BANK_INR);
    formRef.current?.reset();
  };

  const remove = async (row: ExpenseRow) => {
    const ok = await askConfirm({
      title: `Archive expense to ${row.vendor}?`,
      body: "It moves to the Archived tab - you can restore it there.",
      confirmLabel: "Archive",
      danger: true,
    });
    if (!ok) return;
    setRemovedIds((s) => new Set(s).add(row.id)); // optimistic
    const res = await safeAction(() => deleteExpense(row.id));
    if (!res.ok) {
      setRemovedIds((s) => {
        const n = new Set(s);
        n.delete(row.id);
        return n;
      });
      return toast(res.error, "error");
    }
    toast("Expense archived");
  };

  const columns: Column<ExpenseRow>[] = [
    { key: "date", header: "Date", cell: (r) => formatDate(r.date), value: (r) => r.date.slice(0, 10) },
    // "Paid ₹" / "Paid €" are as-entered columns - the currency the money actually left in,
    // dash where none did. Only the aggregate follows the ₹/€ toggle (see IncomeSection).
    {
      key: "inr", header: "Paid ₹", align: "right",
      cell: (r) => (BigInt(r.amountInrRaw) === BigInt(0) ? "-" : formatInrMinor(BigInt(r.amountInrRaw))),
      value: (r) => Number(BigInt(r.amountInrRaw)) / 100,
    },
    {
      key: "eur", header: "Paid €", align: "right",
      cell: (r) => (BigInt(r.amountEurRaw) === BigInt(0) ? "-" : formatEurMinor(BigInt(r.amountEurRaw))),
      value: (r) => Number(BigInt(r.amountEurRaw)) / 100,
    },
    {
      key: "agg", header: "Total", align: "right",
      cell: (r) => moneyInline(r.agg, ccy, { compact: true }),
      value: (r) => moneyValue(r.agg, ccy),
    },
    {
      key: "category", header: "Category",
      cell: (r) => expenseCategoryLabel(categories, r.category),
      value: (r) => expenseCategoryLabel(categories, r.category),
    },
    {
      // Which account went down. Worth a column of its own because it is the one thing on the
      // row a bank statement is reconciled against, and it was unanswerable until now.
      key: "paidFrom", header: "Paid from",
      cell: (r) => MONEY_ACCOUNTS.find((a) => a.code === r.paidFromAccount)?.label ?? r.paidFromAccount,
      value: (r) => r.paidFromAccount,
    },
    {
      key: "businessLine", header: "Business line",
      cell: (r) => (r.businessLine === "SHARED" ? "Shared" : r.businessLine === "B2" ? "B2" : "German Note"),
      value: (r) => r.businessLine,
    },
    {
      key: "cogs", header: "COGS", cell: (r) => (r.isCogs ? "Yes" : "No"), value: (r) => (r.isCogs ? "Yes" : "No"),
    },
    {
      key: "vendor", header: "Paid to",
      cell: (r) => (
        <span>
          {r.vendor}
          {/* A team-pay row with no link counts in nobody's pay total - flagged here because
              this is the tab where it can be fixed (Edit, then pick the person). */}
          {r.category === "TEAM_SALARIES" && !r.teamProfileId && (
            <span
              className="ml-1.5 cursor-help text-caption text-watch"
              title="Not linked to a team member - edit this row and pick them, so it counts in their pay history"
            >
              unlinked
            </span>
          )}
        </span>
      ),
      value: (r) => r.vendor,
    },
    { key: "notes", header: "Notes", cell: (r) => r.notes ?? "", value: (r) => r.notes ?? "" },
    {
      key: "actions", header: "", sortable: false,
      cell: (r) => (
        <span className="flex gap-2 whitespace-nowrap">
          {/* Scrolls to the form and tints the row (issue 21) - opening the editor from a row
              far down the table otherwise looked like a click that did nothing. */}
          <Btn variant="ghost" size="sm" onClick={() => startEdit(r)}>Edit</Btn>
          {/* "Archive" - the dialog already said so, the button did not (issue 26). The row moves
              to the Archived tab and can be restored for 90 days; "Delete permanently" lives
              there, on the only control that really destroys anything. */}
          <Btn variant="danger" size="sm" onClick={() => remove(r)}>Archive</Btn>
        </span>
      ),
      value: () => null,
    },
  ];

  return (
    <section className="space-y-4">
      <Card
        title={editing ? `Edit expense - ${editing.vendor}` : "Daily expense entry"}
        actions={
          editing ? (
            <Btn variant="ghost" size="sm" onClick={() => setEditing(null)}>
              Cancel edit
            </Btn>
          ) : undefined
        }
      >
        <form ref={formRef} action={submit} key={editing?.id ?? "new"}>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <Field label="Date">
            {/* Browser's today on a new entry, the stored date when editing - see IncomeSection. */}
            <TextInput
              type="date"
              name="date"
              required
              defaultValue={editing ? editing.date.slice(0, 10) : today}
              defaultToday={!editing}
            />
          </Field>
          <AmountPair
            /* Re-keyed on the chosen person, so switching payee adopts THEIR agreed figure
               instead of leaving the previous one's salary in the box. An existing row keys off
               its own id, so editing never re-prices what was actually paid. */
            key={editing ? `exp-${editing.id}` : `exp-new-${profileId}`}
            fxRate={fxRate}
            fxStale={fxStale}
            fxDate={fxDate}
            inrName="amountInr"
            eurName="amountEur"
            inrLabel="Price paid (₹)"
            eurLabel="Price paid (€)"
            baseHint={
              !editing && payee && (payee.payInr || payee.payEur)
                ? "Their agreed monthly pay - change it for a part month or a bonus"
                : "INR, EUR, or both"
            }
            defaultInr={editing ? minorToInput(editing.amountInrRaw) : (payee?.payInr ?? "")}
            defaultEur={editing ? minorToInput(editing.amountEurRaw) : (payee?.payEur ?? "")}
          />
          <Field
            label="Expense category"
            hint={isTeamPay ? "Paying a person - pick them below and the amount fills in." : undefined}
          >
            <Select
              name="category"
              // The row's own category is included even if it has since been switched off, or
              // opening an old cost to fix its vendor would silently re-file it.
              options={expenseCategoryOptions(categories, editing?.category)}
              value={category}
              onChange={(e) => {
                const next = e.currentTarget.value;
                setCategory(next);
                // Leaving the category drops the person: a Marketing invoice still linked to a
                // colleague would put an ad spend in their pay history.
                if (next !== "TEAM_SALARIES") setProfileId("");
              }}
            />
          </Field>
          <Field
            label="Paid from"
            hint="The account the money actually left - this is what the ledger credits, and what a bank statement is reconciled against."
          >
            <Select
              name="paidFromAccount"
              options={MONEY_ACCOUNTS.map((a) => ({ value: a.code, label: a.label }))}
              value={paidFrom}
              onChange={(e) => setPaidFrom(e.currentTarget.value)}
            />
          </Field>
          <Field
            label="Business line"
            hint="Tag a cost that belongs to ONE business. Leave Shared for rent, ads and tools - those get split across both by revenue share."
          >
            <Select
              name="businessLine"
              options={optionsFrom(EXPENSE_BUSINESS_LINE_LABELS)}
              defaultValue={editing?.businessLine ?? defaultBusinessLine}
            />
          </Field>
          {/*
            Paid to - a PICKER when the money is going to a colleague, free text otherwise.

            The two are mutually exclusive by construction: only one of them is rendered, so only
            one reaches FormData and a typed name can never disagree with a chosen one. The action
            overwrites `vendor` with the chosen person's own name, which is why the picker can
            carry a hidden vendor without the two drifting.
          */}
          {isTeamPay && team.length > 0 ? (
            <Field
              label="Paid to (team member)"
              hint={
                payee && !payee.payInr && !payee.payEur
                  ? "No monthly pay agreed for them - set it under People, or just type the amount."
                  : "Fills the amount from their agreed monthly pay"
              }
            >
              <Select
                name="teamProfileId"
                options={[
                  { value: "", label: "Pick a team member" },
                  ...team.map((t) => ({
                    value: t.profileId,
                    label: t.active ? t.name : `${t.name} (former)`,
                  })),
                ]}
                value={profileId}
                onChange={(e) => setProfileId(e.currentTarget.value)}
              />
              <input type="hidden" name="vendor" value={payee?.name ?? ""} />
            </Field>
          ) : (
            /* Not kind="name": a vendor is a company ("3M", "Zoho One"), not a person. */
            <Field
              label="Paid to (vendor)"
              hint={
                isTeamPay
                  ? "No team profiles on file yet - add people under People to link pay to a person."
                  : undefined
              }
            >
              <TextInput kind="text" name="vendor" required placeholder="Who received this payment" defaultValue={editing?.vendor ?? ""} />
            </Field>
          )}
          {/* Counts down the last characters instead of silently swallowing them (issue 18). */}
          <NotesField placeholder="Any extra info" defaultValue={editing?.notes ?? ""} key={`notes-${editing?.id ?? "new"}`} />
          <div className="flex items-end pb-1">
            <CheckboxField
              name="isCogs"
              label="Is this COGS?"
              defaultChecked={editing?.isCogs ?? false}
              // The COGS test is "would this cost exist if nobody enrolled?" - tutor
              // salary, books and delivery tools scale with students, so they are COGS.
              // A platform subscription (Skool, WATI) is paid whether or not anyone
              // enrols, so it belongs in Tools & Software. The old hint listed Skool as
              // a COGS example, which is exactly how it got misfiled.
              hint="Direct cost of delivering the programme - a cost you'd avoid if nobody enrolled (e.g. tutor salary, books, delivery tools). Platform subscriptions like Skool are Tools & Software, not COGS."
            />
          </div>
        </div>
        <div className="mt-4 flex items-center gap-3">
          <SubmitButton>{editing ? "Save changes" : "Add expense"}</SubmitButton>
          <FormError message={error} />
        </div>
        </form>
      </Card>

      {/*
        Between the entry form and the full expense table, because that is where it belongs in
        the sequence of the task: who do we pay, how much are they owed, and then every other
        cost. It is not a separate tab - a team payment IS one of the rows below.
      */}
      {teamPay && (
        <TeamPayPanel overview={teamPay} ccy={ccy} categories={categories} onPay={payPerson} />
      )}

      <DataTable
        rows={visibleRows}
        columns={columns}
        csvName="expenses"
        filterPlaceholder="Filter expenses…"
        // The row currently loaded into the form at the top of the tab (issue 21).
        rowClassName={(r) => (r.id === editing?.id ? "bg-accent-soft" : undefined)}
      />
    </section>
  );
}
