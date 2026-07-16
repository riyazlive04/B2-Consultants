/**
 * Adversarial check on the ledger's integrity guarantees (SPEC §15).
 *
 *   npm run db:verify-ledger
 *
 * Every case here TRIES TO CORRUPT the ledger and asserts the database refuses. The
 * application-level checks in ledger-core.ts are bypassed on purpose — we are testing the
 * triggers and CHECK constraints, because those are what hold when someone opens psql.
 *
 * Each attempt runs inside a transaction that ends in a throw, so nothing is left behind.
 */
import { PrismaClient, Prisma } from "@prisma/client";
import { getTrialBalance, postEntry, verifyAuditChain, voidEntryForSource } from "../src/server/ledger-core";

const prisma = new PrismaClient();
const ONE = new Prisma.Decimal(1);
const TODAY = new Date(new Date().toISOString().slice(0, 10) + "T00:00:00Z");

let failures = 0;

/**
 * Pull the database's own words out of a Prisma error. Without this we print whatever
 * source line the code-frame happens to show, and a test that "passes" while reporting an
 * unrelated reason is how a broken guarantee hides in a green run.
 */
function rejectionReason(err: unknown): string {
  const raw = err instanceof Error ? err.message : String(err);
  // Check-constraint names first: Postgres reports them inside an escaped-quote string, so a
  // naive `message: "…"` match stops at the first \" and prints half a sentence.
  const check = raw.match(/violates check constraint \\?"([^"\\]+)/)?.[1];
  if (check) return `violates CHECK ${check}`;
  const pg = raw.match(/message: "((?:[^"\\]|\\.)*)"/)?.[1]; // PostgresError { message: "…" }
  if (pg) return pg.replace(/\\"/g, '"').trim().slice(0, 120);
  const app = raw.match(/^(?:LedgerError: )?(.*(?:does not balance|is locked|at least two).*)$/m)?.[1];
  return (app ?? raw).trim().slice(0, 120);
}

/** The attempt MUST be rejected. If it succeeds, the guarantee is a lie. */
async function mustReject(label: string, attempt: () => Promise<unknown>) {
  try {
    await attempt();
    failures += 1;
    console.error(`  ✗ ${label}\n      NOT REJECTED — the ledger accepted corrupt data`);
  } catch (err) {
    console.log(`  ✓ ${label}\n      rejected: ${rejectionReason(err)}`);
  }
}

async function mustAccept(label: string, attempt: () => Promise<unknown>) {
  try {
    await attempt();
    console.log(`  ✓ ${label}`);
  } catch (err) {
    failures += 1;
    console.error(`  ✗ ${label}\n      UNEXPECTEDLY REJECTED: ${(err as Error).message.slice(0, 160)}`);
  }
}

