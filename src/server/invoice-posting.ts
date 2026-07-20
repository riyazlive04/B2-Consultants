import "server-only";
import { prisma } from "@/lib/prisma";
import { istToday } from "@/lib/dates";
import { postEntryOnce, voidEntryForSource } from "./ledger";
import { invoiceIssuanceEntryDraft } from "./finance-posting";
import { getFinancePostingConfig } from "./founder-config";

/**
 * Invoice-issuance ledger posting (audit §C #22).
 *
 * finance-posting.paymentEntryDraft only ever CREDITS Accounts receivable (1100) — cash came in
 * against an invoice — so with no matching issuance debit, AR is one-sided and drifts negative
 * over time. This posts the missing half: Dr AR / Cr Income when an invoice is issued.
 *
 * OFF by default: gated on financePosting.invoiceIssuancePosting.enabled, because it writes to the
 * real double-entry ledger. When off, this is a no-op and the books behave exactly as before.
 *
 * NOT a "use server" module: an internal server-only helper the payment/status actions call after
 * they've authenticated. Idempotent and best-effort — a posting hiccup must never undo the invoice
 * write that triggered it. Idempotency + concurrency-safety come from postEntryOnce /
 * voidEntryForSource keyed on (sourceType "INVOICE", sourceId = invoice.id), the same
 * one-live-entry-per-source guard the rest of the ledger uses.
 */

/** An invoice is "recognised" (revenue + receivable booked) once it leaves DRAFT and isn't VOID. */
const RECOGNISED = new Set(["SENT", "PARTIAL", "PAID", "OVERDUE"]);

/**
 * Reconcile the ledger to an invoice's current state:
 *   recognised + no live entry → post Dr AR / Cr Income (once)
 *   not recognised + a live entry → void it (invoice went back to DRAFT, or was voided)
 */
export async function syncInvoiceIssuance(invoiceId: string, actorId?: string | null): Promise<void> {
  const cfg = await getFinancePostingConfig();
  if (!cfg.invoiceIssuancePosting.enabled) return;

  try {
    await prisma.$transaction(async (tx) => {
      const inv = await tx.invoice.findUnique({
        where: { id: invoiceId },
        select: {
          id: true,
          kind: true,
          status: true,
          number: true,
          customerName: true,
          issueDate: true,
          totalInrMinor: true,
          deletedAt: true,
          lead: { select: { wonLevel: true } },
        },
      });
      // Estimates never post; a zero-total invoice has nothing to book.
      if (!inv || inv.kind !== "INVOICE") return;

      const recognised = !inv.deletedAt && RECOGNISED.has(inv.status) && inv.totalInrMinor > 0n;

      if (recognised) {
        const draft = invoiceIssuanceEntryDraft({
          id: inv.id,
          issueDate: inv.issueDate,
          totalInrMinor: inv.totalInrMinor,
          number: inv.number,
          customerName: inv.customerName,
          programLevel: inv.lead?.wonLevel ?? null,
          issuedById: actorId ?? null,
        });
        await postEntryOnce(tx, { ...draft, sourceId: inv.id });
      } else {
        await voidEntryForSource(tx, "INVOICE", inv.id, {
          reason: "invoice is no longer issued",
          actorId: actorId ?? null,
          on: istToday(),
        });
      }
    });
  } catch {
    // best-effort: the invoice write already succeeded and must not be undone by a posting hiccup
  }
}

/**
 * Backfill issuance postings for every already-issued invoice that predates this feature (or that
 * was issued while the flag was off). Run from the daily cron; postEntryOnce makes each call a
 * no-op once its entry exists, so this is safe to run on every tick.
 */
export async function backfillInvoiceIssuance(limit = 500): Promise<{ enabled: boolean; posted: number; scanned: number }> {
  const cfg = await getFinancePostingConfig();
  if (!cfg.invoiceIssuancePosting.enabled) return { enabled: false, posted: 0, scanned: 0 };

  const invoices = await prisma.invoice.findMany({
    where: { kind: "INVOICE", deletedAt: null, status: { in: ["SENT", "PARTIAL", "PAID", "OVERDUE"] }, totalInrMinor: { gt: 0 } },
    select: { id: true },
    take: limit,
  });

  let posted = 0;
  for (const inv of invoices) {
    const before = await prisma.journalEntry.findFirst({
      where: { sourceType: "INVOICE", sourceId: inv.id, status: "POSTED" },
      select: { id: true },
    });
    if (before) continue;
    await syncInvoiceIssuance(inv.id, null);
    const after = await prisma.journalEntry.findFirst({
      where: { sourceType: "INVOICE", sourceId: inv.id, status: "POSTED" },
      select: { id: true },
    });
    if (after) posted++;
  }
  return { enabled: true, posted, scanned: invoices.length };
}
