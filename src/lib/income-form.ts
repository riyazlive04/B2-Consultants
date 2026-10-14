import { BUSINESS_LINE_LABELS, type BusinessLine } from "./business-line";
import { firstShare, planShares, remainingShares, type MoneyText } from "./instalment-amounts";
import { instalmentExtraFor } from "./instalment-plan";
import type { InstalmentPlanConfig, PaymentTypesConfig } from "./config-schema";
import { formatDate, formatInrMinor, minorToMajorString } from "./format";
import { PAYMENT_METHOD_LABELS } from "./labels";
import {
  currenciesInPlay, defaultMethodFor, methodsForCurrencies, type MoneyCurrency,
} from "./payment-methods";
import { paymentTypeKind } from "./payment-types";

/**
 * EVERYTHING THE INCOME ENTRY FORM DERIVES, as one pure function.
 *
 * ── Why this is not in the component ──────────────────────────────────────────────
 * The form had grown eighteen `useState` hooks and five hand-rolled
 * `xChoice ?? editing?.x ?? default` triples, each of which had to be reset by hand in TWO
 * places - `switchEditing` and the post-submit clear. Miss one and the form silently carries the
 * last entry's answer into the next: a payment recorded against the previous student's plan, or
 * at the previous level. That is not a hypothetical. It has happened twice in this file's
 * history - commit 49a22a6 ("Stop the income form collapsing") and the note still standing at
 * the reset site ("reset fires no change event ... Left alone they carried the last payment's
 * plan into the next one") are both repairs of exactly this shape.
 *
 * So the answers become ONE object (`IncomeFormDraft`) and everything downstream of them becomes
 * ONE derivation. A single object has a single reset, which is why the whole class of bug goes
 * away rather than being fixed once more.
 *
 * ── Why it is pure ───────────────────────────────────────────────────────────────
 * The hard part of this form was never the markup, it was the rules: which questions a payment
 * type asks, which levels a business sells, which rails a currency can arrive by, and what any of
 * those become when the one being edited changes under them. Those are now testable without a
 * browser, a database or a render - see `__tests__/income-form.test.ts`.
 *
 * It is also what lets the Finance page's form and the top-bar Quick Record share one set of
 * rules. They had diverged: the plan link, the offline guard and the duplicate-payment check all
 * landed on one of them. QuickRecordModal's own header warned about this - "two implementations
 * of that contract is how one of them quietly stops creating receivables" - about the schedule
 * field it had correctly shared.
 */

/** The answers a person has actually given. Everything else on the form is derived from these. */
export type IncomeFormDraft = {
  /** null for every field means "not answered yet - follow the row being edited, or the default". */
  businessLine: BusinessLine | null;
  programLevel: string | null;
  paymentType: string | null;
  paymentMethod: string | null;
  /** The receivable this payment settles, "" for "none", null for "not answered" (FIN-12). */
  pendingPaymentId: string | null;
  /** The whole agreed fee on a plan; the money in hand otherwise. */
  fee: MoneyText;
  /** The plan surcharge. Pre-filled from the Console, still the operator's to change. */
  extra: MoneyText;
  /**
   * The FIRST instalment, when somebody has typed it. Null = divide the total equally.
   *
   * Null is "nobody has said", not zero: an equal split is the default and the box shows it, but
   * the moment a figure is typed the remaining instalments are re-cut from what is left rather
   * than the typed figure being thrown away (which is what a derived, hidden field did).
   */
  firstInstalment: MoneyText | null;
  instalmentCount: number | null;
  /** YYYY-MM-DD. The day the money arrived. */
  date: string | null;
  student: { text: string; value: string };
  mintStudent: boolean;
  /** Whether every due date in the schedule has been filled in. */
  scheduleComplete: boolean;
  recurrenceInterval: string | null;
  recurrenceNextDate: string | null;
};

