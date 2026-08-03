import { headers } from "next/headers";
import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { ACTIVE } from "@/lib/soft-delete";
import { KANBAN_STAGES } from "@/server/pipeline-metrics";

/**
 * "A new lead just landed" feed for the Pipeline page (leads table + kanban board).
 *
 * Unlike /api/leads/poll (assigned-to-me, for My Desk), this covers the two OTHER places a
 * brand-new inbound lead (Pabbly, Meta, FlexiFunnels…) is first visible: the admin leads
 * table and the kanban board — both reachable before anyone has assigned or contacted it.
 *
 * `scope` picks which of the two visibility rules to run, so a tab only pays for the query
 * it actually needs (LeadSection polls "table", KanbanBoard polls "kanban" — the two never
 * run at once since Tabs remounts panels on switch):
 *   - "table"  mirrors getPipelineOverview's leadWhere: Admin sees every lead, everyone else
 *     only the ones they entered themselves. A webhook lead has no enteredById, so it only
 *     ever surfaces here for Admin — same rule the initial page load already enforces.
 *   - "kanban" mirrors getKanbanLeads: every OPEN-stage lead, regardless of owner — the board
 *     is shared. `canMove` is computed here so the client never has to see enteredById.
 *
 * Same trade-off as every other poll route in the app (see /api/leads/poll): a plain indexed
 * `createdAt > since` query beats a persistent connection on a deploy with no Redis/pubsub.
 */

const MAX = 20;

export async function GET(req: Request) {
  const session = await auth.api.getSession({ headers: await Promise.resolve(headers()) });
  if (!session) return NextResponse.json({ leads: [] }, { status: 401 });
  const role = (session.user as { role?: string }).role ?? "USER";
  const isAdmin = role === "ADMIN";
  const viewerId = session.user.id;

  const url = new URL(req.url);
  const sinceRaw = url.searchParams.get("since");
  const scope = url.searchParams.get("scope") === "kanban" ? "kanban" : "table";
  const since = sinceRaw ? new Date(sinceRaw) : null;

  if (!since || Number.isNaN(since.getTime())) {
    return NextResponse.json({ leads: [], now: new Date().toISOString() }, { headers: { "Cache-Control": "no-store" } });
  }

  const where =
    scope === "kanban"
      ? { ...ACTIVE, createdAt: { gt: since }, stage: { in: [...KANBAN_STAGES] } }
      : { ...ACTIVE, createdAt: { gt: since }, ...(isAdmin ? {} : { enteredById: viewerId }) };

  const rows = await prisma.lead.findMany({
    where,
    orderBy: { createdAt: "desc" },
    take: MAX,
    include: { enteredBy: { select: { name: true } }, assignedTo: { select: { name: true } } },
  });

  const leads =
    scope === "kanban"
      ? rows.map((l) => ({
          id: l.id,
          name: l.name,
          stage: l.stage as string,
          ownerName: l.assignedTo?.name ?? null,
          valueLabel: null as string | null,
          canMove: isAdmin || l.enteredById === viewerId,
        }))
      : rows.map((l) => ({
          id: l.id,
          name: l.name,
          phone: l.phone,
          leadSource: l.leadSource,
          dateIn: l.dateIn.toISOString(),
          stage: l.stage,
          wonLevel: l.wonLevel,
          paymentPlan: l.paymentPlan,
          notes: l.notes,
          enteredBy: l.enteredBy?.name ?? "-",
          source: l.source,
          assignedToId: l.assignedToId,
          assignedTo: l.assignedTo?.name ?? null,
          contactedAt: l.contactedAt?.toISOString() ?? null,
          speedMs: l.contactedAt ? l.contactedAt.getTime() - l.createdAt.getTime() : null,
        }));

  return NextResponse.json(
    { leads, now: new Date().toISOString() },
    { headers: { "Cache-Control": "no-store" } },
  );
}
