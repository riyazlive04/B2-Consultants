import "server-only";
import type { Prisma } from "@prisma/client";

/**
 * IMP-0001 - the reference a report is known by.
 *
 * ── Why a counter and not the cuid ──────────────────────────────────────────────────────
 * The id is the record; the ref is what a person says out loud. "IMP-14 is fixed" is a sentence
 * somebody can type into WhatsApp; `cmh2k9x0a0001qn3f8g7h2jkl` is not. Unique, so that sentence
 * always means one report.
 *
 * ── Why this does not call nextDocumentNumber() ─────────────────────────────────────────
 * It is the same four lines of SQL against the same `document_sequence` table, deliberately not
 * routed through `server/document-numbers.ts`. That function is typed on `DocumentPrefix`, which
 * comes from `lib/invoice-compliance.ts` - the §14 UStG module, with its own test suite, its own
 * 9,999-per-year cap and a year-scoped `INV-260007` format. Widening its prefix union to admit a
 * bug report would reach into the compliance layer to buy nothing: improvement refs are not year-scoped,
 * have no legal format, and must not inherit a cap that throws when the series fills.
 *
 * The TABLE is generic (`key`, `last`) and shared on purpose - one row-locked counter mechanism,
 * two series, no second table and no max()+1 race.
 *
 * MUST run inside the transaction that writes the report, like its invoice counterpart: Postgres
 * row-locks the counter for the rest of the transaction, so concurrent reporters queue instead of
 * drawing the same number, and a rolled-back report takes its increment with it.
 */

const SEQUENCE_KEY = "IMP";

/** Four digits, zero-padded, and simply wider past 9,999 - there is no format to break. */
export async function nextImprovementRef(tx: Prisma.TransactionClient): Promise<string> {
  const rows = await tx.$queryRaw<{ last: number }[]>`
    INSERT INTO "document_sequence" ("key", "last", "updatedAt")
    VALUES (${SEQUENCE_KEY}, 1, now())
    ON CONFLICT ("key") DO UPDATE
      SET "last" = "document_sequence"."last" + 1, "updatedAt" = now()
    RETURNING "last"`;
  return improvementRef(Number(rows[0].last));
}

/** Pure, so the format is testable without a database. */
export function improvementRef(seq: number): string {
  return `IMP-${String(seq).padStart(4, "0")}`;
}
