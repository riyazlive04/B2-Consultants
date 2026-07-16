"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { Prisma, type InvoiceKind, type InvoiceStatus, type ProductInterval } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { requireSection, capabilityCheck } from "@/lib/rbac";
import { getTodayInrPerEur, inrMinorToEurMinor } from "@/lib/fx";
import { formatInrMinor, majorStringToMinor } from "@/lib/format";
import { parseDateInput } from "@/lib/dates";
import { emitTrigger } from "./automation";
import { appendAudit, LedgerError, postEntry } from "./ledger";
import { paymentEntryDraft } from "./finance-posting";
import { getInvoicePdfData } from "./payments-metrics";
import { renderInvoicePdf } from "@/documents/invoice-pdf";
import { getEmailRuntime, sendResendEmail } from "@/lib/email";
import type { ActionResult } from "./finance-actions";

/** Payments (Synamate "Payments"): products, invoices/estimates, manual payments, subscriptions.
 *  No processor is wired — statuses advance manually. Gated to the `payments` section; deletes
 *  need the `finance.write` capability. */

function firstError(e: z.ZodError): string {
  return e.issues[0]?.message ?? "Invalid input";
}

/** Same shape as finance-actions.ts's private helper — duplicated rather than imported
 *  because that file is "use server" and every export there becomes a public RPC; a
 *  helper taking a function argument can't be one. */
async function withLedgerErrors(run: () => Promise<void>): Promise<ActionResult> {
  try {
    await run();
    return { ok: true };
  } catch (err) {
    if (err instanceof LedgerError) return { ok: false, error: err.message };
    throw err;
  }
}

const INTERVALS = ["ONE_TIME", "MONTHLY", "QUARTERLY", "YEARLY"] as const;

type TxClient = Prisma.TransactionClient;

// ─────────────────────────── Products ───────────────────────────

const productSchema = z.object({
  name: z.string().trim().min(1, "Product name is required"),
  description: z.string().trim().optional(),
  priceInr: z.string().trim().optional(),
  priceEur: z.string().trim().optional(),
  interval: z.enum(INTERVALS),
  active: z.string().optional(),
});

export async function createProduct(form: FormData): Promise<ActionResult> {
  await requireSection("payments");
  const parsed = productSchema.safeParse(Object.fromEntries(form));
  if (!parsed.success) return { ok: false, error: firstError(parsed.error) };
  const d = parsed.data;
  const fx = await getTodayInrPerEur();
  await prisma.product.create({
    data: {
      name: d.name,
      description: d.description || null,
      priceInrMinor: d.priceInr?.trim() ? majorStringToMinor(d.priceInr) : 0n,
      priceEurMinor: d.priceEur?.trim() ? majorStringToMinor(d.priceEur) : 0n,
      fxRateUsed: fx.rate,
      interval: d.interval as ProductInterval,
      active: d.active !== "off",
    },
  });
  revalidatePath("/payments");
  return { ok: true };
}

export async function updateProduct(id: string, form: FormData): Promise<ActionResult> {
  await requireSection("payments");
  const parsed = productSchema.safeParse(Object.fromEntries(form));
  if (!parsed.success) return { ok: false, error: firstError(parsed.error) };
  const d = parsed.data;
  const fx = await getTodayInrPerEur();
  await prisma.product.update({
    where: { id },
    data: {
      name: d.name,
      description: d.description || null,
      priceInrMinor: d.priceInr?.trim() ? majorStringToMinor(d.priceInr) : 0n,
      priceEurMinor: d.priceEur?.trim() ? majorStringToMinor(d.priceEur) : 0n,
      fxRateUsed: fx.rate,
      interval: d.interval as ProductInterval,
      active: d.active !== "off",
    },
  });
  revalidatePath("/payments");
  return { ok: true };
}

export async function deleteProduct(id: string): Promise<ActionResult> {
  const { allowed, denied } = await capabilityCheck("finance.write");
  if (!allowed) return denied;
  await prisma.product.delete({ where: { id } });
  revalidatePath("/payments");
  return { ok: true };
}

// ─────────────────────────── Invoices & estimates ───────────────────────────

