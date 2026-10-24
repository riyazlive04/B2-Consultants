/**
 * What makes an invoice and a receipt a valid document - the pure half.
 *
 * B2 Consultants invoices as a sole trader established in Germany (Ameenur Rahaman Servarr Basha,
 * Reichelsheim - see `AGREEMENT_PROVIDER`), so the contents of an invoice are set by §14 Abs. 4
 * UStG and its numbering and keeping by the GoBD. Every rule below is one of those, or one of the
 * payment terms the student already signed in the coaching agreement (§7-§8), restated on the
 * money documents so the two can never say different things.
 *
 * ── NUMBERING: INV-yy9999 ────────────────────────────────────────────────────────
 * One series per document kind and calendar year: INV-260001, INV-260002, … INV-270001. The
 * year in the number is the year of the ISSUE DATE printed beside it. The counter is a single
 * database row incremented inside the issuing transaction (`server/document-numbers.ts`), so two
 * people issuing at once can never draw the same number and a rolled-back issue gives its number
 * back. Four digits is 9,999 documents a year; the 10,000th refuses rather than overflowing into
 * a number that sorts wrongly.
 *
 * ── AN INVOICE IS NUMBERED WHEN IT IS ISSUED, NOT WHEN IT IS DRAFTED ─────────────
 * Drafts used to take the next number on creation, so every abandoned draft left a hole in the
 * series (live had INV-0003…0006 archived as drafts). A gap in an invoice series is the first
 * thing a tax audit asks about. A draft now carries a provisional `DRAFT-xxxxxxxx` reference and
 * draws its real number the moment it leaves DRAFT - sent, marked sent, or paid against - and
 * from then on it is locked: no edits, no return to draft, no permanent delete. A mistake on an
 * issued invoice is corrected by voiding it and issuing a new one, which keeps both on record.
 */

export const DOCUMENT_PREFIX = { INVOICE: "INV", ESTIMATE: "EST", RECEIPT: "RCT" } as const;
export type DocumentPrefix = (typeof DOCUMENT_PREFIX)[keyof typeof DOCUMENT_PREFIX];

/** Four digits after the year: 9,999 documents per series per year. */
export const DOCUMENT_SEQUENCE_MAX = 9999;

const PROVISIONAL_PREFIX = "DRAFT-";

/** "26" for 2026 - the two-digit year a number carries. */
function yy(year: number): string {
  return String(((year % 100) + 100) % 100).padStart(2, "0");
}

/** The counter row a series is drawn from: one per prefix and year, "INV-26". */
export function sequenceKey(prefix: DocumentPrefix, year: number): string {
  return `${prefix}-${yy(year)}`;
}

/** INV + 2026 + 7 → "INV-260007". Throws past 9,999 rather than printing a five-digit tail. */
export function documentNumber(prefix: DocumentPrefix, year: number, seq: number): string {
  if (!Number.isInteger(seq) || seq < 1) throw new RangeError(`Invalid ${prefix} sequence ${seq}`);
  if (seq > DOCUMENT_SEQUENCE_MAX) {
    throw new RangeError(`The ${sequenceKey(prefix, year)} series is full (${DOCUMENT_SEQUENCE_MAX} documents this year).`);
  }
  return `${prefix}-${yy(year)}${String(seq).padStart(4, "0")}`;
}

/** The reference a draft carries until it is issued. `suffix` is random, supplied by the caller. */
export function provisionalNumber(suffix: string): string {
  return `${PROVISIONAL_PREFIX}${suffix}`;
}

export function isProvisionalNumber(number: string): boolean {
  return number.startsWith(PROVISIONAL_PREFIX);
}

// ───────────────────────────── what must be on it ─────────────────────────────

export type IssueCheckInput = {
  issuer: {
    name: string;
    ownerName: string;
    addressLines: string[];
    postcode: string;
    city: string;
    country: string;
    taxId: string;
  };
  customerName: string;
  customerAddress: string | null;
  servicePeriodStart: Date | null;
  taxPercent: number;
  /** The statement printed in place of a tax line - required when nothing is charged. */
  taxNote: string | null;
};

