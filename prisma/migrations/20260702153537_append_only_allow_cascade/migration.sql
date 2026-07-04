-- Append-only refinement: audit rows stay immutable against DIRECT update/delete,
-- but a cascade from deleting the parent entity (Admin's PRD right to delete a lead /
-- enrollment / user) is allowed — the audit protects against tampering, not against
-- removing an entity together with its coherent history.
--
-- pg_trigger_depth() = 1 for a direct statement; > 1 when fired from a foreign-key
-- cascade (an internal RI trigger), so the guard only blocks depth 1.

CREATE OR REPLACE FUNCTION forbid_mutation() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' AND pg_trigger_depth() > 1 THEN
    RETURN OLD; -- cascaded delete of the parent entity
  END IF;
  RAISE EXCEPTION 'Table % is append-only: % is not allowed', TG_TABLE_NAME, TG_OP;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION daily_log_guard() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF pg_trigger_depth() > 1 THEN
      RETURN OLD; -- cascaded from user deletion
    END IF;
    RAISE EXCEPTION 'daily_log is append-only: DELETE is not allowed';
  END IF;
  IF (to_jsonb(OLD) - 'correctionNote') IS DISTINCT FROM (to_jsonb(NEW) - 'correctionNote') THEN
    RAISE EXCEPTION 'daily_log is append-only: only correctionNote may be updated';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
