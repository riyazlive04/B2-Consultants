/**
 * READ-ONLY audit for the migration proposals in docs/refactor/migrations/README.md.
 *
 * Runs the "report before applying" query of each one and prints the counts, so the proposals
 * carry real numbers rather than estimates. Performs NO writes of any kind.
 *
 *   npm run migration:audit
 */
import { PrismaClient } from "@prisma/client";
import { SEATED_STATUSES } from "../src/lib/enrollment-lifecycle";

const prisma = new PrismaClient();

async function m1Invoices() {
  console.log("\n── M1 · Invoice → Student ────────────────────────────────────────────");
  const total = await prisma.invoice.count();
  const withLead = await prisma.invoice.count({ where: { leadId: { not: null } } });
  console.log(`invoices: ${total}  ·  carrying a leadId: ${withLead}  ·  carrying none: ${total - withLead}`);

  if (withLead === 0) {
    console.log("  Nothing to backfill - every invoice would need its student set by hand.");
    return;
  }
  const rows = await prisma.invoice.findMany({
    where: { leadId: { not: null } },
    select: { id: true, lead: { select: { students: { select: { id: true } } } } },
  });
  const one = rows.filter((r) => (r.lead?.students.length ?? 0) === 1).length;
  const many = rows.filter((r) => (r.lead?.students.length ?? 0) > 1).length;
  const none = rows.filter((r) => (r.lead?.students.length ?? 0) === 0).length;
  console.log(`  resolve to exactly one student: ${one}  (these backfill automatically)`);
  console.log(`  resolve to several:             ${many}  (left null - needs a human)`);
  console.log(`  resolve to none:                ${none}  (lead never became a student)`);
}

async function m2Levels() {
  console.log("");
  console.log("── M2 · Level.code references ─────────────────────────────");
  const levels = new Set((await prisma.level.findMany({ select: { code: true } })).map((l) => l.code));
  console.log(`catalogue holds ${levels.size} level codes: ${[...levels].sort().join(", ")}`);

  /*
    ALL TWELVE columns that hold a `Level.code`, not the five the first version of this script
    checked. `Level` has no schema relations, so the only way to enumerate them is to read the
    schema - which is how the first pass missed seven of them and nearly declared the data clean
    on a third of the evidence.

    `kind` says what each one IS, because it decides whether a foreign key belongs on it:
      · "live"     - a current reference. Gets a foreign key in M2.
      · "snapshot" - what was true when a document was issued or a figure computed. Must NOT get
                     one: a level renamed afterwards has to leave the record saying what it said.
  */
  const COLUMNS: {
    label: string;
    kind: "live" | "snapshot";
    load: () => Promise<(string | null)[]>;
  }[] = [
    {
      label: "enrollment.programLevel",
      kind: "live",
      load: async () => (await prisma.enrollment.findMany({ select: { programLevel: true } })).map((r) => r.programLevel),
    },
    {
      label: "batch.level",
      kind: "live",
      load: async () => (await prisma.batch.findMany({ select: { level: true } })).map((r) => r.level),
    },
    {
      label: "lead.wonLevel",
      kind: "live",
      load: async () => (await prisma.lead.findMany({ select: { wonLevel: true } })).map((r) => r.wonLevel),
    },
    {
      label: "product.levelCode",
      kind: "live",
      load: async () => (await prisma.product.findMany({ select: { levelCode: true } })).map((r) => r.levelCode),
    },
    {
      label: "curriculumTemplate.levelCode",
      kind: "live",
      load: async () => (await prisma.curriculumTemplate.findMany({ select: { levelCode: true } })).map((r) => r.levelCode),
    },
    {
      label: "programMilestone.levelCode",
      kind: "live",
      load: async () => (await prisma.programMilestone.findMany({ select: { levelCode: true } })).map((r) => r.levelCode),
    },
    {
      label: "gnPendingJoiner.level",
      kind: "live",
      load: async () => (await prisma.gnPendingJoiner.findMany({ select: { level: true } })).map((r) => r.level),
    },
    {
      label: "pendingPayment.programLevel",
      kind: "live",
      load: async () => (await prisma.pendingPayment.findMany({ select: { programLevel: true } })).map((r) => r.programLevel),
    },
    // ── Snapshots below: reported, never constrained ──
    {
      label: "income.programLevel",
      kind: "snapshot",
      load: async () => (await prisma.income.findMany({ select: { programLevel: true } })).map((r) => r.programLevel),
    },
    {
      label: "invoiceLineItem.levelCode",
      kind: "snapshot",
      load: async () => (await prisma.invoiceLineItem.findMany({ select: { levelCode: true } })).map((r) => r.levelCode),
    },
    {
      label: "tutorFee.level",
      kind: "snapshot",
      load: async () => (await prisma.tutorFee.findMany({ select: { level: true } })).map((r) => r.level),
    },
    {
      label: "bookOrder.level",
      kind: "snapshot",
      load: async () => (await prisma.bookOrder.findMany({ select: { level: true } })).map((r) => r.level),
    },
  ];

  let blocking = 0;
  let snapshotNoise = 0;

  for (const col of COLUMNS) {
    const values = await col.load();
    const orphans = new Map<string, number>();
    for (const v of values) {
      if (v === null || v === "") continue;
      if (!levels.has(v)) orphans.set(v, (orphans.get(v) ?? 0) + 1);
    }
    const bad = [...orphans.values()].reduce((a, b) => a + b, 0);
    if (col.kind === "live") blocking += bad;
    else snapshotNoise += bad;
    console.log(
      `  ${col.kind === "live" ? "FK " : "   "}${col.label.padEnd(30)} rows=${String(values.length).padEnd(6)} unknown=${bad}` +
        (bad ? `  → ${[...orphans].map(([k, n]) => `${k}×${n}`).join(", ")}` : ""),
    );
  }

  console.log(
    blocking === 0
      ? "  ✓ every column that would GET a foreign key is clean - M2 can be applied."
      : `  ✗ ${blocking} row(s) in foreign-key columns hold a code the catalogue does not have. ` +
          `Fix these FIRST or the constraints will refuse to be created.`,
  );
  if (snapshotNoise > 0) {
    console.log(
      `  ℹ ${snapshotNoise} row(s) in SNAPSHOT columns hold an unknown code. That is expected and ` +
        `is NOT fixed: a frozen document or a computed fee records what was true at the time.`,
    );
  }
}

