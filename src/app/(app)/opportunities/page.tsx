import { requireSection } from "@/lib/rbac";
import { hasCapability } from "@/lib/capabilities";
import { ListHeader } from "@/components/ui/ListHeader";
import { Card } from "@/components/ui/kit";
import { ArchivedPanel } from "@/components/ui/ArchivedPanel";
import { getBoard } from "@/server/opportunities-metrics";
import { getContactsList } from "@/server/contacts-metrics";
import { getArchivedOpportunities } from "@/server/archive-metrics";
import { restoreOpportunity, purgeOpportunity } from "@/server/opportunities-actions";
import Board from "./_components/Board";

export const dynamic = "force-dynamic";

export default async function OpportunitiesPage({ searchParams }: { searchParams: { pipeline?: string } }) {
  const session = await requireSection("opportunities");
  const canConfigure = hasCapability(session.role, session.capabilities, "pipeline.configure");
  const canPurge = session.role === "ADMIN";

  const [board, contactsPage, archivedOpps] = await Promise.all([
    getBoard(searchParams.pipeline),
    // Flat "pick a contact" dropdown, not the paginated Contacts screen — 500 is generous
    // for a manual <select>, matching the command palette's per-type cap.
    getContactsList({ take: 500 }),
    getArchivedOpportunities(),
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
      {archivedOpps.length > 0 && (
        <Card title={`Archived opportunities (${archivedOpps.length})`}>
          <ArchivedPanel
            rows={archivedOpps}
            restore={restoreOpportunity}
            purge={purgeOpportunity}
            canPurge={canPurge}
            noun="opportunity"
          />
        </Card>
      )}
    </div>
  );
}
