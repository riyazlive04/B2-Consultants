"use server";

import { prisma } from "@/lib/prisma";
import { seatMechanism } from "@/lib/batch";
import { seatEnrollment, unseatEnrollment } from "./batch-actions";
import { addExistingMember, removeBatchMember } from "./german-note-actions";
import type { ActionResult } from "./finance-actions";

/**
 * SEATING, AS ONE JOB.
 *
 * A cohort has `targetStrength` seats and two different rows can occupy one: `Enrollment.batchId`
 * for a B2 coaching client, a `BatchMember` row for a German Note learner. Nothing in the schema
 * says which applies - `Batch.line` decides, by convention - and the two were written from
 * different screens by different actions with different permission fences.
 *
 * The visible consequence was the thing the founder complained about: you could not put learners
 * into a cohort FROM the cohort. The B2 writer lived on each student's own record, one enrolment
 * at a time, so filling a twelve-seat cohort meant twelve separate page loads; the German Note
 * writer lived on a different screen again; and the cohort's own Roster tab was read-only and
 * pointed at a board that has no such control.
 *
 * ── What this module is, and what it deliberately is not ────────────────────────────────
 * It is a DISPATCHER, not a new writer. Every write goes through the existing, tested action for
 * that mechanism - `seatEnrollment` / `unseatEnrollment` for B2, `addExistingMember` /
 * `removeBatchMember` for German Note. So capacity, the over-capacity prompt, the level/line
 * guard, the enrolment welcome, the activity log and each action's own permission check all keep
 * behaving exactly as they already do, and there is no second code path to drift.
 *
 * Unifying the two TABLES is a later, separate migration (docs/refactor/03-target-design.md, D1).
 * Unifying the ANSWER costs nothing and is what lets one control serve both lines today.
 *
 * ── A real inconsistency this surfaces rather than hides ────────────────────────────────
 * The two underlying actions do NOT guard alike:
 *
 *     seatEnrollment      requireCapability("batches.manage")
 *     addExistingMember   requireAdmin()
 *
 * So a Head coach granted `batches.manage` may seat a coaching client and may not add a German
 * Note member. That is pre-existing, it is not this module's call to change, and papering over it
 * would mean drawing a control the server then refuses - the precise failure the teaching desk
 * was corrected for. `canSeatBatch` (in batch-detail.ts) reports the real answer per line, so the
 * UI only ever offers what will actually be accepted.
 *
 * WRITES ONLY. This file is `"use server"`, so every export is a callable endpoint - the reads
 * that feed the picker (`canSeatBatch`, `listSeatCandidates`) live beside the cohort's other
 * reads in `batch-detail.ts`, under `server-only`.
 */

/**
 * Seat several people at once - the thing that turned twelve page loads into one.
 *
 * ── Why this is a loop and not a transaction ────────────────────────────────────────────
 * Each underlying action does more than write a row: it logs activity, claims a seat under a row
 * lock, and queues the enrolment welcome. Wrapping the set in one transaction would mean either
 * re-implementing all of that inline - a second code path, which this module exists to avoid - or
 * holding a lock open across however many sends the batch triggers.
 *
 * So it is deliberately PARTIAL-SUCCESS, and reports as such. Seating eight of ten and naming the
 * two that failed is strictly more useful than refusing all ten because the ninth was already
 * seated by somebody else a second earlier. The caller shows the summary.
 *
 * `confirmed` rides through to `seatEnrollment`'s over-capacity prompt: the founders overfill on
 * purpose, so going past target is a question, never a refusal.
 */
export async function addSeats(
  batchId: string,
  ids: string[],
  confirmed = false,
): Promise<ActionResult & { seated?: number; failures?: { id: string; error: string }[] }> {
  if (ids.length === 0) return { ok: false, error: "Pick at least one person" };

  const batch = await prisma.batch.findUnique({
    where: { id: batchId },
    select: { line: true, status: true },
  });
  if (!batch) return { ok: false, error: "Batch not found" };
  if (batch.status !== "ACTIVE") return { ok: false, error: "That cohort is archived" };

  const mechanism = seatMechanism(batch.line);
  const failures: { id: string; error: string }[] = [];
  let seated = 0;

  for (const id of ids) {
    const res =
      mechanism === "MEMBER"
        ? await addExistingMember(batchId, memberForm(id))
        : await seatEnrollment(id, batchId, confirmed);
    if (res.ok) seated++;
    else failures.push({ id, error: res.error });
  }

  // Nothing landed: report the first reason rather than a bare count, so the operator sees the
  // over-capacity prompt or the permission message instead of "0 seated".
  if (seated === 0) {
    return { ok: false, error: failures[0]?.error ?? "Could not seat anybody", failures };
  }
  return { ok: true, seated, failures };
}

/** `addExistingMember` takes a FormData, being a form action in its own right. */
function memberForm(studentId: string): FormData {
  const form = new FormData();
  form.set("studentId", studentId);
  return form;
}

/**
 * Take one person out of a cohort.
 *
 * `seatId` is whatever the roster row carries for that mechanism - an enrolment id on B2, a
 * `BatchMember` id on German Note. The two differ in more than name: unseating an enrolment sets
 * `batchId` to null and keeps the enrolment, while removing a member deletes the join row
 * outright. Both are the established behaviour of their own screen and are not changed here.
 */
export async function removeSeat(
  batchId: string,
  seatId: string,
): Promise<ActionResult> {
  const batch = await prisma.batch.findUnique({
    where: { id: batchId },
    select: { line: true },
  });
  if (!batch) return { ok: false, error: "Batch not found" };
  return seatMechanism(batch.line) === "MEMBER"
    ? removeBatchMember(seatId)
    : unseatEnrollment(seatId);
}
