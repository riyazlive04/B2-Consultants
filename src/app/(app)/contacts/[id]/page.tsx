import { notFound } from "next/navigation";
import { requireSection } from "@/lib/rbac";
import { Breadcrumbs } from "@/components/ui/Breadcrumbs";
import { getContactDetail, getContactListFilters, getContactCustomFields } from "@/server/contacts-metrics";
import ContactRecord from "./_components/ContactRecord";

export const dynamic = "force-dynamic";

export default async function ContactPage({ params }: { params: { id: string } }) {
  await requireSection("contacts");
  const [contact, filters, customFields] = await Promise.all([
    getContactDetail(params.id),
    getContactListFilters(),
    getContactCustomFields(),
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
      />
    </div>
  );
}
