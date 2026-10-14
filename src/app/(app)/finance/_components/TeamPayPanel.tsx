"use client";

import { useState } from "react";
import { Users } from "lucide-react";
import { setTeamMonthlyPay } from "@/server/team-pay-actions";
import type { TeamPayOverview, TeamPayPerson } from "@/server/team-pay-metrics";
import { DataTable, type Column } from "@/components/ui/DataTable";
import { Card, Pill } from "@/components/ui/kit";
import { Btn } from "@/components/ui/controls";
import { toast } from "@/components/ui/feedback";
import { safeAction } from "@/lib/action-guard";
import { Field, FormError, SubmitButton } from "@/components/ui/form";
import { MoneyInput } from "@/components/ui/MoneyInput";
import { formatDate, formatEurMinor, formatInrMinor } from "@/lib/format";
import { moneyInline, moneyValue, type Ccy } from "@/lib/money-display";
import { expenseCategoryLabel } from "@/lib/expense-categories";
import type { ExpenseCategoriesConfig } from "@/lib/config-schema";

/**
 * TEAM PAYMENTS - the people half of the Expenses tab.
 *
 * ── What this is for ──────────────────────────────────────────────────────────────
 * Paying a colleague was a daily expense with their name typed into "Paid to (vendor)". Three
 * consequences, all of which this panel exists to end:
 *
 *   · the payee was a SPELLING, so "Karthik" one month and "Karthick salary" the next were two
 *     payees to every total in the app, and "have we paid Asma this month?" could not be
 *     answered on any screen;
 *   · the agreed figure lived in somebody's head and was re-typed from memory each month;
 *   · and the only structured pay flow was the bonus-and-commission board, which pays a REWARD
 *     on top of a salary. It now covers the whole team, but a salary still has no home there:
 *     a bonus is an event, and the monthly figure somebody is owed is a standing agreement.
 *
 * ── Why it is a panel and not a tab ──────────────────────────────────────────────
 * Because a team payment IS an expense. It writes the same row, through the same action, into
 * the same table underneath - it just carries a link to a person. Giving it its own tab would
 * have put a second money form on the page and invited the question of which one to use; here
 * "Pay" simply loads the person into the expense form already at the top of this tab, with the
 * category and the agreed amount filled in.
 *
 * The agreed figure is editable in place for the same reason: the moment anyone needs it is the
 * moment they are paying somebody, and sending them to the People screen to type one number is
 * how the field stays empty. It writes the SAME column the profile form writes.
 */
