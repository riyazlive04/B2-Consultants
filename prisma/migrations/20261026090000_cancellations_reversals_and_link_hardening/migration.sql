-- ════════════════════════════════════════════════════════════════════════════════════════════
--  CANCELLED CLASSES · REVERSED PAYMENTS · WRITTEN-OFF RECEIVABLES · HARDENED INVOICE LINKS
--  Issues C1, C2, C3 and B5 from the 26 Oct 2026 wireflow audit.
-- ════════════════════════════════════════════════════════════════════════════════════════════
--
-- ── WRITTEN BY HAND, AND WHY THAT MATTERS HERE ──────────────────────────────────────────────
-- Two of the four changes touch an enum (`SessionStatus` is new, `PendingPaymentStatus` gains a
-- value), and in this repo `prisma migrate dev` reaches for a DESTRUCTIVE drop-and-re-add on an
-- enum change - it drops the type, which cascades to every column using it, and re-adds it. That
-- is how `payment_type` nearly lost its data (see `20260919…_configurable_payment_types`). So
-- both enum changes below are `CREATE TYPE` / `ALTER TYPE … ADD VALUE`, which Postgres performs
-- in place and which cannot lose a row.
--
-- ── EVERY CHANGE IS ADDITIVE, WITH ONE EXCEPTION THAT IS CALLED OUT ─────────────────────────
-- Nothing is dropped and nothing is rewritten, so every row reads back exactly as it does now:
--   · new columns are all NULLable or carry a DEFAULT that matches today's behaviour
--   · `SCHEDULED` is the default session status, which is what every existing class already is
--   · `dunning_cycle`/`cycle` default to 0, so every ladder already climbed stays climbed
-- The exception is the `dunning_event` unique key, which is DROPPED and re-created wider. That
-- is the whole point of C1 and it only ever ADMITS rows that were previously rejected - see the
-- block above it.
--
-- ── WHAT THIS MIGRATION DELIBERATELY DOES NOT DO ────────────────────────────────────────────
-- It does not back-fill, restate or recompute anything. In particular it does not go looking for
-- payments that have already been archived-instead-of-reversed: which of those were genuine
-- reversals is a question only the founder can answer, row by row, and guessing would move money
-- in the ledger on the strength of an inference. The new fields describe events from here on.

-- ════════════════════════════════════════════════════════════════════════════════════════════
-- 1 · C3 - A CLASS CAN BE CANCELLED
-- ════════════════════════════════════════════════════════════════════════════════════════════
--
-- `class_session` had no status at all, so a class could only be re-timed or deleted - and
-- `deleteBatchSession` refuses deletion once a register exists. Between those two, the common
-- real event had nowhere to go: a class called off AFTER the window was opened is undeletable
-- and unmarkable, so the students who had not checked in sit unmarked for a class that never
-- happened, and the cohort's attendance rate drops for it.
--
-- POSTPONED is a separate value rather than a flavour of CANCELLED because "not happening" and
-- "happening, date to follow" are different sentences to a student, and only one of them should
-- stop them waiting.

-- CreateEnum
CREATE TYPE "SessionStatus" AS ENUM ('SCHEDULED', 'CANCELLED', 'POSTPONED');

-- AlterTable
ALTER TABLE "class_session"
  ADD COLUMN "status"        "SessionStatus" NOT NULL DEFAULT 'SCHEDULED',
  ADD COLUMN "cancelReason"  TEXT,
  ADD COLUMN "cancelledAt"   TIMESTAMP(3),
  ADD COLUMN "cancelledById" TEXT;

-- AddForeignKey
--
-- SET NULL, like `attendanceOpenedById` and `attendancePublishedById` beside it: removing a
-- tutor's login must orphan the attribution, never delete the class or the reason it was called
-- off.
ALTER TABLE "class_session" ADD CONSTRAINT "class_session_cancelledById_fkey"
  FOREIGN KEY ("cancelledById") REFERENCES "user"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- CreateIndex
