import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { requireCapability, requireSection } from "@/lib/rbac";
import { getAgreementCandidates, getAgreementPrefill } from "@/server/agreement-metrics";
import { AgreementForm } from "../_components/AgreementForm";

export const dynamic = "force-dynamic";

/** `?leadId=` / `?studentId=` open the form on what the CRM already knows. */
export default async function NewAgreementPage({
  searchParams,
}: {
  searchParams: { leadId?: string; studentId?: string };
}) {
  await requireSection("agreements");
  await requireCapability("agreements.issue");

  const prefill = await getAgreementPrefill({
    leadId: searchParams.leadId ?? null,
    studentId: searchParams.studentId ?? null,
  });
  const { leads, students } = await getAgreementCandidates();
  const picked = searchParams.leadId || searchParams.studentId;

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <div className="flex items-center gap-3">
        <Link href="/agreements" className="text-muted transition-colors hover:text-ink">
          <ArrowLeft size={18} />
        </Link>
        <div>
          <h1 className="font-display text-2xl font-bold tracking-tight">New agreement</h1>
          <p className="text-xs text-muted">Guided Mode — template guided-v3</p>
        </div>
      </div>

      {!picked && (leads.length > 0 || students.length > 0) && (
        <div className="rounded-card border border-line bg-surface p-5 shadow-card">
          <h2 className="mb-3 font-display text-sm font-bold">Start from an existing record</h2>
          <div className="flex flex-wrap gap-2">
            {leads.map((l) => (
              <Link
                key={l.id}
                href={`/agreements/new?leadId=${l.id}`}
                className="rounded-full border border-line px-3 py-1.5 text-xs transition-colors hover:border-primary hover:text-primary"
              >
                {l.name} <span className="text-muted">· won lead</span>
              </Link>
            ))}
            {students.map((st) => (
              <Link
                key={st.id}
                href={`/agreements/new?studentId=${st.id}`}
                className="rounded-full border border-line px-3 py-1.5 text-xs transition-colors hover:border-primary hover:text-primary"
              >
                {st.fullName} <span className="text-muted">· student</span>
              </Link>
            ))}
          </div>
          <p className="mt-3 text-xs text-muted">
            Or fill the form below by hand. The postal address and batch always need typing — nothing in the
            database holds them.
          </p>
        </div>
      )}

      <AgreementForm
        initial={prefill.data}
        notes={prefill.notes}
        mode={{ kind: "create", leadId: prefill.leadId, studentId: prefill.studentId }}
      />
    </div>
  );
}
