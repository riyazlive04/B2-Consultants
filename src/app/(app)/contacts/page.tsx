import { requireSection } from "@/lib/rbac";
import { hasCapability } from "@/lib/capabilities";
import { ListHeader } from "@/components/ui/ListHeader";
import { Tabs } from "@/components/ui/Tabs";
import {
  getContactsList,
  getContactListFilters,
  getCompaniesList,
  getContactCustomFields,
  getTasksList,
} from "@/server/contacts-metrics";
import ContactsTable from "./_components/ContactsTable";
import CompaniesTable from "./_components/CompaniesTable";
import TasksTable from "./_components/TasksTable";
import CustomFieldsPanel from "./_components/CustomFieldsPanel";
import { ArchivedGroups } from "@/components/ui/ArchivedGroups";
import { getArchivedLeads, getArchivedCompanies, getArchivedTasks } from "@/server/archive-metrics";
import {
  restoreLead, purgeLead, restoreCompany, purgeCompany, restoreTask, purgeTask,
} from "@/server/contacts-actions";

export const dynamic = "force-dynamic";

type ContactsSearchParams = {
  q?: string;
  owner?: string;
  stage?: string;
  source?: string;
  city?: string;
  from?: string;
  to?: string;
  tag?: string;
  cursor?: string;
};

export default async function ContactsPage({
  searchParams,
}: {
  searchParams: ContactsSearchParams;
}) {
  const session = await requireSection("contacts");
  const canConfigure = hasCapability(session.role, session.capabilities, "pipeline.configure");

  const [contactsPage, filters, companies, customFields, tasks, archLeads, archCompanies, archTasks] =
    await Promise.all([
      getContactsList({
        search: searchParams.q,
        ownerId: searchParams.owner,
        stage: searchParams.stage,
        source: searchParams.source,
        city: searchParams.city,
        dateFrom: searchParams.from,
        dateTo: searchParams.to,
        tagId: searchParams.tag,
        cursor: searchParams.cursor,
      }),
      getContactListFilters(),
      getCompaniesList(),
      getContactCustomFields(),
      getTasksList({}),
      getArchivedLeads(),
      getArchivedCompanies(),
      getArchivedTasks(),
    ]);
  const archivedCount = archLeads.length + archCompanies.length + archTasks.length;
  const canPurge = session.role === "ADMIN";

  return (
    <div className="w-full space-y-4">
      <ListHeader title="Contacts" count={`${filters.total.toLocaleString("en-IN")} contacts`} subtitle="your CRM, in-house" />
      <Tabs
        tabs={[
          {
            label: "Contacts",
            content: <ContactsTable page={contactsPage} filters={filters} />,
          },
          {
            label: "Companies",
            content: <CompaniesTable rows={companies} owners={filters.owners} canDelete={canConfigure} />,
          },
          { label: "Tasks", content: <TasksTable rows={tasks} owners={filters.owners} /> },
          { label: "Custom fields", content: <CustomFieldsPanel defs={customFields} canManage={canConfigure} /> },
          {
            label: `Archived${archivedCount ? ` (${archivedCount})` : ""}`,
            content: (
              <ArchivedGroups
                canPurge={canPurge}
                groups={[
                  { label: "Contacts", noun: "contact", rows: archLeads, restore: restoreLead, purge: purgeLead },
                  { label: "Companies", noun: "company", rows: archCompanies, restore: restoreCompany, purge: purgeCompany },
                  { label: "Tasks", noun: "task", rows: archTasks, restore: restoreTask, purge: purgeTask },
                ]}
              />
            ),
          },
        ]}
      />
    </div>
  );
}