export type InvoicePayload = {
  kind: "INVOICE" | "ESTIMATE";
  leadId?: string;
  customerName: string;
  customerEmail?: string;
  customerPhone?: string;
  issueDate: string;
  dueDate?: string;
  items: { description: string; quantity: number; unitPriceInr: string }[];
  discountInr?: string;
  taxPercent?: number;
  notes?: string;
};

function computeTotals(
  items: { quantity: number; unitPriceInr: string }[],
  discountInrMinor: bigint,
  taxPercent: number,
  rate: Prisma.Decimal,
) {
  const subtotal = items.reduce((a, it) => a + majorStringToMinor(it.unitPriceInr) * BigInt(Math.max(1, it.quantity)), 0n);
  const taxableRaw = subtotal - discountInrMinor;
  const taxable = taxableRaw > 0n ? taxableRaw : 0n;
  const taxInr = BigInt(Math.round((Number(taxable) * taxPercent) / 100));
  const total = taxable + taxInr;
  return { subtotal, taxInr, total, totalEur: inrMinorToEurMinor(total, rate) };
}

async function nextNumber(tx: TxClient, kind: InvoiceKind): Promise<string> {
  const prefix = kind === "INVOICE" ? "INV" : "EST";
  const rows = await tx.invoice.findMany({ where: { kind }, select: { number: true } });
  let max = 0;
  for (const r of rows) {
    const m = r.number.match(/(\d+)\s*$/);
    if (m) max = Math.max(max, parseInt(m[1], 10));
  }
  return `${prefix}-${String(max + 1).padStart(4, "0")}`;
}

function validatePayload(p: InvoicePayload): string | null {
  if (!p.customerName?.trim()) return "Customer name is required";
  if (!p.items.length) return "Add at least one line item";
  if (p.items.some((it) => !it.description.trim())) return "Every line item needs a description";
  if (!/^\d{4}-\d{2}-\d{2}$/.test(p.issueDate)) return "Invalid issue date";
  return null;
}

export async function createInvoice(payload: InvoicePayload): Promise<ActionResult> {
  const session = await requireSection("payments");
  const err = validatePayload(payload);
  if (err) return { ok: false, error: err };
  const fx = await getTodayInrPerEur();
  const discount = payload.discountInr?.trim() ? majorStringToMinor(payload.discountInr) : 0n;
  const t = computeTotals(payload.items, discount, payload.taxPercent ?? 0, fx.rate);

  await prisma.$transaction(async (tx) => {
    const number = await nextNumber(tx, payload.kind as InvoiceKind);
    await tx.invoice.create({
      data: {
        kind: payload.kind as InvoiceKind,
        number,
        status: "DRAFT",
        leadId: payload.leadId || null,
        customerName: payload.customerName.trim(),
        customerEmail: payload.customerEmail?.trim() || null,
        customerPhone: payload.customerPhone?.trim() || null,
        issueDate: parseDateInput(payload.issueDate),
        dueDate: payload.dueDate?.trim() ? parseDateInput(payload.dueDate) : null,
        subtotalInrMinor: t.subtotal,
        discountInrMinor: discount,
        taxPercent: new Prisma.Decimal(payload.taxPercent ?? 0),
        taxInrMinor: t.taxInr,
        totalInrMinor: t.total,
        totalEurMinor: t.totalEur,
        fxRateUsed: fx.rate,
        notes: payload.notes?.trim() || null,
        createdById: session.user.id,
        items: {
          create: payload.items.map((it, i) => ({
            description: it.description.trim(),
            quantity: Math.max(1, it.quantity),
            unitPriceInrMinor: it.unitPriceInr?.trim() ? majorStringToMinor(it.unitPriceInr) : 0n,
            position: i,
          })),
        },
      },
    });
  });
  revalidatePath("/payments");
  return { ok: true };
}

