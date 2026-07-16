"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import dynamic from "next/dynamic";
import {
  FileText,
  Plus,
  Upload,
  Copy,
  Trash2,
  Download,
  Save,
  Loader2,
  FileDown,
  Sparkles,
} from "lucide-react";
import { Card, Pill, EmptyState } from "@/components/ui/kit";
import { Btn } from "@/components/ui/controls";
import { Modal } from "@/components/ui/Modal";
import { Tabs } from "@/components/ui/Tabs";
import { Field, TextInput, Select } from "@/components/ui/form";
import { SegmentedControl } from "@/components/ui/controls";
import { SignalBadge } from "@/components/ui/SignalBadge";
import { signalForPercent } from "@/lib/signals";
import { emptyResumeData, type ResumeData } from "@/lib/resume-types";
import type { ResumeTemplateConfig } from "@/lib/resume-template";
import type { ResumeListItem, ResumeDetail, AiStatus } from "@/server/resume-metrics";
import {
  createResume,
  updateResume,
  deleteResume,
  duplicateResume,
  loadResume,
  importResumeFromText,
} from "@/server/resume-actions";
import { ResumePreview } from "./ResumePreview";
import { ReviewPanel } from "./ReviewPanel";
import { TemplateEditor } from "./TemplateEditor";
import { CvCheckClient } from "./CvCheckClient";

// Heavy form editor — code-split out of the initial CV Studio bundle (BUILD_CHECKLIST.md §12).
const ResumeEditor = dynamic(() => import("./ResumeEditor").then((m) => m.ResumeEditor), {
  ssr: false,
  loading: () => <p className="p-6 text-center text-sm text-ink-3">Loading editor…</p>,
});

/**
 * The CV Studio shell. Owns the selected-CV state so the Builder (edit + preview +
 * export) and the AI Review tab share it. Server actions do the persistence; the DOCX/
 * PDF come from the download route. The Template tab is admin-only (gated again server-side).
 */
export function CvStudio({
  resumes,
  template,
  aiStatus,
  isAdmin,
}: {
  resumes: ResumeListItem[];
  template: ResumeTemplateConfig;
  aiStatus: AiStatus;
  isAdmin: boolean;
}) {
  const [detail, setDetail] = useState<ResumeDetail | null>(null);

  const builder = (
    <Builder resumes={resumes} template={template} detail={detail} setDetail={setDetail} />
  );
  const review = <ReviewPanel resume={detail} aiStatus={aiStatus} template={template} />;

  const tabs = [
    { label: "Builder", content: builder },
    { label: "AI Review", content: review },
    { label: "Instant check", content: <CvCheckClient /> },
    ...(isAdmin ? [{ label: "Template & AI", content: <TemplateEditor template={template} aiStatus={aiStatus} /> }] : []),
  ];

  return <Tabs tabs={tabs} />;
}

// ───────────────────────────── Builder ─────────────────────────────

