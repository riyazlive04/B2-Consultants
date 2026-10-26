"use server";

import { randomBytes } from "crypto";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { Prisma, type Invoice, type InvoiceCurrency, type InvoiceKind, type InvoiceStatus, type Product, type ProductInterval } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { SEATED_STATUSES } from "@/lib/enrollment-lifecycle";
import { requireSection, capabilityCheck } from "@/lib/rbac";
import { getTodayInrPerEur, eurMinorToInrMinor, inrMinorToEurMinor } from "@/lib/fx";
import { formatEurMinor, formatInrMinor, majorStringToMinor } from "@/lib/format";
import {
  asInvoiceCurrency,
  computeInvoiceTotals,
  dominantLevelCode,
  formatMinor,
  type InvoiceCurrencyCode,
} from "@/lib/invoice-money";
import { IST_ZONE, parseDateInput, ymdInZone } from "@/lib/dates";
import { optionalRule, rule } from "@/lib/field-rules";
import { emitTrigger } from "./automation";
import { afterResponse } from "./after-response";
import { appendAudit, LedgerError, postEntry } from "./ledger";
import { paymentEntryDraft } from "./finance-posting";
import { getInvoicePdfData, getReceiptPdfData } from "./payments-metrics";
import { renderReceiptPdf } from "@/documents/receipt-pdf";
import { getActiveLevels, getLevels } from "./levels";
import { renderInvoicePdf } from "@/documents/invoice-pdf";
import { brandEmailHeader, getEmailRuntime, sendResendEmail } from "@/lib/email";
import { logActivity, diffFields } from "./activity-log";
import { syncPaymentIncome } from "./finance-autopost";
import { syncInvoiceIssuance } from "./invoice-posting";
import type { ActionResult } from "./finance-actions";
import { archiveData, restoreData } from "@/lib/soft-delete";
import { getInvoiceSettings } from "./founder-config";
import { InvoiceNotIssuable, issueInvoice, mintProvisionalNumber, nextDocumentNumber } from "./document-numbers";

/** Payments (Synamate "Payments"): products, invoices/estimates, manual payments, subscriptions.
 *  No processor is wired - statuses advance manually. Gated to the `payments` section; deletes
 *  need the `finance.write` capability. */

function firstError(e: z.ZodError): string {
  return e.issues[0]?.message ?? "Invalid input";
}

/** Same shape as finance-actions.ts's private helper - duplicated rather than imported
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

/** A price may be set in INR, EUR, or both - the feed reads back exactly what was entered. */
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
    levelCode: row.levelCode,
  };
}

/**
 * An invoice's total as the DOCUMENT states it - in the currency it was issued in.
 *
 * Every activity line, email and toast about an invoice quotes this rather than the rupee
 * column, because "€1,400" and "₹1,34,000" are the same invoice and only one of them is what the
 * customer was asked for. The rupee side stays the one the dashboards total.
 */
function invoiceTotalDisplay(row: {
  currency: InvoiceCurrency;
  totalInrMinor: bigint;
  totalEurMinor: bigint;
}): string {
  const c = asInvoiceCurrency(row.currency);
  return formatMinor(c === "EUR" ? row.totalEurMinor : row.totalInrMinor, c);
}

function invoiceDiffShape(row: Invoice) {
  return {
    customerName: row.customerName,
    customerEmail: row.customerEmail,
    customerPhone: row.customerPhone,
    issueDate: row.issueDate,
    dueDate: row.dueDate,
    currency: row.currency as string,
    subtotalInrMinor: row.subtotalInrMinor.toString(),
    discountInrMinor: row.discountInrMinor.toString(),
    taxPercent: row.taxPercent,
    taxLabel: row.taxLabel,
    totalInrMinor: row.totalInrMinor.toString(),
    totalEurMinor: row.totalEurMinor.toString(),
    leadId: row.leadId,
    notes: row.notes,
  };
}

// ─────────────────────────── Products ───────────────────────────

const productSchema = z.object({
  /**
   * WHICH PROGRAMME this product sells - a `Level.code`, or blank for a one-off item.
   *
   * The products list used to be free text with nothing behind it, so an invoice line read
   * "A1 course" only because somebody typed those words, and no part of the app could tell that
   * the money belonged to German Note. A product that names its programme carries the level onto
   * the invoice line, and from there onto the Income row and the GL account that level posts to.
   */
  levelCode: z.string().trim().optional(),
  // Free text, not rule("name"): "Level 2 Bundle" is a product, not a person.
  name: rule("text").pipe(z.string().min(1, "Product name is required")),
  description: optionalRule("text"),
  priceInr: optionalRule("money"),
  priceEur: optionalRule("money"),
  interval: z.enum(INTERVALS),
  active: z.string().optional(),
});

/**
 * Settle a submitted product onto a programme.
 *
 * The code is checked against the LIVE catalogue rather than trusted, because the form is a
 * public RPC boundary once it leaves the browser, and a level column holding a code no `Level`
 * row answers to is a row that prices nothing and posts nowhere. An inactive programme is
 * refused too: it has been withdrawn from sale, and the founder withdrawing it should not find
 * it quietly back on the next invoice.
 *
 * The NAME follows the programme's label. Two names for one programme - "GN A1" in the
 * catalogue, "German A1 course" on the invoice - is how a catalogue stops being a catalogue.
 * A one-off product keeps whatever was typed.
 */
async function resolveProductProgramme(
  levelCodeRaw: string | undefined,
  typedName: string,
): Promise<{ levelCode: string | null; name: string } | { error: string }> {
  const code = levelCodeRaw?.trim();
  if (!code) return { levelCode: null, name: typedName };
  const level = (await getActiveLevels()).find((l) => l.code === code);
  if (!level) return { error: "That programme is no longer on the catalogue - pick another" };
  return { levelCode: level.code, name: level.label };
}

/** The programme already priced by another product - so "one product per programme" fails kindly. */
async function programmeTakenBy(levelCode: string, exceptId?: string): Promise<string | null> {
  const clash = await prisma.product.findFirst({
    where: { levelCode, ...(exceptId ? { NOT: { id: exceptId } } : {}) },
    select: { name: true, deletedAt: true },
  });
  if (!clash) return null;
  return clash.deletedAt
    ? `"${clash.name}" already prices that programme - restore it from Archived instead of adding a second one`
    : `"${clash.name}" already prices that programme - edit it instead of adding a second one`;
}

