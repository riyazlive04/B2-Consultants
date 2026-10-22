import { Users } from "lucide-react";
import { PageHeader } from "@/components/ui/kit";
import { requireCapability, requireSection } from "@/lib/rbac";
import { prisma } from "@/lib/prisma";
import { getDefaultTemplateChoice, listUsableTemplates } from "@/server/agreement-templates";
import { getSavedSignature } from "@/server/founder-config";
import { requireSession } from "@/lib/rbac";
import { BulkSend } from "./_components/BulkSend";
import { AgreementNav } from "../_components/AgreementNav";

/**
 * Issue one document to a group of students - a workshop waiver, a batch-wide addendum.
 *
 * Gated on a SAVED COUNTERSIGNATURE being present, and that gate is on the page rather than only
 * in the action: without one there is nothing to countersign fifty agreements with, and finding
 * that out after picking fifty students would be the worst place to learn it.
 */

export const metadata = { title: "Bulk agreements" };
export const dynamic = "force-dynamic";

export default async function BulkAgreementsPage() {
  await requireSection("agreements");
  await requireCapability("agreements.issue");
  const session = await requireSession();

  const [students, templates, saved, defaultDoc] = await Promise.all([
    prisma.student.findMany({
      select: {
        id: true,
        fullName: true,
        code: true,
        /**
         * The level comes from the most recent ENROLMENT, not the student.
         *
         * `Student` has no level of its own - a person can sit more than one programme - so the
         * list shows what they were last enrolled on, purely to tell two people with similar
         * names apart. Nothing is decided by it; the agreement's own terms come from the prefill.
         */
        enrollments: {
          select: { programLevel: true },
          orderBy: { enrollmentDate: "desc" },
          take: 1,
        },
      },
      orderBy: { fullName: "asc" },
      take: 500,
    }),
    listUsableTemplates(),
    getSavedSignature(session.user.id),
    getDefaultTemplateChoice(),
  ]);

  return (
    <div className="w-full space-y-6">
      <PageHeader
        icon={<Users size={20} />}
        title="Send in bulk"
        subtitle="One document, many students - each with their own agreement, link and audit trail."
      />

      <AgreementNav />

      {!saved ? (
        <div className="rounded-card border border-warn/40 bg-warn-soft px-5 py-4">
          <p className="text-sm font-semibold text-warn">Save your countersignature first</p>
          <p className="mt-1 text-sm text-ink-2">
            Bulk sending countersigns every agreement with your stored signature. Draw it once on any
            draft agreement (&ldquo;Countersign &amp; send&rdquo; offers to remember it), and this page
            will work from then on.
          </p>
        </div>
      ) : (
        <BulkSend
          students={students.map((s) => ({
            id: s.id,
            fullName: s.fullName,
            code: s.code,
            level: s.enrollments[0]?.programLevel ?? null,
          }))}
          templates={templates}
          defaultTemplateId={defaultDoc?.id ?? null}
        />
      )}
    </div>
  );
}
