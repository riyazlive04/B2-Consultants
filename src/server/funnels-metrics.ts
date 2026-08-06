import "server-only";

import { prisma } from "@/lib/prisma";
import type { Block } from "@/lib/sites-types";
import { assignVariant } from "@/lib/ab";
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
    include: { steps: { select: { views: true, abTestOf: true } } },
  });
  return funnels.map((f) => ({
    id: f.id,
    name: f.name,
    slug: f.slug,
    published: f.published,
    // Steps the visitor walks through — a variant is a second version of one of them, not an
    // extra stage, so "4 steps" stays 4 while a test is running.
    stepCount: f.steps.filter((s) => !s.abTestOf).length,
    // Views, on the other hand, count every arm: they are all traffic to this funnel.
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
  /** Relative traffic share against this step's own variants. Meaningless without them. */
  abWeight: number;
  /**
   * The A/B variants of this step. A variant is a full step in its own right — same builder, same
   * renderer, its own `views` — so it is typed as one. Nested here rather than left in the flat
   * step list because a variant is NOT a stage of the funnel: showing it in the step rail would
   * imply visitors pass through it on the way to the next page, and they never do.
   */
  variants: EditorStep[];
};

export type FunnelDetail = {
  id: string;
  name: string;
  slug: string;
  published: boolean;
  /**
   * The bands rendered around EVERY step. `null` means the funnel has none — distinct from `[]`,
   * which is a header someone deliberately emptied and may be about to rebuild.
   */
  headerBlocks: Block[] | null;
  footerBlocks: Block[] | null;
  steps: EditorStep[];
};

function toEditorStep(s: {
  id: string; name: string; slug: string; position: number; views: number;
  blocks: unknown; seoTitle: string | null; seoDescription: string | null; abWeight: number;
}, variants: EditorStep[] = []): EditorStep {
  return {
    id: s.id,
    name: s.name,
    slug: s.slug,
    position: s.position,
    views: s.views,
    blocks: (s.blocks as Block[]) ?? [],
    seoTitle: s.seoTitle,
    seoDescription: s.seoDescription,
    abWeight: s.abWeight,
    variants,
  };
}

export async function getFunnel(id: string): Promise<FunnelDetail | null> {
  const f = await prisma.funnel.findUnique({
    where: { id },
    // Slug order for the tie-break, not position: variants all share their control's position (it
    // is the control that occupies the slot in the funnel), so position alone would leave their
    // order to the database's whim and the weight boxes would shuffle between refreshes.
    include: { steps: { orderBy: [{ position: "asc" }, { slug: "asc" }] } },
  });
  if (!f) return null;

  const variantsOf = new Map<string, EditorStep[]>();
  for (const s of f.steps) {
    if (!s.abTestOf) continue;
    const list = variantsOf.get(s.abTestOf) ?? [];
    list.push(toEditorStep(s));
    variantsOf.set(s.abTestOf, list);
  }

  return {
    id: f.id,
    name: f.name,
    slug: f.slug,
    published: f.published,
    headerBlocks: (f.headerBlocks as Block[] | null) ?? null,
    footerBlocks: (f.footerBlocks as Block[] | null) ?? null,
    steps: f.steps.filter((s) => !s.abTestOf).map((s) => toEditorStep(s, variantsOf.get(s.id) ?? [])),
  };
}

// ─────────────────────────── Public ───────────────────────────

export type PublicStep = {
  funnelName: string;
  funnelSlug: string;
  /**
   * The page to render.
   *
   * `id` is the id of whichever page was ACTUALLY chosen — the control, or the variant this
   * visitor was assigned — because that is what the view counter must be stamped on. `slug` stays
   * the control's, because the URL is the experiment's address and must not change underneath a
   * visitor who is being split-tested.
   */
  step: { id: string; name: string; slug: string; position: number; blocks: Block[]; seoTitle: string | null; seoDescription: string | null };
  /** Rendered above and below the step. Empty when the funnel has no chrome. */
  header: Block[];
  footer: Block[];
  steps: { name: string; slug: string; position: number }[];
  forms: Record<string, PublicForm>;
  /** True when a variant is being served. Not used to render anything — it is what makes the
   *  builder's preview honest about which page it is looking at. */
  isVariant: boolean;
};

/**
 * Walk the WHOLE tree, not just the top level.
 *
 * Blocks used to be a flat list, so a top-level filter found every form. With section → row →
 * column nesting, a form embedded anywhere inside a band is several levels down — and a form
 * whose id was never collected renders as "[form not published]" on the live page, which is
 * the opt-in silently disappearing from a funnel that looks fine in the builder.
 */
function collectFormIds(list: Block[]): string[] {
  return list.flatMap((b) => [
    ...(b.type === "form" && b.formId ? [b.formId] : []),
    // A form opened from a CTA is not embedded anywhere in the tree, so it would be missed by a
    // walk that only looked for `form` nodes — and a popup whose form was never loaded is a
    // button that opens an empty dialog, on the page the ad spend lands on.
    ...(b.opensFormId ? [b.opensFormId] : []),
    ...collectFormIds(b.children ?? []),
    ...collectFormIds((b.columns ?? []).flat()),
  ]);
}

/** First (published) step slug for /p/<funnelSlug> → redirect target. */
export async function getPublicFunnelFirstStep(funnelSlug: string): Promise<string | null> {
  const f = await prisma.funnel.findUnique({
    where: { slug: funnelSlug },
    // A variant must never be the landing target: it has a lower position than nothing in
    // particular and answering /p/<funnel> with it would send half the traffic to a URL that is
    // supposed to be unaddressable.
    include: { steps: { where: { abTestOf: null }, orderBy: { position: "asc" }, take: 1, select: { slug: true } } },
  });
  if (!f || !f.published) return null;
  return f.steps[0]?.slug ?? null;
}

/**
 * Load the page a visitor should see.
 *
 * `visitorId` is the opaque cookie value written by middleware. It is the ONLY input to the split
 * beyond the step's own weights — see lib/ab.ts for why the assignment is a hash and not a roll
 * of the dice remembered in a cookie.
 *
 * Called twice per request (once by `generateMetadata`, once by the page). That is safe precisely
 * because the assignment is pure: both calls land on the same page, so the title can never
 * describe a variant the body is not rendering.
 */
export async function getPublicStep(funnelSlug: string, stepSlug: string, visitorId?: string | null): Promise<PublicStep | null> {
  const f = await prisma.funnel.findUnique({
    where: { slug: funnelSlug },
    include: { steps: { orderBy: [{ position: "asc" }, { slug: "asc" }] } },
  });
  if (!f || !f.published) return null;

  // Matched against the CONTROLS only. A variant carries a slug because the unique index needs
  // one, not because it is an address — letting `/p/funnel/landing-b` resolve would hand anyone
  // who guessed it a way to see both arms, and would pollute the variant's view count with
  // traffic that was never assigned to it.
  const step = f.steps.find((s) => s.slug === stepSlug && !s.abTestOf);
  if (!step) return null;

  const variants = f.steps.filter((s) => s.abTestOf === step.id);
  const chosen = assignVariant(
    [step, ...variants].map((s) => ({ id: s.id, abWeight: s.abWeight, row: s })),
    visitorId ?? null,
    step.id,
  )!.row;

  const header = (f.headerBlocks as Block[] | null) ?? [];
  const footer = (f.footerBlocks as Block[] | null) ?? [];
  const blocks = (chosen.blocks as Block[]) ?? [];
  // Chrome is collected too: a header with the newsletter form in it is the exact case where a
  // form silently failing to resolve would be least visible in the builder and most costly live.
  const forms = await getPublicFormsByIds([...new Set(collectFormIds([...header, ...blocks, ...footer]))]);

  return {
    funnelName: f.name,
    funnelSlug: f.slug,
    step: {
      id: chosen.id,
      name: step.name,
      slug: step.slug,
      position: step.position,
      blocks,
      // SEO comes from the page being SHOWN. A variant that rewrites the headline usually rewrites
      // the title with it, and shipping the control's title over the variant's copy would make the
      // two arms differ in a way the test was not measuring.
      seoTitle: chosen.seoTitle,
      seoDescription: chosen.seoDescription,
    },
    header,
    footer,
    steps: f.steps.filter((s) => !s.abTestOf).map((s) => ({ name: s.name, slug: s.slug, position: s.position })),
    forms,
    isVariant: chosen.id !== step.id,
  };
}

export async function recordStepView(stepId: string): Promise<void> {
  await prisma.funnelStep.update({ where: { id: stepId }, data: { views: { increment: 1 } } }).catch(() => {});
}
