-- Narrow the daily_log append-only guard to admit ONE new transition: an EOD_AUTO row being
-- claimed by its owner (EOD_AUTO -> HUMAN).
--
-- WHY THIS IS NOT A WEAKENING OF PRD2 §6:
-- The rule exists so that numbers A PERSON SUBMITTED can never be quietly rewritten — the
-- original must stay intact, and only Admin may append a correctionNote. An EOD_AUTO row is
-- not that. Nobody submitted it: the EOD job derived it from activity because the member never
-- logged, and auto-capture is partial by construction (followUpMessagesSent and the coach's
-- check-in/assignment fields have no event source at all). There are no human numbers to
-- protect, and those rows feed the Telecaller Pay board — so leaving them frozen would mean
-- paying commission on a machine's incomplete guess with no way to correct it.
--
-- The carve-out is deliberately one-way and tightly bounded:
--   * EOD_AUTO -> HUMAN only. The reverse (HUMAN -> EOD_AUTO) stays forbidden, so a real
--     submission can never be laundered back into an editable state.
--   * userId and date must not move, or "amend my log" would become "rewrite someone else's
--     day" while the source flip smuggled it past the guard.
--   * Once HUMAN, the row is immutable exactly as before. The window is enforced in the
--     service layer (submitDailyLog); this trigger is the floor, not the policy.
-- DELETE remains forbidden for every row, unconditionally.

CREATE OR REPLACE FUNCTION daily_log_guard() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'daily_log is append-only: DELETE is not allowed';
  END IF;

  -- Unchanged path: Admin appending a correction note, originals intact.
  IF (to_jsonb(OLD) - 'correctionNote') IS NOT DISTINCT FROM (to_jsonb(NEW) - 'correctionNote') THEN
    RETURN NEW;
  END IF;

  -- New path: the member completing the EOD job's row and putting their name to it.
  IF OLD."source" = 'EOD_AUTO'
     AND NEW."source" = 'HUMAN'
     AND OLD."userId" = NEW."userId"
     AND OLD."date" = NEW."date" THEN
    RETURN NEW;
  END IF;

  RAISE EXCEPTION 'daily_log is append-only: only correctionNote may be updated, or an EOD_AUTO row claimed by its owner';
END;
$$ LANGUAGE plpgsql;
