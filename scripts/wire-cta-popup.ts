/**
 * Point a funnel's CTAs at a form POPUP instead of a link - in place, without rebuilding the page.
 *
 * `prisma/seed-training-page.ts` also wires the popup, but it REPLACES the whole page and would
 * discard anything edited in the builder since. This script only touches the two fields it is
 * asked to, on the nodes it is asked about, and leaves every other byte of the page alone. That
 * is the difference between "the CTAs now open the form" and "the page is back to how it shipped".
 *
 *   npm run wire:cta -- --form=apply-guided-mode --dry-run
 *   npm run wire:cta -- --form=apply-guided-mode
 *
 * Options
 *   --funnel=<slug>      default "vsl-funnel"
 *   --step=<slug>        only this step; default every step of the funnel
 *   --form=<slug>        REQUIRED - the published form the popup shows
 *   --button=<text>      match buttons whose label contains this; default "Apply for Guided Mode"
 *   --image=<text>       match images whose alt contains this; default "Watch the training"
 *   --title=<text>       popup headline    (default: the live page's)
 *   --subtitle=<text>    popup subline     (default: the live page's)
 *   --off                remove the popup wiring instead, restoring the plain link
 *   --dry-run            report what would change and write nothing
 *   --force              allow a non-local DATABASE_URL
 *
 * Re-running is safe: a node already pointing at the same form is left untouched and reported as
 * such, so this can be run after every content edit without churning the page's `updatedAt`.
 */

import { PrismaClient } from "@prisma/client";
import type { Block } from "@/lib/sites-types";

const prisma = new PrismaClient();

const arg = (name: string, fallback = ""): string => {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : fallback;
};
const flag = (name: string) => process.argv.includes(`--${name}`);

const FUNNEL = arg("funnel", "vsl-funnel");
const STEP = arg("step");
const FORM = arg("form");
const BUTTON_MATCH = arg("button", "Apply for Guided Mode");
const IMAGE_MATCH = arg("image", "Watch the training");
const TITLE = arg("title", "See exactly why German companies ignore your applications.");
const SUBTITLE = arg("subtitle", "20 minutes. Free. Changes everything.");
const OFF = flag("off");
const DRY = flag("dry-run");

type Hit = { step: string; node: string; kind: string; was: string; now: string };

function walk(list: Block[], formId: string | null, stepName: string, hits: Hit[]): void {
  for (const b of list) {
    const label = b.type === "button" ? b.label ?? "" : b.type === "image" ? b.alt ?? "" : "";
    const matches =
      (b.type === "button" && BUTTON_MATCH && label.toLowerCase().includes(BUTTON_MATCH.toLowerCase())) ||
      (b.type === "image" && IMAGE_MATCH && label.toLowerCase().includes(IMAGE_MATCH.toLowerCase()));

    if (matches) {
      const was = b.opensFormId ? `popup(${b.opensFormId})` : b.type === "button" ? `link(${b.href ?? "-"})` : "no action";
      if (OFF) {
        if (b.opensFormId) {
          delete b.opensFormId;
          delete b.modalTitle;
          delete b.modalSubtitle;
          hits.push({ step: stepName, node: b.id, kind: b.type, was, now: b.type === "button" ? `link(${b.href ?? "-"})` : "no action" });
        }
      } else if (b.opensFormId !== formId || b.modalTitle !== TITLE || b.modalSubtitle !== SUBTITLE) {
        b.opensFormId = formId!;
        b.modalTitle = TITLE;
        b.modalSubtitle = SUBTITLE;
        hits.push({ step: stepName, node: b.id, kind: b.type, was, now: `popup(${formId})` });
      }
    }
    walk(b.children ?? [], formId, stepName, hits);
    for (const col of b.columns ?? []) walk(col, formId, stepName, hits);
  }
}

async function main() {
  const url = process.env.DATABASE_URL ?? "";
  if (!/@(localhost|127\.0\.0\.1)[:/]/.test(url) && !flag("force")) {
    throw new Error(`DATABASE_URL is not local (${url.replace(/:[^:@]*@/, ":***@")}). Pass --force to edit it on purpose.`);
  }
  if (!OFF && !FORM) throw new Error("Pass --form=<published form slug>.");

  let formId: string | null = null;
  if (!OFF) {
    const form = await prisma.form.findFirst({ where: { slug: FORM }, select: { id: true, name: true, published: true } });
    if (!form) throw new Error(`No form with slug "${FORM}".`);
    // A draft form resolves to nothing on the public page, so the popup would open empty. Better
    // to refuse here than to ship a dialog that silently captures no one.
    if (!form.published) throw new Error(`Form "${form.name}" is not published - publish it first, or the popup opens empty.`);
    formId = form.id;
    console.log(`Popup form: ${form.name} (${FORM})`);
  }

  const funnel = await prisma.funnel.findUnique({
    where: { slug: FUNNEL },
    select: { name: true, steps: { where: STEP ? { slug: STEP } : {}, select: { id: true, name: true, slug: true, blocks: true } } },
  });
  if (!funnel) throw new Error(`No funnel with slug "${FUNNEL}".`);
  console.log(`Funnel: ${funnel.name} · ${funnel.steps.length} step(s)\n`);

  const hits: Hit[] = [];
  for (const step of funnel.steps) {
    const blocks = (step.blocks as Block[]) ?? [];
    const before = hits.length;
    walk(blocks, formId, step.slug, hits);
    // Variants are steps too, so a running A/B test gets wired on both arms in the same pass -
    // otherwise half the traffic would keep seeing the old behaviour and the test would be
    // measuring the popup rather than whatever it was set up to measure.
    if (hits.length > before && !DRY) {
      await prisma.funnelStep.update({ where: { id: step.id }, data: { blocks: blocks as unknown as object } });
    }
  }

  if (hits.length === 0) {
    console.log("Nothing to change - every matching CTA is already wired the way you asked.");
    console.log(`(Matching on button label containing "${BUTTON_MATCH}" and image alt containing "${IMAGE_MATCH}".)`);
    return;
  }
  for (const h of hits) console.log(`  ${h.step} · ${h.kind} ${h.node}\n      ${h.was}  →  ${h.now}`);
  console.log(`\n${DRY ? "Would change" : "Changed"} ${hits.length} node(s).${DRY ? "  Re-run without --dry-run to apply." : ""}`);
}

main().catch((e) => { console.error(`\n${e.message}`); process.exitCode = 1; }).finally(() => prisma.$disconnect());
