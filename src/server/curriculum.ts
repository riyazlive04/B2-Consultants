import "server-only";
import { cache } from "react";
import { prisma } from "@/lib/prisma";
import { planTimetable, sortRows, type CurriculumRow, type TimetablePlan } from "@/lib/curriculum";
import { curriculumItemResources, type ResourceView } from "./resources";

/**
 * Curriculum reads - the programme timetables a cohort's classes are generated from.
 *
 * Writes live in `curriculum-actions.ts`; the generate/regenerate path lives in
 * `batch-timetable-actions.ts`. The planning arithmetic is pure and lives in
 * `lib/curriculum.ts`, so the preview on screen and the rows written to the database come out
 * of the same function - a preview that could disagree with the write would be worse than none.
 */

export type CurriculumItemView = CurriculumRow & {
  /** Material attached to this row - inherited by every cohort built from the curriculum. */
  resources: ResourceView[];
};

export type CurriculumTemplateView = {
  id: string;
  line: "B2" | "GERMAN_NOTE";
  name: string;
  levelCode: string | null;
  description: string | null;
  sprintDays: number | null;
  active: boolean;
  items: CurriculumItemView[];
  /** How many cohorts were built from it - what makes retiring one a visible decision. */
  batchCount: number;
  /** Total live + pre-recorded sessions, for the list row. */
  sessionCount: number;
  weekCount: number;
};

/** Prisma rows → the plain shape every client component and the planner both take. */
function toItemView(i: {
  id: string;
  weekNumber: number;
  orderIndex: number;
  title: string;
  framework: string | null;
  type: string;
  delivery: string;
  durationMins: number | null;
  dayOfWeek: number | null;
  startTime: string | null;
  notes: string | null;
}): CurriculumItemView {
  return {
    id: i.id,
    weekNumber: i.weekNumber,
    orderIndex: i.orderIndex,
    title: i.title,
    framework: i.framework,
    type: i.type,
    delivery: i.delivery === "PRE_RECORDED" ? "PRE_RECORDED" : "LIVE",
    durationMins: i.durationMins,
    dayOfWeek: i.dayOfWeek,
    startTime: i.startTime,
    notes: i.notes,
    resources: [],
  };
}

/** Fill in each row's material in one read, rather than a query per row. */
async function withResources(items: CurriculumItemView[]): Promise<CurriculumItemView[]> {
  const byItem = await curriculumItemResources(items.map((i) => i.id));
  return items.map((i) => ({ ...i, resources: byItem.get(i.id) ?? [] }));
}

export const listCurriculumTemplates = cache(
  async (opts: { line?: "B2" | "GERMAN_NOTE"; activeOnly?: boolean } = {}): Promise<CurriculumTemplateView[]> => {
    const rows = await prisma.curriculumTemplate.findMany({
      where: {
        ...(opts.line ? { line: opts.line } : {}),
        ...(opts.activeOnly ? { active: true } : {}),
      },
      include: {
        items: { orderBy: [{ weekNumber: "asc" }, { orderIndex: "asc" }] },
        _count: { select: { batches: true } },
      },
      orderBy: [{ active: "desc" }, { name: "asc" }],
    });

    const allResources = await curriculumItemResources(rows.flatMap((t) => t.items.map((i) => i.id)));
    return rows.map((t) => {
      const items = t.items.map(toItemView).map((i) => ({ ...i, resources: allResources.get(i.id) ?? [] }));
      return {
        id: t.id,
        line: t.line,
        name: t.name,
        levelCode: t.levelCode,
        description: t.description,
        sprintDays: t.sprintDays,
        active: t.active,
        items,
        batchCount: t._count.batches,
        sessionCount: items.length,
        weekCount: new Set(items.map((i) => i.weekNumber)).size,
      };
    });
  },
);

export const getCurriculumTemplate = cache(async (id: string): Promise<CurriculumTemplateView | null> => {
  const t = await prisma.curriculumTemplate.findUnique({
    where: { id },
    include: {
      items: { orderBy: [{ weekNumber: "asc" }, { orderIndex: "asc" }] },
      _count: { select: { batches: true } },
    },
  });
  if (!t) return null;
  const items = await withResources(t.items.map(toItemView));
  return {
    id: t.id,
    line: t.line,
    name: t.name,
    levelCode: t.levelCode,
    description: t.description,
    sprintDays: t.sprintDays,
    active: t.active,
    items,
    batchCount: t._count.batches,
    sessionCount: items.length,
    weekCount: new Set(items.map((i) => i.weekNumber)).size,
  };
});

/**
 * What a batch's timetable WOULD look like, without writing anything.
 *
 * The same call the generate action makes, so what the founder approves is what lands. Returns
 * null when the template has no rows - a preview of nothing is a confusing way to say "author
 * the curriculum first".
 */
export async function previewTimetable(
  templateId: string,
  startYmd: string,
): Promise<TimetablePlan | null> {
  const template = await getCurriculumTemplate(templateId);
  if (!template || template.items.length === 0) return null;
  return planTimetable(sortRows(template.items), startYmd, { sprintDays: template.sprintDays });
}
