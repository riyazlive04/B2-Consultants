/**
 * Invoice arithmetic, in the currency the invoice is ISSUED in.
 *
 * NO prisma, NO server-only: the editor computes a live preview from exactly the same functions
 * the server action computes the stored figures from, so what the founder watches add up on
 * screen and what lands in the database can never drift apart.
 *
 * ── WHY AN INVOICE HAS A CURRENCY ────────────────────────────────────────────────
 * Every invoice used to be priced in rupees, with only the TOTAL converted to euros at save time
 * as a footnote. B2 Consultants bills out of Reichelsheim as well as India: a German client's
 * invoice has to be a euro document - euro line prices, a euro discount, a euro tax line and a
 * euro total - not a rupee document with a euro afterthought at the bottom. `currency` is which
 * one was TYPED; it decides what prints on the invoice, the PDF and the public page.
 *
 * Both sides are still stored on every row (`…InrMinor` + `…EurMinor`, with `fxRateUsed` stamped
 * at save), because the KPI cards, the ageing and the ledger aggregate in rupees across all
 * invoices and must not re-convert at today's rate when the euro moves. The entered side is the
 * truth; the other side is a snapshot taken once, exactly as `lib/money.ts` treats every other
 * amount in the app.
 *
 * ── ALL MATH HAPPENS IN THE ENTERED CURRENCY ─────────────────────────────────────
 * Tax on a euro invoice is a percentage of the euro taxable amount - NOT the rupee tax converted
 * to euros. Converting last would leave €19.00 of VAT printed as €18.99 whenever the rounding
 * fell badly, and a tax line that does not equal rate × base is a defective invoice. So the whole
 * ladder (subtotal → discount → taxable → tax → total) is computed in integer minor units of the
 * issued currency, and only the finished figures are mirrored across.
 */

import { formatEurMinor, formatInrMinor, majorStringToMinor } from "./format";

export type InvoiceCurrencyCode = "INR" | "EUR";

export const INVOICE_CURRENCIES: readonly InvoiceCurrencyCode[] = ["INR", "EUR"] as const;

export const CURRENCY_SYMBOLS: Record<InvoiceCurrencyCode, string> = { INR: "₹", EUR: "€" };

export const CURRENCY_LABELS: Record<InvoiceCurrencyCode, string> = {
  INR: "₹ Indian rupee",
  EUR: "€ Euro",
};

/** Narrow an unknown/stored string to a currency, defaulting to the historic one (INR). */
export function asInvoiceCurrency(value: unknown): InvoiceCurrencyCode {
  return value === "EUR" ? "EUR" : "INR";
}

/** The app's own grouping per currency (§6): ₹1,25,000.50 and 125.000,50 €. */
export function formatMinor(minor: bigint | number, currency: InvoiceCurrencyCode): string {
  return currency === "EUR" ? formatEurMinor(minor) : formatInrMinor(minor);
}

/** The OTHER currency - what the mirrored figure is shown in. */
export const otherCurrency = (c: InvoiceCurrencyCode): InvoiceCurrencyCode => (c === "INR" ? "EUR" : "INR");

export type InvoiceLineInput = {
  /** At least 1 - a line item for nothing is not a line item. */
  quantity: number;
  /** Canonical major-unit string in the invoice's currency, as MoneyInput submits it ("1500.50"). */
  unitPrice: string;
};

export type InvoiceTotals = {
  subtotalMinor: bigint;
  discountMinor: bigint;
  /** Subtotal less discount, floored at zero - the base the tax percentage applies to. */
  taxableMinor: bigint;
  taxMinor: bigint;
  totalMinor: bigint;
};

/** One line's own amount: unit price × quantity, in the invoice's currency. */
export function lineTotalMinor(line: InvoiceLineInput): bigint {
  return majorStringToMinor(line.unitPrice || "0") * BigInt(Math.max(1, Math.trunc(line.quantity) || 1));
}

/**
 * The whole ladder, in the issued currency's minor units.
 *
 * `taxPercent` may carry decimals (a 7.5% rate is a real rate), so the tax is rounded HALF-UP to
 * the minor unit once, at the end - never per line, which is how a 100-line invoice ends up a
 * rupee adrift from rate × base.
 */