--
-- Every timetable, register and student page now filters to SCHEDULED, and does it alongside the
-- `batchId` it already filters on - so the pair is what keeps those reads an index hit. A lone
-- `status` index would be useless: almost every row is SCHEDULED.
CREATE INDEX "class_session_batchId_status_idx" ON "class_session"("batchId", "status");

-- ════════════════════════════════════════════════════════════════════════════════════════════
-- 2 · C1 - A REVERSED PAYMENT RE-OPENS THE CHASE LADDER
-- ════════════════════════════════════════════════════════════════════════════════════════════
--
-- `stageFor` fires each rung ONCE, ever, reading the stages already sent from `dunning_event`.
-- Correct for a chase ladder, and fatal in an app with no payment processor, where every payment
-- is a human recording a claim about a bank:
--
--   chased → FINAL sent → student pays → settled → the payment REVERSES → finance corrects it →
--   the instalment is open again → `stageFor` returns NULL for every stage, for ever.
--
-- The instalment then sits permanently un-chased and appears on no list.
--
-- A CYCLE is one pass up the ladder. Reversing a settlement bumps the instalment's cycle, and
-- the ladder is only ever shown the events of the current one - so all three rungs are available
-- again while the old cycle's rows stay exactly where they are. Append-only trail preserved;
-- "what did we send this student, and when" still answerable; the silence gone.

-- AlterTable
ALTER TABLE "instalment" ADD COLUMN "dunningCycle" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "dunning_event" ADD COLUMN "cycle" INTEGER NOT NULL DEFAULT 0;

-- DropIndex / CreateIndex
--
-- THE ONE NON-ADDITIVE CHANGE IN THIS FILE, and it only ever admits rows the old key rejected.
-- `(instalmentId, stage)` is exactly what made a reversal unchaseable: a second UPCOMING could
-- not be written even once the ladder wanted one. Widening it to include the cycle keeps the
-- guarantee that matters - one row per rung per pass, so a cron that ticks twice in a minute
-- still cannot double-send - while letting a NEW pass send its own UPCOMING.
--
-- Every existing row is cycle 0, so no row can collide on the new key that did not collide on
-- the old one: the drop and re-create cannot fail on live data.
DROP INDEX IF EXISTS "dunning_event_instalmentId_stage_key";
CREATE UNIQUE INDEX "dunning_event_instalmentId_stage_cycle_key"
  ON "dunning_event"("instalmentId", "stage", "cycle");

-- ════════════════════════════════════════════════════════════════════════════════════════════
-- 3 · C2 - A PAYMENT THAT DID NOT CLEAR, AND A RECEIVABLE NOBODY WILL COLLECT
-- ════════════════════════════════════════════════════════════════════════════════════════════
--
-- The money model had no failure states. `PendingPaymentStatus` was ACTIVE | PAID_IN_FULL |
-- OVERDUE | DROPPED and `InvoiceStatus` has no FAILED or REVERSED, so:
--
--   · a failed payment was modelled as the ABSENCE of an income row, indistinguishable from a
--     payment never attempted - and the correction was an edit or an archive, which destroys the
--     fact that money appeared to arrive and then did not, after the ledger, revenue recognition,
--     commission accrual and the runway had all already read it;
--   · a genuinely uncollectable plan sat as OVERDUE for ever, inflating the receivables figure on
--     the founder's wall and the runway that reads it.
--
-- `income.reversedAt` is deliberately a SEPARATE field from `deletedAt`, not a reuse of it.
-- Archiving says "this row should not have been entered". Reversing says "it was entered
-- correctly and the money went away again". Only the second is a fact about the bank, and only
-- the second should bump `instalment.dunningCycle`.
--
-- WRITTEN_OFF is likewise distinct from DROPPED, and conflating them would undo §8 of the
-- agreement. DROPPED is about the STUDENT - they left, and they still owe what they signed for.
-- WRITTEN_OFF is about the MONEY, and only the founder may say it.

-- AlterTable
ALTER TABLE "income"
  ADD COLUMN "reversedAt"     TIMESTAMP(3),
  ADD COLUMN "reversedReason" TEXT,
  ADD COLUMN "reversedById"   TEXT;

