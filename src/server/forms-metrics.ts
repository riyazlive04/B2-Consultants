import "server-only";

import { prisma } from "@/lib/prisma";
import type { FormField, FormSettings } from "@/lib/sites-types";

/** Read layer for native Forms (Synamate "Forms"). */

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
    fieldCount: Array.isArray(f.fields) ? (f.fields as unknown[]).length : 0,
    submissionCount: f.submissionCount,
    updatedAt: f.updatedAt,
  }));
}

export type FormSubmissionRow = {
  id: string;
  leadId: string | null;
  leadName: string | null;
  data: Record<string, string>;
  createdAt: Date;
};

export type FormDetail = {
  id: string;
  name: string;
  slug: string;
  published: boolean;
  fields: FormField[];
  settings: FormSettings;
  submissionCount: number;
  submissions: FormSubmissionRow[];
};

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
  return {
    id: f.id,
    name: f.name,
    slug: f.slug,
    published: f.published,
    fields: (f.fields as FormField[]) ?? [],
    settings: (f.settings as FormSettings) ?? { submitText: "Submit", successMessage: "Thanks!", leadSource: "LANDING_PAGE" },
    submissionCount: f.submissionCount,
    submissions: f.submissions.map((s) => ({
      id: s.id,
      leadId: s.lead?.id ?? null,
      leadName: s.lead?.name ?? null,
      data: (s.data as Record<string, string>) ?? {},
      createdAt: s.createdAt,
    })),
  };
}

export type PublicForm = {
  id: string;
  name: string;
  slug: string;
  fields: FormField[];
  settings: FormSettings;
};

export async function getPublicFormBySlug(slug: string): Promise<PublicForm | null> {
  const f = await prisma.form.findUnique({ where: { slug } });
  if (!f || !f.published) return null;
  return {
    id: f.id,
    name: f.name,
    slug: f.slug,
    fields: (f.fields as FormField[]) ?? [],
    settings: (f.settings as FormSettings) ?? { submitText: "Submit", successMessage: "Thanks!", leadSource: "LANDING_PAGE" },
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
      fields: (f.fields as FormField[]) ?? [],
      settings: (f.settings as FormSettings) ?? { submitText: "Submit", successMessage: "Thanks!", leadSource: "LANDING_PAGE" },
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
