import { requireSection, requireAdmin } from "@/lib/rbac";
import { Breadcrumbs } from "@/components/ui/Breadcrumbs";
import { getWorkflowSettings } from "@/server/founder-config";
import WorkflowSettingsForm from "./_components/WorkflowSettingsForm";

export const dynamic = "force-dynamic";

/** Automation → Global Workflow Settings. Founder-only: these switches govern every workflow. */
export default async function WorkflowSettingsPage() {
  await requireSection("automation");
  await requireAdmin();
  const settings = await getWorkflowSettings();

  return (
    <div className="w-full">
      <Breadcrumbs items={[{ label: "Automation", href: "/automation" }, { label: "Global Workflow Settings" }]} />
      <WorkflowSettingsForm settings={settings} />
    </div>
  );
}
