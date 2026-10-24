import "server-only";
import { cache } from "react";

import { prisma } from "@/lib/prisma";
import { formatInrMinor, formatEurMinor, formatDate, minorToMajorString } from "@/lib/format";
import {
  asInvoiceCurrency,
  formatMinor,
  formatMinorForDocument,
  otherCurrency,
  taxLine,
  type InvoiceCurrencyCode,
} from "@/lib/invoice-money";
import { getLevels } from "./levels";
import { getInvoiceSettings } from "./founder-config";
import { lineForKind, BUSINESS_LINE_LABELS } from "@/lib/business-line";
import { ACTIVE } from "@/lib/soft-delete";
import { toDateInputValue } from "@/lib/dates";
import type { InvoiceKind, Prisma } from "@prisma/client";
import type { InvoicePdfData } from "@/documents/invoice-pdf";
import type { ReceiptPdfData } from "@/documents/receipt-pdf";
import { AGREEMENT_INVOICE_TERMS, AGREEMENT_RECEIPT_TERM, agreementDataSchema } from "@/lib/agreement";
import { amountInWords, isProvisionalNumber } from "@/lib/invoice-compliance";

/** Read layer for Payments (Synamate "Payments": Invoices, Estimates, Products, Subscriptions). */

export type PaymentsOverview = {
  draftInr: string;
  dueInr: string;
  receivedInr: string;
  overdueInr: string;
  counts: { draft: number; sent: number; paid: number; overdue: number };
  /** "Received" broken down by how it came in - feeds that card's detail popup. */
  receivedByMethod: { method: string; amountInr: string }[];
};

/**
 * @param period Scope to invoices ISSUED in this window. Omit for every invoice ever, which is
 *   what this did before - and which is why "how much did we invoice in July" had no answer here.
 *   Scoped on `issueDate` (a `@db.Date` column, so the UTC-midnight boundaries line up exactly
 *   with the period's own), NOT on `paidAt`: this board is about what was billed.
 */
export async function getPaymentsOverview(period?: { start: Date; endExclusive: Date }): Promise<PaymentsOverview> {
  const issued = period ? { issueDate: { gte: period.start, lt: period.endExclusive } } : {};
  const invoices = await prisma.invoice.findMany({
    where: { ...ACTIVE, kind: "INVOICE", ...issued },
    select: { status: true, totalInrMinor: true, dueDate: true, payments: { select: { amountInrMinor: true, method: true } } },
  });
  let draft = 0n, due = 0n, received = 0n, overdue = 0n;
  const counts = { draft: 0, sent: 0, paid: 0, overdue: 0 };
  const byMethod = new Map<string, bigint>();
  const today = new Date();
  for (const i of invoices) {
    const paid = i.payments.reduce((a, p) => a + p.amountInrMinor, 0n);
    const balance = i.totalInrMinor - paid;
    received += paid;
    for (const p of i.payments) byMethod.set(p.method, (byMethod.get(p.method) ?? 0n) + p.amountInrMinor);
    if (i.status === "DRAFT") { draft += i.totalInrMinor; counts.draft++; }
    else if (i.status === "PAID") { counts.paid++; }
    else if (i.status === "VOID") { /* excluded */ }
    else {
      due += balance > 0n ? balance : 0n;
      counts.sent++;
      if (i.dueDate && i.dueDate < today && balance > 0n) { overdue += balance; counts.overdue++; }
    }
  }
  return {
    draftInr: formatInrMinor(draft),
    dueInr: formatInrMinor(due),
    receivedInr: formatInrMinor(received),
    overdueInr: formatInrMinor(overdue),
    counts,
    receivedByMethod: [...byMethod.entries()]
      .sort((a, b) => (b[1] > a[1] ? 1 : b[1] < a[1] ? -1 : 0))
      .map(([method, amount]) => ({ method: method.charAt(0).toUpperCase() + method.slice(1), amountInr: formatInrMinor(amount) })),
  };
}

