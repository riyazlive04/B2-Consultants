import "server-only";

import { prisma } from "@/lib/prisma";
import {
  isStaticItem,
  normaliseItems,
  normaliseSettings,
  type FormAnswers,
  type FormItem,
  type FormSettings,
} from "@/lib/sites-types";
import { summariseAnswers, type QuestionSummary } from "@/lib/form-summary";

/**
 * Read layer for native Forms (Synamate "Forms").
 *
 * EVERY read goes through `normaliseItems`/`normaliseSettings`. The `fields` and `settings`
 * columns are `Json`, and rows written before the Google-parity rebuild are still in the old
 * shape - options as bare strings, no item ids, no sections. Normalising on read is what lets that
 * rebuild ship without a migration and without a flag day: an old row is upgraded the moment it is
 * looked at, and persisted in the new shape the next time it is saved.
 */

export type FormListRow = {
  id: string;
  name: string;
  slug: string;
  published: boolean;
  fieldCount: number;
  submissionCount: number;
  updatedAt: Date;
};

export async function getFormsList(): Promise<FormListRow[]> {
  const forms = await prisma.form.findMany({ orderBy: { updatedAt: "desc" } });
  return forms.map((f) => ({
    id: f.id,
    name: f.name,
    slug: f.slug,
    published: f.published,
    // Questions, not items: a section break and a heading are not things anyone answers, and
    // counting them would inflate "3 fields" into "6 fields" the moment a form gains pages.
    fieldCount: normaliseItems(f.fields).filter((i) => !isStaticItem(i.type)).length,
    submissionCount: f.submissionCount,
    updatedAt: f.updatedAt,
  }));
}

export type FormSubmissionRow = {
  id: string;
  leadId: string | null;
  leadName: string | null;
  data: FormAnswers;
  createdAt: Date;
};

export type FormDetail = {
  id: string;
  name: string;
  slug: string;
  published: boolean;
  fields: FormItem[];
  settings: FormSettings;
  submissionCount: number;
  submissions: FormSubmissionRow[];
  /** Per-question roll-up over every response, not just the page of them listed above. */
  summary: QuestionSummary[];
  /** Responses actually folded into `summary`, so the page can admit to a cap being hit. */
  summarised: number;
};

/** Enough to summarise a real campaign; a ceiling so one popular form cannot pull the page over. */
const SUMMARY_CAP = 5000;

export async function getForm(id: string): Promise<FormDetail | null> {
  const f = await prisma.form.findUnique({
    where: { id },
    include: {
      submissions: {
        orderBy: { createdAt: "desc" },
        take: 100,
        include: { lead: { select: { id: true, name: true } } },
      },
    },
  });
  if (!f) return null;

  const fields = normaliseItems(f.fields);
  // The listed submissions are capped at 100 for the table; the SUMMARY must not be, or the
  // charts would quietly describe the most recent hundred people and label it "all responses".
  const forSummary = await prisma.formSubmission.findMany({
    where: { formId: id },
    orderBy: { createdAt: "desc" },
    take: SUMMARY_CAP,
    select: { data: true },
  });
  const answerRows = forSummary.map((s) => (s.data as FormAnswers) ?? {});

  return {
    id: f.id,
    name: f.name,
    slug: f.slug,
    published: f.published,
    fields,
    settings: normaliseSettings(f.settings),
    submissionCount: f.submissionCount,
    submissions: f.submissions.map((s) => ({
      id: s.id,
      leadId: s.lead?.id ?? null,
      leadName: s.lead?.name ?? null,
      data: (s.data as FormAnswers) ?? {},
      createdAt: s.createdAt,
    })),
    summary: summariseAnswers(fields, answerRows),
    summarised: answerRows.length,
  };
}

export type PublicForm = {
  id: string;
  name: string;
  slug: string;
  fields: FormItem[];
  settings: FormSettings;
};

export async function getPublicFormBySlug(slug: string): Promise<PublicForm | null> {
  const f = await prisma.form.findUnique({ where: { slug } });
  if (!f || !f.published) return null;
  return {
    id: f.id,
    name: f.name,
    slug: f.slug,
    fields: normaliseItems(f.fields),
    settings: normaliseSettings(f.settings),
  };
}

export async function getPublicFormsByIds(ids: string[]): Promise<Record<string, PublicForm>> {
  if (ids.length === 0) return {};
  const forms = await prisma.form.findMany({ where: { id: { in: ids }, published: true } });
  const out: Record<string, PublicForm> = {};
  for (const f of forms) {
    out[f.id] = {
      id: f.id,
      name: f.name,
      slug: f.slug,
      fields: normaliseItems(f.fields),
      settings: normaliseSettings(f.settings),
    };
  }
  return out;
}

/** Pipelines + stages + tags for the form/opportunity settings pickers. */
export async function getSitesPickers() {
  const [pipelines, tags, forms] = await Promise.all([
    prisma.pipeline.findMany({
      orderBy: [{ isDefault: "desc" }, { position: "asc" }],
      include: { stages: { orderBy: { position: "asc" }, select: { id: true, name: true } } },
    }),
    prisma.tag.findMany({ select: { name: true }, orderBy: { name: "asc" } }),
    prisma.form.findMany({ where: { published: true }, select: { id: true, name: true }, orderBy: { name: "asc" } }),
  ]);
  return {
    pipelines: pipelines.map((p) => ({ id: p.id, name: p.name, stages: p.stages })),
    tags: tags.map((t) => t.name),
    forms,
  };
}
