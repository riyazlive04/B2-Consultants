-- Replace `worksSaturdays` with a per-weekday bitmask so each person can be off any
-- day(s) of the week (e.g. Asma off Tuesday, in on Saturday as a comp-off), not just
-- toggled Saturday on/off.
--
-- Mon = bit 0 … Sun = bit 6. Default 63 (0b0111111) = Mon–Sat, which preserves the old
-- `worksSaturdays = true` behaviour exactly. The one historical pattern this column has
-- held - "off Saturdays" - backfills to 31 (0b0011111) = Mon–Fri.
--
-- Hand-written and guarded so a repeat run is a no-op (per the migration policy for this
-- schema; `migrate dev` would otherwise generate a destructive drop-and-re-add).

ALTER TABLE "TeamProfile"
    ADD COLUMN IF NOT EXISTS "workingDaysMask" INTEGER NOT NULL DEFAULT 63;

DO $$ BEGIN
    IF EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'TeamProfile' AND column_name = 'worksSaturdays'
    ) THEN
        -- "Off Saturdays" (false) → Mon–Fri = 31. "Works Saturdays" (true) → keep the
        -- default 63. Nothing else was ever stored in this column.
        UPDATE "TeamProfile" SET "workingDaysMask" = 31 WHERE "worksSaturdays" = false;
        ALTER TABLE "TeamProfile" DROP COLUMN "worksSaturdays";
    END IF;
END $$;