export type InvoiceRow = {
  id: string;
  number: string;
  customerName: string;
  status: string;
  /** In the currency the invoice was ISSUED in - what the customer was actually asked for. */
  totalDisplay: string;
  balanceDisplay: string;
  currency: InvoiceCurrencyCode;
  issueDate: Date;
  dueDate: Date | null;
};

export async function getInvoicesList(
  kind: InvoiceKind,
  period?: { start: Date; endExclusive: Date },
): Promise<InvoiceRow[]> {
  const invoices = await prisma.invoice.findMany({
    // Same window as the KPI cards above it, or the table and the totals would describe
    // different sets of invoices on the same screen.
    where: { ...ACTIVE, kind, ...(period ? { issueDate: { gte: period.start, lt: period.endExclusive } } : {}) },
    orderBy: { createdAt: "desc" },
    include: { payments: { select: { amountInrMinor: true, amountEurMinor: true } } },
  });
  return invoices.map((i) => {
    const currency = asInvoiceCurrency(i.currency);
    const eur = currency === "EUR";
    const paid = i.payments.reduce((a, p) => a + (eur ? p.amountEurMinor : p.amountInrMinor), 0n);
    const total = eur ? i.totalEurMinor : i.totalInrMinor;
    return {
      id: i.id,
      number: i.number,
      customerName: i.customerName,
      status: i.status,
      totalDisplay: formatMinor(total, currency),
      balanceDisplay: formatMinor(total - paid, currency),
      currency,
      issueDate: i.issueDate,
      dueDate: i.dueDate,
    };
  });
}

export type InvoiceItemEdit = {
  id: string;
  description: string;
  quantity: number;
  /** Canonical major string in the INVOICE's currency - what the editor's money box holds. */
  unitPrice: string;
  lineTotalDisplay: string;
  levelCode: string | null;
  levelLabel: string | null;
};

export type InvoiceDetail = {
  id: string;
  kind: InvoiceKind;
  number: string;
  status: string;
  leadId: string | null;
  customerName: string;
  customerEmail: string | null;
  customerPhone: string | null;
  customerAddress: string;
  issueDate: string; // YYYY-MM-DD
  dueDate: string;
  servicePeriodStart: string; // YYYY-MM-DD or ""
  servicePeriodEnd: string;
  agreementRef: string;
  taxNote: string;
  /** Issued = numbered and locked. Always false on an estimate. */
  issued: boolean;
  /** Still carrying its DRAFT-xxxx placeholder rather than a real INV- number. */
  provisional: boolean;
  currency: InvoiceCurrencyCode;
  items: InvoiceItemEdit[];
  discount: string;
  taxPercent: number;
  taxLabel: string | null;
  notes: string | null;
  publicToken: string;
  subtotalDisplay: string;
  taxDisplay: string;
  totalDisplay: string;
  /** The same total in the OTHER currency, at the rate stamped on this invoice. */
  convertedTotalDisplay: string;
  amountPaidDisplay: string;
  balanceDisplay: string;
  /** Canonical major string ("1500.50") - what the record-payment box opens pre-filled with. */
  balance: string;
  payments: {
    id: string;
    amountDisplay: string;
    method: string;
    reference: string | null;
    paidAt: Date;
    receiptNumber: string | null;
    receiptSentAt: Date | null;
  }[];
};

/**
 * `cache()` so the page and its `generateMetadata` can both ask for the invoice and only one
 * query is issued. Next calls `generateMetadata` and the page component in the same request, so
 * without this the tab label would cost a second round trip to Singapore for every invoice
 * opened - which is why the other detail pages take a static title instead of naming the record.
 */
