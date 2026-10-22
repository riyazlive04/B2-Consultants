import "server-only";
import { prisma } from "@/lib/prisma";
import { mergeForSession, sortResources, type ResourceKindValue, type ResourceScope } from "@/lib/resources";

/**
 * Resource reads, shared by every screen that shows course material.
 *
 * One module so the STUDENT-FACING filter lives in exactly one place. `visibleToStudents` is
 * applied in the QUERY, not in the component: an unreleased exercise must not merely be
 * un-rendered, it must never be sent to the browser, where anyone can read it out of the RSC
 * payload. The staff reads deliberately do NOT filter - they need to see what is staged.
 */

export type ResourceView = {
  id: string;
  title: string;
  description: string | null;
  kind: ResourceKindValue;
  url: string;
  orderIndex: number;
  visibleToStudents: boolean;
  /** Which of the three places this hangs off - what the staff badge reads. */
  scope: ResourceScope;
};

const SELECT = {
  id: true,
  title: true,
  description: true,
  kind: true,
  url: true,
  orderIndex: true,
  visibleToStudents: true,
  curriculumItemId: true,
  batchId: true,
  sessionId: true,
} as const;

type Row = {
  id: string;
  title: string;
  description: string | null;
  kind: string;
  url: string;
  orderIndex: number;
  visibleToStudents: boolean;
  curriculumItemId: string | null;
  batchId: string | null;
  sessionId: string | null;
};

function toView(r: Row): ResourceView {
  return {
    id: r.id,
    title: r.title,
    description: r.description,
    kind: r.kind as ResourceKindValue,
    url: r.url,
    orderIndex: r.orderIndex,
    visibleToStudents: r.visibleToStudents,
    scope: r.curriculumItemId ? "curriculumItem" : r.batchId ? "batch" : "session",
  };
}

/** Everything hanging off one curriculum row - the admin editor's list. */
export async function curriculumItemResources(itemIds: readonly string[]): Promise<Map<string, ResourceView[]>> {
  if (itemIds.length === 0) return new Map();
  const rows = await prisma.resource.findMany({
    where: { curriculumItemId: { in: [...itemIds] } },
    select: SELECT,
    orderBy: { orderIndex: "asc" },
  });
  const byItem = new Map<string, ResourceView[]>();
  for (const r of rows) {
    const list = byItem.get(r.curriculumItemId!) ?? [];
    list.push(toView(r));
    byItem.set(r.curriculumItemId!, list);
  }
  return byItem;
}

/**
 * A cohort's material, for the staff batch screen: the batch's own, plus each class's, plus the
 * curriculum rows behind those classes - so a coach can SEE the inherited material rather than
 * wondering why a student mentions a worksheet nobody posted to this batch.
 */
export async function batchResources(batchId: string): Promise<{
  batch: ResourceView[];
  bySession: Map<string, ResourceView[]>;
  /** Curriculum-level rows, keyed by the SESSION they will appear on in this cohort. */
  inheritedBySession: Map<string, ResourceView[]>;
}> {
  const sessions = await prisma.classSession.findMany({
    where: { batchId },
    select: { id: true, curriculumItemId: true },
  });
  const itemIds = sessions.map((s) => s.curriculumItemId).filter((id): id is string => !!id);

  const [batchRows, sessionRows, itemMap] = await Promise.all([
    prisma.resource.findMany({ where: { batchId }, select: SELECT, orderBy: { orderIndex: "asc" } }),
    prisma.resource.findMany({
      where: { sessionId: { in: sessions.map((s) => s.id) } },
      select: SELECT,
      orderBy: { orderIndex: "asc" },
    }),
    curriculumItemResources(itemIds),
  ]);

  const bySession = new Map<string, ResourceView[]>();
  for (const r of sessionRows) {
    const list = bySession.get(r.sessionId!) ?? [];
    list.push(toView(r));
    bySession.set(r.sessionId!, list);
  }

  const inheritedBySession = new Map<string, ResourceView[]>();
  for (const s of sessions) {
    const inherited = s.curriculumItemId ? itemMap.get(s.curriculumItemId) : undefined;
    if (inherited?.length) inheritedBySession.set(s.id, inherited);
  }

  return { batch: batchRows.map(toView), bySession, inheritedBySession };
}

/**
 * What a STUDENT may see, across every batch they are in.
 *
 * Returns the batch-level shelf separately from the per-class material, because the two answer
 * different questions: "where is our group" versus "what do I need for Saturday".
 */
export async function studentResources(batchIds: readonly string[]): Promise<{
  byBatch: Map<string, ResourceView[]>;
  bySession: Map<string, ResourceView[]>;
}> {
  const byBatch = new Map<string, ResourceView[]>();
  const bySession = new Map<string, ResourceView[]>();
  if (batchIds.length === 0) return { byBatch, bySession };

  const sessions = await prisma.classSession.findMany({
    where: { batchId: { in: [...batchIds] } },
    select: { id: true, batchId: true, curriculumItemId: true },
  });
  const itemIds = sessions.map((s) => s.curriculumItemId).filter((id): id is string => !!id);

  // `visibleToStudents` in every clause - the filter that must not be forgotten.
  const [batchRows, sessionRows, itemRows] = await Promise.all([
    prisma.resource.findMany({
      where: { batchId: { in: [...batchIds] }, visibleToStudents: true },
      select: SELECT,
      orderBy: { orderIndex: "asc" },
    }),
    prisma.resource.findMany({
      where: { sessionId: { in: sessions.map((s) => s.id) }, visibleToStudents: true },
      select: SELECT,
      orderBy: { orderIndex: "asc" },
    }),
    itemIds.length
      ? prisma.resource.findMany({
          where: { curriculumItemId: { in: itemIds }, visibleToStudents: true },
          select: SELECT,
          orderBy: { orderIndex: "asc" },
        })
      : Promise.resolve([] as Row[]),
  ]);

  for (const r of batchRows) {
    const list = byBatch.get(r.batchId!) ?? [];
    list.push(toView(r));
    byBatch.set(r.batchId!, list);
  }

  const itemMap = new Map<string, ResourceView[]>();
  for (const r of itemRows) {
    const list = itemMap.get(r.curriculumItemId!) ?? [];
    list.push(toView(r));
    itemMap.set(r.curriculumItemId!, list);
  }
  const ownBySession = new Map<string, ResourceView[]>();
  for (const r of sessionRows) {
    const list = ownBySession.get(r.sessionId!) ?? [];
    list.push(toView(r));
    ownBySession.set(r.sessionId!, list);
  }

  /**
   * The merge the student actually sees on a class card: the curriculum's material, then this
   * class's. The BATCH shelf is deliberately left out here - it is not about this class, and
   * repeating it under all eight would bury the one file that is.
   */
  for (const s of sessions) {
    const merged = mergeForSession({
      curriculumItem: s.curriculumItemId ? itemMap.get(s.curriculumItemId) ?? [] : [],
      session: ownBySession.get(s.id) ?? [],
    });
    if (merged.length) bySession.set(s.id, merged);
  }

  for (const [k, v] of byBatch) byBatch.set(k, sortResources(v));
  return { byBatch, bySession };
}
