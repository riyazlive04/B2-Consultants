-- Synamate board parity: the live pipeline ends in TWO won columns ("Split Pay" / "Full pay")
-- where this schema has one WON stage plus Lead.paymentPlan. Both columns carry legacyStage WON,
-- so this is what tells them apart — see src/lib/pipeline-stages.ts.
-- Nullable and unset: every existing column keeps its current behaviour.
-- AlterTable
ALTER TABLE "pipeline_stage" ADD COLUMN     "paymentPlan" "PaymentPlan";
