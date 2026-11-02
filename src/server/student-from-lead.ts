import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { allocateStudentCode } from "./student-code";
import { linkOrphanMoneyToStudent } from "./student-money-link";
import { logActivity } from "./activity-log";
import type { AppSession } from "@/lib/rbac";
import type { ActionResult } from "./finance-actions";

/**
 * Turn a lead into a Student. THE PERMISSION IS THE CALLER'S.
 *
 * Extracted from `convertLeadToStudent` because there are now two doors onto this step with two
 * different - both correct - permissions on them:
 *
 *   · Contacts → Convert to student is Admin, as it always was.
 *   · A signed agreement → "Enrol as a student" is `agreements.issue`, deliberately widened so
 *     whoever drafted, countersigned and sent the contract can also perform the clerical step it
 *     implies (see `agreement-enrol.ts`).
 *
 * The second door checked its capability, then called the first one - which re-guarded at
 * `requireAdmin()`. And `requireAdmin` REDIRECTS rather than returning an error, so a head coach
 * who clicked Enrol was thrown to the dashboard with no message at all: the widened permission
 * worked right up to the only branch that needed it.
 *
 * This function therefore performs no check of its own. Every caller must have made one.
 *
 * Carries the lead's name/email/phone/industry/source forward and stamps `Student.leadId` so the
 * two records stay joined. No enrollment is created - the programme level is not known at convert
 * time. Idempotent: a lead already converted returns its existing student.
 */
export async function createStudentFromLead(
  session: AppSession,
  leadId: string,
): Promise<ActionResult & { studentId?: string }> {
  const lead = await prisma.lead.findUnique({
    where: { id: leadId },
    select: { id: true, name: true, email: true, phone: true, industry: true, leadSource: true },
  });
  if (!lead) return { ok: false, error: "Lead not found" };

  const existing = await prisma.student.findFirst({ where: { leadId }, select: { id: true } });
  if (existing) return { ok: true, studentId: existing.id };

  const student = await prisma.student.create({
    data: {
      code: await allocateStudentCode(),
      fullName: lead.name,
      email: lead.email || null,
      phone: lead.phone || null,
      industry: lead.industry || null,
      leadSource: lead.leadSource,
      leadId: lead.id,
    },
  });

  // The same backfill every other door runs. It used to link income only here, so a converted
  // lead's instalment plan stayed detached and "paid so far" read zero against it.
  const linked = await linkOrphanMoneyToStudent({ studentId: student.id, fullName: student.fullName });

  await logActivity(session, {
    action: "student.convert",
    section: "students",
    entityType: "Student",
    entityId: student.id,
    summary: `Converted lead ${lead.name} into a student`,
    meta: { leadId: lead.id, incomeEntriesLinked: linked.incomes, plansLinked: linked.pendingPayments },
  });
  revalidatePath("/students");
  revalidatePath("/contacts");
  revalidatePath(`/contacts/${lead.id}`);
  revalidatePath("/finance");
  return { ok: true, studentId: student.id };
}