export function TeamPayPanel({
  overview,
  ccy,
  categories,
  onPay,
}: {
  overview: TeamPayOverview;
  /** The page's ₹/€ toggle, passed down rather than re-read - one provider, one answer. */
  ccy: Ccy;
  /** The founder's category list, so a cost is named here exactly as in the table below. */
  categories: ExpenseCategoriesConfig;
  /** Load this person into the expense form above, ready to pay. */
  onPay: (profileId: string) => void;
}) {
  const [open, setOpen] = useState(true);
  /** Whose agreed pay is being edited, by profile id. Null = the read-only table. */
  const [pricing, setPricing] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const { people, rows, totals, monthShaped, periodLabel } = overview;

  const columns: Column<TeamPayPerson>[] = [
    {
      key: "name",
      header: "Team member",
      cell: (r) => (
        <span>
          {r.name}
          {!r.active && <Pill tone="neutral">Former</Pill>}
          <span className="block text-caption text-muted">{r.roleTitle}</span>
        </span>
      ),
      value: (r) => r.name,
    },
    {
      key: "agreed",
      header: "Agreed / month",
      align: "right",
      cell: (r) =>
        pricing === r.profileId ? (
          <PayRateForm
            person={r}
            onDone={() => setPricing(null)}
            onError={setError}
          />
        ) : (
          <button
            type="button"
            onClick={() => { setError(null); setPricing(r.profileId); }}
            className="tnum rounded-field px-1.5 py-0.5 text-right hover:bg-surface-2 hover:underline"
            title="Set what this person is paid in a normal month"
          >
            {/* A person with no agreed figure reads "Set pay", never ₹0: "paid nothing" and
                "no salary agreed here" are different facts, and a tutor paid per batch is the
                second one. The empty state is also the control that fixes it. */}
            {r.monthlyPay.inr === 0 && r.monthlyPay.eur === 0
              ? <span className="text-accent">Set pay</span>
              : moneyInline(r.monthlyPay, ccy, { compact: true })}
          </button>
        ),
      value: (r) => moneyValue(r.monthlyPay, ccy),
    },
    {
      key: "paid",
      header: `Paid · ${periodLabel}`,
      align: "right",
      cell: (r) => (
        <span className="whitespace-nowrap">
          <span className="tnum">{moneyInline(r.paidInPeriod, ccy, { compact: true })}</span>
          <span className="block text-caption text-muted">
            {r.payments === 0 ? "no payments" : `${r.payments} payment${r.payments === 1 ? "" : "s"}`}
          </span>
        </span>
      ),
      value: (r) => moneyValue(r.paidInPeriod, ccy),
    },
    {
      key: "shortfall",
      header: "Still to pay",
      align: "right",
      /**
       * Only on a month-shaped window. A quarter owes three salaries, not one, so comparing one
       * agreed month against three months of payments would report a surplus that does not
       * exist - the column says nothing rather than something wrong.
       */
      cell: (r) =>
        !monthShaped || r.monthlyPay.inr === 0 ? (
          "-"
        ) : r.shortfallInr === 0 ? (
          <span className="text-ok">Settled</span>
        ) : (
          <span className="tnum text-warn">{formatInrMinor(r.shortfallInr, { compact: true })}</span>
        ),
      value: (r) => r.shortfallInr / 100,
    },
    {
      key: "last",
      header: "Last paid",
      cell: (r) => (r.lastPaidDate ? formatDate(r.lastPaidDate) : "never"),
      value: (r) => r.lastPaidDate?.slice(0, 10) ?? "",
    },
    {
      key: "actions",
      header: "",
      sortable: false,
      cell: (r) => (
        <Btn variant="soft" size="sm" onClick={() => onPay(r.profileId)}>
          Pay
        </Btn>
      ),
      value: () => null,
    },
  ];

  const paymentColumns: Column<TeamPayOverview["rows"][number]>[] = [
    { key: "date", header: "Date", cell: (r) => formatDate(r.date), value: (r) => r.date.slice(0, 10) },
    {
      key: "payee",
      header: "Paid to",
      cell: (r) => (
        <span>
          {r.payee}
          {/* A pre-link row names a person in free text and points at nobody, so it counts in
              no one's pay history. Flagged rather than hidden - the fix is to edit it in the
              table below and pick the person, and an invisible row teaches nobody that. */}
          {r.unlinked && (
            <span
              className="ml-1.5 cursor-help text-caption text-watch"
              title="Not linked to a team member - edit it in the expenses table below and pick them"
            >
              unlinked
            </span>
          )}
        </span>
      ),
      value: (r) => r.payee,
    },
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
      value: (r) => r.category,
    },
    { key: "notes", header: "Notes", cell: (r) => r.notes ?? "", value: (r) => r.notes ?? "" },
  ];

  return (
    <Card
      title={
        <span className="flex items-center gap-2 font-display text-h3 text-ink">
          <span className="text-primary"><Users size={18} /></span>
          Team payments
        </span>
      }
      subtitle="Who is paid what each month, and what has actually gone out. “Pay” fills in the form above."
      actions={
        <span className="flex items-center gap-3">
          <span className="text-caption text-muted">
            Agreed <strong className="tnum text-ink">{formatInrMinor(totals.agreedInr, { compact: true })}</strong>/mo ·
            paid <strong className="tnum text-ink">{formatInrMinor(totals.paidInr, { compact: true })}</strong>
          </span>
          {/* Collapsible, and open by default. This sits between the entry form and the full
              expenses table, so somebody recording a tool subscription can fold it out of the
              way - but a panel that opened closed would be a panel nobody found. */}
          <Btn variant="ghost" size="sm" onClick={() => setOpen((v) => !v)}>
            {open ? "Hide" : "Show"}
          </Btn>
        </span>
      }
    >
      {open && (
        <div className="space-y-4">
          <FormError message={error} />
          <DataTable
            rows={people}
            columns={columns}
            csvName="team-pay"
            emptyMessage="No team profiles yet - add people under People, then set their monthly pay here."
            defaultSort="name"
            hideFilter
          />
          {!monthShaped && (
            <p className="text-caption text-muted">
              “Still to pay” is hidden because {periodLabel.toLowerCase()} is not one month - an
              agreed monthly figure has nothing to compare against over a longer window.
            </p>
          )}

          <div>
            <p className="text-label uppercase text-ink-3">Payments in {periodLabel.toLowerCase()}</p>
            <p className="mb-2 mt-1 text-caption text-muted">
              Every cost in this window that paid a person - ordinary expense rows, editable in
              the table below.
            </p>
            <DataTable
              rows={rows}
              columns={paymentColumns}
              csvName="team-payments"
              filterPlaceholder="Filter payments…"
              emptyMessage="Nobody has been paid in this period yet."
            />
          </div>
        </div>
      )}
    </Card>
  );
}

/**
 * The agreed monthly figure, edited where it is read.
 *
 * Its own `<form>` inside the cell, so it posts and resets on its own without touching the
 * expense form above it - two nested forms would be invalid HTML and the inner submit would
 * fire the outer one.
 */
function PayRateForm({
  person,
  onDone,
  onError,
}: {
  person: TeamPayPerson;
  onDone: () => void;
  onError: (m: string | null) => void;
}) {
  const asInput = (minor: number) => (minor === 0 ? "" : (minor / 100).toFixed(2));
  return (
    <form
      action={async (form) => {
        onError(null);
        const res = await safeAction(() => setTeamMonthlyPay(person.profileId, form));
        if (!res.ok) return onError(res.error);
        toast(`Monthly pay set for ${person.name}`);
        onDone();
      }}
      className="flex flex-wrap items-end justify-end gap-2"
    >
      <div className="w-28">
        <Field label="₹ / month">
          <MoneyInput
            currency="INR"
            name="monthlyPayInr"
            defaultValue={asInput(person.monthlyPay.inr)}
            aria-label={`Monthly pay in rupees for ${person.name}`}
          />
        </Field>
      </div>
      <div className="w-28">
        <Field label="€ / month">
          <MoneyInput
            currency="EUR"
            name="monthlyPayEur"
            defaultValue={asInput(person.monthlyPay.eur)}
            aria-label={`Monthly pay in euros for ${person.name}`}
          />
        </Field>
      </div>
      <div className="flex items-center gap-1.5 pb-0.5">
        <SubmitButton>Save</SubmitButton>
        <Btn variant="ghost" size="sm" type="button" onClick={onDone}>
          Cancel
        </Btn>
      </div>
    </form>
  );
}
