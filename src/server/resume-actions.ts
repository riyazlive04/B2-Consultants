"use server";

import { revalidatePath } from "next/cache";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { requireSection, requireAdmin } from "@/lib/rbac";
import { coerceResumeData, emptyResumeData, resumeToPlainText, type ResumeData } from "@/lib/resume-types";
import {
  coerceResumeTemplate,
  DEFAULT_RESUME_TEMPLATE,
  orderedEnabledSections,
  enabledAtsRules,
  atsVerdict,
  type ResumeTemplateConfig,
} from "@/lib/resume-template";
import { coerceReviewResult, type AiReviewResult } from "@/lib/resume-review-types";
import { getAiRuntime, callClaude, extractJson, readAiSettings, writeAiSettings, type AiSettings } from "@/lib/anthropic";
import { getResumeTemplate, getResume, type ResumeDetail } from "@/server/resume-metrics";
import { analyseCv } from "@/lib/cv-analysis";
import { logActivity, diffFields } from "./activity-log";
import type { ActionResult } from "./finance-actions";

const TEMPLATE_KEY = "resumeTemplateConfig";
const asJson = (v: unknown) => v as unknown as Prisma.InputJsonValue;

// ───────────────────────────── resume CRUD ─────────────────────────────

export async function createResume(input: {
  title: string;
  language: string;
  data?: ResumeData;
}): Promise<ActionResult & { id?: string }> {
  const session = await requireSection("cv-check");
  const title = input.title.trim();
  if (!title) return { ok: false, error: "Give the CV a title." };
  const language = input.language === "DE" ? "DE" : "EN";
  const data = coerceResumeData(input.data ?? emptyResumeData());

  const row = await prisma.resume.create({
    data: {
      title,
      language,
      data: asJson(data),
      ownerUserId: session.user.id,
      ownerName: session.user.name ?? null,
    },
    select: { id: true },
  });
  await logActivity(session, {
    action: "resume.create",
    section: "cv-check",
    entityType: "Resume",
    entityId: row.id,
    summary: `Created the CV "${title}"`,
    meta: { language },
  });
  revalidatePath("/cv-check");
  return { ok: true, id: row.id };
}

export async function updateResume(input: {
  id: string;
  title: string;
  language: string;
  data: ResumeData;
}): Promise<ActionResult> {
  const session = await requireSection("cv-check");
  const title = input.title.trim();
  if (!title) return { ok: false, error: "Give the CV a title." };
  const exists = await prisma.resume.findUnique({ where: { id: input.id }, select: { id: true, title: true, language: true, data: true } });
  if (!exists) return { ok: false, error: "That CV no longer exists." };

  const language = input.language === "DE" ? "DE" : "EN";
  const data = coerceResumeData(input.data);
  await prisma.resume.update({
    where: { id: input.id },
    data: { title, language, data: asJson(data) },
  });
  // The editor autosaves the whole CV; `data` is compared but never logged — the founder's feed
  // is not the place for a candidate's employment history.
  const d = diffFields({ title: exists.title, language: exists.language }, { title, language });
  const changed = [
    ...d.changed,
    ...(JSON.stringify(exists.data ?? null) !== JSON.stringify(data) ? ["data"] : []),
  ];
  if (changed.length) {
    await logActivity(session, {
      action: "resume.update",
      section: "cv-check",
      entityType: "Resume",
      entityId: input.id,
      summary: `Edited the CV "${title}"`,
      meta: { changed, before: d.before, after: d.after },
    });
  }
  revalidatePath("/cv-check");
  return { ok: true };
}

export async function deleteResume(id: string): Promise<ActionResult> {
  const session = await requireSection("cv-check");
  const row = await prisma.resume.delete({ where: { id } }).catch(() => null);
  if (row) {
    await logActivity(session, {
      action: "resume.delete",
      section: "cv-check",
      entityType: "Resume",
      entityId: id,
      summary: `Deleted the CV "${row.title}"`,
      meta: { language: row.language },
    });
  }
  revalidatePath("/cv-check");
  return { ok: true };
}

/** Full resume detail for the client editor/review panels (server-only reads can't be called from a client). */
export async function loadResume(id: string): Promise<ResumeDetail | null> {
  await requireSection("cv-check");
  return getResume(id);
}

