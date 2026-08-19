"use server";

import { revalidatePath } from "next/cache";
import { cookies, headers } from "next/headers";
import { z } from "zod";
import { Prisma, type LeadSource } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { requireSection, capabilityCheck } from "@/lib/rbac";
import { optionalRule } from "@/lib/field-rules";
import { clientIpFrom, takeTokens, RATE_RULES } from "@/lib/rate-limit";
import { getTodayInrPerEur, inrMinorToEurMinor } from "@/lib/fx";
import { majorStringToMinor } from "@/lib/format";
import { upsertIntakeLead } from "./lead-intake";
import { observedOriginDomain } from "./request-origin";
import { ensureDefaultOpportunity } from "./opportunity-sync";
import { emitTrigger } from "./automation";
import { logActivity, diffFields } from "./activity-log";
import {
  defaultFormFields, defaultFormSettings, slugify, CONTACT_FIELD_KEYS,
  normaliseItems, normaliseSettings, isStaticItem, isChoiceItem, isMultiItem,
  reachableItems, validateAnswer, answerToText, pagesOf, computeScore,
  OTHER_VALUE, otherFieldName,
  type FormItem, type FormAnswers, type FormSettings,
} from "@/lib/sites-types";
import type { ActionResult } from "./finance-actions";

/**
 * Native Forms (Synamate "Forms"). Admin CRUD is gated to the `forms` section; `submitPublicForm`
 * is PUBLIC (no session) - rate-limited + honeypot-guarded - and routes captures through the same
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
  const row = await prisma.form.create({
    data: {
      name,
      slug,
      fields: defaultFormFields() as unknown as Prisma.InputJsonValue,
      settings: defaultFormSettings() as unknown as Prisma.InputJsonValue,
      createdById: session.user.id,
    },
  });
  await logActivity(session, {
    action: "form.create",
    section: "forms",
    entityType: "Form",
    entityId: row.id,
    summary: `Created the form "${name}"`,
    meta: { slug },
  });
  revalidatePath("/forms");
  return { ok: true };
}

/**
 * The two settings the app later consumes as DATA rather than rendering as copy:
 *
 *   redirectUrl         - handed to `window.location.href` by PublicForm after a submit.
 *   opportunityValueInr - parsed into paise by `majorStringToMinor` on the public submit path.
 *
 * Re-checked here because `saveForm` takes a typed payload rather than FormData: TypeScript is not
 * a runtime gate, so the builder's character filter is UX only and this is the real one. The rest of
 * FormSettings (submitText, successMessage, tag, field labels…) is free-text copy and stays so.
 */
/**
 * A SITE-RELATIVE redirect target: "/p/vsl-funnel/vsl".
 *
 * The `url` rule below adds a missing scheme, which is right for a lead typing
 * "linkedin.com/in/x" and wrong here - it turns "/p/vsl-funnel/vsl" into the
 * nonsense host "https://p/vsl-funnel/vsl". Funnel steps redirect WITHIN this app,
 * so pinning the host would hardcode localhost into data that also has to work on
 * the live domain. `window.location.href = "/p/..."` already resolves against the
 * current origin, so the relative form is the portable one.
 *
 * A single leading slash only. "//evil.com" is protocol-relative - it LOOKS like a
 * path and navigates off-site, which is the open-redirect this guards against.
 */
const sitePathSchema = z
  .string()
  .trim()
  .regex(/^\/(?!\/)[^\s]*$/, "Enter a link, or a path beginning with /");

const formValueSettingsSchema = z.object({
  redirectUrl: z.union([sitePathSchema, optionalRule("url")]),
  opportunityValueInr: optionalRule("money"),
});

/**
 * Structural checks on the item list that `normaliseItems` cannot make on its own - it sanitises
 * each item in isolation, whereas these are all statements about the list as a whole.
 *
 * Returns the first problem in the author's words, or null.
 */
function checkItems(items: FormItem[]): string | null {
  const questions = items.filter((i) => !isStaticItem(i.type));
  if (questions.length === 0) return "Add at least one question";

  const keys = questions.map((f) => f.key.trim());
  if (keys.some((k) => !k)) return "Every question needs a key";
  if (new Set(keys).size !== keys.length) return "Question keys must be unique";

  for (const q of questions) {
    if (isChoiceItem(q.type) && (q.options ?? []).length === 0) {
      return `"${q.label || q.key}" needs at least one option`;
    }
    if ((q.options ?? []).some((o) => !o.label.trim())) {
      return `"${q.label || q.key}" has a blank option`;
    }
    if (q.validation?.kind === "regex") {
      try {
        new RegExp(q.validation.pattern);
      } catch {
        return `"${q.label || q.key}" has a validation pattern that isn't valid`;
      }
    }
  }

  // Branch targets must name a section that comes LATER. Checked here and not only in the picker
  // because the picker is UX: a stale target left behind by deleting a section would otherwise sit
  // in the JSON and silently fall through to "next page" for every respondent.
  const pages = pagesOf(items);
  const pageOfSection = new Map(pages.filter((p) => p.section).map((p) => [p.section!.id, p.index]));
  for (const page of pages) {
    const targets = [
      ...page.items.flatMap((i) => (i.options ?? []).map((o) => o.goTo)),
      page.section?.goTo,
    ].filter((t): t is string => !!t && t !== "submit");
    for (const t of targets) {
      const to = pageOfSection.get(t);
      if (to == null) return "A branch points at a section that no longer exists";
      if (to <= page.index) return "A branch can only jump forwards, to a later section";
    }
  }
  return null;
}

