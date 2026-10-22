// Why is a B2 student being shown as German Note?
//
// READ-ONLY. Writes nothing.
//
// A business line is DERIVED, never stored (lib/business-line.ts): a level whose `kind` is
// GERMAN_LEVEL or GERMAN_BUNDLE is German Note, and EVERYTHING ELSE - including an unknown level -
// is B2. So a B2 student can only be displayed as German Note if the Level row their enrolment
// points at is actually kinded German. The same derivation drives the student code series
// (B2-0001 vs GN-0001), the Finance line filter, the month hero and the CSV exports, which is why
// one mis-kinded row shows up as "everything says German Note".
//
// This prints the live catalogue, then every enrolment's derived line, so the mis-kinded row names
// itself.
//
// Usage:
//   node --env-file=.env scripts/diagnose-level-lines.mjs

import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

const GERMAN_KINDS = new Set(["GERMAN_LEVEL", "GERMAN_BUNDLE"]);
const lineForKind = (kind) => (GERMAN_KINDS.has(kind) ? "GERMAN_NOTE" : "B2");
const pad = (s, n) => String(s ?? "").padEnd(n).slice(0, n);

async function main() {
  const host = (process.env.DIRECT_URL ?? process.env.DATABASE_URL ?? "").replace(
    /:\/\/([^:]+):[^@]+@/,
    "://$1:****@",
  );
  console.log(`Target : ${host || "(no DATABASE_URL set)"}`);
  console.log("Mode   : READ-ONLY\n");

  const levels = await prisma.level.findMany({ orderBy: [{ kind: "asc" }, { order: "asc" }] });
  console.log(`=== Level catalogue (${levels.length} rows) ===`);
  console.log(`${pad("CODE", 14)} ${pad("LABEL", 20)} ${pad("KIND", 16)} ${pad("ACTIVE", 7)} → LINE`);
  for (const l of levels) {
    const line = lineForKind(l.kind);
    // The coaching tiers are the ones that must never be German: SOLO/GUIDED/ELITE are B2.
    const suspect = /^(SOLO|GUIDED|ELITE)$/i.test(l.code) && line === "GERMAN_NOTE";
    console.log(
      `${pad(l.code, 14)} ${pad(l.label, 20)} ${pad(l.kind, 16)} ${pad(l.active, 7)} → ${line}` +
        (suspect ? "   ⚠ a B2 coaching tier kinded GERMAN - this is the bug" : ""),
    );
  }

  const byCode = new Map(levels.map((l) => [l.code, l.kind]));

  const enrolments = await prisma.enrollment.findMany({
    select: {
      programLevel: true,
      student: { select: { id: true, code: true, fullName: true } },
    },
  });

  console.log(`\n=== Enrolments (${enrolments.length}) ===`);
  console.log(`${pad("STUDENT", 24)} ${pad("CODE", 12)} ${pad("LEVEL", 14)} ${pad("KIND", 16)} → LINE`);
  const tally = { B2: 0, GERMAN_NOTE: 0 };
  for (const e of enrolments) {
    const kind = byCode.get(e.programLevel);
    const line = lineForKind(kind);
    tally[line]++;
    // The code series is allocated once at creation; if it disagrees with the level's line now,
    // the catalogue changed under it.
    const series = e.student?.code?.startsWith("GN-") ? "GERMAN_NOTE" : "B2";
    const drift = series !== line ? `   ⚠ code says ${series}` : "";
    console.log(
      `${pad(e.student?.fullName, 24)} ${pad(e.student?.code ?? "(none)", 12)} ${pad(
        e.programLevel,
        14,
      )} ${pad(kind ?? "(not in catalogue)", 16)} → ${line}${drift}`,
    );
  }

  console.log(`\nDerived: ${tally.B2} B2, ${tally.GERMAN_NOTE} German Note.`);
  console.log(
    "A level NOT in the catalogue derives B2, never German Note - so any German Note row above\n" +
      "comes from a Level row whose kind really is GERMAN_LEVEL/GERMAN_BUNDLE. Fix the kind in the\n" +
      "level catalogue and every derived view corrects itself; nothing is stored to backfill.",
  );
}

main()
  .catch((e) => {
    console.error("FAILED:", e.message);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
