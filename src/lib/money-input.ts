/**
 * Grouping money WHILE IT IS BEING TYPED, in the convention of its own currency.
 *
 * ₹ follows Indian grouping with a dot decimal   →  1,25,000.50
 * € follows German grouping with a comma decimal →  125.000,50
 *
 * WHY IT MATTERS HERE. The amount boxes accepted bare digits, so a six-figure fee read as
 * "125000" and the only way to check you had not typed a zero too many was to count the
 * characters. Every PLACE the same number is displayed back - the tables, the KPIs, the PDF -
 * already groups it (lib/format), so the one screen where getting it wrong actually costs
 * money was the one screen that did not.
 *
 * ── THE CANONICAL VALUE IS NEVER WHAT IS ON SCREEN ────────────────────────────────
 * A euro amount groups with DOTS, and `majorStringToMinor` reads a dot as a decimal point. So
 * "125.000,50" parsed as-is is €125 - a four-order-of-magnitude error, silently, on the way into
 * the database. Display text therefore never reaches a server action: the visible box is unnamed
 * and a hidden input carries the canonical `125000.50` under the field's real name (see
 * `MoneyInput`). This module is the pair of functions that convert between the two, and they are
 * exact inverses by construction.
 */

import type { MoneyCurrency } from "./payment-methods";

type Separators = { group: string; decimal: string; groupSize: "indian" | "western" };

const SEPARATORS: Record<MoneyCurrency, Separators> = {
  INR: { group: ",", decimal: ".", groupSize: "indian" },
  EUR: { group: ".", decimal: ",", groupSize: "western" },
};

/**
 * Group an integer digit string.
 *
 * Indian grouping is NOT every three digits: it is the last three, then twos
 * ("1,25,00,000"). Hand-rolled rather than via Intl because this runs on a partial number
 * mid-keystroke, where `Intl.NumberFormat` would need a `Number` round trip and lose precision
 * on long values and trailing zeros.
 */
function groupDigits(digits: string, sep: Separators): string {
  if (digits.length <= 3) return digits;
  if (sep.groupSize === "western") {
    return digits.replace(/\B(?=(\d{3})+(?!\d))/g, sep.group);
  }
  const head = digits.slice(0, -3);
  const tail = digits.slice(-3);
  return `${head.replace(/\B(?=(\d{2})+(?!\d))/g, sep.group)}${sep.group}${tail}`;
}

/**
 * Anything a person can type or paste → the canonical major-unit string ("125000.50").
 *
 * Tolerant on purpose. A pasted "₹1,25,000.50", a hand-typed "125000,5" in the euro box and a
 * bare "125000" all have to arrive at the same number, because all three are things that
 * genuinely get pasted into these boxes from WhatsApp, a bank statement or a spreadsheet.
 *
 * Returns "" for anything with no digits at all, which is the "this currency is not in play"
 * the forms already model - NEVER "0", because zero is an amount and absence is not.
 */
export function toCanonicalMoney(raw: string, currency: MoneyCurrency): string {
  const sep = SEPARATORS[currency];
  // Strip currency symbols, spaces and the group separator; keep digits and the decimal mark.
  let s = raw.replace(/[^\d.,]/g, "");
  if (s === "") return "";
  /**
   * WHICH MARK IS THE DECIMAL POINT. The currency's own convention leads, but a value typed with
   * the other one is still read correctly when it cannot be anything else: "125000.50" in the
   * euro box has a dot followed by exactly two digits and no comma, which is a decimal, not a
   * group - and reading it as a group would turn €125,000.50 into €12,500,050.
   */
  const hasOwn = s.includes(sep.decimal);
  const other = sep.decimal === "." ? "," : ".";
  const hasOther = s.includes(other);
  let decimalMark = sep.decimal;
  if (!hasOwn && hasOther) {
    // Only the foreign mark is present. It is a decimal point if it appears once and leaves 1-2
    // trailing digits; otherwise it is this currency's grouping being typed the other way round.
    const idx = s.lastIndexOf(other);
    const tail = s.length - idx - 1;
    const once = s.indexOf(other) === idx;
    decimalMark = once && tail >= 1 && tail <= 2 ? other : sep.decimal;
  }
  const groupMark = decimalMark === "." ? "," : ".";
  s = s.split(groupMark).join("");
  const parts = s.split(decimalMark);
  const whole = (parts.shift() ?? "").replace(/\D/g, "");
  const frac = parts.join("").replace(/\D/g, "").slice(0, 2);
  if (whole === "" && frac === "") return "";
  // Keep a trailing separator the typist is mid-way through ("125." → "125.") so the next
  // keystroke lands in the decimals rather than being swallowed.
  const typingDecimals = parts.length > 0 || raw.trimEnd().endsWith(decimalMark);
  if (!typingDecimals) return whole || "0";
  return `${whole || "0"}.${frac}`;
}

/**
 * Canonical "125000.5" → the grouped display text for its currency ("1,25,000.5" / "125.000,5").
 *
 * Decimals are shown exactly as typed, NOT padded to two places: forcing ".00" onto "125" while
 * somebody is still typing moves the caret into the decimals and they end up entering ₹1.25.
 * The stored value is padded on the way to minor units (`majorStringToMinor`), where it is safe.
 */
export function toDisplayMoney(canonical: string, currency: MoneyCurrency): string {
  if (canonical === "") return "";
  const sep = SEPARATORS[currency];
  const [whole = "", frac] = canonical.split(".");
  const digits = whole.replace(/\D/g, "");
  const head = groupDigits(digits === "" ? "0" : digits, sep);
  // `canonical.includes(".")` rather than `frac` so a half-typed "125." keeps its point.
  return canonical.includes(".") ? `${head}${sep.decimal}${frac ?? ""}` : head;
}

/**
 * Where the caret belongs after re-grouping.
 *
 * Re-writing the box's value on every keystroke sends the caret to the end, which makes editing
 * the middle of a number impossible - type a digit into "1,25,000" and you are suddenly at the
 * far right. Counting SIGNIFICANT characters (digits and the decimal mark) rather than offsets
 * is what survives separators appearing and disappearing to the left of the caret.
 */
export function caretAfterFormat(
  display: string,
  caretInRaw: number,
  raw: string,
  currency: MoneyCurrency,
): number {
  const decimal = SEPARATORS[currency].decimal;
  const significant = (s: string) => (s.match(/[\d]/g) ?? []).length;
  const before = significant(raw.slice(0, caretInRaw)) + (raw.slice(0, caretInRaw).includes(decimal) ? 1 : 0);
  let seen = 0;
  for (let i = 0; i < display.length; i++) {
    const ch = display[i];
    if (/\d/.test(ch) || ch === decimal) seen++;
    if (seen >= before) return i + 1;
  }
  return display.length;
}
