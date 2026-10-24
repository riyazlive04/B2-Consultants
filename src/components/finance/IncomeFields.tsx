"use client";

import { ComboBox } from "@/components/ui/ComboBox";
import { Field, NotesField, Select, TextInput } from "@/components/ui/form";
import { AmountPair } from "@/components/ui/AmountPair";
import { InstalmentSchedule } from "@/app/(app)/finance/_components/InstalmentSchedule";
import { planTotalText } from "@/lib/instalment-amounts";
import { PROGRAM_LEVEL_LABELS } from "@/lib/labels";
import { BUSINESS_LINE_LABELS, BUSINESS_LINES, type BusinessLine } from "@/lib/business-line";
import { paymentTypeOptions, RECURRENCE_INTERVAL_LABELS, suggestNextBillingDate } from "@/lib/payment-types";

import type {
  DerivedIncomeForm, IncomeFormCatalogues, IncomeFormDraft, IncomeFormEditing,
} from "@/lib/income-form";

/**
 * THE INCOME ENTRY FIELDS - one set, rendered in two places.
 *
 * ── Why this is its own component ─────────────────────────────────────────────────
 * There were two income forms. This one, on the Finance page, and a second inside the top-bar
 * Quick Record modal, whose own header comment said it "Mirrors IncomeSection". They shared the
 * server action and the pure helpers, but each kept its own copy of the fields and their state -
 * so every improvement landed on whichever one the author happened to be editing.
 *
 * By October the drift was concrete: the plan link that decides which receivable a payment pays
 * off (FIN-12), the offline guard that stops a dead network costing the whole form, the
 * duplicate-payment warning and the notes counter were all on the Finance form and none of them
 * on Quick Record - which sits in the shell on every page, and is therefore the door most
 * payments come through. QuickRecordModal had itself warned about exactly this, about the one
 * field it HAD shared: "two implementations of that contract is how one of them quietly stops
 * creating receivables."
 *
 * So the fields live here, the rules live in `lib/income-form` (pure, 43 tests), and the two call
 * sites supply only what genuinely differs: whether there is a row being edited, whether this
 * operator may mint a student, and the chrome around it.
 */
