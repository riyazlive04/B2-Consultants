"use client";

import { useRef, useState } from "react";
import { createIncome, deleteIncome, updateIncome } from "@/server/finance-actions";
import type { IncomeRow } from "@/server/finance-metrics";
import { DataTable, type Column } from "@/components/ui/DataTable";
import { Card } from "@/components/ui/kit";
import { Btn } from "@/components/ui/controls";
import { askConfirm, celebrate, toast } from "@/components/ui/feedback";
import { Field, FormError, Select, SubmitButton, TextArea, TextInput } from "@/components/ui/form";
import { ComboBox } from "@/components/ui/ComboBox";
import { InstalmentSchedule } from "./InstalmentSchedule";
import { formatDate, formatEurMinor, formatInrMinor } from "@/lib/format";
import {
  optionsFrom, PAYMENT_METHOD_LABELS, PROGRAM_LEVEL_LABELS,
} from "@/lib/labels";
import type { InstalmentPlanConfig, PaymentTypesConfig } from "@/lib/config-schema";
import {
  paymentTypeKind, paymentTypeLabel, paymentTypeOptions,
  RECURRENCE_INTERVAL_LABELS, suggestNextBillingDate,
} from "@/lib/payment-types";
import { currenciesInPlay, defaultMethodFor, methodsForCurrencies } from "@/lib/payment-methods";
import { instalmentExtraFor } from "@/lib/instalment-plan";
import { minorToMajorString } from "@/lib/format";
import { AmountPair } from "@/components/ui/AmountPair";
import {
  firstShare, planShares, remainingShares, type MoneyText,
} from "@/lib/instalment-amounts";
import { StudentName } from "@/components/ui/StudentName";
import { money, moneyAlt, moneyInline, moneyValue } from "@/lib/money-display";
import { useFinanceCcy } from "./FinanceCurrency";
import { IncomeDetailCard } from "./IncomeDetailCard";
import { BUSINESS_LINE_LABELS, BUSINESS_LINES, type BusinessLine } from "@/lib/business-line";

/**
 * Whole days from `today` (an IST YYYY-MM-DD) to a due date. Compared as calendar dates, not
 * elapsed milliseconds: "due today" has to stay true all day, not stop being true at noon.
 */
function daysUntil(dueIso: string, today: string): number {
  const due = Date.parse(`${dueIso.slice(0, 10)}T00:00:00Z`);
  const from = Date.parse(`${today}T00:00:00Z`);
  if (Number.isNaN(due) || Number.isNaN(from)) return 0;
  return Math.round((due - from) / 86_400_000);
}

function dueLabel(days: number): string {
  if (days < 0) return `${-days} day${days === -1 ? "" : "s"} overdue`;
  if (days === 0) return "Due today";
  if (days === 1) return "Due tomorrow";
  return `In ${days} days`;
}

/**
 * How a row's payment method reads. "Other" is replaced by what the operator typed, because
 * "Other" on its own cannot be reconciled against anything - which is why the free-text box
 * exists at all. Falls back to the bare label for rows recorded before it did.
 */
function methodText(r: IncomeRow): string {
  if (r.paymentMethod === "OTHER" && r.paymentMethodOther?.trim()) return r.paymentMethodOther.trim();
  return PAYMENT_METHOD_LABELS[r.paymentMethod] ?? r.paymentMethod;
}

const minorToInput = (raw: string) => {
  const v = BigInt(raw);
  return v === BigInt(0) ? "" : (Number(v) / 100).toFixed(2);
};