export async function duplicateResume(id: string): Promise<ActionResult & { id?: string }> {
  const session = await requireSection("cv-check");
  const src = await prisma.resume.findUnique({ where: { id } });
  if (!src) return { ok: false, error: "That CV no longer exists." };
  const row = await prisma.resume.create({
    data: {
      title: `${src.title} (copy)`,
      language: src.language,
      data: asJson(coerceResumeData(src.data)),
      ownerUserId: session.user.id,
      ownerName: session.user.name ?? null,
    },
    select: { id: true },
  });
  await logActivity(session, {
    action: "resume.duplicate",
    section: "cv-check",
    entityType: "Resume",
    entityId: row.id,
    summary: `Duplicated the CV "${src.title}"`,
    meta: { sourceId: id },
  });
  revalidatePath("/cv-check");
  return { ok: true, id: row.id };
}

// ───────────────────── founder template + AI settings ─────────────────────

export async function saveResumeTemplate(config: ResumeTemplateConfig): Promise<ActionResult> {
  const session = await requireAdmin();
  const clean = coerceResumeTemplate(config);
  const value = asJson(clean);
  const before = await getResumeTemplate();
  await prisma.appSetting.upsert({
    where: { key: TEMPLATE_KEY },
    create: { key: TEMPLATE_KEY, value },
    update: { value },
  });
  // Section lists, ATS rules and keyword libraries are all nested config — the changed key names
  // are the useful signal; the rulebook itself belongs on the settings screen, not in the feed.
  const d = diffFields(
    before as unknown as Record<string, unknown>,
    clean as unknown as Record<string, unknown>,
  );
  if (d.changed.length) {
    await logActivity(session, {
      action: "resume.template.update",
      section: "cv-check",
      entityType: "AppSetting",
      entityId: TEMPLATE_KEY,
      summary: `Updated the CV template (${d.changed.join(", ")})`,
      meta: { changed: d.changed },
    });
  }
  revalidatePath("/cv-check");
  return { ok: true };
}

export async function resetResumeTemplate(): Promise<ActionResult> {
  const session = await requireAdmin();
  await prisma.appSetting.upsert({
    where: { key: TEMPLATE_KEY },
    create: { key: TEMPLATE_KEY, value: asJson(DEFAULT_RESUME_TEMPLATE) },
    update: { value: asJson(DEFAULT_RESUME_TEMPLATE) },
  });
  await logActivity(session, {
    action: "resume.template.restore",
    section: "cv-check",
    entityType: "AppSetting",
    entityId: TEMPLATE_KEY,
    summary: "Reset the CV template back to the B2 defaults",
  });
  revalidatePath("/cv-check");
  return { ok: true };
}

export async function saveAiSettings(settings: AiSettings): Promise<ActionResult> {
  const session = await requireAdmin();
  const before = await readAiSettings();
  await writeAiSettings(settings);
  // Read back rather than diffing the input: writeAiSettings coerces (maxTokens is clamped), so
  // the raw input would report changes the stored row never took.
  const after = await readAiSettings();
  const d = diffFields(before as unknown as Record<string, unknown>, after as unknown as Record<string, unknown>);
  if (d.changed.length) {
    await logActivity(session, {
      action: "resume.ai-settings.update",
      section: "cv-check",
      entityType: "AppSetting",
      entityId: "aiConfig",
      summary: `Updated the CV review AI settings — ${after.paused ? "paused" : "live"}, model ${after.model}`,
      meta: { changed: d.changed, before: d.before, after: d.after },
    });
  }
  revalidatePath("/cv-check");
  return { ok: true };
}

// ───────────────────────────── AI / ATS review ─────────────────────────────

export type RunReviewResult = ActionResult & {
  reviewId?: string;
  result?: AiReviewResult;
  provider?: "ai" | "deterministic";
  note?: string; // e.g. why it fell back to the offline analyser
};

/**
 * Review a saved resume against a target JD. Uses Claude when the seam is armed
 * (key + AI_REVIEW_ENABLED + not paused); otherwise — or if the call fails — it falls
 * back to the deterministic analyser so the coach always gets a scored result. Every
 * run is stored as a ResumeReview so it can be re-run "unlimited" times and compared.
 */
