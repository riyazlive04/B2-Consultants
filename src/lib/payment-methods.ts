/**
 * Which payment methods belong to which currency.
 *
 * WHY THIS IS NARROWED. The method list was one flat set of eight, so recording a rupee payment
 * offered "Bank transfer (EUR)" and "PayPal" - routes that money did not and could not arrive by
 * - and recording a euro payment offered UPI and Razorpay, which are rupee rails. Either way the
 * method on the row is a guess at best and wrong at worst, and the method is what reconciliation
 * against a bank statement is done on: a €500 payment filed as UPI never matches anything.
 *
 * So the list follows the currency the money was entered in. Nothing is invented - this only
 * HIDES methods that cannot apply - and a split payment (part ₹, part €) shows the union, because
 * then both rails genuinely were used.
 *
 * Pure and isomorphic: the form filters with it and the server action re-checks with it, so a
 * crafted POST cannot store a method the form would never have offered.
 */

export type MoneyCurrency = "INR" | "EUR";

/**
 * EUR rails. Credit card, PayPal, a euro bank transfer, cash and "Other" - the five the founder
 * actually gets paid in euros by.
 */
export const EUR_PAYMENT_METHODS = [
  "CREDIT_CARD",
  "PAYPAL",
  "BANK_TRANSFER_EUR",
  "CASH",
  "OTHER",
] as const;

/**
 * INR rails. Everything except the two that are euro-only by definition - a euro bank transfer
 * and PayPal, which B2 takes euros through.
 */
export const INR_PAYMENT_METHODS = [
  "BANK_TRANSFER_INR",
  "UPI",
  "RAZORPAY",
  "CREDIT_CARD",
  "CASH",
  "OTHER",
] as const;

/** Every method the enum holds, for a form with no amount typed yet. */
export const ALL_PAYMENT_METHODS = [
  "BANK_TRANSFER_INR",
  "UPI",
  "RAZORPAY",
  "CREDIT_CARD",
  "BANK_TRANSFER_EUR",
  "PAYPAL",
  "CASH",
  "OTHER",
] as const;

/**
 * The methods allowed for the currencies in play.
 *
 * `currencies` is what the form will actually SUBMIT, not what is on screen: an amount box
 * showing a conversion submits nothing (see AmountPair), so a payment typed in euros narrows to
 * the euro rails even while the rupee equivalent is displayed beside it.
 *
 * No currency yet means no basis to narrow on, so the full list shows - an empty dropdown on an
 * untouched form would read as a broken field.
 */
export function methodsForCurrencies(currencies: MoneyCurrency[]): readonly string[] {
  const inr = currencies.includes("INR");
  const eur = currencies.includes("EUR");
  if (!inr && !eur) return ALL_PAYMENT_METHODS;
  if (inr && !eur) return INR_PAYMENT_METHODS;
  if (eur && !inr) return EUR_PAYMENT_METHODS;
  // A genuine split payment used both rails - offer both, in the canonical order.
  return ALL_PAYMENT_METHODS;
}

/** Which currencies a pair of major-unit form values represents ("" = not in play). */
export function currenciesInPlay(amounts: { inr: string; eur: string }): MoneyCurrency[] {
  const out: MoneyCurrency[] = [];
  if (amounts.inr.trim() !== "") out.push("INR");
  if (amounts.eur.trim() !== "") out.push("EUR");
  return out;
}

/**
 * Keep a chosen method only while it is still offered.
 *
 * Typing a euro amount after picking UPI would otherwise leave "UPI" selected but absent from
 * the list - the control shows one thing and submits another, which is the bug class the money
 * fields already guard against. The caller falls back to this instead.
 */
export function defaultMethodFor(currencies: MoneyCurrency[], current: string): string {
  const allowed = methodsForCurrencies(currencies);
  if (allowed.includes(current)) return current;
  // The first rail of the narrowed list: a bank transfer in the currency entered. Never "Other",
  // which needs its own free-text answer and must always be a deliberate choice.
  return allowed[0] ?? "OTHER";
}