/**
 * The secret in a public invoice URL.
 *
 * `Invoice.publicToken` defaults to `cuid()` in the schema, and a cuid is an IDENTIFIER, not a
 * secret: it is built from a timestamp, a counter and a machine fingerprint, so tokens issued
 * near each other are near each other. That is fine for a primary key and wrong for the only
 * thing standing between the open internet and a document carrying a customer's name, email,
 * phone, what they were charged and the issuer's tax ID.
 *
 * 32 random bytes from the CSPRNG - the same strength `lib/agreement-token.ts` already uses for
 * a signing link, which is the other public document this app hands out. There was no reason
 * for the two to be held to different standards.
 *
 * NOT stored hashed, unlike the agreement token: an invoice link has to stay openable for as
 * long as the customer keeps the email, so the server must be able to look it up by value.
 * Entropy is doing the work here, which is exactly why it has to be real entropy.
 *
 * Invoices issued BEFORE this keep their cuid tokens - rewriting them would break links already
 * sent. New documents are not guessable; `rotateInvoiceLink` below is how an old one is replaced
 * deliberately, on the rows that still matter.
 *
 * The schema's `@default(cuid())` is GONE as of the 26 Oct migration (issue B5), so this function
 * is now the only source of an invoice token - the database can no longer quietly hand out a
 * cuid if a write path forgets to pass one.
 */
function mintPublicToken(): string {
  return randomBytes(32).toString("base64url");
}

/**
 * ════════════════════════════════════════════════════════════════════════════════════════
 *  REVOKE OR REPLACE A PUBLIC INVOICE LINK  (issue B5)
 * ════════════════════════════════════════════════════════════════════════════════════════
 *
 * The link had no kill switch. Once an invoice URL was out - mistyped address, forwarded email,
 * a customer who asks, a token minted back when the default was a guessable cuid - there was
 * nothing to do about it short of voiding the invoice, which is a statement about the DOCUMENT
 * and wrong: the invoice is perfectly valid, it is the URL that should stop working.
 *
 * Two modes, because they answer different questions:
 *
 *   "revoke"   kill it. The customer can no longer open the invoice at all. For a link that
 *              reached the wrong person and should not be replaced.
 *   "rotate"   kill it and mint a new one. For a link that reached the wrong person and the
 *              RIGHT one still needs it - the old URL 404s, the new one is sent.
 *
 * `expiresInDays` is accepted on rotate so a replacement link can be short-lived. Null keeps the
 * old behaviour (no expiry), which stays the default: an invoice a customer is paying in
 * instalments is opened over months, and a link that dies mid-plan is a support call.
 *
 * ── Why this is capability-gated and logged ─────────────────────────────────────────────
 * Rotating is destructive to something a customer holds, so it is `finance.write` like every
 * other money write, and it lands in the activity log with the invoice number - "the customer
 * says the link is dead" has to be answerable.
 */
export async function rotateInvoiceLink(
  id: string,
  mode: "revoke" | "rotate",
  expiresInDays?: number | null,
  // `ActionResult` in this file is the plain finance one (no payload), so the fresh URL rides
  // back in its own field rather than widening a type sixty other actions share.
): Promise<{ ok: true; url: string | null } | { ok: false; error: string }> {
  const { allowed, denied, session } = await capabilityCheck("finance.write");
  if (!allowed) return denied;

  const inv = await prisma.invoice.findUnique({
    where: { id },
    select: { id: true, number: true, kind: true, publicTokenRevokedAt: true },
  });
  if (!inv) return { ok: false, error: "Not found" };

  // Bounded, and bounded HERE rather than trusted from the form: a NaN or a negative would
  // otherwise mint a link that expired in 1970, which reads to the customer as a broken invoice.
  // Same guard shape as `mintAgreementToken`'s ttlDays.
  const days =
    typeof expiresInDays === "number" && Number.isFinite(expiresInDays) && expiresInDays >= 1
      ? Math.min(365, Math.round(expiresInDays))
      : null;

  const token = mode === "rotate" ? mintPublicToken() : null;
  await prisma.invoice.update({
    where: { id },
    data:
      mode === "rotate"
        ? {
            publicToken: token!,
            // Clearing the revocation is the point of rotating: the NEW token is live.
            publicTokenRevokedAt: null,
            publicTokenExpiresAt: days ? new Date(Date.now() + days * 86_400_000) : null,
          }
        : { publicTokenRevokedAt: new Date() },
  });

  await logActivity(session, {
    action: mode === "rotate" ? "invoice.link.rotate" : "invoice.link.revoke",
    section: "payments",
    entityType: "Invoice",
    entityId: id,
    summary:
      mode === "rotate"
        ? `Replaced the public link for ${inv.number}${days ? ` (expires in ${days} days)` : ""}`
        : `Revoked the public link for ${inv.number}`,
    // Deliberately NOT the token itself. The activity log is readable by the founder and the
    // whole value of the token is that it is not written down anywhere it does not need to be.
    meta: { kind: inv.kind, expiresInDays: days },
  });

  revalidatePath("/payments");
  revalidatePath(`/payments/${id}`);
  return { ok: true, url: token ? publicInvoiceUrl(token) : null };
}

