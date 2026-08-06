/**
 * Point a form's submissions at a pipeline stage, so a capture becomes an OPPORTUNITY on the
 * board and not just a contact.
 *
 * `submitPublicForm` already does three of the four things a new enquiry needs: it upserts the
 * contact through the same idempotent lead-intake the webhooks use, stamps `stage: NEW_LEAD`, and
 * calls `pickFirstCaller()` so the lead lands on someone's My Desk under the configured split.
 * The fourth — creating the Opportunity — is opt-in per form (`settings.createOpportunity`), and
 * a form created before anyone thought about the board simply does not have it set.
 *
 *   npm run wire:pipeline -- --form=free-consultation --stage="New Lead" --dry-run --force
 *
 * Options
 *   --form=<slug>        REQUIRED
 *   --pipeline=<name>    default: the only pipeline, if there is exactly one
 *   --stage=<name>       default "New Lead"
 *   --value=<amount>     opening opportunity value in rupees; default 0 (unknown, not zero-worth)
 *   --off                stop creating opportunities from this form
 *   --dry-run / --force
 */

import { PrismaClient } from "@prisma/client";
import { normaliseSettings } from "@/lib/sites-types";

const prisma = new PrismaClient();

const arg = (name: string, fallback = ""): string => {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : fallback;
};
const flag = (name: string) => process.argv.includes(`--${name}`);

async function main() {
  const url = process.env.DATABASE_URL ?? "";
  if (!/@(localhost|127\.0\.0\.1)[:/]/.test(url) && !flag("force")) {
    throw new Error(`DATABASE_URL is not local (${url.replace(/:[^:@]*@/, ":***@")}). Pass --force to edit it on purpose.`);
  }
  const slug = arg("form");
  if (!slug) throw new Error("Pass --form=<slug>.");

  const form = await prisma.form.findUnique({ where: { slug }, select: { id: true, name: true, settings: true } });
  if (!form) throw new Error(`No form with slug "${slug}".`);
  const settings = normaliseSettings(form.settings);

  let next = { ...settings };
  if (flag("off")) {
    next = { ...next, createOpportunity: false };
  } else {
    const pipelines = await prisma.pipeline.findMany({
      select: { id: true, name: true, stages: { select: { id: true, name: true }, orderBy: { position: "asc" } } },
    });
    const wantedPipeline = arg("pipeline");
    const pipeline = wantedPipeline
      ? pipelines.find((p) => p.name.toLowerCase() === wantedPipeline.toLowerCase())
      : pipelines.length === 1
        ? pipelines[0]
        : undefined;
    if (!pipeline) {
      throw new Error(`Name the pipeline with --pipeline=. Available: ${pipelines.map((p) => p.name).join(", ")}`);
    }
    const wantedStage = arg("stage", "New Lead");
    const stage = pipeline.stages.find((s) => s.name.toLowerCase() === wantedStage.toLowerCase());
    if (!stage) {
      throw new Error(`No stage "${wantedStage}" on ${pipeline.name}. Stages: ${pipeline.stages.map((s) => s.name).join(" | ")}`);
    }
    next = {
      ...next,
      createOpportunity: true,
      pipelineId: pipeline.id,
      stageId: stage.id,
      // Left blank unless asked for. An opening value invented here would flow straight into the
      // pipeline's forecast, and a made-up forecast is worse than an empty one.
      opportunityValueInr: arg("value") || next.opportunityValueInr,
    };
    console.log(`Pipeline: ${pipeline.name} → stage "${stage.name}"`);
  }

  const before = JSON.stringify({ createOpportunity: settings.createOpportunity ?? false, pipelineId: settings.pipelineId, stageId: settings.stageId });
  const after = JSON.stringify({ createOpportunity: next.createOpportunity, pipelineId: next.pipelineId, stageId: next.stageId });
  console.log(`Form: ${form.name}`);
  console.log(`  before: ${before}`);
  console.log(`  after:  ${after}`);

  if (before === after) return console.log("\nNothing to change.");
  if (flag("dry-run")) return console.log("\nDry run — nothing written.");

  await prisma.form.update({ where: { id: form.id }, data: { settings: next as unknown as object } });
  console.log("\nSaved.");
}

main().catch((e) => { console.error(`\n${e.message}`); process.exitCode = 1; }).finally(() => prisma.$disconnect());
