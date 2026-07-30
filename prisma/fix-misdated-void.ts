/**
 * Correct the reversals that the old `voidEntry` mis-dated.
 *
 * THE DAMAGE. Until 29 Jul 2026, voiding an entry dated the reversal `on` (the day of the edit)
 * while the caller's restatement kept the record's own date. The all-time trial balance still
 * balanced — original and mirror are both in the total, just in different months — so
 * `verify-ledger.ts` passed throughout and nothing surfaced it. But every PERIOD-scoped read saw:
 *
 *   · the original's month counting BOTH the voided original AND the restatement, and
 *   · the month of the edit carrying a bare reversal that belongs to no transaction.
 *
 * Live example this repairs: ₹45,000 "Income — Sandeep Rao (GN_BUNDLE)", original dated 24 Jun,
 * reversal dated 17 Jul, restatement correctly dated 24 Jun. June is overstated by ₹45,000 and
 * July understated by the same.
 *
 * WHY A CORRECTING PAIR RATHER THAN AN EDIT. `journal_entry` and `journal_line` are append-only at
 * the database — UPDATE and DELETE are both refused by trigger. That is the point of a ledger, and
 * it is not worked around here. Instead this posts two new, individually balanced entries:
 *
 *   A, dated in the ORIGINAL's month  — a mirror, cancelling the voided original where it sits
 *   B, dated in the REVERSAL's month  — an un-mirror, cancelling the marooned reversal
 *
 * A and B are exact opposites, so the all-time trial balance is untouched (it was already correct)
 * while both months become right. Every figure moves through `postEntry`, so the balance rule, the
 * period lock and the database triggers all apply — and the correction lands in the hash-chained
 * audit log like any other money write.
 *
 * NOT EVERY CROSS-MONTH REVERSAL IS THE BUG, and this distinction is the whole reason the script
 * refuses to sweep. When the original's period is LOCKED, the fixed `voidEntry` deliberately dates
 * BOTH halves into the current period — a closed month must not be restated — and "correcting"
 * that would swing the books the other way. The two are told apart by where the RESTATEMENT sits:
 *
 *   SPLIT        reversal in one month, restatement in the original's month → the defect
 *   CONSOLIDATED reversal and restatement together, away from the original  → deliberate, leave it
 *
 * Historical lock state cannot be recovered, so the classification is evidence, not proof. Hence:
 * the script REPORTS candidates and corrects only entry ids a human has named. A money repair
 * should never be something a script decides the scope of by itself.
 *
 *   npx tsx prisma/fix-misdated-void.ts                        # classify every voided entry
 *   npx tsx prisma/fix-misdated-void.ts --apply <id> [<id>…]   # correct exactly these
 */

import { PrismaClient, Prisma } from "@prisma/client";
import { appendAudit, monthKeyOf, postEntry, type DraftLine } from "../src/server/ledger-core";
import type { AccountCode } from "../src/lib/chart-of-accounts";

const prisma = new PrismaClient();
const APPLY = process.argv.includes("--apply");
/** Only these ids are corrected. Empty = report only, whatever else is passed. */
const TARGETS = new Set(process.argv.slice(2).filter((a) => !a.startsWith("--")));
const ONE = new Prisma.Decimal(1);
const rupees = (minor: bigint) => `₹${(Number(minor) / 100).toLocaleString("en-IN")}`;

/**
 * Say which database this is about to write to, out loud.
 *
 * The Prisma client reads `.env` on its own, so running this from the repo silently targets
 * PRODUCTION Supabase unless DATABASE_URL is overridden in the shell. For a script that posts
 * journal entries, "which database am I on" must never be an assumption.
 */
function announceTarget(): void {
  const url = process.env.DATABASE_URL ?? "";
  const host = url.match(/@([^/:]+)/)?.[1] ?? "unknown";
  const live = !/localhost|127\.0\.0\.1/.test(host);
  console.log(`\nDatabase: ${host}${live ? "   ← LIVE" : "   (local)"}`);
}

