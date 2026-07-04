"use client";

import { useState } from "react";
import { FileText, List, Search, Target } from "lucide-react";
import { analyseCv, type CvAnalysis } from "@/lib/cv-analysis";
import { MetricCard } from "@/components/ui/MetricCard";
import { SignalBadge } from "@/components/ui/SignalBadge";
import { signalForPercent } from "@/lib/signals";
import { Field, TextArea } from "@/components/ui/form";

export function CvCheckClient() {
  const [cv, setCv] = useState("");
  const [jd, setJd] = useState("");
  const [result, setResult] = useState<CvAnalysis | null>(null);

  const run = () => {
    if (!cv.trim() || !jd.trim()) return;
    setResult(analyseCv(cv, jd));
  };

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <div className="rounded-card border border-line bg-surface p-5 shadow-card">
          <Field label="Student's CV (paste plain text)" hint="Copy-paste from the document - bullets included">
            <TextArea rows={12} value={cv} onChange={(e) => setCv(e.target.value)} placeholder="Paste the CV here…" />
          </Field>
        </div>
        <div className="rounded-card border border-line bg-surface p-5 shadow-card">
          <Field label="Target job description" hint="The German JD they're applying to">
            <TextArea rows={12} value={jd} onChange={(e) => setJd(e.target.value)} placeholder="Paste the JD here…" />
          </Field>
        </div>
      </div>
      <button
        type="button"
        onClick={run}
        disabled={!cv.trim() || !jd.trim()}
        className="rounded-field bg-accent px-5 py-2.5 text-sm font-semibold text-white hover:opacity-95 disabled:opacity-50"
      >
        Run diagnostic
      </button>

      {result && (
        <div className="space-y-6">
          <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
            <MetricCard
              label="JD match score"
              value={`${result.matchScore}%`}
              secondary="weighted keyword coverage"
              signal={signalForPercent(result.matchScore)}
              icon={<Target size={18} />}
            />
            <MetricCard label="Bullets found" value={result.stats.bullets} secondary={`${result.stats.quantifiedBullets} carry a number`} icon={<List size={18} />} />
            <MetricCard label="CV length" value={result.stats.cvWords} secondary="words" icon={<FileText size={18} />} />
            <MetricCard
              label="Missing keywords"
              value={result.missing.length}
              secondary="top JD terms absent"
              signal={result.missing.length > 8 ? "risk" : result.missing.length > 3 ? "watch" : "ok"}
              icon={<Search size={18} />}
            />
          </div>

          {result.missing.length > 0 && (
            <div className="rounded-card border border-line bg-surface p-5 shadow-card">
              <h3 className="font-display text-lg font-semibold">Keywords the JD wants and the CV lacks</h3>
              <p className="mt-0.5 text-xs text-muted">
                Weave these in where they&rsquo;re TRUE - never stuff. The student does the rewriting.
              </p>
              <div className="mt-3 flex flex-wrap gap-1.5">
                {result.missing.map((k) => (
                  <span key={k} className="rounded-full bg-watch-soft px-2.5 py-1 text-xs font-medium text-watch">
                    {k}
                  </span>
                ))}
              </div>
            </div>
          )}

          {result.weakBullets.length > 0 && (
            <div className="rounded-card border border-line bg-surface p-5 shadow-card">
              <h3 className="font-display text-lg font-semibold">Weak bullets</h3>
              <p className="mt-0.5 text-xs text-muted">
                No action verb, no number - coach them into “Verb + what + measurable result”.
              </p>
              <ul className="mt-3 space-y-1.5 text-sm">
                {result.weakBullets.map((b) => (
                  <li key={b} className="rounded-field bg-risk-soft px-3 py-1.5 text-risk">{b}…</li>
                ))}
              </ul>
            </div>
          )}

          <div className="rounded-card border border-line bg-surface p-5 shadow-card">
            <h3 className="font-display text-lg font-semibold">Structure checks</h3>
            <ul className="mt-3 space-y-2">
              {result.sectionChecks.map((c) => (
                <li key={c.label} className="flex flex-wrap items-center gap-2 text-sm">
                  <SignalBadge level={c.ok ? "ok" : "watch"} size="sm" label={c.ok ? "OK" : "Fix"} />
                  <span className="font-medium">{c.label}</span>
                  {!c.ok && <span className="text-muted">- {c.hint}</span>}
                </li>
              ))}
            </ul>
          </div>
        </div>
      )}
    </div>
  );
}