export const getInvoice = cache(async function getInvoice(id: string): Promise<InvoiceDetail | null> {
  const [i, levels] = await Promise.all([
    prisma.invoice.findUnique({
      where: { id },
      include: { items: { orderBy: { position: "asc" } }, payments: { orderBy: { paidAt: "desc" } } },
    }),
    getLevels(),
  ]);
  if (!i) return null;
  const currency = asInvoiceCurrency(i.currency);
  const eur = currency === "EUR";
  /** Pick the side of a stored pair that this invoice is denominated in. */
  const own = (inr: bigint, e: bigint) => (eur ? e : inr);
  const labelOf = new Map(levels.map((l) => [l.code, l.label]));
  const paid = i.payments.reduce((a, p) => a + own(p.amountInrMinor, p.amountEurMinor), 0n);
  const total = own(i.totalInrMinor, i.totalEurMinor);
  return {
    id: i.id,
    kind: i.kind,
    number: i.number,
    status: i.status,
    leadId: i.leadId,
    customerName: i.customerName,
    customerEmail: i.customerEmail,
    customerPhone: i.customerPhone,
    customerAddress: i.customerAddress ?? "",
    issueDate: toDateInputValue(i.issueDate),
    dueDate: i.dueDate ? toDateInputValue(i.dueDate) : "",
    servicePeriodStart: i.servicePeriodStart ? toDateInputValue(i.servicePeriodStart) : "",
    servicePeriodEnd: i.servicePeriodEnd ? toDateInputValue(i.servicePeriodEnd) : "",
    agreementRef: i.agreementRef ?? "",
    taxNote: i.taxNote ?? "",
    issued: i.kind === "INVOICE" && !!i.issuedAt,
    provisional: isProvisionalNumber(i.number),
    currency,
    items: i.items.map((it) => {
      const unit = own(it.unitPriceInrMinor, it.unitPriceEurMinor);
      return {
        id: it.id,
        description: it.description,
        quantity: it.quantity,
        unitPrice: minorToMajorString(unit),
        lineTotalDisplay: formatMinor(unit * BigInt(it.quantity), currency),
        levelCode: it.levelCode,
        levelLabel: it.levelCode ? labelOf.get(it.levelCode) ?? it.levelCode : null,
      };
    }),
    discount: minorToMajorString(own(i.discountInrMinor, i.discountEurMinor)),
    taxPercent: Number(i.taxPercent),
    taxLabel: i.taxLabel,
    notes: i.notes,
    publicToken: i.publicToken,
    subtotalDisplay: formatMinor(own(i.subtotalInrMinor, i.subtotalEurMinor), currency),
    taxDisplay: formatMinor(own(i.taxInrMinor, i.taxEurMinor), currency),
    totalDisplay: formatMinor(total, currency),
    convertedTotalDisplay: formatMinor(
      eur ? i.totalInrMinor : i.totalEurMinor,
      otherCurrency(currency),
    ),
    amountPaidDisplay: formatMinor(paid, currency),
    balanceDisplay: formatMinor(total - paid, currency),
    balance: minorToMajorString(total - paid > 0n ? total - paid : 0n),
    payments: i.payments.map((p) => ({
      id: p.id,
      amountDisplay: formatMinor(own(p.amountInrMinor, p.amountEurMinor), currency),
      method: p.method,
      reference: p.reference,
      paidAt: p.paidAt,
      receiptNumber: p.receiptNumber,
      receiptSentAt: p.receiptSentAt,
    })),
  };
});

/**
 * Everything a finished invoice DOCUMENT prints - shared by the public page and the PDF so the
 * two can never disagree about what was billed.
 *
 * Pre-formatted on the server, in the currency the invoice was issued in. The one figure quoted
 * in the other currency is the total, and it is labelled as a conversion at the stamped rate
 * rather than presented as a second amount owed - a customer must never be able to read an
 * invoice as asking for both.
 */