export async function saveForm(
  id: string,
  payload: { name: string; fields: FormItem[]; settings: FormSettings },
): Promise<ActionResult> {
  const session = await requireSection("forms");
  if (!payload.name.trim()) return { ok: false, error: "Form name is required" };

  // A server action's argument is wire data, not a typed object - the TypeScript signature above
  // is a claim about the intended caller, not a guarantee about the actual one. Normalising here
  // is what makes the length caps and the type whitelist real rather than advisory.
  const fields = normaliseItems(payload.fields);
  const problem = checkItems(fields);
  if (problem) return { ok: false, error: problem };

  const values = formValueSettingsSchema.safeParse({
    redirectUrl: payload.settings.redirectUrl ?? "",
    opportunityValueInr: payload.settings.opportunityValueInr ?? "",
  });
  if (!values.success) {
    return { ok: false, error: values.error.issues[0]?.message ?? "Check the form settings" };
  }
  // Store the NORMALISED values - `url` adds a missing scheme, so what the public page redirects to
  // is the parsed link, not the raw typing.
  const settings: FormSettings = { ...normaliseSettings(payload.settings), ...values.data };

  const before = await prisma.form.findUnique({ where: { id }, select: { name: true, fields: true, settings: true } });
  await prisma.form.update({
    where: { id },
    data: {
      name: payload.name.trim(),
      fields: fields as unknown as Prisma.InputJsonValue,
      settings: settings as unknown as Prisma.InputJsonValue,
    },
  });
  // The builder PUTs the whole form on every save, so the JSON columns are compared but never
  // copied into the log - the founder wants "the fields changed", not a diff of every question.
  const named = diffFields({ name: before?.name ?? "" }, { name: payload.name.trim() });
  const changed = [
    ...named.changed,
    ...(JSON.stringify(before?.fields ?? null) !== JSON.stringify(fields) ? ["fields"] : []),
    ...(JSON.stringify(before?.settings ?? null) !== JSON.stringify(settings) ? ["settings"] : []),
  ];
  if (changed.length) {
    await logActivity(session, {
      action: "form.update",
      section: "forms",
      entityType: "Form",
      entityId: id,
      summary: `Edited the form "${payload.name.trim()}"`,
      meta: { changed, before: named.before, after: named.after, fieldCount: fields.length },
    });
  }
  revalidatePath("/forms");
  revalidatePath(`/forms/${id}`);
  return { ok: true };
}

export async function togglePublishForm(id: string): Promise<ActionResult> {
  const session = await requireSection("forms");
  const f = await prisma.form.findUnique({ where: { id }, select: { name: true, published: true, fields: true } });
  if (!f) return { ok: false, error: "Form not found" };
  if (!f.published) {
    const keys = new Set(normaliseItems(f.fields).filter((x) => !isStaticItem(x.type)).map((x) => x.key));
    if (!keys.has("name") || !keys.has("phone")) {
      return { ok: false, error: "Publish needs a 'name' and a 'phone' field so captures reach the CRM" };
    }
  }
  await prisma.form.update({ where: { id }, data: { published: !f.published } });
  await logActivity(session, {
    action: f.published ? "form.unpublish" : "form.publish",
    section: "forms",
    entityType: "Form",
    entityId: id,
    summary: `${f.published ? "Unpublished" : "Published"} the form "${f.name}"`,
  });
  revalidatePath("/forms");
  revalidatePath(`/forms/${id}`);
  return { ok: true };
}

export async function deleteForm(id: string): Promise<ActionResult> {
  const { allowed, denied, session } = await capabilityCheck("sites.manage");
  if (!allowed) return denied;
  const row = await prisma.form.delete({ where: { id } });
  await logActivity(session, {
    action: "form.delete",
    section: "forms",
    entityType: "Form",
    entityId: id,
    summary: `Deleted the form "${row.name}"`,
    meta: { slug: row.slug, submissionCount: row.submissionCount },
  });
  revalidatePath("/forms");
  return { ok: true };
}

