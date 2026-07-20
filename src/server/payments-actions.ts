"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { Prisma, type Invoice, type InvoiceKind, type InvoiceStatus, type Product, type ProductInterval } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { requireSection, capabilityCheck } from "@/lib/rbac";
import { getTodayInrPerEur, inrMinorToEurMinor } from "@/lib/fx";
import { formatEurMinor, formatInrMinor, majorStringToMinor } from "@/lib/format";
import { parseDateInput } from "@/lib/dates";
import { optionalRule, rule } from "@/lib/field-rules";
import { emitTrigger } from "./automation";
import { appendAudit, LedgerError, postEntry } from "./ledger";
import { paymentEntryDraft } from "./finance-posting";
import { getInvoicePdfData } from "./payments-metrics";
import { renderInvoicePdf } from "@/documents/invoice-pdf";
import { brandEmailHeader, getEmailRuntime, sendResendEmail } from "@/lib/email";
import { logActivity, diffFields } from "./activity-log";
import { syncPaymentIncome } from "./finance-autopost";
import { syncInvoiceIssuance } from "./invoice-posting";
import type { ActionResult } from "./finance-actions";
import { archiveData, restoreData } from "@/lib/soft-delete";

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

/** A price may be set in INR, EUR, or both — the feed reads back exactly what was entered. */
function priceDisplay(inrMinor: bigint, eurMinor: bigint): string {
  const parts: string[] = [];
  if (inrMinor > 0n) parts.push(formatInrMinor(inrMinor));
  if (eurMinor > 0n) parts.push(formatEurMinor(eurMinor));
  return parts.length ? parts.join(" + ") : formatInrMinor(0n);
}

/** Money as strings: diffFields JSON-compares, and BigInt has no JSON representation. */
function productDiffShape(row: Product) {
  return {
    name: row.name,
    description: row.description,
    priceInrMinor: row.priceInrMinor.toString(),
    priceEurMinor: row.priceEurMinor.toString(),
    interval: row.interval as string,
    active: row.active,
  };
}

function invoiceDiffShape(row: Invoice) {
  return {
    customerName: row.customerName,
    customerEmail: row.customerEmail,
    customerPhone: row.customerPhone,
    issueDate: row.issueDate,
    dueDate: row.dueDate,
    subtotalInrMinor: row.subtotalInrMinor.toString(),
    discountInrMinor: row.discountInrMinor.toString(),
    taxPercent: row.taxPercent,
    totalInrMinor: row.totalInrMinor.toString(),
    leadId: row.leadId,
    notes: row.notes,
  };
}

// ─────────────────────────── Products ───────────────────────────

const productSchema = z.object({
  // Free text, not rule("name"): "Level 2 Bundle" is a product, not a person.
  name: rule("text").pipe(z.string().min(1, "Product name is required")),
  description: optionalRule("text"),
  priceInr: optionalRule("money"),
  priceEur: optionalRule("money"),
  interval: z.enum(INTERVALS),
  active: z.string().optional(),
});

