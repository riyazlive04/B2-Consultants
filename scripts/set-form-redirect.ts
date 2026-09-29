/**
 * Point the landing-page opt-in form's "Watch now →" button at the next funnel step.
 *
 * The form had no `redirectUrl`, so `submitPublicForm` returned none and `PublicForm` fell through
 * to its inline success message - the prospect opted in and stayed on the landing page, never
 * reaching the VSL they had just asked to watch.
 *
 * A ROOT-RELATIVE path on purpose: `window.location.href = "/p/..."` resolves against the current
 * origin, so the same value works on localhost and on the live domain. See `sitePathSchema` in
 * forms-actions.ts for why the plain `url` rule cannot hold this.
 *
 * Idempotent. Run:  npx tsx scripts/set-form-redirect.ts --force
 */
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

const FORM_SLUG = "free-consultation";
const TARGET = "/p/vsl-funnel/vsl";

if (!process.argv.includes("--force")) {
  console.error("Refusing to run without --force (this writes to whatever DATABASE_URL points at).");
  process.exit(1);
}

async function main() {
  // The destination must exist, or the button would ship pointing at a 404.
  const step = await prisma.funnelStep.findFirst({
    where: { slug: "vsl", funnel: { slug: "vsl-funnel" } },
    select: { id: true },
  });
  if (!step) {
    console.error("No vsl step under vsl-funnel - refusing to redirect at a page that isn't there.");
    process.exit(1);
  }

  const form = await prisma.form.findUnique({ where: { slug: FORM_SLUG }, select: { id: true, settings: true } });
  if (!form) {
    console.error(`No form "${FORM_SLUG}".`);
    process.exit(1);
  }

  const settings = (form.settings ?? {}) as Record<string, unknown>;
  const patch: Record<string, unknown> = { ...settings, redirectUrl: TARGET };

  /**
   * …and file its opportunity into Fresh Optins.
   *
   * The earlier repair resolved this form's dead column through `boardColumnFor`, which at the
   * time still mapped NEW_LEAD onto the DISCO_BOOKED column - so it landed on "Pre-Qualified &
   * Confirmed". That is precisely the routing the founder asked to remove: an opt-in has not been
   * qualified and has no call confirmed. Matched on `legacyStage`, not on the name, so renaming
   * the column cannot break it.
   */
  const fresh = await prisma.pipelineStage.findFirst({
    where: { legacyStage: "NEW_LEAD", deletedAt: null, pipeline: { isDefault: true, deletedAt: null } },
    select: { id: true, name: true, pipelineId: true },
  });
  if (fresh && settings.stageId !== fresh.id) {
    const before = await prisma.pipelineStage.findUnique({
      where: { id: String(settings.stageId ?? "") },
      select: { name: true },
    });
    patch.stageId = fresh.id;
    patch.pipelineId = fresh.pipelineId;
    console.log(`${FORM_SLUG}: stage "${before?.name ?? "unset"}" -> "${fresh.name}"`);
  }

  await prisma.form.update({ where: { id: form.id }, data: { settings: patch as never } });
  console.log(`${FORM_SLUG}: redirectUrl -> ${TARGET}`);
}

main().finally(() => prisma.$disconnect());