async function invoiceDocument(i: {
  kind: InvoiceKind;
  number: string;
  status: string;
  currency: string;
  customerName: string;
  customerEmail: string | null;
  customerPhone: string | null;
  customerAddress: string | null;
  issueDate: Date;
  dueDate: Date | null;
  servicePeriodStart: Date | null;
  servicePeriodEnd: Date | null;
  agreementRef: string | null;
  issuedAt: Date | null;
  notes: string | null;
  taxPercent: Prisma.Decimal;
  taxLabel: string | null;
  taxNote: string | null;
  fxRateUsed: Prisma.Decimal;
  subtotalInrMinor: bigint; subtotalEurMinor: bigint;
  discountInrMinor: bigint; discountEurMinor: bigint;
  taxInrMinor: bigint; taxEurMinor: bigint;
  totalInrMinor: bigint; totalEurMinor: bigint;
  createdBy: { name: string | null; email: string } | null;
  items: { description: string; quantity: number; unitPriceInrMinor: bigint; unitPriceEurMinor: bigint }[];
  payments: {
    amountInrMinor: bigint;
    amountEurMinor: bigint;
    receiptNumber: string | null;
    paidAt: Date;
    method: string;
  }[];
}, opts?: {
  /**
   * Format money WITHOUT its symbol ("1,25,000.50 INR"), for the PDF.
   *
   * ₹ does not exist in WinAnsi, the encoding of react-pdf's built-in Helvetica, so every rupee
   * figure on the PDF was printing a blank box where the symbol should be. See
   * `lib/invoice-money.formatMinorForDocument`.
   */
  plainMoney?: boolean;
}) {
  const settings = await getInvoiceSettings();
  const money = opts?.plainMoney ? formatMinorForDocument : formatMinor;
  const currency = asInvoiceCurrency(i.currency);
  const eur = currency === "EUR";
  const own = (inr: bigint, e: bigint) => (eur ? e : inr);
  const paid = i.payments.reduce((a, p) => a + own(p.amountInrMinor, p.amountEurMinor), 0n);
  const total = own(i.totalInrMinor, i.totalEurMinor);
  const discount = own(i.discountInrMinor, i.discountEurMinor);
  const percent = Number(i.taxPercent);

  return {
    kind: i.kind,
    number: i.number,
    status: i.status,
    currency,
    issuer: settings.issuer,
    customerName: i.customerName,
    customerEmail: i.customerEmail,
    customerPhone: i.customerPhone,
    /** One line per line typed - §14 UStG requires the recipient's address, not just a name. */
    customerAddressLines: (i.customerAddress ?? "").split("\n").map((l) => l.trim()).filter(Boolean),
    issueDate: i.issueDate,
    dueDate: i.dueDate,
    /** The date or period the service is supplied - §14 Abs. 4 Nr. 6 UStG. */
    servicePeriod: servicePeriodText(i.servicePeriodStart, i.servicePeriodEnd),
    agreementRef: i.agreementRef,
    /**
     * The agreement's own payment terms, when this invoice bills under one - so the invoice and the
     * contract cannot state different refund or late-payment rules.
     */
    agreementTerms: i.agreementRef ? [...AGREEMENT_INVOICE_TERMS] : [],
    /** What to write on the transfer, so the money can be matched to this invoice. */
    paymentReference: isProvisionalNumber(i.number) ? null : i.number,
    notes: i.notes,
    /** Who raised it. An invoice is somebody's act, and a document that says so can be queried. */
    issuedByName: i.createdBy?.name?.trim() || i.createdBy?.email || null,
    items: i.items.map((it) => {
      const unit = own(it.unitPriceInrMinor, it.unitPriceEurMinor);
      return {
        description: it.description,
        quantity: it.quantity,
        unitPriceDisplay: money(unit, currency),
        lineTotalDisplay: money(unit * BigInt(it.quantity), currency),
      };
    }),
    subtotalDisplay: money(own(i.subtotalInrMinor, i.subtotalEurMinor), currency),
    // A discount of nothing is not a discount - the row is dropped rather than printed as zero.
    discountDisplay: discount > 0n ? money(discount, currency) : null,
    /** null when the invoice carries no tax at all, which removes the row entirely. */
    taxLineLabel: taxLine(i.taxLabel, percent),
    taxDisplay: percent > 0 ? money(own(i.taxInrMinor, i.taxEurMinor), currency) : null,
    /**
     * Why no tax is charged, in place of the tax line. An issued invoice prints the note it was
     * issued with; a draft preview shows what it WOULD take from the Console.
     */
    taxNote:
      percent > 0
        ? null
        : i.taxNote?.trim() || (i.issuedAt ? null : settings.tax[currency].note.trim() || null),
    /** Every payment's receipt, for the public page to link. */
    receipts: i.payments
      .filter((p) => p.receiptNumber)
      .map((p) => ({
        number: p.receiptNumber as string,
        paidAt: p.paidAt,
        amountDisplay: money(own(p.amountInrMinor, p.amountEurMinor), currency),
      })),
    totalDisplay: money(total, currency),
    convertedTotalDisplay: money(eur ? i.totalInrMinor : i.totalEurMinor, otherCurrency(currency)),
    convertedRateNote: `Converted at 1 EUR = ${Number(i.fxRateUsed).toFixed(2)} INR on the issue date`,
    amountPaidDisplay: money(paid, currency),
    balanceDisplay: money(total - paid, currency),
    /** Nothing left to pay - the "how to pay" block is pointless on a settled invoice. */
    settled: total - paid <= 0n,
  };
}