function Builder({
  resumes,
  template,
  detail,
  setDetail,
}: {
  resumes: ResumeListItem[];
  template: ResumeTemplateConfig;
  detail: ResumeDetail | null;
  setDetail: (d: ResumeDetail | null) => void;
}) {
  const router = useRouter();
  const [draft, setDraft] = useState<ResumeData | null>(null);
  const [title, setTitle] = useState("");
  const [language, setLanguage] = useState("EN");
  const [pending, start] = useTransition();
  const [loadingId, setLoadingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showNew, setShowNew] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const [importing, setImporting] = useState(false);

  const dirty =
    detail != null &&
    draft != null &&
    (JSON.stringify(draft) !== JSON.stringify(detail.data) || title !== detail.title || language !== detail.language);

  const open = (id: string) => {
    setError(null);
    setLoadingId(id);
    start(async () => {
      const d = await loadResume(id);
      setLoadingId(null);
      if (!d) {
        setError("That CV no longer exists.");
        return;
      }
      setDetail(d);
      setDraft(d.data);
      setTitle(d.title);
      setLanguage(d.language);
    });
  };

  const save = (): Promise<boolean> =>
    new Promise((resolve) => {
      if (!detail || !draft) return resolve(false);
      start(async () => {
        setError(null);
        const res = await updateResume({ id: detail.id, title, language, data: draft });
        if (!res.ok) {
          setError(res.error);
          resolve(false);
          return;
        }
        setDetail({ ...detail, title, language, data: draft });
        router.refresh();
        resolve(true);
      });
    });

  const exportAs = async (format: "pdf" | "docx") => {
    if (!detail) return;
    if (dirty) {
      const ok = await save();
      if (!ok) return;
    }
    window.open(`/api/resume/${detail.id}/download?format=${format}`, "_blank");
  };

  const create = (t: string, lang: string, data?: ResumeData) =>
    start(async () => {
      setError(null);
      const res = await createResume({ title: t, language: lang, data });
      if (!res.ok || !res.id) {
        setError(res.ok ? "Couldn't create the CV." : res.error);
        return;
      }
      setShowNew(false);
      router.refresh();
      open(res.id);
    });

  const onImport = (file: File | null | undefined) => {
    if (!file) return;
    setError(null);
    setImporting(true);
    start(async () => {
      try {
        const fd = new FormData();
        fd.append("file", file);
        const res = await fetch("/api/cv-extract", { method: "POST", body: fd });
        const j = (await res.json().catch(() => null)) as { text?: string; error?: string } | null;
        if (!res.ok || !j?.text) throw new Error(j?.error ?? "Couldn't read that file.");
        const parsed = await importResumeFromText(j.text);
        if (!parsed.ok || !parsed.data) throw new Error(parsed.ok ? "Import failed." : parsed.error);
        const name = parsed.data.header.fullName?.trim();
        create(name ? `${name} — CV` : file.name.replace(/\.[^.]+$/, ""), "EN", parsed.data);
        if (parsed.note) setError(parsed.note);
      } catch (e) {
        setError(e instanceof Error ? e.message : "Import failed.");
      } finally {
        setImporting(false);
      }
    });
  };

  return (
    <div className="grid gap-5 lg:grid-cols-[280px_minmax(0,1fr)]">
      {/* ── rail ── */}
      <aside className="space-y-3">
        <div className="flex gap-2">
          <Btn variant="primary" size="sm" icon={<Plus size={15} />} onClick={() => setShowNew(true)}>New CV</Btn>
          <Btn variant="soft" size="sm" icon={importing ? <Loader2 size={15} className="animate-spin" /> : <Upload size={15} />} onClick={() => fileRef.current?.click()} disabled={importing}>
            Import
          </Btn>
          <input ref={fileRef} type="file" accept=".pdf,.docx,.txt" className="hidden" onChange={(e) => { onImport(e.target.files?.[0]); e.target.value = ""; }} />
        </div>

        {resumes.length === 0 ? (
          <p className="rounded-card border border-dashed border-line bg-surface-2 p-4 text-caption text-muted">
            No CVs yet. Start one from scratch or import an existing PDF/Word file.
          </p>
        ) : (
          <ul className="space-y-1.5">
            {resumes.map((r) => (
              <li key={r.id}>
                <button
                  type="button"
                  onClick={() => open(r.id)}
                  className={`flex w-full items-center gap-2.5 rounded-field border px-3 py-2.5 text-left transition-colors ${
                    detail?.id === r.id ? "border-primary bg-primary-soft" : "border-line bg-surface hover:bg-surface-2"
                  }`}
                >
                  <FileText size={16} className="flex-none text-ink-3" />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-medium text-ink">{r.title}</span>
                    <span className="block truncate text-caption text-muted">{r.language} · {r.updatedAt}</span>
                  </span>
                  {loadingId === r.id ? (
                    <Loader2 size={14} className="animate-spin text-ink-3" />
                  ) : r.latestScore != null ? (
                    <SignalBadge level={signalForPercent(r.latestScore)} size="sm" label={`${r.latestScore}%`} />
                  ) : null}
                </button>
              </li>
            ))}
          </ul>
        )}
      </aside>

      {/* ── editor + preview ── */}
      <div className="min-w-0">
        {error && <p role="alert" className="mb-3 rounded-field bg-warn-soft px-3 py-2 text-sm font-medium text-warn">{error}</p>}

        {!detail || !draft ? (
          <EmptyState
            icon={<FileText size={28} />}
            title="Build a CV"
            body="Pick a CV on the left, start a new one, or import an existing PDF/Word file. Export it as a formatted PDF or an ATS-ready DOCX, then review it against a job description."
            action={<Btn variant="primary" icon={<Plus size={15} />} onClick={() => setShowNew(true)}>New CV</Btn>}
          />
        ) : (
          <div className="space-y-4">
            {/* toolbar */}
            <div className="flex flex-wrap items-center gap-3 rounded-card border border-line bg-surface p-3 shadow-card">
              <div className="min-w-[180px] flex-1">
                <TextInput value={title} onChange={(e) => setTitle(e.target.value)} aria-label="CV title" placeholder="CV title" />
              </div>
              <SegmentedControl value={language} onChange={setLanguage} options={[{ value: "EN", label: "EN" }, { value: "DE", label: "DE" }]} ariaLabel="Language" />
              <Btn variant="primary" icon={<Save size={15} />} busy={pending && !loadingId} disabled={!dirty} onClick={() => void save()}>
                {dirty ? "Save" : "Saved"}
              </Btn>
              <Btn variant="soft" icon={<Download size={15} />} onClick={() => void exportAs("pdf")}>PDF</Btn>
              <Btn variant="soft" icon={<FileDown size={15} />} onClick={() => void exportAs("docx")}>DOCX</Btn>
              <div className="flex items-center gap-1">
                <button type="button" aria-label="Duplicate" title="Duplicate" onClick={() => start(async () => { const r = await duplicateResume(detail.id); router.refresh(); if (r.ok && r.id) open(r.id); })} className="grid h-9 w-9 place-items-center rounded-btn border border-line text-ink-2 hover:bg-surface-2">
                  <Copy size={15} />
                </button>
                <button type="button" aria-label="Delete" title="Delete" onClick={() => start(async () => { if (!confirm("Delete this CV?")) return; await deleteResume(detail.id); setDetail(null); setDraft(null); router.refresh(); })} className="grid h-9 w-9 place-items-center rounded-btn border border-line text-ink-2 hover:bg-risk-soft hover:text-risk">
                  <Trash2 size={15} />
                </button>
              </div>
            </div>

            <div className="grid gap-5 xl:grid-cols-2">
              <div className="rounded-card border border-line bg-surface p-5 shadow-card">
                <ResumeEditor data={draft} onChange={setDraft} />
              </div>
              <div className="xl:sticky xl:top-4 xl:self-start">
                <p className="mb-2 flex items-center gap-1.5 text-caption font-semibold uppercase tracking-wide text-muted">
                  <Sparkles size={13} /> Live preview · founder template
                </p>
                <ResumePreview data={draft} cfg={template} language={language} />
              </div>
            </div>
          </div>
        )}
      </div>

      {/* new-CV modal */}
      <NewCvModal open={showNew} onClose={() => setShowNew(false)} onCreate={create} busy={pending} />
    </div>
  );
}

function NewCvModal({
  open,
  onClose,
  onCreate,
  busy,
}: {
  open: boolean;
  onClose: () => void;
  onCreate: (title: string, language: string, data?: ResumeData) => void;
  busy: boolean;
}) {
  const [title, setTitle] = useState("");
  const [language, setLanguage] = useState("EN");
  return (
    <Modal open={open} onClose={onClose} title="New CV" subtitle="A blank CV in the B2 template. You can rename it any time." size="sm">
      <div className="space-y-4">
        <Field label="Title"><TextInput value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Jane Doe — Engineering CV" /></Field>
        <Field label="Language">
          <Select value={language} onChange={(e) => setLanguage(e.target.value)} options={[{ value: "EN", label: "English" }, { value: "DE", label: "German" }]} />
        </Field>
        <div className="flex justify-end gap-2">
          <Btn variant="ghost" onClick={onClose}>Cancel</Btn>
          <Btn variant="primary" busy={busy} disabled={!title.trim()} onClick={() => onCreate(title.trim() || "Untitled CV", language, emptyResumeData())}>Create</Btn>
        </div>
      </div>
    </Modal>
  );
}