/** A draft with nothing answered. `date` is the only field with a sensible non-null seed. */
export function emptyDraft(today: string): IncomeFormDraft {
  return {
    businessLine: null,
    programLevel: null,
    paymentType: null,
    paymentMethod: null,
    pendingPaymentId: null,
    fee: { inr: "", eur: "" },
    extra: { inr: "", eur: "" },
    firstInstalment: null,
    instalmentCount: null,
    date: today,
    student: { text: "", value: "" },
    mintStudent: true,
    scheduleComplete: false,
    recurrenceInterval: null,
    recurrenceNextDate: null,
  };
}

/**
 * The row being edited, reduced to the fields the form reads back off it. `null` for a new entry.
 *
 * Deliberately a hand-written shape rather than `IncomeRow`: this module is shared with the Quick
 * Record modal, which is create-only and has no row, and tying the rules to a server DTO would
 * drag the whole of finance-metrics into a pure unit test.
 */
export type IncomeFormEditing = {
  id: string;
  date: string;
  studentName: string;
  studentId: string | null;
  programLevel: string;
  paymentType: string;
  paymentMethod: string;
  pendingPaymentId: string | null;
  instalmentCount: number | null;
  recurrenceInterval: string | null;
  recurrenceNextDate: string | null;
} | null;

/** An open receivable this payment could be settling. */
export type OpenPlan = {
  id: string;
  studentId: string | null;
  studentName: string;
  programLevel: string;
  levelLabel: string;
  balanceInr: number;
  nextDueDate: string | null;
};

/** The catalogues and config the rules are evaluated against. All founder-editable. */
export type IncomeFormCatalogues = {
  /** Every active level, in display order. */
  levelOptions: { value: string; label: string }[];
  /** Level code → which of the two businesses sells it. */
  levelLines: Record<string, BusinessLine>;
  paymentTypes: PaymentTypesConfig;
  instalmentPlans: InstalmentPlanConfig;
  /** Students (they link) and then payers known only by name. */
  studentOptions: { value: string; label: string; hint?: string }[];
  openPlans: OpenPlan[];
  nextStudentCodes: Record<string, string>;
  /** Today, YYYY-MM-DD, in the browser's own zone (FIN-02). */
  today: string;
  /**
   * The business the screen is currently filtered to, when it is filtered to one.
   *
   * The Finance page, and the app-wide Record button, both carry a Combined / B2 / German Note
   * switch that is sticky across navigation. Picking "German Note" filtered everything the page
   * READ and nothing it WROTE: the entry form underneath went on opening at B2 and Guided, so
   * recording German Note income meant announcing the business twice - once to the page, then
   * again to the form, in a dropdown the first choice had just made look answered.
   *
   * Null for "Combined", which is a view of both and therefore says nothing about where a new
   * entry belongs; the level's own book decides, as before.
   */
  defaultLine?: BusinessLine | null;
};

