import "server-only";
import { cache } from "react";
import { prisma } from "@/lib/prisma";
import { coerceResumeData, type ResumeData } from "@/lib/resume-types";
import { coerceResumeTemplate, type ResumeTemplateConfig } from "@/lib/resume-template";
import { coerceReviewResult, type AiReviewResult } from "@/lib/resume-review-types";
import { readAiSettings, getAiRuntime, type AiSettings } from "@/lib/anthropic";

/**
 * Reads for the Resume Studio. Money-safe by construction (a resume carries no
 * currency), so unlike the finance metrics these can return real objects; only dates
 * are pre-formatted to a stable string so the client never re-formats and desyncs.
 */

const TEMPLATE_KEY = "resumeTemplateConfig";

export const getResumeTemplate = cache(async (): Promise<ResumeTemplateConfig> => {
  const row = await prisma.appSetting.findUnique({ where: { key: TEMPLATE_KEY } });
  return coerceResumeTemplate(row?.value);
});

function fmtDate(d: Date): string {
  return d.toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" });
}

export type ResumeListItem = {
  id: string;
  title: string;
  language: string;
  ownerName: string | null;
  updatedAt: string;
  reviewCount: number;
  latestScore: number | null;
};

export async function listResumes(): Promise<ResumeListItem[]> {
  const rows = await prisma.resume.findMany({
    orderBy: { updatedAt: "desc" },
    include: {
      _count: { select: { reviews: true } },
      reviews: { orderBy: { createdAt: "desc" }, take: 1, select: { scoreOverall: true } },
    },
  });
  return rows.map((r) => ({
    id: r.id,
    title: r.title,
    language: r.language,
    ownerName: r.ownerName,
    updatedAt: fmtDate(r.updatedAt),
    reviewCount: r._count.reviews,
    latestScore: r.reviews[0]?.scoreOverall ?? null,
  }));
}

export type ResumeReviewView = {
  id: string;
  jdText: string;
  provider: string;
  model: string | null;
  scoreOverall: number;
  result: AiReviewResult;
  createdAt: string;
};

export type ResumeDetail = {
  id: string;
  title: string;
  language: string;
  ownerName: string | null;
  data: ResumeData;
  updatedAt: string;
  reviews: ResumeReviewView[];
};

export async function getResume(id: string): Promise<ResumeDetail | null> {
  const row = await prisma.resume.findUnique({
    where: { id },
    include: { reviews: { orderBy: { createdAt: "desc" } } },
  });
  if (!row) return null;
  return {
    id: row.id,
    title: row.title,
    language: row.language,
    ownerName: row.ownerName,
    data: coerceResumeData(row.data),
    updatedAt: fmtDate(row.updatedAt),
    reviews: row.reviews.map((rv) => ({
      id: rv.id,
      jdText: rv.jdText,
      provider: rv.provider,
      model: rv.model,
      scoreOverall: rv.scoreOverall,
      result: coerceReviewResult(rv.result),
      createdAt: fmtDate(rv.createdAt),
    })),
  };
}

/** Raw resume record for the DOCX/PDF renderers (no date formatting needed). */
export async function getResumeForRender(
  id: string,
): Promise<{ title: string; language: string; data: ResumeData } | null> {
  const row = await prisma.resume.findUnique({
    where: { id },
    select: { title: true, language: true, data: true },
  });
  if (!row) return null;
  return { title: row.title, language: row.language, data: coerceResumeData(row.data) };
}

/** Settings panel view: the non-secret AI config + whether the key/flag are live. Never leaks the key. */
export type AiStatus = {
  settings: AiSettings;
  configured: boolean; // ANTHROPIC_API_KEY present
  envEnabled: boolean; // AI_REVIEW_ENABLED === "true"
  enabled: boolean; // fully armed (key + flag + not paused)
};

export async function getAiStatus(): Promise<AiStatus> {
  const [settings, runtime] = await Promise.all([readAiSettings(), getAiRuntime()]);
  return {
    settings,
    configured: runtime.configured,
    envEnabled: runtime.envEnabled,
    enabled: runtime.enabled,
  };
}