async function m3Drift() {
  console.log("\n── M3 · Lead.stage vs the board column ───────────────────────────────");
  const opps = await prisma.opportunity.findMany({
    where: { deletedAt: null, lead: { deletedAt: null } },
    select: {
      lead: { select: { id: true, name: true, stage: true } },
      stage: {
        select: {
          legacyStage: true,
          pipeline: { select: { isDefault: true, deletedAt: true } },
        },
      },
    },
  });
  const onDefault = opps.filter((o) => o.stage?.pipeline?.isDefault && !o.stage.pipeline.deletedAt);
  const drifted = onDefault.filter((o) => o.stage!.legacyStage !== o.lead!.stage);
  console.log(`cards on the default board: ${onDefault.length}  ·  disagreeing with the lead: ${drifted.length}`);
  for (const d of drifted.slice(0, 10)) {
    console.log(`  ${d.lead!.name}: lead says ${d.lead!.stage}, board says ${d.stage!.legacyStage}`);
  }
  if (drifted.length > 10) console.log(`  … and ${drifted.length - 10} more`);
  if (drifted.length === 0) console.log("  ✓ nothing has drifted - the seam has held.");
}

async function m4Membership() {
  console.log("\n── M4 · The two membership mechanisms ────────────────────────────────");
  const batches = await prisma.batch.findMany({
    select: {
      name: true,
      line: true,
      _count: {
        select: {
          members: true,
          enrollments: { where: { status: { in: [...SEATED_STATUSES] } } },
        },
      },
    },
  });
  const members = batches.reduce((a, b) => a + b._count.members, 0);
  const seated = batches.reduce((a, b) => a + b._count.enrollments, 0);
  console.log(`cohorts: ${batches.length}  ·  BatchMember rows: ${members}  ·  seated enrolments: ${seated}`);
  console.log(`stage 1 would create ${seated} member row(s) from seated enrolments.`);

  const mixed = batches.filter((b) => b._count.members > 0 && b._count.enrollments > 0);
  console.log(
    mixed.length === 0
      ? "  ✓ no cohort uses both mechanisms - the line convention has held."
      : `  ⚠ ${mixed.length} cohort(s) use BOTH, which levelFitsBatchLine is meant to prevent:`,
  );
  for (const b of mixed) {
    console.log(`     ${b.name} (${b.line}): ${b._count.members} members + ${b._count.enrollments} enrolments`);
  }
}

async function main() {
  console.log("READ-ONLY. No writes. Database:", process.env.DATABASE_URL?.split("@")[1]?.split("/")[0] ?? "(unknown host)");
  await m1Invoices();
  await m2Levels();
  await m3Drift();
  await m4Membership();
  console.log("\nDone. Nothing was written.");
}

main()
  .then(() => prisma.$disconnect())
  .catch(async (e) => {
    console.error(e);
    await prisma.$disconnect();
    process.exit(1);
  });
