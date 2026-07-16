"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { Plus, FileText, Trash2, Link2, Code2, Filter } from "lucide-react";
import type { FormListRow } from "@/server/forms-metrics";
import { Btn, IconButton } from "@/components/ui/controls";
import { Modal } from "@/components/ui/Modal";
import { Field, TextInput, SubmitButton, FormError } from "@/components/ui/form";
import { toast, askConfirm } from "@/components/ui/feedback";
import { EmptyState, Pill } from "@/components/ui/kit";
import { DataTable, type Column } from "@/components/ui/DataTable";
import { DateText } from "@/components/ui/DateText";
import { createForm, deleteForm } from "@/server/forms-actions";

type StatusFilter = "published" | "draft";

export default function FormsList({ forms, canDelete }: { forms: FormListRow[]; canDelete: boolean }) {
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState<StatusFilter | null>(null);
  const [showFilters, setShowFilters] = useState(false);

  async function create(fd: FormData) {
    setError(null);
    const res = await createForm(fd);
    if (!res.ok) return setError(res.error);
    toast("Form created");
    setOpen(false);
  }

  async function copyLink(slug: string) {
    const url = `${window.location.origin}/f/${slug}`;
    await navigator.clipboard.writeText(url).catch(() => {});
    toast("Public link copied");
  }

  // Height is a reasonable fixed default — an admin embedding a long form on their own site may
  // need to tune it by hand; dynamic iframe-resizing is out of scope (BUILD_CHECKLIST.md §6).
  async function copyEmbed(slug: string) {
    const url = `${window.location.origin}/f/${slug}`;
    const snippet = `<iframe src="${url}" width="100%" height="600" frameborder="0" style="border:none;"></iframe>`;
    await navigator.clipboard.writeText(snippet).catch(() => {});
    toast("Embed code copied");
  }

  async function remove(f: FormListRow) {
    if (!(await askConfirm({ title: `Delete "${f.name}"?`, body: "Submissions are deleted too.", danger: true }))) return;
    const res = await deleteForm(f.id);
    toast(res.ok ? "Form deleted" : res.error, res.ok ? "success" : "error");
  }

  // Text search + per-column sort + pagination are now DataTable's job; only the
  // status filter (categorical, not a DataTable feature) still pre-filters here.
  const filtered = useMemo(
    () =>
      forms.filter((f) => {
        if (statusFilter === "published" && !f.published) return false;
        if (statusFilter === "draft" && f.published) return false;
        return true;
      }),
    [forms, statusFilter],
  );

  const columns: Column<FormListRow>[] = [
    {
      key: "name", header: "Form",
      cell: (f) => (
        <>
          <Link href={`/forms/${f.id}`} className="text-sm font-semibold text-ink hover:text-primary">{f.name}</Link>
          <span className="block text-xs text-ink-3">/f/{f.slug}</span>
        </>
      ),
      value: (f) => `${f.name} ${f.slug}`,
    },
    { key: "status", header: "Status", cell: (f) => <Pill tone={f.published ? "good" : "neutral"}>{f.published ? "Published" : "Draft"}</Pill>, value: (f) => (f.published ? 1 : 0) },
    { key: "fields", header: "Fields", cell: (f) => f.fieldCount, value: (f) => f.fieldCount },
    { key: "submissions", header: "Submissions", cell: (f) => f.submissionCount, value: (f) => f.submissionCount },
    { key: "updated", header: "Updated", cell: (f) => <DateText date={f.updatedAt} />, value: (f) => f.updatedAt.getTime() },
    {
      key: "actions", header: "Actions", align: "right", sortable: false,
      cell: (f) => (
        <div className="flex items-center justify-end gap-1">
          {f.published && <IconButton label="Copy public link" onClick={() => copyLink(f.slug)}><Link2 size={16} /></IconButton>}
          {f.published && <IconButton label="Copy embed code" onClick={() => copyEmbed(f.slug)}><Code2 size={16} /></IconButton>}
          <Link href={`/forms/${f.id}`}><Btn size="sm" variant="ghost">Edit</Btn></Link>
          {canDelete && <IconButton label="Delete form" onClick={() => remove(f)}><Trash2 size={16} /></IconButton>}
        </div>
      ),
    },
  ];

  return (
    <div className="space-y-3">
      {/* Toolbar: Filters · Sort · Search · New */}
      <div className="flex flex-wrap items-center gap-2.5">
        <button
          onClick={() => setShowFilters((v) => !v)}
          className={`inline-flex h-9 items-center gap-1.5 rounded-full border px-3.5 text-sm font-medium ${showFilters || statusFilter ? "border-primary-tint bg-primary-soft text-primary-strong" : "border-line-strong bg-surface text-ink-2 hover:bg-surface-2"}`}
        >
          <Filter size={14} /> Filters{statusFilter ? " · 1" : ""}
        </button>
        <div className="flex-1" />
        <Btn size="sm" icon={<Plus size={15} />} onClick={() => { setError(null); setOpen(true); }}>New form</Btn>
      </div>

      {/* Status filter chips (behind Filters) */}
      {showFilters && (
        <div className="flex flex-wrap items-center gap-2 rounded-field border border-line bg-surface-2 px-3 py-2.5">
          <span className="text-caption font-semibold uppercase text-ink-3">Status</span>
          <button onClick={() => setStatusFilter(null)} className={`rounded-full px-2.5 py-0.5 text-caption font-semibold ${statusFilter === null ? "bg-primary text-on-accent" : "bg-surface text-ink-2"}`}>All</button>
          <button onClick={() => setStatusFilter(statusFilter === "published" ? null : "published")} className={`rounded-full px-2.5 py-0.5 text-caption font-semibold ${statusFilter === "published" ? "bg-primary text-on-accent" : "bg-surface text-ink-2"}`}>Published</button>
          <button onClick={() => setStatusFilter(statusFilter === "draft" ? null : "draft")} className={`rounded-full px-2.5 py-0.5 text-caption font-semibold ${statusFilter === "draft" ? "bg-primary text-on-accent" : "bg-surface text-ink-2"}`}>Draft</button>
        </div>
      )}

      {forms.length === 0 ? (
        <EmptyState icon={<FileText size={20} />} title="No forms yet" body="Build a capture form and embed it on a page or share its link." action={<Btn icon={<Plus size={16} />} onClick={() => setOpen(true)}>New form</Btn>} />
      ) : (
        <DataTable
          rows={filtered}
          columns={columns}
          csvName="forms"
          filterPlaceholder="Search form name or slug…"
          emptyMessage="No forms match. Try a different search or status filter."
        />
      )}

      <Modal open={open} onClose={() => setOpen(false)} title="New form" size="sm">
        <form action={create} className="space-y-4">
          <Field label="Form name"><TextInput name="name" required placeholder="e.g. Free consultation" /></Field>
          <FormError message={error} />
          <div className="flex justify-end gap-2">
            <Btn variant="ghost" type="button" onClick={() => setOpen(false)}>Cancel</Btn>
            <SubmitButton>Create</SubmitButton>
          </div>
        </form>
      </Modal>
    </div>
  );
}
