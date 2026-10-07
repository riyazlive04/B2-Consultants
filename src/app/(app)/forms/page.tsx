import { requireSection } from "@/lib/rbac";
import { hasCapability } from "@/lib/capabilities";
import { ListHeader } from "@/components/ui/ListHeader";
import { getFormsList } from "@/server/forms-metrics";
import FormsList from "./_components/FormsList";

/** Its own name in the browser tab, rather than sharing one title with every other page
 *  (issue 28). The root layout adds the "· B2 Consultants" suffix. */
export const metadata = { title: "Forms" };

export const dynamic = "force-dynamic";

export default async function FormsPage() {
  const session = await requireSection("forms");
  const canDelete = hasCapability(session.role, session.capabilities, "sites.manage");
  const forms = await getFormsList();

  return (
    <div className="w-full space-y-4">
      <ListHeader title="Forms" count={forms.length} subtitle="capture forms - submissions land straight in Contacts" />
      <FormsList forms={forms} canDelete={canDelete} />
    </div>
  );
}