const blank = (s: string | null | undefined) => !s || !s.trim();

/**
 * Everything §14 Abs. 4 UStG requires that this invoice does not yet have, in plain words.
 * Empty means it may be issued.
 *
 *   Nr. 1  full name and address of the supplier AND of the recipient. A sole trader's "full
 *          name" is the owner's own name - a trading name alone does not satisfy it.
 *   Nr. 2  the supplier's Steuernummer or USt-IdNr.
 *   Nr. 3  the issue date                        - always present (a required column).
 *   Nr. 4  a unique sequential number            - drawn at issue, see above.
 *   Nr. 5  quantity and kind of service          - the line items (at least one is enforced).
 *   Nr. 6  the date or period of the service.
 *   Nr. 7/8 the net amount, the tax rate and tax amount - OR, when no tax is charged, the
 *          reason why (small-business rule, not taxable in Germany, exempt…). A bare 0% line
 *          is not a reason.
 *
 * The Kleinbetragsrechnung relief (≤ €250, §33 UStDV) is deliberately not modelled: no
 * programme fee is anywhere near it, and a rule that relaxes the checks is one that gets hit by
 * accident.
 */
export function invoiceIssueGaps(i: IssueCheckInput): string[] {
  const gaps: string[] = [];
  const iss = i.issuer;
  if (blank(iss.ownerName)) gaps.push("the owner's full legal name (Console → Money → Invoicing)");
  if (!iss.addressLines.some((l) => l.trim()) || blank(iss.postcode) || blank(iss.city) || blank(iss.country)) {
    gaps.push("your full business address (Console → Money → Invoicing)");
  }
  if (blank(iss.taxId)) gaps.push("your Steuernummer or USt-IdNr (Console → Money → Invoicing → Tax ID)");
  if (blank(i.customerName)) gaps.push("the customer's name");
  if (blank(i.customerAddress)) gaps.push("the customer's postal address");
  if (!i.servicePeriodStart) gaps.push("the service date or period");
  if (!(i.taxPercent > 0) && blank(i.taxNote)) {
    gaps.push("a note saying why no tax is charged (Console → Money → Invoicing → Tax)");
  }
  return gaps;
}

export function issueBlockedMessage(gaps: string[]): string {
  return `This invoice can't be issued yet. Add ${gaps.join("; ")}.`;
}

/**
 * The same question, asked of a DRAFT before anyone presses Send.
 *
 * ── Why this exists ─────────────────────────────────────────────────────────────────────
 * `invoiceIssueGaps` was reached from exactly one place: the instant of issue, inside the
 * transaction. So a draft could not be asked whether it was issuable, and the editor drew a Send
 * button on every draft - including one that the server would refuse. On a fresh install (or
 * live, where the issuer block is still blank) pressing it returned a wall of four requirements
 * at once, which is the first the operator heard of any of them.
 *
 * That is the failure this codebase has a standing rule against: "the UI only ever offers what
 * will actually be accepted", and a cohort on the Batches screen "reads Draft until it has a
 * plan, a teacher and a learner - and says which of those is missing". An invoice should say so
 * too, and before the click.
 *
 * ── Why the tax-note fallback lives here ────────────────────────────────────────────────
 * A 0% invoice with no note of its own inherits the Console's note for its currency AT ISSUE.
 * That rule decides whether a draft is issuable, so a readiness check that did not apply it
 * would report a gap the issue path does not see - two answers to one question. Both sides call
 * this, which is the only way they cannot disagree.
 */
