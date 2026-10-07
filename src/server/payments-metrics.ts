import "server-only";

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
  issueDate: string; // YYYY-MM-DD
  dueDate: string;
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
  payments: { id: string; amountDisplay: string; method: string; reference: string | null; paidAt: Date }[];
};

export async function getInvoice(id: string): Promise<InvoiceDetail | null> {
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
    issueDate: toDateInputValue(i.issueDate),
    dueDate: i.dueDate ? toDateInputValue(i.dueDate) : "",
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
    })),
  };
}

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
  issueDate: Date;
  dueDate: Date | null;
  notes: string | null;
  taxPercent: Prisma.Decimal;
  taxLabel: string | null;
  fxRateUsed: Prisma.Decimal;
  subtotalInrMinor: bigint; subtotalEurMinor: bigint;
  discountInrMinor: bigint; discountEurMinor: bigint;
  taxInrMinor: bigint; taxEurMinor: bigint;
  totalInrMinor: bigint; totalEurMinor: bigint;
  createdBy: { name: string | null; email: string } | null;
  items: { description: string; quantity: number; unitPriceInrMinor: bigint; unitPriceEurMinor: bigint }[];
  payments: { amountInrMinor: bigint; amountEurMinor: bigint }[];
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
    issueDate: i.issueDate,
    dueDate: i.dueDate,
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
  payments: { select: { amountInrMinor: true, amountEurMinor: true } },
  createdBy: { select: { name: true, email: true } },
} as const;

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
 * Contacts + products for the invoice/subscription editors.
 *
 * A product now offers a price in BOTH currencies, because the invoice it is being added to may
 * be a euro one: handing the editor a rupee price alone would make "add from product" silently
 * paste a rupee figure into a euro line - four orders of magnitude out, and indistinguishable
 * from a real amount once it is sitting in the box.
 */
export async function getInvoicePickers() {
  const [contacts, products, levels] = await Promise.all([
    prisma.lead.findMany({ where: ACTIVE, select: { id: true, name: true, email: true, phone: true }, orderBy: { createdAt: "desc" }, take: 1000 }),
    prisma.product.findMany({
      where: { ...ACTIVE, active: true },
      select: { id: true, name: true, levelCode: true, priceInrMinor: true, priceEurMinor: true },
      orderBy: { name: "asc" },
    }),
    getLevels(),
  ]);
  const byCode = new Map(levels.map((l) => [l.code, l]));
  return {
    contacts,
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
