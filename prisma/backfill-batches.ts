/**
 * Backfill the German Note batch labels into real Batch rows (ER v2 Track A).
 *
 *   npx tsx prisma/backfill-batches.ts          # report only, writes nothing
 *   npx tsx prisma/backfill-batches.ts --apply  # create batches and link conversions
 *
 * ── The problem this closes ──────────────────────────────────────────────────────
 * German Note ran TWO batch worlds: real `gn_batch` rows for the LMS, and free-text labels
 * ("B26", "b 26") typed onto GnWorkshopConversion.batchA1 / batchA2 / batchB1. The second
 * kind cannot be joined to anything - no roster, no tutor, no fee, no P&L.
 *
 * This resolves each label to a Batch, creating one where the label is new. `normalizeBatchCode`
 * collapses the spellings ("b26", " B 26 ", "b-26" → "B26") so one cohort does not become
 * three batches with a third of the roster each.
 *
 * ── What it will NOT do ──────────────────────────────────────────────────────────
 * A label that normalises to nothing, or that matches more than one existing batch at a
 * different level, is LEFT UNLINKED and printed. The free text stays as the historical
 * snapshot either way - exactly like BookOrder.shipToAddress - so nothing is lost.
 */

import { PrismaClient } from "@prisma/client";
import { normalizeBatchCode } from "../src/lib/batch";

const prisma = new PrismaClient();
const APPLY = process.argv.includes("--apply");

/** Which Level.code each per-level column belongs to. */
const COLUMNS = [
  { label: "batchA1", id: "batchA1Id", level: "GN_A1" },
  { label: "batchA2", id: "batchA2Id", level: "GN_A2" },
  { label: "batchB1", id: "batchB1Id", level: "GN_B1" },
] as const;

async function main() {
  // Step 1: every pre-existing batch is German Note. The column default already says so;
  // this makes it explicit and is a no-op on a fresh migration.
  if (APPLY) {
    const fixed = await prisma.batch.updateMany({
      where: { line: { not: "GERMAN_NOTE" }, code: null },
      data: { line: "GERMAN_NOTE" },
    });
    if (fixed.count > 0) console.log(`Marked ${fixed.count} pre-existing batch(es) as GERMAN_NOTE.`);
  }

  const conversions = await prisma.gnWorkshopConversion.findMany({
    select: {
      id: true, fullName: true,
      batchA1: true, batchA1Id: true, timeA1: true,
      batchA2: true, batchA2Id: true, timeA2: true,
      batchB1: true, batchB1Id: true, timeB1: true,
    },
  });

  const existing = await prisma.batch.findMany({
    where: { code: { not: null } },
    select: { id: true, code: true, level: true, name: true },
  });
  const byCode = new Map(existing.map((b) => [b.code!, b]));

  const created: string[] = [];
  const unresolved: { conversion: string; who: string; column: string; raw: string; reason: string }[] = [];
  let linked = 0;

  for (const c of conversions) {
    for (const col of COLUMNS) {
      const raw = c[col.label];
      if (!raw || !raw.trim()) continue;
      if (c[col.id]) continue; // already resolved - idempotent

      const code = normalizeBatchCode(raw);
      if (!code) {
        unresolved.push({
          conversion: c.id, who: c.fullName, column: col.label, raw,
          reason: "label has no usable characters",
        });
        continue;
      }

      let batch = byCode.get(code);

      if (batch && batch.level !== col.level) {
        // The same label used for two different levels. Real ambiguity - the founders reuse
        // batch numbers across levels - so resolve per (code, level) rather than guessing.
        const perLevel = existing.find((b) => b.code === code && b.level === col.level);
        if (perLevel) {
          batch = perLevel;
        } else {
          unresolved.push({
            conversion: c.id, who: c.fullName, column: col.label, raw,
            reason: `batch "${code}" exists at level ${batch.level}, not ${col.level}`,
          });
          continue;
        }
      }

      if (!batch) {
        if (!APPLY) {
          created.push(`${code} (${col.level})`);
          linked++;
          continue;
        }
        const madeAt = await prisma.batch.create({
          data: {
            line: "GERMAN_NOTE",
            code,
            name: `${code} - ${col.level.replace("GN_", "")}`,
            level: col.level,
            notes: `Reconstructed from workshop conversion labels (ER v2 Track A backfill).`,
          },
          select: { id: true, code: true, level: true, name: true },
        });
        byCode.set(code, madeAt);
        existing.push(madeAt);
        batch = madeAt;
        created.push(`${code} (${col.level})`);
      }

      if (APPLY) {
        await prisma.gnWorkshopConversion.update({
          where: { id: c.id },
          data: { [col.id]: batch.id },
        });
      }
      linked++;
    }
  }

  console.log(`\n${APPLY ? "Linked" : "Would link"} ${linked} per-level batch assignment(s).`);
  console.log(`${APPLY ? "Created" : "Would create"} ${new Set(created).size} batch(es): ${[...new Set(created)].join(", ") || "none"}`);

  console.log(`\nLeft unlinked (deliberately - never guessed): ${unresolved.length}`);
  for (const u of unresolved.slice(0, 40)) {
    console.log(`  ${u.who} · ${u.column} = "${u.raw}" - ${u.reason}`);
  }
  if (unresolved.length > 40) console.log(`  … and ${unresolved.length - 40} more`);

  if (!APPLY) console.log("\nDry run. Re-run with --apply to write.\n");
  else console.log("\nDone. The free-text labels are kept as the historical snapshot.\n");
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
