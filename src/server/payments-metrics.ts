import "server-only";

import { prisma } from "@/lib/prisma";
import { formatInrMinor, formatEurMinor, formatDate, minorToMajorString } from "@/lib/format";
import { toDateInputValue } from "@/lib/dates";
import type { InvoiceKind } from "@prisma/client";
import type { InvoicePdfData } from "@/documents/invoice-pdf";

/** Read layer for Payments (Synamate "Payments": Invoices, Estimates, Products, Subscriptions). */

export type PaymentsOverview = {
  draftInr: string;
  dueInr: string;
  receivedInr: string;
  overdueInr: string;
  counts: { draft: number; sent: number; paid: number; overdue: number };
};

export async function getPaymentsOverview(): Promise<PaymentsOverview> {
  const invoices = await prisma.invoice.findMany({
    where: { kind: "INVOICE" },
    select: { status: true, totalInrMinor: true, dueDate: true, payments: { select: { amountInrMinor: true } } },
  });
  let draft = 0n, due = 0n, received = 0n, overdue = 0n;
  const counts = { draft: 0, sent: 0, paid: 0, overdue: 0 };
  const today = new Date();
  for (const i of invoices) {
    const paid = i.payments.reduce((a, p) => a + p.amountInrMinor, 0n);
    const balance = i.totalInrMinor - paid;
    received += paid;
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
  };
}

export type InvoiceRow = {
  id: string;
  number: string;
  customerName: string;
  status: string;
  totalDisplay: string;
  balanceDisplay: string;
  issueDate: Date;
  dueDate: Date | null;
};

export async function getInvoicesList(kind: InvoiceKind): Promise<InvoiceRow[]> {
  const invoices = await prisma.invoice.findMany({
    where: { kind },
    orderBy: { createdAt: "desc" },
    include: { payments: { select: { amountInrMinor: true } } },
  });
  return invoices.map((i) => {
    const paid = i.payments.reduce((a, p) => a + p.amountInrMinor, 0n);
    return {
      id: i.id,
      number: i.number,
      customerName: i.customerName,
      status: i.status,
      totalDisplay: formatInrMinor(i.totalInrMinor),
      balanceDisplay: formatInrMinor(i.totalInrMinor - paid),
      issueDate: i.issueDate,
      dueDate: i.dueDate,
    };
  });
}

export type InvoiceItemEdit = { id: string; description: string; quantity: number; unitPriceInr: string; lineTotalDisplay: string };

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
  items: InvoiceItemEdit[];
  discountInr: string;
  taxPercent: number;
  notes: string | null;
  publicToken: string;
  subtotalDisplay: string;
  taxDisplay: string;
  totalDisplay: string;
  totalEurDisplay: string;
  amountPaidDisplay: string;
  balanceDisplay: string;
  payments: { id: string; amountDisplay: string; method: string; reference: string | null; paidAt: Date }[];
};

export async function getInvoice(id: string): Promise<InvoiceDetail | null> {
  const i = await prisma.invoice.findUnique({
    where: { id },
    include: { items: { orderBy: { position: "asc" } }, payments: { orderBy: { paidAt: "desc" } } },
  });
  if (!i) return null;
  const paid = i.payments.reduce((a, p) => a + p.amountInrMinor, 0n);
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
    items: i.items.map((it) => ({
      id: it.id,
      description: it.description,
      quantity: it.quantity,
      unitPriceInr: minorToMajorString(it.unitPriceInrMinor),
      lineTotalDisplay: formatInrMinor(it.unitPriceInrMinor * BigInt(it.quantity)),
    })),
    discountInr: minorToMajorString(i.discountInrMinor),
    taxPercent: Number(i.taxPercent),
    notes: i.notes,
    publicToken: i.publicToken,
    subtotalDisplay: formatInrMinor(i.subtotalInrMinor),
    taxDisplay: formatInrMinor(i.taxInrMinor),
    totalDisplay: formatInrMinor(i.totalInrMinor),
    totalEurDisplay: formatEurMinor(i.totalEurMinor),
    amountPaidDisplay: formatInrMinor(paid),
    balanceDisplay: formatInrMinor(i.totalInrMinor - paid),
    payments: i.payments.map((p) => ({
      id: p.id,
      amountDisplay: formatInrMinor(p.amountInrMinor),
      method: p.method,
      reference: p.reference,
      paidAt: p.paidAt,
    })),
  };
}

