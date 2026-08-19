import test from "node:test";
import assert from "node:assert/strict";
import { PrismaClient, Prisma } from "@prisma/client";
import {
  getPeriodMovements,
  getTrialBalance,
  LedgerError,
  monthKeyOf,
  postEntry,
  restatedDate,
  seedChartOfAccounts,
  voidEntryForSource,
  type DraftEntry,
  type LedgerDb,
} from "../ledger-core";

/**
 * The money layer's INTEGRATION suite - the gap that let the mis-dated-reversal defect ship.
 *
 * Why this file exists rather than more unit tests: `src/server/` is `server-only`, so the 484
 * `tsx` unit tests cannot reach `ledger-core.ts` at all. (`ledger-core.ts` itself carries no
 * "server-only" pragma, deliberately - see its header - which is what lets this file import it.)
 *
 * And why period-scoped assertions specifically: `prisma/verify-ledger.ts` is a genuinely good
 * adversarial suite, but it asserts that the trial balance BALANCES. A reversal dated into the
 * wrong month balances perfectly - the original and its mirror are both in the all-time total,
 * they simply sit in different months. Balance is not correctness. Every assertion below is
 * therefore scoped to a month.
 *
 * Needs a real Postgres: the balance rule is a DEFERRABLE trigger that fires at COMMIT, so there
 * is nothing meaningful to test against a mock. Point LEDGER_TEST_DATABASE_URL at a THROWAWAY
 * database - the suite posts real, permanent journal entries (see TAG below):
 *
 *   npm run db:local
 *   LEDGER_TEST_DATABASE_URL="postgresql://b2:b2@localhost:5435/b2_dashboard?schema=public" npm test
 *
 * Unset, every test below skips, so `npm test` stays green on a machine with no database.
 */

const TEST_URL = process.env.LEDGER_TEST_DATABASE_URL;
const noDb = !TEST_URL;
const skip = noDb ? "set LEDGER_TEST_DATABASE_URL to run the ledger integration suite" : false;

const db = noDb
  ? (null as unknown as PrismaClient)
  : new PrismaClient({ datasources: { db: { url: TEST_URL } } });

const INR = new Prisma.Decimal(1);
const rupees = (n: number) => BigInt(n) * BigInt(100);

/**
 * This suite does NOT delete the entries it posts, and cannot: `journal_line` carries an
 * append-only trigger that refuses DELETE outright - the very guarantee under test. So instead
 * of cleaning up, every run tags its rows uniquely and every assertion is a DELTA against the
 * balance found at the start. That makes the suite correct against a database that already has
 * real postings in it, and re-runnable without tripping the one-live-entry-per-source rule.
 */
const TAG = `__ledger_period_test__${process.pid}_${process.hrtime.bigint()}`;

/**
 * A balanced income entry: debit the bank, credit revenue. `sourceId` is unique per test so the
 * one-live-entry-per-source rule doesn't make tests interfere with each other.
 */
function incomeDraft(on: Date, sourceId: string, amount: bigint): DraftEntry & { sourceId: string } {
  return {
    date: on,
    narration: `${TAG} income`,
    sourceType: "INCOME",
    sourceId,
    lines: [
      { accountCode: "1000", side: "debit", amountMinor: amount, currency: "INR", fxRate: INR },
      { accountCode: "4000", side: "credit", amountMinor: amount, currency: "INR", fxRate: INR },
    ],
  };
}

/** Fixed dates: two settled months in the past, so a real clock never moves the assertions. */
const JUNE = new Date("2026-06-10T00:00:00.000Z");
const JULY = new Date("2026-07-20T00:00:00.000Z");
const JUNE_KEY = monthKeyOf(JUNE); // "2026-06"
const JULY_KEY = monthKeyOf(JULY); // "2026-07"

const revenueIn = async (month: string) => (await getPeriodMovements(db, month)).get("4000") ?? 0n;

/** Revenue is credit-balanced, so `getPeriodMovements` reports it debit-negative. */
const revenueEarnedIn = async (month: string) => -(await revenueIn(month));

/**
 * Period locks ARE removable, and the suite creates them - but only ever its own. A lock that was
 * already there belongs to the founder's real close, so the suite refuses to run rather than
 * quietly deleting it and leaving a reported month re-openable.
 */
async function assertMonthsOpen() {
  const existing = await db.periodLock.findMany({
    where: { month: { in: [JUNE_KEY, JULY_KEY] } },
    select: { month: true },
  });
  assert.equal(
    existing.length,
    0,
    `${existing.map((e) => e.month).join(", ")} is locked in this database. ` +
      `The suite needs ${JUNE_KEY} and ${JULY_KEY} open and will not unlock a real close - ` +
      `point LEDGER_TEST_DATABASE_URL at a throwaway database.`,
  );
}

const dropTestLocks = () =>
  db.periodLock.deleteMany({ where: { month: { in: [JUNE_KEY, JULY_KEY] } } });

