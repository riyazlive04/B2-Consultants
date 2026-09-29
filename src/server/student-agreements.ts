import "server-only";
import { cache } from "react";
import { prisma } from "@/lib/prisma";
import { studentIdForUser } from "@/server/student-lookup";

/**
 * A student's own agreements (rebuild spec §10: "own agreement - view, download, signature
 * status"), for the signed-in student portal.
 *
 * THE GAP THIS CLOSES. The signed copy has always been reachable at `/agreement/<token>/copy`, and
 * the sign ceremony now links to it - but both of those are TOKEN routes, reached from a WhatsApp
 * message. A student who signs, closes the tab and later signs into the app had no route back to
 * their own contract from inside the product. The token is single-use-ish and easily lost; their
 * login is not.
 *
 * Kept in its own module rather than added to `student-portal.ts` because that file enforces a
 * deliberate privacy line at the query layer ("NO money, NO internal notes, NO manual signal") and
 * mixing a differently-scoped read into it would blur the rule it exists to state.
 *
 * Deliberately NOT returned: `pdfBytes` (streamed by the existing download route, never through a
 * page payload), and any internal notes on the agreement.
 */

export type StudentAgreement = {
  readonly id: string;
  readonly status: string;
  readonly issuedAt: string | null;
  readonly signedAt: string | null;
  /** Present only once signed - the sealed PDF is what they download. */
  readonly canDownload: boolean;
};

export const getMyAgreements = cache(async (userId: string): Promise<StudentAgreement[]> => {
  const studentId = await studentIdForUser(userId);
  if (!studentId) return [];

  const rows = await prisma.agreement.findMany({
    // DRAFT is excluded: it is the founder's working copy and the student is not a party to it
    // until it is issued. Showing it would promise a contract that may never be sent.
    where: { studentId, status: { not: "DRAFT" } },
    select: { id: true, status: true, issuedAt: true, signedAt: true, pdfSha256: true },
    orderBy: { createdAt: "desc" },
  });

  return rows.map((a) => ({
    id: a.id,
    status: String(a.status),
    issuedAt: a.issuedAt?.toISOString() ?? null,
    signedAt: a.signedAt?.toISOString() ?? null,
    // Gate on the sealed artefact existing, not on the status column - a SIGNED row whose PDF
    // never sealed would otherwise offer a download that 404s.
    canDownload: a.status === "SIGNED" && !!a.pdfSha256,
  }));
});
