import { BarChart3, MessageCircle } from "lucide-react";
import { requireSection } from "@/lib/rbac";
import { SectionLink } from "@/components/ui/SectionLink";
import { hasCapability } from "@/lib/capabilities";
import { ListHeader } from "@/components/ui/ListHeader";
import { Card } from "@/components/ui/kit";
import { ArchivedPanel } from "@/components/ui/ArchivedPanel";
import { getBoard } from "@/server/opportunities-metrics";
import { getContactsList } from "@/server/contacts-metrics";
import { getArchivedOpportunities } from "@/server/archive-metrics";
import { getPipelineConfig } from "@/server/founder-config";
import { restoreOpportunity, purgeOpportunity } from "@/server/opportunities-actions";
import Board from "./_components/Board";
import { BoardFilterBar } from "./_components/BoardFilterBar";
import { StageRulesCard } from "./_components/StageRulesCard";

export const dynamic = "force-dynamic";

export default async function OpportunitiesPage({
  searchParams,
}: {
  searchParams: { pipeline?: string; q?: string; owner?: string; status?: string };
}) {
  const session = await requireSection("opportunities");
  const canConfigure = hasCapability(session.role, session.capabilities, "pipeline.configure");
  const canPurge = session.role === "ADMIN";

  const [board, contactsPage, archivedOpps, pipelineConfig] = await Promise.all([
    // Filters run in SQL - see getBoard. The board is card-capped per stage, so a client-side
    // filter would only ever search the visible slice.
    getBoard(searchParams.pipeline, {
      search: searchParams.q,
      ownerId: searchParams.owner,
      status: searchParams.status,
    }),
    // Flat "pick a contact" dropdown, not the paginated Contacts screen - 500 is generous
    // for a manual <select>, matching the command palette's per-type cap.
    getContactsList({ take: 500 }),
    getArchivedOpportunities(),
    // The founder's rules-vs-drag setting. This board ignored it entirely and was always
    // drag-and-drop, so the two boards over the same data disagreed about who may move a card.
    getPipelineConfig(),
  ]);

  return (
    <div className="w-full space-y-4">
      <ListHeader
        title="Opportunities"
        count={board.activePipelineName ? `${board.totalCount} cards${board.filtered ? " (filtered)" : ""}` : undefined}
        subtitle={board.activePipelineName ? `${board.activePipelineName} · ${board.totalValueInr} pipeline value` : "Your sales pipeline board"}
      />
      {/* The way back to the metrics screen. The sidebar's "Pipeline" entry now lands HERE, so
          without this link the target bar, aging table and deals-at-risk would have no door. */}
      <div className="flex flex-wrap items-center gap-2">
        <SectionLink href="/pipeline" sectionKey="pipeline">
          <BarChart3 size={14} /> Pipeline metrics
        </SectionLink>
        <SectionLink href="/outreach" sectionKey="outreach">
          <MessageCircle size={14} /> Outreach queue
        </SectionLink>
      </div>
      {board.activePipelineId && <BoardFilterBar owners={board.owners} filtered={board.filtered} />}
      <Board
        board={board}
        contacts={contactsPage.rows.map((c) => ({ id: c.id, name: c.name, phone: c.phone }))}
        canConfigure={canConfigure}
        mode={pipelineConfig.mode}
      />
      {/* The rules that move a card without anyone touching it. They have always been enforced -
          in five different files - and were visible nowhere. */}
      <StageRulesCard mode={pipelineConfig.mode} canConfigure={canConfigure} />
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
