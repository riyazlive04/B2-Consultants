import "server-only";
import { randomBytes } from "crypto";
import type { Prisma } from "@prisma/client";
import type { InvoiceSettings } from "@/lib/config-schema";
import { asInvoiceCurrency } from "@/lib/invoice-money";
import {
  documentNumber,
  invoiceIssueGaps,
  issueBlockedMessage,
  provisionalNumber,
  sequenceKey,
  type DocumentPrefix,
} from "@/lib/invoice-compliance";

/**
 * Drawing document numbers, and issuing an invoice - the database half of
 * `lib/invoice-compliance`.
 *
 * The old `nextNumber` read EVERY invoice number and took the max + 1. Two people saving at the
 * same moment drew the same number and one of them hit the unique constraint; a purged invoice
 * that happened to hold the max gave its number back to be reused. One counter row per series is
 * incremented with a single upsert - Postgres row-locks it for the rest of the transaction, so
 * concurrent callers queue, and a transaction that rolls back takes its increment with it.
 */

type Tx = Prisma.TransactionClient;

/** The next number in `prefix`'s series for `year`. MUST run inside the transaction that uses it. */
export async function nextDocumentNumber(tx: Tx, prefix: DocumentPrefix, year: number): Promise<string> {
  const key = sequenceKey(prefix, year);
  const rows = await tx.$queryRaw<{ last: number }[]>`
    INSERT INTO "document_sequence" ("key", "last", "updatedAt")
    VALUES (${key}, 1, now())
    ON CONFLICT ("key") DO UPDATE
      SET "last" = "document_sequence"."last" + 1, "updatedAt" = now()
    RETURNING "last"`;
  return documentNumber(prefix, year, Number(rows[0].last));
}

/** A draft's placeholder reference - random, so drafting never touches the series. */
export function mintProvisionalNumber(): string {
  return provisionalNumber(randomBytes(5).toString("hex").toUpperCase());
}

/** Thrown when an invoice is missing something the law requires on it; the message lists what. */
export class InvoiceNotIssuable extends Error {}

/**
 * Issue an invoice: check it carries everything §14 UStG asks for, then give it its real number.
 *
 * Idempotent - an invoice already issued (or an estimate, which is never "issued") comes straight
 * back with the number it has. The year in the number is the year of its printed issue date.
 *
 * A 0% invoice with no tax note of its own takes the Console's note for its currency, AT ISSUE,
 * and keeps it: setting the note once in the Console makes every waiting draft issuable, and
 * changing it later rewrites nothing already sent.
 *
 * The `issuedAt: null` guard on the write is what makes two simultaneous issues of the same draft
 * safe: the loser updates nothing, throws, and its transaction rolls back the number it drew.
 */
export async function issueInvoice(
  tx: Tx,
  id: string,
  settings: InvoiceSettings,
): Promise<{ number: string; issuedNow: boolean }> {
  const inv = await tx.invoice.findUnique({
    where: { id },
    select: {
      kind: true, number: true, issuedAt: true, deletedAt: true, issueDate: true, currency: true,
      customerName: true, customerAddress: true, servicePeriodStart: true,
      taxPercent: true, taxNote: true,
    },
  });
  if (!inv) throw new InvoiceNotIssuable("Invoice not found.");
  if (inv.kind !== "INVOICE" || inv.issuedAt) return { number: inv.number, issuedNow: false };
  if (inv.deletedAt) throw new InvoiceNotIssuable("This invoice is archived - restore it before issuing it.");

  const taxPercent = Number(inv.taxPercent);
  const taxNote =
    inv.taxNote?.trim() ||
    (taxPercent > 0 ? null : settings.tax[asInvoiceCurrency(inv.currency)].note.trim() || null);

  const gaps = invoiceIssueGaps({
    issuer: settings.issuer,
    customerName: inv.customerName,
    customerAddress: inv.customerAddress,
    servicePeriodStart: inv.servicePeriodStart,
    taxPercent,
    taxNote,
  });
  if (gaps.length) throw new InvoiceNotIssuable(issueBlockedMessage(gaps));

  const number = await nextDocumentNumber(tx, "INV", inv.issueDate.getUTCFullYear());
  const won = await tx.invoice.updateMany({
    where: { id, issuedAt: null },
    data: { number, issuedAt: new Date(), taxNote },
  });
  if (won.count === 0) throw new InvoiceNotIssuable("This invoice was issued by someone else just now - refresh.");
  return { number, issuedNow: true };
}