/** Each case runs in its own transaction so the deferred balance trigger fires at COMMIT. */
const tx = <T>(fn: (t: LedgerDb) => Promise<T>) => db.$transaction(fn);

test("ledger period integrity", { skip }, async (t) => {
  await seedChartOfAccounts(db);
  await assertMonthsOpen();
  t.after(async () => {
    await dropTestLocks();
    await db.$disconnect();
  });

  await t.test("THE REGRESSION: editing a past income restates its own month, not today's", async () => {
    const src = `${TAG}-edit-1`;
    const before = { june: await revenueEarnedIn(JUNE_KEY), july: await revenueEarnedIn(JULY_KEY) };

    await tx((t2) => postEntry(t2, incomeDraft(JUNE, src, rupees(45_000))));
    assert.equal(await revenueEarnedIn(JUNE_KEY), before.june + rupees(45_000));

    // Correct the amount in July, the way `updateIncome` does: void, then re-post the restatement.
    await tx(async (t2) => {
      const voided = await voidEntryForSource(t2, "INCOME", src, { reason: "edited", on: JULY });
      const draft = incomeDraft(JUNE, src, rupees(50_000));
      await postEntry(t2, { ...draft, date: restatedDate(voided, draft.date) });
    });

    // June now carries the RESTATED figure - not the original, and not both.
    assert.equal(
      await revenueEarnedIn(JUNE_KEY),
      before.june + rupees(50_000),
      "June must show the corrected ₹50,000, not ₹45,000 and not ₹95,000",
    );
    // Before the fix this was −₹45,000: the bare reversal, marooned in the month of the edit.
    assert.equal(
      await revenueEarnedIn(JULY_KEY),
      before.july,
      "July must be untouched - a June correction has no business appearing here",
    );
  });

  await t.test("the two halves of a correction always share a month", async () => {
    const src = `${TAG}-pair-1`;
    await tx((t2) => postEntry(t2, incomeDraft(JUNE, src, rupees(10_000))));
    let reversalId = "";
    await tx(async (t2) => {
      const voided = await voidEntryForSource(t2, "INCOME", src, { reason: "edited", on: JULY });
      reversalId = voided!.reversalId;
      const draft = incomeDraft(JUNE, src, rupees(11_000));
      await postEntry(t2, { ...draft, date: restatedDate(voided, draft.date) });
    });

    const reversal = await db.journalEntry.findUniqueOrThrow({ where: { id: reversalId } });
    assert.equal(
      monthKeyOf(reversal.date),
      JUNE_KEY,
      "the reversal belongs in the original's month while that month is open",
    );
  });

  await t.test("a locked month moves the WHOLE correction to the open period", async () => {
    const src = `${TAG}-locked-1`;
    await tx((t2) => postEntry(t2, incomeDraft(JUNE, src, rupees(20_000))));
    const juneAfterPost = await revenueEarnedIn(JUNE_KEY);
    const julyBefore = await revenueEarnedIn(JULY_KEY);

    await db.periodLock.create({ data: { month: JUNE_KEY } });

    await tx(async (t2) => {
      const voided = await voidEntryForSource(t2, "INCOME", src, { reason: "edited", on: JULY });
      assert.deepEqual(voided!.restateOn, JULY, "a locked original must force the restatement into `on`");
      const draft = incomeDraft(JUNE, src, rupees(25_000));
      await postEntry(t2, { ...draft, date: restatedDate(voided, draft.date) });
    });

    assert.equal(
      await revenueEarnedIn(JUNE_KEY),
      juneAfterPost,
      "a closed month is never restated - that is what the lock is for",
    );
    // Both halves landed in July: −20,000 reversal + 25,000 restatement = +5,000 net.
    assert.equal(
      await revenueEarnedIn(JULY_KEY),
      julyBefore + rupees(5_000),
      "the correction nets to the delta in the open period",
    );

    await dropTestLocks();
  });

  await t.test("voiding is refused when there is nowhere legal to put the reversal", async () => {
    const src = `${TAG}-locked-2`;
    await tx((t2) => postEntry(t2, incomeDraft(JUNE, src, rupees(1_000))));
    await db.periodLock.createMany({
      data: [{ month: JUNE_KEY }, { month: JULY_KEY }],
      skipDuplicates: true,
    });

    // Previously `voidEntry` wrote via `journalEntry.create` directly, so it sailed past the
    // period lock that `postEntry` enforces and wrote into a closed month.
    await assert.rejects(
      () => tx((t2) => voidEntryForSource(t2, "INCOME", src, { reason: "edited", on: JULY })),
      (err: unknown) => err instanceof LedgerError && /locked/.test((err as Error).message),
      "both months closed must fail loudly, not write into a sealed period",
    );

    await dropTestLocks();
  });

  await t.test("the all-time trial balance still balances (the old guarantee, unbroken)", async () => {
    const tb = await getTrialBalance(db);
    assert.ok(tb.balanced, `trial balance out by ${tb.totalDebit - tb.totalCredit} paise`);
  });
});