export async function runReview(input: { resumeId: string; jdText: string }): Promise<RunReviewResult> {
  const session = await requireSection("cv-check");
  const jd = input.jdText.trim();
  if (jd.length < 40) return { ok: false, error: "Paste the full job description (at least a few lines)." };

  const row = await prisma.resume.findUnique({
    where: { id: input.resumeId },
    select: { title: true, language: true, data: true },
  });
  if (!row) return { ok: false, error: "That CV no longer exists." };

  const data = coerceResumeData(row.data);
  const cvText = resumeToPlainText(data);
  const template = await getResumeTemplate();
  const runtime = await getAiRuntime();

  let result: AiReviewResult | null = null;
  let provider: "ai" | "deterministic" = "deterministic";
  let model: string | null = null;
  let note: string | undefined;

  if (runtime.enabled && runtime.apiKey) {
    const { system, user } = buildReviewPrompt(cvText, jd, template);
    const res = await callClaude({
      apiKey: runtime.apiKey,
      model: runtime.model,
      maxTokens: runtime.maxTokens,
      system,
      user,
    });
    if (res.ok) {
      const parsed = extractJson<unknown>(res.text);
      if (parsed) {
        result = coerceReviewResult(parsed);
        provider = "ai";
        model = runtime.model;
      } else {
        note = "Claude replied but the response wasn't valid JSON — showing the offline analysis instead.";
      }
    } else {
      note = `AI review unavailable (${res.error}) — showing the offline analysis instead.`;
    }
  } else if (!runtime.configured) {
    note = "AI review isn't configured — showing the offline deterministic analysis. Add an Anthropic key in Settings to enable Claude.";
  } else if (runtime.paused) {
    note = "AI review is paused — showing the offline deterministic analysis.";
  } else if (!runtime.envEnabled) {
    note = "AI review flag is off — showing the offline deterministic analysis.";
  }

  if (!result) result = deterministicReview(cvText, jd, template);

  const saved = await prisma.resumeReview.create({
    data: {
      resumeId: input.resumeId,
      jdText: jd,
      provider,
      model,
      scoreOverall: result.atsScore,
      result: asJson(result),
    },
    select: { id: true },
  });
  // touch the resume so its list row sorts to the top and shows the fresh score
  await prisma.resume.update({ where: { id: input.resumeId }, data: { updatedAt: new Date() } }).catch(() => null);
  await logActivity(session, {
    action: "resume.review.generate",
    section: "cv-check",
    entityType: "ResumeReview",
    entityId: saved.id,
    summary: `Ran an ATS review of the CV "${row.title}" — scored ${result.atsScore}/100 (${provider === "ai" ? "Claude" : "offline analyser"})`,
    meta: { resumeId: input.resumeId, provider, model, scoreOverall: result.atsScore },
  });
  revalidatePath("/cv-check");
  return { ok: true, reviewId: saved.id, result, provider, note };
}

export async function deleteReview(id: string): Promise<ActionResult> {
  const session = await requireSection("cv-check");
  const row = await prisma.resumeReview.delete({ where: { id } }).catch(() => null);
  if (row) {
    const resume = await prisma.resume.findUnique({ where: { id: row.resumeId }, select: { title: true } });
    await logActivity(session, {
      action: "resume.review.delete",
      section: "cv-check",
      entityType: "ResumeReview",
      entityId: id,
      summary: `Deleted an ATS review of the CV "${resume?.title ?? ""}"`,
      meta: { resumeId: row.resumeId, provider: row.provider, scoreOverall: row.scoreOverall },
    });
  }
  revalidatePath("/cv-check");
  return { ok: true };
}

// ───────────────────── import an existing CV into the builder ─────────────────────

export type ImportResult = ActionResult & { data?: ResumeData; note?: string };

/**
 * Turn extracted CV text (from /api/cv-extract) into structured ResumeData. Uses Claude
 * to parse when armed; otherwise drops the raw text into the summary so the coach can
 * cut-and-paste into fields rather than losing it. Never fabricates content.
 */