// ─────────────────────────── Public submit (no session) ───────────────────────────

export type SubmitResult =
  | { ok: true; message: string; redirectUrl?: string }
  | { ok: false; error: string };

/**
 * Read one answer per question out of the posted FormData.
 *
 * Multi-select posts the same name several times, so it needs `getAll` - `get` would keep the
 * first box ticked and silently discard the rest, which is the sort of loss nobody notices until
 * they compare a response against what the person says they chose.
 *
 * "Other" arrives as two controls: the option itself posts a sentinel, and the free text posts
 * under a companion name. They are folded into one answer here so that everything downstream -
 * validation, storage, the summary charts, the CSV - sees a plain string.
 */
function collectAnswers(items: readonly FormItem[], form: FormData): FormAnswers {
  const out: FormAnswers = {};
  const clip = (s: string, max = 2000) => s.trim().slice(0, max);

  for (const it of items) {
    if (isStaticItem(it.type)) continue;
    const otherText = clip(String(form.get(otherFieldName(it.key)) ?? ""), 500);

    if (isMultiItem(it.type)) {
      out[it.key] = form
        .getAll(it.key)
        .map((v) => clip(String(v), 500))
        .map((v) => (v === OTHER_VALUE ? otherText : v))
        .filter(Boolean)
        .slice(0, 50); // a ceiling on a hand-crafted POST, not a limit anyone can reach by clicking
    } else if (it.type === "checkbox") {
      out[it.key] = form.get(it.key) ? "Yes" : "";
    } else {
      const raw = clip(String(form.get(it.key) ?? ""));
      out[it.key] = raw === OTHER_VALUE ? otherText : raw;
    }
  }
  return out;
}

