"use client";

import { useMemo, useRef, useState } from "react";
import { createIncome, deleteIncome, updateIncome } from "@/server/finance-actions";
import type { IncomeRow } from "@/server/finance-metrics";
import { DataTable, type Column } from "@/components/ui/DataTable";
import { Card } from "@/components/ui/kit";
import { Btn } from "@/components/ui/controls";
import { askConfirm, celebrate, toast } from "@/components/ui/feedback";
import { guardAction } from "@/lib/action-guard";
import type { IncomeFormCatalogues, IncomeFormEditing } from "@/lib/income-form";
import { useIncomeDraft } from "@/components/finance/useIncomeDraft";
import { IncomeFields } from "@/components/finance/IncomeFields";
import { Field, FormError, NotesField, Select, SubmitButton, TextArea, TextInput } from "@/components/ui/form";
import { ComboBox } from "@/components/ui/ComboBox";
import { useUnsavedGuard } from "@/components/ui/use-unsaved-guard";
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
import { majorStringToMinor, minorToMajorString } from "@/lib/format";
import { AmountPair } from "@/components/ui/AmountPair";
import {
  firstShare, planShares, remainingShares, type MoneyText,
} from "@/lib/instalment-amounts";
import { StudentName } from "@/components/ui/StudentName";
import { money, moneyAlt, moneyInline, moneyValue } from "@/lib/money-display";
import { useFinanceCcy } from "./FinanceCurrency";
import { IncomeDetailCard } from "./IncomeDetailCard";
import { BUSINESS_LINE_LABELS, BUSINESS_LINES, type BusinessLine } from "@/lib/business-line";
import { safeAction } from "@/lib/action-guard";

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
  upcomingByPlan = {},
  openPlans = [],
  upcomingInstalments = [],
  levelLines = {},
  defaultLine = null,
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
  /** Keyed by receivable - what a payment that names its plan should show (issue 24). */
  upcomingByPlan?: Record<string, { dueDate: string; inr: number; eur: number }[]>;
  /**
   * Every receivable still owed something, so a payment can say WHICH ONE it pays off (FIN-12).
   *
   * Without this the form could only ever record a payment against a student, and the balance
   * maths had to guess which of their plans the money was for - which is how four plans came to
   * share one payment history. The whole list travels with the page (it is small, and scoped
   * client-side as the name is typed) rather than a round trip per keystroke.
   */
  openPlans?: {
    id: string;
    studentId: string | null;
    studentName: string;
    programLevel: string;
    levelLabel: string;
    balanceInr: number;
    nextDueDate: string | null;
  }[];
  /** Flat, date-ordered list for the reminder strip - overdue first, then soonest. */
  upcomingInstalments?: { studentName: string; dueDate: string; inr: number; eur: number }[];
  /**
   * Level code → which of the two businesses it belongs to (lib/business-line). DERIVED from the
   * level's kind on the server, never stored on the income row, so a level added later lands on
   * the right side with no backfill.
   */
  levelLines?: Record<string, BusinessLine>;
  /** The page's Combined / B2 / German Note switch, when it is on one of the two businesses. */
  defaultLine?: BusinessLine | null;
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
  // Warn before a refresh or a tab close throws away a half-typed entry.
  useUnsavedGuard(formRef);

  /**
   * ── The form's answers, as ONE object ───────────────────────────────────────────
   * This was thirteen `useState` hooks and five `xChoice ?? editing?.x ?? default` triples, each
   * needing a hand-written reset in TWO places - and the two places had already drifted apart:
   * `switchEditing` cleared eight of them, the post-submit path cleared a different eleven, and
   * `mintStudent` was cleared by neither. The visible consequence was that clicking Edit
   * part-way through a new instalment plan carried that plan's fee across, which then narrowed
   * the payment-method list of the row being edited to the abandoned draft's currency.
   *
   * One object, one reset, one derivation. The rules live in `lib/income-form` - pure, and
   * covered by 43 tests that need no browser - and they are the SAME rules the top-bar Quick
   * Record runs, which is what stops the two forms diverging again.
   */
  const catalogues: IncomeFormCatalogues = useMemo(
    () => ({
      levelOptions, levelLines, paymentTypes, instalmentPlans,
      studentOptions, openPlans, nextStudentCodes, today, defaultLine,
    }),
    [levelOptions, levelLines, paymentTypes, instalmentPlans, studentOptions, openPlans, nextStudentCodes, today, defaultLine],
  );
  /** The edited row, reduced to the fields the rules read off it. */
  const editingForForm: IncomeFormEditing = useMemo(
    () =>
      editing
        ? {
            id: editing.id,
            date: editing.date,
            studentName: editing.studentName,
            studentId: editing.studentId,
            programLevel: editing.programLevel,
            paymentType: editing.paymentType,
            paymentMethod: editing.paymentMethod,
            pendingPaymentId: editing.pendingPaymentId,
            instalmentCount: editing.instalmentCount,
            recurrenceInterval: editing.recurrenceInterval,
            recurrenceNextDate: editing.recurrenceNextDate,
          }
        : null,
    [editing],
  );
  const { draft, patch, reset, derived } = useIncomeDraft(editingForForm, catalogues);
  const {
    line, lineLevelOptions, programLevel, entryLine, lineLabel,
    paymentType, typeKind, needsSchedule, blockSave, blockSaveReason, planMode,
    shares, banked, methodOptions, paymentMethod, extraDefaults, extraKey,
    plansForPayer, planOptions, pendingPaymentId, newStudentName, suggestedCode,
  } = derived;
  // Local aliases so the markup below reads as it always did.
  const entryDate = derived.date;
  const feeCurrencies = derived.feeCurrencies;
  const interval = derived.recurrenceInterval;
  const nextBilling = derived.recurrenceNextDate;
  const instalmentCount = draft.instalmentCount;
  const mintStudent = draft.mintStudent;

  /** The row whose full record is open. Reading, not editing - see IncomeDetailCard. */
  const [viewing, setViewing] = useState<IncomeRow | null>(null);
  /** Load a row into the form AND take the eye there (issue 21). */
  const startEdit = (row: IncomeRow) => {
    switchEditing(row);
    formRef.current?.scrollIntoView({ behavior: "smooth", block: "center" });
  };
  const switchEditing = (row: IncomeRow | null) => {
    setEditing(row);
    /**
     * Every answer back to "not answered", so the derivation re-reads the row (or the defaults).
     * The student box is the one answer with nothing to re-read - it is typed into freely - so it
     * is seeded. This line replaces eight setters that had drifted out of step with the eleven
     * on the submit path.
     */
    reset({ student: { text: row?.studentName ?? "", value: row?.studentId ?? "" } });
    setError(null);
  };
  const nameKey = (s: string) => s.trim().toLowerCase().replace(/\s+/g, " ");
  /**
   * The dates still to come for the plan this row belongs to, soonest first.
   *
   * ── Per PLAN where the row names one (issue 24) ─────────────────────────────────
   * This only ever looked up by student, so a row whose plan had one instalment left read "10
   * more after" - it was counting every unpaid instalment the student had, across all of their
   * plans. A payment that names its receivable now gets that receivable's own tail; one that
   * does not falls back to the student-wide list, which is the best answer available for a row
   * recorded before the link existed.
   */
  const upcomingFor = (r: IncomeRow) =>
    (r.pendingPaymentId ? upcomingByPlan[r.pendingPaymentId] : undefined) ??
    upcomingByStudent[r.studentId ?? nameKey(r.studentName)] ??
    [];
  // Optimistic delete: hide the row at once, restore it if the archive fails.
  const [removedIds, setRemovedIds] = useState<Set<string>>(new Set());
  const visibleRows = rows.filter((r) => !removedIds.has(r.id));

  const submit = async (form: FormData) => {
    setError(null);
    /**
     * ── Minting a student is confirmed, not assumed (issue 13) ────────────────────
     * The tick box has always been visible, but it defaults to ON - which is right for the
     * common case (a first payment from somebody new) and wrong for the one that matters (a
     * mistyped name, which silently added a student and burned a B2 number). The dialog names
     * the student about to be created, so a typo is caught by reading rather than by noticing.
     */
    if (!editing && mintStudent && newStudentName) {
      const ok = await askConfirm({
        title: `Create a new student called "${newStudentName}"?`,
        body: `Nobody on the roster matches that name, so a new student record will be created with ID ${suggestedCode}. If this is somebody who already exists, close this and pick them from the list instead.`,
        confirmLabel: "Create and record",
      });
      if (!ok) return;
    }
    /**
     * ── An identical payment is confirmed, not silently doubled ───────────────────
     * Two payments with the same date, student and amount are accepted without a murmur, and
     * sometimes that is genuinely what happened - two siblings, two levels, a part payment
     * repeated. But it is also exactly what a double-submitted form looks like, and the ledger
     * has no way to tell them apart afterwards.
     *
     * So: a prompt, never a block. The person recording it knows which of the two this is; the
     * app does not.
     */
    if (!editing) {
      const typedInr = String(form.get("amountInr") ?? "").trim();
      const typedEur = String(form.get("amountEur") ?? "").trim();
      const twin = rows.find(
        (r) =>
          r.date.slice(0, 10) === String(form.get("date") ?? "") &&
          nameKey(r.studentName) === nameKey(String(form.get("studentName") ?? "")) &&
          // Compared in MINOR units, because the form's canonical "500" and the stored
          // "50000" paise are the same amount written two ways.
          r.amountInrRaw === majorStringToMinor(typedInr || "0").toString() &&
          r.amountEurRaw === majorStringToMinor(typedEur || "0").toString(),
      );
      if (twin) {
        const ok = await askConfirm({
          title: "There is already an identical payment",
          body: `${twin.studentName} already has a payment of the same amount recorded on ${formatDate(twin.date)}. Save this one as well only if the money really arrived twice.`,
          confirmLabel: "Yes, record both",
        });
        if (!ok) return;
      }
    }
    /**
     * ── A dead network no longer costs the whole form (issue 10) ──────────────────
     * This was a bare await, so submitting while offline threw past the form to the route error
     * boundary: the page replaced by "Finance couldn't load" and every field lost. See
     * lib/action-guard.
     */
    const guarded = await guardAction(() =>
      editing ? updateIncome(editing.id, form) : createIncome(form),
    );
    if (!guarded.ok) return setError(guarded.error);
    const res = guarded.value;
    if (!res.ok) return setError(res.error);
    toast(editing ? "Income entry updated" : "Payment recorded");
    if (!editing) celebrate(); // money in the door - worth confetti (edits stay quiet)
    /**
     * `form.reset()` restores the native boxes; `switchEditing(null)` clears every React-held
     * answer, because `form.reset()` fires no change event and those would otherwise carry the
     * last payment's plan into the next one. Two lines where there were thirteen - and it is the
     * SAME two lines `switchEditing` runs, so they can no longer drift apart.
     */
    switchEditing(null);
    formRef.current?.reset();
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
    const res = await safeAction(() => deleteIncome(row.id));
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
          {/*
            Scrolls to the form, like the detail drawer's Edit already did (issue 21). The form
            is at the top of the tab, so opening it from a row forty deep otherwise looked exactly
            like a click that did nothing - and the row being edited is tinted, so there is no
            doubt about which one is loaded.
          */}
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
        /**
         * A node, not a string, so the business line can sit beside the heading in a quieter
         * weight - it is context for the heading, not part of its name. `Card` renders a plain
         * string as the h2 itself, so the heading styles come with us.
         */
        title={
          <h2 className="flex flex-wrap items-baseline gap-x-2 font-display text-h3 text-ink">
            <span>{editing ? `Edit income - ${editing.studentName}` : "Income entry"}</span>
            {/* Named only once there IS a book. Under "Combined" this used to read "- B2",
                which announced a destination nobody had chosen. */}
            {lineLabel && <span className="text-body text-muted">- {lineLabel}</span>}
          </h2>
        }
        subtitle={
          lineLabel
            ? `Recorded against ${lineLabel} - pick the business below, then its programme level.`
            : "Pick the business this payment belongs to below, then its programme level."
        }
        actions={
          editing ? (
            <Btn variant="ghost" size="sm" onClick={() => switchEditing(null)}>
              Cancel edit
            </Btn>
          ) : undefined
        }
      >
        <form ref={formRef} action={submit} key={editing?.id ?? "new"}>
          <IncomeFields
            draft={draft}
            patch={patch}
            derived={derived}
            editing={editingForForm}
            catalogues={catalogues}
            nameOptions={nameOptions}
            canCreateStudent={canCreateStudent}
            fxRate={fxRate}
            fxStale={fxStale}
            fxDate={fxDate}
            notesDefault={editing?.notes ?? ""}
            methodOtherDefault={editing?.paymentMethodOther ?? ""}
            amountDefaults={{
              inr: editing ? minorToInput(editing.amountInrRaw) : "",
              eur: editing ? minorToInput(editing.amountEurRaw) : "",
            }}
            surchargeDefaults={{
              inr: editing ? minorToInput(editing.instalmentExtraInrRaw) : "",
              eur: editing ? minorToInput(editing.instalmentExtraEurRaw) : "",
            }}
          />
        <div className="mt-4 flex flex-wrap items-center gap-3">
          {/*
            The reason comes from the derivation, so the button and the sentence beside it can
            never disagree - and a plan with no COUNT yet now says so, where both used to talk
            about due dates regardless.
          */}
          <SubmitButton disabled={blockSave} title={blockSaveReason ?? undefined}>
            {editing ? "Save changes" : "Add income"}
          </SubmitButton>
          {blockSaveReason && <p className="text-caption text-muted">{blockSaveReason}</p>}
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
        // The row currently loaded into the form at the top of the tab (issue 21).
        rowClassName={(r) => (r.id === editing?.id ? "bg-accent-soft" : undefined)}
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
