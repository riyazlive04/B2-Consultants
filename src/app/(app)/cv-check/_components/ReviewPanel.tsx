"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Sparkles, Target, LayoutTemplate, FileCheck2, AlertTriangle, Trash2, Wand2, Info } from "lucide-react";
import { Card, Pill } from "@/components/ui/kit";
import { MetricCard } from "@/components/ui/MetricCard";
import { SignalBadge } from "@/components/ui/SignalBadge";
import { Btn } from "@/components/ui/controls";
import { TextArea } from "@/components/ui/form";
import { signalForPercent } from "@/lib/signals";
import { formatPct } from "@/lib/format";
import { sortFindings, type AiReviewResult, type ReviewSeverity } from "@/lib/resume-review-types";
import { enabledAtsRules, type ResumeTemplateConfig } from "@/lib/resume-template";
import type { ResumeDetail, AiStatus } from "@/server/resume-metrics";
import { runReview, deleteReview } from "@/server/resume-actions";

/**
 * The JD-driven ATS review. Paste the target job description, run it against the
 * selected CV, and get a scored, coached result — from Claude when the seam is armed,
 * otherwise from the offline analyser. Every run is kept so the coach can re-run it
 * "unlimited" times as the CV improves and watch the score climb.
 */

const SEV_TONE: Record<ReviewSeverity, "bad" | "warn" | "neutral"> = { high: "bad", medium: "warn", low: "neutral" };
const SEV_LABEL: Record<ReviewSeverity, string> = { high: "Fix now", medium: "Improve", low: "Polish" };

export function ReviewPanel({
  resume,
  aiStatus,
  template,
}: {
  resume: ResumeDetail | null;
  aiStatus: AiStatus;
  template: ResumeTemplateConfig;
}) {
  const activeRules = enabledAtsRules(template).length;
  const targetKw = template.ats.targetKeywords.length;
  const router = useRouter();
  const [jd, setJd] = useState("");
  const [pending, start] = useTransition();
  const [live, setLive] = useState<AiReviewResult | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  if (!resume) {
    return (
      <Card>
        <p className="text-sm text-muted">
          Pick or create a CV in the <span className="font-semibold text-ink">Builder</span> tab first — the AI review
          scores a saved CV against a job description.
        </p>
      </Card>
    );
  }

  const run = () => {
    setError(null);
    setNote(null);
    start(async () => {
      const res = await runReview({ resumeId: resume.id, jdText: jd });
      if (!res.ok) {
        setError(res.error);
        return;
      }
      setLive(res.result ?? null);
      setNote(res.note ?? null);
      router.refresh(); // refresh the stored history below
    });
  };

  const result = live ?? resume.reviews[0]?.result ?? null;

  return (
    <div className="space-y-5">
      {/* status strip */}
      <div className={`flex items-start gap-2 rounded-card border p-3 text-sm ${aiStatus.enabled ? "border-primary-tint bg-primary-soft text-primary-strong" : "border-line bg-surface-2 text-ink-2"}`}>
        {aiStatus.enabled ? <Sparkles size={16} className="mt-0.5 flex-none" /> : <Info size={16} className="mt-0.5 flex-none" />}
        <p>
          {aiStatus.enabled ? (
            <>Claude review is <strong>live</strong> ({aiStatus.settings.model}), enforcing <strong>{activeRules}</strong> ATS rule{activeRules === 1 ? "" : "s"}{targetKw > 0 ? <> + <strong>{targetKw}</strong> target keyword{targetKw === 1 ? "" : "s"}</> : null} the founder configured.</>
          ) : (
            <>Claude review is <strong>off</strong> — you’ll get the offline analysis (still scored against <strong>{activeRules}</strong> ATS rule{activeRules === 1 ? "" : "s"}). An admin can enable Claude in the <strong>Template &amp; AI</strong> tab (add an Anthropic key + flip the flag).</>
          )}
        </p>
      </div>

      <Card
        title={<span className="flex items-center gap-2 font-display text-h3 text-ink"><Target size={18} className="text-primary" /> Review “{resume.title}” against a JD</span>}
        subtitle="Paste the full target job description — the more complete, the sharper the match."
      >
        <TextArea rows={7} value={jd} onChange={(e) => setJd(e.target.value)} placeholder="Paste the German job description here…" />
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <Btn variant="primary" icon={<Wand2 size={15} />} busy={pending} disabled={jd.trim().length < 40} onClick={run}>
            {aiStatus.enabled ? "Run Claude review" : "Run offline review"}
          </Btn>
          {resume.reviews.length > 0 && <span className="text-caption text-muted">{resume.reviews.length} past review{resume.reviews.length > 1 ? "s" : ""}</span>}
        </div>
        {error && <p role="alert" className="mt-3 rounded-field bg-risk-soft px-3 py-2 text-sm font-medium text-risk">{error}</p>}
        {note && <p className="mt-3 flex items-start gap-2 rounded-field bg-warn-soft px-3 py-2 text-sm text-warn"><Info size={15} className="mt-0.5 flex-none" />{note}</p>}
      </Card>

      {result && <ReviewResult result={result} />}

      {resume.reviews.length > 0 && (
        <Card title="Review history" subtitle="Every run is saved so you can watch the ATS score climb as the CV improves.">
          <ul className="space-y-2">
            {resume.reviews.map((rv) => (
              <li key={rv.id} className="flex flex-wrap items-center gap-3 rounded-field border border-line bg-surface-2 px-3.5 py-2.5">
                <SignalBadge level={signalForPercent(rv.scoreOverall)} size="sm" label={`${rv.scoreOverall}%`} />
                <span className="text-sm font-medium text-ink">{rv.provider === "ai" ? `Claude (${rv.model ?? "ai"})` : "Offline analysis"}</span>
                <span className="text-caption text-muted">{rv.createdAt}</span>
                <span className="min-w-0 flex-1 truncate text-caption text-ink-3">{rv.result.verdict || rv.jdText.slice(0, 80)}</span>
                <button
                  type="button"
                  aria-label="Delete review"
                  onClick={() => start(async () => { await deleteReview(rv.id); router.refresh(); })}
                  className="grid h-8 w-8 place-items-center rounded-btn text-ink-3 hover:bg-risk-soft hover:text-risk"
                >
                  <Trash2 size={15} />
                </button>
              </li>
            ))}
          </ul>
        </Card>
      )}
    </div>
  );
}

