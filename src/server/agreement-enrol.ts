"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { capabilityCheck } from "@/lib/rbac";
import { logActivity } from "./activity-log";
import { convertLeadToStudent } from "./students-actions";
import type { ActionResult } from "./agreement-core";

// The decision rule lives in @/lib/agreement-enrol and is imported from there directly. It cannot
// even be RE-exported here: this file is `"use server"`, where every export must be an async
// function, and `tsc` does not catch the violation - `next build` does.

/**
 * The step between a signed agreement and a student who exists.
 *
 * WHY THIS EXISTS. `signAgreement` deliberately creates nothing: it seals the PDF, writes the
 * audit trail and sends the countersigned copy, and the lifecycle then ends at COMPLETED. Turning
 * the signatory into a Student was a manual trip to Contacts -> "Convert to student", and the
 * portal login another to Students -> "Create login" - two disconnected screens, neither of them
 * mentioned anywhere on the agreement. The predictable result was a signed client who never became
 * a student at all, which is how this surfaced: "after signing, account creation is not working".
 *
 * This is deliberately a PROMPT, not an automatic consequence of signing. Enrolment picks a
 * programme level, a coach and a code series; `convertLeadToStudent` creates no enrolment for
 * exactly that reason ("the program level isn't known at convert time"). Doing it silently inside
 * the signing request would also put a student-record write on the student's own signature - a
 * failure there must never cost somebody a signature they already made.
 *
 * It reuses `convertLeadToStudent` rather than creating a second Student-creation path: that one
 * is already idempotent, carries name/email/phone/industry/source across, and stamps
 * `Student.leadId` so the two records stay joined.
 */

/**
 * Create (or adopt) the Student this signed agreement belongs to, and link the two.
 *
 * Returns the student id so the caller can send the admin straight there - the programme level and
 * the portal login are both set on the student record, and landing anywhere else just means
 * hunting for it.
 */
export async function enrolFromAgreement(
  agreementId: string,
  /**
   * Which existing student this document binds, when the lead has more than one (issue C6).
   *
   * Omitted in the normal case. Supplied only from the picker the `ambiguous` card now renders -
   * see the `existing.length > 1` branch below for why the server will not guess, and why being
   * TOLD is different from guessing.
   */
  adoptStudentId?: string,
): Promise<ActionResult<{ studentId: string; created: boolean }>> {
  /**
   * ── WIDENED FROM `requireAdmin()` TO THE AGREEMENTS CAPABILITY  (issue C5) ─────────────
   *
   * This was admin-only, which put the founder in the middle of a step they are not needed for.
   * Whoever holds `agreements.issue` DRAFTED this contract, COUNTERSIGNED it and SENT it - the
   * three acts that commit the business - and then could not perform the clerical step of
   * creating the student record it implies. A Head coach who closed the deal had to wait for the
   * founder, and the predictable outcome is the one that produced this issue in the first place:
   * "after signing, account creation is not working", because a signed client sat with no
   * student record and nobody whose job it was to make one.
   *
   * `capabilityCheck` rather than `requireCapability`, so a refusal returns to the card the
   * person is standing on instead of flinging them to the dashboard - the distinction rbac.ts
   * draws between a page guard and an action guard.
   *
   * ADMIN holds every capability implicitly, so nothing the founder could do before is lost.
   */
  const { allowed, denied, session } = await capabilityCheck("agreements.issue");
  if (!allowed) return denied;

  const row = await prisma.agreement.findUnique({
    where: { id: agreementId },
    select: {
      id: true,
      documentNo: true,
      signedAt: true,
      studentId: true,
      leadId: true,
      lead: { select: { id: true, name: true, students: { select: { id: true, code: true } } } },
    },
  });
  if (!row) return { ok: false, error: "Agreement not found." };

  /**
   * Signature first. Enrolling off an unsigned agreement would create a student for a deal that
   * has not closed - and a draft's fee and level can still change under it.
   */
  if (!row.signedAt) {
    return { ok: false, error: "This agreement has not been signed yet." };
  }

  if (row.studentId) return { ok: true, data: { studentId: row.studentId, created: false } };

  if (!row.lead) {
    return {
      ok: false,
      error:
        "This agreement was raised against no contact, so there is nobody to enrol. Clone it onto a contact first.",
    };
  }

  // Already a student under this lead: adopt it rather than minting a second one.
  const existing = row.lead.students;

  let studentId: string;
  let created: boolean;
  if (existing.length > 1) {
    /**
     * ── MORE THAN ONE STUDENT UNDER THIS CONTACT  (issue C6) ────────────────────────────
     *
     * The refusal to GUESS stays, and it is right: a contract binds one named person, and
     * picking between two student records on the strength of them sharing a lead would attach
     * somebody's signed agreement - and their fee, and their instalment plan - to the wrong
     * person. Nothing about that has changed.
     *
     * What was missing is the other half. The old code returned a dead end ("open the right one
     * and link it by hand") and offered no way to do it, so the one case the rule exists for was
     * also the one case with no path forward. Being TOLD which student is not guessing, so the
     * action now accepts an explicit choice - and verifies it belongs to this lead, because the
     * id arrives as a parameter and the UI's offer is only a suggestion.
     */
    if (!adoptStudentId) {
      return {
        ok: false,
        error: `${row.lead.name} has ${existing.length} student records - pick the one this agreement belongs to.`,
      };
    }
    const chosen = existing.find((st) => st.id === adoptStudentId);
    if (!chosen) {
      // Not "not yours" - the same answer for an id that is not under this lead and an id that
      // does not exist, so nothing here reports which student ids are real.
      return { ok: false, error: "That student is not one of this contact's records." };
    }
    studentId = chosen.id;
    created = false;
  } else if (existing.length === 1) {
    studentId = existing[0].id;
    created = false;
  } else {
    const res = await convertLeadToStudent(row.lead.id);
    if (!res.ok || !res.studentId) {
      return { ok: false, error: res.ok ? "Could not create the student record." : res.error };
    }
    studentId = res.studentId;
    created = true;
  }

  // Link the document to the person. Without this the agreement keeps resolving the student
  // through the lead, and a second student under that lead later makes it ambiguous forever.
  await prisma.agreement.update({ where: { id: row.id }, data: { studentId } });

  await logActivity(session, {
    action: "agreement.enrol",
    section: "agreements",
    entityType: "Agreement",
    entityId: row.id,
    summary: created
      ? `Enrolled ${row.lead.name} from agreement ${row.documentNo}`
      : `Linked agreement ${row.documentNo} to ${row.lead.name}'s existing student record`,
    meta: { documentNo: row.documentNo, studentId, leadId: row.lead.id, created },
  });

  revalidatePath(`/agreements/${row.id}`);
  revalidatePath("/agreements");
  revalidatePath("/students");
  return { ok: true, data: { studentId, created } };
}