async function main() {
  announceTarget();
  const voided = await prisma.journalEntry.findMany({
    where: { status: "VOID" },
    include: { lines: { include: { account: { select: { code: true } } } } },
    orderBy: { date: "asc" },
  });

  console.log(`\n${voided.length} voided entr${voided.length === 1 ? "y" : "ies"} to check.\n`);
  const locks = new Set((await prisma.periodLock.findMany({ select: { month: true } })).map((l) => l.month));
  let fixed = 0;

  for (const original of voided) {
    const reversal = await prisma.journalEntry.findFirst({
      where: { reversalOfId: original.id },
      include: { lines: { include: { account: { select: { code: true } } } } },
    });
    if (!reversal) {
      console.log(`· ${original.id} — VOID with no reversal. Left alone; needs a human.`);
      continue;
    }

    const originalMonth = monthKeyOf(original.date);
    const reversalMonth = monthKeyOf(reversal.date);
    if (originalMonth === reversalMonth) {
      console.log(`· ${short(original.narration)} — already in one period (${originalMonth}). Nothing to do.`);
      continue;
    }

    // A correction that was itself already corrected: skip, or the books swing the other way.
    if (await alreadyCorrected(original.id)) {
      console.log(`· ${short(original.narration)} — a correction for this is already posted. Skipping.`);
      continue;
    }

    /**
     * Where the restatement landed is what separates the defect from correct locked-period
     * behaviour. No restatement at all means the void was a delete, which under the old code
     * left the original uncancelled in its own month — the same defect.
     */
    const restated = await prisma.journalEntry.findFirst({
      where: { sourceType: original.sourceType, sourceId: original.sourceId, status: "POSTED" },
      select: { date: true },
    });
    const restatedMonth = restated ? monthKeyOf(restated.date) : null;
    const consolidated = restatedMonth !== null && restatedMonth === reversalMonth;

    const value = original.lines.reduce((s, l) => s + l.baseDebitMinor, BigInt(0));
    console.log(`· ${short(original.narration)} — ${rupees(value)}   [${original.id}]`);

    if (consolidated) {
      console.log(`    CONSOLIDATED — reversal and restatement both in ${reversalMonth}, original alone in ${originalMonth}.`);
      console.log(`    That is what a LOCKED ${originalMonth} is supposed to look like. Leaving it alone.`);
      continue;
    }

    console.log(`    SPLIT — ${originalMonth} overstated (voided original + ${restatedMonth ? "its restatement" : "nothing to cancel it"}),`);
    console.log(`            ${reversalMonth} understated (a reversal belonging to ${originalMonth}).`);

    const blocked = [originalMonth, reversalMonth].filter((m) => locks.has(m));
    if (blocked.length) {
      console.log(`    SKIPPED — ${blocked.join(" and ")} locked; re-opening a closed month is your call, not mine.`);
      continue;
    }

    if (!TARGETS.has(original.id)) {
      console.log(`    → to correct: --apply ${original.id}`);
      continue;
    }
    console.log(`    → post a mirror in ${originalMonth} and an un-mirror in ${reversalMonth}`);

    if (!APPLY) {
      fixed++;
      continue;
    }

    await prisma.$transaction(async (tx) => {
      // A — cancel the voided original inside its OWN month.
      await postEntry(tx, {
        date: original.date,
        narration: `Period correction — cancels the voided "${original.narration}" in ${originalMonth}`,
        sourceType: "MANUAL",
        sourceId: null,
        postedById: original.postedById,
        lines: mirrorOf(original.lines),
      });
      // B — cancel the marooned reversal inside the month it was wrongly dated into.
      await postEntry(tx, {
        date: reversal.date,
        narration: `Period correction — cancels the ${reversalMonth} reversal of "${original.narration}", which belongs to ${originalMonth}`,
        sourceType: "MANUAL",
        sourceId: null,
        postedById: reversal.postedById,
        lines: mirrorOf(reversal.lines),
      });
      await appendAudit(tx, {
        actorId: original.postedById,
        action: "ledger.period-correction",
        entityType: "JournalEntry",
        entityId: original.id,
        payload: {
          reason: "reversal was dated into a different period than the entry it reverses",
          originalMonth,
          reversalMonth,
          valueMinor: value.toString(),
        },
      });
    });
    console.log(`    ✓ posted`);
    fixed++;
  }

  if (!TARGETS.size) {
    console.log(`\nReport only — no entry ids given, so nothing was written.\n`);
  } else {
    console.log(`\n${APPLY ? "Corrected" : "Would correct"} ${fixed} of ${TARGETS.size} named entr${TARGETS.size === 1 ? "y" : "ies"}.${APPLY ? "\n" : " Add --apply to post.\n"}`);
  }
}

/** Swap every leg. Base amounts are carried across verbatim so no FX rounding creeps in. */
function mirrorOf(lines: Array<{ account: { code: string }; currency: string; fxRate: Prisma.Decimal; isCogs: boolean; debitMinor: bigint; creditMinor: bigint }>): DraftLine[] {
  return lines.map((l) => ({
    accountCode: l.account.code as AccountCode,
    side: l.debitMinor > BigInt(0) ? ("credit" as const) : ("debit" as const),
    amountMinor: l.debitMinor > BigInt(0) ? l.debitMinor : l.creditMinor,
    currency: l.currency as "INR" | "EUR",
    // An INR line must carry rate 1 (enforced by CHECK journal_line_inr_base_identity).
    fxRate: l.currency === "INR" ? ONE : l.fxRate,
    isCogs: l.isCogs,
  }));
}

/** Re-running must be safe: the narration is the marker, since these entries carry no sourceId. */
async function alreadyCorrected(originalId: string): Promise<boolean> {
  const original = await prisma.journalEntry.findUniqueOrThrow({ where: { id: originalId }, select: { narration: true } });
  const n = await prisma.journalEntry.count({
    where: { narration: { contains: `Period correction — cancels the voided "${original.narration}"` } },
  });
  return n > 0;
}

const short = (s: string) => (s.length > 60 ? `${s.slice(0, 57)}…` : s);

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
