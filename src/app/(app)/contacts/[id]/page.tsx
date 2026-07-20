import { notFound } from "next/navigation";
import { requireSection } from "@/lib/rbac";
import { Breadcrumbs } from "@/components/ui/Breadcrumbs";
import { getContactDetail, getContactListFilters, getContactCustomFields } from "@/server/contacts-metrics";
import { getAgreementSummaryFor } from "@/server/agreement-state";
import ContactRecord from "./_components/ContactRecord";

export const dynamic = "force-dynamic";

export default async function ContactPage({ params }: { params: { id: string } }) {
  const session = await requireSection("contacts");
  // The Lead IS the contact, so its id is the leadId every agreement hangs off.
  const [contact, filters, customFields, agreement] = await Promise.all([
    getContactDetail(params.id),
    getContactListFilters(),
    getContactCustomFields(),
    getAgreementSummaryFor({ leadId: params.id }),
  ]);
  if (!contact) notFound();

  return (
    <div className="w-full">
      <Breadcrumbs items={[{ label: "Contacts", href: "/contacts" }, { label: contact.name }]} />
      <ContactRecord
        contact={contact}
        owners={filters.owners}
        companies={filters.companies}
        allTags={filters.tags.map((t) => t.name)}
        customFields={customFields}
        agreement={agreement}
        canConvert={session.role === "ADMIN"}
      />
    </div>
  );
}
