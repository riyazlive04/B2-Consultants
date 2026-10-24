/**
 * Correct the two curriculum templates whose `levelCode` is not in the level catalogue.
 *
 *   npm run fix:level-codes            # DRY RUN - prints what it would do, writes nothing
 *   npm run fix:level-codes -- --apply # writes
 *
 * ── Why this exists ────────────────────────────────────────────────────────────────────
 * `Level` has no foreign key, so `CurriculumTemplate.levelCode` is plain text that nothing
 * validates (P6). On 23 Oct 2026 live held three templates and two of them carried a code the
 * catalogue has never heard of:
 *
 *   · "Guided"   → should be "GUIDED"  (the catalogue code is upper-case)
 *   · "Gudied30" → should be "GUIDED"  (a typo, in a template literally named "Guided")
 *
 * Neither can be matched to a programme by any screen that looks a level up by code, and nothing
 * in the app could say so. This is the data fix that has to happen before migration M2 can add
 * the foreign key that would have prevented it - see docs/refactor/migrations/README.md.
 *
 * ── How it is safe ─────────────────────────────────────────────────────────────────────
 * It only ever touches a row whose current code is NOT in the catalogue, and only when the
 * replacement IS. It names every row before touching it, and it is a dry run unless asked. Three
 * templates ending up on the same level is legal and expected: `levelCode` is not unique, and
 * these are three different week structures for the same programme.
 */
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();
const APPLY = process.argv.includes("--apply");

/**
 * Bad code → what it should be.
 *
 * Deliberately an explicit map rather than fuzzy matching. "Gudied30" is only confidently
 * "GUIDED" because the template it sits on is named "Guided" and is on the B2 line; a script that
 * guessed from string distance could just as easily have filed it under a German level.
 */
const CORRECTIONS: Record<string, string> = {
  Guided: "GUIDED",
  Gudied30: "GUIDED",
};

async function main() {
  const host = process.env.DATABASE_URL?.split("@")[1]?.split("/")[0] ?? "(unknown host)";
  console.log(`${APPLY ? "APPLYING to" : "DRY RUN against"} ${host}\n`);

  const levels = new Set((await prisma.level.findMany({ select: { code: true } })).map((l) => l.code));
  const templates = await prisma.curriculumTemplate.findMany({
    select: { id: true, name: true, levelCode: true, line: true },
  });

  let fixed = 0;
  let skipped = 0;

  for (const t of templates) {
    if (t.levelCode === null || t.levelCode === "") continue;
    if (levels.has(t.levelCode)) continue; // already valid - never touched

    const target = CORRECTIONS[t.levelCode];
    if (!target) {
      console.log(`  ?  "${t.name}" holds "${t.levelCode}", which is unknown AND unmapped - decide by hand.`);
      skipped += 1;
      continue;
    }
    if (!levels.has(target)) {
      console.log(`  ✗  "${t.name}": would set "${t.levelCode}" → "${target}", but that is not in the catalogue either.`);
      skipped += 1;
      continue;
    }

    console.log(`  →  "${t.name}" (${t.line}): "${t.levelCode}" → "${target}"`);
    if (APPLY) {
      await prisma.curriculumTemplate.update({ where: { id: t.id }, data: { levelCode: target } });
    }
    fixed += 1;
  }

  console.log(
    `\n${fixed} template(s) ${APPLY ? "corrected" : "would be corrected"}` +
      (skipped ? `, ${skipped} left for a human` : "") +
      ".",
  );
  if (!APPLY && fixed > 0) console.log("Nothing was written. Re-run with --apply.");
  if (skipped > 0) console.log("M2 cannot be applied while any row is still unknown.");
}

main()
  .then(() => prisma.$disconnect())
  .catch(async (e) => {
    console.error(e);
    await prisma.$disconnect();
    process.exit(1);
  });
