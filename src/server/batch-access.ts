import "server-only";
import { prisma } from "@/lib/prisma";
import { hasCapability } from "@/lib/capabilities";

/**
 * WHO MAY RUN A COHORT'S DELIVERY - one rule, written once.
 *
 * ── Why this file exists ────────────────────────────────────────────────────────────────
 * The same question - "may this person act on this batch?" - had three separate
 * implementations: one in `attendance-actions.ts`, one in `batch-timetable-actions.ts`, and one
 * in `german-note-actions.ts`. They had already drifted (the German Note copy refuses anyone
 * who is not a TUTOR, the other two honour `batches.manage`), and every one of them carried a
 * comment warning that it must agree with the others. A rule that needs three copies and three
 * warnings is a rule that wants to be a function.
 *
 * ── What it governs, and what it deliberately does not ──────────────────────────────────
 * DELIVERY: the register, the timetable, the recordings and their viewing windows, the
 * coursework. Things the person standing in front of the class does.
 *
 * NOT German Note community moderation. `canManageBatch` in `german-note-actions.ts` stays as
 * it is, and stays stricter: it also decides who may delete a student's post in a batch's
 * discussion feed, and a Head coach being able to run a class does not imply they should be
 * able to remove somebody's writing. Widening that was never asked for, so it is not widened
 * here by accident.
 *
 * ── Why HEAD is in it ───────────────────────────────────────────────────────────────────
 * The founders asked for it twice, in their own words: "the tutor or the head coach enables
 * attendance", and "the head coach will also be updating the link of the meeting recording and
 * set the recording time until when they can watch". A head coach does stand in front of these
 * cohorts. They still cannot re-seat students or create batches - `canViewBatch` in
 * batch-detail.ts keeps returning `manage: false` for the cohort page's own edits, and the
 * capability keys they do not hold are unchanged.
 */

export type BatchActor = {
  role: string;
  user: { id: string };
  capabilities?: Record<string, boolean> | null;
};

/**
 * ADMIN, a Head coach, anyone holding `batches.manage`, or the person who leads this batch.
 *
 * Returns false for a batch that does not exist, rather than throwing: every caller is a server
 * action whose next line is a refusal message, and "not found" and "not yours" are the same
 * answer to someone probing ids.
 */
export async function canManageDelivery(actor: BatchActor, batchId: string): Promise<boolean> {
  if (actor.role === "ADMIN" || actor.role === "HEAD") return true;
  if (hasCapability(actor.role as never, (actor.capabilities ?? null) as never, "batches.manage")) {
    return true;
  }
  const batch = await prisma.batch.findUnique({ where: { id: batchId }, select: { tutorId: true } });
  return !!batch && batch.tutorId === actor.user.id;
}

/**
 * The same question without a batch in hand - "could this person act on SOME cohort?"
 *
 * Used by reads that decide whether to show a supervisor every cohort or only their own. It
 * answers about standing, not about a particular batch, so it never touches the database.
 */
export function mayManageAnyBatch(actor: BatchActor): boolean {
  return (
    actor.role === "ADMIN" ||
    actor.role === "HEAD" ||
    hasCapability(actor.role as never, (actor.capabilities ?? null) as never, "batches.manage")
  );
}