export type InvoiceDocument = Awaited<ReturnType<typeof invoiceDocument>>;

/** The shape both document surfaces select - keep in step with `invoiceDocument`'s parameter. */
const DOCUMENT_INCLUDE = {
  items: { orderBy: { position: "asc" } },
  payments: {
    select: { amountInrMinor: true, amountEurMinor: true, receiptNumber: true, paidAt: true, method: true },
    orderBy: { paidAt: "asc" },
  },
  createdBy: { select: { name: true, email: true } },
} as const;

/** "01.11.2026 - 30.04.2027", or the one date, or null when none was set. */
function servicePeriodText(start: Date | null, end: Date | null): string | null {
  if (!start) return null;
  return end ? `${formatDate(start)} - ${formatDate(end)}` : formatDate(start);
}

export async function getPublicInvoice(token: string): Promise<InvoiceDocument | null> {
  const i = await prisma.invoice.findUnique({
    where: { publicToken: token },
    include: DOCUMENT_INCLUDE,
  });
  if (!i || i.status === "DRAFT" || i.status === "VOID") return null;
  return invoiceDocument(i);
}

/** The PDF form of a document already loaded - dates formatted, money symbol-free. */
function asPdfData(doc: InvoiceDocument): InvoicePdfData {
  return {
    ...doc,
    // The PDF is flat, pre-formatted output: it cannot call Intl or a date helper itself.
    issueDate: formatDate(doc.issueDate),
    dueDate: doc.dueDate ? formatDate(doc.dueDate) : null,
  };
}

/**
 * The public PDF, by token - the same document the public page shows.
 *
 * The route used to assemble this itself from `getPublicInvoice`, which meant it formatted the
 * dates with its own `toLocaleDateString` (server-local, not IST) and had to be edited in step
 * every time the document grew a field. One builder, two renderings.
 */
export async function getPublicInvoicePdfData(token: string): Promise<InvoicePdfData | null> {
  const i = await prisma.invoice.findUnique({ where: { publicToken: token }, include: DOCUMENT_INCLUDE });
  if (!i || i.status === "DRAFT" || i.status === "VOID") return null;
  return asPdfData(await invoiceDocument(i, { plainMoney: true }));
}

/**
 * Same document, keyed by id and NOT status-filtered - used only server-side (sendInvoice in
 * payments-actions.ts) to attach a PDF the moment a DRAFT invoice is first sent, before the
 * public /i/[token] page is allowed to show it.
 */
export async function getInvoicePdfData(id: string): Promise<InvoicePdfData | null> {
  const i = await prisma.invoice.findUnique({ where: { id }, include: DOCUMENT_INCLUDE });
  if (!i) return null;
  return asPdfData(await invoiceDocument(i, { plainMoney: true }));
}

// ─────────────────────────── Receipts ───────────────────────────

const METHOD_LABELS: Record<string, string> = {
  cash: "Cash",
  upi: "UPI",
  bank: "Bank transfer",
  card: "Credit / debit card",
  razorpay: "Razorpay",
  stripe: "Stripe",
  other: "Other",
};

