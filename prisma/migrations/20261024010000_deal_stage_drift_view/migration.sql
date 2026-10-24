-- M3 · A view that reports deals whose board column disagrees with their stage.
--
-- Approved by the founder on 24/10/2026 ("yes add a built-in check flags").
--
-- Stores nothing, adds no column, and reverts by being dropped. Measured on live the same day:
-- 8 cards on the default board, 0 disagreeing - so this is insurance, not a repair.
--
-- WHY A VIEW AND NOT A CONSTRAINT. `Lead.stage` and `Opportunity.stageId` are two records of one
-- deal, reconciled in application code. They legitimately disagree for a moment mid-transaction,
-- and custom pipelines are deliberately not synced at all - so a hard constraint would refuse
-- writes the product intends.
--
-- The code-level fix already shipped: `writeLeadStage` does the column, the history row and the
-- board move in one place, and a test fails if a new site forgets. What that cannot do is see
-- rows that drifted BEFORE it existed, or drift introduced outside the application. This can.

CREATE OR REPLACE VIEW "deal_stage_drift" AS
SELECT
  l.id              AS lead_id,
  l.name            AS lead_name,
  l.stage           AS lead_stage,
  ps."legacyStage"  AS board_stage,
  o.id              AS opportunity_id,
  o."updatedAt"     AS card_updated_at
FROM "lead" l
JOIN "opportunity" o
  ON o."leadId" = l.id
 AND o."deletedAt" IS NULL
JOIN "pipeline_stage" ps
  ON ps.id = o."stageId"
JOIN "pipeline" p
  ON p.id = ps."pipelineId"
 -- The DEFAULT board only. A custom pipeline is a separate process and is not kept in step with
 -- `Lead.stage` by design, so including it would report drift that is not drift.
 AND p."isDefault" = true
 AND p."deletedAt" IS NULL
WHERE l."deletedAt" IS NULL
  -- IS DISTINCT FROM, not <>: `legacyStage` is nullable, and a NULL column is drift too.
  AND ps."legacyStage" IS DISTINCT FROM l.stage;

COMMENT ON VIEW "deal_stage_drift" IS
  'One deal has two status fields (Lead.stage, Opportunity.stageId) reconciled in application code. Rows here are deals where the two disagree on the default board. Expected to be empty; a non-empty result means a stage was written without moving the card.';