async function main() {
  const bank = await prisma.ledgerAccount.findUniqueOrThrow({ where: { code: "1000" } });
  const income = await prisma.ledgerAccount.findUniqueOrThrow({ where: { code: "4010" } });

  const line = (entryId: string, accountId: string, side: "debit" | "credit", amt: bigint, fx = ONE, cur: "INR" | "EUR" = "INR") => ({
    entryId,
    accountId,
    currency: cur,
    fxRate: fx,
    debitMinor: side === "debit" ? amt : BigInt(0),
    creditMinor: side === "credit" ? amt : BigInt(0),
    baseDebitMinor: side === "debit" ? amt : BigInt(0),
    baseCreditMinor: side === "credit" ? amt : BigInt(0),
  });

  console.log("\nEntry-level balance (deferred trigger, fires at COMMIT)");

  await mustReject("an entry whose debits ≠ credits (₹1.00 vs ₹0.99)", () =>
    prisma.$transaction(async (tx) => {
      const e = await tx.journalEntry.create({
        data: { date: TODAY, narration: "TEST unbalanced", sourceType: "MANUAL" },
      });
      await tx.journalLine.create({ data: line(e.id, bank.id, "debit", BigInt(100)) });
      await tx.journalLine.create({ data: line(e.id, income.id, "credit", BigInt(99)) });
    }),
  );

  await mustReject("an entry with a single line", () =>
    prisma.$transaction(async (tx) => {
      const e = await tx.journalEntry.create({
        data: { date: TODAY, narration: "TEST one-legged", sourceType: "MANUAL" },
      });
      await tx.journalLine.create({ data: line(e.id, bank.id, "debit", BigInt(100)) });
    }),
  );

  await mustReject("an entry with no lines at all", () =>
    prisma.$transaction(async (tx) => {
      await tx.journalEntry.create({
        data: { date: TODAY, narration: "TEST empty", sourceType: "MANUAL" },
      });
    }),
  );

  await mustAccept("a balanced two-line entry (then rolled back)", () =>
    prisma
      .$transaction(async (tx) => {
        const e = await tx.journalEntry.create({
          data: { date: TODAY, narration: "TEST balanced", sourceType: "MANUAL" },
        });
        await tx.journalLine.create({ data: line(e.id, bank.id, "debit", BigInt(100)) });
        await tx.journalLine.create({ data: line(e.id, income.id, "credit", BigInt(100)) });
        throw new Error("__rollback__");
      })
      .catch((e) => {
        if ((e as Error).message !== "__rollback__") throw e;
      }),
  );

  console.log("\nRow-level shape (CHECK constraints)");

  await mustReject("a line that is both a debit and a credit", () =>
    prisma.$transaction(async (tx) => {
      const e = await tx.journalEntry.create({
        data: { date: TODAY, narration: "TEST two-sided", sourceType: "MANUAL" },
      });
      await tx.journalLine.create({
        data: {
          entryId: e.id, accountId: bank.id, currency: "INR", fxRate: ONE,
          debitMinor: BigInt(100), creditMinor: BigInt(100),
          baseDebitMinor: BigInt(100), baseCreditMinor: BigInt(100),
        },
      });
    }),
  );

  await mustReject("an INR line carrying an FX rate other than 1", () =>
    prisma.$transaction(async (tx) => {
      const e = await tx.journalEntry.create({
        data: { date: TODAY, narration: "TEST bad inr rate", sourceType: "MANUAL" },
      });
      await tx.journalLine.create({
        data: line(e.id, bank.id, "debit", BigInt(100), new Prisma.Decimal(2)),
      });
    }),
  );

  await mustReject("a zero-amount line", () =>
    prisma.$transaction(async (tx) => {
      const e = await tx.journalEntry.create({
        data: { date: TODAY, narration: "TEST zero", sourceType: "MANUAL" },
      });
      await tx.journalLine.create({ data: line(e.id, bank.id, "debit", BigInt(0)) });
      await tx.journalLine.create({ data: line(e.id, income.id, "credit", BigInt(0)) });
    }),
  );

  console.log("\nImmutability (append-only triggers)");

  const anyLine = await prisma.journalLine.findFirst();
  const anyEntry = await prisma.journalEntry.findFirst();
  if (anyLine && anyEntry) {
    await mustReject("editing the amount on a posted journal line", () =>
      prisma.$transaction((tx) =>
        tx.journalLine.update({ where: { id: anyLine.id }, data: { baseDebitMinor: BigInt(1) } }),
      ),
    );
    await mustReject("deleting a posted journal line", () =>
      prisma.$transaction((tx) => tx.journalLine.delete({ where: { id: anyLine.id } })),
    );
    await mustReject("deleting a posted journal entry", () =>
      prisma.$transaction((tx) => tx.journalEntry.delete({ where: { id: anyEntry.id } })),
    );
    await mustReject("rewriting the narration of a posted entry", () =>
      prisma.$transaction((tx) =>
        tx.journalEntry.update({ where: { id: anyEntry.id }, data: { narration: "tampered" } }),
      ),
    );
  } else {
    console.log("  · skipped (ledger is empty — run `npm run db:ledger` first)");
  }

  console.log("\nOne live entry per source row");

  const SRC = "verify-ledger-fake-income-id";
  const balancedDraft = (narration: string) => ({
    date: TODAY,
    narration,
    sourceType: "INCOME" as const,
    sourceId: SRC,
    lines: [
      { accountCode: "1000" as const, side: "debit" as const, amountMinor: BigInt(500), currency: "INR" as const, fxRate: ONE },
      { accountCode: "4010" as const, side: "credit" as const, amountMinor: BigInt(500), currency: "INR" as const, fxRate: ONE },
    ],
  });

  await mustReject("posting a second live entry for one Income row", () =>
    prisma.$transaction(async (tx) => {
      await postEntry(tx, balancedDraft("TEST first"));
      await postEntry(tx, balancedDraft("TEST duplicate"));
    }),
  );

  await mustAccept("void, then re-post the same source (what an edit does)", () =>
    prisma
      .$transaction(async (tx) => {
        await postEntry(tx, balancedDraft("TEST original"));
        await voidEntryForSource(tx, "INCOME", SRC, { reason: "edited", on: TODAY });
        await postEntry(tx, balancedDraft("TEST restated"));
        throw new Error("__rollback__");
      })
      .catch((e) => {
        if ((e as Error).message !== "__rollback__") throw e;
      }),
  );

  console.log("\nPeriod locking");

  const month = TODAY.toISOString().slice(0, 7);
  await prisma.periodLock.create({ data: { month, note: "verify-ledger temporary lock" } });
  try {
    await mustReject(`posting into locked period ${month}`, () =>
      prisma.$transaction(async (tx) => {
        const e = await tx.journalEntry.create({
          data: { date: TODAY, narration: "TEST into locked period", sourceType: "MANUAL" },
        });
        await tx.journalLine.create({ data: line(e.id, bank.id, "debit", BigInt(100)) });
        await tx.journalLine.create({ data: line(e.id, income.id, "credit", BigInt(100)) });
      }),
    );
  } finally {
    await prisma.periodLock.delete({ where: { month } });
  }

  console.log("\nStanding invariants");

  const tb = await getTrialBalance(prisma);
  const rupees = (v: bigint) => `₹${(Number(v) / 100).toLocaleString("en-IN")}`;
  if (tb.balanced) {
    console.log(`  ✓ trial balance balances: ${rupees(tb.totalDebit)} across ${tb.rows.length} accounts`);
  } else {
    failures += 1;
    console.error(`  ✗ TRIAL BALANCE BROKEN: ${rupees(tb.totalDebit)} vs ${rupees(tb.totalCredit)}`);
  }

  const chain = await verifyAuditChain(prisma);
  if (chain.ok) console.log(`  ✓ audit hash chain verifies (${chain.length} entries)`);
  else {
    failures += 1;
    console.error(`  ✗ AUDIT CHAIN BROKEN at seq ${chain.brokenAtSeq}`);
  }

  console.log(failures === 0 ? "\nAll ledger guarantees hold.\n" : `\n${failures} GUARANTEE(S) FAILED\n`);
  if (failures) process.exitCode = 1;
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