export async function createProduct(form: FormData): Promise<ActionResult> {
  const session = await requireSection("payments");
  const parsed = productSchema.safeParse(Object.fromEntries(form));
  if (!parsed.success) return { ok: false, error: firstError(parsed.error) };
  const d = parsed.data;
  const fx = await getTodayInrPerEur();
  const row = await prisma.product.create({
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

  await logActivity(session, {
    action: "payments.product.create",
    section: "payments",
    entityType: "Product",
    entityId: row.id,
    summary: `Added the product "${row.name}" at ${priceDisplay(row.priceInrMinor, row.priceEurMinor)} (${row.interval.toLowerCase().replace(/_/g, " ")})`,
    meta: {
      priceInrMinor: row.priceInrMinor.toString(),
      priceEurMinor: row.priceEurMinor.toString(),
      interval: row.interval,
      active: row.active,
    },
  });

  revalidatePath("/payments");
  return { ok: true };
}

export async function updateProduct(id: string, form: FormData): Promise<ActionResult> {
  const session = await requireSection("payments");
  const parsed = productSchema.safeParse(Object.fromEntries(form));
  if (!parsed.success) return { ok: false, error: firstError(parsed.error) };
  const d = parsed.data;
  const fx = await getTodayInrPerEur();
  const existing = await prisma.product.findUnique({ where: { id } });
  const row = await prisma.product.update({
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

  if (existing) {
    const diff = diffFields(productDiffShape(existing), productDiffShape(row));
    if (diff.changed.length) {
      await logActivity(session, {
        action: "payments.product.update",
        section: "payments",
        entityType: "Product",
        entityId: row.id,
        summary: `Edited the product "${row.name}" — now ${priceDisplay(row.priceInrMinor, row.priceEurMinor)}`,
        meta: diff,
      });
    }
  }

  revalidatePath("/payments");
  return { ok: true };
}

/** Delete = ARCHIVE. Subscriptions keep their productId (still resolvable). */
export async function deleteProduct(id: string): Promise<ActionResult> {
  const { allowed, denied, session } = await capabilityCheck("finance.write");
  if (!allowed) return denied;
  const row = await prisma.product.update({ where: { id }, data: archiveData(session.user.id) });

  await logActivity(session, {
    action: "payments.product.archive",
    section: "payments",
    entityType: "Product",
    entityId: row.id,
    summary: `Archived the product "${row.name}"`,
    meta: { priceInrMinor: row.priceInrMinor.toString(), interval: row.interval },
  });

  revalidatePath("/payments");
  return { ok: true };
}

/** Restore an archived product. */
export async function restoreProduct(id: string): Promise<ActionResult> {
  const { allowed, denied, session } = await capabilityCheck("finance.write");
  if (!allowed) return denied;
  const existing = await prisma.product.findUnique({ where: { id }, select: { name: true, deletedAt: true } });
  if (!existing) return { ok: false, error: "Product not found" };
  if (!existing.deletedAt) return { ok: false, error: "This product is not archived" };
  await prisma.product.update({ where: { id }, data: restoreData });
  await logActivity(session, {
    action: "payments.product.restore",
    section: "payments",
    entityType: "Product",
    entityId: id,
    summary: `Restored the product "${existing.name}"`,
  });
  revalidatePath("/payments");
  return { ok: true };
}

/** Permanent delete — only from the Archived tab. Subscription.productId → null (SetNull). */
export async function purgeProduct(id: string): Promise<ActionResult> {
  const { allowed, denied, session } = await capabilityCheck("finance.write");
  if (!allowed) return denied;
  const existing = await prisma.product.findUnique({ where: { id }, select: { name: true, deletedAt: true } });
  if (!existing) return { ok: false, error: "Product not found" };
  if (!existing.deletedAt) return { ok: false, error: "Archive it first" };
  await prisma.product.delete({ where: { id } });
  await logActivity(session, {
    action: "payments.product.purge",
    section: "payments",
    entityType: "Product",
    entityId: id,
    summary: `Permanently deleted the archived product "${existing.name}"`,
    meta: { hard: true },
  });
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

/**
 * createInvoice/updateInvoice take a JSON payload rather than FormData, so NOTHING here has been
 * near the browser's field filters by the time it lands — a crafted call could set taxPercent to
 * 10_000 or paste a novel into a line item. Re-check the whole shape against the same rules the
 * client filters on (lib/field-rules). Replaces the old hand-rolled validatePayload, which checked
 * only the customer name, the item count and the issue date — taxPercent reached Prisma unchecked.
 */
const invoicePayloadSchema = z.object({
  kind: z.enum(["INVOICE", "ESTIMATE"]),
  leadId: z.string().trim().optional(),
  customerName: rule("name"),
  customerEmail: optionalRule("email"),
  customerPhone: optionalRule("phone"),
  issueDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Invalid issue date"),
  dueDate: z.string().trim().optional(),
  items: z
    .array(
      z.object({
        // Free text, not rule("name"): "Level 2 Bundle" is a legitimate line item.
        description: rule("text").pipe(z.string().min(1, "Every line item needs a description")),
        quantity: z.coerce.number().int().min(1, "Quantity must be at least 1").max(9999),
        // `?? ""` so the type stays a plain string — computeTotals/majorStringToMinor take one.
        unitPriceInr: optionalRule("money").transform((v) => v ?? ""),
      }),
    )
    .min(1, "Add at least one line item"),
  discountInr: optionalRule("money"),
  taxPercent: z.coerce
    .number()
    .min(0, "Tax % can't be negative")
    .max(100, "Tax % must be 100 or less")
    .optional(),
  notes: optionalRule("text"),
});

export async function createInvoice(raw: InvoicePayload): Promise<ActionResult> {
  const session = await requireSection("payments");
  const parsedPayload = invoicePayloadSchema.safeParse(raw);
  if (!parsedPayload.success) return { ok: false, error: firstError(parsedPayload.error) };
  const payload = parsedPayload.data;
  const fx = await getTodayInrPerEur();
  const discount = payload.discountInr?.trim() ? majorStringToMinor(payload.discountInr) : 0n;
  const t = computeTotals(payload.items, discount, payload.taxPercent ?? 0, fx.rate);

  let created: Invoice | null = null;
  await prisma.$transaction(async (tx) => {
    const number = await nextNumber(tx, payload.kind as InvoiceKind);
    created = await tx.invoice.create({
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

  if (created) {
    const row: Invoice = created;
    await logActivity(session, {
      action: row.kind === "ESTIMATE" ? "payments.estimate.create" : "payments.invoice.create",
      section: "payments",
      entityType: "Invoice",
      entityId: row.id,
      summary: `Created ${row.kind === "ESTIMATE" ? "estimate" : "invoice"} ${row.number} for ${row.customerName} — ${formatInrMinor(row.totalInrMinor)}`,
      meta: {
        kind: row.kind,
        number: row.number,
        totalInrMinor: row.totalInrMinor.toString(),
        items: payload.items.length,
      },
    });
  }

  revalidatePath("/payments");
  return { ok: true };
}

export async function updateInvoice(id: string, raw: InvoicePayload): Promise<ActionResult> {
  const session = await requireSection("payments");
  const parsedPayload = invoicePayloadSchema.safeParse(raw);
  if (!parsedPayload.success) return { ok: false, error: firstError(parsedPayload.error) };
  const payload = parsedPayload.data;
  const fx = await getTodayInrPerEur();
  const discount = payload.discountInr?.trim() ? majorStringToMinor(payload.discountInr) : 0n;
  const t = computeTotals(payload.items, discount, payload.taxPercent ?? 0, fx.rate);

  const existing = await prisma.invoice.findUnique({ where: { id } });
  let updated: Invoice | null = null;
  await prisma.$transaction(async (tx) => {
    await tx.invoiceLineItem.deleteMany({ where: { invoiceId: id } });
    updated = await tx.invoice.update({
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

  if (existing && updated) {
    const row: Invoice = updated;
    const diff = diffFields(invoiceDiffShape(existing), invoiceDiffShape(row));
    // Line items are replaced wholesale on every save, so they never show up in the diff —
    // an amount change surfaces through the totals instead.
    if (diff.changed.length) {
      await logActivity(session, {
        action: row.kind === "ESTIMATE" ? "payments.estimate.update" : "payments.invoice.update",
        section: "payments",
        entityType: "Invoice",
        entityId: row.id,
        summary: `Edited ${row.kind === "ESTIMATE" ? "estimate" : "invoice"} ${row.number} for ${row.customerName} — now ${formatInrMinor(row.totalInrMinor)}`,
        meta: diff,
      });
    }
  }

  revalidatePath("/payments");
  revalidatePath(`/payments/${id}`);
  return { ok: true };
}

const STATUSES = ["DRAFT", "SENT", "PAID", "PARTIAL", "OVERDUE", "VOID", "ACCEPTED", "DECLINED"] as const;

export async function setInvoiceStatus(id: string, status: string): Promise<ActionResult> {
  const session = await requireSection("payments");
  if (!(STATUSES as readonly string[]).includes(status)) return { ok: false, error: "Invalid status" };
  const existing = await prisma.invoice.findUnique({ where: { id } });
  const row = await prisma.invoice.update({
    where: { id },
    data: {
      status: status as InvoiceStatus,
      ...(status === "SENT" ? { sentAt: new Date() } : {}),
      ...(status === "PAID" ? { paidAt: new Date() } : {}),
    },
  });

  if (existing) {
    const diff = diffFields({ status: existing.status as string }, { status: row.status as string });
    if (diff.changed.length) {
      await logActivity(session, {
        action: row.kind === "ESTIMATE" ? "payments.estimate.update" : "payments.invoice.update",
        section: "payments",
        entityType: "Invoice",
        entityId: row.id,
        summary: `Marked ${row.kind === "ESTIMATE" ? "estimate" : "invoice"} ${row.number} for ${row.customerName} as ${row.status.toLowerCase()}`,
        meta: { ...diff, number: row.number, totalInrMinor: row.totalInrMinor.toString() },
      });
    }
  }

  // Keep the ledger's issuance entry (Dr AR / Cr Income) in step with the new status — post it on
  // the way into an issued state, reverse it if the invoice fell back to DRAFT or VOID. No-op unless
  // financePosting.invoiceIssuancePosting is on (audit §C #22).
  await syncInvoiceIssuance(id, session.user.id);

  revalidatePath("/payments");
  revalidatePath(`/payments/${id}`);
  revalidatePath("/ledger");
  return { ok: true };
}

/**
 * Delete = ARCHIVE. Hides the invoice; its payments and auto-posted Income mirror stay (received
 * money is real, and this is reversible). The full income cleanup runs on purge only.
 */
export async function deleteInvoice(id: string): Promise<ActionResult> {
  const { allowed, denied, session } = await capabilityCheck("finance.write");
  if (!allowed) return denied;
  const row = await prisma.invoice.update({ where: { id }, data: archiveData(session.user.id) });
  await logActivity(session, {
    action: row.kind === "ESTIMATE" ? "payments.estimate.archive" : "payments.invoice.archive",
    section: "payments",
    entityType: "Invoice",
    entityId: row.id,
    summary: `Archived ${row.kind === "ESTIMATE" ? "estimate" : "invoice"} ${row.number} for ${row.customerName} — ${formatInrMinor(row.totalInrMinor)}`,
    meta: { kind: row.kind, number: row.number, totalInrMinor: row.totalInrMinor.toString(), status: row.status },
  });
  revalidatePath("/payments");
  revalidatePath("/finance");
  return { ok: true };
}

/** Restore an archived invoice/estimate. */
export async function restoreInvoice(id: string): Promise<ActionResult> {
  const { allowed, denied, session } = await capabilityCheck("finance.write");
  if (!allowed) return denied;
  const existing = await prisma.invoice.findUnique({
    where: { id },
    select: { number: true, kind: true, customerName: true, deletedAt: true },
  });
  if (!existing) return { ok: false, error: "Invoice not found" };
  if (!existing.deletedAt) return { ok: false, error: "This invoice is not archived" };
  await prisma.invoice.update({ where: { id }, data: restoreData });
  await logActivity(session, {
    action: existing.kind === "ESTIMATE" ? "payments.estimate.restore" : "payments.invoice.restore",
    section: "payments",
    entityType: "Invoice",
    entityId: id,
    summary: `Restored ${existing.kind === "ESTIMATE" ? "estimate" : "invoice"} ${existing.number} for ${existing.customerName}`,
    meta: { kind: existing.kind, number: existing.number },
  });
  revalidatePath("/payments");
  revalidatePath("/finance");
  return { ok: true };
}

/**
 * Permanent delete — only from the Archived tab. Cascades line items + payments and removes each
 * payment's auto-posted Income mirror so no phantom revenue is left behind (the original delete
 * behaviour, now the true end-of-life step).
 */
export async function purgeInvoice(id: string): Promise<ActionResult> {
  const { allowed, denied, session } = await capabilityCheck("finance.write");
  if (!allowed) return denied;
  const existing = await prisma.invoice.findUnique({ where: { id }, select: { deletedAt: true } });
  if (!existing) return { ok: false, error: "Invoice not found" };
  if (!existing.deletedAt) return { ok: false, error: "Archive it first" };
  const payments = await prisma.invoicePayment.findMany({ where: { invoiceId: id }, select: { id: true } });
  const row = await prisma.invoice.delete({ where: { id } });
  for (const p of payments) await syncPaymentIncome(null, p.id);
  await logActivity(session, {
    action: row.kind === "ESTIMATE" ? "payments.estimate.purge" : "payments.invoice.purge",
    section: "payments",
    entityType: "Invoice",
    entityId: row.id,
    summary: `Permanently deleted the archived ${row.kind === "ESTIMATE" ? "estimate" : "invoice"} ${row.number}`,
    meta: { kind: row.kind, number: row.number, hard: true },
  });
  revalidatePath("/payments");
  revalidatePath("/finance");
  return { ok: true };
}

function publicInvoiceUrl(token: string): string {
  const origin = (process.env.BETTER_AUTH_URL ?? "").replace(/\/+$/, "");
  return `${origin}/i/${token}`;
}

function invoiceEmailHtml(opts: { customerName: string; noun: string; number: string; totalDisplay: string; url: string }): string {
  const first = (opts.customerName || "").trim().split(/\s+/)[0] || "there";
  return `<div style="font-family:Inter,Arial,sans-serif;font-size:14px;color:#16203A;line-height:1.6">
    ${brandEmailHeader()}
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
  const session = await requireSection("payments");
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

  // Issuing = recognising the revenue + receivable on the ledger (audit §C #22). No-op unless the
  // flag is on; best-effort, so a posting hiccup never blocks the send.
  await syncInvoiceIssuance(inv.id, session.user.id);

  // The summary carries `message` because the status flip and actual delivery can disagree —
  // the founder needs to see which one happened.
  await logActivity(session, {
    action: "payments.invoice.send",
    section: "payments",
    entityType: "Invoice",
    entityId: inv.id,
    summary: `Sent ${noun.toLowerCase()} ${inv.number} (${formatInrMinor(inv.totalInrMinor)}) to ${inv.customerName} — ${message}`,
    meta: { number: inv.number, to: to ?? null, totalInrMinor: inv.totalInrMinor.toString(), message },
  });

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
  const amount = rule("money").safeParse(String(form.get("amountInr") ?? ""));
  if (!amount.success) return { ok: false, error: firstError(amount.error) };
  const amountRaw = amount.data;
  const method = String(form.get("method") ?? "cash").trim() || "cash";
  const ref = optionalRule("text").safeParse(String(form.get("reference") ?? ""));
  if (!ref.success) return { ok: false, error: firstError(ref.error) };
  const reference = ref.data ?? null;
  const amountInrMinor = majorStringToMinor(amountRaw);

  let paidLeadId: string | null = null;
  let recorded: { paymentId: string; number: string; customerName: string; status: InvoiceStatus } | null = null;
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
      recorded = { paymentId: payment.id, number: inv.number, customerName: inv.customerName, status };
    });
  });
  if (!result.ok) return result;

  if (recorded) {
    const r: { paymentId: string; number: string; customerName: string; status: InvoiceStatus } = recorded;
    await logActivity(session, {
      action: "payments.payment.record",
      section: "payments",
      entityType: "InvoicePayment",
      entityId: r.paymentId,
      summary: `Recorded a ${formatInrMinor(amountInrMinor)} payment from ${r.customerName} against invoice ${r.number} — now ${r.status.toLowerCase()}`,
      meta: {
        invoiceId,
        number: r.number,
        amountInrMinor: amountInrMinor.toString(),
        method,
        reference,
        invoiceStatus: r.status,
      },
    });

    // Auto-post the collection to Finance as Income (user request) so it lands on the P&L / LTV.
    const fx = await getTodayInrPerEur();
    await syncPaymentIncome(
      { id: r.paymentId, amountInrMinor, fxRateUsed: fx.rate, studentName: r.customerName, method, paidOn: new Date() },
      r.paymentId,
    );

    // Ensure the invoice's issuance entry exists before its payment credits AR — a payment recorded
    // against an invoice that was never explicitly "sent" would otherwise leave AR one-sided again
    // (audit §C #22). No-op unless the flag is on; idempotent.
    await syncInvoiceIssuance(invoiceId, session.user.id);
  }

  if (paidLeadId) await emitTrigger("INVOICE_PAID", { leadId: paidLeadId });
  revalidatePath("/payments");
  revalidatePath(`/payments/${invoiceId}`);
  revalidatePath("/ledger");
  revalidatePath("/finance");
  return { ok: true };
}

/** Estimate → Invoice: copies customer + line items into a new draft invoice, marks the estimate accepted. */
export async function convertEstimate(id: string): Promise<ActionResult> {
  const session = await requireSection("payments");
  const est = await prisma.invoice.findUnique({ where: { id }, include: { items: { orderBy: { position: "asc" } } } });
  if (!est) return { ok: false, error: "Estimate not found" };
  if (est.kind !== "ESTIMATE") return { ok: false, error: "Not an estimate" };

  let converted: Invoice | null = null;
  await prisma.$transaction(async (tx) => {
    const number = await nextNumber(tx, "INVOICE");
    converted = await tx.invoice.create({
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

  // One action, one row: accepting the estimate is part of converting it, not a second event.
  if (converted) {
    const row: Invoice = converted;
    await logActivity(session, {
      action: "payments.invoice.create",
      section: "payments",
      entityType: "Invoice",
      entityId: row.id,
      summary: `Converted estimate ${est.number} into invoice ${row.number} for ${row.customerName} — ${formatInrMinor(row.totalInrMinor)}`,
      meta: {
        number: row.number,
        fromEstimate: est.number,
        estimateId: est.id,
        totalInrMinor: row.totalInrMinor.toString(),
      },
    });
  }

  revalidatePath("/payments");
  return { ok: true };
}

// ─────────────────────────── Subscriptions ───────────────────────────

const subSchema = z.object({
  leadId: z.string().trim().optional(),
  customerName: rule("name"),
  productId: z.string().trim().optional(),
  amountInr: optionalRule("money"),
  amountEur: optionalRule("money"),
  interval: z.enum(INTERVALS),
  nextBillingDate: z.string().trim().optional(),
});

export async function createSubscription(form: FormData): Promise<ActionResult> {
  const session = await requireSection("payments");
  const parsed = subSchema.safeParse(Object.fromEntries(form));
  if (!parsed.success) return { ok: false, error: firstError(parsed.error) };
  const d = parsed.data;
  const fx = await getTodayInrPerEur();
  const row = await prisma.subscription.create({
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

  await logActivity(session, {
    action: "payments.subscription.create",
    section: "payments",
    entityType: "Subscription",
    entityId: row.id,
    summary: `Started a ${priceDisplay(row.amountInrMinor, row.amountEurMinor)} ${row.interval.toLowerCase().replace(/_/g, " ")} subscription for ${row.customerName}`,
    meta: {
      amountInrMinor: row.amountInrMinor.toString(),
      amountEurMinor: row.amountEurMinor.toString(),
      interval: row.interval,
    },
  });

  revalidatePath("/payments");
  return { ok: true };
}

export async function setSubscriptionStatus(id: string, status: string): Promise<ActionResult> {
  const session = await requireSection("payments");
  if (!["ACTIVE", "PAUSED", "CANCELLED"].includes(status)) return { ok: false, error: "Invalid status" };
  const existing = await prisma.subscription.findUnique({ where: { id } });
  const row = await prisma.subscription.update({ where: { id }, data: { status: status as "ACTIVE" | "PAUSED" | "CANCELLED" } });

  if (existing) {
    const diff = diffFields({ status: existing.status as string }, { status: row.status as string });
    if (diff.changed.length) {
      await logActivity(session, {
        action: "payments.subscription.update",
        section: "payments",
        entityType: "Subscription",
        entityId: row.id,
        summary: `Marked ${row.customerName}'s ${priceDisplay(row.amountInrMinor, row.amountEurMinor)} subscription as ${row.status.toLowerCase()}`,
        meta: diff,
      });
    }
  }

  revalidatePath("/payments");
  return { ok: true };
}

export async function deleteSubscription(id: string): Promise<ActionResult> {
  const { allowed, denied, session } = await capabilityCheck("finance.write");
  if (!allowed) return denied;
  const row = await prisma.subscription.delete({ where: { id } });

  await logActivity(session, {
    action: "payments.subscription.delete",
    section: "payments",
    entityType: "Subscription",
    entityId: row.id,
    summary: `Deleted ${row.customerName}'s ${priceDisplay(row.amountInrMinor, row.amountEurMinor)} subscription`,
    meta: { amountInrMinor: row.amountInrMinor.toString(), interval: row.interval },
  });

  revalidatePath("/payments");
  return { ok: true };
}
