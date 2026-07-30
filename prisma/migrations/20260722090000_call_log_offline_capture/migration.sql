-- Offline call capture (§ telecaller field work).
--
-- A telecaller on a phone loses signal mid-shift and keeps working. The outcome is queued
-- on the device and posted when the connection returns, so `calledAt` has to hold the
-- DEVICE's clock — the only record of when the call actually happened.
--
-- `syncedAt` is the server's receipt instant, and its NULLability is the whole point:
--   NULL     → logged live, `calledAt` is server-stamped exactly as it always was
--   NOT NULL → arrived after the fact, `calledAt` came from the device
-- Without that distinction a device clock set back an hour would silently manufacture a
-- "connected in 4 minutes" against the L1 desk's 5-minute JD target, with nothing on the
-- row to disprove it later.
--
-- `clientKey` is generated on the device. The UNIQUE index is what makes the sync
-- idempotent: a retry after a half-open connection, a double-tap, or two tabs flushing the
-- same queue all collapse to ONE row rather than inflating the call counts people are
-- reviewed on.
--
-- Additive and non-rewriting: both columns are nullable with no default, so Postgres records
-- metadata only and every existing row keeps its exact current meaning (NULL syncedAt = the
-- live-logged rows they already were). A partial index is unnecessary — UNIQUE in Postgres
-- ignores NULLs, so the ~all-NULL existing rows cost nothing and never collide.
-- Rollback is DROP INDEX + DROP COLUMN ×2.
ALTER TABLE "call_log"
  ADD COLUMN "clientKey" TEXT,
  ADD COLUMN "syncedAt" TIMESTAMP(3);

CREATE UNIQUE INDEX "call_log_clientKey_key" ON "call_log"("clientKey");