export async function updateInvoice(id: string, payload: InvoicePayload): Promise<ActionResult> {
  await requireSection("payments");
  const err = validatePayload(payload);
  if (err) return { ok: false, error: err };
  const fx = await getTodayInrPerEur();
  const discount = payload.discountInr?.trim() ? majorStringToMinor(payload.discountInr) : 0n;
  const t = computeTotals(payload.items, discount, payload.taxPercent ?? 0, fx.rate);

  await prisma.$transaction(async (tx) => {
    await tx.invoiceLineItem.deleteMany({ where: { invoiceId: id } });
    await tx.invoice.update({
      where: { id },
      data: {
        leadId: payload.leadId || null,
        customerName: payload.customerName.trim(),
        customerEmail: payload.customerEmail?.trim() || null,
        customerPhone: payload.customerPhone?.trim() || null,
        issueDate: parseDateInput(payload.issueDate),
        dueDate: payload.dueDate?.trim() ? parseDateInput(payload.dueDate) : null,
        subtotalInrMinor: t.subtotal,
        discountInrMinor: discount,
        taxPercent: new Prisma.Decimal(payload.taxPercent ?? 0),
        taxInrMinor: t.taxInr,
        totalInrMinor: t.total,
        totalEurMinor: t.totalEur,
        fxRateUsed: fx.rate,
        notes: payload.notes?.trim() || null,
        items: {
          create: payload.items.map((it, i) => ({
            description: it.description.trim(),
            quantity: Math.max(1, it.quantity),
            unitPriceInrMinor: it.unitPriceInr?.trim() ? majorStringToMinor(it.unitPriceInr) : 0n,
            position: i,
          })),
        },
      },
    });
  });
  revalidatePath("/payments");
  revalidatePath(`/payments/${id}`);
  return { ok: true };
}

const STATUSES = ["DRAFT", "SENT", "PAID", "PARTIAL", "OVERDUE", "VOID", "ACCEPTED", "DECLINED"] as const;

export async function setInvoiceStatus(id: string, status: string): Promise<ActionResult> {
  await requireSection("payments");
  if (!(STATUSES as readonly string[]).includes(status)) return { ok: false, error: "Invalid status" };
  await prisma.invoice.update({
    where: { id },
    data: {
      status: status as InvoiceStatus,
      ...(status === "SENT" ? { sentAt: new Date() } : {}),
      ...(status === "PAID" ? { paidAt: new Date() } : {}),
    },
  });
  revalidatePath("/payments");
  revalidatePath(`/payments/${id}`);
  return { ok: true };
}

export async function deleteInvoice(id: string): Promise<ActionResult> {
  const { allowed, denied } = await capabilityCheck("finance.write");
  if (!allowed) return denied;
  await prisma.invoice.delete({ where: { id } });
  revalidatePath("/payments");
  return { ok: true };
}

function publicInvoiceUrl(token: string): string {
  const origin = (process.env.BETTER_AUTH_URL ?? "").replace(/\/+$/, "");
  return `${origin}/i/${token}`;
}

function invoiceEmailHtml(opts: { customerName: string; noun: string; number: string; totalDisplay: string; url: string }): string {
  const first = (opts.customerName || "").trim().split(/\s+/)[0] || "there";
  return `<div style="font-family:Inter,Arial,sans-serif;font-size:14px;color:#16203A;line-height:1.6">
    <p>Hi ${first},</p>
    <p>Please find your ${opts.noun.toLowerCase()} <strong>${opts.number}</strong> (${opts.totalDisplay}) attached.</p>
    <p>You can also view and download it online: <a href="${opts.url}" style="color:#3762F0">${opts.url}</a></p>
    <p>Thank you for your business.<br>B2 Consultants</p>
  </div>`;
}

export type SendInvoiceResult = { ok: true; message: string } | { ok: false; error: string };

/**
 * "Send" used to only flip status → SENT (BUILD_CHECKLIST §7). This now actually delivers
 * the invoice — PDF attached, plus a link to the public page — to `Invoice.customerEmail`,
 * over the exact same Resend path every other system email in this app uses (lib/email.ts's
 * getEmailRuntime + sendResendEmail, the same pair auth.ts's password-reset email calls
 * directly rather than going through messaging.ts, because an Invoice isn't always tied to
 * a Lead the way messaging.ts's sendEmailMessage expects).
 *
 * Delivery failure (no email on file, email unconfigured/paused, provider error) never
 * blocks the status flip — the invoice still moves to SENT so the founder can hand it over
 * manually via the existing "Link"/"PDF" buttons. The caller gets a human-readable message
 * either way instead of a bare boolean, so the founder knows whether delivery actually
 * happened.
 */