/**
 * The receipt for one payment - the written confirmation of payment the agreement promises
 * (§7.4), as a document the student can keep.
 *
 * "Paid to date" and "balance" are as at THIS payment, counting only the payments up to and
 * including it. A receipt re-downloaded a month later must still say what was outstanding on the
 * day it was issued, not what is outstanding now.
 */
async function receiptDocument(paymentId: string): Promise<ReceiptPdfData | null> {
  const p = await prisma.invoicePayment.findUnique({
    where: { id: paymentId },
    include: {
      recordedBy: { select: { name: true, email: true } },
      invoice: {
        include: { payments: { select: { id: true, paidAt: true, amountInrMinor: true, amountEurMinor: true } } },
      },
    },
  });
  if (!p || !p.receiptNumber) return null;
  const inv = p.invoice;
  const settings = await getInvoiceSettings();
  const currency = asInvoiceCurrency(inv.currency);
  const own = (inr: bigint, e: bigint) => (currency === "EUR" ? e : inr);
  const amount = own(p.amountInrMinor, p.amountEurMinor);
  const total = own(inv.totalInrMinor, inv.totalEurMinor);
  const paidToDate = inv.payments
    .filter((x) => x.paidAt < p.paidAt || (x.paidAt.getTime() === p.paidAt.getTime() && x.id <= p.id))
    .reduce((a, x) => a + own(x.amountInrMinor, x.amountEurMinor), 0n);
  const balance = total - paidToDate;
  const money = formatMinorForDocument;

  return {
    receiptNumber: p.receiptNumber,
    receiptDate: formatDate(p.paidAt),
    issuer: settings.issuer,
    currency,
    customerName: inv.customerName,
    customerAddressLines: (inv.customerAddress ?? "").split("\n").map((l) => l.trim()).filter(Boolean),
    customerEmail: inv.customerEmail,
    amountDisplay: money(amount, currency),
    amountWords: amountInWords(amount, currency),
    method: METHOD_LABELS[p.method] ?? p.method,
    reference: p.reference,
    invoiceNumber: inv.number,
    invoiceDate: formatDate(inv.issueDate),
    invoiceTotalDisplay: money(total, currency),
    paidToDateDisplay: money(paidToDate, currency),
    balanceDisplay: money(balance > 0n ? balance : 0n, currency),
    settled: balance <= 0n,
    agreementRef: inv.agreementRef,
    agreementTerm: inv.agreementRef ? AGREEMENT_RECEIPT_TERM : null,
    recordedByName: p.recordedBy?.name?.trim() || p.recordedBy?.email || null,
  };
}

/** The public receipt, addressed by its invoice's token AND its own number - one alone is not enough. */
export async function getPublicReceiptPdfData(token: string, receiptNumber: string): Promise<ReceiptPdfData | null> {
  const p = await prisma.invoicePayment.findFirst({
    where: { receiptNumber, invoice: { publicToken: token } },
    select: { id: true },
  });
  return p ? receiptDocument(p.id) : null;
}

/** Same receipt by payment id, for the staff side (download + email). */
export async function getReceiptPdfData(paymentId: string): Promise<ReceiptPdfData | null> {
  return receiptDocument(paymentId);
}

// ─────────────────────────── Products & subscriptions ───────────────────────────

export type ProductRow = {
  id: string;
  name: string;
  description: string | null;
  priceInr: string;
  priceEur: string;
  priceDisplay: string;
  priceEurDisplay: string | null;
  interval: string;
  active: boolean;
  /** The programme this prices, or null for a one-off item. */
  levelCode: string | null;
  levelLabel: string | null;
  /** "B2" / "German Note" - which book this programme's money belongs to. */
  lineLabel: string | null;
};

/** A programme on the catalogue that nobody has priced yet - offered, not sold. */
export type UnpricedProgramme = { levelCode: string; levelLabel: string; lineLabel: string };

