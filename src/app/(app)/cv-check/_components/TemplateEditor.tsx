"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Check, Sparkles, KeyRound, Plus, Trash2, X, RotateCcw } from "lucide-react";
import { Card, Panel, Pill } from "@/components/ui/kit";
import { Btn, Switch, SegmentedControl, SaveBar } from "@/components/ui/controls";
import { Field, TextInput, TextArea, Select } from "@/components/ui/form";
import {
  DEFAULT_RESUME_TEMPLATE,
  DEFAULT_ATS_RULES,
  type ResumeTemplateConfig,
  type ResumeSectionSetting,
  type AtsRule,
  type AtsSeverity,
} from "@/lib/resume-template";
import type { AiStatus } from "@/server/resume-metrics";
import { saveResumeTemplate, saveAiSettings, resetResumeTemplate } from "@/server/resume-actions";

/** Model choices mirrored from lib/anthropic (kept here so this client file needn't import the server-only module). */
const MODEL_OPTIONS = [
  { value: "claude-sonnet-5", label: "Claude Sonnet 5 — balanced (recommended)" },
  { value: "claude-opus-4-8", label: "Claude Opus 4.8 — deepest review" },
  { value: "claude-haiku-4-5-20251001", label: "Claude Haiku 4.5 — fastest / cheapest" },
];

/**
 * Founder control panel: "how the resume should be" (which sections, order, headings,
 * style) + the ATS rubric + the Claude seam settings. Admin-only — the page gates the
 * tab, the server actions re-check requireAdmin. The API key + on/off flag live in env
 * (shown here read-only), so nothing secret is edited from the browser.
 */
