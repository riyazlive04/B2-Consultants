import "server-only";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { formatStudentCode, nextStudentNumber } from "@/lib/student-code";
import { lineForKind, type BusinessLine } from "@/lib/business-line";
import { getLevels } from "./levels";

/**
 * Hand out the next student number (§6.1).
 *
 * Every path that can mint a Student goes through here - the admin form, lead conversion,
 * the CSV import and German Note self-enrolment - so a student can never arrive without a
 * code and reintroduce the duplicate-name ambiguity this was built to remove.
 *
 * TWO SERIES. B2 students are numbered B2-0001… and German Note students GN-0001…, each with
 * its own counter (lib/student-code). The caller says which, and `lineForLevel` below derives
 * it from the programme level wherever one is in hand - which is every path that matters, since
 * a student is always minted alongside the thing they enrolled in or paid for.
 *
 * Accepts a transaction client so a caller already inside `$transaction` allocates against
 * the same snapshot it will write in. The UNIQUE index on `student.code` is the real
 * guarantee: if two creations ever race, the database rejects the loser rather than
 * quietly issuing the same number twice.
 */
export async function allocateStudentCode(
  db: Prisma.TransactionClient | typeof prisma = prisma,
  line: BusinessLine = "B2",
): Promise<string> {
  const rows = await db.student.findMany({
    where: { code: { not: null } },
    select: { code: true },
  });
  return formatStudentCode(nextStudentNumber(rows.map((r) => r.code), line), line);
}

/**
 * Which series a programme level belongs to - a German level or bundle is German Note, anything
 * else is B2. Reads the configurable level catalogue (cached across requests), so a level the
 * founder adds later numbers correctly with no code change.
 *
 * An unknown level falls back to B2, matching `lineForKind`: an unrecognised level has never
 * meant "German Note" anywhere else in the app and must not start meaning it here.
 */
export async function lineForLevel(levelCode: string | null | undefined): Promise<BusinessLine> {
  if (!levelCode) return "B2";
  const levels = await getLevels();
  return lineForKind(levels.find((l) => l.code === levelCode)?.kind);
}