export function IncomeFields({
  draft,
  patch,
  derived,
  editing,
  catalogues,
  nameOptions,
  canCreateStudent = false,
  fxRate,
  fxStale,
  fxDate,
  notesDefault = "",
  methodOtherDefault = "",
  amountDefaults = { inr: "", eur: "" },
  surchargeDefaults = { inr: "", eur: "" },
}: {
  draft: IncomeFormDraft;
  patch: (next: Partial<IncomeFormDraft>) => void;
  derived: DerivedIncomeForm;
  /** The row being edited, or null on a create-only form (Quick Record). */
  editing: IncomeFormEditing;
  catalogues: IncomeFormCatalogues;
  /** Students (they link) then payers known only by name - what the name box offers. */
  nameOptions: { value: string; label: string; hint?: string }[];
  /** Minting a student is an admin act, so only an admin is offered it. */
  canCreateStudent?: boolean;
  fxRate: number;
  fxStale?: boolean;
  fxDate?: string;
  notesDefault?: string;
  methodOtherDefault?: string;
  /**
   * What the amount boxes OPEN on when a row is being edited, as major-unit strings.
   *
   * Passed in rather than read off `editing`, because the raw minor-unit figures are a property
   * of the stored row (`IncomeRow`) and not of the form's rules - and dragging the server DTO in
   * here is what would stop `lib/income-form` being unit-testable without a database.
   */
  amountDefaults?: { inr: string; eur: string };
  /** Same, for the instalment surcharge. Ignored on a new entry, which uses the Console price. */
  surchargeDefaults?: { inr: string; eur: string };
}) {
  const {
    line, lineLevelOptions, programLevel, entryLine, lineLabel,
    paymentType, typeKind, needsSchedule, planMode,
    banked, scheduleShares, equalShare,
    methodOptions, paymentMethod, extraDefaults, extraKey,
    plansForPayer, planOptions, pendingPaymentId, newStudentName, suggestedCode,
  } = derived;
  const { levelOptions, paymentTypes, instalmentPlans, today } = catalogues;
  // Local aliases so the markup reads exactly as it did on the Finance page.
  const entryDate = derived.date;
  const feeCurrencies = derived.feeCurrencies;
  const interval = derived.recurrenceInterval;
  const nextBilling = derived.recurrenceNextDate;
  const instalmentCount = draft.instalmentCount;
  // The headline the parts are reconciled against: fee + surcharge, in the fee's currencies.
  const planTotal = planTotalText(draft.fee, draft.extra);
  const mintStudent = draft.mintStudent;
  /** `{ KEY: "Label" }` → Select options, in declaration order. */
  const optionsFrom = (labels: Record<string, string>) =>
    Object.entries(labels).map(([value, label]) => ({ value, label }));

  return (
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
            onChange={(e) => patch({ date: e.currentTarget.value })}
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
            onStateChange={(next) => patch({ student: next })}
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
                  onChange={(e) => patch({ mintStudent: e.currentTarget.checked })}
                  className="mt-0.5 h-4 w-4 rounded border-line"
                />
                <span className="text-caption">
                  Create a student record for “{newStudentName}”
                  <span className="block text-muted">
                    Links this payment - and any earlier one under the same name - to their history.
                  </span>
                  {/*
                    ── WHERE THE HALF-BUILT RECORD GOES NEXT (refactor step D6) ──────────
                    A student minted here has a name, a number and a payment, and nothing else:
                    no programme level, no cohort, no portal login. "You can fill in the rest
                    under Students" was true and left the reader to remember it, which is how
                    paid students ended up sitting unenrolled for weeks.
                    Onboarding → Needs completing finds them without anybody remembering: the
                    gaps are derived from the record, so it appears there the moment it is
                    created and leaves the list the moment it is finished.
                  */}
                  <span className="mt-0.5 block text-muted">
                    They will appear on <b className="font-semibold text-ink-2">Onboarding → Needs
                    completing</b> until they have a programme and a cohort.
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
                  // Names a series only once a business is chosen; before that there is no
                  // "next free number" to promise, and naming B2's would be a guess on screen.
                  hint={
                    entryLine
                      ? `Next free ${entryLine === "GERMAN_NOTE" ? "German Note" : "B2"} number - edit it if this student already has one`
                      : "Pick a business to see the next free number - or type the student's own"
                  }
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
          defaultInr={amountDefaults.inr}
          defaultEur={amountDefaults.eur}
          onAmountsChange={(next) => patch({ fee: next })}
        />
        {/*
          ── THE FIRST INSTALMENT, TYPED ───────────────────────────────────────────────
          This was two hidden inputs carrying `total ÷ count`, which made the commonest plan in
          the business unrecordable: a bigger payment up front with the balance spread. The only
          ways to enter it were to pretend the plan was equal, or to record a plain payment and
          rebuild the schedule by hand afterwards - and a schedule nobody goes back to build
          chases nobody.

          Pre-filled with the equal share, so the ordinary plan is still one less thing to type;
          typed over, and the REMAINING instalments are re-cut from what is left (see
          `planShares`), which keeps the plan summing to the same total without a second sum
          anywhere. `amountInr`/`amountEur` are the names the action banks, exactly as the hidden
          fields were.
        */}
        {planMode && (
          <AmountPair
            /*
              Keyed on the SUGGESTION alone - never on whether it has been overridden.

              Keying on "typed vs not" sent the box into a flip-flop that ate the figure being
              entered: typing re-keyed it, the remount restored the suggested default, the
              default matched the suggestion so the override cleared, which re-keyed it back.
              The number vanished as fast as it was typed.

              On the suggestion, the box re-adopts a new equal share when the fee or the count
              changes - the same rule the surcharge box above uses (`extraKey`) - and otherwise
              leaves whatever was typed alone.
            */
            key={`first-${equalShare.inr}|${equalShare.eur}`}
            fxRate={fxRate}
            fxStale={fxStale}
            fxDate={fxDate}
            inrName="amountInr"
            eurName="amountEur"
            inrLabel="Paid today (₹)"
            eurLabel="Paid today (€)"
            baseHint={
              draft.firstInstalment
                ? "The rest of the plan is split over the remaining instalments"
                : "An equal share by default - change it for a larger first payment"
            }
            defaultInr={equalShare.inr}
            defaultEur={equalShare.eur}
            // The pair reports its value on MOUNT as well as on every keystroke, so "equal to
            // the suggestion" has to mean "untouched" - otherwise the first render would record
            // an override and the box would stop following the fee and the count.
            onAmountsChange={(next) =>
              patch({
                firstInstalment:
                  next.inr === equalShare.inr && next.eur === equalShare.eur ? null : next,
              })
            }
          />
        )}
        {/*
          Carries no `name`: the business is NOT submitted, because nothing stores it. It is a
          filter on the question below, and the server re-derives the line from the level it
          is sent - one authority (lib/business-line), not a second field that could disagree.
        */}
        {/*
          UNANSWERED until somebody answers it. Under the page's "Combined" view this opens
          empty rather than pre-selecting B2 - see the note in lib/income-form. An empty select
          is the honest rendering of a question nobody has answered, and the save is held until
          it is.
        */}
        <Field
          label="Business"
          hint={
            line === null
              ? "Which book this payment lands in. Pick one to see its programme levels."
              : "Which book this payment lands in - it narrows the levels below."
          }
        >
          <Select
            options={BUSINESS_LINES.map((l) => ({ value: l, label: BUSINESS_LINE_LABELS[l] }))}
            value={line ?? ""}
            placeholder="Pick a business"
            onChange={(e) => {
              // Both in ONE update: the level is cleared with the business, so the select
              // never renders a value absent from its own options even for a frame.
              patch({ businessLine: e.currentTarget.value as BusinessLine, programLevel: null });
            }}
          />
        </Field>
        <Field
          label="Programme level"
          hint={
            // "No active X level" would be a lie while no business has been picked - there is
            // nothing to list yet because nobody has said which list.
            line === null
              ? "Pick a business first."
              : lineLevelOptions.length === 0
                ? `No active ${lineLabel} level - add one first.`
                : undefined
          }
        >
          <Select
            name="programLevel"
            options={lineLevelOptions}
            value={programLevel}
            placeholder={
              line === null
                ? "Pick a business first"
                : lineLevelOptions.length === 0
                  ? "Nothing to choose"
                  : undefined
            }
            onChange={(e) => patch({ programLevel: e.currentTarget.value })}
          />
        </Field>
        {/*
          ── Which receivable this pays off ────────────────────────────────────────
          Offered only when the named person actually has an open plan, so the form does not
          grow a permanently-empty dropdown for the ordinary one-off payment.

          Picking one is what makes the money land on THAT plan's balance instead of being
          spread across every plan the student has. It also removes the ambiguity that used to
          make auto-settlement give up: two plans at the same level is now answerable.
        */}
        {plansForPayer.length > 0 && (
          <Field
            label="Settles which receivable?"
            hint={
              plansForPayer.length === 1
                ? "Their only open plan - clear it if this payment is for something else."
                : "This student has more than one open plan. Pick the one this money pays off."
            }
          >
            <Select
              name="pendingPaymentId"
              options={planOptions}
              value={pendingPaymentId}
              onChange={(e) => patch({ pendingPaymentId: e.currentTarget.value })}
            />
          </Field>
        )}
        {/* The list is the founder's (Console → Payment Types), and the chosen type's KIND is
            what decides which questions appear below - instalment, recurring, or none. */}
        <Field label="Payment type">
          <Select
            name="paymentType"
            options={paymentTypeOptions(paymentTypes, editing?.paymentType)}
            value={paymentType}
            onChange={(e) => patch({ paymentType: e.currentTarget.value })}
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
                  patch({ recurrenceInterval: next });
                  // Suggested, never imposed: only filled while the box is still untouched.
                  // Suggested, never overwritten: real subscriptions bill on the 1st, or on
                  // the day the card was set up.
                  if (!draft.recurrenceNextDate) {
                    patch({ recurrenceNextDate: suggestNextBillingDate(entryDate, next) });
                  }
                }}
              />
            </Field>
            <Field label="Next payment due" hint="Suggested from the interval - change it freely">
              <TextInput
                type="date"
                name="recurrenceNextDate"
                required
                value={nextBilling || suggestNextBillingDate(entryDate, interval)}
                onChange={(e) => patch({ recurrenceNextDate: e.currentTarget.value })}
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
                  patch({ instalmentCount: Number.isFinite(n) && n > 0 ? n : null });
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
              defaultInr={editing ? surchargeDefaults.inr : extraDefaults.inr}
              defaultEur={editing ? surchargeDefaults.eur : extraDefaults.eur}
              onAmountsChange={(next) => patch({ extra: next })}
            />
            {/* Only on a NEW entry. Editing an income row must not silently rewrite a schedule
                the student has already agreed to and may have started paying against - that
                edit belongs in the receivable itself, under Pending. */}
            {!editing && (
              <InstalmentSchedule
                count={instalmentCount}
                anchorDate={entryDate}
                shares={scheduleShares}
                bankedToday={banked}
                planTotal={planTotal}
                onCompleteChange={(complete) => patch({ scheduleComplete: complete })}
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
            onChange={(e) => patch({ paymentMethod: e.currentTarget.value })}
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
              defaultValue={methodOtherDefault}
            />
          </Field>
        )}
        {/* Counts down the last characters instead of silently swallowing them (issue 18). */}
        <NotesField placeholder="Any extra info" defaultValue={notesDefault} key={`notes-${editing?.id ?? "new"}`} />
      </div>
  );
}
