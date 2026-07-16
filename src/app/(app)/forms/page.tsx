import { requireSection } from "@/lib/rbac";
import { hasCapability } from "@/lib/capabilities";
import { ListHeader } from "@/components/ui/ListHeader";
import { getFormsList } from "@/server/forms-metrics";
import FormsList from "./_components/FormsList";

export const dynamic = "force-dynamic";

export default async function FormsPage() {
  const session = await requireSection("forms");
  const canDelete = hasCapability(session.role, session.capabilities, "pipeline.configure");
  const forms = await getFormsList();

  return (
    <div className="w-full space-y-4">
      <ListHeader title="Forms" count={forms.length} subtitle="capture forms — submissions land straight in Contacts" />
      <FormsList forms={forms} canDelete={canDelete} />
    </div>
  );
}
