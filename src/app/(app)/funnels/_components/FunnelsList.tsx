"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { Plus, LayoutTemplate, Trash2, Link2, Filter } from "lucide-react";
import type { FunnelListRow } from "@/server/funnels-metrics";
import { Btn, IconButton } from "@/components/ui/controls";
import { Modal } from "@/components/ui/Modal";
import { Field, TextInput, SubmitButton, FormError } from "@/components/ui/form";
import { toast, askConfirm } from "@/components/ui/feedback";
import { EmptyState, Pill } from "@/components/ui/kit";
import { DataTable, type Column } from "@/components/ui/DataTable";
import { DateText } from "@/components/ui/DateText";
import { createFunnel, deleteFunnel } from "@/server/funnels-actions";

type StatusFilter = "published" | "draft";

export default function FunnelsList({ funnels, canDelete }: { funnels: FunnelListRow[]; canDelete: boolean }) {
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState<StatusFilter | null>(null);
  const [showFilters, setShowFilters] = useState(false);

  async function create(fd: FormData) {
    setError(null);
    const res = await createFunnel(fd);
    if (!res.ok) return setError(res.error);
    toast("Funnel created");
    setOpen(false);
  }
  async function copyLink(slug: string) {
    await navigator.clipboard.writeText(`${window.location.origin}/p/${slug}`).catch(() => {});
    toast("Public link copied");
  }
  async function remove(f: FunnelListRow) {
    if (!(await askConfirm({ title: `Delete "${f.name}"?`, body: "All steps are deleted.", danger: true }))) return;
    const res = await deleteFunnel(f.id);
    toast(res.ok ? "Funnel deleted" : res.error, res.ok ? "success" : "error");
  }

  // Text search + per-column sort + pagination are now DataTable's job; only the
  // status filter (categorical, not a DataTable feature) still pre-filters here.
  const filtered = useMemo(
    () =>
      funnels.filter((f) => {
        if (statusFilter === "published" && !f.published) return false;
        if (statusFilter === "draft" && f.published) return false;
        return true;
      }),
    [funnels, statusFilter],
  );

  const columns: Column<FunnelListRow>[] = [
    {
      key: "name", header: "Funnel",
      cell: (f) => (
        <>
          <Link href={`/funnels/${f.id}`} className="text-sm font-semibold text-ink hover:text-primary">{f.name}</Link>
          <span className="block text-xs text-ink-3">/p/{f.slug}</span>
        </>
      ),
      value: (f) => `${f.name} ${f.slug}`,
    },
    { key: "status", header: "Status", cell: (f) => <Pill tone={f.published ? "good" : "neutral"}>{f.published ? "Published" : "Draft"}</Pill>, value: (f) => (f.published ? 1 : 0) },
    { key: "steps", header: "Steps", cell: (f) => f.stepCount, value: (f) => f.stepCount },
    { key: "views", header: "Views", cell: (f) => f.totalViews, value: (f) => f.totalViews },
    { key: "updated", header: "Updated", cell: (f) => <DateText date={f.updatedAt} />, value: (f) => f.updatedAt.getTime() },
    {
      key: "actions", header: "Actions", align: "right", sortable: false,
      cell: (f) => (
        <div className="flex items-center justify-end gap-1">
          {f.published && <IconButton label="Copy public link" onClick={() => copyLink(f.slug)}><Link2 size={16} /></IconButton>}
          <Link href={`/funnels/${f.id}`}><Btn size="sm" variant="ghost">Edit</Btn></Link>
          {canDelete && <IconButton label="Delete funnel" onClick={() => remove(f)}><Trash2 size={16} /></IconButton>}
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
        <Btn size="sm" icon={<Plus size={15} />} onClick={() => { setError(null); setOpen(true); }}>New funnel</Btn>
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

      {funnels.length === 0 ? (
        <EmptyState icon={<LayoutTemplate size={20} />} title="No funnels yet" body="Build a landing page or a multi-step funnel and host it publicly." action={<Btn icon={<Plus size={16} />} onClick={() => setOpen(true)}>New funnel</Btn>} />
      ) : (
        <DataTable
          rows={filtered}
          columns={columns}
          csvName="funnels"
          filterPlaceholder="Search funnel name or slug…"
          emptyMessage="No funnels match. Try a different search or status filter."
        />
      )}

      <Modal open={open} onClose={() => setOpen(false)} title="New funnel" size="sm">
        <form action={create} className="space-y-4">
          <Field label="Funnel name"><TextInput name="name" required placeholder="e.g. VSL Funnel" /></Field>
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