export function invoiceIssueGapsFor(input: {
  issuer: IssueCheckInput["issuer"];
  invoice: {
    customerName: string;
    customerAddress: string | null;
    servicePeriodStart: Date | string | null;
    taxPercent: number;
    taxNote: string | null;
  };
  /** The Console's note for THIS invoice's currency, used only when the invoice has none. */
  fallbackTaxNote: string;
}): string[] {
  const { invoice: inv } = input;
  const taxNote =
    inv.taxNote?.trim() || (inv.taxPercent > 0 ? null : input.fallbackTaxNote.trim() || null);
  return invoiceIssueGaps({
    issuer: input.issuer,
    customerName: inv.customerName,
    customerAddress: inv.customerAddress,
    // A date-input string ("" when unset) and a Date both arrive here, from the editor's DTO and
    // from the row respectively. Only presence matters to the check.
    servicePeriodStart: inv.servicePeriodStart ? new Date(inv.servicePeriodStart) : null,
    taxPercent: inv.taxPercent,
    taxNote,
  });
}

// ───────────────────────────── amount in words ─────────────────────────────

const ONES = [
  "", "One", "Two", "Three", "Four", "Five", "Six", "Seven", "Eight", "Nine", "Ten",
  "Eleven", "Twelve", "Thirteen", "Fourteen", "Fifteen", "Sixteen", "Seventeen", "Eighteen", "Nineteen",
];
const TENS = ["", "", "Twenty", "Thirty", "Forty", "Fifty", "Sixty", "Seventy", "Eighty", "Ninety"];

function below100(n: number): string {
  if (n < 20) return ONES[n];
  const t = TENS[Math.floor(n / 10)];
  return n % 10 ? `${t}-${ONES[n % 10]}` : t;
}

function below1000(n: number): string {
  const h = Math.floor(n / 100);
  const rest = n % 100;
  return [h ? `${ONES[h]} Hundred` : "", rest ? below100(rest) : ""].filter(Boolean).join(" ");
}

/** Lakh and crore - how a rupee amount is read aloud in India (1,25,000 = One Lakh Twenty-Five Thousand). */
function indianWords(n: number): string {
  if (n === 0) return "Zero";
  const parts: string[] = [];
  const crore = Math.floor(n / 1e7);
  if (crore) parts.push(`${indianWords(crore)} Crore`);
  n %= 1e7;
  const lakh = Math.floor(n / 1e5);
  if (lakh) parts.push(`${below100(lakh)} Lakh`);
  n %= 1e5;
  const thousand = Math.floor(n / 1000);
  if (thousand) parts.push(`${below100(thousand)} Thousand`);
  n %= 1000;
  if (n) parts.push(below1000(n));
  return parts.join(" ");
}

/** Thousand / million / billion - the international reading, used for euro amounts. */
function internationalWords(n: number): string {
  if (n === 0) return "Zero";
  const scales: [number, string][] = [[1e9, "Billion"], [1e6, "Million"], [1e3, "Thousand"]];
  const parts: string[] = [];
  for (const [size, name] of scales) {
    const q = Math.floor(n / size);
    if (q) parts.push(`${below1000(q)} ${name}`);
    n %= size;
  }
  if (n) parts.push(below1000(n));
  return parts.join(" ");
}

/**
 * The amount written out, as a receipt states it beside the figures - the line a receipt is
 * read by when a digit is smudged or disputed.
 *
 *   125000_50 INR → "Indian Rupees One Lakh Twenty-Five Thousand and Fifty Paise Only"
 *   1250_00 EUR   → "Euros One Thousand Two Hundred Fifty Only"
 */
export function amountInWords(minor: bigint, currency: "INR" | "EUR"): string {
  const abs = minor < 0n ? -minor : minor;
  const major = Number(abs / 100n);
  const fraction = Number(abs % 100n);
  const inr = currency === "INR";
  const words = inr ? indianWords(major) : internationalWords(major);
  const unit = inr ? "Indian Rupees" : "Euros";
  const sub = fraction ? ` and ${below100(fraction)} ${inr ? "Paise" : fraction === 1 ? "Cent" : "Cents"}` : "";
  return `${unit} ${words}${sub} Only`;
}
