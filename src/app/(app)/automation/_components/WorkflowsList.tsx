"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  Plus, Workflow, Trash2, Play, Filter, Folder, FolderPlus, FolderInput,
  RotateCcw, Pencil, Settings, Globe, ChevronRight,
} from "lucide-react";
import type { WorkflowRow, FolderRow } from "@/server/automation-metrics";
import { TRIGGER_LABELS, type TriggerType } from "@/lib/automation-types";
import { Btn, IconButton } from "@/components/ui/controls";
import { Modal } from "@/components/ui/Modal";
import { Field, TextInput, Select, SubmitButton, FormError } from "@/components/ui/form";
import { toast, askConfirm } from "@/components/ui/feedback";
import { EmptyState, Pill } from "@/components/ui/kit";
import { DataTable, type Column } from "@/components/ui/DataTable";
import { DateText } from "@/components/ui/DateText";
import {
  createWorkflow, deleteWorkflow, runWorkflowsNow, createFolder, renameFolder, deleteFolder,
  moveWorkflowsToFolder, restoreWorkflow, destroyWorkflow, bulkDeleteWorkflows,
  bulkRestoreWorkflows, bulkSetPublish,
} from "@/server/automation-actions";

const TRIGGER_OPTS = (Object.keys(TRIGGER_LABELS) as TriggerType[]).map((k) => ({ value: k, label: TRIGGER_LABELS[k] }));

type StatusFilter = "PUBLISHED" | "DRAFT";
type Tab = "all" | "deleted";

function triggerLabel(w: WorkflowRow): string {
  return TRIGGER_LABELS[w.triggerType as TriggerType] ?? w.triggerType;
}

