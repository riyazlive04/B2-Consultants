import { formatEurMinor, formatInrMinor } from "./format";

/**
 * How a dual-currency amount is rendered once the reader has picked a currency.
 *
 * Every money figure in this app is stored twice — the INR aggregate and the EUR aggregate of the
 * same money (lib/money.ts). The ₹/€ toggle does not convert anything at read time; it chooses
 * WHICH of the two stored figures leads. So this module is presentation only, and both numbers
 * always come from the same source row.
 *
 * Pure and server-safe on purpose: the React context that holds the preference lives in
 * components/ui/CurrencyToggle.tsx, but the formatting has to be callable from anywhere,
 * including a server component that already knows the currency.
 */

export type Ccy = "INR" | "EUR";

/** Both aggregates of one amount, in minor units (paise / cents). */
export type MoneyAgg = { inr: number; eur: number };

export type MoneyOpts = {
  /** "₹1.2L" instead of "₹1,20,000" — for chart axes and dense cells. */
  compact?: boolean;
};

/** The chosen currency's figure. */
export function money(m: MoneyAgg, ccy: Ccy, opts?: MoneyOpts): string {
  return ccy === "EUR" ? formatEurMinor(m.eur, opts) : formatInrMinor(m.inr, opts);
}

/** The other currency's figure — shown beneath the primary one, never instead of it. */
export function moneyAlt(m: MoneyAgg, ccy: Ccy, opts?: MoneyOpts): string {
  return ccy === "EUR" ? formatInrMinor(m.inr, opts) : formatEurMinor(m.eur, opts);
}

/**
 * Primary + secondary in one call, for the "big number, small number beneath" pattern the
 * KPI cards established and the toggle now applies everywhere.
 */
export function moneyPair(m: MoneyAgg, ccy: Ccy, opts?: MoneyOpts): { primary: string; secondary: string } {
  return { primary: money(m, ccy, opts), secondary: moneyAlt(m, ccy, opts) };
}

/**
 * One-line "₹50,000 · 460 €" with the chosen currency FIRST — for table cells, where a
 * two-line stack would double every row's height.
 */
export function moneyInline(m: MoneyAgg, ccy: Ccy, opts?: MoneyOpts): string {
  const { primary, secondary } = moneyPair(m, ccy, opts);
  return `${primary} · ${secondary}`;
}

/** The currency symbol, for axis labels and column headers. */
export function ccySymbol(ccy: Ccy): string {
  return ccy === "EUR" ? "€" : "₹";
}

/**
 * Sort/CSV value for a money column: always the chosen currency's number, so ordering a table
 * by an amount matches what is on screen rather than a hidden second currency.
 */
export function moneyValue(m: MoneyAgg, ccy: Ccy): number {
  return (ccy === "EUR" ? m.eur : m.inr) / 100;
}