export function IncomeSection({
  rows,
  today,
  studentOptions = [],
  studentCodeById = {},
  levelOptions,
  fxRate,
  fxStale,
  fxDate,
  canCreateStudent = false,
  upcomingByStudent = {},
  upcomingInstalments = [],
  levelLines = {},
  payerOptions = [],
  paymentTypes,
  instalmentPlans,
  nextStudentCodes,
}: {
  rows: IncomeRow[];
  today: string;
  studentOptions?: { value: string; label: string; hint?: string }[];
  studentCodeById?: Record<string, string>;
  levelOptions: { value: string; label: string }[];
  fxRate: number;
  fxStale?: boolean;
  fxDate?: string;
  /** Minting a student is an admin act (server/students-actions), so only an admin is offered it. */
  canCreateStudent?: boolean;
  /** Instalment dates still to come, keyed by student id or normalised name (see the page). */
  upcomingByStudent?: Record<string, { dueDate: string; inr: number; eur: number }[]>;
  /** Flat, date-ordered list for the reminder strip - overdue first, then soonest. */
  upcomingInstalments?: { studentName: string; dueDate: string; inr: number; eur: number }[];
  /**
   * Level code → which of the two businesses it belongs to (lib/business-line). DERIVED from the
   * level's kind on the server, never stored on the income row, so a level added later lands on
   * the right side with no backfill.
   */
  levelLines?: Record<string, BusinessLine>;
  /**
   * Names we have been paid by that have no `Student` row behind them (built on the server from
   * the income history already on this page). They carry no id, so picking one fills the name and
   * links nothing - which is what typing it by hand has always done, minus the typo.
   */
  payerOptions?: { value: string; label: string; hint?: string }[];
  /** The founder's configured payment types (Console → Payment Types). */
  paymentTypes: PaymentTypesConfig;
  /**
   * The instalment surcharge table, HANDED DOWN rather than fetched.
   *
   * It used to be read with a server action per keystroke on the instalment count, so the
   * surcharge - and therefore every amount in the schedule below - arrived a round trip late:
   * type "3" and the figures only caught up ~200ms later, and typing "12" showed the 1-instalment
   * answer on the way past. The table is a handful of numbers and no secret, so it travels with
   * the page and the arithmetic happens as you type.
   */
  instalmentPlans: InstalmentPlanConfig;
  /** The next free student number in each series, so the editable ID box opens pre-filled. */
  nextStudentCodes: Record<"B2" | "GERMAN_NOTE", string>;
}) {
  const { ccy } = useFinanceCcy();
  /**
   * Students first (they link), then payers we only know by name. `newStudentName` below is
   * deliberately still tested against `studentOptions` alone: a name that is merely familiar is
   * exactly the one that still needs a record creating.
   */
  const nameOptions = [...studentOptions, ...payerOptions];
  const [editing, setEditing] = useState<IncomeRow | null>(null);
  const [error, setError] = useState<string | null>(null);
  const formRef = useRef<HTMLFormElement>(null);
  // Which payment type the form currently shows - the instalment questions render only for
  // INSTALMENT. null = "follow the row being edited (or the default)", so entering/leaving
  // edit mode resets the answer along with the rest of the re-keyed form.
  const [paymentTypeChoice, setPaymentTypeChoice] = useState<string | null>(null);
  const paymentType = paymentTypeChoice ?? editing?.paymentType ?? "FULL_PAYMENT";
  /**
   * What the chosen type MEANS. The founder names the types; the kind is what this form branches
   * on, so a type they called "EMI" asks the instalment questions and one they called
   * "Membership" asks the recurring ones, with no code change here.
   */
  const typeKind = paymentTypeKind(paymentTypes, paymentType);
  /**
   * The two answers the schedule below is drawn from: how many instalments there are, and the
   * date this first one was paid. Held here rather than read off the DOM because the schedule
   * has to re-fill the moment either changes.
   */
  const [instalmentCount, setInstalmentCount] = useState<number | null>(
    editing?.instalmentCount ?? null,
  );
  const [entryDate, setEntryDate] = useState<string>(editing ? editing.date.slice(0, 10) : today);
  /**
   * Whether every due date has been filled in. An instalment plan saved with a blank date drops
   * that receivable on the floor - nothing chases a date nobody wrote down - so the save is held
   * until they are all there, and the button says so rather than failing on click.
   */
  const [scheduleComplete, setScheduleComplete] = useState(false);
  const needsSchedule = typeKind === "INSTALMENT" && !editing;
  const blockSave = needsSchedule && !scheduleComplete;
  /**
   * ── The fee, and how it is divided ────────────────────────────────────────────────
   * On an instalment plan the top box is the WHOLE agreed fee, not the money in hand: the fee
   * plus the plan surcharge is cut into equal instalments, the first of which is what is being
   * recorded today. So the label changes with the payment type, and the figures below are
   * derived rather than typed - see lib/instalment-amounts for why that matters.
   *
   * Editing never does this. The schedule of a plan already under way is not something an income
   * edit may silently redraw; that belongs in the receivable itself, under Pending.
   */
  const [feeAmount, setFeeAmount] = useState<MoneyText>({ inr: "", eur: "" });
  const [extraAmount, setExtraAmount] = useState<MoneyText>({ inr: "", eur: "" });
  const planMode = needsSchedule;
  const shares = planMode ? planShares(feeAmount, extraAmount, instalmentCount) : [];
  const banked = firstShare(shares);
  /**
   * ── The surcharge, priced in the Console and filled in HERE, as you type ──────────
   *
   * The founder prices each plan length once (Console → Instalment Plans: "3 → ₹600"), and this
   * form made the operator remember the figure and type it again - so the number the student was
   * quoted and the number recorded could differ by whatever anybody misremembered.
   *
   * Pre-filled now, from the same table and the same function the server prices with
   * (`instalmentExtraFor`), computed in the browser so it lands on the keystroke rather than a
   * round trip later. Still editable: a plan discounted on a call is a real thing, and the boxes
   * stay the operator's.
   *
   * Only the currency the fee was agreed in is filled. A rupee surcharge sitting beside a euro
   * fee would be ADDED to it (lib/money - the two columns sum), inventing a charge nobody made.
   */
  const feeCurrencies = currenciesInPlay(feeAmount);
  const pricedExtra = instalmentExtraFor(instalmentCount ?? 0, instalmentPlans);
  const extraDefaults = {
    inr: feeCurrencies.includes("INR") && pricedExtra.inr > BigInt(0) ? minorToMajorString(pricedExtra.inr) : "",
    eur: feeCurrencies.includes("EUR") && pricedExtra.eur > BigInt(0) ? minorToMajorString(pricedExtra.eur) : "",
  };
  /**
   * Re-keyed on the plan LENGTH and the currency - the two answers that re-price the surcharge -
   * so the box adopts the new figure. Deliberately NOT on the fee itself: the surcharge is flat,
   * and remounting on every digit would fight whoever is typing.
   */
  const extraKey = `extra-${instalmentCount ?? 0}-${feeCurrencies.join("+") || "none"}`;

  /**
   * ── The method, narrowed to the rails the money could have arrived by ─────────────
   * Held in state rather than read off the DOM because the list it is chosen from CHANGES with
   * the currency: pick UPI, then type a euro amount, and UPI is no longer offered. Letting the
   * control show a value absent from its own options is how a form submits something other than
   * what is on screen (lib/payment-methods `defaultMethodFor`).
   */
  const [methodChoice, setMethodChoice] = useState<string | null>(null);
  const methodOptions = methodsForCurrencies(feeCurrencies).map((m) => ({
    value: m,
    label: PAYMENT_METHOD_LABELS[m] ?? m,
  }));
  const paymentMethod = defaultMethodFor(
    feeCurrencies,
    methodChoice ?? editing?.paymentMethod ?? "UPI",
  );

  /**
   * How often a recurring arrangement bills. The next date is SUGGESTED from the interval and
   * the entry date and then left alone - real subscriptions bill on the 1st, or on the day the
   * card was set up, and overwriting a date somebody typed is worse than suggesting none.
   */
  const [interval, setInterval] = useState<string>(editing?.recurrenceInterval ?? "MONTHLY");
  const [nextBilling, setNextBilling] = useState<string>(
    editing?.recurrenceNextDate?.slice(0, 10) ?? "",
  );
  /**
   * ── Which book this payment lands in ──────────────────────────────────────────────
   * The programme level decides it: a German level or bundle credits German Note, anything else
   * credits B2 (lib/business-line, and `incomeAccountFor` for the matching ledger account). It is
   * worth saying out loud on the form, because the Finance page above has its own Combined / B2 /
   * German Note switch and the two are NOT the same thing - the switch filters what you are
   * reading, the level decides where the money you are typing actually goes. Someone recording a
   * payment while the page is filtered to German Note would otherwise have no way to notice the
   * level still said Guided.
   */
  const [levelChoice, setLevelChoice] = useState<string | null>(null);
  /**
   * ── Which business, asked OUT LOUD ────────────────────────────────────────────────
   * The line is still derived from the level - nothing about it is stored, and it could not be,
   * because an income row has only a level column. What changed is the order you are asked in:
   * the operator used to have to KNOW that "Guided" means B2 and "GN A2" means German Note, and
   * read the answer back off the heading after the fact. Now the business is the first choice,
   * and it narrows the level list to the levels that business actually sells - so the two can
   * never disagree, and the common mistake (recording a German payment against Guided because
   * Guided was the default) stops being reachable rather than merely being labelled.
   *
   * null = "follow the row being edited", so entering and leaving edit mode re-reads it.
   */
  const [lineChoice, setLineChoice] = useState<BusinessLine | null>(null);
  const rowLevel = editing?.programLevel ?? "GUIDED";
  const line: BusinessLine = lineChoice ?? levelLines[rowLevel] ?? "B2";
  /** Only the levels this business sells. */
  const lineLevelOptions = levelOptions.filter((o) => (levelLines[o.value] ?? "B2") === line);
  const wantedLevel = levelChoice ?? rowLevel;
  /**
   * COERCED into the business on screen. A select showing a value that is not among its own
   * options submits something other than what is on screen (the same trap `defaultMethodFor`
   * guards above), and switching B2 → German Note leaves "Guided" selected against a list that
   * no longer contains it. Falls back to the business's first level, or to "" when a business
   * has no active level at all - which the field says, rather than silently posting a level
   * belonging to the other book.
   */
  const programLevel = lineLevelOptions.some((o) => o.value === wantedLevel)
    ? wantedLevel
    : (lineLevelOptions[0]?.value ?? "");
  const entryLine: BusinessLine = levelLines[programLevel] ?? line;
  const lineLabel = BUSINESS_LINE_LABELS[entryLine];
  /** The next free number in THIS payment's series - what the editable ID box opens on. */
  const suggestedCode = nextStudentCodes[entryLine] ?? nextStudentCodes.B2;
  /** The row whose full record is open. Reading, not editing - see IncomeDetailCard. */
  const [viewing, setViewing] = useState<IncomeRow | null>(null);
  const switchEditing = (row: IncomeRow | null) => {
    setEditing(row);
    setPaymentTypeChoice(null);
    setLineChoice(null);
    setLevelChoice(null);
    setMethodChoice(null);
    setInterval(row?.recurrenceInterval ?? "MONTHLY");
    setNextBilling(row?.recurrenceNextDate?.slice(0, 10) ?? "");
    setStudentPick({ text: row?.studentName ?? "", value: row?.studentId ?? "" });
  };
  /**
   * What the student box currently holds. `value` is the resolved student id, so an empty one
   * beside non-empty text is exactly the case the "create this student" offer exists for.
   * Compared on the same normalisation the server links names with (case + spacing), so an
   * existing "anna  smith" is never offered as a new record.
   */
  const [studentPick, setStudentPick] = useState({ text: "", value: "" });
  /**
   * Whether this entry is also minting a student record. Controlled (it used to be
   * `defaultChecked`) because the ID box below only exists while it is ticked - an uncontrolled
   * box would leave the field on screen with nothing deciding whether it applies.
   */
  const [mintStudent, setMintStudent] = useState(true);
  const nameKey = (s: string) => s.trim().toLowerCase().replace(/\s+/g, " ");
  /** The dates still to come for the plan this row belongs to, soonest first. */
  const upcomingFor = (r: IncomeRow) => upcomingByStudent[r.studentId ?? nameKey(r.studentName)] ?? [];
  const typedName = studentPick.text.trim();
  const newStudentName =
    typedName && !studentPick.value && !studentOptions.some((o) => nameKey(o.label) === nameKey(typedName))
      ? typedName
      : "";
  // Optimistic delete: hide the row at once, restore it if the archive fails.
  const [removedIds, setRemovedIds] = useState<Set<string>>(new Set());
  const visibleRows = rows.filter((r) => !removedIds.has(r.id));

  const submit = async (form: FormData) => {
    setError(null);
    const res = editing ? await updateIncome(editing.id, form) : await createIncome(form);
    if (!res.ok) return setError(res.error);
    toast(editing ? "Income entry updated" : "Payment recorded");
    if (!editing) celebrate(); // money in the door - worth confetti (edits stay quiet)
    switchEditing(null);
    formRef.current?.reset();
    /**
     * `form.reset()` restores the native boxes, but these four are React state fed by `onChange`
     * - and reset fires no change event. Left alone they carried the last payment's plan into
     * the next one: the schedule kept its dates, and the save button stayed open on a count that
     * was no longer typed anywhere.
     */
    setInstalmentCount(null);
    setEntryDate(today);
    setScheduleComplete(false);
    setFeeAmount({ inr: "", eur: "" });
    setExtraAmount({ inr: "", eur: "" });
    setLineChoice(null);
    setLevelChoice(null);
    setMethodChoice(null);
    setInterval("MONTHLY");
    setNextBilling("");
  };

  const remove = async (row: IncomeRow) => {
    const ok = await askConfirm({
      title: `Archive income entry for ${row.studentName}?`,
      body: "It moves to the Archived tab - you can restore it there.",
      confirmLabel: "Archive",
      danger: true,
    });
    if (!ok) return;
    setRemovedIds((s) => new Set(s).add(row.id)); // optimistic
    const res = await deleteIncome(row.id);
    if (!res.ok) {
      setRemovedIds((s) => {
        const n = new Set(s);
        n.delete(row.id);
        return n;
      });
      return toast(res.error, "error");
    }
    toast("Income entry archived");
  };

  const columns: Column<IncomeRow>[] = [
    { key: "date", header: "Date", cell: (r) => formatDate(r.date), value: (r) => r.date.slice(0, 10) },
    {
      key: "student", header: "Student",
      cell: (r) => <StudentName name={r.studentName} code={r.studentId ? studentCodeById[r.studentId] : null} />,
      // the code joins the sort/filter/CSV value so "B2-0007" finds the row
      value: (r) =>
        r.studentId && studentCodeById[r.studentId]
          ? `${r.studentName} ${studentCodeById[r.studentId]}`
          : r.studentName,
    },
    // The two "as entered" columns stay currency-LABELLED, because that is what they are: the
    // money that actually arrived in that currency, and a dash where none did. Converting them
    // would erase the very distinction (a €500 PayPal payment vs a ₹54,372 UPI one).
    {
      key: "inr", header: "Received (₹)", align: "right",
      cell: (r) => (BigInt(r.amountInrRaw) === BigInt(0) ? "-" : formatInrMinor(BigInt(r.amountInrRaw))),
      value: (r) => Number(BigInt(r.amountInrRaw)) / 100,
    },
    {
      key: "eur", header: "Received (€)", align: "right",
      cell: (r) => (BigInt(r.amountEurRaw) === BigInt(0) ? "-" : formatEurMinor(BigInt(r.amountEurRaw))),
      value: (r) => Number(BigInt(r.amountEurRaw)) / 100,
    },
    // The aggregate DOES follow the toggle - it is one amount quoted two ways, so which way
    // leads is exactly the reader's choice.
    {
      key: "agg", header: "Total", align: "right",
      cell: (r) => moneyInline(r.agg, ccy, { compact: true }),
      value: (r) => moneyValue(r.agg, ccy),
    },
    { key: "level", header: "Level", cell: (r) => PROGRAM_LEVEL_LABELS[r.programLevel] ?? r.programLevel, value: (r) => PROGRAM_LEVEL_LABELS[r.programLevel] ?? r.programLevel },
    {
      key: "type", header: "Type",
      cell: (r) => {
        /**
         * Everything below applies to an instalment payment WITH OR WITHOUT a stored count.
         * The count only arrived when the entry form started asking for it, so every payment
         * recorded before that reads as a bare "Instalment" - and those are exactly the plans
         * whose dates are worth showing, because nothing else on the row hints they exist.
         */
        const label = paymentTypeLabel(paymentTypes, r.paymentType);
        const kind = paymentTypeKind(paymentTypes, r.paymentType);
        if (kind === "SUBSCRIPTION") {
          return (
            <span>
              {label}
              <span className="block text-caption text-muted">
                {RECURRENCE_INTERVAL_LABELS[r.recurrenceInterval ?? ""] ?? "Recurring"}
                {r.recurrenceNextDate ? ` · next ${formatDate(r.recurrenceNextDate)}` : ""}
              </span>
            </span>
          );
        }
        if (kind !== "INSTALMENT") return label;
        const extraInr = BigInt(r.instalmentExtraInrRaw);
        const extraEur = BigInt(r.instalmentExtraEurRaw);
        const extras = [
          ...(extraInr > BigInt(0) ? [formatInrMinor(extraInr)] : []),
          ...(extraEur > BigInt(0) ? [formatEurMinor(extraEur)] : []),
        ];
        /**
         * The plan's REMAINING dates, not just its length. "Instalment · 3×" said how the fee
         * was split and nothing about when the rest of it arrives, so the dates captured on this
         * very form were invisible from the row that captured them - readable only by opening
         * the receivable under Pending payments.
         */
        const upcoming = upcomingFor(r);
        return (
          <span>
            {label}
            {r.instalmentCount ? ` · ${r.instalmentCount}×` : ""}
            {extras.length > 0 && (
              // As-entered again: the surcharge is stored in the currency it was charged in.
              <span className="block text-caption text-muted">+{extras.join(" + ")} extra</span>
            )}
            {upcoming.length > 0 && (
              <span className="block text-caption text-muted" title={upcoming.map((u) => formatDate(u.dueDate)).join(" · ")}>
                Next due {formatDate(upcoming[0].dueDate)}
                {upcoming.length > 1 && ` · ${upcoming.length - 1} more after`}
              </span>
            )}
          </span>
        );
      },
      // the count joins the filter/CSV value so "3" or "instalment" finds the row
      // The count and the next date join the filter/CSV value, so "3x" or a date finds the row.
      value: (r) => {
        const label = paymentTypeLabel(paymentTypes, r.paymentType);
        if (paymentTypeKind(paymentTypes, r.paymentType) !== "INSTALMENT") return label;
        const next = upcomingFor(r)[0];
        return [
          label,
          r.instalmentCount ? `(${r.instalmentCount}x)` : "",
          next ? `next ${formatDate(next.dueDate)}` : "",
        ]
          .filter(Boolean)
          .join(" ");
      },
    },
    {
      key: "method", header: "Method",
      // "Other" alone says nothing, so the typed answer replaces it - that note is the only
      // record of which rail the money actually came down.
      cell: (r) => methodText(r),
      value: (r) => methodText(r),
    },
    { key: "notes", header: "Notes", cell: (r) => r.notes ?? "", value: (r) => r.notes ?? "" },
    {
      key: "actions", header: "", sortable: false,
      cell: (r) => (
        <span className="flex gap-2 whitespace-nowrap">
          <Btn variant="ghost" size="sm" onClick={() => switchEditing(r)}>Edit</Btn>
          <Btn variant="danger" size="sm" onClick={() => remove(r)}>Delete</Btn>
        </span>
      ),
      value: () => null,
    },
  ];

  return (
    <section className="space-y-4">
      <Card
        /**
         * A node, not a string, so the business line can sit beside the heading in a quieter
         * weight - it is context for the heading, not part of its name. `Card` renders a plain
         * string as the h2 itself, so the heading styles come with us.
         */
        title={
          <h2 className="flex flex-wrap items-baseline gap-x-2 font-display text-h3 text-ink">
            <span>{editing ? `Edit income - ${editing.studentName}` : "Income entry"}</span>
            <span className="text-body text-muted">- {lineLabel}</span>
          </h2>
        }
        subtitle={`Recorded against ${lineLabel} - pick the business below, then its programme level.`}
        actions={
          editing ? (
            <Btn variant="ghost" size="sm" onClick={() => switchEditing(null)}>
              Cancel edit
            </Btn>
          ) : undefined
        }
      >
        <form ref={formRef} action={submit} key={editing?.id ?? "new"}>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <Field label="Date">
            {/* On a NEW entry the browser fills in ITS today (FIN-02): the server default is
                India's date, which is already tomorrow for anyone recording from Germany after
                20:30. Editing keeps the date the row was saved with. */}
            <TextInput
              type="date"
              name="date"
              required
              defaultValue={editing ? editing.date.slice(0, 10) : today}
              defaultToday={!editing}
              onChange={(e) => setEntryDate(e.currentTarget.value)}
            />
          </Field>
          {/*
            ── Student name ──────────────────────────────────────────────────────────────
            Searchable ALWAYS, even with an empty roster. The box used to fall back to a plain
            text input whenever no student existed, which is the state a new install is in: the
            operator saw an ordinary "Who paid" field, nothing ever auto-populated, and every
            payment was filed under a typed name that reached no student's payment history -
            with nothing on screen saying why. An empty roster is now something the field SAYS,
            and offers to fix.
          */}
          <Field label="Student name" hint="Search to link a student - feeds their total paid">
            <ComboBox
              options={nameOptions}
              nameText="studentName"
              nameValue="studentId"
              required
              placeholder={nameOptions.length > 0 ? "Search or type who paid" : "Type who paid"}
              defaultText={editing?.studentName ?? ""}
              defaultValue={editing?.studentId ?? ""}
              onStateChange={setStudentPick}
              emptyHint={
                nameOptions.length > 0
                  ? undefined
                  : "Nobody on file yet - type the name, then tick “Create a student record” below."
              }
            />
            {/*
              Offered only when the typed name resolved to nobody. Ticking it mints the student
              record with this payment, which is the only way a first payment can ever reach a
              payment history: until a Student row exists there is nothing for it to attach to.
            */}
            {canCreateStudent && !editing && newStudentName && (
              <>
                <label className="mt-2 flex items-start gap-2">
                  <input
                    name="createStudent"
                    type="checkbox"
                    checked={mintStudent}
                    onChange={(e) => setMintStudent(e.currentTarget.checked)}
                    className="mt-0.5 h-4 w-4 rounded border-line"
                  />
                  <span className="text-caption">
                    Create a student record for “{newStudentName}”
                    <span className="block text-muted">
                      Links this payment - and any earlier one under the same name - to their history.
                      You can fill in the rest under Students.
                    </span>
                  </span>
                </label>
                {/*
                  ── The student ID, editable while it is being minted ──────────────────────
                  Generated as the next free number in the series this payment's programme level
                  belongs to - B2-0001… for a B2 level, GN-0001… for a German one - and offered
                  for editing HERE, which is the only moment it can be set without a second trip
                  to the Students screen. The number is printed on agreements and read down a
                  phone line, so a record carried over from other paperwork has to be able to
                  keep its own identifier. Blank falls back to the generated one; a duplicate is
                  refused by the database, not by a guess.
                */}
                {mintStudent && (
                  <Field
                    label="Student ID"
                    hint={`Next free ${entryLine === "GERMAN_NOTE" ? "German Note" : "B2"} number - edit it if this student already has one`}
                  >
                    <TextInput
                      name="newStudentCode"
                      // Re-keyed on the level's business line so switching Guided → A1 adopts the
                      // other series instead of leaving a B2 number on a German Note student.
                      key={`code-${entryLine ?? "B2"}`}
                      maxLength={24}
                      spellCheck={false}
                      placeholder={suggestedCode}
                      defaultValue={suggestedCode}
                    />
                  </Field>
                )}
              </>
            )}
          </Field>
          {/*
            The boxes are RENAMED on a plan, not just relabelled. `amountInr` is what gets
            banked, and on a plan that is one instalment - so the typed total goes to a name the
            action does not read, and the hidden pair below carries the first share instead.
            Renaming rather than quietly submitting something other than what is on screen is
            the whole point: the two halves of the field agree about what they mean.
          */}
          <AmountPair
            fxRate={fxRate}
            fxStale={fxStale}
            fxDate={fxDate}
            inrName={planMode ? "planTotalInr" : "amountInr"}
            eurName={planMode ? "planTotalEur" : "amountEur"}
            inrLabel={planMode ? "Total price (₹)" : "Price received (₹)"}
            eurLabel={planMode ? "Total price (€)" : "Price received (€)"}
            baseHint={planMode ? "The whole fee - divided across the instalments below" : "INR, EUR, or both"}
            defaultInr={editing ? minorToInput(editing.amountInrRaw) : ""}
            defaultEur={editing ? minorToInput(editing.amountEurRaw) : ""}
            onAmountsChange={setFeeAmount}
          />
          {planMode && (
            <>
              <input type="hidden" name="amountInr" value={banked.inr} />
              <input type="hidden" name="amountEur" value={banked.eur} />
            </>
          )}
          {/*
            Carries no `name`: the business is NOT submitted, because nothing stores it. It is a
            filter on the question below, and the server re-derives the line from the level it
            is sent - one authority (lib/business-line), not a second field that could disagree.
          */}
          <Field label="Business" hint="Which book this payment lands in - it narrows the levels below.">
            <Select
              options={BUSINESS_LINES.map((l) => ({ value: l, label: BUSINESS_LINE_LABELS[l] }))}
              value={line}
              onChange={(e) => {
                setLineChoice(e.currentTarget.value as BusinessLine);
                // Drop the old level rather than carry it across: it belongs to the other book.
                setLevelChoice(null);
              }}
            />
          </Field>
          <Field
            label="Programme level"
            hint={lineLevelOptions.length === 0 ? `No active ${lineLabel} level - add one first.` : undefined}
          >
            <Select
              name="programLevel"
              options={lineLevelOptions}
              value={programLevel}
              placeholder={lineLevelOptions.length === 0 ? "Nothing to choose" : undefined}
              onChange={(e) => setLevelChoice(e.currentTarget.value)}
            />
          </Field>
          {/* The list is the founder's (Console → Payment Types), and the chosen type's KIND is
              what decides which questions appear below - instalment, recurring, or none. */}
          <Field label="Payment type">
            <Select
              name="paymentType"
              options={paymentTypeOptions(paymentTypes, editing?.paymentType)}
              value={paymentType}
              onChange={(e) => setPaymentTypeChoice(e.currentTarget.value)}
            />
          </Field>
          {/* ── A recurring arrangement ────────────────────────────────────────────────
              A subscription has no agreed total and no finite schedule, so it asks two questions
              instead of a plan's four - and raises NO receivable, which is the whole reason it
              could not simply be filed as an instalment plan. */}
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
                    // Suggested, never imposed: only filled while the box is still untouched.
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
          {/* Instalment plans carry two more answers: how many instalments the fee is split
              into, and the surcharge added for choosing the plan. Asked only when it applies -
              a full payment keeps the short form. */}
          {typeKind === "INSTALMENT" && (
            <>
              <Field label="Number of instalments" hint="How many instalments the fee is split into">
                <TextInput
                  kind="int"
                  name="instalmentCount"
                  required
                  placeholder="e.g. 3"
                  defaultValue={editing?.instalmentCount ? String(editing.instalmentCount) : ""}
                  onChange={(e) => {
                    const n = Number.parseInt(e.currentTarget.value, 10);
                    setInstalmentCount(Number.isFinite(n) && n > 0 ? n : null);
                  }}
                />
              </Field>
              <AmountPair
                // Re-keyed so the Console's price for THIS plan length is adopted the instant
                // the count changes - see `extraKey`.
                key={editing ? "extra-edit" : extraKey}
                fxRate={fxRate}
                fxStale={fxStale}
                fxDate={fxDate}
                inrName="instalmentExtraInr"
                eurName="instalmentExtraEur"
                inrLabel="Extra price (₹)"
                eurLabel="Extra price (€)"
                baseHint={
                  !editing && (extraDefaults.inr || extraDefaults.eur)
                    ? `The Console price for a ${instalmentCount}-part plan - change it if this one was agreed differently`
                    : "Added to the fee for paying in instalments"
                }
                defaultInr={editing ? minorToInput(editing.instalmentExtraInrRaw) : extraDefaults.inr}
                defaultEur={editing ? minorToInput(editing.instalmentExtraEurRaw) : extraDefaults.eur}
                onAmountsChange={setExtraAmount}
              />
              {/* Only on a NEW entry. Editing an income row must not silently rewrite a schedule
                  the student has already agreed to and may have started paying against - that
                  edit belongs in the receivable itself, under Pending. */}
              {!editing && (
                <InstalmentSchedule
                  count={instalmentCount}
                  anchorDate={entryDate}
                  shares={remainingShares(shares)}
                  bankedToday={banked}
                  onCompleteChange={setScheduleComplete}
                />
              )}
            </>
          )}
          {/* ── Only the rails the entered currency can arrive by ──────────────────────
              A euro payment cannot have come in by UPI and a rupee one cannot have come in by
              PayPal, and the method is what a bank statement is reconciled against - so the list
              follows the currency typed above (lib/payment-methods). A genuine split payment
              shows both sets, because then both rails were used. */}
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
                defaultValue={editing?.paymentMethodOther ?? ""}
              />
            </Field>
          )}
          <Field label="Notes (optional)">
            <TextInput kind="text" name="notes" placeholder="Any extra info" defaultValue={editing?.notes ?? ""} />
          </Field>
        </div>
        <div className="mt-4 flex flex-wrap items-center gap-3">
          <SubmitButton
            disabled={blockSave}
            title="Every instalment needs a due date before this can be saved"
          >
            {editing ? "Save changes" : "Add income"}
          </SubmitButton>
          {blockSave && (
            <p className="text-caption text-muted">
              Fill in every due date above to save this plan.
            </p>
          )}
          <FormError message={error} />
        </div>
        </form>
      </Card>

      {/*
        ── The reminder, where the money work happens ────────────────────────────────────
        An instalment date written down on the entry form used to be visible only inside the
        receivable, two tabs away. Nothing on the screen where payments are recorded said who
        owes what this week, so the first anyone heard of a date was the dunning ladder chasing
        it after the fact. Overdue leads; "today" and "tomorrow" are spelled out, because those
        are the two that change what someone does this morning.
      */}
      {upcomingInstalments.length > 0 && (
        <Card title="Instalment dates coming up">
          <ul className="divide-y divide-line">
            {upcomingInstalments.map((u, i) => {
              const days = daysUntil(u.dueDate, today);
              const late = days < 0;
              return (
                <li key={`${u.studentName}-${u.dueDate}-${i}`} className="flex flex-wrap items-center justify-between gap-2 py-2 text-sm">
                  <span className="min-w-0 flex-1 truncate font-medium">{u.studentName}</span>
                  <span className="tnum text-muted">{formatDate(u.dueDate)}</span>
                  <span
                    className={`rounded-full px-2 py-0.5 text-caption font-medium ${
                      late ? "bg-bad-soft text-bad" : days <= 2 ? "bg-warn-soft text-warn" : "bg-surface-2 text-muted"
                    }`}
                  >
                    {dueLabel(days)}
                  </span>
                  <span className="tnum w-28 text-right">
                    {moneyInline({ inr: u.inr, eur: u.eur }, ccy, { compact: true })}
                  </span>
                </li>
              );
            })}
          </ul>
        </Card>
      )}

      {/* Clicking a row opens the whole record (notes, method, as-entered amounts, where it came
          from) rather than only the part that fitted in a column. Edit and Delete still do their
          own job - DataTable ignores a click that started on a control. */}
      <DataTable
        rows={visibleRows}
        columns={columns}
        csvName="income"
        filterPlaceholder="Filter income…"
        onRowClick={setViewing}
      />

      <IncomeDetailCard
        row={viewing}
        studentCode={viewing?.studentId ? studentCodeById[viewing.studentId] : null}
        levelLabel={
          viewing
            ? levelOptions.find((o) => o.value === viewing.programLevel)?.label ??
              PROGRAM_LEVEL_LABELS[viewing.programLevel] ??
              viewing.programLevel
            : ""
        }
        line={viewing ? levelLines[viewing.programLevel] : undefined}
        paymentTypes={paymentTypes}
        upcoming={viewing ? upcomingFor(viewing) : undefined}
        onEdit={(row) => {
          setViewing(null);
          switchEditing(row);
          // The form is at the top of the tab; opening it from a row 40 deep otherwise looks
          // like the click did nothing.
          formRef.current?.scrollIntoView({ behavior: "smooth", block: "center" });
        }}
        onClose={() => setViewing(null)}
      />
    </section>
  );
}
