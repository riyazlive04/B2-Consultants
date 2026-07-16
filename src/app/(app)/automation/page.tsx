import { notFound } from "next/navigation";
import { requireSection } from "@/lib/rbac";
import { hasCapability } from "@/lib/capabilities";
import { ListHeader } from "@/components/ui/ListHeader";
import {
  getWorkflowsList, getFolders, getFolder, getDeletedWorkflows, getDeletedCount,
} from "@/server/automation-metrics";
import WorkflowsList from "./_components/WorkflowsList";

export const dynamic = "force-dynamic";

/**
 * Automation → Workflows (Synamate parity). Both the open folder and the active tab live in the
 * URL (?folder=, ?tab=deleted) so every view is linkable and server-rendered, and so a
 * revalidatePath from a mutation refreshes whatever the user is actually looking at.
 */
export default async function AutomationPage({
  searchParams,
}: {
  searchParams: { folder?: string; tab?: string };
}) {
  const session = await requireSection("automation");
  const canDelete = hasCapability(session.role, session.capabilities, "pipeline.configure");
  const isAdmin = session.role === "ADMIN";

  const tab = searchParams.tab === "deleted" ? "deleted" : "all";
  const folderId = searchParams.folder?.trim() || null;

  // The Deleted tab is global (it spans folders), so it ignores ?folder.
  const openFolder = tab === "all" && folderId ? await getFolder(folderId) : null;
  if (tab === "all" && folderId && !openFolder) notFound();

  const [workflows, folders, deletedCount] = await Promise.all([
    tab === "deleted" ? getDeletedWorkflows() : getWorkflowsList(folderId),
    getFolders(),
    getDeletedCount(),
  ]);

  const subtitle = openFolder
    ? `workflows in “${openFolder.name}”`
    : tab === "deleted"
      ? "deleted workflows — restore them, or delete for good"
      : "trigger → action workflows that tie the whole CRM together";

  return (
    <div className="w-full space-y-4">
      <ListHeader title="Automation" count={workflows.length} subtitle={subtitle} />
      <WorkflowsList
        workflows={workflows}
        folders={folders}
        openFolder={openFolder}
        tab={tab}
        deletedCount={deletedCount}
        canDelete={canDelete}
        isAdmin={isAdmin}
      />
    </div>
  );
}
