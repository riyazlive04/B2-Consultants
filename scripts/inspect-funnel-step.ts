/**
 * Read-only: dump a funnel step's block tree, including the fields that decide where a button goes.
 *
 *   npx tsx scripts/inspect-funnel-step.ts <funnel-slug> [step-slug]
 *
 * With no step slug it lists the funnel's steps and stops.
 */
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

type Node = {
  id?: string; type?: string; text?: string; html?: string; url?: string;
  label?: string; href?: string; opensFormId?: string; children?: Node[];
};

function walk(nodes: Node[] | undefined, depth = 0) {
  for (const n of nodes ?? []) {
    const bits = [
      n.label && `label="${n.label}"`,
      n.href && `href="${n.href}"`,
      n.opensFormId && `opensForm=${n.opensFormId}`,
      n.url && `url="${n.url.slice(0, 50)}"`,
      n.text && `“${n.text.slice(0, 45).replace(/\s+/g, " ")}”`,
    ].filter(Boolean);
    console.log(`${"  ".repeat(depth)}- ${n.type} [${n.id}] ${bits.join("  ")}`);
    walk(n.children, depth + 1);
  }
}

async function main() {
  const [funnelSlug, stepSlug] = process.argv.slice(2);
  if (!funnelSlug) return console.error("usage: inspect-funnel-step.ts <funnel-slug> [step-slug]");

  const funnel = await prisma.funnel.findFirst({
    where: { slug: funnelSlug },
    select: { id: true, name: true, steps: { orderBy: { position: "asc" }, select: { id: true, name: true, slug: true, position: true, blocks: true } } },
  });
  if (!funnel) return console.error(`No funnel "${funnelSlug}"`);

  console.log(`FUNNEL ${funnel.name}`);
  for (const s of funnel.steps) console.log(`  ${s.position}. ${s.slug.padEnd(28)} ${s.name}  [${s.id}]`);

  if (!stepSlug) return;
  const step = funnel.steps.find((s) => s.slug === stepSlug);
  if (!step) return console.error(`\nNo step "${stepSlug}" in that funnel`);
  console.log(`\nSTEP ${step.slug} [${step.id}]`);
  if (process.argv.includes("--json")) console.log(JSON.stringify(step.blocks, null, 2));
  else walk(step.blocks as unknown as Node[]);
}

main().finally(() => prisma.$disconnect());