/**
 * The products board: what is priced, and which programmes still are not.
 *
 * The second half is the point. A catalogue that lists only the programmes somebody has already
 * got round to pricing cannot tell you the one you have forgotten, and "GN B2 has no price" is
 * exactly the kind of gap that stays invisible right up until somebody needs to invoice it.
 */
export async function getProductsList(): Promise<{ rows: ProductRow[]; unpriced: UnpricedProgramme[] }> {
  const [products, levels] = await Promise.all([
    prisma.product.findMany({ where: ACTIVE, orderBy: { name: "asc" } }),
    getLevels(),
  ]);
  const byCode = new Map(levels.map((l) => [l.code, l]));

  const rows = products.map((p) => {
    const level = p.levelCode ? byCode.get(p.levelCode) : undefined;
    return {
      id: p.id,
      name: p.name,
      description: p.description,
      priceInr: minorToMajorString(p.priceInrMinor),
      priceEur: minorToMajorString(p.priceEurMinor),
      priceDisplay: formatInrMinor(p.priceInrMinor),
      priceEurDisplay: p.priceEurMinor > 0n ? formatEurMinor(p.priceEurMinor) : null,
      interval: p.interval,
      active: p.active,
      levelCode: p.levelCode,
      // A product pointing at a level that has since been deleted still shows its code rather
      // than reading as a one-off item - the attribution happened, and hiding it would lie.
      levelLabel: p.levelCode ? byCode.get(p.levelCode)?.label ?? p.levelCode : null,
      lineLabel: level ? BUSINESS_LINE_LABELS[lineForKind(level.kind)] : null,
    };
  });

  const priced = new Set(rows.map((r) => r.levelCode).filter(Boolean));
  const unpriced = levels
    // "OTHER" is the catch-all a payment falls back to, not something anyone sells.
    .filter((l) => l.active && l.code !== "OTHER" && !priced.has(l.code))
    .map((l) => ({
      levelCode: l.code,
      levelLabel: l.label,
      lineLabel: BUSINESS_LINE_LABELS[lineForKind(l.kind)],
    }));

  return { rows, unpriced };
}

export async function getSubscriptionsList() {
  const subs = await prisma.subscription.findMany({
    orderBy: { createdAt: "desc" },
    include: { product: { select: { name: true } }, lead: { select: { id: true, name: true } } },
  });
  return subs.map((s) => ({
    id: s.id,
    customerName: s.customerName,
    contactId: s.lead?.id ?? null,
    productName: s.product?.name ?? null,
    amountDisplay: formatInrMinor(s.amountInrMinor),
    amountEurDisplay: s.amountEurMinor > 0n ? formatEurMinor(s.amountEurMinor) : null,
    interval: s.interval,
    status: s.status,
    nextBillingDate: s.nextBillingDate,
  }));
}

/**
 * What an invoice line can sell: EVERY ACTIVE PROGRAMME, plus the one-off products.
 *
 * The invoice editor's programme picker used to be fed from `Product` alone, so a programme
 * nobody had got round to pricing was not on the list at all. With an empty products table -
 * which is exactly what live had - the picker offered nothing, and the editor looked broken:
 * "the programmes are not loading". Worse, the way round it was to type the line by hand, which
 * drops the level, and with it the GL account the money should post to.
 *
 * So the catalogue drives the picker, and a price is an ENRICHMENT of an option rather than the
 * reason it exists. An unpriced programme is offered with an empty price and flagged as unpriced
 * in its label; picking it still carries the level onto the line → the Income row → the GL
 * account. The price is set once, in the catalogue (Programs / German Note → Manage → Levels),
 * and then fills itself in here.
 *
 * `priceInr`/`priceEur` are both carried because the invoice may be a euro document: handing the
 * editor a rupee price alone would make "add a programme" paste a rupee figure into a euro line -
 * four orders of magnitude out, and indistinguishable from a real amount once it is in the box.
 */
export type InvoiceLineOption = {
  /** Picker key: `lvl:<CODE>` for a programme, `item:<productId>` for a one-off product. */
  id: string;
  label: string;
  description: string | null;
  /** The programme this line sells, or null for a one-off item. */
  levelCode: string | null;
  priceInr: string;
  priceEur: string;
  /** False = on the catalogue but nobody has priced it. The label says so; the line still works. */
  priced: boolean;
};

