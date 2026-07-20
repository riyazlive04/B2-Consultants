import "server-only";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { formatStudentCode, nextStudentNumber } from "@/lib/student-code";

/**
 * Hand out the next student number (§6.1).
 *
 * Every path that can mint a Student goes through here — the admin form, lead conversion,
 * the CSV import and German Note self-enrolment — so a student can never arrive without a
 * code and reintroduce the duplicate-name ambiguity this was built to remove.
 *
 * Accepts a transaction client so a caller already inside `$transaction` allocates against
 * the same snapshot it will write in. The UNIQUE index on `student.code` is the real
 * guarantee: if two creations ever race, the database rejects the loser rather than
 * quietly issuing the same number twice.
 */
export async function allocateStudentCode(
  db: Prisma.TransactionClient | typeof prisma = prisma,
): Promise<string> {
  const rows = await db.student.findMany({
    where: { code: { not: null } },
    select: { code: true },
  });
  return formatStudentCode(nextStudentNumber(rows.map((r) => r.code)));
}
