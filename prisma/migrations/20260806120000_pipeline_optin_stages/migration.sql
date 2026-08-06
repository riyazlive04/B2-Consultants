-- Two new lifecycle stages, isolated in their own migration for the same reason as
-- 20260704120000_bucket1_enums: Postgres requires a new enum value to be COMMITTED before any
-- later migration (or data statement) can reference it.
--
-- These give the board its first three columns a stage of their own, so the SOP's early funnel
-- is visible on the board instead of being folded into "Pre-Qualified & Confirmed":
--   Fresh Optins          -> NEW_LEAD           (already existed; it just had no column)
--   WhatsApp Sent         -> WHATSAPP_SENT      (new)
--   Strategy Call Booked  -> STRATEGY_CALL_BOOKED (new)
ALTER TYPE "LeadStage" ADD VALUE 'WHATSAPP_SENT';
ALTER TYPE "LeadStage" ADD VALUE 'STRATEGY_CALL_BOOKED';