export default function WorkflowsList({
  workflows, folders, openFolder, tab, deletedCount, canDelete, isAdmin,
}: {
  workflows: WorkflowRow[];
  folders: FolderRow[];
  openFolder: { id: string; name: string } | null;
  tab: Tab;
  deletedCount: number;
  canDelete: boolean;
  isAdmin: boolean;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState<StatusFilter | null>(null);
  const [showFilters, setShowFilters] = useState(false);
  const [folderOpen, setFolderOpen] = useState(false);
  const [folderError, setFolderError] = useState<string | null>(null);
  const [moveOpen, setMoveOpen] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());

  // The list is one client component across every folder/tab, so a stale selection would
  // otherwise survive navigation and let a bulk action hit rows that are no longer on screen.
  useEffect(() => { setSelected(new Set()); }, [tab, openFolder?.id]);

  const showFolders = tab === "all" && !openFolder && folders.length > 0;

  async function create(fd: FormData) {
    setError(null);
    const res = await createWorkflow(fd);
    if (!res.ok) return setError(res.error);
    toast("Workflow created");
    setOpen(false);
  }
  async function addFolder(fd: FormData) {
    setFolderError(null);
    const res = await createFolder(fd);
    if (!res.ok) return setFolderError(res.error);
    toast("Folder created");
    setFolderOpen(false);
  }
  async function remove(w: WorkflowRow) {
    if (!(await askConfirm({ title: `Delete “${w.name}”?`, body: "It moves to the Deleted tab and stops triggering. You can restore it.", danger: true }))) return;
    const res = await deleteWorkflow(w.id);
    toast(res.ok ? "Workflow deleted" : res.error, res.ok ? "success" : "error");
  }
  async function restore(w: WorkflowRow) {
    const res = await restoreWorkflow(w.id);
    toast(res.ok ? "Workflow restored" : res.error, res.ok ? "success" : "error");
  }
  async function destroy(w: WorkflowRow) {
    if (!(await askConfirm({ title: `Permanently delete “${w.name}”?`, body: "This cannot be undone, and it also deletes every enrollment record for this workflow.", danger: true }))) return;
    const res = await destroyWorkflow(w.id);
    toast(res.ok ? "Workflow permanently deleted" : res.error, res.ok ? "success" : "error");
  }
  async function runNow() {
    const res = await runWorkflowsNow();
    if (res.disabled) return toast("The engine is switched off in Global Workflow Settings", "error");
    toast(`Ran automation — ${res.processed} enrollment${res.processed === 1 ? "" : "s"} processed`);
  }
  async function rename(f: FolderRow) {
    const next = window.prompt("Rename folder", f.name);
    if (next === null || next.trim() === f.name) return;
    const res = await renameFolder(f.id, next);
    toast(res.ok ? "Folder renamed" : res.error, res.ok ? "success" : "error");
    if (res.ok) router.refresh();
  }
  async function removeFolder(f: FolderRow) {
    const body = f.workflowCount > 0
      ? `The ${f.workflowCount} workflow${f.workflowCount === 1 ? "" : "s"} inside will move back to Home, not be deleted.`
      : undefined;
    if (!(await askConfirm({ title: `Delete folder “${f.name}”?`, body, danger: true }))) return;
    const res = await deleteFolder(f.id);
    toast(res.ok ? "Folder deleted" : res.error, res.ok ? "success" : "error");
  }

  // ── bulk actions ──
  const ids = useMemo(() => [...selected], [selected]);
  async function afterBulk(res: { ok: boolean; error?: string }, okMsg: string) {
    if (!res.ok) return toast(res.error ?? "Something went wrong", "error");
    setSelected(new Set());
    toast(okMsg);
  }
  async function bulkPublish(publish: boolean) {
    const res = await bulkSetPublish(ids, publish);
    if (!res.ok) return toast(res.error, "error");
    setSelected(new Set());
    toast(
      res.skipped > 0
        ? `${res.changed} ${publish ? "published" : "unpublished"} — ${res.skipped} skipped (no actions yet)`
        : `${res.changed} workflow${res.changed === 1 ? "" : "s"} ${publish ? "published" : "unpublished"}`,
    );
  }
  async function bulkDelete() {
    if (!(await askConfirm({ title: `Delete ${ids.length} workflow${ids.length === 1 ? "" : "s"}?`, body: "They move to the Deleted tab and can be restored.", danger: true }))) return;
    await afterBulk(await bulkDeleteWorkflows(ids), `${ids.length} deleted`);
  }
  async function bulkRestore() {
    await afterBulk(await bulkRestoreWorkflows(ids), `${ids.length} restored`);
  }
  async function move(fd: FormData) {
    const raw = String(fd.get("folderId") ?? "");
    const res = await moveWorkflowsToFolder(ids, raw || null);
    if (!res.ok) return toast(res.error, "error");
    setMoveOpen(false);
    setSelected(new Set());
    toast(`Moved ${ids.length} workflow${ids.length === 1 ? "" : "s"}`);
  }

  // Text search + per-column sort + pagination are DataTable's job; only the status filter
  // (categorical, not a DataTable feature) still pre-filters here.
  const filtered = useMemo(
    () => (statusFilter ? workflows.filter((w) => w.status === statusFilter) : workflows),
    [workflows, statusFilter],
  );

  const columns: Column<WorkflowRow>[] = [
    {
      key: "name", header: "Workflow",
      cell: (w) => <Link href={`/automation/${w.id}`} className="text-sm font-semibold text-ink hover:text-primary">{w.name}</Link>,
      value: (w) => w.name,
    },
    { key: "trigger", header: "Trigger", cell: (w) => triggerLabel(w), value: (w) => triggerLabel(w) },
    { key: "actions", header: "Actions", cell: (w) => w.actionCount, value: (w) => w.actionCount },
    {
      key: "status", header: "Status",
      cell: (w) => <Pill tone={w.status === "PUBLISHED" ? "good" : "neutral"}>{w.status === "PUBLISHED" ? "Live" : "Draft"}</Pill>,
      value: (w) => w.status,
    },
    { key: "active", header: "Active", align: "right", cell: (w) => w.activeEnrolled, value: (w) => w.activeEnrolled },
    { key: "total", header: "Total", align: "right", cell: (w) => w.totalEnrolled, value: (w) => w.totalEnrolled },
    tab === "deleted"
      ? { key: "deleted", header: "Deleted", align: "right", cell: (w) => (w.deletedAt ? <DateText date={w.deletedAt} /> : null), value: (w) => w.deletedAt?.getTime() ?? 0 }
      : { key: "updated", header: "Updated", align: "right", cell: (w) => <DateText date={w.updatedAt} />, value: (w) => w.updatedAt.getTime() },
    {
      key: "row-actions", header: "", align: "right", sortable: false,
      cell: (w) => !canDelete ? null : tab === "deleted" ? (
        <div className="flex justify-end gap-1">
          <IconButton label="Restore workflow" onClick={() => restore(w)}><RotateCcw size={16} /></IconButton>
          <IconButton label="Delete permanently" onClick={() => destroy(w)}><Trash2 size={16} /></IconButton>
        </div>
      ) : (
        <IconButton label="Delete workflow" onClick={() => remove(w)}><Trash2 size={16} /></IconButton>
      ),
    },
  ];

  const tabCls = (active: boolean) =>
    `inline-flex h-9 items-center gap-1.5 rounded-full px-3.5 text-sm font-medium ${active ? "bg-primary text-on-accent" : "text-ink-2 hover:bg-surface-2"}`;

  return (
    <div className="space-y-3">
      {/* Tabs + breadcrumb */}
      <div className="flex flex-wrap items-center gap-2">
        <Link href="/automation" className={tabCls(tab === "all" && !openFolder)}>All workflows</Link>
        <Link href="/automation?tab=deleted" className={tabCls(tab === "deleted")}>
          Deleted{deletedCount > 0 ? ` (${deletedCount})` : ""}
        </Link>
        <div className="flex-1" />
        {isAdmin && (
          <Link href="/automation/settings" className="inline-flex h-9 items-center gap-1.5 rounded-full border border-line-strong bg-surface px-3.5 text-sm font-medium text-ink-2 hover:bg-surface-2">
            <Settings size={14} /> Global Workflow Settings
          </Link>
        )}
      </div>

      {openFolder && (
        <div className="flex items-center gap-1 text-sm text-ink-3">
          <Link href="/automation" className="hover:text-primary">Home</Link>
          <ChevronRight size={14} />
          <span className="font-medium text-ink">{openFolder.name}</span>
        </div>
      )}

      {/* Toolbar */}
      <div className="flex flex-wrap items-center gap-2.5">
        {tab === "all" && (
          <button
            onClick={() => setShowFilters((v) => !v)}
            className={`inline-flex h-9 items-center gap-1.5 rounded-full border px-3.5 text-sm font-medium ${showFilters || statusFilter ? "border-primary-tint bg-primary-soft text-primary-strong" : "border-line-strong bg-surface text-ink-2 hover:bg-surface-2"}`}
          >
            <Filter size={14} /> Filters{statusFilter ? " · 1" : ""}
          </button>
        )}
        <div className="flex-1" />
        {tab === "all" && (
          <>
            {isAdmin && <Btn size="sm" variant="ghost" icon={<Play size={15} />} onClick={runNow}>Run due now</Btn>}
            {!openFolder && (
              <Btn size="sm" variant="ghost" icon={<FolderPlus size={15} />} onClick={() => { setFolderError(null); setFolderOpen(true); }}>
                Create folder
              </Btn>
            )}
            <Btn size="sm" icon={<Plus size={15} />} onClick={() => { setError(null); setOpen(true); }}>New workflow</Btn>
          </>
        )}
      </div>

      {/* Status filter chips (behind Filters) */}
      {tab === "all" && showFilters && (
        <div className="flex flex-wrap items-center gap-2 rounded-field border border-line bg-surface-2 px-3 py-2.5">
          <span className="text-caption font-semibold uppercase text-ink-3">Status</span>
          <button onClick={() => setStatusFilter(null)} className={`rounded-full px-2.5 py-0.5 text-caption font-semibold ${statusFilter === null ? "bg-primary text-on-accent" : "bg-surface text-ink-2"}`}>All</button>
          <button onClick={() => setStatusFilter(statusFilter === "PUBLISHED" ? null : "PUBLISHED")} className={`rounded-full px-2.5 py-0.5 text-caption font-semibold ${statusFilter === "PUBLISHED" ? "bg-primary text-on-accent" : "bg-surface text-ink-2"}`}>Live</button>
          <button onClick={() => setStatusFilter(statusFilter === "DRAFT" ? null : "DRAFT")} className={`rounded-full px-2.5 py-0.5 text-caption font-semibold ${statusFilter === "DRAFT" ? "bg-primary text-on-accent" : "bg-surface text-ink-2"}`}>Draft</button>
        </div>
      )}

      {/* Folders (root of the All tab only) */}
      {showFolders && (
        <ul className="divide-y divide-line overflow-hidden rounded-card border border-line bg-surface shadow-card">
          {folders.map((f) => (
            <li key={f.id} className="flex items-center justify-between gap-3 px-5 py-3">
              <Link href={`/automation?folder=${f.id}`} className="flex min-w-0 items-center gap-2.5 text-sm font-semibold text-ink hover:text-primary">
                <Folder size={16} className="flex-none text-ink-3" />
                <span className="truncate">{f.name}</span>
              </Link>
              <div className="flex flex-none items-center gap-1">
                <span className="mr-1 text-caption text-ink-3 tnum">
                  {f.workflowCount} workflow{f.workflowCount === 1 ? "" : "s"}
                </span>
                <IconButton label={`Rename ${f.name}`} onClick={() => rename(f)}><Pencil size={15} /></IconButton>
                {canDelete && <IconButton label={`Delete ${f.name}`} onClick={() => removeFolder(f)}><Trash2 size={15} /></IconButton>}
              </div>
            </li>
          ))}
        </ul>
      )}

      {workflows.length === 0 ? (
        tab === "deleted" ? (
          <EmptyState icon={<Trash2 size={20} />} title="Nothing deleted" body="Deleted workflows land here so you can restore them." />
        ) : (
          <EmptyState
            icon={<Workflow size={20} />}
            title={openFolder ? `No workflows in “${openFolder.name}”` : "No workflows yet"}
            body="Automate follow-ups: e.g. when a form is submitted → send email, wait 1 day, add a task."
            action={<Btn icon={<Plus size={16} />} onClick={() => { setError(null); setOpen(true); }}>New workflow</Btn>}
          />
        )
      ) : (
        <DataTable
          rows={filtered}
          columns={columns}
          csvName="workflows"
          filterPlaceholder="Search workflow name or trigger…"
          emptyMessage="No workflows match. Try a different search or status filter."
          selection={canDelete ? { rowKey: (w) => w.id, selected, onChange: setSelected } : undefined}
          toolbarExtra={
            selected.size > 0 ? (
              <div className="flex flex-wrap items-center gap-1.5">
                <span className="text-caption font-semibold text-ink-2 tnum">{selected.size} selected</span>
                {tab === "deleted" ? (
                  <Btn size="sm" variant="ghost" icon={<RotateCcw size={14} />} onClick={bulkRestore}>Restore</Btn>
                ) : (
                  <>
                    <Btn size="sm" variant="ghost" icon={<Globe size={14} />} onClick={() => bulkPublish(true)}>Publish</Btn>
                    <Btn size="sm" variant="ghost" onClick={() => bulkPublish(false)}>Unpublish</Btn>
                    <Btn size="sm" variant="ghost" icon={<FolderInput size={14} />} onClick={() => setMoveOpen(true)}>Move</Btn>
                    <Btn size="sm" variant="ghost" icon={<Trash2 size={14} />} onClick={bulkDelete}>Delete</Btn>
                  </>
                )}
              </div>
            ) : null
          }
        />
      )}

      {/* New workflow */}
      <Modal open={open} onClose={() => setOpen(false)} title={openFolder ? `New workflow in “${openFolder.name}”` : "New workflow"} size="sm">
        <form action={create} className="space-y-4">
          {/* Creating inside a folder puts it in that folder — matches where the user is. */}
          <input type="hidden" name="folderId" value={openFolder?.id ?? ""} />
          <Field label="Name"><TextInput name="name" required placeholder="e.g. New lead nurture" /></Field>
          <Field label="Trigger — run this when…"><Select name="triggerType" options={TRIGGER_OPTS} defaultValue="FORM_SUBMITTED" /></Field>
          <FormError message={error} />
          <div className="flex justify-end gap-2"><Btn variant="ghost" type="button" onClick={() => setOpen(false)}>Cancel</Btn><SubmitButton>Create</SubmitButton></div>
        </form>
      </Modal>

      {/* New folder */}
      <Modal open={folderOpen} onClose={() => setFolderOpen(false)} title="Create folder" size="sm">
        <form action={addFolder} className="space-y-4">
          <Field label="Folder name"><TextInput name="name" required placeholder="e.g. Pipeline Automations" /></Field>
          <FormError message={folderError} />
          <div className="flex justify-end gap-2"><Btn variant="ghost" type="button" onClick={() => setFolderOpen(false)}>Cancel</Btn><SubmitButton>Create</SubmitButton></div>
        </form>
      </Modal>

      {/* Move to folder */}
      <Modal open={moveOpen} onClose={() => setMoveOpen(false)} title={`Move ${selected.size} workflow${selected.size === 1 ? "" : "s"}`} size="sm">
        <form action={move} className="space-y-4">
          <Field label="Destination">
            <Select
              name="folderId"
              defaultValue={openFolder?.id ?? ""}
              options={[{ value: "", label: "Home (no folder)" }, ...folders.map((f) => ({ value: f.id, label: f.name }))]}
            />
          </Field>
          <div className="flex justify-end gap-2"><Btn variant="ghost" type="button" onClick={() => setMoveOpen(false)}>Cancel</Btn><SubmitButton>Move</SubmitButton></div>
        </form>
      </Modal>
    </div>
  );
}
