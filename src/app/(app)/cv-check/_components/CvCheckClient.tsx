"use client";

import { useRef, useState } from "react";
import {
  AlertTriangle,
  CheckCircle2,
  LayoutTemplate,
  List,
  Loader2,
  Search,
  Sparkles,
  Target,
  Upload,
} from "lucide-react";
import { analyseCv, type CvAnalysis, type Suggestion, type TemplateGroup } from "@/lib/cv-analysis";
import { MetricCard } from "@/components/ui/MetricCard";
import { SignalBadge } from "@/components/ui/SignalBadge";
import { Card, Pill } from "@/components/ui/kit";
import { Btn } from "@/components/ui/controls";
import { signalForPercent, SIGNAL_META, type SignalLevel } from "@/lib/signals";
import { formatPct } from "@/lib/format";
import { Field, TextArea } from "@/components/ui/form";

const SUGGESTION_TAG: Record<SignalLevel, string> = { risk: "Fix now", watch: "Improve", ok: "Polish" };

const TEMPLATE_GROUP_ORDER: TemplateGroup[] = ["Cover page", "Core sections", "Additional qualification", "Format"];

const UPLOAD_ACCEPT =
  ".pdf,.docx,.txt,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document,text/plain";

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
        <Card>
          <UploadField
            label="Student's CV (upload or paste)"
            hint="PDF, Word (.docx) or plain text - the file is read in your session and never stored."
            value={cv}
            onChange={setCv}
            placeholder="Paste the CV here…"
          />
        </Card>
        <Card>
          <UploadField
            label="Target job description (upload or paste)"
            hint="The German JD they're applying to - upload the PDF or paste it."
            value={jd}
            onChange={setJd}
            placeholder="Paste the JD here…"
          />
        </Card>
      </div>
      <Btn variant="primary" onClick={run} disabled={!cv.trim() || !jd.trim()}>
        Run diagnostic
      </Btn>

      {result && (
        <div className="space-y-6">
          <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
            <MetricCard
              label="JD match score"
              value={formatPct(result.matchScore)}
              secondary="weighted keyword coverage"
              signal={signalForPercent(result.matchScore)}
              icon={<Target size={18} />}
            />
            <MetricCard
              label="Template match"
              value={formatPct(result.conformance)}
              secondary="B2 resume-template conformance"
              signal={signalForPercent(result.conformance)}
              icon={<LayoutTemplate size={18} />}
            />
            <MetricCard
              label="Bullets found"
              value={result.stats.bullets}
              secondary={`${result.stats.quantifiedBullets} carry a number`}
              icon={<List size={18} />}
            />
            <MetricCard
              label="Missing keywords"
              value={result.missing.length}
              secondary="top JD terms absent"
              signal={result.missing.length > 8 ? "risk" : result.missing.length > 3 ? "watch" : "ok"}
              icon={<Search size={18} />}
            />
          </div>

          {/* Un-edited template text — the manual's #1 rule: "edit all red marked text". */}
          {result.placeholders.length > 0 && (
            <div className="rounded-card border border-risk bg-risk-soft p-4">
              <p className="flex items-center gap-2 text-sm font-semibold text-risk">
                <AlertTriangle size={16} /> {result.placeholders.length} template placeholder
                {result.placeholders.length > 1 ? "s" : ""} still un-edited
              </p>
              <p className="mt-1 text-caption text-risk">
                The B2 manual says replace every red field before applying. A CV with placeholder text is auto-rejected.
              </p>
              <div className="mt-2.5 flex flex-wrap gap-1.5">
                {result.placeholders.map((p) => (
                  <span key={p.label} title={p.label} className="rounded-full bg-surface px-2.5 py-0.5 text-caption font-medium text-risk">
                    {p.sample}
                  </span>
                ))}
              </div>
            </div>
          )}

          {/* Generated suggestions — the coaching to-do list, risk-first. */}
          <Card
            title={
              <span className="flex items-center gap-2 font-display text-h3 text-ink">
                <Sparkles size={18} className="text-accent" /> Generated suggestions
              </span>
            }
            subtitle="Auto-built from the gaps below, most urgent first. Coach the student through these - they do the rewriting."
          >
            <ol className="space-y-3">
              {result.suggestions.map((s, i) => (
                <SuggestionRow key={i} s={s} />
              ))}
            </ol>
          </Card>

          {result.missing.length > 0 && (
            <Card
              title="Keywords the JD wants and the CV lacks"
              subtitle="Weave these in where they’re TRUE - never stuff. The student does the rewriting."
            >
              <div className="flex flex-wrap gap-1.5">
                {result.missing.map((k) => (
                  <Pill key={k} tone="warn">
                    {k}
                  </Pill>
                ))}
              </div>
            </Card>
          )}

          {result.weakBullets.length > 0 && (
            <Card
              title="Weak bullets"
              subtitle="No action verb, no number - coach them into “Verb + what + measurable result”."
            >
              <ul className="space-y-1.5 text-sm">
                {result.weakBullets.map((b) => (
                  <li key={b} className="rounded-field bg-risk-soft px-3 py-1.5 text-risk">
                    {b}…
                  </li>
                ))}
              </ul>
            </Card>
          )}

          {/* B2 template conformance — graded against the "How to edit the resume" manual. */}
          <Card
            title="B2 resume-template conformance"
            subtitle="Checked against the B2 “How to edit the resume” manual - the cover page and section spine every student is handed."
          >
            <div className="space-y-5">
              {TEMPLATE_GROUP_ORDER.map((group) => {
                const items = result.templateChecks.filter((c) => c.group === group);
                if (items.length === 0) return null;
                return (
                  <div key={group}>
                    <p className="mb-2 text-caption font-semibold uppercase tracking-wide text-muted">{group}</p>
                    <ul className="space-y-2">
                      {items.map((c) => (
                        <li key={c.key} className="flex flex-wrap items-center gap-2 text-sm">
                          <SignalBadge level={c.present ? "ok" : "watch"} size="sm" label={c.present ? "OK" : "Add"} />
                          <span className="font-medium">{c.label}</span>
                          {!c.present && <span className="text-muted">- {c.hint}</span>}
                        </li>
                      ))}
                    </ul>
                  </div>
                );
              })}
            </div>
          </Card>

          <Card title="Structure checks" subtitle="Generic CV hygiene, on top of the B2 template above.">
            <ul className="space-y-2">
              {result.sectionChecks.map((c) => (
                <li key={c.label} className="flex flex-wrap items-center gap-2 text-sm">
                  <SignalBadge level={c.ok ? "ok" : "watch"} size="sm" label={c.ok ? "OK" : "Fix"} />
                  <span className="font-medium">{c.label}</span>
                  {!c.ok && <span className="text-muted">- {c.hint}</span>}
                </li>
              ))}
            </ul>
          </Card>
        </div>
      )}
    </div>
  );
}

