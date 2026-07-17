import Link from "next/link";
import { ArrowLeft, UserSearch } from "lucide-react";
import { requireCapability, requireSection } from "@/lib/rbac";
import { getAgreementPrefill } from "@/server/agreement-metrics";
import { getAgreementCandidatesGrouped } from "@/server/agreement-state";
import { getAgreementWorkflow } from "@/server/founder-config";
import { AgreementClientPicker } from "../_components/AgreementClientPicker";
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

  const [prefill, candidates, config] = await Promise.all([
    getAgreementPrefill({
      leadId: searchParams.leadId ?? null,
      studentId: searchParams.studentId ?? null,
    }),
    getAgreementCandidatesGrouped(),
    getAgreementWorkflow(),
  ]);
  const picked = !!(searchParams.leadId || searchParams.studentId);

  return (
    <div className="w-full space-y-6">
      <div className="flex items-center gap-3">
        <Link href="/agreements" className="text-muted transition-colors hover:text-ink">
          <ArrowLeft size={18} />
        </Link>
        <div>
          <h1 className="font-display text-2xl font-bold tracking-tight">New agreement</h1>
          <p className="text-xs text-muted">Guided Mode — template guided-v3</p>
        </div>
      </div>

      {/* The picker stays visible after a pick, so switching client is one click — not a back-button
          hunt. It lists every live deal and every student, not just won leads: the founder decides
          when an agreement goes out, the state badge only advises. */}
      <div className="rounded-card border border-line bg-surface p-5 shadow-card">
        <h2 className="mb-1 flex items-center gap-2 font-display text-sm font-bold">
          <UserSearch size={16} className="text-accent" /> Start from an existing record
        </h2>
        <p className="mb-3 text-xs text-muted">
          {picked
            ? "Everything below is filled from this client's record. Switch client any time."
            : "Search by name, phone, email or stage. Picking a client fills the form from the CRM."}
        </p>
        <AgreementClientPicker candidates={candidates} config={config} />
      </div>

      {/* The key is load-bearing. AgreementForm seeds its inputs from `initial` with useState, and a
          useState initializer never re-runs — so picking a client would re-render this page with a
          fresh prefill while React kept the previous (empty) field state, silently showing a form
          that disagreed with its own "filled from the record" banner. Keying on the selected client
          remounts the form, which is the supported way to reset an uncontrolled component. */}
      <AgreementForm
        key={prefill.studentId ?? prefill.leadId ?? "blank"}
        initial={prefill.data}
        notes={prefill.notes}
        missing={prefill.missing}
        filled={prefill.filled}
        mode={{ kind: "create", leadId: prefill.leadId, studentId: prefill.studentId }}
      />
    </div>
  );
}
