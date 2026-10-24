-- M3 · A view that reports deals whose board column disagrees with their stage (P4)
--
-- NOT APPLIED. See docs/refactor/migrations/README.md.
--
-- Stores nothing, adds no column, and reverts by being dropped. Measured on live 23 Oct 2026:
-- 8 cards on the default board, 0 disagreeing - so this is insurance, not a repair.
--
-- ── Why a view and not a CHECK constraint ──────────────────────────────────────────────
-- The two legitimately disagree for a moment mid-transaction, and custom pipelines are
-- deliberately not synced at all (they are separate processes, not the funnel). A hard constraint
-- would refuse writes the product intends.
--
-- The code-level fix is already shipped: `writeLeadStage` in server/lead-stage-auto.ts does the
-- column, the history row and the board move in one place, and lead-stage-writers.test.ts fails
-- if a new site forgets. What that cannot do is see rows that drifted BEFORE it existed, or drift
-- introduced outside the application. This can.

-- ─────────────────────────────── UP ───────────────────────────────
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
 -- The DEFAULT board only. A custom pipeline is a different process and is not kept in step
 -- with `Lead.stage` by design, so including it would report drift that is not drift.
 AND p."isDefault" = true
 AND p."deletedAt" IS NULL
WHERE l."deletedAt" IS NULL
  -- IS DISTINCT FROM, not <>: `legacyStage` is nullable, and a NULL column is drift too.
  AND ps."legacyStage" IS DISTINCT FROM l.stage;

COMMENT ON VIEW "deal_stage_drift" IS
  'P4: one deal has two status fields (Lead.stage, Opportunity.stageId) reconciled in application code. Rows here are deals where the two disagree on the default board. Expected to be empty; a non-empty result means a stage was written without moving the card.';

-- ────────────────────────────── DOWN ──────────────────────────────
-- DROP VIEW "deal_stage_drift";

-- ──────────────────── Check before and after applying ────────────────────
-- SELECT count(*) FROM "deal_stage_drift";
-- SELECT * FROM "deal_stage_drift" ORDER BY card_updated_at DESC LIMIT 20;
--
-- `npm run migration:audit` runs the same comparison through Prisma, so it can be checked
-- without the view existing.

-- ──────────────────────────── Then in code ────────────────────────────
-- One row on Console → System → Not armed, so this is a number somebody SEES rather than a query
-- somebody remembers. Read it with `prisma.$queryRaw` and treat a missing view as "not set up"
-- rather than an error - the app must not fail because an optional view has not been created.
--
-- If it is ever non-empty, the honest default is that the BOARD is wrong: `Lead.stage` is what
-- `LeadStageHistory` records, and the history is what every stage metric reads.