export async function importResumeFromText(text: string): Promise<ImportResult> {
  await requireSection("cv-check");
  const clean = text.trim();
  if (clean.length < 30) return { ok: false, error: "That doesn't look like a CV — too little text." };

  const runtime = await getAiRuntime();
  if (runtime.enabled && runtime.apiKey) {
    const res = await callClaude({
      apiKey: runtime.apiKey,
      model: runtime.model,
      maxTokens: runtime.maxTokens,
      system: IMPORT_SYSTEM,
      user: `Parse this CV into the JSON shape. Do not invent anything — leave a field empty if it is not in the text.\n\n---CV---\n${clean.slice(0, 24000)}`,
    });
    if (res.ok) {
      const parsed = extractJson<unknown>(res.text);
      if (parsed) return { ok: true, data: coerceResumeData(parsed) };
      return { ok: true, data: fallbackImport(clean), note: "Couldn't structure it automatically — dropped the text into Profile for you to sort into fields." };
    }
    return { ok: true, data: fallbackImport(clean), note: `AI parse failed (${res.error}) — dropped the text into Profile.` };
  }
  return { ok: true, data: fallbackImport(clean), note: "AI import is off — dropped the text into Profile. Turn on the AI seam in Settings for automatic field-by-field parsing." };
}

function fallbackImport(text: string): ResumeData {
  const d = emptyResumeData();
  d.summary = text.slice(0, 6000);
  return d;
}

// ───────────────────────────── prompts + deterministic fallback ─────────────────────────────

const IMPORT_SYSTEM = `You are a precise CV parser. Output ONLY a JSON object matching this TypeScript type (no prose, no markdown fence):
{
  "header": { "fullName": string, "headline": string, "email": string, "phone": string, "location": string, "dob": string, "nationality": string, "relocation": string, "linkedin": string, "website": string },
  "highlights": string[],
  "summary": string,
  "experience": [{ "company": string, "city": string, "country": string, "position": string, "start": string, "end": string, "current": boolean, "bullets": string[] }],
  "education": [{ "institution": string, "city": string, "country": string, "program": string, "start": string, "end": string, "note": string }],
  "certifications": [{ "name": string, "issuer": string, "date": string }],
  "languages": [{ "name": string, "level": string }],
  "computerSkills": [{ "name": string, "level": "Very good" | "Good" | "Basic" }],
  "personalSkills": string[],
  "hobbies": string[]
}
Never fabricate — an absent field is "" or []. Dates as written in the CV.`;

function buildReviewPrompt(cvText: string, jd: string, template: ResumeTemplateConfig) {
  const w = template.ats;
  const house = w.customInstructions.trim();
  const rules = enabledAtsRules(template);
  const rulesBlock = rules.length
    ? `\nENFORCE these ATS rules (weight 1-5, severity). Deduct for each failure and cite it as a finding at the stated severity:\n${rules
        .map((r) => `- [${r.severity}, w${r.weight}] ${r.label}: ${r.instruction}`)
        .join("\n")}\n`
    : "";
  const kwBlock = w.targetKeywords.length
    ? `\nALWAYS check for these skills/keywords (on top of JD terms); list any the CV lacks in missingKeywords: ${w.targetKeywords.join(", ")}.\n`
    : "";
  const system = `You are a senior technical recruiter and ATS specialist reviewing a candidate CV for a specific German-market job. Be exacting and honest — a weak CV should score low. You COACH: you name what is wrong and show a concrete rewrite, but you never claim skills the candidate doesn't have.

Score three axes 0-100, then combine into atsScore using these weights: keyword coverage ${w.weightKeywords}%, B2-template conformance ${w.weightConformance}%, ATS formatting ${w.weightFormatting}%.
- keywordScore: how well the CV mirrors the JD's required skills/tools/terms (that are genuinely true of the candidate).
- conformanceScore: presence of the B2 CV spine — contact header, "what I have to offer" highlights, dated reverse-chronological experience, education, certifications, languages with levels, computer & personal skills; German signals (DOB, relocation/Reisebereitschaft, language level).
- formattingScore: parseable structure, quantified achievement bullets (verb + metric), consistent dates, ~1-2 pages, no leftover template placeholders.
${rulesBlock}${kwBlock}Verdict banding on atsScore: ≥ ${w.bands.strong} = strong match; ≥ ${w.bands.partial} = partial match; otherwise weak.
${house ? `\nAdditional house rules from the agency (enforce these):\n${house}\n` : ""}
Reply with ONLY this JSON (no markdown, no commentary):
{"atsScore":0-100,"keywordScore":0-100,"conformanceScore":0-100,"formattingScore":0-100,"verdict":"one line","summary":"2-4 sentences","matchedKeywords":[".."],"missingKeywords":[".."],"findings":[{"severity":"high|medium|low","title":"..","detail":".."}],"rewriteSuggestions":[{"section":"e.g. Experience → Acme","before":"weak bullet","after":"verb + what + measurable result"}]}`;
  const user = `TARGET JOB DESCRIPTION:\n${jd.slice(0, 16000)}\n\n---\n\nCANDIDATE CV:\n${cvText.slice(0, 16000)}`;
  return { system, user };
}

