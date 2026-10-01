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
  optionsFrom, PAYMENT_METHOD_LABELS, PAYMENT_TYPE_LABELS, PROGRAM_LEVEL_LABELS,
} from "@/lib/labels";
import { AmountPair } from "@/components/ui/AmountPair";
import {
  firstShare, planShares, remainingShares, type MoneyText,
} from "@/lib/instalment-amounts";
import { StudentName } from "@/components/ui/StudentName";
import { money, moneyAlt, moneyInline, moneyValue } from "@/lib/money-display";
import { useFinanceCcy } from "./FinanceCurrency";

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
}) {
  const { ccy } = useFinanceCcy();
  const [editing, setEditing] = useState<IncomeRow | null>(null);
  const [error, setError] = useState<string | null>(null);
  const formRef = useRef<HTMLFormElement>(null);
  // Which payment type the form currently shows - the instalment questions render only for
  // INSTALMENT. null = "follow the row being edited (or the default)", so entering/leaving
  // edit mode resets the answer along with the rest of the re-keyed form.
  const [paymentTypeChoice, setPaymentTypeChoice] = useState<string | null>(null);
  const paymentType = paymentTypeChoice ?? editing?.paymentType ?? "FULL_PAYMENT";
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
  const needsSchedule = paymentType === "INSTALMENT" && !editing;
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
  const switchEditing = (row: IncomeRow | null) => {
    setEditing(row);
    setPaymentTypeChoice(null);
    setStudentPick({ text: row?.studentName ?? "", value: row?.studentId ?? "" });
  };
  /**
   * What the student box currently holds. `value` is the resolved student id, so an empty one
   * beside non-empty text is exactly the case the "create this student" offer exists for.
   * Compared on the same normalisation the server links names with (case + spacing), so an
   * existing "anna  smith" is never offered as a new record.
   */
  const [studentPick, setStudentPick] = useState({ text: "", value: "" });
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
      key: "inr", header: "Received ₹", align: "right",
      cell: (r) => (BigInt(r.amountInrRaw) === BigInt(0) ? "-" : formatInrMinor(BigInt(r.amountInrRaw))),
      value: (r) => Number(BigInt(r.amountInrRaw)) / 100,
    },
    {
      key: "eur", header: "Received €", align: "right",
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
        if (r.paymentType !== "INSTALMENT") return PAYMENT_TYPE_LABELS[r.paymentType];
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
            {PAYMENT_TYPE_LABELS[r.paymentType]}
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
        if (r.paymentType !== "INSTALMENT") return PAYMENT_TYPE_LABELS[r.paymentType];
        const next = upcomingFor(r)[0];
        return [
          PAYMENT_TYPE_LABELS[r.paymentType],
          r.instalmentCount ? `(${r.instalmentCount}x)` : "",
          next ? `next ${formatDate(next.dueDate)}` : "",
        ]
          .filter(Boolean)
          .join(" ");
      },
    },
    { key: "method", header: "Method", cell: (r) => PAYMENT_METHOD_LABELS[r.paymentMethod], value: (r) => PAYMENT_METHOD_LABELS[r.paymentMethod] },
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
        title={editing ? `Edit income - ${editing.studentName}` : "Daily income entry"}
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
              options={studentOptions}
              nameText="studentName"
              nameValue="studentId"
              required
              placeholder={studentOptions.length > 0 ? "Search or type who paid" : "Type who paid"}
              defaultText={editing?.studentName ?? ""}
              defaultValue={editing?.studentId ?? ""}
              onStateChange={setStudentPick}
              emptyHint={
                studentOptions.length > 0
                  ? undefined
                  : "No students on file yet - type the name, then tick “Create a student record” below."
              }
            />
            {/*
              Offered only when the typed name resolved to nobody. Ticking it mints the student
              record with this payment, which is the only way a first payment can ever reach a
              payment history: until a Student row exists there is nothing for it to attach to.
            */}
            {canCreateStudent && !editing && newStudentName && (
              <label className="mt-2 flex items-start gap-2">
                <input name="createStudent" type="checkbox" defaultChecked className="mt-0.5 h-4 w-4 rounded border-line" />
                <span className="text-caption">
                  Create a student record for “{newStudentName}”
                  <span className="block text-muted">
                    Links this payment - and any earlier one under the same name - to their history.
                    You can fill in the rest under Students.
                  </span>
                </span>
              </label>
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
            inrLabel={planMode ? "Total fee (₹)" : "Amount received (₹)"}
            eurLabel={planMode ? "Total fee (€)" : "Amount received (€)"}
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
          <Field label="Programme level">
            <Select name="programLevel" options={levelOptions} defaultValue={editing?.programLevel ?? "GUIDED"} />
          </Field>
          <Field label="Payment type">
            <Select
              name="paymentType"
              options={optionsFrom(PAYMENT_TYPE_LABELS)}
              defaultValue={editing?.paymentType ?? "FULL_PAYMENT"}
              onChange={(e) => setPaymentTypeChoice(e.currentTarget.value)}
            />
          </Field>
          {/* Instalment plans carry two more answers: how many instalments the fee is split
              into, and the surcharge added for choosing the plan. Asked only when it applies -
              a full payment keeps the short form. */}
          {paymentType === "INSTALMENT" && (
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
                fxRate={fxRate}
                fxStale={fxStale}
                fxDate={fxDate}
                inrName="instalmentExtraInr"
                eurName="instalmentExtraEur"
                inrLabel="Extra amount (₹)"
                eurLabel="Extra amount (€)"
                baseHint="Added to the fee for paying in instalments"
                defaultInr={editing ? minorToInput(editing.instalmentExtraInrRaw) : ""}
                defaultEur={editing ? minorToInput(editing.instalmentExtraEurRaw) : ""}
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
          <Field label="Payment method">
            <Select name="paymentMethod" options={optionsFrom(PAYMENT_METHOD_LABELS)} defaultValue={editing?.paymentMethod ?? "UPI"} />
          </Field>
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

      <DataTable rows={visibleRows} columns={columns} csvName="income" filterPlaceholder="Filter income…" />
    </section>
  );
}
