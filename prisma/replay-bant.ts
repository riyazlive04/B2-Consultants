/**
 * THE TRACK D CUTOVER GATE (ER v2).
 *
 *   npx tsx prisma/replay-bant.ts
 *
 * Re-scores EVERY existing BookingRequest through the configurable question catalogue and
 * compares it with the shipped column-based scorer that produced the verdict actually used.
 *
 * ── The rule ─────────────────────────────────────────────────────────────────────
 * The public booking form is NOT switched to the catalogue until this reports
 * ZERO disagreements. Not "few", not "only on old rows" — zero.
 *
 * A disagreement here is a SEEDING BUG, never a rounding artefact: `catalogueFromIntake()`
 * derives its scores from the same tables `computeBant()` reads, so they cannot legitimately
 * differ. If this ever prints a non-zero count, the catalogue in the database has drifted
 * from the code (someone edited a question by hand, or a migration ran out of order) and the
 * fix is to re-seed, not to relax the gate.
 *
 * Why it matters: the BANT verdict decides who gets called. A silent scoring change is a
 * business incident, not a bug.
 *
 * Read-only. This script writes nothing.
 */

import { PrismaClient } from "@prisma/client";
import { computeBant, type BantInput } from "../src/lib/booking-intake";
import { scoreFromAnswers, bantResultsAgree, type QuestionSpec, type QuestionOption } from "../src/lib/qualification";

const prisma = new PrismaClient();

const PAGE = 500;

async function main() {
  const rows = await prisma.qualificationQuestion.findMany({
    where: { active: true },
    orderBy: [{ orderIndex: "asc" }],
  });

  if (rows.length === 0) {
    console.error("No active questions. Run `npx tsx prisma/seed-qualification.ts` first.");
    process.exitCode = 1;
    return;
  }

  const questions: QuestionSpec[] = rows.map((r) => ({
    key: r.key,
    version: r.version,
    text: r.text,
    helpText: r.helpText,
    kind: r.kind,
    options: (r.options as QuestionOption[] | null) ?? [],
    // The replay scores HISTORICAL booking-form submissions, which post our own option values —
    // it never reads an external payload, so the inbound mapping is irrelevant here and is
    // deliberately not merged in. Passing the real aliases would not change a single verdict;
    // passing them would just imply this path exercises them.
    inboundKeys: [],
    dimension: r.dimension,
    weight: r.weight,
    required: r.required,
    orderIndex: r.orderIndex,
  }));

  let checked = 0;
  const disagreements: { id: string; legacy: number; catalogue: number; verdicts: string }[] = [];
  let cursor: string | undefined;

  for (;;) {
    const page = await prisma.bookingRequest.findMany({
      take: PAGE,
      ...(cursor ? { skip: 1, cursor: { id: cursor } } : {}),
      orderBy: { id: "asc" },
      select: {
        id: true,
        readyToInvest: true,
        currentIncome: true,
        decisionMaking: true,
        alreadyApplied: true,
        commitment: true,
        whenStartGermany: true,
      },
    });
    if (page.length === 0) break;
    cursor = page.at(-1)!.id;

    for (const b of page) {
      const input: BantInput = {
        readyToInvest: b.readyToInvest,
        currentIncome: b.currentIncome,
        decisionMaking: b.decisionMaking,
        alreadyApplied: b.alreadyApplied,
        commitment: b.commitment,
        whenStartGermany: b.whenStartGermany,
      };
      const legacy = computeBant(input);
      const catalogue = scoreFromAnswers(input as Record<string, string | null>, questions);
      checked++;
      if (!bantResultsAgree(legacy, catalogue)) {
        disagreements.push({
          id: b.id,
          legacy: legacy.bantAvg,
          catalogue: catalogue.bantAvg,
          verdicts: `${legacy.bantVerdict} → ${catalogue.bantVerdict}`,
        });
      }
    }
  }

  console.log(`\nReplayed ${checked} booking${checked === 1 ? "" : "s"} through the catalogue.`);
  console.log(`Disagreements: ${disagreements.length}`);

  if (disagreements.length > 0) {
    console.log("\nThe catalogue in this database has DRIFTED from the shipped scorer.");
    console.log("Re-seed it (prisma/seed-qualification.ts). Do NOT flip the form.\n");
    for (const d of disagreements.slice(0, 25)) {
      console.log(`  ${d.id}  avg ${d.legacy} → ${d.catalogue}   ${d.verdicts}`);
    }
    if (disagreements.length > 25) console.log(`  … and ${disagreements.length - 25} more`);
    // Non-zero exit so this can gate a deploy step rather than relying on someone reading it.
    process.exitCode = 1;
    return;
  }

  console.log(
    checked === 0
      ? "\nNo bookings to replay yet — the gate is vacuous until real submissions exist.\n"
      : "\nGATE PASSED: the catalogue reproduces every historical verdict exactly.\n",
  );
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
