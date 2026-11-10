import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { ACTIVE } from "@/lib/soft-delete";
import { canTransition, type ImprovementStatus, IMPROVEMENT_STATUS_LABELS } from "@/lib/improvement";
import { logSystemActivity, SYSTEM_ACTORS } from "@/server/activity-log";
import { agentRoute } from "@/server/agent-route";

/**
 * POST /api/agent/improvements/[id]/resolve — the automated agent's write-back.
 *
 * Saves the agent's analysis as `devNote`, optionally transitions status, and optionally adds a
 * COMMENT event (attributed to the first ADMIN user — the agent has no session of its own).
 *
 * Auth: CRON_SECRET, same as the read endpoint.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const bodySchema = z.object({
  /** Free-text analysis from the agent — root cause, affected files, suggested fix. */
  devNote: z.string().trim().max(4000).optional(),
  /** Target status. Defaults to TRIAGED if omitted. */
  status: z.enum(["TRIAGED", "ACCEPTED", "IN_PROGRESS", "FIXED"]).optional(),
  /** A comment visible to the reporter — e.g. "this has been identified and a fix is in progress". */
  resolution: z.string().trim().max(2000).optional(),
  /** Internal comment (not visible to reporter) — e.g. the PR link. */
  comment: z.string().trim().max(2000).optional(),
});

async function getAdminUserId(): Promise<string | null> {
  const admin = await prisma.user.findFirst({
    where: { role: "ADMIN", ...ACTIVE },
    select: { id: true },
    orderBy: { createdAt: "asc" },
  });
  return admin?.id ?? null;
}

export const { GET, POST } = agentRoute("improvements-resolve", async (req: NextRequest) => {
  const id = req.nextUrl.pathname.split("/").at(-2);
  if (!id) return NextResponse.json({ ok: false, error: "Missing improvement ID" }, { status: 400 });

  const body = await req.json().catch(() => null);
  const parsed = bodySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ ok: false, error: parsed.error.issues[0]?.message ?? "Invalid body" }, { status: 400 });
  }
  const data = parsed.data;

  const report = await prisma.improvement.findFirst({
    where: { id, ...ACTIVE },
    select: { id: true, ref: true, status: true, title: true, firstTriagedAt: true },
  });
  if (!report) {
    return NextResponse.json({ ok: false, error: "Improvement not found" }, { status: 404 });
  }

  const from = report.status as ImprovementStatus;
  const to = (data.status ?? "TRIAGED") as ImprovementStatus;

  // Update devNote if provided
  if (data.devNote) {
    await prisma.improvement.update({
      where: { id },
      data: { devNote: data.devNote },
    });
  }

  // Transition status if it's a legal move and not already at the target
  if (from !== to && canTransition(from, to)) {
    const adminId = await getAdminUserId();
    if (!adminId) {
      return NextResponse.json({ ok: false, error: "No admin user found for attribution" }, { status: 500 });
    }

    const now = new Date();
    await prisma.$transaction([
      prisma.improvement.update({
        where: { id },
        data: {
          status: to,
          firstTriagedAt: report.firstTriagedAt ?? (to === "NEW" ? null : now),
          fixedAt: to === "FIXED" ? now : to === "IN_PROGRESS" ? null : undefined,
        },
      }),
      prisma.improvementEvent.create({
        data: {
          reportId: id,
          kind: "STATUS",
          fromValue: from,
          toValue: to,
          body: data.resolution?.trim() || null,
          visibleToReporter: Boolean(data.resolution?.trim()),
          actorId: adminId,
        },
      }),
      // Add the internal comment as a separate event if provided
      ...(data.comment
        ? [
            prisma.improvementEvent.create({
              data: {
                reportId: id,
                kind: "COMMENT",
                body: data.comment,
                visibleToReporter: false,
                actorId: adminId,
              },
            }),
          ]
        : []),
    ]);

    await logSystemActivity(SYSTEM_ACTORS.automation, {
      action: "improvement.agent.triage",
      section: "improvements",
      entityType: "Improvement",
      entityId: id,
      summary: `Agent moved ${report.ref} from ${IMPROVEMENT_STATUS_LABELS[from]} to ${IMPROVEMENT_STATUS_LABELS[to]}`,
      meta: { ref: report.ref, from, to, automated: true },
    });
  }

  return NextResponse.json({
    ok: true,
    ref: report.ref,
    from,
    to: from !== to && canTransition(from, to) ? to : from,
  });
});
