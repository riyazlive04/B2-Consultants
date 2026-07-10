-- A signal can be cleared back to "not set"; the append-only audit trail must
-- record that transition too, so newSignal becomes nullable (null = cleared).
ALTER TABLE "signal_change_log" ALTER COLUMN "newSignal" DROP NOT NULL;
