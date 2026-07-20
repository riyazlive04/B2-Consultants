import "server-only";

import { prisma } from "@/lib/prisma";
import { formatInrMinor } from "@/lib/format";

/**
 * Read layer for the Opportunities Kanban board (Synamate "Pipelines").
 * Returns display-ready, serializable data (money pre-formatted, no BigInt).
 */

// A pipeline with more cards in one stage than this is rare (and previously this query had no
// cap at all — fetched every open/won/lost deal, every load). Cap + signal overflow rather than
// silently truncate: BUILD_CHECKLIST.md §4.
const STAGE_CARD_LIMIT = 300;

export type BoardCard = {
  id: string;
  name: string;
  contactId: string;
  contactName: string;
  source: string | null;
  valueInr: string;
  ownerName: string | null;
  ownerId: string | null;
  status: string;
  position: number;
  stageId: string;
};

export type BoardStage = {
  id: string;
  name: string;
  legacyStage: string | null;
  probability: number | null;
  count: number;
  totalInr: string;
  // Only set when this stage has a probability configured — the flat totalInr stays the primary,
  // always-correct figure; this is an additional weighted-forecast read, never a replacement.
  weightedTotalInr: string | null;
  cards: BoardCard[];
  hasMore: boolean;
};

export type BoardData = {
  pipelines: { id: string; name: string; isDefault: boolean }[];
  activePipelineId: string | null;
  activePipelineName: string | null;
  stages: BoardStage[];
  owners: { id: string; name: string }[];
  totalCount: number;
  totalValueInr: string;
  // Only set when at least one stage in the active pipeline has a probability configured.
  weightedTotalValueInr: string | null;
};

export async function getBoard(pipelineId?: string): Promise<BoardData> {
  const pipelines = await prisma.pipeline.findMany({
    where: { deletedAt: null },
    orderBy: [{ isDefault: "desc" }, { position: "asc" }, { name: "asc" }],
    select: { id: true, name: true, isDefault: true },
  });

  const active = pipelineId
    ? pipelines.find((p) => p.id === pipelineId) ?? pipelines[0]
    : pipelines[0];

  const owners = await prisma.user.findMany({
    where: { status: "ACTIVE" },
    select: { id: true, name: true },
    orderBy: { name: "asc" },
  });

  if (!active) {
    return {
      pipelines,
      activePipelineId: null,
      activePipelineName: null,
      stages: [],
      owners,
      totalCount: 0,
      totalValueInr: formatInrMinor(0n),
      weightedTotalValueInr: null,
    };
  }

  const stages = await prisma.pipelineStage.findMany({
    where: { pipelineId: active.id, deletedAt: null },
    orderBy: { position: "asc" },
    include: {
      opps: {
        // Exclude archived opportunities and deals whose parent contact is archived.
        where: { deletedAt: null, lead: { deletedAt: null } },
        orderBy: { position: "asc" },
        take: STAGE_CARD_LIMIT + 1, // fetch one extra to detect overflow without a second COUNT query
        include: {
          lead: { select: { id: true, name: true } },
          assignedTo: { select: { id: true, name: true } },
        },
      },
    },
  });

  // Stage/grand/forecast totals are computed over ALL opportunities in each stage (a groupBy), not
  // just the display-capped `opps` slice above — otherwise a stage with more than STAGE_CARD_LIMIT
  // cards would under-report its value. They are also split by status so WON/LOST/ABANDONED deals
  // no longer inflate the live pipeline value or the weighted forecast: "pipeline value" means
  // money still IN PLAY (issue 1.6). Each column header still shows that column's own full sum
  // (all statuses) — which is what someone reading a Won/Lost column expects.
  const sums = await prisma.opportunity.groupBy({
    by: ["stageId", "status"],
    where: { stageId: { in: stages.map((s) => s.id) }, deletedAt: null, lead: { deletedAt: null } },
    _sum: { valueInrMinor: true },
  });
  const allByStage = new Map<string, bigint>();
  const openByStage = new Map<string, bigint>();
  for (const r of sums) {
    const v = r._sum.valueInrMinor ?? 0n;
    allByStage.set(r.stageId, (allByStage.get(r.stageId) ?? 0n) + v);
    if (r.status === "OPEN") openByStage.set(r.stageId, (openByStage.get(r.stageId) ?? 0n) + v);
  }

  let totalCount = 0;
  let grandTotal = 0n; // OPEN only — the live pipeline value
  let weightedGrandTotal = 0n; // OPEN only, probability-weighted
  let anyWeighted = false;

  const boardStages: BoardStage[] = stages.map((s) => {
    const hasMore = s.opps.length > STAGE_CARD_LIMIT;
    const oppsForDisplay = hasMore ? s.opps.slice(0, STAGE_CARD_LIMIT) : s.opps;

    const cards: BoardCard[] = oppsForDisplay.map((o) => ({
      id: o.id,
      name: o.name,
      contactId: o.lead.id,
      contactName: o.lead.name,
      source: o.source,
      valueInr: formatInrMinor(o.valueInrMinor),
      ownerName: o.assignedTo?.name ?? null,
      ownerId: o.assignedTo?.id ?? null,
      status: o.status,
      position: o.position,
      stageId: o.stageId,
    }));

    const stageAll = allByStage.get(s.id) ?? 0n; // column header: every card, any status
    const stageOpen = openByStage.get(s.id) ?? 0n; // live pipeline: OPEN cards only

    totalCount += cards.length;
    grandTotal += stageOpen;

    const weightedOpen =
      s.probability != null ? (stageOpen * BigInt(s.probability)) / 100n : stageOpen;
    weightedGrandTotal += weightedOpen;
    if (s.probability != null) anyWeighted = true;

    return {
      id: s.id,
      name: s.name,
      legacyStage: s.legacyStage,
      probability: s.probability,
      count: cards.length,
      totalInr: formatInrMinor(stageAll),
      weightedTotalInr: s.probability != null ? formatInrMinor(weightedOpen) : null,
      cards,
      hasMore,
    };
  });

  return {
    pipelines,
    activePipelineId: active.id,
    activePipelineName: active.name,
    stages: boardStages,
    owners,
    totalCount,
    totalValueInr: formatInrMinor(grandTotal),
    weightedTotalValueInr: anyWeighted ? formatInrMinor(weightedGrandTotal) : null,
  };
}
