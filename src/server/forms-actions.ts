"use server";

import { revalidatePath } from "next/cache";
import { headers } from "next/headers";
import { Prisma, type LeadSource } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { requireSection, capabilityCheck } from "@/lib/rbac";
import { clientIpFrom, rateLimitOk } from "@/lib/rate-limit";
import { getTodayInrPerEur, inrMinorToEurMinor } from "@/lib/fx";
import { majorStringToMinor } from "@/lib/format";
import { upsertIntakeLead } from "./lead-intake";
import { emitTrigger } from "./automation";
import {
  defaultFormFields, defaultFormSettings, slugify, CONTACT_FIELD_KEYS,
  type FormField, type FormSettings,
} from "@/lib/sites-types";
import type { ActionResult } from "./finance-actions";

/**
 * Native Forms (Synamate "Forms"). Admin CRUD is gated to the `forms` section; `submitPublicForm`
 * is PUBLIC (no session) — rate-limited + honeypot-guarded — and routes captures through the same
 * idempotent lead-intake the webhooks use, so submissions land straight in the CRM.
 */

const LEAD_SOURCES = [
  "INSTAGRAM", "YOUTUBE", "LINKEDIN", "WHATSAPP", "REFERRAL", "SUMMIT", "WORKSHOP",
  "META_ADS", "LANDING_PAGE", "GHOSTED_BLUEPRINT", "OTHER",
] as const;
function toLeadSource(s: string | undefined): LeadSource {
  return (LEAD_SOURCES as readonly string[]).includes(s ?? "") ? (s as LeadSource) : "LANDING_PAGE";
}

async function uniqueFormSlug(base: string, ignoreId?: string): Promise<string> {
  const root = slugify(base);
  let slug = root;
  let n = 1;
  for (;;) {
    const hit = await prisma.form.findUnique({ where: { slug } });
    if (!hit || hit.id === ignoreId) return slug;
    slug = `${root}-${++n}`;
  }
}

// ─────────────────────────── Admin CRUD ───────────────────────────

export async function createForm(form: FormData): Promise<ActionResult> {
  const session = await requireSection("forms");
  const name = String(form.get("name") ?? "").trim();
  if (!name) return { ok: false, error: "Form name is required" };
  const slug = await uniqueFormSlug(name);
  await prisma.form.create({
    data: {
      name,
      slug,
      fields: defaultFormFields() as unknown as Prisma.InputJsonValue,
      settings: defaultFormSettings() as unknown as Prisma.InputJsonValue,
      createdById: session.user.id,
    },
  });
  revalidatePath("/forms");
  return { ok: true };
}

export async function saveForm(
  id: string,
  payload: { name: string; fields: FormField[]; settings: FormSettings },
): Promise<ActionResult> {
  await requireSection("forms");
  if (!payload.name.trim()) return { ok: false, error: "Form name is required" };
  if (!payload.fields.length) return { ok: false, error: "Add at least one field" };
  // keys must be unique + non-empty
  const keys = payload.fields.map((f) => f.key.trim());
  if (keys.some((k) => !k)) return { ok: false, error: "Every field needs a key" };
  if (new Set(keys).size !== keys.length) return { ok: false, error: "Field keys must be unique" };

  await prisma.form.update({
    where: { id },
    data: {
      name: payload.name.trim(),
      fields: payload.fields as unknown as Prisma.InputJsonValue,
      settings: payload.settings as unknown as Prisma.InputJsonValue,
    },
  });
  revalidatePath("/forms");
  revalidatePath(`/forms/${id}`);
  return { ok: true };
}

export async function togglePublishForm(id: string): Promise<ActionResult> {
  await requireSection("forms");
  const f = await prisma.form.findUnique({ where: { id }, select: { published: true, fields: true } });
  if (!f) return { ok: false, error: "Form not found" };
  if (!f.published) {
    const fields = (f.fields as FormField[]) ?? [];
    const keys = new Set(fields.map((x) => x.key));
    if (!keys.has("name") || !keys.has("phone")) {
      return { ok: false, error: "Publish needs a 'name' and a 'phone' field so captures reach the CRM" };
    }
  }
  await prisma.form.update({ where: { id }, data: { published: !f.published } });
  revalidatePath("/forms");
  revalidatePath(`/forms/${id}`);
  return { ok: true };
}

export async function deleteForm(id: string): Promise<ActionResult> {
  const { allowed, denied } = await capabilityCheck("pipeline.configure");
  if (!allowed) return denied;
  await prisma.form.delete({ where: { id } });
  revalidatePath("/forms");
  return { ok: true };
}

// ─────────────────────────── Public submit (no session) ───────────────────────────

export type SubmitResult =
  | { ok: true; message: string; redirectUrl?: string }
  | { ok: false; error: string };