/**
 * Offline scoring — reuses the deterministic CV↔JD analyser and reshapes it into the
 * same AiReviewResult contract, weighted by the founder's rubric. This is what runs
 * when the Claude seam is off, so the feature is fully usable with no API key.
 */
function deterministicReview(cvText: string, jd: string, template: ResumeTemplateConfig): AiReviewResult {
  const a = analyseCv(cvText, jd);
  const enabled = orderedEnabledSections(template);
  const sectionHits = a.sectionChecks.filter((c) => c.ok).length;
  const formattingScore =
    a.sectionChecks.length > 0 ? Math.round((sectionHits / a.sectionChecks.length) * 100) : 0;

  const w = template.ats;
  const wsum = Math.max(1, w.weightKeywords + w.weightConformance + w.weightFormatting);
  const atsScore = Math.round(
    (a.matchScore * w.weightKeywords + a.conformance * w.weightConformance + formattingScore * w.weightFormatting) /
      wsum,
  );

  const findings = a.suggestions.map((s) => ({
    severity: (s.level === "risk" ? "high" : s.level === "watch" ? "medium" : "low") as
      | "high"
      | "medium"
      | "low",
    title: s.title,
    detail: s.detail,
  }));
  if (a.placeholders.length > 0) {
    findings.unshift({
      severity: "high",
      title: `${a.placeholders.length} un-edited template placeholder(s)`,
      detail: `Replace before sending: ${a.placeholders.map((p) => `"${p.sample}"`).join(", ")}.`,
    });
  }

  // Founder's always-check keyword library: flag any absent from the CV.
  const lowerCv = cvText.toLowerCase();
  const missingTargets = w.targetKeywords.filter((k) => k && !lowerCv.includes(k.toLowerCase()));
  if (missingTargets.length > 0) {
    findings.unshift({
      severity: "high",
      title: `${missingTargets.length} founder target keyword(s) missing`,
      detail: `The ATS keyword library expects these where genuinely true: ${missingTargets.join(", ")}.`,
    });
  }
  const missingKeywords = [...missingTargets, ...a.missing.filter((k) => !missingTargets.includes(k))].slice(0, 30);

  const band = atsVerdict(atsScore, w.bands);
  const verdict =
    band === "strong"
      ? "Strong match — polish and send."
      : band === "partial"
        ? "Partial match — close the gaps below first."
        : "Weak match — needs real work before applying.";

  return {
    atsScore,
    keywordScore: a.matchScore,
    conformanceScore: a.conformance,
    formattingScore,
    verdict,
    summary: `Offline analysis: ${a.matchScore}% JD keyword coverage, ${a.conformance}% B2-template conformance across ${enabled.length} configured sections. ${missingKeywords.length} keywords missing and ${a.weakBullets.length} bullets are weak, scored against ${enabledAtsRules(template).length} active ATS rules. Turn on the Claude seam in Settings for a deeper, rewrite-level review that enforces every rule.`,
    matchedKeywords: a.matched,
    missingKeywords,
    findings,
    rewriteSuggestions: a.weakBullets.map((b) => ({
      section: "Experience",
      before: b,
      after: "Recast as: verb + what you did + measurable result (%, €, time, volume).",
    })),
  };
}
