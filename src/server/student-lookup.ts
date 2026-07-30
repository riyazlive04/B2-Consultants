import "server-only";
import { cache } from "react";
import { prisma } from "@/lib/prisma";

/**
 * The Student row id for a signed-in login, or null if this login is not a student.
 *
 * `cache()`-wrapped so the three student-portal reads that each need it — journey, agreements,
 * payments — resolve it with ONE query per request instead of three. They run in parallel, so
 * without this each would independently `findUnique` the same row; on the single-connection prod
 * pool those three identical lookups serialise on the wire (~600ms) for no reason.
 */
export const studentIdForUser = cache(async (userId: string): Promise<string | null> => {
  const student = await prisma.student.findUnique({ where: { userId }, select: { id: true } });
  return student?.id ?? null;
});
