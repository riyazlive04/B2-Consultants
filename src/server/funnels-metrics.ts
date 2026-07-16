import "server-only";

import { prisma } from "@/lib/prisma";
import type { Block } from "@/lib/sites-types";
import { getPublicFormsByIds, type PublicForm } from "./forms-metrics";

/** Read layer for Funnels / landing pages (Synamate "Funnels"/"Websites"). */

export type FunnelListRow = {
  id: string;
  name: string;
  slug: string;
  published: boolean;
  stepCount: number;
  totalViews: number;
  updatedAt: Date;
};

export async function getFunnelsList(): Promise<FunnelListRow[]> {
  const funnels = await prisma.funnel.findMany({
    orderBy: { updatedAt: "desc" },
    include: { steps: { select: { views: true } } },
  });
  return funnels.map((f) => ({
    id: f.id,
    name: f.name,
    slug: f.slug,
    published: f.published,
    stepCount: f.steps.length,
    totalViews: f.steps.reduce((a, s) => a + s.views, 0),
    updatedAt: f.updatedAt,
  }));
}

export type EditorStep = {
  id: string;
  name: string;
  slug: string;
  position: number;
  views: number;
  blocks: Block[];
  seoTitle: string | null;
  seoDescription: string | null;
};

export type FunnelDetail = {
  id: string;
  name: string;
  slug: string;
  published: boolean;
  steps: EditorStep[];
};

export async function getFunnel(id: string): Promise<FunnelDetail | null> {
  const f = await prisma.funnel.findUnique({
    where: { id },
    include: { steps: { orderBy: { position: "asc" } } },
  });
  if (!f) return null;
  return {
    id: f.id,
    name: f.name,
    slug: f.slug,
    published: f.published,
    steps: f.steps.map((s) => ({
      id: s.id,
      name: s.name,
      slug: s.slug,
      position: s.position,
      views: s.views,
      blocks: (s.blocks as Block[]) ?? [],
      seoTitle: s.seoTitle,
      seoDescription: s.seoDescription,
    })),
  };
}

// ─────────────────────────── Public ───────────────────────────

export type PublicStep = {
  funnelName: string;
  funnelSlug: string;
  step: { id: string; name: string; slug: string; position: number; blocks: Block[]; seoTitle: string | null; seoDescription: string | null };
  steps: { name: string; slug: string; position: number }[];
  forms: Record<string, PublicForm>;
};

/** First (published) step slug for /p/<funnelSlug> → redirect target. */
export async function getPublicFunnelFirstStep(funnelSlug: string): Promise<string | null> {
  const f = await prisma.funnel.findUnique({
    where: { slug: funnelSlug },
    include: { steps: { orderBy: { position: "asc" }, take: 1, select: { slug: true } } },
  });
  if (!f || !f.published) return null;
  return f.steps[0]?.slug ?? null;
}

export async function getPublicStep(funnelSlug: string, stepSlug: string): Promise<PublicStep | null> {
  const f = await prisma.funnel.findUnique({
    where: { slug: funnelSlug },
    include: { steps: { orderBy: { position: "asc" } } },
  });
  if (!f || !f.published) return null;
  const step = f.steps.find((s) => s.slug === stepSlug);
  if (!step) return null;

  const blocks = (step.blocks as Block[]) ?? [];
  const formIds = blocks.filter((b) => b.type === "form" && b.formId).map((b) => b.formId!) as string[];
  const forms = await getPublicFormsByIds(formIds);

  return {
    funnelName: f.name,
    funnelSlug: f.slug,
    step: {
      id: step.id,
      name: step.name,
      slug: step.slug,
      position: step.position,
      blocks,
      seoTitle: step.seoTitle,
      seoDescription: step.seoDescription,
    },
    steps: f.steps.map((s) => ({ name: s.name, slug: s.slug, position: s.position })),
    forms,
  };
}

export async function recordStepView(stepId: string): Promise<void> {
  await prisma.funnelStep.update({ where: { id: stepId }, data: { views: { increment: 1 } } }).catch(() => {});
}
