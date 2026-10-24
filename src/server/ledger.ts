import "server-only";

/**
 * The app-facing door onto the ledger engine, which lives in `ledger-core.ts` - that one takes a
 * `LedgerDb` so the seed and backfill scripts, which cannot import `server-only`, reuse the exact
 * same posting rules.
 *
 * Writes are deliberately NOT re-exported: a caller must open a transaction and reach for
 * `postEntry` from ledger-core directly, because the deferred balance trigger only fires at
 * COMMIT.
 *
 * ── THE READS ARE GONE, THE ENGINE IS NOT (23/10/2026) ──────────────────────────────────
 * This file also exported `getJournal`, `getTrialBalance` and `verifyAuditChain` - the three
 * reads behind `/ledger`. That page was removed at the founder's instruction, so the wrappers
 * went with it; everything below is the POSTING engine, and it is load-bearing for the whole of
 * Finance. Five modules import from here - finance-actions, finance-autopost, commission-actions,
 * equity-actions, invoice-posting and payments-actions - so every rupee the app records still
 * posts through this module exactly as before.
 *
 * What is lost is the ability to READ the journal, the trial balance or the hash-chain
 * verification from inside the product. The capability itself is not deleted:
 * `getTrialBalance`, `getJournal` and `verifyAuditChain` all still exist in `ledger-core.ts` and
 * take a `LedgerDb`, so a script or a future screen can call them without any new code. That is
 * deliberate - double-entry books that cannot be inspected are a bad place to be, and this keeps
 * the door closed rather than bricked up.
 */

export {
  LedgerError,
  monthKeyOf,
  isPeriodLocked,
  postEntry,
  postEntryOnce,
  voidEntry,
  voidEntryForSource,
  restatedDate,
  appendAudit,
  seedChartOfAccounts,
} from "./ledger-core";
export type { DraftEntry, DraftLine, LedgerDb, TrialBalanceRow, AuditInput, VoidResult } from "./ledger-core";