export async function getPublicInvoice(token: string) {
  const i = await prisma.invoice.findUnique({
    where: { publicToken: token },
    include: { items: { orderBy: { position: "asc" } }, payments: { select: { amountInrMinor: true } } },
  });
  if (!i || i.status === "DRAFT" || i.status === "VOID") return null;
  const paid = i.payments.reduce((a, p) => a + p.amountInrMinor, 0n);
  return {
    kind: i.kind,
    number: i.number,
    status: i.status,
    customerName: i.customerName,
    customerEmail: i.customerEmail,
    issueDate: i.issueDate,
    dueDate: i.dueDate,
    notes: i.notes,
    items: i.items.map((it) => ({
      description: it.description,
      quantity: it.quantity,
      unitPriceDisplay: formatInrMinor(it.unitPriceInrMinor),
      lineTotalDisplay: formatInrMinor(it.unitPriceInrMinor * BigInt(it.quantity)),
    })),
    subtotalDisplay: formatInrMinor(i.subtotalInrMinor),
    discountDisplay: formatInrMinor(i.discountInrMinor),
    taxPercent: Number(i.taxPercent),
    taxDisplay: formatInrMinor(i.taxInrMinor),
    totalDisplay: formatInrMinor(i.totalInrMinor),
    totalEurDisplay: formatEurMinor(i.totalEurMinor),
    balanceDisplay: formatInrMinor(i.totalInrMinor - paid),
  };
}

/**
 * Same shape as `getPublicInvoice`, but keyed by id and NOT status-filtered — used only
 * server-side (sendInvoice in payments-actions.ts) to attach a PDF the moment a DRAFT
 * invoice is first sent, before the public /i/[token] page is allowed to show it.
 */
export async function getInvoicePdfData(id: string): Promise<InvoicePdfData | null> {
  const i = await prisma.invoice.findUnique({
    where: { id },
    include: { items: { orderBy: { position: "asc" } }, payments: { select: { amountInrMinor: true } } },
  });
  if (!i) return null;
  const paid = i.payments.reduce((a, p) => a + p.amountInrMinor, 0n);
  return {
    kind: i.kind,
    number: i.number,
    status: i.status,
    issueDate: formatDate(i.issueDate),
    dueDate: i.dueDate ? formatDate(i.dueDate) : null,
    customerName: i.customerName,
    customerEmail: i.customerEmail,
    items: i.items.map((it) => ({
      description: it.description,
      quantity: it.quantity,
      unitPriceDisplay: formatInrMinor(it.unitPriceInrMinor),
      lineTotalDisplay: formatInrMinor(it.unitPriceInrMinor * BigInt(it.quantity)),
    })),
    subtotalDisplay: formatInrMinor(i.subtotalInrMinor),
    discountDisplay: formatInrMinor(i.discountInrMinor),
    taxPercent: Number(i.taxPercent),
    taxDisplay: formatInrMinor(i.taxInrMinor),
    totalDisplay: formatInrMinor(i.totalInrMinor),
    totalEurDisplay: formatEurMinor(i.totalEurMinor),
    balanceDisplay: formatInrMinor(i.totalInrMinor - paid),
    notes: i.notes,
  };
}

export async function getProductsList() {
  const products = await prisma.product.findMany({ orderBy: { name: "asc" } });
  return products.map((p) => ({
    id: p.id,
    name: p.name,
    description: p.description,
    priceInr: minorToMajorString(p.priceInrMinor),
    priceEur: minorToMajorString(p.priceEurMinor),
    priceDisplay: formatInrMinor(p.priceInrMinor),
    priceEurDisplay: p.priceEurMinor > 0n ? formatEurMinor(p.priceEurMinor) : null,
    interval: p.interval,
    active: p.active,
  }));
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

/** Contacts + products for the invoice/subscription editors. */
export async function getInvoicePickers() {
  const [contacts, products] = await Promise.all([
    prisma.lead.findMany({ select: { id: true, name: true, email: true, phone: true }, orderBy: { createdAt: "desc" }, take: 1000 }),
    prisma.product.findMany({ where: { active: true }, select: { id: true, name: true, priceInrMinor: true }, orderBy: { name: "asc" } }),
  ]);
  return {
    contacts,
    products: products.map((p) => ({ id: p.id, name: p.name, priceInr: minorToMajorString(p.priceInrMinor) })),
  };
}