export type DerivedIncomeForm = {
  /**
   * The business whose levels are on offer, or NULL when nobody has said yet.
   *
   * Null is a real state, not a missing value: under the page's "Combined" view a new entry
   * belongs to neither book until someone chooses, and the form says so rather than guessing.
   */
  line: BusinessLine | null;
  /** Only the levels that business actually sells. Empty until a business is chosen. */
  lineLevelOptions: { value: string; label: string }[];
  /** Coerced to be one of `lineLevelOptions`, or "" when there is nothing to choose. */
  programLevel: string;
  /** The line the CHOSEN level belongs to - what the money will really credit. */
  entryLine: BusinessLine | null;
  /** Null while no business is chosen, so nothing on screen can name the wrong book. */
  lineLabel: string | null;
  paymentType: string;
  typeKind: ReturnType<typeof paymentTypeKind>;
  /** True when this entry is agreeing a NEW plan, so the schedule questions apply. */
  needsSchedule: boolean;
  /** True when the save must be held back, with a reason the button can show. */
  blockSave: boolean;
  blockSaveReason: string | null;
  /** True when the top amount is the whole fee rather than the money in hand. */
  planMode: boolean;
  /** The fee cut into instalments - the first one as typed, if it was. Empty outside plan mode. */
  shares: MoneyText[];
  /** The first instalment - the money actually being banked today. */
  banked: MoneyText;
  /** The instalments after the first - what the schedule rows below the form hold. */
  scheduleShares: MoneyText[];
  /**
   * The equal share, ignoring any typed first instalment - what the "Paid today" box SUGGESTS.
   *
   * Kept apart from `banked` so the form can tell "nobody has touched this" from "somebody typed
   * the same number": the box reports its value on mount, and treating that as an override would
   * freeze the suggestion the first time the fee changed.
   */
  equalShare: MoneyText;
  feeCurrencies: MoneyCurrency[];
  methodOptions: { value: string; label: string }[];
  paymentMethod: string;
  /** The Console's price for this plan length, per currency, "" where it does not apply. */
  extraDefaults: MoneyText;
  /** Remount key for the surcharge box - the two answers that re-price it. */
  extraKey: string;
  /** Open plans belonging to whoever is named on the form. */
  plansForPayer: OpenPlan[];
  planOptions: { value: string; label: string }[];
  /** The plan this payment settles. "" for none. */
  pendingPaymentId: string;
  /** True when a typed name matches nobody, so minting is on offer. */
  newStudentName: string;
  /** The next free student number in THIS payment's series. */
  suggestedCode: string;
  date: string;
  recurrenceInterval: string;
  recurrenceNextDate: string;
};

/**
 * Case- and whitespace-insensitive name pairing. Shared with `lib/payment-allocation`, which
 * pairs the same two things on the server; two spellings of this rule is how a form offers a
 * plan the balance maths will not credit.
 */
export const nameKey = (s: string) => s.trim().toLowerCase().replace(/\s+/g, " ");

