import Link from "next/link";
import { ArrowLeft, UserSearch } from "lucide-react";
import { requireCapability, requireSection } from "@/lib/rbac";
import { getAgreementPrefill, getMeetingAttendees } from "@/server/agreement-metrics";
import { getAgreementCandidatesGrouped } from "@/server/agreement-state";
import { listUsableTemplates } from "@/server/agreement-templates";
import { getAgreementWorkflow, getInstalmentPlanConfig } from "@/server/founder-config";
import { AgreementClientPicker } from "../_components/AgreementClientPicker";
import { AgreementForm } from "../_components/AgreementForm";
import { PageHeader } from "@/components/ui/kit";
import { AgreementNav } from "../_components/AgreementNav";

export const dynamic = "force-dynamic";

/** `?leadId=` / `?studentId=` open the form on what the CRM already knows. */
export default async function NewAgreementPage({
  searchParams,
}: {
  searchParams: { leadId?: string; studentId?: string };
}) {
  await requireSection("agreements");
  await requireCapability("agreements.issue");

  const [prefill, candidates, config, instalmentPlans, attendees, templates] = await Promise.all([
    getAgreementPrefill({
      leadId: searchParams.leadId ?? null,
      studentId: searchParams.studentId ?? null,
    }),
    getAgreementCandidatesGrouped(),
    getAgreementWorkflow(),
    // The plan prices pre-fill the instalment surcharge, and the attendees feed the name box -
    // both read-only, both alongside the prefill rather than after it.
    getInstalmentPlanConfig(),
    getMeetingAttendees(),
    // The uploaded templates this draft could be drawn on. Only ones with a current version and
    // a document behind them - see `listUsableTemplates` on why a broken one is never offered.
    listUsableTemplates(),
  ]);
  const picked = !!(searchParams.leadId || searchParams.studentId);

  return (
    <div className="w-full space-y-6">
      <PageHeader
        back={{ href: "/agreements", label: "Agreements" }}
        title="New agreement"
        subtitle={
          templates.length > 0
            ? "Pick the document, fill in the terms, then countersign and send."
            : "Guided Mode clause set - upload your own document under Templates to use one instead."
        }
      />

      <AgreementNav />

      {/* The picker stays visible after a pick, so switching client is one click - not a back-button
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
          useState initializer never re-runs - so picking a client would re-render this page with a
          fresh prefill while React kept the previous (empty) field state, silently showing a form
          that disagreed with its own "filled from the record" banner. Keying on the selected client
          remounts the form, which is the supported way to reset an uncontrolled component. */}
      <AgreementForm
        key={prefill.studentId ?? prefill.leadId ?? "blank"}
        initial={prefill.data}
        notes={prefill.notes}
        missing={prefill.missing}
        filled={prefill.filled}
        instalmentPlans={instalmentPlans}
        attendees={attendees}
        templates={templates}
        // So the form opens on the same document "Generate & send" would have used.
        defaultTemplateId={config.defaultTemplateId}
        // The cohorts §2.1 can name, and the one the prefill resolved to. Read inside the
        // prefill (request-cached), so passing them costs no second query.
        batches={prefill.batches}
        batchId={prefill.batchId}
        suggested={prefill.suggested}
        mode={{ kind: "create", leadId: prefill.leadId, studentId: prefill.studentId }}
      />
    </div>
  );
}
