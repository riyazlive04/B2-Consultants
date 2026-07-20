/**
 * Skool is not a cost of goods sold (§7.1).
 *
 *   npx tsx scripts/reclassify-skool-cogs.ts             # dry run (default)
 *   npx tsx scripts/reclassify-skool-cogs.ts --commit    # write
 *
 * The COGS test is "would this cost exist if nobody enrolled?". A tutor salary, books and
 * delivery tools scale with students; the Skool community subscription is billed monthly
 * whether the roster is 50 or 0, so it belongs in Tools & Software. It was mis-tagged
 * because the expense form's own help text used to offer Skool as a COGS example.
 *
 * SCOPE — deliberately narrow. This flips the `isCogs` REPORTING FLAG only.
 * It does NOT rewrite `category`, because the ledger account a row posts to is derived from
 * its category (chart-of-accounts.ts `expenseAccountFor`): changing that would leave the
 * already-posted journal entry pointing at the wrong account without a matching repost.
 * Any Skool row whose category is genuinely COGS_DIRECT_DELIVERY is therefore REPORTED for
 * manual handling rather than silently rewritten here.
 */

import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();
const COMMIT = process.argv.includes("--commit");

async function main() {
  const rows = await prisma.expense.findMany({
    where: { vendor: { contains: "skool", mode: "insensitive" } },
    select: { id: true, date: true, vendor: true, category: true, isCogs: true, amountInrMinor: true, notes: true },
    orderBy: { date: "desc" },
  });

  console.log(`Skool expense rows found: ${rows.length}`);
  const misflagged = rows.filter((r) => r.isCogs);
  const needsManual = misflagged.filter((r) => r.category === "COGS_DIRECT_DELIVERY");
  const safeToFix = misflagged.filter((r) => r.category !== "COGS_DIRECT_DELIVERY");

  console.log(`  already correct (isCogs=false): ${rows.length - misflagged.length}`);
  console.log(`  mis-flagged as COGS:            ${misflagged.length}`);
  console.log(`    → flag-only fix (safe):       ${safeToFix.length}`);
  console.log(`    → also mis-categorised:       ${needsManual.length}`);
  console.log("");

  for (const r of safeToFix) {
    console.log(
      `  fix  ${r.date.toISOString().slice(0, 10)}  ₹${(Number(r.amountInrMinor) / 100).toFixed(2)}  ${r.category}  ${r.vendor}`,
    );
  }
  if (needsManual.length) {
    console.log("\n  MANUAL REVIEW — category is COGS_DIRECT_DELIVERY, so the posted journal");
    console.log("  entry must be re-posted too. Re-categorise these in the app, not here:");
    for (const r of needsManual) {
      console.log(`    ${r.id}  ${r.date.toISOString().slice(0, 10)}  ${r.vendor}`);
    }
  }

  if (!COMMIT) {
    console.log("\nDRY RUN — nothing written. Re-run with --commit to apply.");
    return;
  }
  if (safeToFix.length === 0) {
    console.log("\nNothing to change.");
    return;
  }

  const res = await prisma.expense.updateMany({
    where: { id: { in: safeToFix.map((r) => r.id) } },
    data: { isCogs: false },
  });
  console.log(`\nCleared the COGS flag on ${res.count} Skool expense row(s).`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
