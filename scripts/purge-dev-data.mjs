// Remove demo/seed rows and test traffic from the shared Supabase database, so that arming
// WhatsApp cannot message anybody who did not ask to hear from us.
//
//   node -r dotenv/config scripts/purge-dev-data.mjs            # dry run (rolls back)
//   node -r dotenv/config scripts/purge-dev-data.mjs --apply    # commits
//
// The dry run is not a prediction: it performs every delete inside a transaction and then
// throws, so Postgres rolls the whole thing back. What it prints is what actually happened,
// including any FK or append-only-trigger failure that a "count the rows first" dry run
// would have missed entirely.
//
// ── What is kept, and why ────────────────────────────────────────────────────────
// The demo seeder (prisma/demo-data.ts) ran on 2026-07-09. Every financial row created that
// day is its output; everything entered afterwards was typed by a human and is real money:
//   · 15 income rows (Aakash 17/07 + fourteen rows entered 08-09/08) = ₹6,00,874
//   · 9 expenses (Lalith 17/07; Grazy ×5 and SIRAH DIGITAL INDIA 08/08)
//   · 1 payable (Riyaz 20/07)
//   · both invoices (11/07, 20/07)
// Those are excluded by date, never by name. Also untouched: appointment slots (Ameen's and
// Asma's published availability), users, team profiles, AppSetting, and the reference tables.
import { PrismaClient } from "@prisma/client";
import { existsSync } from "node:fs";

const prisma = new PrismaClient();
const APPLY = process.argv.includes("--apply");

// The purge is only safe because the backup exists. Refuse to run without it.
const BACKUP = `prelaunch-reset-backup-${new Date().toISOString().slice(0, 10)}.json`;
if (!existsSync(BACKUP)) {
  console.error(`ERROR: ${BACKUP} not found. Run scripts/backup-before-purge.mjs first.`);
  process.exit(1);
}

// End of the demo seeder's day, in IST (UTC+5:30). Anything at or before this instant that
// the seeder created is demo; anything after was entered by hand.
const SEED_DAY_END = new Date("2026-07-09T18:29:59.999Z");
const seededOn0709 = { createdAt: { lte: SEED_DAY_END } };

const log = [];
let kept = null;
const run = async (label, fn) => {
  const n = await fn();
  const count = typeof n === "number" ? n : n?.count ?? 0;
  log.push([label, count]);
  return count;
};

class Rollback extends Error {}

try {
  await prisma.$transaction(
    async (tx) => {
      // ── 1. Message logs first: they carry FKs to nearly everything below. ──
      await run("whatsAppMessage", () => tx.whatsAppMessage.deleteMany({}));
      await run("message (email log)", () => tx.message.deleteMany({}));

      // ── 2. Agreements. Two constraints shape this one:
      //      · agreementEvent is append-only, so it must go by CASCADE from its parent
      //        (pg_trigger_depth > 1), never by a direct deleteMany.
      //      · a Postgres trigger refuses to delete a SIGNED agreement at all - it is an
      //        executed legal document. B2-GM-2026-0002 (signed 17/07) is one, so only
      //        unsigned drafts are purged. The survivors' studentId/leadId are SetNull, so
      //        they detach cleanly when the student and lead rows go below.
      await run("agreement, unsigned only (+events)", () =>
        tx.agreement.deleteMany({ where: { signedAt: null } }),
      );

      // ── 3. Receivables: the rows that generate the false "5 overdue payments" alert and
      //      that the dunning ladder would chase. All six are demo names. ──
      await run("instalment", () => tx.instalment.deleteMany({}));
      await run("pendingPayment", () => tx.pendingPayment.deleteMany({}));

      // ── 4. Students and their memberships. All five are seeder output (@example.com,
      //      +91 98111 55xxx) plus one junk row typed during a test. ──
      await run("batchMember", () => tx.batchMember.deleteMany({}));
      await run("student", () => tx.student.deleteMany({}));

      // ── 5. Everything holding a contactable stranger. Booking slots are freed back to
      //      OPEN first, or the calendar keeps showing them as taken by a booking that no
      //      longer exists. ──
      const booked = await tx.bookingRequest.findMany({ select: { slotId: true } });
      const slotIds = booked.map((b) => b.slotId).filter(Boolean);
      if (slotIds.length) {
        await run("appointmentSlot -> OPEN", () =>
          tx.appointmentSlot.updateMany({ where: { id: { in: slotIds } }, data: { status: "OPEN" } }),
        );
      }
      await run("bookingRequest", () => tx.bookingRequest.deleteMany({}));
      await run("formSubmission", () => tx.formSubmission.deleteMany({}));
      await run("opportunity", () => tx.opportunity.deleteMany({}));
      // Lead last: the cascade takes stage history, outreach journeys, step logs, consent
      // records, call logs, answers, discovery outcomes, notes and tasks with it.
      await run("lead (+cascade)", () => tx.lead.deleteMany({}));

      // ── 6. Seeded financials only. Date-scoped, so the real August rows survive. ──
      await run("income (dated <= 09/07)", () =>
        tx.income.deleteMany({ where: { date: { lte: SEED_DAY_END } } }),
      );
      await run("expense (seeded 09/07)", () => tx.expense.deleteMany({ where: seededOn0709 }));
      await run("payable (seeded 09/07)", () => tx.payable.deleteMany({ where: seededOn0709 }));
      await run("cashPosition (seeded 09/07)", () =>
        tx.cashPosition.deleteMany({ where: seededOn0709 }),
      );
      await run("weeklyFunnelSnapshot", () => tx.weeklyFunnelSnapshot.deleteMany({}));

      // Survivors are counted INSIDE the transaction, after the deletes. Counting them
      // afterwards would run post-rollback on a dry run and report the pre-purge totals -
      // the one number a dry run must not get wrong.
      kept = {
        income: await tx.income.count(),
        incomeInr: Number((await tx.income.aggregate({ _sum: { amountInrMinor: true } }))._sum.amountInrMinor ?? 0),
        expense: await tx.expense.count(),
        payable: await tx.payable.count(),
        invoice: await tx.invoice.count(),
        agreement: await tx.agreement.count(),
        appointmentSlot: await tx.appointmentSlot.count(),
      };

      if (!APPLY) throw new Rollback();
    },
    { timeout: 120_000 },
  );
} catch (e) {
  if (!(e instanceof Rollback)) {
    console.error("\nFAILED - nothing was committed:\n", e);
    await prisma.$disconnect();
    process.exit(1);
  }
}

const width = Math.max(...log.map(([l]) => l.length));
let total = 0;
for (const [label, n] of log) {
  total += label.startsWith("appointmentSlot") ? 0 : n;
  console.log(`  ${label.padEnd(width)}  ${String(n).padStart(4)}`);
}
console.log(`\n  ${"TOTAL DELETED".padEnd(width)}  ${String(total).padStart(4)}`);

// Survivors, printed every run: the whole point is that these are still here.
console.log(
  `\n  KEPT: ${kept.income} income (₹${(kept.incomeInr / 100).toLocaleString("en-IN")}), ` +
    `${kept.expense} expense, ${kept.payable} payable, ${kept.invoice} invoice, ` +
    `${kept.agreement} signed agreement, ${kept.appointmentSlot} slots`,
);
console.log(APPLY ? "\nAPPLIED - committed." : "\nDRY RUN - transaction rolled back, nothing changed.");

await prisma.$disconnect();