export async function createProduct(form: FormData): Promise<ActionResult> {
  const session = await requireSection("payments");
  const parsed = productSchema.safeParse(Object.fromEntries(form));
  if (!parsed.success) return { ok: false, error: firstError(parsed.error) };
  const d = parsed.data;
  const programme = await resolveProductProgramme(d.levelCode, d.name);
  if ("error" in programme) return { ok: false, error: programme.error };
  if (programme.levelCode) {
    const taken = await programmeTakenBy(programme.levelCode);
    if (taken) return { ok: false, error: taken };
  }
  const fx = await getTodayInrPerEur();
  const row = await prisma.product.create({
    data: {
      levelCode: programme.levelCode,
      name: programme.name,
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
  const programme = await resolveProductProgramme(d.levelCode, d.name);
  if ("error" in programme) return { ok: false, error: programme.error };
  if (programme.levelCode) {
    const taken = await programmeTakenBy(programme.levelCode, id);
    if (taken) return { ok: false, error: taken };
  }
  const fx = await getTodayInrPerEur();
  const existing = await prisma.product.findUnique({ where: { id } });
  const row = await prisma.product.update({
    where: { id },
    data: {
      levelCode: programme.levelCode,
      name: programme.name,
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
        summary: `Edited the product "${row.name}" - now ${priceDisplay(row.priceInrMinor, row.priceEurMinor)}`,
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

/** Permanent delete - only from the Archived tab. Subscription.productId → null (SetNull). */
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
  studentId?: string;
  enrollmentId?: string;
  customerName: string;
  customerEmail?: string;
  customerPhone?: string;
  /** Postal address of the recipient - required to issue (§14 Abs. 4 Nr. 1 UStG). */
  customerAddress?: string;
  issueDate: string;
  dueDate?: string;
  /** Date or period of the service, YYYY-MM-DD - required to issue (§14 Abs. 4 Nr. 6 UStG). */
  servicePeriodStart?: string;
  servicePeriodEnd?: string;
  /** The coaching agreement billed under (its documentNo), which prints its payment terms. */
  agreementRef?: string;
  /** Why no tax is charged, on a 0% invoice. Blank takes the Console's note at issue. */
  taxNote?: string;
  /** Which currency the figures below are typed in. See `lib/invoice-money`. */
  currency?: InvoiceCurrencyCode;
  items: { description: string; quantity: number; unitPrice: string; levelCode?: string | null }[];
  discount?: string;
  taxPercent?: number;
  /** What the tax is called on this document. Ignored when the rate is 0 - see `taxLine`. */
  taxLabel?: string;
  notes?: string;
};

/**
 * Every figure on an invoice, in BOTH currencies.
 *
 * The ladder (subtotal → discount → taxable → tax → total) is computed in the currency the
 * invoice was TYPED in, by the same pure functions the editor previews with, and only the
 * finished figures are converted across. Doing it the other way - rupee math, euros derived per
 * line - is what makes a euro tax line come out a cent short of rate × base, and a tax line that
 * does not equal its own arithmetic is a defective document.
 *
 * The converted side is stored, not computed on read, so the KPI cards and the ageing can keep
 * totalling in rupees without the whole back catalogue re-pricing every time the euro moves.
 */
function invoiceMoney(
  currency: InvoiceCurrencyCode,
  items: { quantity: number; unitPrice: string }[],
  discount: string | undefined,
  taxPercent: number,
  rate: Prisma.Decimal,
) {
  const t = computeInvoiceTotals(items, discount, taxPercent);
  /** The same figure in the other currency, at the rate being stamped on this invoice. */
  const across = (minor: bigint): bigint =>
    currency === "INR" ? inrMinorToEurMinor(minor, rate) : eurMinorToInrMinor(minor, rate);
  const pair = (minor: bigint) =>
    currency === "INR"
      ? { inr: minor, eur: across(minor) }
      : { inr: across(minor), eur: minor };

  const subtotal = pair(t.subtotalMinor);
  const discountPair = pair(t.discountMinor);
  const tax = pair(t.taxMinor);
  const total = pair(t.totalMinor);
  return {
    // `total` in the ENTERED currency - what the "an invoice is a demand for money" check reads,
    // so a €0 invoice is refused on its own terms rather than on a converted rupee figure.
    enteredTotalMinor: t.totalMinor,
    subtotalInrMinor: subtotal.inr,
    subtotalEurMinor: subtotal.eur,
    discountInrMinor: discountPair.inr,
    discountEurMinor: discountPair.eur,
    taxInrMinor: tax.inr,
    taxEurMinor: tax.eur,
    totalInrMinor: total.inr,
    totalEurMinor: total.eur,
    /** Each line's unit price on both sides, in submitted order. */
    lineUnitPrices: items.map((it) => pair(majorStringToMinor(it.unitPrice || "0"))),
  };
}


/**
 * createInvoice/updateInvoice take a JSON payload rather than FormData, so NOTHING here has been
 * near the browser's field filters by the time it lands - a crafted call could set taxPercent to
 * 10_000 or paste a novel into a line item. Re-check the whole shape against the same rules the
 * client filters on (lib/field-rules). Replaces the old hand-rolled validatePayload, which checked
 * only the customer name, the item count and the issue date - taxPercent reached Prisma unchecked.
 */
const invoicePayloadSchema = z.object({
  kind: z.enum(["INVOICE", "ESTIMATE"]),
  leadId: z.string().trim().optional(),
  /**
   * WHO THIS INVOICE IS FOR, as a student (migration M1).
   *
   * Optional and usually left blank by the form: `resolveInvoiceParty` below works it out from
   * the contact, because the person entering an invoice should not have to know whether the
   * customer also has a student record. An explicit value wins, for the cases it cannot infer -
   * a walk-in with no contact record, or a lead that became two students.
   */
  studentId: z.string().trim().optional(),
  /** The specific enrolment being billed, where one applies. Inferred when unambiguous. */
  enrollmentId: z.string().trim().optional(),
  customerName: rule("name"),
  customerEmail: optionalRule("email"),
  customerPhone: optionalRule("phone"),
  // Free text, not rule("text"): an address legitimately carries commas, slashes and newlines.
  customerAddress: z.string().trim().max(300, "Keep the address under 300 characters").optional(),
  issueDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Invalid issue date"),
  dueDate: z.string().trim().optional(),
  servicePeriodStart: z.union([z.literal(""), z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Invalid service date")]).optional(),
  servicePeriodEnd: z.union([z.literal(""), z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Invalid service end date")]).optional(),
  agreementRef: z.string().trim().max(40).optional(),
  taxNote: z.string().trim().max(300, "Keep the tax note under 300 characters").optional(),
  currency: z.enum(["INR", "EUR"]).default("INR"),
  items: z
    .array(
      z.object({
        // Free text, not rule("name"): "Level 2 Bundle" is a legitimate line item.
        description: rule("text").pipe(z.string().min(1, "Every line item needs a description")),
        quantity: z.coerce.number().int().min(1, "Quantity must be at least 1").max(9999),
        // `?? ""` so the type stays a plain string - invoiceMoney/majorStringToMinor take one.
        unitPrice: optionalRule("money").transform((v) => v ?? ""),
        /** The programme this line sells, when it came from a programme product. Checked below. */
        levelCode: z.string().trim().optional().nullable(),
      }),
    )
    .min(1, "Add at least one line item"),
  discount: optionalRule("money"),
  taxPercent: z.coerce
    .number()
    .min(0, "Tax % can't be negative")
    .max(100, "Tax % must be 100 or less")
    .optional(),
  taxLabel: optionalRule("text"),
  notes: optionalRule("text"),
});

/**
 * Keep only line-level programme codes the catalogue actually answers to.
 *
 * Checked against EVERY level, not just the active ones: a programme withdrawn from sale is
 * still what an existing invoice sold, and re-saving that invoice must not quietly strip the
 * attribution off its lines. A code that matches nothing becomes null - the line still invoices
 * for exactly what it says, it simply isn't attributed to a programme that does not exist.
 */
async function sanitizeLineLevels(
  items: { levelCode?: string | null }[],
): Promise<(string | null)[]> {
  const wanted = items.map((it) => it.levelCode?.trim() || null);
  if (!wanted.some(Boolean)) return wanted;
  const known = new Set((await getLevels()).map((l) => l.code));
  return wanted.map((code) => (code && known.has(code) ? code : null));
}

/**
 * The compliance fields both create and update write, checked: a service period that ends before
 * it starts is a typo, and an agreement reference that names no agreement would print a contract
 * number - and that contract's refund terms - onto an invoice that is not under it.
 */
async function complianceFields(payload: z.infer<typeof invoicePayloadSchema>): Promise<
  | {
      ok: true;
      data: {
        customerAddress: string | null;
        servicePeriodStart: Date | null;
        servicePeriodEnd: Date | null;
        agreementRef: string | null;
        taxNote: string | null;
      };
    }
  | { ok: false; error: string }
> {
  const start = payload.servicePeriodStart?.trim() || "";
  const end = payload.servicePeriodEnd?.trim() || "";
  if (end && !start) return { ok: false, error: "Add the service start date, or clear the end date." };
  if (start && end && end < start) return { ok: false, error: "The service period ends before it starts." };
  const agreementRef = payload.agreementRef?.trim() || null;
  if (agreementRef) {
    const found = await prisma.agreement.findUnique({ where: { documentNo: agreementRef }, select: { id: true } });
    if (!found) return { ok: false, error: `No agreement ${agreementRef} exists - check the reference or clear it.` };
  }
  return {
    ok: true,
    data: {
      customerAddress: payload.customerAddress?.trim() || null,
      servicePeriodStart: start ? parseDateInput(start) : null,
      servicePeriodEnd: end && end !== start ? parseDateInput(end) : null,
      agreementRef,
      taxNote: payload.taxNote?.trim() || null,
    },
  };
}

/**
 * ENQUIRY → STUDENT → INVOICE: who is this invoice actually for?
 *
 * ── Why this is inferred rather than asked ─────────────────────────────────────────────
 * An invoice has always carried `leadId` - the enquiry record - and nothing else. So "what has
 * this student paid" could only be answered by joining back through provenance, and it failed
 * outright for a student who was never an enquiry: a walk-in, a German Note learner, anybody
 * imported. `Invoice.studentId` (migration M1) is the fix, and this is what fills it.
 *
 * It is INFERRED because the person entering an invoice should not have to know whether the
 * customer also has a student record. They pick the customer; the app works out the rest.
 *
 * ── The rules, in order ────────────────────────────────────────────────────────────────
 *   1. An explicit `studentId` from the caller wins. It exists for what cannot be inferred.
 *   2. Otherwise, if the contact has EXACTLY ONE student, that is the student.
 *   3. A contact with two students resolves to NEITHER. Guessing which of somebody's two
 *      records an invoice belongs to is worse than leaving it blank: blank is visibly
 *      unanswered, and wrong is invisible.
 *   4. The enrolment follows the same rule, one level down: exactly one seated enrolment on that
 *      student, or nothing. A student mid-way between programmes legitimately has two.
 *
 * Returns nulls rather than throwing. An invoice must never fail to save because the link could
 * not be worked out - the money is the point, the link is an improvement on it.
 */
async function resolveInvoiceParty(
  tx: Prisma.TransactionClient,
  payload: { leadId?: string; studentId?: string; enrollmentId?: string },
): Promise<{ studentId: string | null; enrollmentId: string | null }> {
  let studentId = payload.studentId?.trim() || null;

  if (!studentId && payload.leadId?.trim()) {
    const students = await tx.student.findMany({
      where: { leadId: payload.leadId.trim() },
      select: { id: true },
      take: 2, // two is enough to know it is ambiguous
    });
    if (students.length === 1) studentId = students[0].id;
  }

  let enrollmentId = payload.enrollmentId?.trim() || null;
  if (!enrollmentId && studentId) {
    const enrolments = await tx.enrollment.findMany({
      where: { studentId, status: { in: [...SEATED_STATUSES] } },
      select: { id: true },
      take: 2,
    });
    if (enrolments.length === 1) enrollmentId = enrolments[0].id;
  }

  /*
    An explicitly supplied id is TRUSTED but checked for existence - a stale id from a form left
    open while the record was archived would otherwise fail the whole invoice on a foreign key
    violation, which is a confusing way to learn that something unrelated was deleted.
  */
  if (studentId) {
    const exists = await tx.student.findUnique({ where: { id: studentId }, select: { id: true } });
    if (!exists) studentId = null;
  }
  if (enrollmentId) {
    const exists = await tx.enrollment.findUnique({ where: { id: enrollmentId }, select: { id: true } });
    if (!exists) enrollmentId = null;
  }

  return { studentId, enrollmentId };
}

export async function createInvoice(raw: InvoicePayload): Promise<ActionResult> {
  const session = await requireSection("payments");
  const parsedPayload = invoicePayloadSchema.safeParse(raw);
  if (!parsedPayload.success) return { ok: false, error: firstError(parsedPayload.error) };
  const payload = parsedPayload.data;
  const fx = await getTodayInrPerEur();
  const currency = payload.currency;
  const taxPercent = payload.taxPercent ?? 0;
  const t = invoiceMoney(currency, payload.items, payload.discount, taxPercent, fx.rate);
  const lineLevels = await sanitizeLineLevels(payload.items);
  /**
   * ── An invoice is a demand for money (issue 15) ─────────────────────────────────
   * A total of ₹0.00 was created without complaint: every line priced at nothing, or a discount
   * that cancelled the lot. It then went out, or sat in the list, as a document asking the
   * customer for nothing - and counted as one more unpaid invoice in the ageing.
   *
   * Checked on the TOTAL rather than per line, so a genuinely free line beside a priced one (a
   * bundled book, a waived sitting) is still allowed.
   */
  if (t.enteredTotalMinor <= BigInt(0)) {
    return {
      ok: false,
      error: "This comes to 0 - price at least one line, or reduce the discount, before saving it.",
    };
  }

  const compliance = await complianceFields(payload);
  if (!compliance.ok) return compliance;

  let created: Invoice | null = null;
  await prisma.$transaction(async (tx) => {
    // An estimate is numbered now - it is not a tax document, and its number is what the customer
    // quotes back. An invoice is a DRAFT reference until it is issued (see document-numbers.ts).
    const number =
      payload.kind === "ESTIMATE"
        ? await nextDocumentNumber(tx, "EST", parseDateInput(payload.issueDate).getUTCFullYear())
        : mintProvisionalNumber();
    // Who it is FOR, not just which enquiry it came from - see `resolveInvoiceParty`.
    const party = await resolveInvoiceParty(tx, payload);
    created = await tx.invoice.create({
      data: {
        ...compliance.data,
        kind: payload.kind as InvoiceKind,
        number,
        publicToken: mintPublicToken(),
        status: "DRAFT",
        leadId: payload.leadId || null,
        studentId: party.studentId,
        enrollmentId: party.enrollmentId,
        customerName: payload.customerName.trim(),
        customerEmail: payload.customerEmail?.trim() || null,
        customerPhone: payload.customerPhone?.trim() || null,
        issueDate: parseDateInput(payload.issueDate),
        dueDate: payload.dueDate?.trim() ? parseDateInput(payload.dueDate) : null,
        currency,
        subtotalInrMinor: t.subtotalInrMinor,
        subtotalEurMinor: t.subtotalEurMinor,
        discountInrMinor: t.discountInrMinor,
        discountEurMinor: t.discountEurMinor,
        taxPercent: new Prisma.Decimal(taxPercent),
        // A 0% invoice carries NO tax line at all, so it carries no tax name either - a label
        // left behind on a tax-free invoice reads as a charge that was made and came to nothing.
        taxLabel: taxPercent > 0 ? payload.taxLabel?.trim() || "Tax" : null,
        taxInrMinor: t.taxInrMinor,
        taxEurMinor: t.taxEurMinor,
        totalInrMinor: t.totalInrMinor,
        totalEurMinor: t.totalEurMinor,
        fxRateUsed: fx.rate,
        notes: payload.notes?.trim() || null,
        createdById: session.user.id,
        items: {
          create: payload.items.map((it, i) => ({
            description: it.description.trim(),
            quantity: Math.max(1, it.quantity),
            unitPriceInrMinor: t.lineUnitPrices[i].inr,
            unitPriceEurMinor: t.lineUnitPrices[i].eur,
            levelCode: lineLevels[i],
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
      summary: `Created ${row.kind === "ESTIMATE" ? "estimate" : "invoice"} ${row.number} for ${row.customerName} - ${invoiceTotalDisplay(row)}`,
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
  const currency = payload.currency;
  const taxPercent = payload.taxPercent ?? 0;
  const t = invoiceMoney(currency, payload.items, payload.discount, taxPercent, fx.rate);
  const lineLevels = await sanitizeLineLevels(payload.items);
  /**
   * ── An invoice is a demand for money (issue 15) ─────────────────────────────────
   * A total of ₹0.00 was created without complaint: every line priced at nothing, or a discount
   * that cancelled the lot. It then went out, or sat in the list, as a document asking the
   * customer for nothing - and counted as one more unpaid invoice in the ageing.
   *
   * Checked on the TOTAL rather than per line, so a genuinely free line beside a priced one (a
   * bundled book, a waived sitting) is still allowed.
   */
  if (t.enteredTotalMinor <= BigInt(0)) {
    return {
      ok: false,
      error: "This comes to 0 - price at least one line, or reduce the discount, before saving it.",
    };
  }

  const existing = await prisma.invoice.findUnique({ where: { id } });
  if (!existing) return { ok: false, error: "Invoice not found" };
  /**
   * An issued invoice is a record, not a draft. Editing one rewrote what the customer already holds
   * - and re-stamped it at TODAY's exchange rate, so a paid euro invoice silently changed its rupee
   * side. A mistake is corrected by voiding it and issuing a new one, which keeps both on file.
   */
  if (existing.kind === "INVOICE" && existing.issuedAt) {
    return {
      ok: false,
      error: `${existing.number} has been issued and can't be edited. Void it and raise a new invoice instead.`,
    };
  }
  const compliance = await complianceFields(payload);
  if (!compliance.ok) return compliance;
  let updated: Invoice | null = null;
  await prisma.$transaction(async (tx) => {
    await tx.invoiceLineItem.deleteMany({ where: { invoiceId: id } });
    // Re-resolved on edit, because the customer may have been changed - and because a draft
    // raised before the student record existed should pick it up once it does.
    const party = await resolveInvoiceParty(tx, payload);
    updated = await tx.invoice.update({
      where: { id },
      data: {
        ...compliance.data,
        leadId: payload.leadId || null,
        studentId: party.studentId,
        enrollmentId: party.enrollmentId,
        customerName: payload.customerName.trim(),
        customerEmail: payload.customerEmail?.trim() || null,
        customerPhone: payload.customerPhone?.trim() || null,
        issueDate: parseDateInput(payload.issueDate),
        dueDate: payload.dueDate?.trim() ? parseDateInput(payload.dueDate) : null,
        currency,
        subtotalInrMinor: t.subtotalInrMinor,
        subtotalEurMinor: t.subtotalEurMinor,
        discountInrMinor: t.discountInrMinor,
        discountEurMinor: t.discountEurMinor,
        taxPercent: new Prisma.Decimal(taxPercent),
        // A 0% invoice carries NO tax line at all, so it carries no tax name either - a label
        // left behind on a tax-free invoice reads as a charge that was made and came to nothing.
        taxLabel: taxPercent > 0 ? payload.taxLabel?.trim() || "Tax" : null,
        taxInrMinor: t.taxInrMinor,
        taxEurMinor: t.taxEurMinor,
        totalInrMinor: t.totalInrMinor,
        totalEurMinor: t.totalEurMinor,
        fxRateUsed: fx.rate,
        notes: payload.notes?.trim() || null,
        items: {
          create: payload.items.map((it, i) => ({
            description: it.description.trim(),
            quantity: Math.max(1, it.quantity),
            unitPriceInrMinor: t.lineUnitPrices[i].inr,
            unitPriceEurMinor: t.lineUnitPrices[i].eur,
            levelCode: lineLevels[i],
            position: i,
          })),
        },
      },
    });
  });

  if (existing && updated) {
    const row: Invoice = updated;
    const diff = diffFields(invoiceDiffShape(existing), invoiceDiffShape(row));
    // Line items are replaced wholesale on every save, so they never show up in the diff -
    // an amount change surfaces through the totals instead.
    if (diff.changed.length) {
      await logActivity(session, {
        action: row.kind === "ESTIMATE" ? "payments.estimate.update" : "payments.invoice.update",
        section: "payments",
        entityType: "Invoice",
        entityId: row.id,
        summary: `Edited ${row.kind === "ESTIMATE" ? "estimate" : "invoice"} ${row.number} for ${row.customerName} - now ${invoiceTotalDisplay(row)}`,
        meta: diff,
      });
    }
  }

  revalidatePath("/payments");
  revalidatePath(`/payments/${id}`);
  return { ok: true };
}

const STATUSES = ["DRAFT", "SENT", "PAID", "PARTIAL", "OVERDUE", "VOID", "ACCEPTED", "DECLINED"] as const;
/** The statuses that put an invoice in a customer's hands - reaching one issues it. */
const ISSUING_STATUSES = ["SENT", "PAID", "PARTIAL", "OVERDUE"] as const;

export async function setInvoiceStatus(id: string, status: string): Promise<ActionResult> {
  const session = await requireSection("payments");
  if (!(STATUSES as readonly string[]).includes(status)) return { ok: false, error: "Invalid status" };
  const existing = await prisma.invoice.findUnique({ where: { id } });
  if (!existing) return { ok: false, error: "Invoice not found" };
  if (existing.kind === "INVOICE" && existing.issuedAt && status === "DRAFT") {
    return { ok: false, error: `${existing.number} has been issued - it can be voided, but not turned back into a draft.` };
  }
  const settings = await getInvoiceSettings();
  let row: Invoice;
  try {
    row = await prisma.$transaction(async (tx) => {
      // Leaving DRAFT for any live state IS issuing it - it draws its number here. Voiding a draft
      // does not: a draft that was never sent was never an invoice.
      if (existing.kind === "INVOICE" && (ISSUING_STATUSES as readonly string[]).includes(status)) {
        await issueInvoice(tx, id, settings);
      }
      return tx.invoice.update({
        where: { id },
        data: {
          status: status as InvoiceStatus,
          ...(status === "SENT" ? { sentAt: new Date() } : {}),
          ...(status === "PAID" ? { paidAt: new Date() } : {}),
        },
      });
    });
  } catch (err) {
    if (err instanceof InvoiceNotIssuable) return { ok: false, error: err.message };
    throw err;
  }

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

  // Keep the ledger's issuance entry (Dr AR / Cr Income) in step with the new status - post it on
  // the way into an issued state, reverse it if the invoice fell back to DRAFT or VOID. No-op unless
  // financePosting.invoiceIssuancePosting is on (audit §C #22).
  await syncInvoiceIssuance(id, session.user.id);

  revalidatePath("/payments");
  revalidatePath(`/payments/${id}`);
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
    summary: `Archived ${row.kind === "ESTIMATE" ? "estimate" : "invoice"} ${row.number} for ${row.customerName} - ${invoiceTotalDisplay(row)}`,
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
 * Permanent delete - only from the Archived tab. Cascades line items + payments and removes each
 * payment's auto-posted Income mirror so no phantom revenue is left behind (the original delete
 * behaviour, now the true end-of-life step).
 */
export async function purgeInvoice(id: string): Promise<ActionResult> {
  const { allowed, denied, session } = await capabilityCheck("finance.write");
  if (!allowed) return denied;
  const existing = await prisma.invoice.findUnique({
    where: { id },
    select: { deletedAt: true, kind: true, issuedAt: true, number: true },
  });
  if (!existing) return { ok: false, error: "Invoice not found" };
  if (!existing.deletedAt) return { ok: false, error: "Archive it first" };
  // An issued invoice is a tax record: it must be kept (8 years in Germany) and its number must
  // never come free. It can sit in the archive indefinitely; it cannot be destroyed.
  if (existing.kind === "INVOICE" && existing.issuedAt) {
    return { ok: false, error: `${existing.number} was issued, so it is a tax record and must be kept. It stays archived.` };
  }
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
    <p>You can also view and download it online: <a href="${opts.url}" style="color:#003C8C">${opts.url}</a></p>
    <p>Thank you for your business.<br>B2 Consultants</p>
  </div>`;
}

export type SendInvoiceResult = { ok: true; message: string } | { ok: false; error: string };

/**
 * "Send" used to only flip status → SENT (BUILD_CHECKLIST §7). This now actually delivers
 * the invoice - PDF attached, plus a link to the public page - to `Invoice.customerEmail`,
 * over the exact same Resend path every other system email in this app uses (lib/email.ts's
 * getEmailRuntime + sendResendEmail, the same pair auth.ts's password-reset email calls
 * directly rather than going through messaging.ts, because an Invoice isn't always tied to
 * a Lead the way messaging.ts's sendEmailMessage expects).
 *
 * Delivery failure (no email on file, email unconfigured/paused, provider error) never
 * blocks the status flip - the invoice still moves to SENT so the founder can hand it over
 * manually via the existing "Link"/"PDF" buttons. The caller gets a human-readable message
 * either way instead of a bare boolean, so the founder knows whether delivery actually
 * happened.
 */
export async function sendInvoice(id: string): Promise<SendInvoiceResult> {
  const session = await requireSection("payments");
  // Issue BEFORE rendering: the PDF that goes out must carry the real number, and an invoice the
  // law would reject must not reach the customer at all.
  const settings = await getInvoiceSettings();
  try {
    await prisma.$transaction((tx) => issueInvoice(tx, id, settings));
  } catch (err) {
    if (err instanceof InvoiceNotIssuable) return { ok: false, error: err.message };
    throw err;
  }
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
  let message = "Marked sent - no email on file, share the link or PDF manually";

  if (to) {
    const rt = await getEmailRuntime();
    if (rt.enabled) {
      // PDF attachment: chosen over a link-only email because InvoicePdfData is already
      // built for the public page and renderInvoicePdf is a pure, synchronous-cost buffer
      // render - attaching cost nothing extra to plumb. The public link is still included
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
        ? "Marked sent - email is paused, nothing was delivered"
        : "Marked sent - email isn't configured, nothing was delivered";
    }
  }

  await prisma.invoice.update({ where: { id }, data: { status: "SENT", sentAt: new Date() } });

  // Issuing = recognising the revenue + receivable on the ledger (audit §C #22). No-op unless the
  // flag is on; best-effort, so a posting hiccup never blocks the send.
  await syncInvoiceIssuance(inv.id, session.user.id);

  // The summary carries `message` because the status flip and actual delivery can disagree -
  // the founder needs to see which one happened.
  await logActivity(session, {
    action: "payments.invoice.send",
    section: "payments",
    entityType: "Invoice",
    entityId: inv.id,
    summary: `Sent ${noun.toLowerCase()} ${inv.number} (${formatInrMinor(inv.totalInrMinor)}) to ${inv.customerName} - ${message}`,
    meta: { number: inv.number, to: to ?? null, totalInrMinor: inv.totalInrMinor.toString(), message },
  });

  revalidatePath("/payments");
  revalidatePath(`/payments/${id}`);
  return { ok: true, message };
}

/**
 * What `recordPayment` carries out of its transaction, for the log and the Income mirror.
 *
 * Named rather than inlined because TypeScript cannot see an assignment made inside the
 * transaction callback: `typeof recorded` narrows to `null` afterwards, and every field read off
 * it becomes an error on `never`. The explicit annotation at the point of use is what re-widens
 * it - the same shape the previous version of this function declared inline for the same reason.
 */
type RecordedPayment = {
  paymentId: string;
  number: string;
  customerName: string;
  status: InvoiceStatus;
  currency: InvoiceCurrencyCode;
  amountInrMinor: bigint;
  amountEurMinor: bigint;
  fxRateUsed: Prisma.Decimal;
  leadId: string | null;
  levelCode: string | null;
};

/**
 * Post every payment to the real ledger in the SAME transaction as the InvoicePayment row
 * (BUILD_CHECKLIST §7 - copies finance-actions.ts's createIncome/createExpense pattern
 * exactly). Before this, Payments and Finance were two disconnected books for the same
 * kind of event: money could be marked "paid" here without ever appearing on the P&L,
 * cash position, or trial balance.
 */
export async function recordPayment(invoiceId: string, form: FormData): Promise<ActionResult> {
  const session = await requireSection("payments");
  // `amountInr` is the field's historic name; what it carries is an amount in the INVOICE's
  // currency, which the modal labels accordingly. Renaming the field would break nothing but
  // would also tell no one anything - the currency is the invoice's, never the typist's choice.
  const amount = rule("money").safeParse(String(form.get("amountInr") ?? ""));
  if (!amount.success) return { ok: false, error: firstError(amount.error) };
  const amountRaw = amount.data;
  const method = String(form.get("method") ?? "cash").trim() || "cash";
  const ref = optionalRule("text").safeParse(String(form.get("reference") ?? ""));
  if (!ref.success) return { ok: false, error: firstError(ref.error) };
  const reference = ref.data ?? null;
  const enteredMinor = majorStringToMinor(amountRaw);
  const settings = await getInvoiceSettings();

  let paidLeadId: string | null = null;
  let recorded: RecordedPayment | null = null;
  const result = await withLedgerErrors(async () => {
    await prisma.$transaction(async (tx) => {
      const inv = await tx.invoice.findUnique({
        where: { id: invoiceId },
        include: {
          payments: { select: { amountInrMinor: true } },
          items: { select: { levelCode: true, quantity: true, unitPriceInrMinor: true } },
        },
      });
      if (!inv) throw new LedgerError("Invoice not found");
      if (inv.kind !== "INVOICE") throw new LedgerError("Payments are recorded against invoices, not estimates.");
      if (inv.status === "VOID") throw new LedgerError("This invoice is void - raise a new one to take payment against.");

      // Money taken against a draft means the draft is in the customer's hands: issue it, so the
      // receipt can name a real invoice number. Same checks as sending it.
      try {
        const issued = await issueInvoice(tx, invoiceId, settings);
        inv.number = issued.number;
      } catch (err) {
        if (err instanceof InvoiceNotIssuable) throw new LedgerError(err.message);
        throw err;
      }
      // The written confirmation §7.4 of the agreement promises - numbered in the same
      // transaction, so a payment and its receipt number exist together or not at all.
      const paidAt = new Date();
      const receiptNumber = await nextDocumentNumber(tx, "RCT", Number(ymdInZone(paidAt, IST_ZONE).slice(0, 4)));

      /**
       * The receipt is valued in the invoice's own currency, and its other side is derived once
       * at the rate the invoice was raised at - NOT today's.
       *
       * A euro invoice settled three months later would otherwise be converted at whatever the
       * euro was worth on the day somebody got round to recording it, so the rupee books would
       * show a receipt that never matched the receivable it cleared, and the difference would
       * sit in accounts receivable forever as a balance nobody could pay off.
       */
      const currency = asInvoiceCurrency(inv.currency);
      const amountInrMinor =
        currency === "INR" ? enteredMinor : eurMinorToInrMinor(enteredMinor, inv.fxRateUsed);
      const amountEurMinor =
        currency === "EUR" ? enteredMinor : inrMinorToEurMinor(enteredMinor, inv.fxRateUsed);

      const payment = await tx.invoicePayment.create({
        data: {
          invoiceId,
          amountInrMinor,
          amountEurMinor,
          currency: currency as InvoiceCurrency,
          fxRateUsed: inv.fxRateUsed,
          method,
          reference,
          paidAt,
          receiptNumber,
          recordedById: session.user.id,
        },
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
      recorded = {
        paymentId: payment.id,
        number: inv.number,
        customerName: inv.customerName,
        status,
        currency,
        amountInrMinor,
        amountEurMinor,
        fxRateUsed: inv.fxRateUsed,
        leadId: inv.leadId,
        // What this invoice mainly sells, so the Income row lands against the real programme -
        // and therefore in the right business line's book - instead of a generic "Other".
        levelCode: dominantLevelCode(
          inv.items.map((it) => ({
            levelCode: it.levelCode,
            quantity: it.quantity,
            unitPriceMinor: it.unitPriceInrMinor,
          })),
        ),
      };
    });
  });
  if (!result.ok) return result;

  if (recorded) {
    const r: RecordedPayment = recorded;
    await logActivity(session, {
      action: "payments.payment.record",
      section: "payments",
      entityType: "InvoicePayment",
      entityId: r.paymentId,
      summary: `Recorded a ${formatMinor(r.currency === "EUR" ? r.amountEurMinor : r.amountInrMinor, r.currency)} payment from ${r.customerName} against invoice ${r.number} - now ${r.status.toLowerCase()}`,
      meta: {
        invoiceId,
        number: r.number,
        currency: r.currency,
        amountInrMinor: r.amountInrMinor.toString(),
        amountEurMinor: r.amountEurMinor.toString(),
        method,
        reference,
        invoiceStatus: r.status,
      },
    });

    /**
     * Auto-post the collection to Finance as Income, so it lands on the P&L and on the
     * customer's own payment history.
     *
     * The rate is the INVOICE's, not today's: the two amounts were converted from each other at
     * that rate a moment ago, and stamping a different one on the Income row would make its own
     * two columns disagree with each other.
     */
    await syncPaymentIncome(
      {
        id: r.paymentId,
        amountInrMinor: r.amountInrMinor,
        amountEurMinor: r.amountEurMinor,
        fxRateUsed: r.fxRateUsed,
        studentName: r.customerName,
        method,
        paidOn: new Date(),
        leadId: r.leadId,
        levelCode: r.levelCode,
      },
      r.paymentId,
    );

    // Ensure the invoice's issuance entry exists before its payment credits AR - a payment recorded
    // against an invoice that was never explicitly "sent" would otherwise leave AR one-sided again
    // (audit §C #22). No-op unless the flag is on; idempotent.
    await syncInvoiceIssuance(invoiceId, session.user.id);
  }

  // Deferred - the engine run belongs after the receipt is confirmed, not in front of it.
  if (paidLeadId) {
    const leadId = paidLeadId;
    afterResponse("invoice-paid", () => emitTrigger("INVOICE_PAID", { leadId }));
  }
  revalidatePath("/payments");
  revalidatePath(`/payments/${invoiceId}`);
  revalidatePath("/finance");
  return { ok: true };
}

/**
 * Email a payment's receipt to the customer - the written confirmation §7.4 of the agreement
 * promises. Deliberately a button, not automatic on recordPayment: a payment recorded by mistake
 * (or a test) must not land in a real student's inbox before anyone has looked at it.
 */
export async function sendReceipt(paymentId: string): Promise<SendInvoiceResult> {
  const session = await requireSection("payments");
  const payment = await prisma.invoicePayment.findUnique({
    where: { id: paymentId },
    select: {
      id: true, receiptNumber: true, invoiceId: true,
      invoice: { select: { customerName: true, customerEmail: true, publicToken: true } },
    },
  });
  if (!payment) return { ok: false, error: "Payment not found" };
  if (!payment.receiptNumber) return { ok: false, error: "This payment predates receipts and has no receipt number." };
  const to = payment.invoice.customerEmail?.trim();
  if (!to) return { ok: false, error: "No email on this invoice - download the receipt and hand it over instead." };

  const rt = await getEmailRuntime();
  if (!rt.enabled) {
    return { ok: false, error: rt.configured ? "Email is paused - nothing was sent." : "Email isn't configured - nothing was sent." };
  }
  const data = await getReceiptPdfData(paymentId);
  if (!data) return { ok: false, error: "Receipt not found" };

  const origin = (process.env.BETTER_AUTH_URL ?? "").replace(/\/+$/, "");
  const url = `${origin}/i/${payment.invoice.publicToken}/receipt/${encodeURIComponent(data.receiptNumber)}`;
  const first = (payment.invoice.customerName || "").trim().split(/\s+/)[0] || "there";
  const from = rt.fromName ? `${rt.fromName} <${rt.fromEmail}>` : rt.fromEmail;
  const res = await sendResendEmail({
    apiKey: rt.apiKey!,
    from,
    to,
    subject: `Payment receipt ${data.receiptNumber} from B2 Consultants`,
    html: `<div style="font-family:Inter,Arial,sans-serif;font-size:14px;color:#16203A;line-height:1.6">
    ${brandEmailHeader()}
    <p>Hi ${first},</p>
    <p>Thank you - we have received your payment of <strong>${data.amountDisplay}</strong> against invoice <strong>${data.invoiceNumber}</strong>. Your receipt <strong>${data.receiptNumber}</strong> is attached.</p>
    <p>Balance outstanding: ${data.settled ? "nil - this invoice is paid in full" : data.balanceDisplay}.</p>
    <p>You can also download it here: <a href="${url}" style="color:#003C8C">${url}</a></p>
    <p>B2 Consultants</p>
  </div>`,
    attachments: [{ filename: `${data.receiptNumber}.pdf`, content: (await renderReceiptPdf(data)).toString("base64") }],
  });
  if (!res.ok) return { ok: false, error: `The email failed (${res.error})` };

  await prisma.invoicePayment.update({ where: { id: paymentId }, data: { receiptSentAt: new Date() } });
  await logActivity(session, {
    action: "payments.receipt.send",
    section: "payments",
    entityType: "InvoicePayment",
    entityId: paymentId,
    summary: `Emailed receipt ${data.receiptNumber} (${data.amountDisplay}) to ${payment.invoice.customerName}`,
    meta: { receiptNumber: data.receiptNumber, invoiceNumber: data.invoiceNumber, to },
  });
  revalidatePath(`/payments/${payment.invoiceId}`);
  return { ok: true, message: `Receipt emailed to ${to}` };
}

/** Estimate → Invoice: copies customer + line items into a new draft invoice, marks the estimate accepted. */
export async function convertEstimate(id: string): Promise<ActionResult> {
  const session = await requireSection("payments");
  const est = await prisma.invoice.findUnique({ where: { id }, include: { items: { orderBy: { position: "asc" } } } });
  if (!est) return { ok: false, error: "Estimate not found" };
  if (est.kind !== "ESTIMATE") return { ok: false, error: "Not an estimate" };

  let converted: Invoice | null = null;
  await prisma.$transaction(async (tx) => {
    converted = await tx.invoice.create({
      data: {
        kind: "INVOICE",
        // A draft like any other: it draws its real number when it is issued.
        number: mintProvisionalNumber(),
        customerAddress: est.customerAddress,
        servicePeriodStart: est.servicePeriodStart,
        servicePeriodEnd: est.servicePeriodEnd,
        agreementRef: est.agreementRef,
        taxNote: est.taxNote,
        publicToken: mintPublicToken(),
        status: "DRAFT",
        leadId: est.leadId,
        customerName: est.customerName,
        customerEmail: est.customerEmail,
        customerPhone: est.customerPhone,
        issueDate: new Date(),
        // The quoted figures carry over EXACTLY, both currencies and the rate they were quoted
        // at: converting an accepted quote at today's rate would bill a different number from
        // the one the customer accepted.
        currency: est.currency,
        subtotalInrMinor: est.subtotalInrMinor,
        subtotalEurMinor: est.subtotalEurMinor,
        discountInrMinor: est.discountInrMinor,
        discountEurMinor: est.discountEurMinor,
        taxPercent: est.taxPercent,
        taxLabel: est.taxLabel,
        taxInrMinor: est.taxInrMinor,
        taxEurMinor: est.taxEurMinor,
        totalInrMinor: est.totalInrMinor,
        totalEurMinor: est.totalEurMinor,
        fxRateUsed: est.fxRateUsed,
        notes: est.notes,
        createdById: session.user.id,
        items: {
          create: est.items.map((it, i) => ({
            description: it.description,
            quantity: it.quantity,
            unitPriceInrMinor: it.unitPriceInrMinor,
            unitPriceEurMinor: it.unitPriceEurMinor,
            levelCode: it.levelCode,
            position: i,
          })),
        },
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
      summary: `Converted estimate ${est.number} into invoice ${row.number} for ${row.customerName} - ${invoiceTotalDisplay(row)}`,
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