/**
 * Upload-or-paste input. A .pdf/.docx/.txt is POSTed to /api/cv-extract, which
 * returns plain text (stored nowhere); the coach can then edit it before running.
 * Pasting straight into the textarea still works exactly as before.
 */
function UploadField({
  label,
  hint,
  value,
  onChange,
  placeholder,
  rows = 12,
}: {
  label: string;
  hint: string;
  value: string;
  onChange: (v: string) => void;
  placeholder: string;
  rows?: number;
}) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [loaded, setLoaded] = useState<string | null>(null);
  const [drag, setDrag] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  async function ingest(file: File | undefined | null) {
    if (!file) return;
    setErr(null);
    setLoaded(null);
    setBusy(true);
    try {
      const fd = new FormData();
      fd.append("file", file);
      const res = await fetch("/api/cv-extract", { method: "POST", body: fd });
      const data = (await res.json().catch(() => null)) as
        | { text?: string; filename?: string; chars?: number; error?: string }
        | null;
      if (!res.ok || !data?.text) {
        throw new Error(data?.error ?? `Couldn't read that file (${res.status}).`);
      }
      onChange(data.text);
      setLoaded(`${data.filename ?? file.name} · ${Number(data.chars ?? data.text.length).toLocaleString()} chars`);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Upload failed.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Field label={label} hint={hint}>
      <div
        onDragOver={(e) => {
          e.preventDefault();
          setDrag(true);
        }}
        onDragLeave={() => setDrag(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDrag(false);
          void ingest(e.dataTransfer.files?.[0]);
        }}
        className={`mb-2 flex flex-wrap items-center gap-x-2 gap-y-1 rounded-field border border-dashed px-3 py-2 text-caption transition-colors ${
          drag ? "border-accent bg-accent-soft" : "border-line bg-surface-2"
        }`}
      >
        <input
          ref={inputRef}
          type="file"
          accept={UPLOAD_ACCEPT}
          className="hidden"
          onChange={(e) => {
            void ingest(e.target.files?.[0]);
            e.target.value = "";
          }}
        />
        <button
          type="button"
          onClick={() => inputRef.current?.click()}
          disabled={busy}
          className="inline-flex items-center gap-1.5 rounded-field bg-surface px-2.5 py-1 font-semibold text-ink shadow-card hover:opacity-90 disabled:opacity-60"
        >
          {busy ? <Loader2 size={14} className="animate-spin" /> : <Upload size={14} />}
          {busy ? "Reading…" : "Upload .pdf / .docx"}
        </button>
        {loaded && !err ? (
          <span className="inline-flex items-center gap-1 font-medium text-ok">
            <CheckCircle2 size={13} /> {loaded}
          </span>
        ) : err ? (
          <span className="inline-flex items-center gap-1 font-medium text-risk">
            <AlertTriangle size={13} /> {err}
          </span>
        ) : (
          <span className="text-muted">or drag a file here · or paste below</span>
        )}
      </div>
      <TextArea rows={rows} value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} />
    </Field>
  );
}

function SuggestionRow({ s }: { s: Suggestion }) {
  const meta = SIGNAL_META[s.level];
  return (
    <li className="flex gap-3 rounded-field border border-line bg-surface-2 p-3.5">
      <span aria-hidden className="mt-1 inline-block h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: meta.color }} />
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-2">
          <SignalBadge level={s.level} size="sm" label={SUGGESTION_TAG[s.level]} />
          <span className="font-semibold text-ink">{s.title}</span>
        </div>
        <p className="mt-1 text-sm text-muted">{s.detail}</p>
      </div>
    </li>
  );
}