export async function submitPublicForm(slug: string, form: FormData): Promise<SubmitResult> {
  const ip = clientIpFrom(await Promise.resolve(headers()));
  if (!rateLimitOk(`form:${ip}`, 8, 10 * 60_000)) {
    return { ok: false, error: "Too many submissions. Please try again in a few minutes." };
  }
  // Honeypot — bots fill hidden fields; humans never see them.
  if (String(form.get("company_website") ?? "").trim()) {
    return { ok: true, message: "Thanks!" };
  }

  const dbForm = await prisma.form.findUnique({ where: { slug } });
  if (!dbForm || !dbForm.published) return { ok: false, error: "This form is not available." };
  const fields = (dbForm.fields as FormField[]) ?? [];
  const settings = (dbForm.settings as FormSettings) ?? { submitText: "Submit", successMessage: "Thanks!", leadSource: "LANDING_PAGE" };

  // Collect + validate answers
  const data: Record<string, string> = {};
  for (const f of fields) {
    const raw = f.type === "checkbox"
      ? (form.get(f.key) ? "Yes" : "")
      : String(form.get(f.key) ?? "").trim().slice(0, 2000);
    if (f.required && !raw) return { ok: false, error: `${f.label} is required` };
    if (raw) data[f.key] = raw;
  }

  // UTM passthrough
  const utm: Record<string, string> = {};
  for (const k of ["utm_source", "utm_medium", "utm_campaign", "utm_term", "utm_content"]) {
    const v = String(form.get(k) ?? "").trim();
    if (v) utm[k] = v.slice(0, 200);
  }

  const name = data["name"];
  const phone = data["phone"];

  let leadId: string | null = null;
  if (name && phone) {
    const { lead } = await upsertIntakeLead({
      name,
      phone,
      email: data["email"] ?? null,
      city: data["city"] ?? null,
      industry: data["industry"] ?? null,
      leadSource: toLeadSource(settings.leadSource),
      source: "NATIVE_FORM",
      externalRef: null,
      utm: Object.keys(utm).length ? utm : null,
    });
    leadId = lead.id;

    // Custom answers (non-contact keys) → the contact's customFields blob.
    const extra: Record<string, string> = {};
    for (const [k, v] of Object.entries(data)) {
      if (!(CONTACT_FIELD_KEYS as readonly string[]).includes(k)) extra[k] = v;
    }
    if (Object.keys(extra).length) {
      const cur = (await prisma.lead.findUnique({ where: { id: leadId }, select: { customFields: true } }))?.customFields as Record<string, string> | null;
      await prisma.lead.update({
        where: { id: leadId },
        data: { customFields: { ...(cur ?? {}), ...extra } as Prisma.InputJsonObject },
      });
    }

    if (settings.tag) {
      const tagName = settings.tag.trim().toLowerCase();
      const tag = await prisma.tag.upsert({ where: { name: tagName }, update: {}, create: { name: tagName } });
      await prisma.lead.update({ where: { id: leadId }, data: { tags: { connect: { id: tag.id } } } });
    }

    if (settings.createOpportunity && settings.pipelineId && settings.stageId) {
      const stage = await prisma.pipelineStage.findUnique({ where: { id: settings.stageId }, select: { pipelineId: true } });
      if (stage && stage.pipelineId === settings.pipelineId) {
        const fx = await getTodayInrPerEur();
        const inr = settings.opportunityValueInr?.trim() ? majorStringToMinor(settings.opportunityValueInr) : 0n;
        const max = await prisma.opportunity.aggregate({ where: { stageId: settings.stageId }, _max: { position: true } });
        await prisma.opportunity.create({
          data: {
            leadId,
            pipelineId: settings.pipelineId,
            stageId: settings.stageId,
            name,
            valueInrMinor: inr,
            valueEurMinor: inrMinorToEurMinor(inr, fx.rate),
            fxRateUsed: fx.rate,
            source: toLeadSource(settings.leadSource),
            position: (max._max.position ?? -1) + 1,
          },
        });
      }
    }
  }

  await prisma.$transaction([
    prisma.formSubmission.create({
      data: {
        formId: dbForm.id,
        leadId,
        data: data as Prisma.InputJsonObject,
        utm: Object.keys(utm).length ? (utm as Prisma.InputJsonObject) : undefined,
      },
    }),
    prisma.form.update({ where: { id: dbForm.id }, data: { submissionCount: { increment: 1 } } }),
  ]);

  if (leadId) await emitTrigger("FORM_SUBMITTED", { leadId, formId: dbForm.id });

  revalidatePath("/contacts");
  revalidatePath(`/forms/${dbForm.id}`);
  return { ok: true, message: settings.successMessage || "Thanks!", redirectUrl: settings.redirectUrl?.trim() || undefined };
}