export async function getInvoicePickers() {
  const [contacts, products, levels] = await Promise.all([
    prisma.lead.findMany({ where: ACTIVE, select: { id: true, name: true, email: true, phone: true }, orderBy: { createdAt: "desc" }, take: 1000 }),
    prisma.product.findMany({
      where: { ...ACTIVE, active: true },
      select: { id: true, name: true, description: true, levelCode: true, priceInrMinor: true, priceEurMinor: true },
      orderBy: { name: "asc" },
    }),
    getLevels(),
  ]);
  const byCode = new Map(levels.map((l) => [l.code, l]));
  const productByLevel = new Map(products.filter((p) => p.levelCode).map((p) => [p.levelCode as string, p]));

  /** Programme options: the whole active catalogue, priced where somebody has priced it. */
  const programmeOptions: InvoiceLineOption[] = levels
    .filter((l) => l.active)
    .map((l) => {
      const p = productByLevel.get(l.code);
      const lineLabel = BUSINESS_LINE_LABELS[lineForKind(l.kind)];
      return {
        id: `lvl:${l.code}`,
        label: `${l.label} · ${lineLabel}${p ? "" : " · no price set"}`,
        description: p?.description ?? null,
        levelCode: l.code,
        priceInr: p ? minorToMajorString(p.priceInrMinor) : "",
        priceEur: p ? minorToMajorString(p.priceEurMinor) : "",
        priced: !!p,
      };
    });

  /** One-off items - a book set, a single seat, a re-sit fee. Real to invoice, not a programme. */
  const oneOffOptions: InvoiceLineOption[] = products
    .filter((p) => !p.levelCode)
    .map((p) => ({
      id: `item:${p.id}`,
      label: p.name,
      description: p.description,
      levelCode: null,
      priceInr: minorToMajorString(p.priceInrMinor),
      priceEur: minorToMajorString(p.priceEurMinor),
      priced: true,
    }));

  /*
   * Each contact's SIGNED agreement, newest first - the contract an invoice for them bills under.
   * Picking the contact fills the invoice's postal address from it (the address the student
   * signed with) and its reference, which prints the agreement's payment terms on the invoice.
   * Only signed ones: an unsigned or declined agreement binds nobody to its terms.
   */
  const agreements = await prisma.agreement.findMany({
    where: { leadId: { in: contacts.map((c) => c.id) }, status: "SIGNED" },
    select: { leadId: true, documentNo: true, data: true },
    orderBy: { signedAt: "desc" },
  });
  const signedFor = new Map<string, { documentNo: string; address: string | null }>();
  for (const a of agreements) {
    if (!a.leadId || signedFor.has(a.leadId)) continue;
    const parsed = agreementDataSchema.safeParse(a.data);
    signedFor.set(a.leadId, { documentNo: a.documentNo, address: parsed.success ? parsed.data.student.address : null });
  }

  return {
    contacts: contacts.map((c) => ({
      ...c,
      agreementNo: signedFor.get(c.id)?.documentNo ?? null,
      address: signedFor.get(c.id)?.address ?? null,
    })),
    /** The invoice editor's line picker. Catalogue first, then the one-off items. */
    lineOptions: [...programmeOptions, ...oneOffOptions],
    /**
     * Still the `Product` rows, and only those: a subscription stores a real `productId`, so a
     * synthetic catalogue option has no business in this list.
     */
    products: products.map((p) => {
      const level = p.levelCode ? byCode.get(p.levelCode) : undefined;
      return {
        id: p.id,
        name: p.name,
        levelCode: p.levelCode,
        lineLabel: level ? BUSINESS_LINE_LABELS[lineForKind(level.kind)] : null,
        priceInr: minorToMajorString(p.priceInrMinor),
        priceEur: minorToMajorString(p.priceEurMinor),
      };
    }),
  };
}
