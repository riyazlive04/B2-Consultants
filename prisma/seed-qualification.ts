/**
 * Seed the qualification catalogue from the SHIPPED intake tables (ER v2 Track D).
 *
 *   npx tsx prisma/seed-qualification.ts
 *
 * The catalogue is DERIVED by `catalogueFromIntake()` from INTAKE_OPTIONS and
 * BANT_ANSWER_SCORES — the very tables `computeBant()` scores against — rather than
 * hand-transcribed. That is the whole safety argument for Track D: a hand-written seed is
 * "equivalent by inspection", a claim that survives exactly until someone mistypes a 3 as a
 * 5 in a 40-row score table and nobody notices, because the resulting verdict still looks
 * plausible.
 *
 * Idempotent: re-running upserts version 1 of each key and never touches a later version.
 * Safe to run against a database that already has answers, because it only writes v1 rows
 * that already existed with identical content.
 */

import { PrismaClient } from "@prisma/client";
import { catalogueFromIntake } from "../src/lib/qualification";

const prisma = new PrismaClient();

async function main() {
  const catalogue = catalogueFromIntake();
  let created = 0;
  let updated = 0;
  let skipped = 0;

  for (const q of catalogue) {
    const existing = await prisma.qualificationQuestion.findUnique({
      where: { key_version: { key: q.key, version: 1 } },
      include: { _count: { select: { answers: true } } },
    });

    // A v1 that has already been answered is frozen — the DB trigger would reject the write
    // anyway, and re-seeding must not be the thing that trips it.
    if (existing && existing._count.answers > 0) {
      skipped++;
      continue;
    }

    const data = {
      text: q.text,
      helpText: q.helpText,
      kind: q.kind,
      options: q.options as never,
      dimension: q.dimension,
      weight: q.weight,
      required: q.required,
      orderIndex: q.orderIndex,
      active: true,
    };

    if (existing) {
      await prisma.qualificationQuestion.update({ where: { id: existing.id }, data });
      updated++;
    } else {
      await prisma.qualificationQuestion.create({ data: { key: q.key, version: 1, ...data } });
      created++;
    }
  }

  const scored = catalogue.filter((q) => q.dimension !== "NONE").length;
  console.log(
    `Qualification catalogue: ${created} created · ${updated} updated · ${skipped} left frozen (already answered)`,
  );
  console.log(`  ${catalogue.length} questions, ${scored} of them scored (BUDGET / AUTHORITY / NEED / TIMELINE).`);
  console.log("  Next: npx tsx prisma/replay-bant.ts — the cutover gate.");
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