export function TemplateEditor({ template, aiStatus }: { template: ResumeTemplateConfig; aiStatus: AiStatus }) {
  const router = useRouter();
  const [cfg, setCfg] = useState<ResumeTemplateConfig>(template);
  const [ai, setAi] = useState(aiStatus.settings);
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const dirtyTpl = JSON.stringify(cfg) !== JSON.stringify(template);
  const dirtyAi = JSON.stringify(ai) !== JSON.stringify(aiStatus.settings);

  const setStyle = (p: Partial<ResumeTemplateConfig["style"]>) => setCfg({ ...cfg, style: { ...cfg.style, ...p } });
  const setAts = (p: Partial<ResumeTemplateConfig["ats"]>) => setCfg({ ...cfg, ats: { ...cfg.ats, ...p } });
  const setSection = (id: string, p: Partial<ResumeSectionSetting>) =>
    setCfg({ ...cfg, sections: cfg.sections.map((s) => (s.id === id ? { ...s, ...p } : s)) });

  // ── ATS rule helpers ──
  const setRules = (rules: AtsRule[]) => setAts({ rules });
  const updateRule = (id: string, p: Partial<AtsRule>) => setRules(cfg.ats.rules.map((r) => (r.id === id ? { ...r, ...p } : r)));
  const removeRule = (id: string) => setRules(cfg.ats.rules.filter((r) => r.id !== id));
  const addRule = () =>
    setRules([
      ...cfg.ats.rules,
      { id: newId(), label: "", instruction: "", weight: 3, severity: "medium", enabled: true },
    ]);
  const moveRule = (i: number, dir: -1 | 1) => {
    const j = i + dir;
    if (j < 0 || j >= cfg.ats.rules.length) return;
    const next = [...cfg.ats.rules];
    [next[i], next[j]] = [next[j], next[i]];
    setRules(next);
  };

  const move = (i: number, dir: -1 | 1) => {
    const j = i + dir;
    if (j < 0 || j >= cfg.sections.length) return;
    const next = [...cfg.sections];
    [next[i], next[j]] = [next[j], next[i]];
    setCfg({ ...cfg, sections: next.map((s, k) => ({ ...s, order: (k + 1) * 10 })) });
  };

  const saveTpl = () =>
    start(async () => {
      setError(null);
      const res = await saveResumeTemplate(cfg);
      if (!res.ok) setError(res.error);
      else router.refresh();
    });

  const saveAi = () =>
    start(async () => {
      setError(null);
      const res = await saveAiSettings(ai);
      if (!res.ok) setError(res.error);
      else router.refresh();
    });

  const reset = () =>
    start(async () => {
      await resetResumeTemplate();
      setCfg(DEFAULT_RESUME_TEMPLATE);
      router.refresh();
    });

  return (
    <div className="space-y-5">
      {/* ── Sections ── */}
      <Card title="Sections & order" subtitle="Turn blocks on/off, reorder them, and rename the headings (English + German). This is the shape every exported CV takes.">
        <div className="space-y-2">
          {cfg.sections.map((s, i) => (
            <Panel key={s.id}>
              <div className="flex flex-wrap items-center gap-3">
                <div className="flex flex-none flex-col">
                  <button type="button" aria-label="Up" onClick={() => move(i, -1)} className="px-1 text-ink-3 hover:text-ink">↑</button>
                  <button type="button" aria-label="Down" onClick={() => move(i, 1)} className="px-1 text-ink-3 hover:text-ink">↓</button>
                </div>
                <div className="grid flex-1 gap-2 sm:grid-cols-2">
                  <TextInput value={s.labelEn} onChange={(e) => setSection(s.id, { labelEn: e.target.value })} aria-label="English label" />
                  <TextInput value={s.labelDe} onChange={(e) => setSection(s.id, { labelDe: e.target.value })} aria-label="German label" />
                </div>
                <label className="flex flex-none items-center gap-2 text-caption font-medium text-ink-2">
                  <Switch checked={s.enabled} onChange={(v) => setSection(s.id, { enabled: v })} label={`Enable ${s.labelEn}`} />
                  {s.enabled ? "On" : "Off"}
                </label>
              </div>
            </Panel>
          ))}
        </div>
      </Card>

      {/* ── Style ── */}
      <Card title="Style" subtitle="Applied to the PDF, DOCX and live preview.">
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Accent colour">
            <div className="flex items-center gap-2">
              <input type="color" value={cfg.style.accentColor} onChange={(e) => setStyle({ accentColor: e.target.value })} className="h-10 w-14 cursor-pointer rounded-field border border-line-strong bg-surface" aria-label="Accent colour" />
              <TextInput value={cfg.style.accentColor} onChange={(e) => setStyle({ accentColor: e.target.value })} className="font-mono" />
            </div>
          </Field>
          <Field label="Font">
            <Select
              value={cfg.style.font}
              onChange={(e) => setStyle({ font: e.target.value as ResumeTemplateConfig["style"]["font"] })}
              options={[
                { value: "Helvetica", label: "Helvetica / Arial (sans)" },
                { value: "Times-Roman", label: "Times (serif)" },
                { value: "Courier", label: "Courier (mono)" },
              ]}
            />
          </Field>
          <Field label="Page size">
            <SegmentedControl
              value={cfg.style.pageSize}
              onChange={(v) => setStyle({ pageSize: v })}
              options={[{ value: "A4", label: "A4" }, { value: "LETTER", label: "Letter" }]}
            />
          </Field>
          <div className="flex flex-col justify-end gap-2">
            <ToggleRow label="Show photo (PDF)" checked={cfg.style.showPhoto} onChange={(v) => setStyle({ showPhoto: v })} />
            <ToggleRow label="Show date of birth" checked={cfg.style.showDob} onChange={(v) => setStyle({ showDob: v })} />
            <ToggleRow label="Show headline" checked={cfg.style.showHeadline} onChange={(v) => setStyle({ showHeadline: v })} />
          </div>
        </div>
      </Card>

      {/* ── ATS engine ── */}
      <Card
        title="ATS engine"
        subtitle="Tune exactly how a CV is scored: the axis weights, the rule-by-rule checklist, the always-check keyword library and the verdict bands. Applies to both the Claude review and the offline analyser."
      >
        {/* axis weights */}
        <p className="mb-2 text-caption font-semibold uppercase tracking-wide text-muted">Axis weights</p>
        <div className="grid gap-4 sm:grid-cols-3">
          <Field label="Keyword %" hint="JD-term coverage"><TextInput type="number" value={String(cfg.ats.weightKeywords)} onChange={(e) => setAts({ weightKeywords: Number(e.target.value) || 0 })} /></Field>
          <Field label="Conformance %" hint="vs B2 template"><TextInput type="number" value={String(cfg.ats.weightConformance)} onChange={(e) => setAts({ weightConformance: Number(e.target.value) || 0 })} /></Field>
          <Field label="Formatting %" hint="ATS-parseability"><TextInput type="number" value={String(cfg.ats.weightFormatting)} onChange={(e) => setAts({ weightFormatting: Number(e.target.value) || 0 })} /></Field>
        </div>

        {/* verdict bands */}
        <p className="mb-2 mt-6 text-caption font-semibold uppercase tracking-wide text-muted">Verdict bands</p>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Strong match at ≥ %" hint="Green — polish & send"><TextInput type="number" value={String(cfg.ats.bands.strong)} onChange={(e) => setAts({ bands: { ...cfg.ats.bands, strong: Number(e.target.value) || 0 } })} /></Field>
          <Field label="Partial match at ≥ %" hint="Amber — close the gaps"><TextInput type="number" value={String(cfg.ats.bands.partial)} onChange={(e) => setAts({ bands: { ...cfg.ats.bands, partial: Number(e.target.value) || 0 } })} /></Field>
        </div>

        {/* rule checklist */}
        <div className="mb-2 mt-6 flex items-center justify-between gap-2">
          <p className="text-caption font-semibold uppercase tracking-wide text-muted">ATS rules ({cfg.ats.rules.filter((r) => r.enabled).length}/{cfg.ats.rules.length} active)</p>
          <button type="button" onClick={() => setAts({ rules: DEFAULT_ATS_RULES.map((r) => ({ ...r })) })} className="inline-flex items-center gap-1 text-caption font-medium text-primary hover:underline">
            <RotateCcw size={12} /> Reset rules
          </button>
        </div>
        <div className="space-y-2">
          {cfg.ats.rules.map((r, i) => (
            <Panel key={r.id}>
              <div className="flex items-start gap-3">
                <div className="flex flex-none flex-col pt-1">
                  <button type="button" aria-label="Up" onClick={() => moveRule(i, -1)} className="px-1 text-ink-3 hover:text-ink">↑</button>
                  <button type="button" aria-label="Down" onClick={() => moveRule(i, 1)} className="px-1 text-ink-3 hover:text-ink">↓</button>
                </div>
                <div className="min-w-0 flex-1 space-y-2">
                  <div className="flex flex-wrap items-center gap-2">
                    <input value={r.label} onChange={(e) => updateRule(r.id, { label: e.target.value })} placeholder="Rule name" aria-label="Rule name" className="h-9 min-w-[160px] flex-1 rounded-field border border-line-strong bg-surface px-3 text-sm font-medium text-ink outline-none focus:border-primary focus:ring-2 focus:ring-primary-soft" />
                    <Select size="sm" value={r.severity} onChange={(e) => updateRule(r.id, { severity: e.target.value as AtsSeverity })} aria-label="Severity" options={[{ value: "high", label: "High" }, { value: "medium", label: "Medium" }, { value: "low", label: "Low" }]} />
                    <Select size="sm" value={String(r.weight)} onChange={(e) => updateRule(r.id, { weight: Number(e.target.value) })} aria-label="Weight" options={[1, 2, 3, 4, 5].map((n) => ({ value: String(n), label: `w${n}` }))} />
                    <label className="flex items-center gap-1.5 text-caption font-medium text-ink-2">
                      <Switch checked={r.enabled} onChange={(v) => updateRule(r.id, { enabled: v })} label={`Enable ${r.label}`} />
                      {r.enabled ? "On" : "Off"}
                    </label>
                    <button type="button" aria-label="Remove rule" onClick={() => removeRule(r.id)} className="grid h-9 w-9 place-items-center rounded-btn text-ink-3 hover:bg-risk-soft hover:text-risk">
                      <Trash2 size={15} />
                    </button>
                  </div>
                  <TextInput value={r.instruction} onChange={(e) => updateRule(r.id, { instruction: e.target.value })} placeholder="What a passing CV must do…" aria-label="Rule instruction" />
                </div>
              </div>
            </Panel>
          ))}
          <Btn size="sm" variant="soft" icon={<Plus size={14} />} onClick={addRule}>Add ATS rule</Btn>
        </div>

        {/* target keyword library */}
        <div className="mt-6">
          <Field label="Always-check keyword library" hint="Skills/tools the ATS should look for on every CV, on top of the JD's own terms. Any that are missing get flagged.">
            <TagInput values={cfg.ats.targetKeywords} onChange={(targetKeywords) => setAts({ targetKeywords })} placeholder="Type a keyword and press Enter (e.g. AutoCAD)" />
          </Field>
        </div>

        {/* AI house rules */}
        <div className="mt-4">
          <Field label="Extra house rules for the AI reviewer" hint="Free-text steering sent to Claude with every review, e.g. “Insist on relocation readiness and a German B2 level.”">
            <TextArea rows={3} value={cfg.ats.customInstructions} onChange={(e) => setAts({ customInstructions: e.target.value })} />
          </Field>
        </div>

        <SaveBar dirty={dirtyTpl} onSave={saveTpl} onReset={reset} busy={pending} error={error} resetLabel="Reset template to B2 default" />
      </Card>

      {/* ── AI seam ── */}
      <Card title={<span className="flex items-center gap-2 font-display text-h3 text-ink"><Sparkles size={18} className="text-primary" /> Claude AI review</span>} subtitle="The model + limits for the JD review. The API key and master on/off flag live in the server environment.">
        <div className="mb-4 grid gap-2 sm:grid-cols-3">
          <StatusPill ok={aiStatus.configured} label={aiStatus.configured ? "API key set" : "No API key"} hint="ANTHROPIC_API_KEY" />
          <StatusPill ok={aiStatus.envEnabled} label={aiStatus.envEnabled ? "Flag on" : "Flag off"} hint="AI_REVIEW_ENABLED" />
          <StatusPill ok={aiStatus.enabled} label={aiStatus.enabled ? "Live" : "Offline fallback"} hint="key + flag + not paused" />
        </div>
        {!aiStatus.configured && (
          <p className="mb-4 flex items-start gap-2 rounded-field bg-warn-soft px-3 py-2 text-sm text-warn">
            <KeyRound size={15} className="mt-0.5 flex-none" />
            Add <code className="rounded bg-surface px-1">ANTHROPIC_API_KEY</code> and set <code className="rounded bg-surface px-1">AI_REVIEW_ENABLED=true</code> in the server environment, then rebuild. Until then reviews use the offline analyser.
          </p>
        )}
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Model"><Select value={ai.model} onChange={(e) => setAi({ ...ai, model: e.target.value })} options={MODEL_OPTIONS} /></Field>
          <Field label="Max output tokens" hint="Higher = longer, deeper reviews (1024–16000).">
            <TextInput type="number" value={String(ai.maxTokens)} onChange={(e) => setAi({ ...ai, maxTokens: Number(e.target.value) || 4096 })} />
          </Field>
        </div>
        <div className="mt-3">
          <ToggleRow label="Pause AI review (use offline analyser)" checked={ai.paused} onChange={(v) => setAi({ ...ai, paused: v })} />
        </div>
        <SaveBar dirty={dirtyAi} onSave={saveAi} busy={pending} error={error} />
      </Card>
    </div>
  );
}

