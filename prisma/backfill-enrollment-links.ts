/**
 * Backfill Agreement / BookOrder / PendingPayment → Enrollment (ER v2 Track E).
 *
 *   npx tsx prisma/backfill-enrollment-links.ts          # report only, writes nothing
 *   npx tsx prisma/backfill-enrollment-links.ts --apply  # link the unambiguous ones
 *
 * ── The rule ─────────────────────────────────────────────────────────────────────
 * Link ONLY where the match is unambiguous: exactly one enrollment for that student at that
 * level. Zero matches or two-plus matches are LEFT NULL and printed.
 *
 * A wrongly attributed agreement is worse than an unattributed one. An unattributed row shows
 * as "not linked to a level" in the UI and someone who knows the answer fixes it; a wrongly
 * attributed one is silently believed forever, and it is a CONTRACT.
 *
 * Idempotent: rows that already carry an enrollmentId are skipped, so re-running after a
 * manual clean-up only picks up what is still outstanding.
 */

import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();
const APPLY = process.argv.includes("--apply");

type Unresolved = { table: string; id: string; who: string; level: string; reason: string };

async function main() {
  const unresolved: Unresolved[] = [];
  const linked = { agreement: 0, bookOrder: 0, pendingPayment: 0 };

  // Every enrollment, indexed by (student, level). The level is `programLevel` — the same
  // Level.code the three tables store, so the join needs no translation.
  const enrollments = await prisma.enrollment.findMany({
    select: { id: true, studentId: true, programLevel: true },
  });
  const byKey = new Map<string, string[]>();
  for (const e of enrollments) {
    const key = `${e.studentId}:${e.programLevel}`;
    byKey.set(key, [...(byKey.get(key) ?? []), e.id]);
  }

  const resolve = (studentId: string | null, level: string): { id: string } | { reason: string } => {
    if (!studentId) return { reason: "no student on the row" };
    const hits = byKey.get(`${studentId}:${level}`) ?? [];
    if (hits.length === 1) return { id: hits[0] };
    if (hits.length === 0) return { reason: `no enrollment at level ${level}` };
    return { reason: `${hits.length} enrollments at level ${level} — ambiguous` };
  };

  // ── BookOrder: has both studentId and level, so it resolves directly. ──────────
  const orders = await prisma.bookOrder.findMany({
    where: { enrollmentId: null },
    select: { id: true, studentId: true, level: true, student: { select: { fullName: true } } },
  });
  for (const o of orders) {
    const r = resolve(o.studentId, o.level);
    if ("id" in r) {
      if (APPLY) await prisma.bookOrder.update({ where: { id: o.id }, data: { enrollmentId: r.id } });
      linked.bookOrder++;
    } else {
      unresolved.push({ table: "BookOrder", id: o.id, who: o.student.fullName, level: o.level, reason: r.reason });
    }
  }

  // ── PendingPayment: same shape, level is `programLevel`. ───────────────────────
  const payments = await prisma.pendingPayment.findMany({
    where: { enrollmentId: null, deletedAt: null },
    select: { id: true, studentId: true, programLevel: true, studentName: true },
  });
  for (const p of payments) {
    const r = resolve(p.studentId, p.programLevel);
    if ("id" in r) {
      if (APPLY) await prisma.pendingPayment.update({ where: { id: p.id }, data: { enrollmentId: r.id } });
      linked.pendingPayment++;
    } else {
      unresolved.push({ table: "PendingPayment", id: p.id, who: p.studentName, level: p.programLevel, reason: r.reason });
    }
  }

  // ── Agreement: the level lives inside the FROZEN `data` blob, not in a column. ─
  // Read it, never re-join it: the blob is the snapshot of what was agreed, and a missing or
  // unexpected shape must produce an unresolved row rather than a guess at the level.
  const agreements = await prisma.agreement.findMany({
    where: { enrollmentId: null },
    select: { id: true, studentId: true, documentNo: true, data: true, student: { select: { fullName: true } } },
  });
  for (const a of agreements) {
    const level = readLevel(a.data);
    if (!level) {
      unresolved.push({
        table: "Agreement",
        id: a.id,
        who: a.student?.fullName ?? a.documentNo,
        level: "?",
        reason: "no readable level in the frozen agreement data",
      });
      continue;
    }
    const r = resolve(a.studentId, level);
    if ("id" in r) {
      if (APPLY) await prisma.agreement.update({ where: { id: a.id }, data: { enrollmentId: r.id } });
      linked.agreement++;
    } else {
      unresolved.push({
        table: "Agreement",
        id: a.id,
        who: a.student?.fullName ?? a.documentNo,
        level,
        reason: r.reason,
      });
    }
  }

  const total = linked.agreement + linked.bookOrder + linked.pendingPayment;
  console.log(`\n${APPLY ? "Linked" : "Would link"} ${total} row(s):`);
  console.log(`  Agreement      ${linked.agreement}`);
  console.log(`  BookOrder      ${linked.bookOrder}`);
  console.log(`  PendingPayment ${linked.pendingPayment}`);

  console.log(`\nLeft unlinked (deliberately — never guessed): ${unresolved.length}`);
  for (const u of unresolved.slice(0, 40)) {
    console.log(`  ${u.table.padEnd(15)} ${u.id}  ${u.who} · ${u.level} — ${u.reason}`);
  }
  if (unresolved.length > 40) console.log(`  … and ${unresolved.length - 40} more`);

  if (!APPLY) console.log("\nDry run. Re-run with --apply to write.\n");
  else console.log("\nDone. Unlinked rows appear in the UI as 'not linked to a level' for manual resolution.\n");
}

/** Pull a Level.code out of the frozen agreement blob, or null if it isn't clearly there. */
function readLevel(data: unknown): string | null {
  if (!data || typeof data !== "object") return null;
  const d = data as Record<string, unknown>;
  for (const key of ["programLevel", "level", "programme", "program"]) {
    const v = d[key];
    if (typeof v === "string" && v.trim()) return v.trim();
  }
  return null;
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
