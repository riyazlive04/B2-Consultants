"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { requireAdmin } from "@/lib/rbac";
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
): Promise<ActionResult<{ studentId: string; created: boolean }>> {
  const session = await requireAdmin();

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
  if (existing.length > 1) {
    return {
      ok: false,
      error: `${row.lead.name} already has ${existing.length} student records - open the right one and link it by hand rather than creating another.`,
    };
  }

  let studentId: string;
  let created: boolean;
  if (existing.length === 1) {
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
