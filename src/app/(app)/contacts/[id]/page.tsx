import { notFound } from "next/navigation";
import { requireSection } from "@/lib/rbac";
import { Breadcrumbs } from "@/components/ui/Breadcrumbs";
import { getContactDetail, getContactListFilters, getContactCustomFields } from "@/server/contacts-metrics";
import { getAgreementSummaryFor } from "@/server/agreement-state";
import { prospectHistory } from "@/server/prospect-history";
import { getPersonJourney } from "@/server/onboarding-metrics";
import { JourneyRail } from "@/components/journey/JourneyRail";
import ContactRecord from "./_components/ContactRecord";

export const dynamic = "force-dynamic";

export default async function ContactPage({ params }: { params: { id: string } }) {
  const session = await requireSection("contacts");
  // The Lead IS the contact, so its id is the leadId every agreement hangs off.
  const [contact, filters, customFields, agreement, history, person] = await Promise.all([
    getContactDetail(params.id),
    getContactListFilters(),
    getContactCustomFields(),
    getAgreementSummaryFor({ leadId: params.id }),
    // What we already knew about them - see server/prospect-history.
    prospectHistory(params.id),
    /*
      THE WHOLE ARC, from the sales end.

      Same rail as the student record, deliberately: this page and `/students/:id` are two halves
      of one person, and the thing that was missing from both was the journey across them. Showing
      it here means a telecaller can see that a deal they closed has - or has not - turned into a
      seated student, without needing a section they cannot open.
    */
    getPersonJourney({ leadId: params.id }),
  ]);
  if (!contact) notFound();

  return (
    <div className="w-full">
      <Breadcrumbs items={[{ label: "Contacts", href: "/contacts" }, { label: contact.name }]} />
      {person && (
        <div className="mb-5">
          <JourneyRail journey={person.journey} ids={person.ids} name={person.name} />
        </div>
      )}
      <ContactRecord
        contact={contact}
        owners={filters.owners}
        companies={filters.companies}
        allTags={filters.tags.map((t) => t.name)}
        customFields={customFields}
        agreement={agreement}
        history={history}
        canConvert={session.role === "ADMIN"}
      />
    </div>
  );
}
