import "server-only";
import { prisma } from "@/lib/prisma";
import {
  getJournal as getJournalWith,
  getTrialBalance as getTrialBalanceWith,
  verifyAuditChain as verifyAuditChainWith,
} from "./ledger-core";

/**
 * App-facing ledger reads (SPEC §10.4). The engine itself lives in `ledger-core.ts`,
 * which takes a `LedgerDb` so the seed and backfill scripts — which cannot import
 * `server-only` — can reuse the exact same posting rules.
 *
 * Writes are deliberately NOT re-exported: a caller must open a transaction and reach
 * for `postEntry` from ledger-core directly, because the deferred balance trigger only
 * fires at COMMIT.
 */

export {
  LedgerError,
  monthKeyOf,
  postEntry,
  postEntryOnce,
  voidEntry,
  voidEntryForSource,
  appendAudit,
  seedChartOfAccounts,
} from "./ledger-core";
export type { DraftEntry, DraftLine, LedgerDb, TrialBalanceRow, AuditInput } from "./ledger-core";

export const getTrialBalance = (upTo?: Date) => getTrialBalanceWith(prisma, upTo);
export const getJournal = (opts?: { take?: number; skip?: number }) => getJournalWith(prisma, opts);
export const verifyAuditChain = () => verifyAuditChainWith(prisma);
