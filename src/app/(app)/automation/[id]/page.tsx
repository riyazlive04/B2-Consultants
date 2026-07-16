import { notFound } from "next/navigation";
import { requireSection } from "@/lib/rbac";
import { Breadcrumbs } from "@/components/ui/Breadcrumbs";
import { getWorkflow, getWorkflowPickers } from "@/server/automation-metrics";
import WorkflowBuilder from "./_components/WorkflowBuilder";

export const dynamic = "force-dynamic";

export default async function WorkflowPage({ params }: { params: { id: string } }) {
  await requireSection("automation");
  const [workflow, pickers] = await Promise.all([getWorkflow(params.id), getWorkflowPickers()]);
  if (!workflow) notFound();

  return (
    <div className="w-full">
      <Breadcrumbs items={[{ label: "Automation", href: "/automation" }, { label: workflow.name }]} />
      <WorkflowBuilder workflow={workflow} pickers={pickers} />
    </div>
  );
}
