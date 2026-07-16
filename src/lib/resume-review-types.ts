/**
 * The shape of an ATS review result — produced by the Claude reviewer OR the offline
 * deterministic analyser, stored on ResumeReview.result, and rendered by the UI. Kept
 * isomorphic and defensively coerced because it arrives from three directions: a model
 * (untrusted JSON), the analyser (trusted), and the DB (a past row of either).
 */

export type ReviewSeverity = "high" | "medium" | "low";

export type ReviewFinding = { severity: ReviewSeverity; title: string; detail: string };

export type RewriteSuggestion = { section: string; before: string; after: string };

export type AiReviewResult = {
  atsScore: number; // 0-100 overall ATS match for THIS jd
  keywordScore: number; // 0-100
  conformanceScore: number; // 0-100 vs the B2 template
  formattingScore: number; // 0-100 ATS-friendliness
  verdict: string; // one-line hire-readiness call
  summary: string; // 2-4 sentence overview
  matchedKeywords: string[];
  missingKeywords: string[];
  findings: ReviewFinding[]; // prioritised, risk-first
  rewriteSuggestions: RewriteSuggestion[]; // concrete before → after coaching
};

const clamp = (v: unknown): number => {
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? Math.max(0, Math.min(100, Math.round(n))) : 0;
};
const str = (v: unknown): string => (typeof v === "string" ? v : "");
const strList = (v: unknown): string[] =>
  Array.isArray(v) ? v.map(str).filter((s) => s.trim().length > 0).slice(0, 40) : [];

const SEVERITIES: ReviewSeverity[] = ["high", "medium", "low"];

export function coerceReviewResult(raw: unknown): AiReviewResult {
  const r = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const findings = (Array.isArray(r.findings) ? r.findings : [])
    .map((f): ReviewFinding => {
      const o = (f && typeof f === "object" ? f : {}) as Record<string, unknown>;
      const sev = str(o.severity).toLowerCase();
      return {
        severity: (SEVERITIES.includes(sev as ReviewSeverity) ? sev : "medium") as ReviewSeverity,
        title: str(o.title),
        detail: str(o.detail),
      };
    })
    .filter((f) => f.title || f.detail)
    .slice(0, 30);

  const rewrites = (Array.isArray(r.rewriteSuggestions) ? r.rewriteSuggestions : [])
    .map((x): RewriteSuggestion => {
      const o = (x && typeof x === "object" ? x : {}) as Record<string, unknown>;
      return { section: str(o.section), before: str(o.before), after: str(o.after) };
    })
    .filter((x) => x.after)
    .slice(0, 30);

  return {
    atsScore: clamp(r.atsScore),
    keywordScore: clamp(r.keywordScore),
    conformanceScore: clamp(r.conformanceScore),
    formattingScore: clamp(r.formattingScore),
    verdict: str(r.verdict),
    summary: str(r.summary),
    matchedKeywords: strList(r.matchedKeywords),
    missingKeywords: strList(r.missingKeywords),
    findings,
    rewriteSuggestions: rewrites,
  };
}

/** Rank findings risk-first for display. */
export function sortFindings(findings: ReviewFinding[]): ReviewFinding[] {
  const rank: Record<ReviewSeverity, number> = { high: 0, medium: 1, low: 2 };
  return [...findings].sort((a, b) => rank[a.severity] - rank[b.severity]);
}