export async function sendInvoice(id: string): Promise<SendInvoiceResult> {
  await requireSection("payments");
  const inv = await prisma.invoice.findUnique({
    where: { id },
    select: {
      id: true, kind: true, number: true, customerName: true, customerEmail: true,
      publicToken: true, totalInrMinor: true,
    },
  });
  if (!inv) return { ok: false, error: "Not found" };

  const noun = inv.kind === "ESTIMATE" ? "Estimate" : "Invoice";
  const url = publicInvoiceUrl(inv.publicToken);
  const to = inv.customerEmail?.trim();
  let message = "Marked sent — no email on file, share the link or PDF manually";

  if (to) {
    const rt = await getEmailRuntime();
    if (rt.enabled) {
      // PDF attachment: chosen over a link-only email because InvoicePdfData is already
      // built for the public page and renderInvoicePdf is a pure, synchronous-cost buffer
      // render — attaching cost nothing extra to plumb. The public link is still included
      // in the body as a fallback for mail clients that block attachments.
      const pdfData = await getInvoicePdfData(id);
      const attachments = pdfData
        ? [{ filename: `${inv.number}.pdf`, content: (await renderInvoicePdf(pdfData)).toString("base64") }]
        : undefined;
      const from = rt.fromName ? `${rt.fromName} <${rt.fromEmail}>` : rt.fromEmail;
      const res = await sendResendEmail({
        apiKey: rt.apiKey!,
        from,
        to,
        subject: `${noun} ${inv.number} from B2 Consultants`,
        html: invoiceEmailHtml({ customerName: inv.customerName, noun, number: inv.number, totalDisplay: formatInrMinor(inv.totalInrMinor), url }),
        attachments,
      });
      message = res.ok ? `Emailed to ${to}` : `Marked sent, but the email failed (${res.error})`;
    } else {
      message = rt.configured
        ? "Marked sent — email is paused, nothing was delivered"
        : "Marked sent — email isn't configured, nothing was delivered";
    }
  }

  await prisma.invoice.update({ where: { id }, data: { status: "SENT", sentAt: new Date() } });
  revalidatePath("/payments");
  revalidatePath(`/payments/${id}`);
  return { ok: true, message };
}

/**
 * Post every payment to the real ledger in the SAME transaction as the InvoicePayment row
 * (BUILD_CHECKLIST §7 — copies finance-actions.ts's createIncome/createExpense pattern
 * exactly). Before this, Payments and Finance were two disconnected books for the same
 * kind of event: money could be marked "paid" here without ever appearing on the P&L,
 * cash position, or trial balance.
 */
export async function recordPayment(invoiceId: string, form: FormData): Promise<ActionResult> {
  const session = await requireSection("payments");
  const amountRaw = String(form.get("amountInr") ?? "").trim();
  if (!/^\d{1,12}(\.\d{0,2})?$/.test(amountRaw)) return { ok: false, error: "Enter a valid amount" };
  const method = String(form.get("method") ?? "cash").trim() || "cash";
  const reference = String(form.get("reference") ?? "").trim() || null;
  const amountInrMinor = majorStringToMinor(amountRaw);

  let paidLeadId: string | null = null;
  const result = await withLedgerErrors(async () => {
    await prisma.$transaction(async (tx) => {
      const inv = await tx.invoice.findUnique({
        where: { id: invoiceId },
        include: { payments: { select: { amountInrMinor: true } } },
      });
      if (!inv) throw new LedgerError("Invoice not found");

      const payment = await tx.invoicePayment.create({
        data: { invoiceId, amountInrMinor, method, reference, recordedById: session.user.id },
      });

      const entryId = await postEntry(
        tx,
        paymentEntryDraft({
          id: payment.id,
          paidAt: payment.paidAt,
          amountInrMinor: payment.amountInrMinor,
          method: payment.method,
          invoiceNumber: inv.number,
          customerName: inv.customerName,
          recordedById: session.user.id,
        }),
      );
      await appendAudit(tx, {
        actorId: session.user.id,
        action: "invoicePayment.create",
        entityType: "InvoicePayment",
        entityId: payment.id,
        payload: { entryId, invoiceId, amountInrMinor: amountInrMinor.toString(), method },
      });

      const paid = inv.payments.reduce((a, p) => a + p.amountInrMinor, amountInrMinor);
      const status: InvoiceStatus = paid >= inv.totalInrMinor ? "PAID" : paid > 0n ? "PARTIAL" : inv.status;
      await tx.invoice.update({
        where: { id: invoiceId },
        data: { status, ...(status === "PAID" ? { paidAt: new Date() } : {}) },
      });
      if (status === "PAID" && inv.leadId) paidLeadId = inv.leadId;
    });
  });
  if (!result.ok) return result;

  if (paidLeadId) await emitTrigger("INVOICE_PAID", { leadId: paidLeadId });
  revalidatePath("/payments");
  revalidatePath(`/payments/${invoiceId}`);
  revalidatePath("/ledger");
  return { ok: true };
}