export async function submitPublicForm(slug: string, form: FormData): Promise<SubmitResult> {
  // Per-IP plus a whole-site ceiling, charged atomically. A form submission costs a row, a
  // possible automation enrolment and (through that) possible outbound sends - cheaper than a
  // booking, hence the looser numbers, but still not free.
  //
  // Keyed on the SLUG as well as the IP: the per-form bucket means someone hammering one funnel
  // can't lock every other form on the site, which a single shared `form:<ip>` key did.
  const ip = clientIpFrom(await Promise.resolve(headers()));
  const gate = takeTokens([
    { key: `form:ip:${slug}:${ip}`, rule: RATE_RULES.formPerIp },
    { key: "form:global", rule: RATE_RULES.formGlobal },
  ]);
  if (!gate.ok) {
    return { ok: false, error: "Too many submissions. Please try again in a few minutes." };
  }
  // Honeypot - bots fill hidden fields; humans never see them.
  if (String(form.get("company_website") ?? "").trim()) {
    return { ok: true, message: "Thanks!" };
  }

  const dbForm = await prisma.form.findUnique({ where: { slug } });
  if (!dbForm || !dbForm.published) return { ok: false, error: "This form is not available." };
  const fields = normaliseItems(dbForm.fields);
  const settings = normaliseSettings(dbForm.settings);

  const jar = await cookies();
  const seenCookie = `b2f_${dbForm.id}`;
  if (settings.limitOneResponse && jar.get(seenCookie)) {
    return { ok: false, error: "You've already sent this form in." };
  }

  /**
   * The "Bot Protection" element's second half.
   *
   * The honeypot above catches anything that fills every input it finds; this catches the ones
   * that don't, by timing. A form that comes back in under a second and a half was not read. The
   * stamp is client-supplied and therefore forgeable - which is fine, because this sits behind a
   * per-IP rate limit and in front of nothing valuable: the cost of a false negative is one junk
   * lead, and the cost of a false POSITIVE is a real person being told their enquiry failed. So
   * it silently accepts-and-drops rather than erroring, exactly like the honeypot.
   *
   * Only enforced when the author put the element on the form. Applying it everywhere would
   * change the behaviour of live forms nobody asked to change.
   */
  if (fields.some((f) => f.type === "captcha")) {
    const startedAt = Number(form.get("form_started_at"));
    if (Number.isFinite(startedAt) && startedAt > 0 && Date.now() - startedAt < 1500) {
      return { ok: true, message: settings.successMessage };
    }
  }

  const answers = collectAnswers(fields, form);

  /**
   * Enforce `required` against the questions this respondent was actually SHOWN.
   *
   * With branching, some sections are skipped by design. Validating every declared question would
   * make a form with a branch permanently unsubmittable for whoever took the short path - and only
   * for them, so it presents as "some people can't submit", which is about the hardest bug shape
   * there is to reproduce from a support message.
   */
  const asked = reachableItems(fields, answers);
  for (const item of asked) {
    const err = validateAnswer(item, answers[item.key]);
    if (err) return { ok: false, error: err };
  }

  // Keep only what was asked. A respondent who answers, goes Back, and takes the other branch
  // would otherwise leave the abandoned page's answers in the record as though they had stood.
  const data: FormAnswers = {};
  for (const item of asked) {
    const v = answers[item.key];
    if (Array.isArray(v) ? v.length > 0 : (v ?? "").trim() !== "") data[item.key] = v;
  }

  // UTM passthrough
  const utm: Record<string, string> = {};
  for (const k of ["utm_source", "utm_medium", "utm_campaign", "utm_term", "utm_content"]) {
    const v = String(form.get(k) ?? "").trim();
    if (v) utm[k] = v.slice(0, 200);
  }

  // The contact record wants scalars. A multi-answer that lands on a contact field (someone can
  // name a checkboxes question `city`) is flattened rather than dropped.
  /**
   * The score, stamped in as an ordinary answer.
   *
   * Computed here from the items and the answers, never read off the post - see `computeScore`.
   * It lands in `data` before the custom-fields blob is built, so it reaches the contact record
   * with no special handling anywhere downstream.
   */
  const score = computeScore(asked, data);
  if (score !== null) {
    const scoreKey = asked.find((i) => i.type === "score")?.key || "score";
    data[scoreKey] = String(score);
  }

  const text = (k: string) => answerToText(data[k]).trim();
  /**
   * The contact's name.
   *
   * The palette offers "Full Name" AND a First/Last pair, because Synamate's does and the live
   * opt-in uses the split. A lead needs one name, and `upsertIntakeLead` refuses without it - so
   * a form built the split way would capture nothing at all into the pipeline while looking like
   * it worked. Full name wins when present; otherwise the two halves are joined.
   */
  const name = text("name") || [text("firstName"), text("lastName")].filter(Boolean).join(" ").trim();
  const phone = text("phone");

  let leadId: string | null = null;
  if (name && phone) {
    const { lead } = await upsertIntakeLead({
      name,
      phone,
      email: text("email") || null,
      city: text("city") || null,
      industry: text("industry") || null,
      leadSource: toLeadSource(settings.leadSource),
      source: "NATIVE_FORM",
      externalRef: null,
      utm: Object.keys(utm).length ? utm : null,
      originDomain: await observedOriginDomain(),
    });
    leadId = lead.id;

    // Custom answers (non-contact keys) → the contact's customFields blob.
    const extra: Record<string, string> = {};
    for (const [k, v] of Object.entries(data)) {
      if (!(CONTACT_FIELD_KEYS as readonly string[]).includes(k)) extra[k] = answerToText(v);
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
      /**
       * `deletedAt: null` on the stage AND its pipeline - the guard this lookup used to be missing.
       *
       * A form's `stageId` is frozen at configuration time, but a column can be soft-deleted long
       * afterwards, and `deleteStage` only refuses when the column ALREADY holds cards - nothing
       * stopped new ones being written into a deleted one. The board renders live columns only
       * (opportunities-metrics), so such a card is created, counted in every total, and invisible
       * on the board. Seen in production on 06/08/2026: the "Free Consultation" form still pointed
       * at a "New Lead" column deleted the day before, so its captures silently went nowhere.
       */
      const stage = await prisma.pipelineStage.findFirst({
        where: {
          id: settings.stageId,
          pipelineId: settings.pipelineId,
          deletedAt: null,
          pipeline: { deletedAt: null },
        },
        select: { pipelineId: true },
      });
      if (!stage) {
        // The configured column is gone. File the lead onto the default board instead of dropping
        // it - a card in the wrong column is recoverable, a capture nobody can see is not. Costs
        // the form's own name/value settings, which is the right trade against losing the lead.
        await ensureDefaultOpportunity(prisma, leadId);
      } else {
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
        data: data as unknown as Prisma.InputJsonObject,
        utm: Object.keys(utm).length ? (utm as Prisma.InputJsonObject) : undefined,
      },
    }),
    prisma.form.update({ where: { id: dbForm.id }, data: { submissionCount: { increment: 1 } } }),
  ]);

  // Set only AFTER the write succeeds: marking the browser as "done" and then failing to record
  // the response would lock someone out of a form they never actually submitted.
  if (settings.limitOneResponse) {
    jar.set(seenCookie, "1", {
      maxAge: 60 * 60 * 24 * 30,
      httpOnly: true,
      sameSite: "lax",
      path: "/",
    });
  }

  if (leadId) await emitTrigger("FORM_SUBMITTED", { leadId, formId: dbForm.id });

  revalidatePath("/contacts");
  revalidatePath(`/forms/${dbForm.id}`);
  return { ok: true, message: settings.successMessage || "Thanks!", redirectUrl: settings.redirectUrl?.trim() || undefined };
}
