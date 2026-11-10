import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { ACTIVE } from "@/lib/soft-delete";
import { agentRoute } from "@/server/agent-route";
import type {
  ImprovementKind,
  ImprovementSeverity,
  ImprovementStatus,
  Breadcrumb,
  ElementTag,
} from "@/lib/improvement";

/**
 * GET /api/agent/improvements — returns NEW improvement reports for automated processing.
 *
 * Auth: CRON_SECRET (same as cron routes). The response includes everything the agent needs to
 * understand the report and locate the relevant code: kind, answers, route, section, breadcrumbs,
 * element tag, and the server-captured context (engines off, role, capabilities).
 *
 * Capped at 10 per call — the agent processes one at a time; flooding it with 50 wastes context.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const { GET, POST } = agentRoute("improvements", async (req) => {
  const url = req.nextUrl;
  const statusFilter = url.searchParams.get("status") ?? "NEW";
  const limit = Math.min(Number(url.searchParams.get("limit") ?? 10), 25);

  const statusWhere =
    statusFilter === "OPEN"
      ? { status: { in: ["NEW", "TRIAGED", "ACCEPTED"] as ImprovementStatus[] } }
      : { status: statusFilter as ImprovementStatus };

  const rows = await prisma.improvement.findMany({
    where: { ...ACTIVE, ...statusWhere },
    orderBy: [{ urgent: "desc" }, { createdAt: "desc" }],
    take: limit,
    select: {
      id: true,
      ref: true,
      kind: true,
      severity: true,
      status: true,
      title: true,
      answers: true,
      reporterNote: true,
      route: true,
      routeParams: true,
      sectionKey: true,
      elementTag: true,
      breadcrumbs: true,
      context: true,
      clientDigest: true,
      devNote: true,
      urgent: true,
      reporterRole: true,
      reporter: { select: { name: true } },
      createdAt: true,
      recording: { select: { kind: true, seconds: true } },
      _count: { select: { attachments: true } },
    },
  });

  const improvements = rows.map((r) => ({
    id: r.id,
    ref: r.ref,
    kind: r.kind as ImprovementKind,
    severity: r.severity as ImprovementSeverity,
    status: r.status as ImprovementStatus,
    title: r.title,
    answers: r.answers as Record<string, string>,
    reporterNote: r.reporterNote,
    route: r.route,
    routeParams: r.routeParams as Record<string, string> | null,
    sectionKey: r.sectionKey,
    elementTag: r.elementTag as ElementTag | null,
    breadcrumbs: r.breadcrumbs as Breadcrumb[] | null,
    context: r.context as Record<string, unknown>,
    clientDigest: r.clientDigest,
    devNote: r.devNote,
    urgent: r.urgent,
    reporterName: r.reporter.name,
    reporterRole: r.reporterRole,
    hasRecording: !!r.recording,
    recordingKind: r.recording?.kind ?? null,
    attachments: r._count.attachments,
    createdAt: r.createdAt.toISOString(),
  }));

  return NextResponse.json({ ok: true, improvements, total: improvements.length });
});