/** Estimate → Invoice: copies customer + line items into a new draft invoice, marks the estimate accepted. */
export async function convertEstimate(id: string): Promise<ActionResult> {
  const session = await requireSection("payments");
  const est = await prisma.invoice.findUnique({ where: { id }, include: { items: { orderBy: { position: "asc" } } } });
  if (!est) return { ok: false, error: "Estimate not found" };
  if (est.kind !== "ESTIMATE") return { ok: false, error: "Not an estimate" };

  await prisma.$transaction(async (tx) => {
    const number = await nextNumber(tx, "INVOICE");
    await tx.invoice.create({
      data: {
        kind: "INVOICE",
        number,
        status: "DRAFT",
        leadId: est.leadId,
        customerName: est.customerName,
        customerEmail: est.customerEmail,
        customerPhone: est.customerPhone,
        issueDate: new Date(),
        subtotalInrMinor: est.subtotalInrMinor,
        discountInrMinor: est.discountInrMinor,
        taxPercent: est.taxPercent,
        taxInrMinor: est.taxInrMinor,
        totalInrMinor: est.totalInrMinor,
        totalEurMinor: est.totalEurMinor,
        fxRateUsed: est.fxRateUsed,
        notes: est.notes,
        createdById: session.user.id,
        items: { create: est.items.map((it, i) => ({ description: it.description, quantity: it.quantity, unitPriceInrMinor: it.unitPriceInrMinor, position: i })) },
      },
    });
    await tx.invoice.update({ where: { id }, data: { status: "ACCEPTED" } });
  });
  revalidatePath("/payments");
  return { ok: true };
}

// ─────────────────────────── Subscriptions ───────────────────────────

const subSchema = z.object({
  leadId: z.string().trim().optional(),
  customerName: z.string().trim().min(1, "Customer name is required"),
  productId: z.string().trim().optional(),
  amountInr: z.string().trim().optional(),
  amountEur: z.string().trim().optional(),
  interval: z.enum(INTERVALS),
  nextBillingDate: z.string().trim().optional(),
});

export async function createSubscription(form: FormData): Promise<ActionResult> {
  await requireSection("payments");
  const parsed = subSchema.safeParse(Object.fromEntries(form));
  if (!parsed.success) return { ok: false, error: firstError(parsed.error) };
  const d = parsed.data;
  const fx = await getTodayInrPerEur();
  await prisma.subscription.create({
    data: {
      leadId: d.leadId || null,
      customerName: d.customerName,
      productId: d.productId || null,
      amountInrMinor: d.amountInr?.trim() ? majorStringToMinor(d.amountInr) : 0n,
      amountEurMinor: d.amountEur?.trim() ? majorStringToMinor(d.amountEur) : 0n,
      fxRateUsed: fx.rate,
      interval: d.interval as ProductInterval,
      nextBillingDate: d.nextBillingDate?.trim() ? parseDateInput(d.nextBillingDate) : null,
    },
  });
  revalidatePath("/payments");
  return { ok: true };
}

export async function setSubscriptionStatus(id: string, status: string): Promise<ActionResult> {
  await requireSection("payments");
  if (!["ACTIVE", "PAUSED", "CANCELLED"].includes(status)) return { ok: false, error: "Invalid status" };
  await prisma.subscription.update({ where: { id }, data: { status: status as "ACTIVE" | "PAUSED" | "CANCELLED" } });
  revalidatePath("/payments");
  return { ok: true };
}

export async function deleteSubscription(id: string): Promise<ActionResult> {
  const { allowed, denied } = await capabilityCheck("finance.write");
  if (!allowed) return denied;
  await prisma.subscription.delete({ where: { id } });
  revalidatePath("/payments");
  return { ok: true };
}