export function computeInvoiceTotals(
  items: InvoiceLineInput[],
  discountInput: string | null | undefined,
  taxPercent: number,
): InvoiceTotals {
  const subtotalMinor = items.reduce((a, it) => a + lineTotalMinor(it), 0n);
  const discountMinor = discountInput?.trim() ? majorStringToMinor(discountInput) : 0n;
  const raw = subtotalMinor - discountMinor;
  const taxableMinor = raw > 0n ? raw : 0n;
  const pct = Number.isFinite(taxPercent) ? Math.max(0, Math.min(100, taxPercent)) : 0;
  // Number() is safe here: an invoice total is money, not an id - it stays far inside 2^53.
  const taxMinor = BigInt(Math.round((Number(taxableMinor) * pct) / 100));
  return { subtotalMinor, discountMinor, taxableMinor, taxMinor, totalMinor: taxableMinor + taxMinor };
}

/**
 * Convert between the two currencies at a plain number rate (INR per EUR).
 *
 * For the EDITOR'S PREVIEW only. The server mirrors with `lib/fx`'s Decimal converters, which is
 * what actually gets stored - this exists so the sidebar can show "≈ €1,420" while typing without
 * dragging Prisma's Decimal into a client bundle.
 */
export function convertMinorPreview(
  minor: bigint,
  inrPerEur: number,
  from: InvoiceCurrencyCode,
  to: InvoiceCurrencyCode,
): bigint {
  if (from === to || !Number.isFinite(inrPerEur) || inrPerEur <= 0) return minor;
  const n = Number(minor);
  return BigInt(Math.round(to === "EUR" ? n / inrPerEur : n * inrPerEur));
}

/**
 * How the tax row reads on a document - or `null` when the invoice carries no tax.
 *
 * An invoice with nothing to charge should not print "Tax (0%)  ₹0.00": that is an assertion
 * that tax was considered and came to nothing, on a document where the reader is entitled to
 * assume every line means something. A 0% rate therefore removes the row entirely, which is
 * also how "invoice this customer without tax" is expressed - set the rate to 0 and the line
 * disappears from the editor, the public page and the PDF alike.
 */
export function taxLine(label: string | null | undefined, percent: number): string | null {
  if (!Number.isFinite(percent) || percent <= 0) return null;
  // A whole percentage prints as "18%", a fractional one keeps its decimals ("7.5%").
  const pct = Number.isInteger(percent) ? String(percent) : String(Number(percent.toFixed(3)));
  return `${label?.trim() || "Tax"} (${pct}%)`;
}

/**
 * The programme an invoice is mostly FOR - the level its biggest line sells.
 *
 * A paid invoice posts one Income row, and an Income row carries exactly one `programLevel`,
 * which decides both the GL account the revenue lands in and which business line's book it shows
 * up in. An invoice mixing a coaching tier and a German level therefore has to resolve to one of
 * them, and the largest line is the honest answer: it is the thing the customer mainly bought.
 * An invoice with no programme lines at all returns null, and callers file it under "OTHER"
 * exactly as they always did.
 *
 * Lives here, in a pure module, rather than beside the action that needs it: a `"use server"`
 * file may only export async functions, and every export of one is a public RPC endpoint.
 */
export function dominantLevelCode(
  lines: { levelCode: string | null; quantity: number; unitPriceMinor: bigint }[],
): string | null {
  const byLevel = new Map<string, bigint>();
  for (const l of lines) {
    if (!l.levelCode) continue;
    const amount = l.unitPriceMinor * BigInt(Math.max(1, l.quantity));
    byLevel.set(l.levelCode, (byLevel.get(l.levelCode) ?? 0n) + amount);
  }
  let best: string | null = null;
  let bestAmount = -1n;
  for (const [code, amount] of byLevel) {
    if (amount > bestAmount) { best = code; bestAmount = amount; }
  }
  return best;
}

/**
 * "1,25,000.50 INR" / "125.000,50 EUR" - money for a PDF, with no currency SYMBOL.
 *
 * DOCUMENT ONLY. ₹ (U+20B9) does not exist in WinAnsi, the encoding of react-pdf's built-in
 * Helvetica, so every rupee figure on the invoice PDF was rendering as a blank box where the
 * symbol should be - on the one document a customer is most likely to print. The ISO code is
 * also the normal convention on a cross-border invoice, where "€" alone leaves a reader guessing
 * which of several euro-ish conventions the grouping follows.
 *
 * On-screen surfaces keep `formatMinor` (₹1,25,000.50), per the design system.
 */
export function formatMinorForDocument(minor: bigint | number, currency: InvoiceCurrencyCode): string {
  // Strip the symbol the Intl formatter put there, keeping its grouping and decimals intact.
  const grouped = formatMinor(minor, currency).replace(/[₹€]/g, "").trim();
  return `${grouped} ${currency}`;
}