export function deriveIncomeForm(
  draft: IncomeFormDraft,
  editing: IncomeFormEditing,
  cat: IncomeFormCatalogues,
): DerivedIncomeForm {
  // ── The payment type, and what it MEANS ────────────────────────────────────────
  // The founder names the types; the form branches on the KIND, so a type they called "EMI"
  // asks the instalment questions and one called "Membership" asks the recurring ones.
  const paymentType = draft.paymentType ?? editing?.paymentType ?? "FULL_PAYMENT";
  const typeKind = paymentTypeKind(cat.paymentTypes, paymentType);

  // ── The business, then its levels ──────────────────────────────────────────────
  // Asked in this order so the two can never disagree: the business narrows the level list, and
  // the level is what actually decides which book the money credits. The operator used to have
  // to KNOW that "Guided" means B2 and read the answer back off the heading afterwards.
  const rowLevel = editing?.programLevel ?? "GUIDED";
  /**
   * An existing row's OWN level always wins. A page filter is about what you are looking at; it
   * must never reach into an entry already saved and move it to the other book - that would
   * rewrite history as a side effect of a view. So `defaultLine` applies to new entries only.
   */
  /**
   * ── "COMBINED" MUST NOT MEAN "B2" ──────────────────────────────────────────────
   * A new entry used to fall back to the line of `rowLevel`, which is "GUIDED" - a B2 coaching
   * tier - so with the page on Combined the form opened fully answered as B2: the Business box
   * read B2, the level list was pre-filtered to B2 levels with Guided selected, and the heading
   * announced "Recorded against B2". Combined is a view of BOTH books and says nothing about
   * where new money belongs, so every German Note payment entered from that view was filed to
   * the wrong book unless the operator noticed and changed two fields.
   *
   * Null instead, and the form asks. The page filter still pre-answers it when it is on one of
   * the two businesses - that is the one case where the view really does say where money goes.
   */
  const line: BusinessLine | null =
    draft.businessLine ??
    (editing ? (cat.levelLines[rowLevel] ?? "B2") : (cat.defaultLine ?? null));
  const lineLevelOptions =
    line === null ? [] : cat.levelOptions.filter((o) => (cat.levelLines[o.value] ?? "B2") === line);
  const wantedLevel = draft.programLevel ?? rowLevel;
  /**
   * COERCED into the business on screen. A select showing a value absent from its own options
   * submits something other than what is displayed, and switching B2 → German Note leaves
   * "Guided" selected against a list that no longer contains it. Falls back to the business's
   * first level, or to "" when it has no active level at all - which the field says, rather than
   * silently posting a level belonging to the other book.
   */
  const programLevel = lineLevelOptions.some((o) => o.value === wantedLevel)
    ? wantedLevel
    : (lineLevelOptions[0]?.value ?? "");
  const entryLine: BusinessLine | null = programLevel ? (cat.levelLines[programLevel] ?? line) : line;

  // ── The fee, and how it divides ────────────────────────────────────────────────
  // Editing never redraws a schedule: the plan of a receivable already under way is not
  // something an income edit may silently restate. That belongs in the receivable.
  const needsSchedule = typeKind === "INSTALMENT" && !editing;
  const planMode = needsSchedule;
  const shares = planMode
    ? planShares(draft.fee, draft.extra, draft.instalmentCount, draft.firstInstalment)
    : [];
  /**
   * What is banked today. The TYPED figure wins outright, including when it has been cleared:
   * `planShares` falls back to an equal split for an empty override (it has no amount to divide
   * from), and reporting that split while the box on screen is empty is exactly the kind of
   * quiet disagreement between field and figure this whole change is undoing.
   */
  const banked = draft.firstInstalment ?? firstShare(shares);
  const scheduleShares = remainingShares(shares);
  /**
   * NOTE: whether the parts ADD UP to the price is deliberately NOT derived here. Every schedule
   * row is hand-editable after this function has run, and only the schedule component knows what
   * they currently say - see the reconciliation in InstalmentSchedule, which measures the rows
   * themselves. A second answer computed from the equal split would reassure the operator about
   * numbers they had just edited away.
   */

  const feeCurrencies = currenciesInPlay(draft.fee);
  const pricedExtra = instalmentExtraFor(draft.instalmentCount ?? 0, cat.instalmentPlans);
  /**
   * Only the currency the fee was agreed in is filled. A rupee surcharge beside a euro fee would
   * be ADDED to it (lib/money - the two columns sum), inventing a charge nobody made.
   */
  const extraDefaults: MoneyText = {
    inr:
      feeCurrencies.includes("INR") && pricedExtra.inr > BigInt(0)
        ? minorToMajorString(pricedExtra.inr)
        : "",
    eur:
      feeCurrencies.includes("EUR") && pricedExtra.eur > BigInt(0)
        ? minorToMajorString(pricedExtra.eur)
        : "",
  };
  /**
   * Re-keyed on the plan LENGTH and the currency - the two answers that re-price the surcharge.
   * Deliberately NOT on the fee itself: the surcharge is flat, and remounting on every digit
   * would fight whoever is typing.
   */
  const extraKey = `extra-${draft.instalmentCount ?? 0}-${feeCurrencies.join("+") || "none"}`;

  // ── The method, narrowed to the rails the money could have arrived by ──────────
  // The list CHANGES with the currency: pick UPI, then type a euro amount, and UPI is no longer
  // offered. Letting a control show a value absent from its own options is the same trap the
  // level coercion above guards.
  const methodOptions = methodsForCurrencies(feeCurrencies).map((m) => ({
    value: m,
    label: PAYMENT_METHOD_LABELS[m] ?? m,
  }));
  const paymentMethod = defaultMethodFor(
    feeCurrencies,
    draft.paymentMethod ?? editing?.paymentMethod ?? "UPI",
  );

  // ── Which receivable this pays off (FIN-12) ────────────────────────────────────
  // Narrowed to the person named on the form, by the SAME pairing rule the balance maths uses:
  // student id when one was picked, normalised name otherwise. Deliberately NOT narrowed by
  // level - a Guided payment can legitimately pay down the A1 plan the student is actually
  // settling, and refusing to show it is how the old auto-matching came to decline to act.
  const plansForPayer = cat.openPlans.filter((pl) =>
    draft.student.value
      ? pl.studentId === draft.student.value
      : pl.studentId === null && nameKey(pl.studentName) === nameKey(draft.student.text),
  );
  /**
   * The label carries the BALANCE and the due date, not just the level: with two plans open,
   * "GN A1" and "Guided" alone do not tell the operator which one the money in their hand is
   * for, whereas "Guided - ₹12,500 left, due 01/11/2026" does.
   */
  const planOptions = [
    { value: "", label: "Not against a specific plan" },
    ...plansForPayer.map((pl) => ({
      value: pl.id,
      label: `${pl.levelLabel} - ${formatInrMinor(BigInt(Math.round(pl.balanceInr)))} left${
        pl.nextDueDate ? `, due ${formatDate(pl.nextDueDate)}` : ""
      }`,
    })),
  ];
  /**
   * Defaulting to a LONE plan is the one piece of inference kept: a student with exactly one open
   * receivable has no ambiguity to resolve, and making somebody confirm the only possible answer
   * is how a field comes to be ignored. Two or more and nothing is assumed.
   */
  const pendingPaymentId =
    draft.pendingPaymentId ??
    editing?.pendingPaymentId ??
    (plansForPayer.length === 1 ? plansForPayer[0].id : "");

  // ── A name that matches nobody is a student waiting to be created ──────────────
  // Tested against `studentOptions` alone, NOT against the payers-known-by-name: a name that is
  // merely familiar from an old payment is exactly the one that still needs a record.
  const typedName = draft.student.text.trim();
  const newStudentName =
    typedName &&
    !draft.student.value &&
    !cat.studentOptions.some((o) => nameKey(o.label) === nameKey(typedName))
      ? typedName
      : "";

  /**
   * An instalment plan saved with a blank due date drops that receivable on the floor - nothing
   * chases a date nobody wrote down - so the save is held until they are all there, and the
   * reason is stated rather than discovered on click.
   */
  const blockSaveReason =
    // Nothing else matters until the money has a book to land in. An income row carries exactly
    // one programme level, and that level is what decides which business is credited - so there
    // is no honest way to save this while the question is unanswered.
    line === null
      ? "Pick which business this payment belongs to"
      : !needsSchedule
        ? null
        : !draft.instalmentCount
          ? "Enter how many instalments the fee is split into"
          : !draft.scheduleComplete
            ? "Fill in every due date so the rest of the plan can be chased"
            : null;

  return {
    line,
    lineLevelOptions,
    programLevel,
    entryLine,
    lineLabel: entryLine ? BUSINESS_LINE_LABELS[entryLine] : null,
    paymentType,
    typeKind,
    needsSchedule,
    blockSave: blockSaveReason !== null,
    blockSaveReason,
    planMode,
    shares,
    banked,
    scheduleShares,
    equalShare: planMode
      ? firstShare(planShares(draft.fee, draft.extra, draft.instalmentCount))
      : { inr: "", eur: "" },
    feeCurrencies,
    methodOptions,
    paymentMethod,
    extraDefaults,
    extraKey,
    plansForPayer,
    planOptions,
    pendingPaymentId,
    newStudentName,
    suggestedCode: (entryLine ? cat.nextStudentCodes[entryLine] : null) ?? cat.nextStudentCodes.B2 ?? "",
    date: draft.date ?? editing?.date.slice(0, 10) ?? cat.today,
    recurrenceInterval: draft.recurrenceInterval ?? editing?.recurrenceInterval ?? "MONTHLY",
    recurrenceNextDate: draft.recurrenceNextDate ?? editing?.recurrenceNextDate?.slice(0, 10) ?? "",
  };
}