function ReviewResult({ result }: { result: AiReviewResult }) {
  return (
    <div className="space-y-5">
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <MetricCard label="ATS match" value={formatPct(result.atsScore)} secondary="overall, for this JD" signal={signalForPercent(result.atsScore)} icon={<Target size={18} />} />
        <MetricCard label="Keyword coverage" value={formatPct(result.keywordScore)} secondary="JD terms mirrored" signal={signalForPercent(result.keywordScore)} icon={<FileCheck2 size={18} />} />
        <MetricCard label="Template conformance" value={formatPct(result.conformanceScore)} secondary="vs B2 template" signal={signalForPercent(result.conformanceScore)} icon={<LayoutTemplate size={18} />} />
        <MetricCard label="ATS formatting" value={formatPct(result.formattingScore)} secondary="parseability" signal={signalForPercent(result.formattingScore)} icon={<Sparkles size={18} />} />
      </div>

      {(result.verdict || result.summary) && (
        <Card>
          {result.verdict && <p className="font-display text-h3 text-ink">{result.verdict}</p>}
          {result.summary && <p className="mt-1 text-sm text-muted">{result.summary}</p>}
        </Card>
      )}

      {result.missingKeywords.length > 0 && (
        <Card title="Missing keywords" subtitle="JD terms the CV doesn’t mirror — weave in where genuinely true, never stuff.">
          <div className="flex flex-wrap gap-1.5">
            {result.missingKeywords.map((k) => <Pill key={k} tone="warn">{k}</Pill>)}
          </div>
        </Card>
      )}

      {result.findings.length > 0 && (
        <Card title={<span className="flex items-center gap-2 font-display text-h3 text-ink"><AlertTriangle size={17} className="text-warn" /> Findings</span>} subtitle="Prioritised, most urgent first.">
          <ol className="space-y-3">
            {sortFindings(result.findings).map((f, i) => (
              <li key={i} className="flex gap-3 rounded-field border border-line bg-surface-2 p-3.5">
                <Pill tone={SEV_TONE[f.severity]}>{SEV_LABEL[f.severity]}</Pill>
                <div className="min-w-0">
                  {f.title && <p className="font-semibold text-ink">{f.title}</p>}
                  {f.detail && <p className="mt-0.5 text-sm text-muted">{f.detail}</p>}
                </div>
              </li>
            ))}
          </ol>
        </Card>
      )}

      {result.rewriteSuggestions.length > 0 && (
        <Card title="Suggested rewrites" subtitle="Concrete before → after. The student does the writing — this shows the shape.">
          <div className="space-y-3">
            {result.rewriteSuggestions.map((r, i) => (
              <div key={i} className="rounded-field border border-line bg-surface-2 p-3.5">
                {r.section && <p className="mb-1 text-caption font-semibold uppercase tracking-wide text-muted">{r.section}</p>}
                {r.before && <p className="rounded bg-risk-soft px-2.5 py-1 text-sm text-risk line-through">{r.before}</p>}
                <p className="mt-1 rounded bg-ok-soft px-2.5 py-1 text-sm text-ok">{r.after}</p>
              </div>
            ))}
          </div>
        </Card>
      )}
    </div>
  );
}