/** A fresh id for a founder-added ATS rule (browser crypto, with a fallback). */
function newId(): string {
  try {
    return `rule-${crypto.randomUUID().slice(0, 8)}`;
  } catch {
    return `rule-${Math.floor(Math.random() * 1e9).toString(36)}`;
  }
}

/** Chip-style multi-value input for the keyword library. Enter or comma commits a value. */
function TagInput({ values, onChange, placeholder }: { values: string[]; onChange: (v: string[]) => void; placeholder?: string }) {
  const [draft, setDraft] = useState("");
  const commit = (raw: string) => {
    const parts = raw.split(",").map((s) => s.trim()).filter(Boolean);
    if (!parts.length) return;
    const next = [...values];
    for (const p of parts) if (!next.some((v) => v.toLowerCase() === p.toLowerCase())) next.push(p);
    onChange(next.slice(0, 80));
    setDraft("");
  };
  return (
    <div className="rounded-field border border-line-strong bg-surface p-2">
      {values.length > 0 && (
        <div className="mb-2 flex flex-wrap gap-1.5">
          {values.map((v) => (
            <span key={v} className="inline-flex items-center gap-1">
              <Pill tone="primary">
                {v}
                <button type="button" aria-label={`Remove ${v}`} onClick={() => onChange(values.filter((x) => x !== v))} className="ml-0.5 text-primary-strong hover:text-risk">
                  <X size={12} />
                </button>
              </Pill>
            </span>
          ))}
        </div>
      )}
      <input
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === ",") {
            e.preventDefault();
            commit(draft);
          } else if (e.key === "Backspace" && !draft && values.length) {
            onChange(values.slice(0, -1));
          }
        }}
        onBlur={() => commit(draft)}
        placeholder={placeholder}
        aria-label="Add keyword"
        className="h-9 w-full bg-transparent px-1.5 text-sm text-ink outline-none"
      />
    </div>
  );
}

function ToggleRow({ label, checked, onChange }: { label: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <label className="flex items-center justify-between gap-3 rounded-field border border-line bg-surface px-3.5 py-2.5 text-sm font-medium text-ink">
      {label}
      <Switch checked={checked} onChange={onChange} label={label} />
    </label>
  );
}

function StatusPill({ ok, label, hint }: { ok: boolean; label: string; hint: string }) {
  return (
    <span title={hint} className={`flex items-center gap-2 rounded-field border px-3 py-2 text-sm font-medium ${ok ? "border-ok bg-ok-soft text-ok" : "border-line bg-surface-2 text-ink-2"}`}>
      <span className={`grid h-4 w-4 place-items-center rounded-full ${ok ? "bg-ok text-on-accent" : "bg-line-strong"}`}>{ok && <Check size={11} strokeWidth={3.5} />}</span>
      {label}
    </span>
  );
}
