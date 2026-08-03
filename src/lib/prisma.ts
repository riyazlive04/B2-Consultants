import { PrismaClient } from "@prisma/client";

const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

/**
 * `PRISMA_LOG_QUERIES=true` prints every statement.
 *
 * The one number that predicts how a page feels on the pooled Supabase connection is its ROUND
 * TRIP COUNT — at ~204ms RTT, twenty queries is four seconds no matter how fast each one is, and
 * a local timing (sub-millisecond RTT) hides that completely. This makes the count observable
 * before a change ships rather than after someone reports the page is slow.
 *
 * Development only, and off unless asked for: query logs contain lead PII.
 */
const logQueries = process.env.NODE_ENV === "development" && process.env.PRISMA_LOG_QUERIES === "true";

export const prisma =
  globalForPrisma.prisma ??
  new PrismaClient({
    log: logQueries
      ? ["query", "warn", "error"]
      : process.env.NODE_ENV === "development"
        ? ["warn", "error"]
        : ["error"],
  });

if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = prisma;
