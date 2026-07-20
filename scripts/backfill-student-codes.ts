/**
 * Backfill human-readable student numbers (§6.1).
 *
 *   npx tsx scripts/backfill-student-codes.ts             # dry run (default)
 *   npx tsx scripts/backfill-student-codes.ts --commit    # write
 *
 * Numbers are handed out in creation order, so the longest-standing student is B2-0001 and
 * the sequence matches the roster's own history rather than an arbitrary id ordering.
 *
 * Safe to re-run: rows that already carry a code are skipped, and the sequence continues
 * from the highest code already issued, so a partial run can simply be run again.
 */

import { PrismaClient } from "@prisma/client";
import { formatStudentCode, nextStudentNumber } from "../src/lib/student-code";

const prisma = new PrismaClient();
const COMMIT = process.argv.includes("--commit");

async function main() {
  const students = await prisma.student.findMany({
    orderBy: { createdAt: "asc" },
    select: { id: true, code: true, fullName: true, createdAt: true },
  });

  const missing = students.filter((s) => !s.code);
  let next = nextStudentNumber(students.map((s) => s.code));

  console.log(`students: ${students.length}`);
  console.log(`already coded: ${students.length - missing.length}`);
  console.log(`to assign: ${missing.length}`);
  console.log(`starting at: ${formatStudentCode(next)}`);
  console.log("");

  // Duplicate names are the entire reason this exists — surface them so the founder can
  // confirm the numbering lands the way they expect.
  const byName = new Map<string, number>();
  for (const s of students) {
    const k = s.fullName.trim().toLowerCase();
    byName.set(k, (byName.get(k) ?? 0) + 1);
  }
  const dupes = [...byName.entries()].filter(([, n]) => n > 1);
  if (dupes.length) {
    console.log(`duplicate names that this fixes (${dupes.length}):`);
    for (const [name, n] of dupes) console.log(`  ${name} ×${n}`);
    console.log("");
  }

  const plan = missing.map((s) => ({ ...s, code: formatStudentCode(next++) }));
  for (const p of plan.slice(0, 15)) console.log(`  ${p.code}  ${p.fullName}`);
  if (plan.length > 15) console.log(`  … and ${plan.length - 15} more`);

  if (!COMMIT) {
    console.log("\nDRY RUN — nothing written. Re-run with --commit to apply.");
    return;
  }

  // One row at a time: the unique index is the real guard, so a collision fails that
  // single row loudly instead of silently rolling back an entire batch.
  let done = 0;
  for (const p of plan) {
    await prisma.student.update({ where: { id: p.id }, data: { code: p.code } });
    done++;
  }
  console.log(`\nWrote ${done} student codes.`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
