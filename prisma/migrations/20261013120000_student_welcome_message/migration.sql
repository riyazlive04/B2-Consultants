-- The enrolment message. Until now the app had no WhatsAppKind for "you are enrolled": the
-- first automated thing a student heard after signing and paying was a payment reminder.
--
-- Additive and reversible-by-neglect: an enum value nothing sends yet changes no behaviour, and
-- the engine that will send it ships behind `studentWelcomeEnabled`, which defaults to false.
--
-- NOTE ON THE TRANSACTION. Postgres refuses to USE a new enum value in the transaction that
-- added it. Nothing here writes a STUDENT_WELCOME row, so this is safe to run as one statement;
-- if a later migration needs to insert one, it must be a separate migration.
ALTER TYPE "WhatsAppKind" ADD VALUE IF NOT EXISTS 'STUDENT_WELCOME';