-- AddForeignKey
ALTER TABLE "income" ADD CONSTRAINT "income_reversedById_fkey"
  FOREIGN KEY ("reversedById") REFERENCES "user"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- CreateIndex
--
-- Every money read now filters on this exactly as it filters on `deletedAt` - a reversed payment
-- must never be summed - so it is indexed for the same reason that one is.
CREATE INDEX "income_reversedAt_idx" ON "income"("reversedAt");

-- AlterEnum
--
-- ADD VALUE, in place. NOT the drop-and-re-add `migrate dev` would generate: `pending_payment`,
-- and the receivables panel that reads it, would not survive the type being dropped.
ALTER TYPE "PendingPaymentStatus" ADD VALUE 'WRITTEN_OFF';

-- ════════════════════════════════════════════════════════════════════════════════════════════
-- 4 · B5 - THE INVOICE PUBLIC LINK GETS AN EXPIRY AND A KILL SWITCH
-- ════════════════════════════════════════════════════════════════════════════════════════════
--
-- `/i/<publicToken>` shows the customer's name, postal address, email, phone, the amount, the
-- service period and the agreement reference, and the token is the whole credential. It was
-- `DEFAULT cuid()` - out of step with every other public token in this codebase, in the wrong
-- direction:
--
--   invite     randomBytes(32) · SHA-256 at rest · 7-day TTL  · single use
--   agreement  randomBytes(32) · SHA-256 at rest · ≤90-day TTL · voidable
--   invoice    cuid()          · plaintext       · NO TTL      · NOT revocable
--
-- A cuid embeds a timestamp and a monotonic counter, so two issued near each other are
-- structurally related - a far weaker guess target than 256 random bits.
--
-- ── Two deliberate decisions in this block ──────────────────────────────────────────────────
-- The DEFAULT is dropped rather than changed, so the database can never quietly hand out a cuid
-- again; `lib/invoice-token.ts` mints every new one and the application is the only source.
--
-- Existing tokens are NOT rotated. Rotating them would break every invoice link already sitting
-- in a customer's inbox - silently, and for people who have done nothing wrong - to retro-fit
-- entropy to a document that has usually already been paid. Instead the admin screen gains a
-- "regenerate link" action, so a weak token can be replaced deliberately on the rows that still
-- matter. Stated plainly: rows issued before today keep their cuid until somebody rotates them.

-- AlterTable
ALTER TABLE "invoice" ALTER COLUMN "publicToken" DROP DEFAULT;
ALTER TABLE "invoice"
  ADD COLUMN "publicTokenExpiresAt" TIMESTAMP(3),
  ADD COLUMN "publicTokenRevokedAt" TIMESTAMP(3);

-- ════════════════════════════════════════════════════════════════════════════════════════════
-- 5 · C4 - A PASSWORD-RESET CODE CAN GO TO THE WHATSAPP NUMBER
-- ════════════════════════════════════════════════════════════════════════════════════════════
--
-- Credentials go out on BOTH channels (`sendLoginCredentials` emails and WhatsApps them, because
-- for this user base WhatsApp is the one that is read). Resetting them goes out on ONE:
-- `sendResetPassword` is a direct Resend call and nothing else.
--
-- That is backwards for a student body onboarded over WhatsApp, and it is worse than an
-- inconvenience because `/forgot-password` must answer generically for an unknown address (it
-- must not be an enumeration oracle). So a student whose email was mistyped at intake is told "a
-- reset link is on its way", nothing arrives, and there is no second route and nothing to try.
--
-- Its own touchpoint rather than a reuse of AGREEMENT_OTP: one WATI template is bound per kind,
-- and that one's approved text says "agreement signing code" - somebody resetting a password
-- would be sent a sentence about a contract.
--
-- ADD VALUE, in place. Not the drop-and-re-add `migrate dev` reaches for: `whatsapp_message` has
-- every outbound message this app has ever sent keyed on this type.
ALTER TYPE "WhatsAppKind" ADD VALUE 'PASSWORD_RESET_OTP';
