/**
 * Seed the chart of accounts, then backfill every Finance row that predates the ledger.
 *
 *   npm run db:ledger
 *
 * Idempotent on both halves: the chart is upserted by `code`, and each Income/Expense row
 * posts through `postEntryOnce`, which is a no-op once that row has a live entry. Re-running
 * after adding rows backfills only the new ones.
 *
 * The drafts come from `finance-posting.ts` — the same module the live Finance actions use —
 * so a backfilled entry and a freshly-entered one are indistinguishable in the ledger.
 */
import { PrismaClient } from "@prisma/client";
import { expenseEntryDraft, incomeEntryDraft, baseTotalMinor } from "../src/server/finance-posting";
import { getTrialBalance, postEntryOnce, seedChartOfAccounts } from "../src/server/ledger-core";

const prisma = new PrismaClient();

async function backfillIncome(): Promise<number> {
  const rows = await prisma.income.findMany({ orderBy: { date: "asc" } });
  let posted = 0;
  for (const i of rows) {
    if (baseTotalMinor(i) <= BigInt(0)) {
      console.warn(`  · skipped income ${i.id} (${i.studentName}): zero value`);
      continue;
    }
    const id = await prisma.$transaction((tx) =>
      postEntryOnce(tx, { ...incomeEntryDraft(i), sourceId: i.id }),
    );
    if (id) posted += 1;
  }
  return posted;
}

async function backfillExpense(): Promise<number> {
  const rows = await prisma.expense.findMany({ orderBy: { date: "asc" } });
  let posted = 0;
  for (const e of rows) {
    if (baseTotalMinor(e) <= BigInt(0)) {
      console.warn(`  · skipped expense ${e.id} (${e.vendor}): zero value`);
      continue;
    }
    const id = await prisma.$transaction((tx) =>
      postEntryOnce(tx, { ...expenseEntryDraft(e), sourceId: e.id }),
    );
    if (id) posted += 1;
  }
  return posted;
}

async function main() {
  const chart = await seedChartOfAccounts(prisma);
  console.log(`· chart of accounts: ${chart.total} accounts (${chart.created} new)`);

  const income = await backfillIncome();
  const expense = await backfillExpense();
  console.log(`· backfilled ${income} income and ${expense} expense entries`);

  const tb = await getTrialBalance(prisma);
  const rupees = (v: bigint) => `₹${(Number(v) / 100).toLocaleString("en-IN")}`;
  console.log(`· trial balance: debits ${rupees(tb.totalDebit)} / credits ${rupees(tb.totalCredit)}`);
  if (!tb.balanced) {
    console.error("TRIAL BALANCE DOES NOT BALANCE — refusing to report success.");
    process.exitCode = 1;
    return;
  }
  console.log(`· balanced ✓ across ${tb.rows.length} accounts`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
