import { requireSection } from "@/lib/rbac";
import { hasCapability } from "@/lib/capabilities";
import { ListHeader } from "@/components/ui/ListHeader";
import { getBoard } from "@/server/opportunities-metrics";
import { getContactsList } from "@/server/contacts-metrics";
import Board from "./_components/Board";

export const dynamic = "force-dynamic";

export default async function OpportunitiesPage({ searchParams }: { searchParams: { pipeline?: string } }) {
  const session = await requireSection("opportunities");
  const canConfigure = hasCapability(session.role, session.capabilities, "pipeline.configure");

  const [board, contactsPage] = await Promise.all([
    getBoard(searchParams.pipeline),
    // Flat "pick a contact" dropdown, not the paginated Contacts screen — 500 is generous
    // for a manual <select>, matching the command palette's per-type cap.
    getContactsList({ take: 500 }),
  ]);

  return (
    <div className="w-full space-y-4">
      <ListHeader
        title="Opportunities"
        count={board.activePipelineName ? `${board.totalCount} cards` : undefined}
        subtitle={board.activePipelineName ? `${board.activePipelineName} · ${board.totalValueInr} pipeline value` : "Your sales pipeline board"}
      />
      <Board
        board={board}
        contacts={contactsPage.rows.map((c) => ({ id: c.id, name: c.name, phone: c.phone }))}
        canConfigure={canConfigure}
      />
    </div>
  );
}
